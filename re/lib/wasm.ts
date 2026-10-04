const VALUE_TYPES: Readonly<Record<number, string>> = {
  0x7f: "i32", 0x7e: "i64", 0x7d: "f32", 0x7c: "f64", 0x7b: "v128", 0x70: "funcref", 0x6f: "externref",
};

export class BinaryReader {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array, public pos = 0, readonly end = bytes.length) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (pos < 0 || end > bytes.length || pos > end) throw new Error("Invalid binary reader bounds");
  }
  byte(): number {
    if (this.pos >= this.end) throw new Error(`Unexpected end at 0x${this.pos.toString(16)}`);
    return this.bytes[this.pos++];
  }
  skip(size: number): void {
    if (!Number.isSafeInteger(size) || size < 0 || this.pos + size > this.end) {
      throw new Error(`Truncated bytes at 0x${this.pos.toString(16)}`);
    }
    this.pos += size;
  }
  u32(): number {
    let value = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      const b = this.byte();
      value += (b & 127) * 2 ** shift;
      if (!(b & 128)) {
        if (value > 0xffffffff) break;
        return value;
      }
    }
    throw new Error(`Invalid u32 LEB at 0x${this.pos.toString(16)}`);
  }
  signed(bits: 32 | 33): number {
    let value = 0;
    for (let shift = 0; shift < bits; shift += 7) {
      const b = this.byte();
      value += (b & 127) * 2 ** shift;
      if (!(b & 128)) {
        if (b & 64) value -= 2 ** (shift + 7);
        if (value < -(2 ** (bits - 1)) || value >= 2 ** (bits - 1)) break;
        return value;
      }
    }
    throw new Error(`Invalid s${bits} LEB at 0x${this.pos.toString(16)}`);
  }
  i64(): bigint {
    let value = 0n;
    for (let shift = 0n; shift < 64n; shift += 7n) {
      const b = this.byte();
      value |= BigInt(b & 127) << shift;
      if (!(b & 128)) {
        if (b & 64) value -= 1n << (shift + 7n);
        if (value < -(1n << 63n) || value >= 1n << 63n) break;
        return value;
      }
    }
    throw new Error(`Invalid s64 LEB at 0x${this.pos.toString(16)}`);
  }
  valueType(): string {
    const code = this.byte();
    const name = VALUE_TYPES[code];
    if (!name) throw new Error(`Unknown value type 0x${code.toString(16)}`);
    return name;
  }
  vectorTypes(): string[] {
    const count = this.u32();
    if (count > this.end - this.pos) throw new Error("Truncated value-type vector");
    return Array.from({ length: count }, () => this.valueType());
  }
}

const OPS: (string | undefined)[] = [];
const add = (start: number, names: string) => names.split(/\s+/).forEach((n, i) => { OPS[start + i] = n; });
Object.assign(OPS, {
  0x00: "unreachable", 0x01: "nop", 0x02: "block", 0x03: "loop", 0x04: "if", 0x05: "else",
  0x0b: "end", 0x0c: "br", 0x0d: "br_if", 0x0e: "br_table", 0x0f: "return", 0x10: "call",
  0x11: "call_indirect", 0x12: "return_call", 0x13: "return_call_indirect",
  0x1a: "drop", 0x1b: "select", 0x1c: "select_t",
  0x20: "local.get", 0x21: "local.set", 0x22: "local.tee", 0x23: "global.get", 0x24: "global.set",
  0x25: "table.get", 0x26: "table.set", 0x3f: "memory.size", 0x40: "memory.grow",
  0x41: "i32.const", 0x42: "i64.const", 0x43: "f32.const", 0x44: "f64.const",
  0xd0: "ref.null", 0xd1: "ref.is_null", 0xd2: "ref.func",
});
add(0x28, `i32.load i64.load f32.load f64.load i32.load8_s i32.load8_u i32.load16_s i32.load16_u
  i64.load8_s i64.load8_u i64.load16_s i64.load16_u i64.load32_s i64.load32_u
  i32.store i64.store f32.store f64.store i32.store8 i32.store16 i64.store8 i64.store16 i64.store32`);
