/**
 * Photon GpBinaryV18 (Protocol18) messages of the original client; each WebSocket binary frame is one message.
 * Evidence (WebGL.wasm 52b3dc8a, `bun run re`):
 * - Frame: 0xF3, EgMessageType (type:16167, 0x80 = encrypted), body. TPeer::ReceiveIncomingCommands f149144,
 *   PeerBase::DeserializeMessageAndCallback f149029 (InitResponse reads no body), TPeer::.cctor f149147 (header F3 02),
 *   PeerBase::SerializeOperationToMessage f149027, TPeer::SendPing f149136, ReadPingResult f149146, Ping = 1 f149020.
 * - Bodies: DeserializeOperationRequest/Response f113920/f113921, DeserializeEventData f113916, ReadParameterDictionary
 *   f113918; SerializeOperationRequest f113959, SerializeOperationResponse f113961 (empty debug message is Null),
 *   SerializeEventData f113956, WriteParameterTable f113957.
 * - Values: GpType literals (type:16193). Reader: Read f113879, ReadCustomType f113880, ReadCompressedUInt32/64
 *   f113886/f113887, ReadInt2 f113885, ReadBooleanArray f113891, ReadDictionaryType f113910/f113923,
 *   ReadDictionaryElements f113911, GetDictArrayType f113924, GetAllowedDictionaryKeyTypes f113903,
 *   GetClrArrayType f113904. Writer: Write f113872, GetCodeOfType f113873, WriteCompressedInt32/64 f113930/f113931,
 *   WriteCompressedUInt32/64 f113877/f113939, WriteString f113876, WriteSingle/Double f113932/f113933,
 *   WriteCustomType f113934, WriteDictionaryHeader f113948, WriteArrayType f113967, WriteDictionaryElements f113949,
 *   WriteArrayInArray f113936, WriteBoolArray f113943.
 * Encoding makes the client writer's choices, so every message the client writes decodes and re-encodes to the same
 * bytes; decoding also accepts the other forms the client reader accepts. Operations and events nested as values
 * (GpType 24-26) are not supported. Typed arrays hold the little-endian wire bytes.
 */

/** Protocol18 GpType literals (type:16193). */
const T = {
  Boolean: 2, Byte: 3, Short: 4, Float: 5, Double: 6, String: 7, Null: 8, CompressedInt: 9, CompressedLong: 10,
  Int1: 11, Int1_: 12, Int2: 13, Int2_: 14, L1: 15, L1_: 16, L2: 17, L2_: 18, Custom: 19, Dictionary: 20,
  Hashtable: 21, ObjectArray: 23, OperationRequest: 24, OperationResponse: 25, EventData: 26, BooleanFalse: 27,
  BooleanTrue: 28, ShortZero: 29, IntZero: 30, LongZero: 31, FloatZero: 32, DoubleZero: 33, ByteZero: 34, Array: 64,
  BooleanArray: 66, ByteArray: 67, ShortArray: 68, FloatArray: 69, DoubleArray: 70, StringArray: 71,
  CompressedIntArray: 73, CompressedLongArray: 74, CustomTypeArray: 83, DictionaryArray: 84, HashtableArray: 85,
  CustomTypeSlim: 128,
} as const;

/** EgMessageType literals (type:16167). */
const M = {
  InitResponse: 1, Operation: 2, OperationResponse: 3, Event: 4, InternalOperationRequest: 6,
  InternalOperationResponse: 7,
} as const;

const MAGIC = 0xf3;

/**
 * A Protocol18 value. Plain: null, boolean, string, object[] (array), byte[] (Uint8Array) and short[], int[], long[],
 * float[], double[] (Int16Array, Int32Array, BigInt64Array, Float32Array, Float64Array). Tagged: the scalars, bool[],
 * string[], arrays of arrays, Hashtable(s), Dictionary(-ies) with their header codes, and custom types as raw spans.
 * `bits` keeps the payload of a NaN.
 */
