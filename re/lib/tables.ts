import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FieldRecord, FieldStorage, MethodRecord, ParameterRecord, TypeRecord } from "./index.ts";
import { WasmImage } from "./wasm.ts";

// Version-locked evidence. Files are loaded and SHA-256 checked only when needed.
const TABLES = "re/data/il2cpp/";
const INPUTS = {
  wasm: ["artifacts/extracted/WebGL.wasm", "52b3dc8a49d4a08dc9d2fafe78a35de193df42570dc1088ff5d6e06653390a8f"],
  metadata: ["artifacts/extracted/data/Il2CppData/Metadata/global-metadata.dat",
    "7aa3236f174d32b450594a99a5fb3b1374129b518c2a1fa3185403f9bca4ad03"],
  methods: [`${TABLES}methods.tsv`, "b58111ab36e963242f08fbd5eae03637b653e7185a25def9b81ae00f489ae5f2"],
  types: [`${TABLES}types.tsv`, "c93eba9163e6fad7d261cf9e976976479cd9e107345ebb8b7fafacfb35335570"],
  fields: [`${TABLES}fields.tsv`, "c51b60f7569a118a28ee7ffddb08249cec7d1418016d062b35ff5db41bff9c73"],
  parameters: [`${TABLES}parameters.tsv`, "614021b65b3ecc4d22ad52272df86fe4d71f9dc68ab3c1b76592e74ae9911a9b"],
  elements: [`${TABLES}wasm-elements.tsv`, "73e8b4a9f930adcb7a86c39ae04ea07ef48c0dddb46e541dba6bb4ce85ecec79"],
  structure: [`${TABLES}wasm-structure.json`, "969c18746e54c846431d27e71c44da93813e1a0e185155e06b03c638dde84e8e"],
  registrations: [`${TABLES}registrations.json`, "5e2e9acde4e4604e5b6f374bdf614b77920ac1a5e978dead75771c814f926516"],
} as const;
export type SourceKey = keyof typeof INPUTS;
interface Source { readonly path: string; readonly sha256: string }

const METHOD_COLUMNS = `index image label tokenHex fileOffset declaringType returnType returnTypeName
  returnParameterToken parameterStart parameterCount flags iflags slot tableSlot funcIndex
  bodyOffset bodySize`.split(/\s+/);
const TYPE_COLUMNS = `index image fullname token fileOffset byvalTypeIndex parentIndex parentType flags fieldStart
  field_count methodStart method_count runtimeSizes`.split(/\s+/);
const FIELD_COLUMNS = `index image declaringType declaringTypeName name token fileOffset typeIndex type attributes
  attributeNames offset offsetKind fieldOffsetEntryAddress metadataDefault`.split(/\s+/);
const PARAMETER_COLUMNS = "index methodIndex name token typeIndex type fileOffset".split(" ");
const STORAGE: readonly string[] = ["instance", "static-field-block", "literal/no-storage", "thread-static/special"];
const EMPTY = Object.freeze([]);

// Python csv.writer's tab dialect, including doubled quotes and embedded newlines.
// Yield one row at a time instead of retaining a second copy of the large tables.
export function* tsvRows(text: string): Generator<string[]> {
  let row: string[] = [];
  let start = 0;
  let pos = 0;
  let value = "";
  let quoted = false;
  let afterQuote = false;
  while (pos < text.length) {
    const c = text[pos];
    if (quoted) {
      if (c === '"') {
        value += text.slice(start, pos);
        if (text[pos + 1] === '"') {
          value += '"';
          pos += 2;
          start = pos;
          continue;
        }
        quoted = false;
        afterQuote = true;
        start = pos + 1;
      }
    } else if (c === '"' && pos === start && !afterQuote && !value) {
      quoted = true;
      start = pos + 1;
    } else if (c === "\t" || c === "\n" || c === "\r") {
      row.push(value + text.slice(start, pos));
      value = "";
      afterQuote = false;
      if (c !== "\t") {
        yield row;
        row = [];
        if (c === "\r" && text[pos + 1] === "\n") pos++;
      }
      start = pos + 1;
    } else if (afterQuote) {
      throw new Error(`Invalid TSV character after closing quote at ${pos}`);
    }
    pos++;
  }
  if (quoted) throw new Error("Unterminated quoted TSV field");
  if (row.length || start < text.length || afterQuote) {
    row.push(value + text.slice(start));
    yield row;
  }
}