add(0x45, `i32.eqz i32.eq i32.ne i32.lt_s i32.lt_u i32.gt_s i32.gt_u i32.le_s i32.le_u i32.ge_s i32.ge_u
  i64.eqz i64.eq i64.ne i64.lt_s i64.lt_u i64.gt_s i64.gt_u i64.le_s i64.le_u i64.ge_s i64.ge_u
  f32.eq f32.ne f32.lt f32.gt f32.le f32.ge f64.eq f64.ne f64.lt f64.gt f64.le f64.ge
  i32.clz i32.ctz i32.popcnt i32.add i32.sub i32.mul i32.div_s i32.div_u i32.rem_s
  i32.rem_u i32.and i32.or i32.xor i32.shl i32.shr_s i32.shr_u i32.rotl i32.rotr
  i64.clz i64.ctz i64.popcnt i64.add i64.sub i64.mul i64.div_s i64.div_u i64.rem_s
  i64.rem_u i64.and i64.or i64.xor i64.shl i64.shr_s i64.shr_u i64.rotl i64.rotr
  f32.abs f32.neg f32.ceil f32.floor f32.trunc f32.nearest f32.sqrt
  f32.add f32.sub f32.mul f32.div f32.min f32.max f32.copysign
  f64.abs f64.neg f64.ceil f64.floor f64.trunc f64.nearest f64.sqrt
  f64.add f64.sub f64.mul f64.div f64.min f64.max f64.copysign
  i32.wrap_i64 i32.trunc_f32_s i32.trunc_f32_u i32.trunc_f64_s i32.trunc_f64_u
  i64.extend_i32_s i64.extend_i32_u i64.trunc_f32_s i64.trunc_f32_u i64.trunc_f64_s i64.trunc_f64_u
  f32.convert_i32_s f32.convert_i32_u f32.convert_i64_s f32.convert_i64_u f32.demote_f64
  f64.convert_i32_s f64.convert_i32_u f64.convert_i64_s f64.convert_i64_u f64.promote_f32
  i32.reinterpret_f32 i64.reinterpret_f64 f32.reinterpret_i32 f64.reinterpret_i64
  i32.extend8_s i32.extend16_s i64.extend8_s i64.extend16_s i64.extend32_s`);
const FC = `i32.trunc_sat_f32_s i32.trunc_sat_f32_u i32.trunc_sat_f64_s i32.trunc_sat_f64_u
  i64.trunc_sat_f32_s i64.trunc_sat_f32_u i64.trunc_sat_f64_s i64.trunc_sat_f64_u
  memory.init data.drop memory.copy memory.fill table.init elem.drop
  table.copy table.grow table.size table.fill`.split(/\s+/);
const ONE_U32 = new Set([0x0c, 0x0d, 0x10, 0x12, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x3f, 0x40, 0xd2]);

interface Signature { readonly params: readonly string[]; readonly results: readonly string[] }
interface Body { readonly offset: number; readonly size: number }
interface LocalGroup { readonly count: number; readonly type: string }
type Immediate = number | bigint | string;
export interface Instruction {
  readonly offset: number;
  readonly relativeOffset: number;
  readonly size: number;
  readonly opcode: number;
  readonly op: string;
  readonly args: readonly Immediate[];
  readonly depth: number;
  readonly floatBits?: string;
}
export interface DecodeError {
  readonly offset: number;
  readonly relativeOffset: number;
  readonly message: string;
  readonly rawHex: string;
  readonly remainingBytes: number;
}
interface BodyDecode {
  readonly locals: readonly LocalGroup[];
  readonly instructions: readonly Instruction[];
  readonly complete: boolean;
  readonly error?: DecodeError;
}
export interface Disassembly extends BodyDecode {
  readonly funcIndex: number;
  readonly typeIndex: number;
  readonly signature: Signature;
  readonly body: Body | null; // Imports do not have instruction bytes.
  readonly imported: boolean;
}

/** Shared decoder for disassembly, call-graph and i32.const (xref) scans; never byte-pattern matches.
 * No operand/local arrays are allocated in scan mode. Unknown/truncated encodings stop
 * the function and preserve the exact failure offset and a raw, explicitly capped suffix.
 */