export type Value =
  | null | boolean | string | Value[] | Uint8Array | Int16Array | Int32Array | BigInt64Array | Float32Array
  | Float64Array | { byte: number } | { short: number } | { int: number } | { long: bigint }
  | { float: number; bits?: number } | { double: number; bits?: bigint } | { bools: boolean[] }
  | { strings: string[] } | { arrays: Value[] } | { hashtable: Entries } | { hashtables: Entries[] }
  | { dictionary: Entries; types: number[] } | { dictionaries: Entries[]; types: number[] }
  | { custom: number; bytes: Uint8Array } | { custom: number; items: Uint8Array[] };
export type Entries = [Value, Value][];
export type Params = Map<number, Value>;
export type Message =
  | { kind: 'request'; internal: boolean; code: number; params: Params }
  | { kind: 'response'; internal: boolean; code: number; returnCode: number; debugMessage: string | null;
    params: Params }
  | { kind: 'event'; code: number; params: Params }
  | { kind: 'init' };

export function decodeMessage(bytes: Uint8Array): Message {
  const r = new Reader(bytes);
  if (r.u8() !== MAGIC) fail('Not a Photon message.');
  const message = readBody(r, r.u8());
  if (r.left) fail('Trailing bytes after the Photon message.');
  return message;
}

export function encodeMessage(message: Message): Uint8Array {
  const w = new Writer();
  w.u8(MAGIC);
  switch (message.kind) {
    case 'init':
      w.u8(M.InitResponse);
      break;
    case 'request':
      w.u8(message.internal ? M.InternalOperationRequest : M.Operation);
      w.u8(message.code);
      writeParams(w, message.params);
      break;
    case 'response':
      w.u8(message.internal ? M.InternalOperationResponse : M.OperationResponse);
      w.u8(message.code);
      w.i16(message.returnCode);
      writeValue(w, message.debugMessage || null);
      writeParams(w, message.params);
      break;
    case 'event':
      w.u8(M.Event);
      w.u8(message.code);
      writeParams(w, message.params);
  }
  return Uint8Array.from(w.bytes);
}

function readBody(r: Reader, type: number): Message {
  switch (type) {
    case M.InitResponse: return { kind: 'init' };
    case M.Operation: case M.InternalOperationRequest:
      return { kind: 'request', internal: type === M.InternalOperationRequest, code: r.u8(), params: readParams(r) };
    case M.OperationResponse: case M.InternalOperationResponse: {
      const code = r.u8(), returnCode = r.u16() << 16 >> 16, debug = readValue(r);
      return { kind: 'response', internal: type === M.InternalOperationResponse, code, returnCode,
        debugMessage: typeof debug === 'string' ? debug : null, params: readParams(r) };
    }
    case M.Event: return { kind: 'event', code: r.u8(), params: readParams(r) };
  }
  if (type & 0x80) fail('Encrypted Photon messages are not supported.');
  return fail(`Unsupported Photon message type ${type}.`);
}

function readParams(r: Reader): Params {
  const params: Params = new Map();
  for (let count = r.u8(); count > 0; count--) {
    const key = r.u8();
    if (params.has(key)) fail(`Duplicate Photon parameter ${key}.`);
    params.set(key, readValue(r));
  }
  return params;
}

function writeParams(w: Writer, params: Params): void {
  w.u8(params.size);
  for (const [key, value] of params) {
    w.u8(key);
    writeValue(w, value);
  }
}

function readValue(r: Reader): Value {
  return readPayload(r, r.u8());
}