function* tableRows(text: string, columns: readonly string[]): Generator<string[]> {
  const rows = tsvRows(text);
  const header = rows.next().value as string[] | undefined;
  if (!header || header.join("\t") !== columns.join("\t")) {
    throw new Error(`Unexpected TSV header: ${header?.join(" ")}`);
  }
  let index = 0;
  for (const row of rows) {
    if (row.length !== columns.length) {
      throw new Error(`TSV row ${index}: expected ${columns.length} columns, got ${row.length}`);
    }
    yield row;
    index++;
  }
}

function int(value: string): number {
  if (!/^-?\d+$/.test(value)) throw new Error(`Invalid integer in evidence: ${JSON.stringify(value)}`);
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`Unsafe integer in evidence: ${value}`);
  return n;
}
const optional = (value: string): number | null => value === "" ? null : int(value);

function metadataDefault(text: string): Readonly<Record<string, unknown>> | null {
  if (!text) return null;
  try {
    return JSON.parse(text, (_key, value: unknown) => {
      // Python's historical JSON may contain NaN/Infinity or 64-bit integer literals.
      // Do not silently round integers or reinterpret these non-standard values.
      if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) {
        throw new Error("Integer is not exactly representable in JavaScript");
      }
      return value;
    });
  } catch {
    return { status: "unknown", rawJson: text,
      reason: "Non-standard JSON or unsafe integer in preserved default; retained verbatim" };
  }
}

function append<K, T>(map: Map<K, T[]>, key: K, item: T): void {
  const records = map.get(key);
  if (records) records.push(item);
  else map.set(key, [item]);
}

interface Registration {
  readonly address: number;
  readonly fileOffset: number;
  readonly types: number;
  readonly typesCount: number;
  readonly methodSpecs: number;
  readonly methodSpecsCount: number;
  readonly genericClasses: number;
  readonly genericClassesCount: number;
  readonly genericInsts: number;
  readonly genericInstsCount: number;
}
interface TableElement { readonly slot: number; readonly funcIndex: number; readonly typeIndex: number }