export function decodeBody(bytes: Uint8Array, body: Body, capture = true, onCall?: (callee: number) => void,
  onConst?: (value: number, offset: number) => void): BodyDecode {
  const r = new BinaryReader(bytes, body.offset, body.offset + body.size);
  const locals: LocalGroup[] = [];
  const instructions: Instruction[] = [];
  const blocks = [0xff];
  let pos = r.pos;
  try {
    const groups = r.u32();
    if (groups > (r.end - r.pos) / 2) throw new Error("Truncated local declarations");
    let totalLocals = 0;
    for (let i = 0; i < groups; i++) {
      pos = r.pos;
      const count = r.u32();
      const type = r.valueType();
      totalLocals += count;
      if (totalLocals > 0xffffffff) throw new Error("Local count exceeds u32");
      if (capture) locals.push({ count, type });
    }
    while (r.pos < r.end) {
      pos = r.pos;
      const opcode = r.byte();
      let op = OPS[opcode];
      const args: Immediate[] | undefined = capture ? [] : undefined;
      let floatBits: string | undefined;
      const depth = Math.max(0, blocks.length - 1 - (opcode === 0x0b || opcode === 0x05 ? 1 : 0));
      if (opcode === 0xfc) {
        const ext = r.u32();
        op = FC[ext];
        if (!op) throw new Error(`Unknown opcode 0xfc ${ext}`);
        const count = [8, 10, 12, 14].includes(ext) ? 2 : ext >= 9 ? 1 : 0;
        for (let i = 0; i < count; i++) { const v = r.u32(); args?.push(v); }
      } else {
        if (!op) throw new Error(`Unknown opcode 0x${opcode.toString(16)}`);
        if (opcode >= 2 && opcode <= 4) {
          const type = r.signed(33);
          const name = type === -64 ? "void" : type < 0 ? VALUE_TYPES[type & 127] : type;
          if (name === undefined) throw new Error(`Unknown block type ${type}`);
          args?.push(name);
          blocks.push(opcode);
        } else if (ONE_U32.has(opcode)) {
          const value = r.u32();
          args?.push(value);
          if (opcode === 0x10 || opcode === 0x12) onCall?.(value);
        } else if (opcode === 0x11 || opcode === 0x13) {
          const type = r.u32(), table = r.u32();
          args?.push(type, table);
        } else if (opcode === 0x0e) {
          const count = r.u32();
          if (count + 1 > r.end - r.pos) throw new Error("Truncated br_table");
          for (let i = 0; i <= count; i++) { const label = r.u32(); args?.push(label); }
        } else if (opcode === 0x1c) {
          const count = r.u32();
          if (count > r.end - r.pos) throw new Error("Truncated typed select");
          for (let i = 0; i < count; i++) { const type = r.valueType(); args?.push(type); }
        } else if (opcode >= 0x28 && opcode <= 0x3e) {
          const align = r.u32();
          // Multi-memory/memory64 memargs are not MVP. Do not misread their suffix.
          if (align > 32) throw new Error(`Unknown/non-MVP memory alignment encoding ${align}`);
          const offset = r.u32();
          args?.push(align, offset);
        } else if (opcode === 0x41 || opcode === 0xd0) {
          const value = r.signed(opcode === 0x41 ? 32 : 33);
          args?.push(value);
          if (opcode === 0x41) onConst?.(value, pos);
        } else if (opcode === 0x42) {
          const value = r.i64();
          args?.push(value);
        } else if (opcode === 0x43 || opcode === 0x44) {
          const start = r.pos;
          const size = opcode === 0x43 ? 4 : 8;
          r.skip(size);
          if (capture) {
            args!.push(size === 4 ? r.view.getFloat32(start, true) : r.view.getFloat64(start, true));
            const bits = size === 4 ? BigInt(r.view.getUint32(start, true)) : r.view.getBigUint64(start, true);
            floatBits = bits.toString(16).padStart(size * 2, "0");
          }
        }
      }
      if (opcode === 0x05) {
        if (blocks[blocks.length - 1] !== 0x04) throw new Error("else without an unmatched if");
        blocks[blocks.length - 1] = 0x05;
      } else if (opcode === 0x0b) {
        blocks.pop();
        if (blocks.length === 0 && r.pos !== r.end) throw new Error("Bytes after function end");
      }
      if (capture) {
        instructions.push({ offset: pos, relativeOffset: pos - body.offset, size: r.pos - pos, opcode, op, args: args!,
          depth, ...(floatBits ? { floatBits } : {}) });
      }
    }
    if (blocks.length) { pos = r.pos; throw new Error("Missing function end"); }
    return { locals, instructions, complete: true };
  } catch (error) {
    return { locals, instructions, complete: false, error: {
      offset: pos, relativeOffset: pos - body.offset,
      message: error instanceof Error ? error.message : String(error),
      rawHex: Buffer.from(bytes.subarray(pos, Math.min(r.end, pos + 32))).toString("hex"),
      remainingBytes: r.end - pos,
    } };
  }
}

