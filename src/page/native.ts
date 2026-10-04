import { runtime, slot } from './symbols';

/** Emscripten module of the original Unity WebGL build (WASM 52b3dc8a…). */
export interface UnityModule {
  HEAPU8: Uint8Array;
  asm: {
    __indirect_function_table: WebAssembly.Table;
    malloc(bytes: number): number;
    free(pointer: number): void;
    stackSave(): number;
    stackRestore(pointer: number): void;
  };
}

export type NativeFunction = (...args: number[]) => number;
export type Native = ReturnType<typeof native>;

export function isUnityModule(module: unknown): module is UnityModule {
  const value = module as Partial<UnityModule> | undefined;
  return value?.HEAPU8 instanceof Uint8Array && value.HEAPU8.byteLength > 0 && !!value.asm?.__indirect_function_table;
}

/** Independent observation section: a failure is reported, not propagated. */
export function sample<T extends object>(read: () => T) {
  try { return { status: 'observed' as const, ...read() }; }
  catch (error) { return { status: 'unavailable' as const, reason: String(error) }; }
}

/** Checks `ready` now and after each 100 ms pause, at most `polls` pauses; exceptions from `ready` propagate. */
export async function waitFor(ready: () => unknown, polls: number) {
  for (let poll = 0; !ready(); poll++) {
    if (poll >= polls) return false;
    await new Promise(done => setTimeout(done, 100));
  }
  return true;
}

/** WASM value types of a native signature: I32 for pointers, ints and bools, F64 for doubles. */
export const I32 = 0x7f, F64 = 0x7c;
/** A signature's parameters: `n` × I32, or the value types in order. */
export type Params = number | readonly number[];
const valueTypes = (params: Params) => typeof params === 'number' ? Array<number>(params).fill(I32) : [...params];

/** Minimal WASM module exporting `bridge` (`params` → i32, or → void) that forwards to `fn`; table-settable. */
export async function bridge(params: Params, fn: NativeFunction, results: 0 | 1 = 1): Promise<NativeFunction> {
  const types = valueTypes(params);
  const type = [1, 0x60, types.length, ...types, results, ...Array(results).fill(I32)];
  const imports = [1, 3, 101, 110, 118, 4, 99, 97, 108, 108, 0, 0];
  const exports = [1, 6, 98, 114, 105, 100, 103, 101, 0, 0];
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, type.length, ...type,
    2, imports.length, ...imports, 7, exports.length, ...exports]);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { call: fn } });
  const exported = instance.exports.bridge as NativeFunction;
  if (exported.length !== types.length) throw new Error('Bridge ABI mismatch.');
  return exported;
}

/**
 * Bounded access to native memory and calls. Reads and writes take a base pointer and a field offset: a null,
 * misaligned or out-of-range base always fails, so a missing object never reads low memory. Every call checks its
 * arity and restores the stack on failure.
 */
