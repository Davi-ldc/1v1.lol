#!/usr/bin/env python3
"""Recover registration-backed symbols without loading the Unity client.
Run: python3 -B re/extract/il2cpp/recover.py
Only writes into re/data/il2cpp. Input files are read-only.
"""
import csv, hashlib, json, re, struct
from collections import defaultdict
from functools import lru_cache
from static_il2cpp import Metadata, Wasm, OUT, META, WASM, ROOT
from wasm_disasm import decode, render

PRIMITIVES={1:'void',2:'bool',3:'char',4:'sbyte',5:'byte',6:'short',7:'ushort',8:'int',9:'uint',10:'long',11:'ulong',12:'float',13:'double',14:'string',24:'nint',25:'nuint',28:'object'}
ATTRS={0x10:'static',0x20:'readonly',0x40:'literal',0x80:'notserialized',0x100:'hasRVA',0x8000:'hasDefault'}

def compressed_unsigned(data,pos):
    b=data[pos];pos+=1
    if b<0x80:return b,pos
    if b<0xc0:return ((b&0x3f)<<8)|data[pos],pos+1
    if b<0xe0:return ((b&0x1f)<<24)|(data[pos]<<16)|(data[pos+1]<<8)|data[pos+2],pos+3
    if b==0xf0:return struct.unpack_from('<I',data,pos)[0],pos+4
    if b==0xfe:return 0xfffffffe,pos
    if b==0xff:return 0xffffffff,pos
    raise ValueError(('invalid compressed uint',hex(b),pos-1))

def compressed_signed(data,pos):
    v,pos=compressed_unsigned(data,pos)
    if v==0xffffffff:return -2147483648,pos
    return (-(v>>1)-1 if v&1 else v>>1),pos