export function instructionText(ins: Instruction): string {
  let args = ins.args.map(value => typeof value === "number" && Object.is(value, -0) ? "-0" : String(value)).join(" ");
  if (ins.opcode >= 0x28 && ins.opcode <= 0x3e) args = `offset=${ins.args[1]} align=${2 ** Number(ins.args[0])}`;
  if (ins.floatBits) {
    const n = Number(ins.args[0]);
    if (Number.isNaN(n)) {
      const bits = BigInt(`0x${ins.floatBits}`), is32 = ins.opcode === 0x43;
      const sign = bits >> (is32 ? 31n : 63n) ? "-" : "";
      args = `${sign}nan:0x${(bits & (is32 ? 0x7fffffn : 0xfffffffffffffn)).toString(16)}`;
    } else if (!Number.isFinite(n)) args = n < 0 ? "-inf" : "inf";
  }
  return ins.op + (args ? ` ${args}` : "");
}

export interface WasmImport {
  readonly module: string;
  readonly name: string;
  readonly kind: number;
  readonly type?: number;
  readonly funcIndex?: number;
}
interface WasmExport { readonly name: string; readonly kind: number; readonly index: number }
interface DataSegment {
  readonly memory: number;
  readonly address: number | null;
  readonly size: number;
  readonly fileOffset: number;
}
interface WasmStructure {
  readonly sections: readonly { readonly id: number; readonly payloadOffset: number; readonly size: number }[];
  readonly imports: readonly WasmImport[];
  readonly exports: readonly WasmExport[];
  readonly memories: readonly { readonly min: number }[];
  readonly dataSegments: readonly DataSegment[];
}

