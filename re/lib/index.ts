import { resolve } from "node:path";
import { MetadataDecoder } from "./metadata.ts";
import { EvidenceStore, type SourceKey } from "./tables.ts";
import { decodeBody, type DecodeError, type Disassembly, type WasmImport } from "./wasm.ts";

export type { SourceKey };

// All offsets and indices retain their original address space; none are interchangeable.
export interface MethodRecord {
  readonly index: number;
  readonly image: string;
  readonly label: string;
  readonly tokenHex: string;
  readonly fileOffset: number;
  readonly declaringType: number;
  readonly returnType: number;
  readonly returnTypeName: string;
  readonly returnParameterToken: number;
  readonly parameterStart: number;
  readonly parameterCount: number;
  readonly flags: number;
  readonly iflags: number;
  readonly slot: number; // Managed virtual slot, NOT the WASM table slot.
  readonly tableSlot: number;
  readonly funcIndex: number | null;
  readonly bodyOffset: number | null;
  readonly bodySize: number | null;
}

export interface TypeRecord {
  readonly index: number;
  readonly image: string;
  readonly fullname: string;
  readonly token: number;
  readonly fileOffset: number;
  readonly byvalTypeIndex: number;
  readonly parentIndex: number; // Index in metadataRegistration.types, NOT a typedef index.
  readonly parentType: string;
  readonly flags: number;
  readonly fieldStart: number;
  readonly field_count: number;
  readonly methodStart: number;
  readonly method_count: number;
  readonly runtimeSizes: Readonly<Record<string, number>> | null;
}

export type FieldStorage = "instance" | "static-field-block" | "literal/no-storage" | "thread-static/special";
export interface FieldRecord {
  readonly index: number;
  readonly image: string;
  readonly declaringType: number;
  readonly declaringTypeName: string;
  readonly name: string;
  readonly token: number;
  readonly fileOffset: number;
  readonly typeIndex: number;
  readonly type: string;
  readonly attributes: number;
  readonly attributeNames: readonly string[];
  readonly offset: number | null;
  readonly offsetKind: FieldStorage;
  readonly fieldOffsetEntryAddress: number | null;
  readonly metadataDefault: Readonly<Record<string, unknown>> | null;
}

export interface ParameterRecord {
  readonly index: number;
  readonly methodIndex: number;
  readonly name: string;
  readonly token: number;
  readonly typeIndex: number;
  readonly type: string;
  readonly fileOffset: number;
}

type DecodeStatus = "confirmed" | "unknown";
export interface Evidence {
  readonly source: SourceKey;
  readonly detail: string;
  readonly fileOffset?: number; // Physical offset in `source` when it is a binary input.
  readonly metadataFileOffset?: number; // A TSV record's fileOffset refers to global-metadata.dat, not the TSV.
  readonly address?: number;
}

export interface DecodedType {
  readonly status: DecodeStatus;
  readonly address: number;
  readonly raw: readonly number[];
  readonly data?: number;
  readonly bits?: number;
  readonly kind?: number;
  readonly kindName?: string;
  readonly name?: string;
  readonly byref?: boolean;
  readonly typeDefinitionIndex?: number;
  readonly definition?: TypeRecord;
  readonly element?: DecodedType;
  readonly generic?: GenericClass;
  readonly reason?: string;
  readonly evidence: readonly Evidence[];
}

export interface GenericInst {
  readonly status: DecodeStatus;
  readonly address: number;
  readonly count: number;
  readonly argv: number;
  readonly arguments: readonly DecodedType[];
  readonly reason?: string;
  readonly evidence: readonly Evidence[];
}
interface GenericClass {
  readonly address: number;
  readonly raw: readonly number[];
  readonly base: DecodedType;
  readonly classInst?: GenericInst;
  readonly methodInst?: GenericInst;
}

export interface DecodedCell {
  readonly status: DecodeStatus;
  readonly address: number;
  readonly word?: number;
  readonly usage?: number;
  readonly usageName?: string;
  readonly index?: number;
  readonly name?: string;
  readonly type?: DecodedType;
  readonly method?: MethodRecord;
  readonly field?: FieldRecord;
  readonly literal?: string;
  readonly methodSpec?: {
    readonly address: number;
    readonly methodDefinitionIndex: number;
    readonly classIndexIndex: number;
    readonly methodIndexIndex: number;
    readonly classInst?: GenericInst;
    readonly methodInst?: GenericInst;
  };
  readonly fieldRef?: { readonly typeIndex: number; readonly fieldIndex: number; readonly fileOffset: number };
  readonly reason?: string;
  readonly evidence: readonly Evidence[];
}