export class EvidenceStore {
  readonly sources: Readonly<Record<SourceKey, Source>>;
  private _wasm?: WasmImage;
  private _registration?: Registration;
  private _methods?: readonly MethodRecord[];
  private _types?: readonly TypeRecord[];
  private _fields?: readonly FieldRecord[];
  private _parameters?: readonly ParameterRecord[];
  private _elements?: ReadonlyMap<number, TableElement>;
  private readonly methodsForFunc = new Map<number, MethodRecord[]>();
  private readonly methodsForSlot = new Map<number, MethodRecord[]>();
  private readonly typesForName = new Map<string, TypeRecord[]>();
  constructor(root: string) {
    this.sources = Object.freeze(Object.fromEntries(Object.entries(INPUTS).map(([key, [path, sha256]]) =>
      [key, Object.freeze({ path: resolve(root, path), sha256 })])) as Record<SourceKey, Source>);
  }
  read(key: SourceKey): Buffer {
    const source = this.sources[key];
    const bytes = readFileSync(source.path);
    const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    if (hash !== source.sha256) {
      throw new Error(`Unknown evidence version: ${source.path}; SHA-256 ${hash}, expected ${source.sha256}`);
    }
    return bytes;
  }
  get wasm(): WasmImage {
    return this._wasm ??= new WasmImage(this.read("wasm"), JSON.parse(this.read("structure").toString("utf8")));
  }
  get registration(): Registration {
    return this._registration ??= JSON.parse(this.read("registrations").toString("utf8")).metadataRegistration;
  }
  get methods(): readonly MethodRecord[] {
    if (this._methods) return this._methods;
    const methods: MethodRecord[] = [];
    for (const r of tableRows(this.read("methods").toString("utf8"), METHOD_COLUMNS)) {
      const m: MethodRecord = {
        index: int(r[0]), image: r[1], label: r[2], tokenHex: r[3], fileOffset: int(r[4]), declaringType: int(r[5]),
        returnType: int(r[6]), returnTypeName: r[7], returnParameterToken: int(r[8]), parameterStart: int(r[9]),
        parameterCount: int(r[10]), flags: int(r[11]), iflags: int(r[12]), slot: int(r[13]), tableSlot: int(r[14]),
        funcIndex: optional(r[15]), bodyOffset: optional(r[16]), bodySize: optional(r[17]),
      };
      if (m.index !== methods.length) throw new Error("Non-contiguous method rows");
      methods.push(m);
      if (m.funcIndex !== null) append(this.methodsForFunc, m.funcIndex, m);
      if (m.tableSlot !== 0) append(this.methodsForSlot, m.tableSlot, m);
    }
    return this._methods = methods;
  }
  methodsByFunc(f: number): readonly MethodRecord[] {
    void this.methods;
    return this.methodsForFunc.get(f) ?? EMPTY;
  }
  methodsBySlot(slot: number): readonly MethodRecord[] {
    void this.methods;
    return this.methodsForSlot.get(slot) ?? EMPTY;
  }
  get types(): readonly TypeRecord[] {
    if (this._types) return this._types;
    const types: TypeRecord[] = [];
    for (const r of tableRows(this.read("types").toString("utf8"), TYPE_COLUMNS)) {
      const t: TypeRecord = {
        index: int(r[0]), image: r[1], fullname: r[2], token: int(r[3]), fileOffset: int(r[4]),
        byvalTypeIndex: int(r[5]), parentIndex: int(r[6]), parentType: r[7], flags: int(r[8]), fieldStart: int(r[9]),
        field_count: int(r[10]), methodStart: int(r[11]), method_count: int(r[12]),
        runtimeSizes: r[13] ? JSON.parse(r[13]) : null,
      };
      if (t.index !== types.length) throw new Error("Non-contiguous type rows");
      types.push(t);
      append(this.typesForName, t.fullname, t);
    }
    return this._types = types;
  }
  findTypes(name: string): readonly TypeRecord[] {
    void this.types;
    return this.typesForName.get(name) ?? this.types.filter(t => t.fullname.toLowerCase().includes(name.toLowerCase()));
  }
  get fields(): readonly FieldRecord[] {
    if (this._fields) return this._fields;
    const fields: FieldRecord[] = [];
    let count = 0;
    for (const r of tableRows(this.read("fields").toString("utf8"), FIELD_COLUMNS)) {
      if (!STORAGE.includes(r[12])) throw new Error(`Unknown field offset kind ${r[12]}`);
      const f: FieldRecord = {
        index: int(r[0]), image: r[1], declaringType: int(r[2]), declaringTypeName: r[3], name: r[4],
        token: int(r[5]), fileOffset: int(r[6]), typeIndex: int(r[7]), type: r[8], attributes: int(r[9]),
        attributeNames: JSON.parse(r[10]), offset: optional(r[11]), offsetKind: r[12] as FieldStorage,
        fieldOffsetEntryAddress: optional(r[13]), metadataDefault: metadataDefault(r[14]),
      };
      // This TSV is emitted in declaring-type order, NOT field-index order.
      if (f.index < 0 || fields[f.index]) throw new Error(`Duplicate/invalid field index ${f.index}`);
      fields[f.index] = f;
      count++;
    }
    if (fields.length !== count) throw new Error("Missing field indices");
    return this._fields = fields;
  }
  get parameters(): readonly ParameterRecord[] {
    if (this._parameters) return this._parameters;
    const parameters: ParameterRecord[] = [];
    for (const r of tableRows(this.read("parameters").toString("utf8"), PARAMETER_COLUMNS)) {
      const p: ParameterRecord = {
        index: int(r[0]), methodIndex: int(r[1]), name: r[2], token: int(r[3]), typeIndex: int(r[4]), type: r[5],
        fileOffset: int(r[6]),
      };
      if (p.index !== parameters.length) throw new Error("Non-contiguous parameter rows");
      parameters.push(p);
    }
    return this._parameters = parameters;
  }
  get elements(): ReadonlyMap<number, TableElement> {
    if (this._elements) return this._elements;
    const elements = new Map<number, TableElement>();
    for (const r of tableRows(this.read("elements").toString("utf8"), ["slot", "function", "typeIndex"])) {
      const e = { slot: int(r[0]), funcIndex: int(r[1]), typeIndex: int(r[2]) };
      if (elements.has(e.slot)) throw new Error(`Duplicate table slot ${e.slot}`);
      elements.set(e.slot, e);
    }
    return this._elements = elements;
  }
}
