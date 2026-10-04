#!/usr/bin/env python3
"""Offline UnityFS/SerializedFile inventory. No writes outside re/data/assets/inventory.
Uses the system liblz4 through ctypes; no UnityPy or network required.
Binary formats: UnityFS v6+, SerializedFile v17+ as present in supplied files.
"""
import argparse, collections, ctypes, ctypes.util, hashlib, json, struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / 're/data/assets'
OUT = DATA / 'inventory'
CLASSES = {1:'GameObject',2:'Component',4:'Transform',20:'Camera',21:'Material',23:'MeshRenderer',25:'Renderer',28:'Texture2D',33:'MeshFilter',43:'Mesh',48:'Shader',49:'TextAsset',54:'Rigidbody',56:'Collider',64:'MeshCollider',65:'BoxCollider',72:'ComputeShader',74:'AnimationClip',81:'AudioListener',82:'AudioSource',83:'AudioClip',91:'AnimatorController',95:'Animator',104:'RenderSettings',108:'Light',114:'MonoBehaviour',115:'MonoScript',128:'Font',129:'PlayerSettings',135:'SphereCollider',136:'CapsuleCollider',137:'SkinnedMeshRenderer',142:'AssetBundle',147:'ResourceManager',150:'PreloadData',157:'LightmapSettings',196:'NavMeshSettings',213:'Sprite',224:'RectTransform',225:'CanvasGroup',222:'CanvasRenderer',223:'Canvas',28:'Texture2D',29:'OcclusionCullingSettings',41:'OcclusionPortal',45:'Skybox',78:'TagManager',126:'NavMeshProjectSettings',138:'FixedJoint',145:'SpringJoint',146:'ResourceManager',152:'MovieTexture',166:'Sprite',182:'WindZone',198:'ParticleSystem',199:'ParticleSystemRenderer',208:'NavMeshObstacle',220:'LightProbeGroup',221:'AnimatorOverrideController',240:'AudioMixer',241:'AudioMixerController',243:'AudioMixerGroupController',244:'AudioMixerEffectController',271:'SampleClip',290:'AssetBundleManifest',11:'AudioManager',13:'InputManager',19:'Physics2DSettings',30:'GraphicsSettings',55:'PhysicsManager',116:'MonoManager',119:'NewLightmapParameters',141:'BuildSettings',159:'EditorSettings',55:'PhysicsManager',118:'NavMeshAreas',47:'QualitySettings',5:'TimeManager',6:'GlobalGameManager',94:'ScriptMapper',109:'CGProgram',117:'Texture3D',121:'Flare',134:'PhysicMaterial',212:'SpriteRenderer',195:'NavMeshAgent',205:'LODGroup',258:'LightProbes',62:'ComputeBuffer',90:'Avatar',92:'Behaviour',102:'TextMesh',120:'LineRenderer',123:'LensFlare',124:'FlareLayer',161:'Cloth',64:'MeshCollider',218:'Terrain',154:'TerrainCollider',156:'TerrainData'}
class Reader:
    def __init__(self, data, endian='<', pos=0): self.data=data; self.pos=pos; self.e=endian
    def read(self,n):
        if n<0 or self.pos+n>len(self.data): raise ValueError(f'out of range {self.pos}+{n}/{len(self.data)}')
        x=self.data[self.pos:self.pos+n]; self.pos+=n; return x
    def num(self,fmt): return struct.unpack(self.e+fmt,self.read(struct.calcsize(fmt)))[0]
    def i(self): return self.num('i')
    def u(self): return self.num('I')
    def h(self): return self.num('h')
    def H(self): return self.num('H')
    def q(self): return self.num('q')
    def Q(self): return self.num('Q')
    def b(self): return self.num('B')
    def f(self): return self.num('f')
    def align(self,n=4): self.pos=(self.pos+n-1)//n*n
    def cstr(self):
        end=self.data.index(b'\0', self.pos); value=self.data[self.pos:end].decode('utf-8','replace'); self.pos=end+1; return value
    def string(self):
        n=self.i(); value=self.read(n).decode('utf-8','replace'); self.align(); return value
    def pptr(self): return {'m_FileID':self.i(),'m_PathID':self.q()}
    def vec(self,n=3): return [self.f() for _ in range(n)]
    def array(self,fn):
        n=self.i()
        if n<0 or n>10000000: raise ValueError(f'invalid array length {n}')
        return [fn() for _ in range(n)]

def lz4(data,size):
    lib=ctypes.CDLL(ctypes.util.find_library('lz4'))
    lib.LZ4_decompress_safe.argtypes=[ctypes.c_char_p,ctypes.c_void_p,ctypes.c_int,ctypes.c_int]
    lib.LZ4_decompress_safe.restype=ctypes.c_int
    dst=ctypes.create_string_buffer(size)
    result=lib.LZ4_decompress_safe(data,dst,len(data),size)
    if result != size: raise ValueError(f'LZ4 result {result}, expected {size}')
    return dst.raw

def decompress(data,size,flag):
    mode=flag&63
    if mode==0:
        if len(data)!=size: raise ValueError('uncompressed size mismatch')
        return data
    if mode in (2,3): return lz4(data,size)
    raise NotImplementedError(f'compression {mode}')