export interface FunctionIdentity {
  readonly funcIndex: number;
  readonly status: "confirmed" | "non-managed" | "unknown";
  readonly aliases: readonly MethodRecord[];
  readonly aliasCount: number;
  readonly import?: WasmImport;
  readonly exports: readonly string[];
}
export interface SlotInfo extends Omit<FunctionIdentity, "funcIndex"> {
  readonly slot: number;
  readonly funcIndex?: number;
  readonly typeIndex?: number;
  /** Only these rows pin this particular table slot. `aliases` describe the folded body. */
  readonly methods: readonly MethodRecord[];
}
interface FunctionDecodeError extends DecodeError { readonly funcIndex: number }
export interface CallScanStats {
  readonly elapsedMs: number;
  readonly bodiesScanned: number;
  readonly complete: boolean;
  readonly errors: readonly FunctionDecodeError[];
}
export interface CallReport extends CallScanStats { readonly functions: readonly number[] }
interface XrefHit { readonly funcIndex: number; readonly offset: number }
export interface XrefReport extends CallScanStats { readonly address: number; readonly hits: readonly XrefHit[] }
type TypeSelector = string | number | TypeRecord;

/** Cached static readers for one preserved build; no network, client execution or writes.
 * Name queries return ALL exact matches first, otherwise substring matches (row order).
 * Field queries return arrays because names and static/instance offsets can repeat.
 * Declared fields only: inherited layout is not merged, and literal offsets are not storage.
 */
