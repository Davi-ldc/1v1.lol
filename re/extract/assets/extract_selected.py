#!/usr/bin/env python3
"""Follow actual prefab/native-component PPtrs; extract raw selected objects.
Mesh decoder reads the uncompressed Unity 2022.3 layout. It reports consumption
and bounds independently; no mesh-name-to-collider equivalence is assumed.
"""
import collections, hashlib, json, math, re, struct
from unity_assets import ROOT,Bundle,Serialized,Reader,dump
from scan_assets import OUT,native,identity,resolve

def byte_array(r):
    n=r.i(); data=r.read(n); r.align(); return data

def packed(r,floating=False):
    d={'num_items':r.u()}
    if floating: d.update({'range':r.f(),'start':r.f()})
    data=byte_array(r); d['data_size']=len(data); d['bit_size']=r.b(); r.align(); return d

def mesh(a,o):
    r=a.reader(o); d={'m_Name':r.string()}
    def submesh(): return {'firstByte':r.u(),'indexCount':r.u(),'topology':r.i(),'baseVertex':r.u(),'firstVertex':r.u(),'vertexCount':r.u(),'localAABB':{'center':r.vec(),'extent':r.vec()}}
    d['m_SubMeshes']=r.array(submesh)
    n=r.i(); r.read(n*40); d['blend_shape_vertices']=n
    def blend():
        out={'firstVertex':r.u(),'vertexCount':r.u(),'hasNormals':r.b(),'hasTangents':r.b()}; r.align(); return out
    d['blend_shapes']=r.array(blend)
    d['blend_channels']=r.array(lambda:{'name':r.string(),'nameHash':r.u(),'frameIndex':r.i(),'frameCount':r.i()})
    d['blend_full_weights']=r.array(r.f)
    n=r.i(); r.read(n*64); d['bind_pose_count']=n
    d['bone_name_hashes']=r.array(r.u); d['root_bone_name_hash']=r.u()
    n=r.i(); r.read(n*24); d['bone_aabb_count']=n
    d['variable_bone_count_weights']=r.array(r.u)
    d['m_MeshCompression']=r.b(); d['m_IsReadable']=bool(r.b()); d['m_KeepVertices']=bool(r.b()); d['m_KeepIndices']=bool(r.b()); r.align()
    d['m_IndexFormat']=r.i(); indexes=byte_array(r); d['index_buffer_bytes']=len(indexes)
    d['m_VertexCount']=r.u()
    channels=r.array(lambda:{'stream':r.b(),'offset':r.b(),'format':r.b(),'dimension':r.b()}); d['channels']=channels
    vertex_bytes=byte_array(r); d['vertex_buffer_bytes']=len(vertex_bytes)
    compressed={}
    for key in ('vertices','uv','normals','tangents'): compressed[key]=packed(r,True)
    for key in ('weights','normal_signs','tangent_signs'): compressed[key]=packed(r)
    compressed['float_colors']=packed(r,True)
    for key in ('bone_indices','triangles'): compressed[key]=packed(r)
    compressed['uv_info']=r.u(); d['compressed_mesh']=compressed
    d['m_LocalAABB']={'center':r.vec(),'extent':r.vec()}; d['m_MeshUsageFlags']=r.i(); d['m_CookingOptions']=r.i()
    d['baked_convex_collision_bytes']=len(byte_array(r)); d['baked_triangle_collision_bytes']=len(byte_array(r))
    d['mesh_metrics']=r.vec(2); r.align()
    d['m_StreamData']={'offset':r.Q(),'size':r.u(),'path':r.string()}
    d['_bytes_consumed']=r.pos; d['_trailing_bytes']=len(r.data)-r.pos
    d['triangle_count_from_submeshes']=sum(s['indexCount']//3 for s in d['m_SubMeshes'] if s['topology']==0)
    d['all_submeshes_triangle_topology']=all(s['topology']==0 and s['indexCount']%3==0 for s in d['m_SubMeshes'])
    # Position is channel 0. Streams are interleaved separately and 16-byte aligned.
    sizes={0:4,1:2,2:1,3:1,4:2,5:2,6:1,7:1,8:2,9:2,10:4,11:4}
    strides={}
    for c in channels:
        dim=c['dimension']&15
        if dim: strides[c['stream']]=max(strides.get(c['stream'],0),c['offset']+sizes.get(c['format'],0)*dim)
    stream_offsets={}; cursor=0
    for s,stride in sorted(strides.items()): stream_offsets[s]=cursor; cursor=(cursor+stride*d['m_VertexCount']+15)//16*16
    if channels and channels[0]['dimension']&15>=3 and channels[0]['format']==0 and vertex_bytes:
        c=channels[0]; base=stream_offsets[c['stream']]+c['offset']; stride=strides[c['stream']]
        verts=[struct.unpack_from(a.e+'3f',vertex_bytes,base+i*stride) for i in range(d['m_VertexCount'])]
        lo=[min(v[j] for v in verts) for j in range(3)]; hi=[max(v[j] for v in verts) for j in range(3)]
        d['decoded_position_bounds']={'min':lo,'max':hi,'size':[hi[j]-lo[j] for j in range(3)]}
        d['decoded_vertex_count']=len(verts)
        width=2 if d['m_IndexFormat']==0 else 4; fmt='H' if width==2 else 'I'; faces=[]
        for sm in d['m_SubMeshes']:
            if sm['topology']!=0: continue
            indices=struct.unpack_from(a.e+str(sm['indexCount'])+fmt,indexes,sm['firstByte'])
            faces += [tuple(sm['baseVertex']+idx+1 for idx in indices[i:i+3]) for i in range(0,len(indices),3)]
        d['indices_in_range']=all(1<=idx<=len(verts) for face in faces for idx in face)
        fn=f"{a.name.replace('/','_')}_{o['path_id']}.obj"
        (OUT/'meshes').mkdir(exist_ok=True)
        with (OUT/'meshes'/fn).open('w') as f:
            f.write(f"# source {a.container} :: {a.name} PathID {o['path_id']}\n")
            for v in verts: f.write('v '+' '.join(format(x,'.9g') for x in v)+'\n')
            for face in faces: f.write('f '+' '.join(map(str,face))+'\n')
        d['positions_faces_export']='meshes/'+fn
    return d

def main():
    bundle=Bundle(ROOT/'artifacts/extracted/data/data.unity3d')
    names=['resources.assets','globalgamemanagers','globalgamemanagers.assets','level0','sharedassets2.assets','level7']
    assets=[Serialized(n,bundle.files[n],bundle.meta['container']) for n in names]
    built=ROOT/'artifacts/extracted/data/Resources/unity_default_resources'
    assets.append(Serialized(built.name,built.read_bytes(),str(built.relative_to(ROOT))))
    byname={a.name:a for a in assets}; resources=byname['resources.assets']; errors=[]; records={}; references=[]
    rawdir=OUT/'objects'; rawdir.mkdir(parents=True,exist_ok=True)
    scripts=json.loads((OUT/'monoscripts.json').read_text()); sm={(s['serialized'],s['path_id']):s['fields'] for s in scripts}
    def record(a,o):
        key=(a.name,o['path_id'])
        if key in records: return records[key]
        rec=identity(a,o); records[key]=rec
        blob=a.raw(o); filename=f"{a.name.replace('/','_')}_{o['path_id']}_{o['type']}.bin"
        (rawdir/filename).write_bytes(blob); rec['raw_file']='objects/'+filename; rec['sha256']=hashlib.sha256(blob).hexdigest()
        try:
            d=mesh(a,o) if o['class_id']==43 else native(a,o)
            rec['fields']=d
            if o['class_id']==114:
                target,so=resolve(a,d['m_Script'],byname)
                info=sm.get((target.name,so['path_id'])) if target and so else None
                rec['script_identity']=info
                payload=blob[d['payload_offset']:]
                rec['untyped_payload']={'hex':payload.hex(),'uint32_le':[struct.unpack_from('<I',payload,i)[0] for i in range(0,len(payload)-3,4)]}
        except NotImplementedError: rec['note']='Raw retained; native type layout not decoded.'
        except Exception as exc: rec['decode_error']=str(exc); errors.append({**identity(a,o),'error':str(exc)})
        return rec
    def pointer(a,owner,field,ptr,follow=True):
        target,obj=resolve(a,ptr,byname)
        rr={'source_serialized':a.name,'source_path_id':owner['path_id'],'field':field,'pptr':ptr}
        if ptr['m_PathID']==0: rr['status']='null'
        elif target and obj:
            rr.update({'status':'resolved','target_serialized':target.name,'target_path_id':obj['path_id'],'target_type':obj['type']})
            if follow: record(target,obj)
        else:
            rr['status']='not_loaded_or_missing'
            if ptr['m_FileID']>0 and ptr['m_FileID']<=len(a.externals): rr['external_path']=a.externals[ptr['m_FileID']-1]['path']
        references.append(rr); return target,obj
    roots=[1616,1709,1714,1703] # Go IDs verified through Ramp/Wall/Floor/RoofBuilding script PPtrs.
    visited=set(); hierarchy=[]
    def walk(go_id,parent=None):
        if go_id in visited: return
        visited.add(go_id); go=resources.by_id[go_id]; d=record(resources,go)['fields']
        node={'gameobject_path_id':go_id,'name':d['m_Name'],'parent_gameobject_path_id':parent,'active':d['m_IsActive'],'layer':d['m_Layer'],'components':[]}; hierarchy.append(node)
        for index,ptr in enumerate(d['m_Component']):
            a,co=pointer(resources,go,f'm_Component[{index}]',ptr)
            if not co: continue
            rec=record(a,co); f=rec.get('fields',{}); node['components'].append({'path_id':co['path_id'],'type':co['type'],'script':rec.get('script_identity',{}).get('m_ClassName')})
            for field in ('m_GameObject','m_Father','m_Mesh','m_Material','m_Script'):
                if field in f: pointer(a,co,field,f[field])
            for i,material in enumerate(f.get('m_Materials',[])): pointer(a,co,f'm_Materials[{i}]',material)
            if co['class_id']==4:
                for i,child in enumerate(f['m_Children']):
                    ta,to=pointer(a,co,f'm_Children[{i}]',child)
                    if to:
                        tf=record(ta,to)['fields']; walk(tf['m_GameObject']['m_PathID'],go_id)
    for root in roots: walk(root)
    # Native input manager and complete byte-level Build/PlayerSettings evidence.
    gm=byname['globalgamemanagers']; input_records=[]
    for o in gm.objects:
        if o['class_id'] in (13,129,141,78):
            rec=record(gm,o)
            if o['class_id']==13: input_records.append(rec)
            if o['class_id']==141:
                r=gm.reader(o)
                try: rec['decoded_scene_list']=r.array(r.string); rec['scene_prefix_end']=r.pos; rec['trailing_hex']=r.read(len(r.data)-r.pos).hex()
                except Exception as exc: rec['scene_parse_error']=str(exc)
            if o['class_id'] in (129,78):
                rec['ascii_runs']=[{'offset':m.start(),'text':m.group().decode('ascii')} for m in re.finditer(rb'[ -~]{4,}',gm.raw(o))]
    mb=json.loads((OUT/'selected-monobehaviours.json').read_text())
    for m in mb:
        name=m['script_identity']['class_name'] if m['script_identity'] else ''
        if m['serialized'] in byname and ((m['serialized']=='resources.assets' and name in ('BuildingsSettings','PlayerBuildingManager','BuildingStateManager','BuildingCalculation','BuildingNetworkController')) or name=='InputManager'):
            a=byname[m['serialized']]; record(a,a.by_id[m['path_id']])
    # Resolve every native pointer recovered above. Managed payloads stay untyped.
    dump(OUT/'prefab-hierarchy.json',hierarchy)
    dump(OUT/'selected-objects.json',list(records.values()))
    dump(OUT/'selected-pptrs.json',references)
    dump(OUT/'input-manager.json',input_records)
    dump(OUT/'selected-extraction-errors.json',errors)
    dump(OUT/'build-player-settings.json',[r for r in records.values() if r['class_id'] in (129,141,78)])
    print(json.dumps({'selected_objects':len(records),'hierarchy_nodes':len(hierarchy),'pointers':len(references),'errors':errors,'roots':[(g['gameobject_path_id'],g['name']) for g in hierarchy if g['parent_gameobject_path_id'] is None],'input_axes':len(input_records[0]['fields']['m_Axes']) if input_records else None,'mesh_count':sum(r['class_id']==43 for r in records.values())},indent=2))

if __name__=='__main__': main()
