#!/usr/bin/env python3
"""Offline, standard-library readers. Never instantiate/execute the WASM module.
IL2CPP v31 record layouts are validated against sizes, tokens and owning ranges.
WASM addresses in memory and file offsets are kept separate.
"""
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 're/data/il2cpp'
META = ROOT / 'artifacts/extracted/data/Il2CppData/Metadata/global-metadata.dat'
WASM = ROOT / 'artifacts/extracted/WebGL.wasm'
TABLE_NAMES = ('stringLiteral stringLiteralData string events properties methods '
 'parameterDefaultValues fieldDefaultValues fieldAndParameterDefaultValueData '
 'fieldMarshaledSizes parameters fields genericParameters genericParameterConstraints '
 'genericContainers nestedTypes interfaces vtableMethods interfaceOffsets typeDefinitions '
 'images assemblies fieldRefs referencedAssemblies attributeData attributeDataRange '
 'unresolvedIndirectCallParameterTypes unresolvedIndirectCallParameterRanges '
 'windowsRuntimeTypeNames windowsRuntimeStrings exportedTypeDefinitions').split()

class Metadata:
    def __init__(self, path=META):
        self.data = path.read_bytes()
        self.magic, self.version = struct.unpack_from('<II', self.data)
        assert (self.magic, self.version) == (0xfab11baf, 31)
        self.tables = dict(zip(TABLE_NAMES, struct.iter_unpack('<II', self.data[8:256])))
        for o, n in self.tables.values(): assert o + n <= len(self.data)
        self.types = self.records('typeDefinitions', '<16i8H2I',
          'nameIndex namespaceIndex byvalTypeIndex declaringTypeIndex parentIndex elementTypeIndex genericContainerIndex flags fieldStart methodStart eventStart propertyStart nestedTypesStart interfacesStart vtableStart interfaceOffsetsStart method_count property_count field_count event_count nested_type_count vtable_count interfaces_count interface_offsets_count bitfield token')
        self.methods = self.records('methods', '<iiiIiiI4H',
          'nameIndex declaringType returnType returnParameterToken parameterStart genericContainerIndex token flags iflags slot parameterCount')
        self.fields = self.records('fields', '<iiI', 'nameIndex typeIndex token')
        self.parameters = self.records('parameters', '<iIi', 'nameIndex token typeIndex')
        self.images = self.records('images', '<iiIiIiIiII',
          'nameIndex assemblyIndex typeStart typeCount exportedTypeStart exportedTypeCount entryPointIndex token customAttributeStart customAttributeCount')
        self.defaults = self.records('fieldDefaultValues', '<iii', 'fieldIndex typeIndex dataIndex')
        self.parameter_defaults = self.records('parameterDefaultValues', '<iii', 'parameterIndex typeIndex dataIndex')
        self.properties = self.records('properties','<iiiII','nameIndex get set attrs token')
        self.events = self.records('events','<iiiiiI','nameIndex typeIndex add remove raise token')
        self.image_for_type = {}
        self.field_owner = {}
        self.parameter_owner = {}
        for image in self.images:
            for ti in range(image['typeStart'], image['typeStart']+image['typeCount']):
                self.image_for_type[ti] = image['name']
        for t in self.types:
            t['namespace'] = self.string(t['namespaceIndex'])
            t['fullname'] = (t['namespace']+'.' if t['namespace'] else '') + t['name']
            assert t['token'] >> 24 == 2
            for fi in range(t['fieldStart'],t['fieldStart']+t['field_count']): self.field_owner[fi] = t['index']
            for mi in range(t['methodStart'],t['methodStart']+t['method_count']):
                assert self.methods[mi]['declaringType'] == t['index']
        for m in self.methods:
            assert m['token'] >> 24 == 6
            for pi in range(m['parameterStart'],m['parameterStart']+m['parameterCount']):
                self.parameter_owner[pi]=m['index']
        assert len(self.field_owner) == len(self.fields)
        assert len(self.parameter_owner) == len(self.parameters)
        self.defaults_by_field = {d['fieldIndex']:d for d in self.defaults}
        self.parameters_defaults_by_index = {d['parameterIndex']:d for d in self.parameter_defaults}
        self.byval_to_typedef = {t['byvalTypeIndex']: t for t in self.types}

    def records(self, name, fmt, keys):
        o, n = self.tables[name]; stride = struct.calcsize(fmt)
        assert n % stride == 0, (name, n, stride)
        result=[]
        for i, values in enumerate(struct.iter_unpack(fmt,self.data[o:o+n])):
            r=dict(zip(keys.split(),values), index=i, fileOffset=o+i*stride)
            if 'nameIndex' in r: r['name'] = self.string(r['nameIndex'])
            result.append(r)
        return result

    def string(self,index):
        if index<0:return None
        o,n=self.tables['string']; assert index<n
        pos=o+index; end=self.data.index(b'\0',pos,o+n)
        return self.data[pos:end].decode('utf-8','replace')

    def literal(self,index):
        o,n=self.tables['stringLiteral']; assert 0<=index<n//8
        length,idx=struct.unpack_from('<II',self.data,o+index*8)
        base,size=self.tables['stringLiteralData']; assert idx+length<=size
        return self.data[base+idx:base+idx+length].decode('utf-8','replace')

    def method_label(self,index):
        m=self.methods[index]; t=self.types[m['declaringType']]
        return t['fullname']+'::'+m['name']

    def fields_of(self,t):
        return self.fields[t['fieldStart']:t['fieldStart']+t['field_count']] if t['field_count'] else []

    def methods_of(self,t):
        return self.methods[t['methodStart']:t['methodStart']+t['method_count']] if t['method_count'] else []