export function native(module: UnityModule) {
  const { asm } = module;
  const table = asm.__indirect_function_table;
  const view = () => new DataView(module.HEAPU8.buffer, module.HEAPU8.byteOffset, module.HEAPU8.byteLength);

  /** A usable native address: positive, aligned and inside memory for `size` bytes. */
  function check(at: number, size = 4, alignment = 4) {
    if (!Number.isSafeInteger(at) || at <= 0 || at % alignment || at + size > module.HEAPU8.byteLength) {
      throw new Error(`Invalid native range ${at}+${size}`);
    }
    return at;
  }
  const address = (base: number, offset: number, size: number) => check(check(base) + offset, size, size);
  const u8 = (base: number, offset = 0) => view().getUint8(address(base, offset, 1));
  const u32 = (base: number, offset = 0) => view().getUint32(address(base, offset, 4), true);
  const i32 = (base: number, offset = 0) => view().getInt32(address(base, offset, 4), true);
  const f32 = (base: number, offset = 0) => view().getFloat32(address(base, offset, 4), true);
  const f64 = (base: number, offset = 0) => view().getFloat64(address(base, offset, 8), true);
  const setU32 = (base: number, offset: number, value: number) =>
    view().setUint32(address(base, offset, 4), value, true);
  const setI32 = (base: number, offset: number, value: number) =>
    view().setInt32(address(base, offset, 4), value, true);
  const setF32 = (base: number, offset: number, value: number) =>
    view().setFloat32(address(base, offset, 4), value, true);
  /** Copies `bytes` into native memory at `base + offset`. */
  const write = (base: number, offset: number, bytes: Uint8Array) =>
    module.HEAPU8.set(bytes, check(check(base) + offset, bytes.length, 1));
  /** A copy of `size` bytes of native memory at `base + offset`. */
  const read = (base: number, offset: number, size: number) => {
    const at = check(check(base) + offset, size, 1);
    return module.HEAPU8.slice(at, at + size);
  };
  function bool(base: number, offset = 0) {
    const value = u8(base, offset);
    if (value > 1) throw new Error(`Invalid native bool at ${base}+${offset}: ${value}`);
    return value === 1;
  }

  function call(index: number, ...args: number[]): number {
    const fn = table.get(index) as NativeFunction | null;
    if (typeof fn !== 'function' || fn.length !== args.length) {
      throw new Error(`Unexpected native ABI at slot ${index}`);
    }
    const stack = asm.stackSave();
    try {
      const result = fn(...args);
      if (asm.stackSave() !== stack) throw new Error(`Unbalanced native stack at slot ${index}`);
      return result;
    } catch (error) {
      asm.stackRestore(stack);
      throw error;
    }
  }
  const alive = (object: number) => object !== 0 && call(slot.objectAlive, object, 0) === 1;
  /** `object`, once its class is `klass`. */
  function instance(object: number, klass: number) {
    if (u32(object) !== klass) throw new Error('Native class mismatch.');
    return object;
  }
  /** Virtual call: the object's vtable entry {methodPtr, MethodInfo} for a managed virtual slot. */
  function callVirtual(object: number, vslot: number, ...args: number[]) {
    const entry = u32(object) + runtime.vtable + 8 * vslot;
    return call(u32(entry), object, ...args, u32(entry, 4));
  }

  /** Runs `use` synchronously with `bytes` of zeroed native memory, freed afterwards. */
  function scratch<T>(bytes: number, use: (at: number) => T): T {
    const at = check(asm.malloc(bytes), bytes);
    try {
      module.HEAPU8.fill(0, at, at + bytes);
      return use(at);
    } finally { asm.free(at); }
  }

  /** Managed System.String. */
  function text(at: number, max = 256) {
    const length = u32(at, runtime.stringLength);
    if (length > max) throw new Error(`Native string exceeds ${max} characters.`);
    check(at + runtime.stringChars, length * 2, 2);
    let value = '';
    for (let i = 0; i < length; i++) {
      value += String.fromCharCode(view().getUint16(at + runtime.stringChars + 2 * i, true));
    }
    return value;
  }
  const textOrNull = (at: number, max = 256) => at ? text(at, max) : null;
  /** New managed System.String from ASCII text, through the original Marshal.PtrToStringAnsi. */
  function newString(value: string) {
    if (!/^[\x20-\x7e]*$/.test(value)) throw new Error('Only printable ASCII is supported.');
    return scratch(value.length + 1, bytes => {
      module.HEAPU8.set([...value].map(char => char.charCodeAt(0)), bytes);
      return check(call(slot.stringFromAnsi, bytes, 0));
    });
  }
  function cstring(at: number, max = 128) {
    let value = '';
    for (let i = 0; i < max; i++) {
      const byte = view().getUint8(check(at + i, 1, 1));
      if (!byte) return value;
      value += String.fromCharCode(byte);
    }
    throw new Error('Native C string exceeds its bound.');
  }
  const klassName = (klass: number) => cstring(u32(klass, runtime.klassName));
  const className = (object: number) => klassName(u32(object));
  /** Resolved class of a TypeInfo cell, or 0 while IL2CPP has not initialized it (odd = metadata token). */
  function resolvedClass(cell: number) {
    const klass = u32(cell);
    return klass && !(klass & 1) ? klass : 0;
  }
  /** The static_fields block of a resolved TypeInfo cell's class. */
  function staticFields(cell: number) {
    const klass = resolvedClass(cell);
    if (!klass) throw new Error(`TypeInfo 0x${cell.toString(16)} is not resolved.`);
    return check(u32(klass, runtime.klassStaticFields));
  }
  /** Runs IL2CPP metadata initialization for a usage cell and returns the resolved pointer. */
  function metadata(cell: number) {
    call(slot.initMetadata, cell);
    return check(u32(cell));
  }
  /** Elements of a managed array (bounded). */
  function array(at: number, max = 32) {
    const count = u32(at, runtime.arrayLength);
    if (count > max) throw new Error('Native array exceeds its observation bound.');
    return Array.from({ length: count }, (_, index) => u32(at, runtime.arrayData + 4 * index));
  }
  /** Items of a managed List<T> (bounded). */
  function list(at: number, max = 32) {
    const items = u32(at, runtime.listItems), count = u32(at, runtime.listSize);
    if (count > max) throw new Error('Native list exceeds its observation bound.');
    if (!count) return [];
    if (count > u32(items, runtime.arrayLength)) throw new Error('Native list exceeds its array.');
    return Array.from({ length: count }, (_, index) => u32(items, runtime.arrayData + 4 * index));
  }
  /** Used [key, value] words of a managed Dictionary<int or reference, reference> (bounded). */
  function dictionary(at: number, max = 32) {
    const entries = u32(at, runtime.dictionaryEntries), count = i32(at, runtime.dictionaryCount);
    if (count > max) throw new Error('Native dictionary exceeds its observation bound.');
    const used: [number, number][] = [];
    for (let index = 0; index < count; index++) {
      const entry = entries + runtime.arrayData + runtime.dictionaryEntry * index;
      if (i32(entry) >= 0 && i32(entry, 4) >= -1) used.push([u32(entry, 8), u32(entry, 12)]);
    }
    return used;
  }

  function gcAlloc(object: number) {
    const handle = call(slot.gcHandleAlloc, check(object), 0);
    if (!Number.isInteger(handle) || handle === 0) throw new Error('GCHandle allocation failed.');
    return handle >>> 0;
  }
  const gcFree = (handle: number) => scratch(4, cell => {
    setU32(cell, 0, handle);
    call(slot.gcHandleFree, cell, 0);
  });
  /** Builds a replacement for a table slot now; the returned install swaps it in only if the slot is still original. */
  async function prepareHook(index: number, params: Params, make: (original: NativeFunction) => NativeFunction,
    results: 0 | 1 = 1) {
    const original = table.get(index) as NativeFunction | null;
    if (typeof original !== 'function' || original.length !== valueTypes(params).length) {
      throw new Error(`Unexpected native ABI at slot ${index}`);
    }
    const replacement = await bridge(params, make(original), results);
    return () => {
      if (table.get(index) !== original) throw new Error(`Slot ${index} changed during setup; not overwritten.`);
      table.set(index, replacement);
    };
  }

  return { check, u8, u32, i32, f32, f64, bool, setU32, setI32, setF32, write, read, call, callVirtual, alive, instance,
    scratch, text, textOrNull, newString, klassName, className, resolvedClass, staticFields, metadata, array, list,
    dictionary, gcAlloc, gcFree, prepareHook };
}