/** Read f113879: the bytes after a type code, or after a Dictionary header's declared code. */
function readPayload(r: Reader, type: number): Value {
  if (type >= T.CustomTypeSlim && type <= T.CustomTypeSlim + 100) {
    return { custom: type - T.CustomTypeSlim, bytes: r.take(r.u32()).slice() };
  }
  switch (type) {
    case T.Boolean: return r.u8() !== 0;
    case T.Byte: return { byte: r.u8() };
    case T.Short: return { short: r.u16() << 16 >> 16 };
    case T.Float: {
      const view = r.view(4), float = view.getFloat32(0, true);
      return Number.isNaN(float) ? { float, bits: view.getUint32(0, true) } : { float };
    }
    case T.Double: {
      const view = r.view(8), double = view.getFloat64(0, true);
      return Number.isNaN(double) ? { double, bits: view.getBigUint64(0, true) } : { double };
    }
    case T.String: return r.string();
    case T.Null: return null;
    case T.CompressedInt: return { int: unzigzag32(r.u32()) };
    case T.CompressedLong: return { long: unzigzag64(r.u64()) };
    case T.Int1: return { int: r.u8() };
    case T.Int1_: return { int: 0 - r.u8() };
    case T.Int2: return { int: r.u16() };
    case T.Int2_: return { int: 0 - r.u16() };
    case T.L1: return { long: BigInt(r.u8()) };
    case T.L1_: return { long: -BigInt(r.u8()) };
    case T.L2: return { long: BigInt(r.u16()) };
    case T.L2_: return { long: -BigInt(r.u16()) };
    case T.Custom: {
      const custom = r.u8();
      return { custom, bytes: r.take(r.u32()).slice() };
    }
    case T.Dictionary: {
      const types = header(r);
      return { dictionary: readEntries(r, types), types };
    }
    case T.Hashtable: return { hashtable: readEntries(r, [0, 0]) };
    case T.ObjectArray: return list(r, readValue);
    case T.OperationRequest: case T.OperationResponse: case T.EventData:
      return fail(`GpType 0x${type.toString(16)} (operation as a value) is not supported.`);
    case T.BooleanFalse: return false;
    case T.BooleanTrue: return true;
    case T.ShortZero: return { short: 0 };
    case T.IntZero: return { int: 0 };
    case T.LongZero: return { long: 0n };
    case T.FloatZero: return { float: 0 };
    case T.DoubleZero: return { double: 0 };
    case T.ByteZero: return { byte: 0 };
    case T.Array: return { arrays: list(r, readValue) };
    case T.BooleanArray: {
      const count = r.u32(), bits = r.take(Math.ceil(count / 8));
      return { bools: Array.from({ length: count }, (_, i) => (bits[i >> 3] >> (i & 7) & 1) === 1) };
    }
    case T.ByteArray: return r.take(r.u32()).slice();
    case T.ShortArray: return new Int16Array(r.take(r.u32() * 2).slice().buffer);
    case T.FloatArray: return new Float32Array(r.take(r.u32() * 4).slice().buffer);
    case T.DoubleArray: return new Float64Array(r.take(r.u32() * 8).slice().buffer);
    case T.StringArray: return { strings: list(r, r => r.string()) };
    case T.CompressedIntArray: return Int32Array.from(list(r, r => unzigzag32(r.u32())));
    case T.CompressedLongArray: return BigInt64Array.from(list(r, r => unzigzag64(r.u64())));
    case T.CustomTypeArray: {
      const count = r.count(), custom = r.u8();
      return { custom, items: Array.from({ length: count }, () => r.take(r.u32()).slice()) };
    }
    case T.DictionaryArray: {
      const types = header(r);
      return { dictionaries: list(r, r => readEntries(r, types)), types };
    }
    case T.HashtableArray: return { hashtables: list(r, r => readEntries(r, [0, 0])) };
  }
  return fail(`Unknown GpType 0x${type.toString(16)}.`);
}

function writeValue(w: Writer, value: Value): void {
  const type = typeOf(value);
  w.u8(type);
  writePayload(w, type, value);
}

/** GetCodeOfType f113873: the code of the value's type, as a Dictionary header declares it. */
function family(v: Value): number {
  if (v === null) return T.Null;
  if (typeof v === 'boolean') return T.Boolean;
  if (typeof v === 'string') return T.String;
  if (Array.isArray(v)) return T.ObjectArray;
  if (v instanceof Uint8Array) return T.ByteArray;
  if (v instanceof Int16Array) return T.ShortArray;
  if (v instanceof Int32Array) return T.CompressedIntArray;
  if (v instanceof BigInt64Array) return T.CompressedLongArray;
  if (v instanceof Float32Array) return T.FloatArray;
  if (v instanceof Float64Array) return T.DoubleArray;
  if ('custom' in v) return 'items' in v ? T.CustomTypeArray : T.Custom;
  for (const [tag, type] of TAGS) if (tag in v) return type;
  return fail('Not a Photon value.');
}