class Reader:
    def __init__(self,data,pos=0,end=None):self.data=data; self.p=pos;self.end=len(data) if end is None else end
    def byte(self):
        assert self.p<self.end
        b=self.data[self.p];self.p+=1;return b
    def leb(self,signed=False,bits=32):
        r=0;s=0
        while True:
            b=self.byte();r|=(b&127)<<s;s+=7
            if not b&128:break
            assert s<bits+7
        if signed and b&64:r-=1<<s
        return r
    def take(self,n):
        assert self.p+n<=self.end
        b=self.data[self.p:self.p+n]; self.p+=n;return b
    def name(self):return self.take(self.leb()).decode('utf-8','replace')
    def limits(self):
        flags=self.leb();minimum=self.leb(); maximum=self.leb() if flags&1 else None
        return {'flags':flags,'min':minimum,'max':maximum}
    def const_expr(self):
        op=self.byte()
        if op in (0x41,0x42):v=self.leb(True,64 if op==0x42 else 32)
        elif op==0x23:v=('global.get',self.leb())
        else:raise ValueError(('unsupported const',hex(op),self.p))
        assert self.byte()==0x0b
        return v

VALTYPES={0x7f:'i32',0x7e:'i64',0x7d:'f32',0x7c:'f64',0x70:'funcref',0x6f:'externref',0x40:'void'}
class Wasm:
    def __init__(self,path=WASM):
        self.data=path.read_bytes();assert self.data[:8]==b'\0asm\x01\0\0\0'
        self.sections=[];self.imports=[];self.exports=[];self.signatures=[];self.func_types=[]
        self.bodies={};self.elements={};self.segments=[];self.globals=[];self.tables=[];self.memories=[]
        self.custom=[];self.start=None;self.imported_funcs=0
        r=Reader(self.data,8)
        while r.p<r.end:
            start=r.p;sid=r.byte();size=r.leb();end=r.p+size
            self.sections.append(dict(id=sid,sectionOffset=start,payloadOffset=r.p,size=size))
            s=Reader(self.data,r.p,end)
            if sid==0:
                self.custom.append({'name':s.name(),'offset':s.p,'length':end-s.p});s.p=end
            elif sid==1:
                for _ in range(s.leb()):
                    assert s.byte()==0x60
                    args=[VALTYPES[s.byte()] for _ in range(s.leb())]
                    ret=[VALTYPES[s.byte()] for _ in range(s.leb())]
                    self.signatures.append({'params':args,'results':ret})
            elif sid==2:
                for _ in range(s.leb()):
                    item=dict(module=s.name(),name=s.name(),kind=s.byte())
                    if item['kind']==0:
                        item['type']=s.leb();item['funcIndex']=self.imported_funcs
                        self.func_types.append(item['type']);self.imported_funcs+=1
                    elif item['kind']==1:item['elementType']=s.byte();item['limits']=s.limits()
                    elif item['kind']==2:item['limits']=s.limits()
                    elif item['kind']==3:item['valueType']=s.byte();item['mutable']=s.byte()
                    elif item['kind']==4:item['attribute']=s.leb();item['type']=s.leb()
                    else:raise ValueError(item)
                    self.imports.append(item)
            elif sid==3:self.func_types.extend(s.leb() for _ in range(s.leb()))
            elif sid==4:
                for _ in range(s.leb()):self.tables.append({'elementType':s.byte(),'limits':s.limits()})
            elif sid==5:
                for _ in range(s.leb()):self.memories.append(s.limits())
            elif sid==6:
                for _ in range(s.leb()):self.globals.append({'type':s.byte(),'mutable':s.byte(),'init':s.const_expr()})
            elif sid==7:
                for _ in range(s.leb()):self.exports.append({'name':s.name(),'kind':s.byte(),'index':s.leb()})
            elif sid==8:self.start=s.leb()
            elif sid==9:
                for _ in range(s.leb()):
                    flag=s.leb();assert flag in (0,2),flag
                    table=s.leb() if flag==2 else 0
                    base=s.const_expr()
                    if flag==2:assert s.byte()==0
                    for j in range(s.leb()):self.elements[base+j]=s.leb()
            elif sid==10:
                for i in range(s.leb()):
                    sz=s.leb(); pos=s.p;s.p+=sz
                    self.bodies[i+self.imported_funcs]={'offset':pos,'size':sz}
            elif sid==11:
                for _ in range(s.leb()):
                    flag=s.leb();assert flag in (0,1,2),flag
                    memory=s.leb() if flag==2 else 0
                    base=s.const_expr() if flag!=1 else None
                    size=s.leb();pos=s.p;s.p+=size
                    self.segments.append({'memory':memory,'address':base,'size':size,'fileOffset':pos})
            elif sid==12:self.data_count=s.leb()
            else:raise ValueError(('section',sid))
            assert s.p==end,(sid,s.p,end)
            r.p=end
        assert len(self.bodies)+self.imported_funcs==len(self.func_types)
        self.memory=bytearray(max(max(d['address']+d['size'] for d in self.segments if isinstance(d['address'],int)), max((m['min']*65536 for m in self.memories),default=0)))
        for d in self.segments:
            if isinstance(d['address'],int):self.memory[d['address']:d['address']+d['size']]=self.data[d['fileOffset']:d['fileOffset']+d['size']]

    def u32(self,a):return struct.unpack_from('<I',self.memory,a)[0]
    def i32(self,a):return struct.unpack_from('<i',self.memory,a)[0]
    def words(self,a,n):return struct.unpack_from('<'+'I'*n,self.memory,a)
    def cstr(self,a):return self.memory[a:self.memory.index(0,a)].decode('utf-8','replace')
    def mem_to_file(self,a):
        for d in self.segments:
            if d['address'] is not None and d['address']<=a<d['address']+d['size']:return d['fileOffset']+a-d['address']
        return None
    def refs(self,value,aligned=True):
        pat=struct.pack('<I',value);start=0;result=[]
        while True:
            start=self.memory.find(pat,start)
            if start<0:break
            if not aligned or start%4==0:result.append(start)
            start+=1
        return result
    def find_bytes(self,pat):
        pos=0;result=[]
        while True:
            pos=self.memory.find(pat,pos)
            if pos<0:return result
            result.append(pos);pos+=1
    def signature(self,func):return self.signatures[self.func_types[func]]
