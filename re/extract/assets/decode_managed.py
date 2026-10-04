#!/usr/bin/env python3
"""Cross-check recovered managed metadata schemas against serialized payloads.
This is not a recovered TypeTree. Accepts a decode only when it consumes the
entire payload; PPtrs are checked against the full serialized object index.
"""
import gzip,json,struct
from unity_assets import DATA,ROOT,Reader,dump
SELECTED=DATA/'selected'; OUT=DATA/'managed'

SCHEMA=ROOT/'re/data/il2cpp/unity-field-schemas.json'
PTRS=set('Building BuildingOption BuildingPart BuildingInsideCollider BuildingEffects FloatingHealthBar ToggleableBuildingPart PlayerController SettingsInputPercents SettingsInputFloat SettingsToggle'.split())
SKIP=set('BuildingShapeState BuildingManager EditingManager TrappingManager'.split())

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    schema=json.loads(SCHEMA.read_text()); types={t['name']:t for t in schema['types']}; used_types={}
    def allfields(name):
        t=types[name]; used_types[name]=t
        parent=t['parentName']; fields=allfields(parent) if parent in types and parent not in ('UnityEngine.MonoBehaviour','UnityEngine.ScriptableObject') else []
        return fields+[f for f in t['declaredFields'] if not f['serializationEligibility'].startswith('excluded')]
    def value(r,typ):
        if typ=='bool': v=bool(r.b()); r.align(); return v
        if typ=='int': return r.i()
        if typ=='uint': return r.u()
        if typ=='float': return r.f()
        if typ=='double': return r.num('d')
        if typ=='string': return r.string()
        if typ in ('UnityEngine.Vector2','UnityEngine.Vector3','UnityEngine.Vector4','UnityEngine.Quaternion','UnityEngine.Color'): return r.vec({'UnityEngine.Vector2':2,'UnityEngine.Vector3':3}.get(typ,4))
        if typ in PTRS or typ in ('UnityEngine.GameObject','UnityEngine.MeshRenderer','UnityEngine.MeshCollider','UnityEngine.BoxCollider','UnityEngine.Transform'): return r.pptr()
        if typ.endswith('[]'): return r.array(lambda:value(r,typ[:-2]))
        if typ.startswith('System.Collections.Generic.List`1<'): return r.array(lambda:value(r,typ.split('<',1)[1][:-1]))
        if typ.startswith('System.Collections.Generic.Dictionary`2<') or typ in SKIP: return {'not_serialized':'unsupported/non-Serializable managed type'}
        if typ=='UnityEngine.AnimationCurve':
            def key(): return {'time':r.f(),'value':r.f(),'inSlope':r.f(),'outSlope':r.f(),'weightedMode':r.i(),'inWeight':r.f(),'outWeight':r.f()}
            return {'keys':r.array(key),'preInfinity':r.i(),'postInfinity':r.i(),'rotationOrder':r.i()}
        if typ in types:
            t=types[typ]
            if t['parentName']=='System.Enum': return r.i()
            if t['typeAttributes']&0x2000: return fields(r,typ)
            return {'not_serialized':'non-Serializable managed type'}
        raise ValueError('schema unavailable for '+typ)
    def fields(r,name):
        result={}
        for field in allfields(name):
            start=r.pos
            try: val=value(r,field['type'])
            except Exception as exc: raise ValueError(f"{name}.{field['name']} @{start}: {exc}") from exc
            result[field['name']]={'type':field['type'],'serialized_offset':start,'serialized_end':r.pos,'value':val,'metadata_field_index':field['index']}
        return result
    rows=json.loads((SELECTED/'selected-objects.json').read_text()); decoded=[]; failures=[]
    wanted={'RampBuilding','WallBuilding','FloorBuilding','RoofBuilding','BuildingPart','BuildingOption','ToggleableBuildingPart','PyramidToggleableBuildingPart','BuildingsSettings','PlayerBuildingManager','ControllerSettings'}
    for row in rows:
        name=row.get('script_identity',{}).get('m_ClassName')
        if name not in wanted: continue
        blob=(SELECTED/row['raw_file']).read_bytes(); r=Reader(blob,pos=row['fields']['payload_offset'])
        rec={k:row[k] for k in ('container','serialized','path_id','raw_file')}; rec['managed_type']=name
        try:
            rec['fields']=fields(r,name); rec['bytes_consumed']=r.pos; rec['byte_size']=len(blob); rec['trailing_bytes']=len(blob)-r.pos
            if rec['trailing_bytes']: raise ValueError(f"unconsumed {rec['trailing_bytes']} bytes")
            rec['status']='schema-and-length-validated'; decoded.append(rec)
        except Exception as exc: rec['status']='not_validated'; rec['error']=str(exc); failures.append(rec)
    dump(OUT/'managed-decoded.json',decoded); dump(OUT/'managed-decode-failures.json',failures)
    dump(OUT/'managed-used-schemas.json',{'source':str(SCHEMA.relative_to(ROOT)),'caveats':schema['caveats'],'types':list(used_types.values())})
    print(json.dumps({'accepted':len(decoded),'failed':len(failures),'failure_samples':[{'type':r['managed_type'],'path_id':r['path_id'],'error':r['error']} for r in failures[:12]]},indent=2))
    for row in decoded:
        if row['managed_type'] in ('RampBuilding','WallBuilding','FloorBuilding','RoofBuilding','BuildingsSettings','PlayerBuildingManager'):
            print(row['managed_type'],row['path_id'],json.dumps({k:f['value'] for k,f in row['fields'].items()}))

if __name__=='__main__':main()