class Recovery:
    def __init__(self):
        self.m=Metadata();self.w=Wasm();m=self.m;w=self.w
        self.modules={};self.method_map={};self.func_methods=defaultdict(list)
        by_image=defaultdict(list)
        for method in m.methods:by_image[m.image_for_type[method['declaringType']]].append(method)
        for image in m.images:
            name=image['name'];methods=by_image[name]
            count=max((x['token']&0xffffff for x in methods),default=0)
            candidates=[]
            for a in w.find_bytes(name.encode()+b'\0'):
                for ref in w.refs(a):
                    if ref+68>len(w.memory):continue
                    words=w.words(ref,17)
                    if words[1]!=count or words[2]+4*count>len(w.memory):continue
                    if count and not words[2]:continue
                    slots=w.words(words[2],count)
                    if not all(s==0 or s in w.elements for s in slots):continue
                    candidates.append((ref,words))
            # Some empty modules may have the same count; require uniqueness regardless.
            assert len(candidates)==1,(name,count,candidates)
            address,words=candidates[0]
            self.modules[name]={'address':address,'fileOffset':w.mem_to_file(address),
              'moduleNamePointer':words[0],'methodPointerCount':count,'methodPointers':words[2],
              'adjustorThunkCount':words[3],'adjustorThunks':words[4],'invokerIndices':words[5],
              'reversePInvokeWrapperCount':words[6],'reversePInvokeWrapperIndices':words[7],
              'rgctxRangesCount':words[8],'rgctxRanges':words[9],'rgctxsCount':words[10],'rgctxs':words[11],
              'debuggerMetadata':words[12],'moduleInitializer':words[13],
              'staticConstructorTypeIndices':words[14],'metadataRegistration':words[15],'codeRegistration':words[16]}
            assert len({x['token'] for x in methods})==len(methods)
            assert len(methods)==count,(name,len(methods),count)
            for method in methods:
                index=method['index'];rid=method['token']&0xffffff
                pointer_address=words[2]+(rid-1)*4;slot=w.u32(pointer_address);fn=w.elements.get(slot) if slot else None
                self.method_map[index]={'methodIndex':index,'image':name,'token':method['token'],'rid':rid,
                  'pointerAddress':pointer_address,'tableSlot':slot,'funcIndex':fn,
                  'body':w.bodies.get(fn),'signature':w.signature(fn) if fn is not None else None}
                if fn is not None:self.func_methods[fn].append(index)
        self.labels={f:[m.method_label(i) for i in indices] for f,indices in self.func_methods.items()}
        for imp in w.imports:
            if imp['kind']==0:self.labels[imp['funcIndex']]=[f'import {imp["module"]}.{imp["name"]}']
        self.short_labels={f:labs[:8]+([f'... {len(labs)-8} other metadata aliases'] if len(labs)>8 else []) for f,labs in self.labels.items()}
        count=len(m.types);candidates=[]
        for r in w.refs(count):
            if r<40 or r+24>len(w.memory):continue
            if w.u32(r+8)!=count:continue
            a=r-40;words=w.words(a,16)
            if not (max(t['byvalTypeIndex'] for t in m.types)<words[6]<1000000):continue
            if any(p==0 or p+c*4>len(w.memory) for c,p in [words[6:8],words[10:12],words[12:14]]):continue
            tp=w.words(words[7],words[6])
            if not all(0<p<len(w.memory)-8 for p in tp):continue
            if not all(w.u32(tp[t['byvalTypeIndex']])==t['index'] for t in m.types):continue
            candidates.append((a,words))
        assert len(candidates)==1,candidates
        self.reg_addr,reg=candidates[0]
        keys='genericClassesCount genericClasses genericInstsCount genericInsts genericMethodTableCount genericMethodTable typesCount types methodSpecsCount methodSpecs fieldOffsetsCount fieldOffsets typeDefinitionsSizesCount typeDefinitionsSizes metadataUsagesCount metadataUsages'.split()
        self.reg=dict(zip(keys,reg),address=self.reg_addr,fileOffset=w.mem_to_file(self.reg_addr))
        self.type_ptrs=w.words(self.reg['types'],self.reg['typesCount'])
        # The ordered CodeGenModule array is independently tied to all module records.
        allmods={v['address'] for v in self.modules.values()};arrays=[]
        for p in w.refs(self.modules[m.images[0]['name']]['address']):
            # Enumerate possible positions; module order need not be metadata image order.
            for i in range(len(allmods)):
                start=p-4*i
                if start<0 or start+len(allmods)*4>len(w.memory):continue
                vals=w.words(start,len(allmods))
                if len(set(vals))==len(allmods) and set(vals)==allmods:arrays.append(start)
        arrays=sorted(set(arrays));assert len(arrays)==1,arrays
        self.module_array=arrays[0]
        cr=[]
        for p in w.refs(self.module_array):
            if p>=4 and w.u32(p-4)==len(allmods):cr.append(p-4)
        self.code_registration_tail=cr
        self.field_details={}
        for t in m.types:
            offset_ptr=w.u32(self.reg['fieldOffsets']+t['index']*4)
            size_ptr=w.u32(self.reg['typeDefinitionsSizes']+t['index']*4)
            if size_ptr: t['runtimeSizes']=dict(zip(['instanceSize','nativeSize','staticFieldsSize','threadStaticFieldsSize'],w.words(size_ptr,4)))
            for j,f in enumerate(m.fields_of(t)):
                info=self.type_info(f['typeIndex']);flags=info['attrs'];is_literal=bool(flags&0x40)
                offset=w.i32(offset_ptr+4*j) if offset_ptr else None
                record=dict(f,declaringType=t['index'],declaringTypeName=t['fullname'],image=m.image_for_type[t['index']],
                    type=self.type_name(f['typeIndex']),typeCode=info['code'],attributes=flags,
                    attributeNames=[n for v,n in ATTRS.items() if flags&v],
                    offset=offset,offsetKind='literal/no-storage' if is_literal else 'thread-static/special' if offset is not None and offset<0 else 'static-field-block' if flags&0x10 else 'instance',
                    fieldOffsetsPointer=offset_ptr,fieldOffsetEntryAddress=offset_ptr+4*j if offset_ptr else None)
                default=m.defaults_by_field.get(f['index'])
                if default:record['metadataDefault']=self.default(default)
                self.field_details[f['index']]=record

    def type_info(self,index):
        p=self.type_ptrs[index];data,bits=self.w.words(p,2)
        return dict(pointer=p,data=data,bits=bits,attrs=bits&65535,code=(bits>>16)&255,byref=bool(bits&0x20000000),valueType=bool(bits&0x80000000))

    @lru_cache(None)
    def type_at(self,p,depth=0):
        if depth>12:return '<recursive>'
        d,bits=self.w.words(p,2);code=(bits>>16)&255
        if code in PRIMITIVES:s=PRIMITIVES[code]
        elif code in (0x11,0x12):s=self.m.types[d]['fullname'] if d<len(self.m.types) else f'typedef#{d}'
        elif code in (0xf,0x10,0x1d):s=self.type_at(d,depth+1)+{0xf:'*',0x10:'&',0x1d:'[]'}[code]
        elif code==0x14:
            ty=self.w.u32(d);rank=self.w.memory[d+4];s=self.type_at(ty,depth+1)+'['+','*max(0,rank-1)+']'
        elif code==0x15:
            ty,inst=self.w.words(d,2)
            count,argv=self.w.words(inst,2) if inst else (0,0)
            assert count<1000
            args=[self.type_at(self.w.u32(argv+i*4),depth+1) for i in range(count)]
            s=self.type_at(ty,depth+1)+'<'+', '.join(args)+'>'
        elif code in (0x13,0x1e):s=('!' if code==0x13 else '!!')+str(d)
        else:s=f'<IL2CPP_TYPE_0x{code:x} data=0x{d:x}>'
        return s+('&' if bits&0x20000000 else '')

    def type_name(self,index):return self.type_at(self.type_ptrs[index])

    def default(self,d):
        result=dict(d)
        if d['dataIndex']<0:result['value']=None;result['kind']='null/no-data';return result
        p=self.m.tables['fieldAndParameterDefaultValueData'][0]+d['dataIndex'];start=p;data=self.m.data
        code=self.type_info(d['typeIndex'])['code'];result['typeCode']=code;result['type']=self.type_name(d['typeIndex'])
        fmts={2:'<?',3:'<H',4:'<b',5:'<B',6:'<h',7:'<H',10:'<q',11:'<Q',12:'<f',13:'<d'}
        if code in fmts:
            fmt=fmts[code];val=struct.unpack_from(fmt,data,p)[0];p+=struct.calcsize(fmt)
        elif code in (8,9):val,p=(compressed_signed if code==8 else compressed_unsigned)(data,p)
        elif code==14:
            length,p=compressed_signed(data,p)
            if length==-1:val=None
            else:val=data[p:p+length].decode('utf-8','replace');p+=length
        else:
            result.update(kind='not-decoded',fileOffset=p,rawPrefix=data[p:p+16].hex());return result
        result.update(value=val,kind='metadata-literal',fileOffset=start,raw=data[start:p].hex())
        return result

    def usage_annotation(self,ins):
        if ins['op']!='i32.const':return None
        a=ins['args'][0]
        if not 0<a<=len(self.w.memory)-4 or a%4:return None
        encoded=self.w.u32(a)
        if encoded&1==0:return None
        kind=encoded>>29;index=(encoded&0x1ffffffe)>>1
        if kind in (1,2) and index<len(self.type_ptrs):
            return f'initial encoded metadata usage {"TypeInfo" if kind==1 else "Il2CppType"}[{index}] {self.type_name(index)} @mem0x{a:x}'
        if kind==3 and index<len(self.m.methods):return f'initial encoded MethodDef[{index}] {self.m.method_label(index)} @mem0x{a:x}'
        if kind==5 and index<self.m.tables['stringLiteral'][1]//8:return f'initial encoded StringLiteral[{index}] {self.m.literal(index)!r} @mem0x{a:x}'
        return None

    def method_detail(self,method):
        params=self.m.parameters[method['parameterStart']:method['parameterStart']+method['parameterCount']] if method['parameterCount'] else []
        return dict(method,label=self.m.method_label(method['index']),returnTypeName=self.type_name(method['returnType']),
          parameters=[dict(p,type=self.type_name(p['typeIndex']),metadataDefault=self.default(self.m.parameters_defaults_by_index[p['index']]) if p['index'] in self.m.parameters_defaults_by_index else None) for p in params],
          wasm=self.method_map[method['index']])