/** Static file image. This class never compiles, instantiates or executes WebAssembly. */
export class WasmImage {
  readonly signatures: Signature[] = [];
  readonly functionTypes: number[] = [];
  readonly bodies: (Body | undefined)[] = [];
  readonly imports = new Map<number, WasmImport>();
  readonly exports = new Map<number, string[]>();
  readonly importedFunctions: number;
  readonly memoryBytes: number;
  private readonly segments: readonly DataSegment[];
  private readonly view: DataView;
  constructor(readonly bytes: Uint8Array, structure: WasmStructure) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (this.view.getUint32(0, true) !== 0x6d736100 || this.view.getUint32(4, true) !== 1) {
      throw new Error("Not a WASM v1 image");
    }
    const sectionReader = new BinaryReader(bytes, 8);
    const sections: { id: number; payloadOffset: number; size: number }[] = [];
    while (sectionReader.pos < sectionReader.end) {
      const id = sectionReader.byte(), size = sectionReader.u32();
      sections.push({ id, payloadOffset: sectionReader.pos, size });
      sectionReader.skip(size);
    }
    if (sections.length !== structure.sections.length || sections.some((s, i) => {
      const t = structure.sections[i];
      return s.id !== t.id || s.payloadOffset !== t.payloadOffset || s.size !== t.size;
    })) throw new Error("WASM sections do not match preserved structure");
    const section = (id: number) => {
      const s = sections.find(s => s.id === id);
      if (!s) throw new Error(`Missing WASM section ${id}`);
      return new BinaryReader(bytes, s.payloadOffset, s.payloadOffset + s.size);
    };
    const exact = (r: BinaryReader) => { if (r.pos !== r.end) throw new Error("Unconsumed section bytes"); };
    const types = section(1), count = types.u32();
    for (let i = 0; i < count; i++) {
      if (types.byte() !== 0x60) throw new Error("Unknown WASM type form (expected function type)");
      this.signatures.push({ params: types.vectorTypes(), results: types.vectorTypes() });
    }
    exact(types);
    for (const imp of structure.imports) {
      if (imp.kind !== 0) continue;
      if (imp.funcIndex !== this.functionTypes.length || imp.type === undefined) {
        throw new Error("Invalid preserved function import");
      }
      this.imports.set(imp.funcIndex, imp);
      this.functionTypes.push(imp.type);
    }
    this.importedFunctions = this.functionTypes.length;
    const functions = section(3), defined = functions.u32();
    for (let i = 0; i < defined; i++) this.functionTypes.push(functions.u32());
    exact(functions);
    if (this.functionTypes.some(t => !this.signatures[t])) throw new Error("Unknown function signature index");
    const code = section(10);
    if (code.u32() !== defined) throw new Error("Function and code counts differ");
    for (let i = 0; i < defined; i++) {
      const size = code.u32();
      this.bodies[i + this.importedFunctions] = { offset: code.pos, size };
      code.skip(size);
    }
    exact(code);
    for (const exp of structure.exports) {
      if (exp.kind !== 0) continue;
      const names = this.exports.get(exp.index) ?? [];
      names.push(exp.name);
      this.exports.set(exp.index, names);
    }
    this.memoryBytes = (structure.memories[0]?.min ?? 0) * 65536;
    this.segments = structure.dataSegments.filter(s => s.memory === 0 && s.address !== null);
    let previousEnd = 0;
    for (const s of this.segments) {
      const address = s.address!;
      const outside = address + s.size > this.memoryBytes || s.fileOffset < 0 || s.fileOffset + s.size > bytes.length;
      if (address < previousEnd || outside) throw new Error("Unsorted/overlapping/out-of-range data segments");
      previousEnd = address + s.size;
    }
  }
  get functionCount(): number { return this.functionTypes.length; }
  assertFunction(f: number): void {
    if (!Number.isInteger(f) || f < 0 || f >= this.functionCount) throw new Error(`Unknown function f${f}`);
  }
  disasm(f: number): Disassembly {
    this.assertFunction(f);
    const typeIndex = this.functionTypes[f], body = this.bodies[f] ?? null;
    return { funcIndex: f, typeIndex, signature: this.signatures[typeIndex], body, imported: !body,
      ...(body ? decodeBody(this.bytes, body) : { locals: [], instructions: [], complete: true }) };
  }
  private segmentAt(address: number): DataSegment | undefined {
    let low = 0, high = this.segments.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.segments[mid].address! <= address) low = mid + 1;
      else high = mid;
    }
    const segment = this.segments[low - 1];
    return segment && address < segment.address! + segment.size ? segment : undefined;
  }
  contains(address: number, size: number): boolean {
    return Number.isSafeInteger(address) && Number.isSafeInteger(size) && size >= 0 && address >= 0
      && address + size <= this.memoryBytes;
  }
  memoryFileOffset(address: number, size = 1): number | undefined {
    const s = this.segmentAt(address);
    return s && address + size <= s.address! + s.size ? s.fileOffset + address - s.address! : undefined;
  }
  u32(address: number): number {
    if (!this.contains(address, 4)) throw new Error(`Unknown initial memory word at 0x${address.toString(16)}`);
    const offset = this.memoryFileOffset(address, 4);
    if (offset !== undefined) return this.view.getUint32(offset, true);
    // Optimized data segments omit zero bytes, sometimes in the middle of a struct.
    // Gaps are confirmed initial zero-fill, not absent runtime observations.
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const p = this.memoryFileOffset(address + i);
      if (p !== undefined) value += this.bytes[p] * 2 ** (8 * i);
    }
    return value;
  }
  i32(address: number): number { return this.u32(address) | 0; }
}
