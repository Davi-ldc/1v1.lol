#!/usr/bin/env python3
"""Strict static instruction decoder for the opcodes encountered in target bodies.
Stops on unknown opcodes (never silently guesses instruction boundaries).
Text is annotated disassembly, not a round-trippable WAT module.
"""
import struct
from static_il2cpp import Reader, VALTYPES

OP={0x00:'unreachable',0x01:'nop',0x02:'block',0x03:'loop',0x04:'if',0x05:'else',
    0x0b:'end',0x0c:'br',0x0d:'br_if',0x0e:'br_table',0x0f:'return',0x10:'call',
    0x11:'call_indirect',0x12:'return_call',0x13:'return_call_indirect',0x1a:'drop',
    0x1b:'select',0x1c:'select_t',0x20:'local.get',0x21:'local.set',0x22:'local.tee',
    0x23:'global.get',0x24:'global.set',0x25:'table.get',0x26:'table.set'}
for i,n in enumerate(('i32.load i64.load f32.load f64.load i32.load8_s i32.load8_u '
 'i32.load16_s i32.load16_u i64.load8_s i64.load8_u i64.load16_s i64.load16_u '
 'i64.load32_s i64.load32_u i32.store i64.store f32.store f64.store i32.store8 '
 'i32.store16 i64.store8 i64.store16 i64.store32').split(),0x28):OP[i]=n
OP.update({0x3f:'memory.size',0x40:'memory.grow',0x41:'i32.const',0x42:'i64.const',0x43:'f32.const',0x44:'f64.const'})
for i,n in enumerate(('i32.eqz i32.eq i32.ne i32.lt_s i32.lt_u i32.gt_s i32.gt_u i32.le_s i32.le_u i32.ge_s i32.ge_u '
 'i64.eqz i64.eq i64.ne i64.lt_s i64.lt_u i64.gt_s i64.gt_u i64.le_s i64.le_u i64.ge_s i64.ge_u '
 'f32.eq f32.ne f32.lt f32.gt f32.le f32.ge f64.eq f64.ne f64.lt f64.gt f64.le f64.ge '
 'i32.clz i32.ctz i32.popcnt i32.add i32.sub i32.mul i32.div_s i32.div_u i32.rem_s i32.rem_u i32.and i32.or i32.xor i32.shl i32.shr_s i32.shr_u i32.rotl i32.rotr '
 'i64.clz i64.ctz i64.popcnt i64.add i64.sub i64.mul i64.div_s i64.div_u i64.rem_s i64.rem_u i64.and i64.or i64.xor i64.shl i64.shr_s i64.shr_u i64.rotl i64.rotr '
 'f32.abs f32.neg f32.ceil f32.floor f32.trunc f32.nearest f32.sqrt f32.add f32.sub f32.mul f32.div f32.min f32.max f32.copysign '
 'f64.abs f64.neg f64.ceil f64.floor f64.trunc f64.nearest f64.sqrt f64.add f64.sub f64.mul f64.div f64.min f64.max f64.copysign '
 'i32.wrap_i64 i32.trunc_f32_s i32.trunc_f32_u i32.trunc_f64_s i32.trunc_f64_u '
 'i64.extend_i32_s i64.extend_i32_u i64.trunc_f32_s i64.trunc_f32_u i64.trunc_f64_s i64.trunc_f64_u '
 'f32.convert_i32_s f32.convert_i32_u f32.convert_i64_s f32.convert_i64_u f32.demote_f64 '
 'f64.convert_i32_s f64.convert_i32_u f64.convert_i64_s f64.convert_i64_u f64.promote_f32 '
 'i32.reinterpret_f32 i64.reinterpret_f64 f32.reinterpret_i32 f64.reinterpret_i64 '
 'i32.extend8_s i32.extend16_s i64.extend8_s i64.extend16_s i64.extend32_s').split(),0x45):OP[i]=n
