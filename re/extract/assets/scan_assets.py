#!/usr/bin/env python3
"""Inventory selected native objects, script identities and stripped MB payloads.
No script schema is inferred from class names. Raw fields remain unnamed.
"""
import collections,gzip,json,re,struct
from unity_assets import ROOT,DATA,load_all,dump
OUT=DATA/'selected'
PATTERN=re.compile(r'ramp|stair|wall|floor|pyramid|build|input|keybind|control|setting',re.I)

def identity(a,o): return {'container':a.container,'serialized':a.name,**o}
def native(a,o):
    r=a.reader(o); t=o['class_id']; d={}
    if t==1:
        d={'m_Component':r.array(r.pptr),'m_Layer':r.u(),'m_Name':r.string(),'m_Tag':r.H(),'m_IsActive':bool(r.b())}
    elif t in (4,224):
        d={'m_GameObject':r.pptr(),'m_LocalRotation':r.vec(4),'m_LocalPosition':r.vec(),'m_LocalScale':r.vec(),'m_Children':r.array(r.pptr),'m_Father':r.pptr()}
        if t==224:
            for key in ('m_AnchorMin','m_AnchorMax','m_AnchoredPosition','m_SizeDelta','m_Pivot'): d[key]=r.vec(2)
    elif t==115:
        d={'m_Name':r.string(),'m_ExecutionOrder':r.i(),'m_PropertiesHash':r.read(16).hex(),'m_ClassName':r.string(),'m_Namespace':r.string(),'m_AssemblyName':r.string()}
    elif t==114:
        d={'m_GameObject':r.pptr(),'m_Enabled':bool(r.b())}; r.align()
        d.update({'m_Script':r.pptr(),'m_Name':r.string(),'payload_offset':r.pos,'payload_size':len(r.data)-r.pos})
    elif t==33: d={'m_GameObject':r.pptr(),'m_Mesh':r.pptr()}
    elif t==23:
        d={'m_GameObject':r.pptr()}
        for key in ('m_Enabled','m_CastShadows','m_ReceiveShadows','m_DynamicOccludee','m_StaticShadowCaster','m_MotionVectors','m_LightProbeUsage','m_ReflectionProbeUsage','m_RayTracingMode','m_RayTraceProcedural'): d[key]=r.b()
        r.align(); d['m_RenderingLayerMask']=r.u(); d['m_RendererPriority']=r.i()
        d['m_LightmapIndex']=r.H(); d['m_LightmapIndexDynamic']=r.H()
        d['m_LightmapTilingOffset']=r.vec(4); d['m_LightmapTilingOffsetDynamic']=r.vec(4)
        d['m_Materials']=r.array(r.pptr)
        d['_partial_native_decode']=True
    elif t==78:
        d={'tags':r.array(r.string),'layers':r.array(r.string)}
    elif t in (64,65,135,136):
        d={'m_GameObject':r.pptr(),'m_Material':r.pptr(),'m_IncludeLayers':r.u(),'m_ExcludeLayers':r.u(),'m_LayerOverridePriority':r.i(),'m_IsTrigger':bool(r.b()),'m_ProvidesContacts':bool(r.b())}; r.align()
        d['m_Enabled']=bool(r.b()); r.align()
        if t==64:
            d['m_Convex']=bool(r.b()); r.align(); d['m_CookingOptions']=r.i(); d['m_Mesh']=r.pptr()
        elif t==65: d['m_Size']=r.vec(); d['m_Center']=r.vec()
        elif t==135: d['m_Radius']=r.f(); d['m_Center']=r.vec()
        elif t==136: d['m_Radius']=r.f(); d['m_Height']=r.f(); d['m_Direction']=r.i(); d['m_Center']=r.vec()
    elif t==13:
        def axis():
            out={k:r.string() for k in ('m_Name','descriptiveName','descriptiveNegativeName','negativeButton','positiveButton','altNegativeButton','altPositiveButton')}
            out.update({k:r.f() for k in ('gravity','dead','sensitivity')})
            out.update({'snap':bool(r.b()),'invert':bool(r.b())}); r.align()
            out.update({k:r.i() for k in ('type','axis','joyNum')}); return out
        d={'m_Axes':r.array(axis)}
    elif t in (43,21,28,48,49,142): d={'m_Name':r.string()}
    else: raise NotImplementedError(t)
    d['_bytes_consumed']=r.pos; d['_trailing_bytes']=len(r.data)-r.pos
    return d

def resolve(a,ptr,byname):
    if ptr['m_PathID']==0: return None,None
    if ptr['m_FileID']==0: target=a
    elif ptr['m_FileID']<=len(a.externals):
        path=a.externals[ptr['m_FileID']-1]['path']
        target=byname.get(path) or byname.get(path.split('/')[-1])
        if target is None and path=='Library/unity default resources': target=byname.get('unity_default_resources')
    else: return None,None
    return (target,target.by_id.get(ptr['m_PathID'])) if target is not None else (None,None)

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    bundles,assets,errors=load_all(); byname={a.name:a for a in assets}
    scripts=[]; script_map={}
    for a in assets:
        for o in a.objects:
            if o['class_id']!=115: continue
            try:
                rec={**identity(a,o),'fields':native(a,o)}; scripts.append(rec); script_map[(a.name,o['path_id'])]=rec
            except Exception as exc: errors.append({**identity(a,o),'error':str(exc)})
    dump(OUT/'monoscripts.json',scripts)
    dump(OUT/'relevant-monoscripts.json',[s for s in scripts if PATTERN.search(s['fields']['m_ClassName'])])
    game_names=collections.Counter(); hits=[]; mesh_names=[]; mb_hits=[]; input_manager=[]
    for a in assets:
        for o in a.objects:
            try:
                if o['class_id']==1:
                    d=native(a,o); game_names[d['m_Name']]+=1
                    if PATTERN.search(d['m_Name']): hits.append({**identity(a,o),'fields':d})
                elif o['class_id']==43: mesh_names.append({**identity(a,o),'fields':native(a,o)})
                elif o['class_id']==13:
                    (OUT/'input-manager.bin').write_bytes(a.raw(o))
                    input_manager.append({**identity(a,o),'fields':native(a,o)})
                elif o['class_id']==114:
                    d=native(a,o); target,script=resolve(a,d['m_Script'],byname)
                    info=script_map.get((target.name,script['path_id'])) if target and script else None
                    scriptname=info['fields']['m_ClassName'] if info else '<unresolved>'
                    if PATTERN.search(scriptname) or (d['m_Name'] and PATTERN.search(d['m_Name'])):
                        mb_hits.append({**identity(a,o),'fields':d,'script_identity':{'serialized':target.name,'path_id':script['path_id'],'class_name':scriptname,'namespace':info['fields']['m_Namespace']} if info else None})
            except Exception as exc: errors.append({**identity(a,o),'error':str(exc)})
    dump(OUT/'gameobject-name-counts.json',dict(game_names.most_common()))
    dump(OUT/'selected-gameobjects.json',hits)
    dump(OUT/'mesh-inventory.json',mesh_names)
    dump(OUT/'selected-monobehaviours.json',mb_hits)
    dump(OUT/'input-manager.json',input_manager)
    dump(OUT/'scan-errors.json',errors)
    print(json.dumps({'scripts':len(scripts),'relevant_scripts':sum(bool(PATTERN.search(s['fields']['m_ClassName'])) for s in scripts),'gameobject_hits':len(hits),'monobehaviour_hits':len(mb_hits),'meshes':len(mesh_names),'input_managers':input_manager,'errors':errors[:20],'error_count':len(errors)},indent=2))

if __name__=='__main__': main()