class Bundle:
    def __init__(self,path):
        self.path=Path(path); raw=self.path.read_bytes(); r=Reader(raw,'>')
        magic=r.cstr(); assert magic=='UnityFS',magic
        version=r.u(); generation=r.cstr(); revision=r.cstr(); total=r.Q(); ci=r.u(); ui=r.u(); flags=r.u()
        if version>=7: r.align(16)
        block_info_pos=len(raw)-ci if flags&128 else r.pos
        info=Reader(decompress(raw[block_info_pos:block_info_pos+ci],ui,flags),'>'); info_hash=info.read(16).hex()
        blocks=info.array(lambda:{'uncompressed_size':info.u(),'compressed_size':info.u(),'flags':info.H()})
        nodes=info.array(lambda:{'offset':info.Q(),'size':info.Q(),'flags':info.u(),'name':info.cstr()})
        if flags&128: data_pos=r.pos
        else: data_pos=block_info_pos+ci
        if flags&512: data_pos=(data_pos+15)//16*16
        chunks=[]; cursor=data_pos
        for block in blocks:
            comp=raw[cursor:cursor+block['compressed_size']]; cursor+=block['compressed_size']
            chunks.append(decompress(comp,block['uncompressed_size'],block['flags']))
        stream=b''.join(chunks)
        self.files={node['name']:stream[node['offset']:node['offset']+node['size']] for node in nodes}
        self.meta={'container':str(self.path.relative_to(ROOT)),'sha256':hashlib.sha256(raw).hexdigest(),'signature':magic,'format_version':version,'generation':generation,'unity_revision':revision,'declared_size':total,'actual_size':len(raw),'flags':flags,'block_info_hash':info_hash,'blocks':blocks,'nodes':nodes,'decompressed_stream_size':len(stream)}

class Serialized:
    def __init__(self,name,data,container):
        self.name=name; self.data=data; self.container=container; r=Reader(data,'>')
        metadata_size=r.u(); size=r.u(); version=r.u(); offset=r.u()
        endian=r.b(); r.read(3)
        if version>=22:
            metadata_size=r.u(); size=r.Q(); offset=r.Q(); unknown=r.Q()
        if version<17: raise NotImplementedError(f'serialized v{version}')
        r.e='>' if endian else '<'; self.e=r.e; self.version=version; self.offset=offset
        unity=r.cstr(); platform=r.i(); trees=r.b(); self.tree_enabled=trees
        self.types=[]
        ntypes=r.i()
        for _ in range(ntypes): self.types.append(self.read_type(r,False))
        self.objects=[]
        nobjects=r.i()
        for _ in range(nobjects):
            r.align(); path_id=r.q(); byte_start=r.Q() if version>=22 else r.u(); byte_size=r.u(); type_index=r.i()
            t=self.types[type_index]
            self.objects.append({'path_id':path_id,'byte_start':offset+byte_start,'byte_size':byte_size,'type_index':type_index,'class_id':t['class_id'],'type':CLASSES.get(t['class_id'],str(t['class_id']))})
        self.by_id={o['path_id']:o for o in self.objects}
        self.script_types=r.array(lambda:{'file_index':r.i(),'path_id':(r.align() or r.q())})
        self.externals=r.array(lambda:{'empty':r.cstr(),'guid':r.read(16).hex(),'type':r.i(),'path':r.cstr()})
        self.ref_types=[]
        if version>=20:
            n=r.i()
            for _ in range(n): self.ref_types.append(self.read_type(r,True))
        user=r.cstr()
        self.meta={'container':container,'serialized':name,'version':version,'unity_version':unity,'platform':platform,'has_type_trees':bool(trees),'metadata_size':metadata_size,'file_size':size,'actual_size':len(data),'data_offset':offset,'metadata_read_end':r.pos,'type_count':ntypes,'object_count':nobjects,'type_counts':dict(collections.Counter(o['type'] for o in self.objects)),'types':self.types,'script_types':self.script_types,'externals':self.externals,'reference_types':self.ref_types,'user_information':user}
    def read_type(self,r,ref):
        t={'class_id':r.i(),'is_stripped':r.b(),'script_type_index':r.h()}
        if (ref and t['script_type_index']>=0) or (not ref and t['class_id']==114): t['script_id']=r.read(16).hex()
        t['old_type_hash']=r.read(16).hex()
        if self.tree_enabled:
            node_count=r.i(); string_size=r.i(); nodes=[]
            for _ in range(node_count):
                node={'version':r.H(),'level':r.b(),'type_flags':r.b(),'type_offset':r.u(),'name_offset':r.u(),'byte_size':r.i(),'index':r.i(),'meta_flag':r.i()}
                if self.version>=19: node['ref_type_hash']=r.Q()
                nodes.append(node)
            strings=r.read(string_size)
            for node in nodes:
                for field in ('type','name'):
                    off=node[field+'_offset']
                    if off&0x80000000: node[field]=COMMON.get(off&0x7fffffff,f'<common:{off&0x7fffffff}>')
                    else: node[field]=strings[off:strings.find(b'\0',off)].decode('utf-8','replace')
            t['nodes']=nodes
            if self.version>=21:
                if ref: t.update({'class_name':r.cstr(),'namespace':r.cstr(),'assembly_name':r.cstr()})
                else: t['dependencies']=r.array(r.i)
        return t
    def reader(self,obj): return Reader(self.data[obj['byte_start']:obj['byte_start']+obj['byte_size']],self.e)
    def raw(self,obj): return self.data[obj['byte_start']:obj['byte_start']+obj['byte_size']]