const TAGS = Object.entries({
  byte: T.Byte, short: T.Short, int: T.CompressedInt, long: T.CompressedLong, float: T.Float, double: T.Double,
  bools: T.BooleanArray, strings: T.StringArray, arrays: T.Array, hashtable: T.Hashtable,
  hashtables: T.HashtableArray, dictionary: T.Dictionary, dictionaries: T.DictionaryArray,
});

/** The code the client writes before a value (Write f113872 with writeType): family() with compact forms. */
function typeOf(v: Value): number {
  if (typeof v === 'boolean') return v ? T.BooleanTrue : T.BooleanFalse;
  if (v === null || typeof v !== 'object' || Array.isArray(v) || ArrayBuffer.isView(v)) return family(v);
  if ('byte' in v) return v.byte === 0 ? T.ByteZero : T.Byte;
  if ('short' in v) return v.short === 0 ? T.ShortZero : T.Short;
  if ('int' in v) return compact(v.int, [T.IntZero, T.Int1, T.Int1_, T.Int2, T.Int2_, T.CompressedInt]);
  if ('long' in v) return compact(Number(v.long), [T.LongZero, T.L1, T.L1_, T.L2, T.L2_, T.CompressedLong]);
  if ('bytes' in v) return range(v.custom, 0, 0xff) < 100 ? T.CustomTypeSlim + v.custom : T.Custom;
  return family(v);
}

/** WriteCompressedInt32/64 f113930/f113931: zero, a signed code with one or two magnitude bytes, else a varint. */
function compact(n: number, [zero, pos1, neg1, pos2, neg2, wide]: number[]): number {
  const magnitude = Math.abs(n);
  if (n === 0) return zero;
  if (magnitude <= 0xff) return n > 0 ? pos1 : neg1;
  return magnitude <= 0xffff ? (n > 0 ? pos2 : neg2) : wide;
}