def write_json(path,obj):path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
def tsv(path,rows,keys):
    with path.open('w') as f:
        writer=csv.writer(f,delimiter='\t');writer.writerow(keys)
        for row in rows:
            writer.writerow([json.dumps(row.get(k),ensure_ascii=False) if isinstance(row.get(k),(dict,list)) else row.get(k,'') for k in keys])

CORE_TYPES={121,128,129,130,133,134,135,136,139,141,143,146,150,151,152,153,154,155,156,157,158,159,160,161,162,163,164,165,166,167,168,946,947,951,2633,2634,2642}

def run():
    rec=Recovery();m=rec.m;w=rec.w
    OUT.mkdir(parents=True,exist_ok=True)
    tsv(OUT/'types.tsv',(dict(t,image=m.image_for_type[t['index']],parentType=rec.type_name(t['parentIndex']) if t['parentIndex']>=0 else None) for t in m.types),
      ['index','image','fullname','token','fileOffset','byvalTypeIndex','parentIndex','parentType','flags','fieldStart','field_count','methodStart','method_count','runtimeSizes'])
    methods=[]
    for method in m.methods:
        mp=rec.method_map[method['index']];body=mp['body'] or {}
        methods.append(dict(method,label=m.method_label(method['index']),image=mp['image'],tokenHex=f'0x{method["token"]:08x}',tableSlot=mp['tableSlot'],funcIndex=mp['funcIndex'],bodyOffset=body.get('offset'),bodySize=body.get('size'),returnTypeName=rec.type_name(method['returnType'])))
    tsv(OUT/'methods.tsv',methods,['index','image','label','tokenHex','fileOffset','declaringType','returnType','returnTypeName','returnParameterToken','parameterStart','parameterCount','flags','iflags','slot','tableSlot','funcIndex','bodyOffset','bodySize'])
    tsv(OUT/'fields.tsv',rec.field_details.values(),['index','image','declaringType','declaringTypeName','name','token','fileOffset','typeIndex','type','attributes','attributeNames','offset','offsetKind','fieldOffsetEntryAddress','metadataDefault'])
    tsv(OUT/'parameters.tsv',(dict(p,methodIndex=m.parameter_owner[p['index']],type=rec.type_name(p['typeIndex'])) for p in m.parameters),['index','methodIndex','name','token','typeIndex','type','fileOffset'])
    tsv(OUT/'wasm-elements.tsv',({'slot':slot,'function':f,'typeIndex':w.func_types[f]} for slot,f in sorted(w.elements.items())),['slot','function','typeIndex'])
    write_json(OUT/'wasm-structure.json',dict(sections=w.sections,imports=w.imports,exports=w.exports,customSections=w.custom,globals=w.globals,tables=w.tables,memories=w.memories,start=w.start,dataSegments=w.segments))
    write_json(OUT/'registrations.json',dict(metadataRegistration=rec.reg,codeGenModules=rec.modules,codeGenModulesArray=rec.module_array,codeRegistrationCountAddressCandidates=rec.code_registration_tail))
    # Also inventory action/category/layout symbols, camera, movement, weapons, and bootstrap gates.
    extra=[]
    pattern=re.compile(r'(^|\.)(PlayerAction|PlayerController|Actions|Action|Category|Keyboard|Mouse|Map|Layout|vThirdPersonCamera|CameraManager|InputManager|vThirdPersonInput|vThirdPersonMotor|vThirdPersonController|WeaponsController|WeaponModel|HitscanWeaponModel|ProjectileWeaponModel|PlayerState|GameBuilder|BuildManager|GameManager|GameInitializer|GameLoader|Startup|Bootstrap|LoadingManager|LoginManager|ConnectionManager)(`\d+)?$')
    for t in m.types[:4290]:
        if pattern.search(t['fullname']):extra.append(t['index'])
    chosen=sorted(CORE_TYPES|set(extra))
    details=[]
    for ti in chosen:
        t=m.types[ti]
        details.append(dict(t,image=m.image_for_type[ti],fields=[rec.field_details[f['index']] for f in m.fields_of(t)],methods=[rec.method_detail(x) for x in m.methods_of(t)]))
    write_json(OUT/'target-types.json',details)
    selected_methods=[]
    for ti in CORE_TYPES:
        selected_methods.extend(x['index'] for x in m.methods_of(m.types[ti]))
    # Bodies for prior inventory only as targeted follow-up; core decoded now.
    disdir=OUT/'disassembly';disdir.mkdir(exist_ok=True)
    decoded={};errors=[];edges=[]
    for mi in sorted(selected_methods):
        fn=rec.method_map[mi]['funcIndex']
        if fn is None or fn in decoded:continue
        try:d=decode(w,fn)
        except Exception as e:errors.append({'methodIndex':mi,'funcIndex':fn,'error':repr(e)});continue
        decoded[fn]=d
        safe=re.sub(r'[^A-Za-z0-9_.-]+','_',m.method_label(mi))
        (disdir/f'{mi:06d}_{safe}_f{fn}.wat.txt').write_text(render(d,rec.short_labels,rec.usage_annotation))
        for ins in d['instructions']:
            if ins['op']=='call':edges.append(dict(callerMethodIndex=mi,callerFunction=fn,callOffset=ins['offset'],calleeFunction=ins['args'][0],calleeMethodIndices=rec.func_methods.get(ins['args'][0],[]),calleeLabels=rec.labels.get(ins['args'][0],[])))
    write_json(OUT/'target-call-edges.json',edges)
    literal_matches=[]
    for i in range(m.tables['stringLiteral'][1]//8):
        text=m.literal(i)
        if re.search(r'GameBuilder|BuildManager|build.{0,12}(wall|ramp|floor|roof)|\b(Build|Rotate|Wall|Ramp|Floor|Roof|Edit)\b|offline|tutorial|connected',text,re.I):
            literal_matches.append({'literalIndex':i,'value':text})
    write_json(OUT/'literal-candidates.json',literal_matches)
    summary=dict(inputFiles=[{'path':str(p.relative_to(ROOT)),'size':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [META,WASM]],
      metadataVersion=m.version,counts=dict(types=len(m.types),methods=len(m.methods),fields=len(m.fields),parameters=len(m.parameters),images=len(m.images),stringLiterals=m.tables['stringLiteral'][1]//8),
      metadataTables=m.tables,wasm=dict(functions=len(w.func_types),importedFunctions=w.imported_funcs,bodies=len(w.bodies),tableEntries=len(w.elements),customSections=w.custom),
      validations=dict(allMethodOwnerRanges=True,allMethodTokensUniqueWithinImage=True,allModuleMethodCountsEqualMetadataTokenRanges=True,allNonzeroMethodPointersExistInElementTable=True,allByvalTypeDataEqualTypeDefinitionIndices=True,allCodeGenModulesPresentExactlyOnceInArray=True),
      registrationAddresses=dict(metadata=rec.reg_addr,modules=rec.module_array,codeRegistrationCount=rec.code_registration_tail),
      mappedMethods=sum(x['funcIndex'] is not None for x in rec.method_map.values()),unmappedMethods=sum(x['funcIndex'] is None for x in rec.method_map.values()),
      decodedTargetFunctions=len(decoded),decodeErrors=errors,selectedTypes=chosen,
      importantCaveats=['No client execution or runtime state was observed.','fieldOffsets are instance or static-block offsets, never file offsets.','metadata defaults are literals/optional defaults, not serialized Unity scene/prefab values.','tableSlot != functionIndex != WASM file offset.','Generic/shared function bodies can have multiple metadata aliases.'])
    write_json(OUT/'summary.json',summary)
    print(json.dumps({k:summary[k] for k in ['counts','wasm','registrationAddresses','mappedMethods','unmappedMethods','decodedTargetFunctions','decodeErrors']},indent=2))

if __name__=='__main__':run()
