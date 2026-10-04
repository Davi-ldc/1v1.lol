#!/usr/bin/env python3
"""Export metadata field order/attributes to aid the separate Unity assets audit.
This is NOT a Unity TypeTree and contains no decoded serialized asset values.
"""
import struct
from recover import Recovery, compressed_unsigned, write_json, OUT

REQUESTED=('Building RampBuilding WallBuilding FloorBuilding RoofBuilding '
 'SimpleEditableBuilding DirectionalEditableBuilding BuildingPart ToggleableBuildingPart '
 'PyramidToggleableBuildingPart BuildingsSettings BuildingManager PlayerBuildingManager '
 'DefaultControls InputManager InputCalculations ControllerSettings BuildingShapeState '
 'BuildingOption BuildingStyleOptions Buttons Button PlayerActions BuildingType '
 'PlayerBuildingState AimAssistSettings ObscuredInt ObscuredFloat ObscuredString '
 'BuildingInsideCollider IntersectionPoints SOManagedInstance FloatIntBytes ').split()

def export():
    r=Recovery();m=r.m;o,n=m.tables['attributeDataRange'];base,sz=m.tables['attributeData']
    ranges=list(struct.iter_unpack('<II',m.data[o:o+n]));by_image={}
    for image in m.images:
        st=image['customAttributeStart'];count=image['customAttributeCount']
        by_image[image['name']]=dict(ranges[st:st+count])
    def attrs(image,token):
        start=by_image[image].get(token)
        if start is None:return []
        count,pos=compressed_unsigned(m.data,base+start)
        assert count<10000
        indices=struct.unpack_from('<'+'I'*count,m.data,pos)
        assert all(i<len(m.methods) and m.methods[i]['name']=='.ctor' for i in indices)
        return [{'constructorMethodIndex':i,'constructor':m.method_label(i),'attributeType':m.types[m.methods[i]['declaringType']]['fullname'],'attributeDataFileOffset':base+start} for i in indices]
    def parent(t):
        if t['parentIndex']<0:return None
        info=r.type_info(t['parentIndex'])
        if info['code'] in (0x11,0x12):return info['data']
        return None
    chosen={t['index'] for t in m.types if (t['name'] in REQUESTED and (t['index']<4290 or t['namespace'].startswith('CodeStage.'))) or t['namespace'].startswith('Rewired')}
    for ti in list(chosen):
        par=parent(m.types[ti])
        while par is not None and par not in chosen:
            chosen.add(par);par=parent(m.types[par])
    result=[]
    for ti in sorted(chosen):
        t=m.types[ti];image=m.image_for_type[ti];fields=[]
        for order,f in enumerate(m.fields_of(t)):
            detail=r.field_details[f['index']];ca=attrs(image,f['token']);names=[a['attributeType'] for a in ca]
            flags=detail['attributes'];visibility=flags&7
            reasons=[]
            if flags&0x10:reasons.append('static')
            if flags&0x20:reasons.append('readonly')
            if flags&0x40:reasons.append('literal')
            if flags&0x80:reasons.append('NonSerialized field flag')
            if visibility!=6 and 'UnityEngine.SerializeField' not in names and 'UnityEngine.SerializeReference' not in names:reasons.append('non-public without SerializeField/SerializeReference')
            fields.append(dict(detail,declarationOrder=order,visibility={1:'private',2:'family-and-assembly',3:'assembly',4:'family',5:'family-or-assembly',6:'public'}.get(visibility,str(visibility)),customAttributes=ca,
                serializationEligibility='excluded-by-field-flags' if reasons else 'candidate: Unity type rules still apply',serializationExclusionReasons=reasons))
        result.append(dict(index=ti,name=t['fullname'],image=image,token=t['token'],parentTypeIndex=parent(t),parentName=r.type_name(t['parentIndex']) if t['parentIndex']>=0 else None,
            typeAttributes=t['flags'],customAttributes=attrs(image,t['token']),declaredFields=fields))
    write_json(OUT/'unity-field-schemas.json',dict(caveats=['Metadata order + field flags and custom attribute constructor identities; NOT a Unity TypeTree.',
        'Instance field offsets describe IL2CPP runtime memory, NOT serialized file byte offsets.',
        'SerializeField identity is decoded from v31 custom-attribute constructor list; attribute argument payloads are not decoded.',
        'Unity serialization additionally excludes unsupported field types; candidate is not proof of serialization.',
        'Base-class fields must be traversed separately. Engine native base members are not reconstructed from managed metadata.'],types=result))
    print('exported',len(result),'types to',OUT/'unity-field-schemas.json')

if __name__=='__main__':export()