# Offsets from Unity's built-in type-tree string table. Unknown offsets remain explicit.
COMMON={0:'AABB',5:'AnimationClip',19:'AnimationCurve',34:'AnimationState',49:'Array',55:'Base',60:'BitField',69:'bitset',76:'bool',81:'char',86:'ColorRGBA',96:'Component',106:'data',111:'deque',117:'double',124:'dynamic_array',138:'FastPropertyName',155:'first',161:'float',167:'Font',172:'GameObject',183:'Generic Mono',196:'GradientNEW',208:'GUID',213:'GUIStyle',222:'int',226:'list',231:'long long',241:'map',245:'Matrix4x4f',256:'MdFour',263:'MonoBehaviour',277:'MonoScript',288:'m_ByteSize',299:'m_Curve',307:'m_EditorClassIdentifier',331:'m_EditorHideFlags',349:'m_Enabled',359:'m_ExtensionPtr',374:'m_GameObject',387:'m_Index',395:'m_IsArray',405:'m_IsStatic',416:'m_MetaFlag',427:'m_Name',434:'m_ObjectHideFlags',452:'m_PrefabInternal',469:'m_PrefabParentObject',490:'m_Script',499:'m_StaticEditorFlags',519:'m_Type',526:'m_Version',536:'Object',543:'pair',548:'PPtr<Component>',564:'PPtr<GameObject>',581:'PPtr<Material>',596:'PPtr<MonoBehaviour>',616:'PPtr<MonoScript>',633:'PPtr<Object>',646:'PPtr<Prefab>',659:'PPtr<Sprite>',672:'PPtr<TextAsset>',688:'PPtr<Texture>',702:'PPtr<Texture2D>',718:'PPtr<Transform>',734:'Prefab',741:'Quaternionf',753:'Rectf',759:'RectInt',767:'RectOffset',778:'second',785:'set',789:'short',795:'size',800:'SInt16',807:'SInt32',814:'SInt64',821:'SInt8',827:'staticvector',840:'string',847:'TextAsset',857:'TextMesh',866:'Texture',874:'Texture2D',884:'Transform',894:'TypelessData',907:'UInt16',914:'UInt32',921:'UInt64',928:'UInt8',934:'unsigned int',947:'unsigned long long',966:'unsigned short',981:'vector',988:'Vector2f',997:'Vector3f',1006:'Vector4f',1015:'m_ScriptingClassIdentifier',1041:'Gradient',1050:'Type*',1056:'int2_storage',1069:'int3_storage',1082:'BoundsInt',1092:'m_CorrespondingSourceObject',1119:'m_PrefabInstance',1136:'m_PrefabAsset',1150:'FileSize',1159:'Hash128'}

def dump(path,obj): path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
def inputs():
    yield ROOT/'artifacts/extracted/data/data.unity3d'
    yield from sorted((ROOT/'artifacts/original/referenced-assets/bundles').glob('*.bundle'))

def load_all():
    bundles=[]; assets=[]; errors=[]
    for path in inputs():
        bundle=Bundle(path); bundles.append(bundle.meta)
        for name,data in bundle.files.items():
            if name.endswith(('.resS','.resource')): continue
            try:
                asset=Serialized(name,data,bundle.meta['container']); assets.append(asset)
            except Exception as exc: errors.append({'container':bundle.meta['container'],'node':name,'error':str(exc),'first_bytes':data[:64].hex()})
    # Also inventory built-in resources, available as a standalone serialized file.
    p=ROOT/'artifacts/extracted/data/Resources/unity_default_resources'
    if p.exists():
        try: assets.append(Serialized(p.name,p.read_bytes(),str(p.relative_to(ROOT))))
        except Exception as exc: errors.append({'container':str(p.relative_to(ROOT)),'error':str(exc)})
    return bundles,assets,errors

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    bundles,assets,errors=load_all()
    dump(OUT/'unityfs-inventory.json',bundles)
    dump(OUT/'serialized-inventory.json',[a.meta for a in assets])
    dump(OUT/'parse-errors.json',errors)
    with (OUT/'objects.jsonl').open('w') as f:
        for a in assets:
            for o in a.objects: f.write(json.dumps({'container':a.container,'serialized':a.name,**o})+'\n')
    print(json.dumps({'bundles':len(bundles),'serialized':len(assets),'objects':sum(len(a.objects) for a in assets),'errors':errors,'files':[{'name':a.name,'objects':len(a.objects),'trees':a.tree_enabled} for a in assets]},indent=2))

if __name__=='__main__': main()