export class ReToolkit {
  private readonly store: EvidenceStore;
  private readonly decoder: MetadataDecoder;
  private readonly disassemblies = new Map<number, Disassembly>();
  private callerIndex?: Map<number, readonly number[]>;
  private callerScan?: CallScanStats;
  constructor(root: string) {
    this.store = new EvidenceStore(root);
    this.decoder = new MetadataDecoder(this.store);
  }
  get sources() { return this.store.sources; }
  methodsBySlot(slot: number): readonly MethodRecord[] { return this.store.methodsBySlot(slot); }
  methodsByFunc(f: number): readonly MethodRecord[] { return this.store.methodsByFunc(f); }
  funcBySlot(slot: number): number | undefined { return this.store.elements.get(slot)?.funcIndex; }
  findMethods(query: string): readonly MethodRecord[] {
    if (/^f\d+$/.test(query)) return this.methodsByFunc(Number(query.slice(1)));
    if (/^slot:\d+$/.test(query)) return this.methodsBySlot(Number(query.slice(5)));
    const q = query.toLowerCase();
    return this.store.methods.filter(m => m.label.toLowerCase().includes(q));
  }
  parameters(m: MethodRecord): readonly ParameterRecord[] {
    if (!m.parameterCount) return [];
    const parameters = this.store.parameters.slice(m.parameterStart, m.parameterStart + m.parameterCount);
    if (parameters.length !== m.parameterCount || parameters.some(p => p.methodIndex !== m.index)) {
      throw new Error(`Parameter owner/range mismatch for methods[${m.index}]`);
    }
    return parameters;
  }
  /** `type:<index>` selects exactly one typedef; other queries match fullnames. */
  type(query: string): readonly TypeRecord[] {
    const index = /^type:(\d+)$/.exec(query)?.[1];
    return index === undefined ? this.store.findTypes(query) : this.typeAt(Number(index));
  }
  private typeAt(index: number): readonly TypeRecord[] {
    const type = this.store.types[index];
    return type ? [type] : [];
  }
  private selectTypes(type: TypeSelector): readonly TypeRecord[] {
    return typeof type === "string" ? this.type(type) : typeof type === "number" ? this.typeAt(type) : [type];
  }
  fieldsOf(type: TypeSelector): readonly FieldRecord[] {
    return this.selectTypes(type).flatMap(t =>
      t.field_count ? this.store.fields.slice(t.fieldStart, t.fieldStart + t.field_count) : []);
  }
  methodsOf(type: TypeSelector): readonly MethodRecord[] {
    return this.selectTypes(type).flatMap(t =>
      t.method_count ? this.store.methods.slice(t.methodStart, t.methodStart + t.method_count) : []);
  }
  fieldAt(type: TypeSelector, offset: number, storage?: FieldStorage): readonly FieldRecord[] {
    return this.fieldsOf(type).filter(f =>
      f.offset === offset && f.offsetKind !== "literal/no-storage" && (!storage || f.offsetKind === storage));
  }
  fieldByName(type: TypeSelector, name: string): readonly FieldRecord[] {
    const fields = this.fieldsOf(type), exact = fields.filter(f => f.name === name);
    return exact.length ? exact : fields.filter(f => f.name.toLowerCase().includes(name.toLowerCase()));
  }
  functionInfo(f: number): FunctionIdentity {
    const w = this.store.wasm;
    if (!Number.isInteger(f) || f < 0 || f >= w.functionCount) {
      return { funcIndex: f, status: "unknown", aliases: [], aliasCount: 0, exports: [] };
    }
    const aliases = this.methodsByFunc(f);
    return { funcIndex: f, status: aliases.length ? "confirmed" : "non-managed", aliases, aliasCount: aliases.length,
      import: w.imports.get(f), exports: w.exports.get(f) ?? [] };
  }
  slot(slot: number): SlotInfo {
    const entry = this.store.elements.get(slot);
    if (!entry) return { slot, status: "unknown", methods: [], aliases: [], aliasCount: 0, exports: [] };
    const identity = this.functionInfo(entry.funcIndex), methods = this.methodsBySlot(slot);
    if (methods.some(m => m.funcIndex !== entry.funcIndex)) {
      throw new Error(`Managed mapping disagrees with element slot ${slot}`);
    }
    // No pinned row is not proof of a native role: shared/generic code can lack a row too.
    return { ...identity, slot, typeIndex: entry.typeIndex, methods,
      status: methods.length ? "confirmed" : "non-managed" };
  }
  resolveFunction(selector: string): number {
    let f: number | undefined;
    if (/^f\d+$/.test(selector)) f = Number(selector.slice(1));
    else if (/^slot:\d+$/.test(selector)) f = this.funcBySlot(Number(selector.slice(5)));
    else throw new Error(`Expected f<index> or slot:<index>, got ${JSON.stringify(selector)}`);
    if (f === undefined) throw new Error(`Unknown ${selector}`);
    this.store.wasm.assertFunction(f);
    return f;
  }
  decodeCell(address: number): DecodedCell { return this.decoder.decodeCell(address); }
  decodeIl2CppType(address: number): DecodedType { return this.decoder.decodeIl2CppType(address); }
  disasm(f: number): Disassembly {
    let decoded = this.disassemblies.get(f);
    if (!decoded) this.disassemblies.set(f, decoded = this.store.wasm.disasm(f));
    return decoded;
  }
  /** Direct call/return_call targets, unique and sorted. Indirect calls stay unresolved. */
  calleesReport(f: number): CallReport {
    const w = this.store.wasm;
    w.assertFunction(f);
    const start = performance.now(), functions = new Set<number>(), body = w.bodies[f];
    const error = body && decodeBody(w.bytes, body, false, callee => functions.add(callee)).error;
    return { functions: [...functions].sort((a, b) => a - b), complete: !error,
      errors: error ? [{ ...error, funcIndex: f }] : [], elapsedMs: performance.now() - start,
      bodiesScanned: body ? 1 : 0 };
  }
  /** The reverse call index is built once from a whole-module scan. */
  callersReport(f: number): CallReport {
    const w = this.store.wasm;
    w.assertFunction(f);
    if (!this.callerIndex) {
      const start = performance.now(), reverse = new Map<number, number[]>(), errors: FunctionDecodeError[] = [];
      const targets = new Set<number>();
      for (let caller = w.importedFunctions; caller < w.functionCount; caller++) {
        targets.clear();
        const { error } = decodeBody(w.bytes, w.bodies[caller]!, false, callee => { targets.add(callee); });
        if (error) errors.push({ ...error, funcIndex: caller });
        for (const target of targets) {
          const callers = reverse.get(target);
          if (callers) callers.push(caller);
          else reverse.set(target, [caller]);
        }
      }
      this.callerIndex = reverse;
      this.callerScan = { elapsedMs: performance.now() - start, bodiesScanned: w.functionCount - w.importedFunctions,
        complete: !errors.length, errors };
    }
    return { ...this.callerScan!, functions: this.callerIndex.get(f) ?? [] };
  }
  /** Every `i32.const <address>` in the module (e.g. a metadata-usage cell), in function order. */
  xrefReport(address: number): XrefReport {
    const w = this.store.wasm, start = performance.now(), target = address | 0;
    const hits: XrefHit[] = [], errors: FunctionDecodeError[] = [];
    for (let f = w.importedFunctions; f < w.functionCount; f++) {
      const { error } = decodeBody(w.bytes, w.bodies[f]!, false, undefined, (value, offset) => {
        if (value === target) hits.push({ funcIndex: f, offset });
      });
      if (error) errors.push({ ...error, funcIndex: f });
    }
    return { address, hits, complete: !errors.length, errors, elapsedMs: performance.now() - start,
      bodiesScanned: w.functionCount - w.importedFunctions };
  }
}

const instances = new Map<string, ReToolkit>();
/** Opening performs no I/O. Each input is read, SHA-256 checked and indexed on first use. */
export function openRe(root = resolve(import.meta.dir, "../..")): ReToolkit {
  const absolute = resolve(root);
  let re = instances.get(absolute);
  if (!re) instances.set(absolute, re = new ReToolkit(absolute));
  return re;
}