/** Write f113872 without writeType: `type` is typeOf(v), or a declared header code equal to family(v). */
function writePayload(w: Writer, type: number, v: Value): void {
  if (v === null) return;
  if (typeof v === 'boolean') {
    if (type === T.Boolean) w.u8(v ? 1 : 0);
    return;
  }
  if (typeof v === 'string') return w.string(v);
  if (Array.isArray(v)) return writeList(w, v, writeValue);
  if (v instanceof Uint8Array) {
    w.u32(v.length);
    return w.raw(v);
  }
  if (v instanceof Int32Array) return writeList(w, [...v], (w, n) => w.u32(zigzag32(n)));
  if (v instanceof BigInt64Array) return writeList(w, [...v], (w, n) => w.u64(zigzag64(n)));
  if (ArrayBuffer.isView(v)) {
    w.u32(v.length);
    return w.raw(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  }
  if ('byte' in v) {
    if (type === T.Byte) w.u8(v.byte);
    return;
  }
  if ('short' in v) {
    if (type === T.Short) w.i16(v.short);
    return;
  }
  if ('int' in v) {
    const n = range(v.int, -0x80000000, 0x7fffffff);
    return type === T.CompressedInt ? w.u32(zigzag32(n)) : small(w, type, n);
  }
  if ('long' in v) {
    if (BigInt.asIntN(64, v.long) !== v.long) fail(`Photon long ${v.long} exceeds 64 bits.`);
    return type === T.CompressedLong ? w.u64(zigzag64(v.long)) : small(w, type, Number(v.long));
  }
  if ('float' in v) return w.f32(v.float, v.bits);
  if ('double' in v) return w.f64(v.double, v.bits);
  if ('bools' in v) {
    const { bools } = v;
    w.u32(bools.length);
    for (let i = 0; i < bools.length; i += 8) {
      w.u8(bools.slice(i, i + 8).reduce((byte, bit, j) => bit ? byte | 1 << j : byte, 0));
    }
    return;
  }
  if ('strings' in v) return writeList(w, v.strings, (w, text) => w.string(text));
  if ('arrays' in v) return writeList(w, v.arrays, writeValue);
  if ('hashtable' in v) return writeEntries(w, v.hashtable, [0, 0]);
  if ('hashtables' in v) return writeList(w, v.hashtables, (w, entries) => writeEntries(w, entries, [0, 0]));
  if ('dictionary' in v) {
    writeHeader(w, v.types);
    return writeEntries(w, v.dictionary, v.types);
  }
  if ('dictionaries' in v) {
    const { types } = v;
    writeHeader(w, types);
    return writeList(w, v.dictionaries, (w, entries) => writeEntries(w, entries, types));
  }
  if ('bytes' in v) {
    if (type === T.Custom) w.u8(v.custom);
    w.u32(v.bytes.length);
    return w.raw(v.bytes);
  }
  w.u32(v.items.length);
  w.u8(v.custom);
  for (const item of v.items) {
    w.u32(item.length);
    w.raw(item);
  }
}

/** Int1/Int2/L1/L2 payloads (ReadInt2 f113885): the code carries the sign; zero codes have no payload. */
function small(w: Writer, type: number, n: number): void {
  if (type === T.Int1 || type === T.L1) w.u8(n);
  else if (type === T.Int1_ || type === T.L1_) w.u8(-n);
  else if (type === T.Int2 || type === T.L2) w.u16(n);
  else if (type === T.Int2_ || type === T.L2_) w.u16(-n);
}

// Dictionary header codes the client both writes (WriteDictionaryHeader f113948, WriteArrayType f113967) and reads
// back (ReadDictionaryType f113910/f113923, GetAllowedDictionaryKeyTypes f113903, GetClrArrayType f113904).
const KEY_TYPES = new Set<number>([T.Byte, T.Short, T.Float, T.Double, T.String, T.CompressedInt, T.CompressedLong]);
const ARRAY_TYPES = new Set<number>([T.BooleanArray, T.ByteArray, T.ShortArray, T.FloatArray, T.DoubleArray,
  T.StringArray, T.CompressedIntArray, T.CompressedLongArray, T.HashtableArray]);
const VALUE_TYPES = new Set<number>([...KEY_TYPES, ...ARRAY_TYPES, T.Boolean, T.Hashtable]);

/** Key and value codes (0 = typed elements); value 20 is followed by a nested header, 64 by array codes. */
function header(r: Reader, nested = false): number[] {
  const types = [r.u8(), r.u8()], [key, value] = types;
  if (key && !KEY_TYPES.has(key)) fail(`Dictionary key type ${key} is not readable by the client.`);
  if (value === T.Dictionary) return [...types, ...header(r, true)];
  if (value === T.Array) {
    let element: number;
    do types.push(element = r.u8()); while (element === T.Array);
    if (!ARRAY_TYPES.has(element)) fail(`Dictionary array type ${element} is not readable by the client.`);
  } else if (value && !VALUE_TYPES.has(value) && (nested || value !== T.ObjectArray)) {
    fail(`Dictionary value type ${value} is not readable by the client.`);
  }
  return types;
}

function writeHeader(w: Writer, types: number[]): void {
  const r = new Reader(Uint8Array.from(types));
  header(r);
  if (r.left) fail('Trailing codes after the Dictionary header.');
  for (const type of types) w.u8(type);
}

/** Elements are typed when the header code is 0 or 64, else the declared code's payload (f113911, f113949). */
function readEntries(r: Reader, [key, value]: number[]): Entries {
  const element = (type: number) => type ? readPayload(r, type) : readValue(r);
  const valueType = value === T.Array ? 0 : value;
  return list<[Value, Value]>(r, () => [element(key), element(valueType)]);
}

function writeEntries(w: Writer, entries: Entries, [key, value]: number[]): void {
  const element = (type: number, v: Value) => {
    if (!type) return writeValue(w, v);
    if (family(v) !== type) fail(`Dictionary element does not have its declared type ${type}.`);
    writePayload(w, type, v);
  };
  const valueType = value === T.Array ? 0 : value;
  writeList(w, entries, (_, [k, v]) => {
    element(key, k);
    element(valueType, v);
  });
}

function list<V>(r: Reader, read: (r: Reader) => V): V[] {
  return Array.from({ length: r.count() }, () => read(r));
}

function writeList<V>(w: Writer, items: V[], write: (w: Writer, item: V) => void): void {
  w.u32(items.length);
  for (const item of items) write(w, item);
}

const zigzag32 = (n: number) => (n << 1 ^ n >> 31) >>> 0;
const unzigzag32 = (n: number) => n >>> 1 ^ -(n & 1);
const zigzag64 = (n: bigint) => BigInt.asUintN(64, n << 1n ^ n >> 63n);
const unzigzag64 = (n: bigint) => BigInt.asIntN(64, n >> 1n ^ -(n & 1n));

function range(n: number, min: number, max: number): number {
  return Number.isInteger(n) && n >= min && n <= max ? n : fail(`Photon value ${n} is outside ${min}..${max}.`);
}

function fail(message: string): never {
  throw new Error(message);
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const utf8Encoder = new TextEncoder();

class Reader {
  private readonly bytes: Uint8Array;
  private pos = 0;
  constructor(bytes: Uint8Array) { this.bytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  get left(): number { return this.bytes.length - this.pos; }
  take(n: number): Uint8Array {
    if (n > this.left) fail('Truncated Photon message.');
    return this.bytes.subarray(this.pos, this.pos += n);
  }
  u8(): number { return this.take(1)[0]; }
  u16(): number {
    const [low, high] = this.take(2);
    return low | high << 8;
  }
  view(n: number): DataView {
    const bytes = this.take(n);
    return new DataView(bytes.buffer, bytes.byteOffset, n);
  }
  /** ReadCompressedUInt32 f113886: 7-bit groups, lowest first, at most five bytes. */
  u32(): number {
    for (let value = 0, shift = 0; shift < 35; shift += 7) {
      const byte = this.u8();
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return value <= 0xffffffff ? value : fail('Photon varint exceeds 32 bits.');
    }
    return fail('Photon varint exceeds five bytes.');
  }
  /** ReadCompressedUInt64 f113887: at most ten bytes. */
  u64(): bigint {
    for (let value = 0n, shift = 0n; shift < 70n; shift += 7n) {
      const byte = this.u8();
      value |= BigInt(byte & 0x7f) << shift;
      if (byte < 0x80) return value >> 64n ? fail('Photon varint exceeds 64 bits.') : value;
    }
    return fail('Photon varint exceeds ten bytes.');
  }
  /** A count of elements that take at least one byte each. */
  count(): number {
    const n = this.u32();
    return n > this.left ? fail('Truncated Photon message.') : n;
  }
  string(): string { return utf8Decoder.decode(this.take(this.u32())); }
}

class Writer {
  readonly bytes: number[] = [];
  private readonly scratch = new DataView(new ArrayBuffer(8));
  u8(n: number): void { this.bytes.push(range(n, 0, 0xff)); }
  u16(n: number): void { this.bytes.push(range(n, 0, 0xffff) & 0xff, n >> 8); }
  i16(n: number): void { this.u16(range(n, -0x8000, 0x7fff) & 0xffff); }
  raw(bytes: Uint8Array): void { for (const byte of bytes) this.bytes.push(byte); }
  /** WriteCompressedUInt32 f113877. */
  u32(n: number): void {
    range(n, 0, 0xffffffff);
    for (; n > 0x7f; n = Math.floor(n / 0x80)) this.bytes.push(n % 0x80 | 0x80);
    this.bytes.push(n);
  }
  /** WriteCompressedUInt64 f113939. */
  u64(n: bigint): void {
    for (; n > 0x7fn; n >>= 7n) this.bytes.push(Number(n & 0x7fn) | 0x80);
    this.bytes.push(Number(n));
  }
  f32(value: number, bits?: number): void {
    if (Number.isNaN(value) && bits !== undefined) this.scratch.setUint32(0, range(bits, 0, 0xffffffff), true);
    else this.scratch.setFloat32(0, value, true);
    this.raw(new Uint8Array(this.scratch.buffer, 0, 4));
  }
  f64(value: number, bits?: bigint): void {
    if (Number.isNaN(value) && bits !== undefined) {
      if (BigInt.asUintN(64, bits) !== bits) fail(`NaN bits ${bits} exceed 64 bits.`);
      this.scratch.setBigUint64(0, bits, true);
    } else this.scratch.setFloat64(0, value, true);
    this.raw(new Uint8Array(this.scratch.buffer, 0, 8));
  }
  string(text: string): void {
    const bytes = utf8Encoder.encode(text);
    this.u32(bytes.length);
    this.raw(bytes);
  }
}