OP.update({0xd0:'ref.null',0xd1:'ref.is_null',0xd2:'ref.func'})
FC={0:'i32.trunc_sat_f32_s',1:'i32.trunc_sat_f32_u',2:'i32.trunc_sat_f64_s',3:'i32.trunc_sat_f64_u',
 4:'i64.trunc_sat_f32_s',5:'i64.trunc_sat_f32_u',6:'i64.trunc_sat_f64_s',7:'i64.trunc_sat_f64_u',
 8:'memory.init',9:'data.drop',10:'memory.copy',11:'memory.fill',12:'table.init',13:'elem.drop',
 14:'table.copy',15:'table.grow',16:'table.size',17:'table.fill'}

def decode(w,func):
    body=w.bodies[func]; r=Reader(w.data,body['offset'],body['offset']+body['size'])
    locals_=[]
    for _ in range(r.leb()):
        count=r.leb();ty=VALTYPES[r.byte()];locals_.append((count,ty))
    instructions=[];depth=0
    while r.p<r.end:
        pos=r.p;op=r.byte();args=[]
        if op==0xfc:
            ext=r.leb();name=FC[ext]
            count=2 if ext in (8,10,12,14) else 1 if ext>=9 else 0
            args=[r.leb() for _ in range(count)]
        else:
            if op not in OP:raise ValueError(('unknown opcode',func,hex(pos),hex(op)))
            name=OP[op]
            if op in (2,3,4):
                val=r.leb(True,33);args=[VALTYPES.get(val&127,val) if val<0 else val]
            elif op in (0x0c,0x0d,0x10,0x12,0x20,0x21,0x22,0x23,0x24,0x25,0x26,0x3f,0x40,0xd2):args=[r.leb()]
            elif op in (0x11,0x13):args=[r.leb(),r.leb()]
            elif op==0x0e:args=[r.leb() for _ in range(r.leb()+1)]
            elif op==0x1c:args=[VALTYPES[r.byte()] for _ in range(r.leb())]
            elif 0x28<=op<=0x3e:args=[r.leb(),r.leb()]
            elif op in (0x41,0x42):args=[r.leb(True,64 if op==0x42 else 32)]
            elif op==0x43:args=[struct.unpack('<f',r.take(4))[0]]
            elif op==0x44:args=[struct.unpack('<d',r.take(8))[0]]
            elif op==0xd0:args=[r.leb(True,33)]
        if op in (0x0b,0x05):depth-=1
        instructions.append({'offset':pos,'relativeOffset':pos-body['offset'],'op':name,'args':args,'depth':max(0,depth),'size':r.p-pos})
        if op in (0x02,0x03,0x04,0x05):depth+=1
    assert instructions[-1]['op']=='end' and depth==-1,(func,depth)
    return {'funcIndex':func,'body':body,'signature':w.signature(func),'locals':locals_,'instructions':instructions}

def render(decoded,labels=None,annotation=None):
    labels=labels or {};func=decoded['funcIndex'];body=decoded['body']
    lines=[f';; function {func}: '+ ' | '.join(labels.get(func,[])),
       f';; file body offset 0x{body["offset"]:x} ({body["offset"]}); size {body["size"]} bytes',
       f';; signature {decoded["signature"]}', f';; additional local groups {decoded["locals"]}']
    for ins in decoded['instructions']:
        op=ins['op'];args=ins['args'];detail=' '.join(str(x) for x in args)
        if '.load' in op or '.store' in op:detail=f'offset={args[1]} align={1<<args[0]}'
        comment=''
        if op in ('call','return_call'):
            comment=' | '.join(labels.get(args[0],[]))
        if op in ('call_indirect','return_call_indirect'):comment=f'type index {args[0]}; target runtime table expression, not resolved by name'
        if annotation:
            extra=annotation(ins)
            if extra:comment+=(('; ' if comment else '')+extra)
        line=f'{ins["offset"]:08x} +{ins["relativeOffset"]:04x}  '+ '  '*ins['depth']+op+(' '+detail if detail else '')
        if comment:line+=' ;; '+comment
        lines.append(line)
    return '\n'.join(lines)+'\n'
