import type { DecodedCell, DecodedType, Evidence, GenericInst, MethodRecord } from "./index.ts";
import type { EvidenceStore } from "./tables.ts";

const PRIMITIVES: Readonly<Record<number, string>> = {
  1: "void", 2: "bool", 3: "char", 4: "sbyte", 5: "byte", 6: "short", 7: "ushort", 8: "int", 9: "uint",
  10: "long", 11: "ulong", 12: "float", 13: "double", 14: "string", 24: "nint", 25: "nuint", 28: "object",
};
const KIND_NAMES: Readonly<Record<number, string>> = {
  0x0f: "PTR", 0x10: "BYREF", 0x11: "VALUETYPE", 0x12: "CLASS", 0x13: "VAR", 0x14: "ARRAY", 0x15: "GENERICINST",
  0x1b: "FNPTR", 0x1d: "SZARRAY", 0x1e: "MVAR",
};
const USAGES = ["unknown", "TypeInfo", "Il2CppType", "MethodDef", "FieldInfo", "StringLiteral", "MethodRef"] as const;
const TABLE_NAMES = `stringLiteral stringLiteralData string events properties methods parameterDefaultValues
  fieldDefaultValues fieldAndParameterDefaultValueData fieldMarshaledSizes parameters fields genericParameters
  genericParameterConstraints genericContainers nestedTypes interfaces vtableMethods interfaceOffsets typeDefinitions
  images assemblies fieldRefs referencedAssemblies attributeData attributeDataRange unresolvedIndirectCallParameterTypes
  unresolvedIndirectCallParameterRanges windowsRuntimeTypeNames windowsRuntimeStrings
  exportedTypeDefinitions`.split(/\s+/);

class MetadataFile {
  readonly tables = new Map<string, { offset: number; size: number }>();
  readonly view: DataView;
  constructor(readonly bytes: Buffer) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (this.view.getUint32(0, true) !== 0xfab11baf || this.view.getUint32(4, true) !== 31) {
      throw new Error("Unknown metadata format; expected IL2CPP v31");
    }
    for (let i = 0; i < TABLE_NAMES.length; i++) {
      const offset = this.view.getUint32(8 + i * 8, true), size = this.view.getUint32(12 + i * 8, true);
      if (offset + size > bytes.length) throw new Error(`Out-of-bounds metadata table ${TABLE_NAMES[i]}`);
      this.tables.set(TABLE_NAMES[i], { offset, size });
    }
  }
  record(table: string, index: number, stride: number): number {
    const t = this.tables.get(table);
    if (!t || t.size % stride || !Number.isInteger(index) || index < 0 || index >= t.size / stride) {
      throw new Error(`Unknown ${table}[${index}]`);
    }
    return t.offset + index * stride;
  }
}

/** Initial, registration-backed metadata only. This does not claim runtime resolution.
 * Layout evidence: preserved static_il2cpp.py (metadata v31 tables) and recover.py
 * type_info/type_at (Il2CppType, GenericClass, GenericInst, SZARRAY, byref bit).
 * Unsupported kinds and cycles retain raw words and an explicit unknown status.
 */
export class MetadataDecoder {
  private _metadata?: MetadataFile;
  private _typePointers?: Set<number>;
  private _classPointers?: Set<number>;
  private _instPointers?: Set<number>;
  private readonly typeCache = new Map<number, DecodedType>();
  private readonly cellCache = new Map<number, DecodedCell>();
  constructor(private readonly store: EvidenceStore) {}
  private get metadata(): MetadataFile { return this._metadata ??= new MetadataFile(this.store.read("metadata")); }
  private pointerSet(address: number, count: number): Set<number> {
    const w = this.store.wasm;
    if (!w.contains(address, count * 4)) throw new Error("Registration pointer array outside initial memory");
    const pointers = new Set<number>();
    for (let i = 0; i < count; i++) pointers.add(w.u32(address + i * 4));
    return pointers;
  }
  private get typePointers(): Set<number> {
    const r = this.store.registration;
    return this._typePointers ??= this.pointerSet(r.types, r.typesCount);
  }
  private get classPointers(): Set<number> {
    const r = this.store.registration;
    return this._classPointers ??= this.pointerSet(r.genericClasses, r.genericClassesCount);
  }
  private get instPointers(): Set<number> {
    const r = this.store.registration;
    return this._instPointers ??= this.pointerSet(r.genericInsts, r.genericInstsCount);
  }
  private memoryEvidence(address: number, detail: string, size = 4): Evidence {
    return { source: "wasm", address, fileOffset: this.store.wasm.memoryFileOffset(address, size), detail };
  }
  private registrationEvidence(detail: string): Evidence {
    return { source: "registrations", detail: `metadataRegistration.${detail}` };
  }
  decodeIl2CppType(address: number): DecodedType { return this.typeAt(address, new Set()); }
  private typeAt(address: number, seen: ReadonlySet<number>): DecodedType {
    const cached = this.typeCache.get(address);
    if (cached) return cached;
    const w = this.store.wasm;
    const evidence: Evidence[] = [];
    if (!w.contains(address, 8)) {
      return { status: "unknown", address, raw: [], reason: "Il2CppType address outside initial memory", evidence };
    }
    const data = w.u32(address), bits = w.u32(address + 4), kind = (bits >>> 16) & 255;
    const raw = [data, bits], byref = !!(bits & 0x20000000);
    evidence.push(this.memoryEvidence(address, "Il2CppType.data u32; bits u32 (+4), kind=(bits>>>16)&0xff", 8));
    const kindName = KIND_NAMES[kind] ?? PRIMITIVES[kind] ?? "unknown";
    const base = { address, raw, data, bits, kind, kindName, byref, evidence };
    const unknown = (reason: string): DecodedType => ({ ...base, status: "unknown", reason });
    if (!this.typePointers.has(address)) {
      return unknown("Not a registered Il2CppType pointer; plausible bits alone are not identity evidence");
    }
    evidence.push(this.registrationEvidence("types[] contains this pointer"));
    if (seen.has(address) || seen.size >= 32) return unknown("Recursive/depth-limited Il2CppType; not expanded");
    const next = new Set(seen).add(address);
    const suffix = byref ? "&" : "";
    let result: DecodedType;
    try {
      if (PRIMITIVES[kind]) {
        result = { ...base, status: "confirmed", name: PRIMITIVES[kind] + suffix };
      } else if (kind === 0x11 || kind === 0x12) {
        const definition = this.store.types[data];
        if (!definition) return unknown(`Unknown typeDefinitionIndex ${data}`);
        evidence.push({ source: "types", detail: `typeDefinitions[${data}] ${definition.image} ${definition.fullname}`,
          metadataFileOffset: definition.fileOffset });
        result = { ...base, status: "confirmed", name: definition.fullname + suffix, typeDefinitionIndex: data,
          definition };
      } else if (kind === 0x0f || kind === 0x10 || kind === 0x1d) {
        const element = this.typeAt(data, next);
        evidence.push(...element.evidence);
        const elementSuffix = kind === 0x0f ? "*" : kind === 0x10 ? "&" : "[]";
        result = { ...base, status: element.status, element,
          name: element.name ? element.name + elementSuffix + suffix : undefined,
          ...(element.status !== "confirmed" ? { reason: `Unknown element type: ${element.reason}` } : {}) };
      } else if (kind === 0x15) {
        if (!this.classPointers.has(data) || !w.contains(data, 16)) {
          return unknown(`Unknown Il2CppGenericClass pointer 0x${data.toString(16)}`);
        }
        const words = [w.u32(data), w.u32(data + 4), w.u32(data + 8), w.u32(data + 12)];
        evidence.push(this.memoryEvidence(data,
          "Il2CppGenericClass: type* +0, context.class_inst* +4, context.method_inst* +8, cached_class* +12", 16));
        evidence.push(this.registrationEvidence("genericClasses[] contains Il2CppGenericClass"));
        const genericBase = this.typeAt(words[0], next);
        const classInst = words[1] ? this.genericInst(words[1], next) : undefined;
        const methodInst = words[2] ? this.genericInst(words[2], next) : undefined;
        evidence.push(...genericBase.evidence, ...(classInst?.evidence ?? []), ...(methodInst?.evidence ?? []));
        const confirmed = genericBase.status === "confirmed" && !!genericBase.definition
          && classInst?.status === "confirmed" && !methodInst;
        result = { ...base, status: confirmed ? "confirmed" : "unknown",
          generic: { address: data, raw: words, base: genericBase, classInst, methodInst },
          typeDefinitionIndex: genericBase.typeDefinitionIndex, definition: genericBase.definition,
          name: confirmed
            ? `${genericBase.name}<${classInst.arguments.map(a => a.name).join(", ")}>${suffix}`
            : undefined,
          ...(!confirmed
            ? { reason: "Generic class base/arguments unresolved or unexpected method context; raw context retained" }
            : {}) };
      } else {
        result = unknown(`Unsupported Il2CppType kind 0x${kind.toString(16)}; data=0x${data.toString(16)}, `
          + `bits=0x${bits.toString(16)}`);
      }
    } catch (error) {
      result = unknown(error instanceof Error ? error.message : String(error));
    }
    if (result.status === "confirmed") this.typeCache.set(address, result);
    return result;
  }
  private genericInst(address: number, seen: ReadonlySet<number>): GenericInst {
    const w = this.store.wasm;
    if (!this.instPointers.has(address) || !w.contains(address, 8)) {
      throw new Error(`Unknown registered Il2CppGenericInst at 0x${address.toString(16)}`);
    }
    const count = w.u32(address), argv = w.u32(address + 4);
    const evidence: Evidence[] = [this.memoryEvidence(address, "Il2CppGenericInst: type_argc u32 +0, type_argv* +4", 8),
      this.registrationEvidence("genericInsts[] contains instance")];
    if (count > 4096 || !w.contains(argv, count * 4) || (count > 0 && argv === 0)) {
      return { status: "unknown", address, count, argv, arguments: [], evidence,
        reason: "Argument array out of bounds or exceeds explicit 4096-argument decoding limit" };
    }
    const args: DecodedType[] = [];
    for (let i = 0; i < count; i++) {
      const pointerAddress = argv + i * 4;
      const decoded = this.typeAt(w.u32(pointerAddress), seen);
      args.push(decoded);
      evidence.push(this.memoryEvidence(pointerAddress, `Il2CppGenericInst.type_argv[${i}]`), ...decoded.evidence);
    }
    const status = args.every(a => a.status === "confirmed") ? "confirmed" : "unknown";
    return { status, address, count, argv, arguments: args, evidence,
      ...(status === "unknown" ? { reason: "One or more generic argument types are unknown" } : {}) };
  }
  private instAtIndex(index: number): GenericInst | undefined {
    if (index === -1) return undefined;
    const r = this.store.registration;
    if (index < 0 || index >= r.genericInstsCount) throw new Error(`Unknown genericInsts index ${index}`);
    const pointerAddress = r.genericInsts + index * 4;
    const inst = this.genericInst(this.store.wasm.u32(pointerAddress), new Set());
    return { ...inst, evidence: [this.registrationEvidence(`genericInsts[${index}]`),
      this.memoryEvidence(pointerAddress, `genericInsts[${index}] pointer`), ...inst.evidence] };
  }
  private methodEvidence(method: MethodRecord): Evidence {
    const detail = `methods[${method.index}] ${method.label}, tableSlot=${method.tableSlot}, `
      + `funcIndex=${method.funcIndex ?? "unknown"}`;
    return { source: "methods", metadataFileOffset: method.fileOffset, detail };
  }
  decodeCell(address: number): DecodedCell {
    const cached = this.cellCache.get(address);
    if (cached) return cached;
    const decoded = this.cellAt(address);
    this.cellCache.set(address, decoded);
    return decoded;
  }
  private cellAt(address: number): DecodedCell {
    const w = this.store.wasm;
    const evidence: Evidence[] = [];
    if (!w.contains(address, 4)) return { status: "unknown", address, reason: "Cell outside initial memory", evidence };
    const word = w.u32(address), usage = word >>> 29, index = (word & 0x1fffffff) >>> 1;
    evidence.push(this.memoryEvidence(address,
      `initial word=0x${word.toString(16)}; usage=word>>>29; index=(word&0x1fffffff)>>>1`));
    const base = { address, word, usage, usageName: USAGES[usage] ?? "unknown", index, evidence };
    const unknown = (reason: string): DecodedCell => ({ ...base, status: "unknown", reason });
    if (!(word & 1)) return unknown("Initial word is not an encoded metadata usage (low bit is clear)");
    if (usage < 1 || usage > 6) return unknown(`Unknown metadata usage kind ${usage}`);
    try {
      if (usage === 1 || usage === 2) {
        const r = this.store.registration;
        if (index >= r.typesCount) {
          return unknown(`Il2CppType index ${index} outside registration count ${r.typesCount}`);
        }
        const pointerAddress = r.types + index * 4;
        evidence.push(this.registrationEvidence(`types[${index}] (base=0x${r.types.toString(16)})`),
          this.memoryEvidence(pointerAddress, `types[${index}] pointer`));
        const type = this.decodeIl2CppType(w.u32(pointerAddress));
        evidence.push(...type.evidence);
        return { ...base, status: type.status, name: type.name, type, ...(type.reason ? { reason: type.reason } : {}) };
      }
      if (usage === 3) {
        const method = this.store.methods[index];
        if (!method) return unknown(`Unknown methodDefinitionIndex ${index}`);
        evidence.push(this.methodEvidence(method));
        return { ...base, status: "confirmed", name: method.label, method };
      }
      if (usage === 4) {
        const meta = this.metadata, fileOffset = meta.record("fieldRefs", index, 8);
        const typeIndex = meta.view.getInt32(fileOffset, true), fieldIndex = meta.view.getInt32(fileOffset + 4, true);
        const fieldRef = { typeIndex, fieldIndex, fileOffset };
        // f1644 at WASM 0x1c18ce..0x1c18e0 resolves the type, loads its
        // fields pointer (+64), then adds fieldIndex * sizeof(FieldInfo=20).
        // The field index is therefore owner-relative, not a global TSV row.
        evidence.push({ source: "metadata", fileOffset,
          detail: `fieldRefs[${index}]: typeIndex=${typeIndex}, fieldIndex=${fieldIndex} `
            + "(relative to declaring type)" },
        { source: "wasm", fileOffset: 0x1c18ce,
          detail: "f1644 fieldRefs branch: owner fields + relative fieldIndex*20 (through file offset 0x1c18e0)" });
        const r = this.store.registration;
        if (typeIndex < 0 || typeIndex >= r.typesCount) return { ...unknown("Unknown fieldRef typeIndex"), fieldRef };
        const pointerAddress = r.types + typeIndex * 4;
        evidence.push(this.registrationEvidence(`types[${typeIndex}]`),
          this.memoryEvidence(pointerAddress, "fieldRef type pointer"));
        const type = this.decodeIl2CppType(w.u32(pointerAddress)), owner = type.definition;
        evidence.push(...type.evidence);
        if (type.status !== "confirmed" || !owner || fieldIndex < 0 || fieldIndex >= owner.field_count) {
          const reason = "Unresolved fieldRef owner or relative field index outside owner range";
          return { ...unknown(reason), fieldRef, type };
        }
        const field = this.store.fields[owner.fieldStart + fieldIndex];
        if (!field || field.declaringType !== owner.index) {
          return { ...unknown("fieldRef does not match declaring type's field range"), fieldRef, type };
        }
        evidence.push({ source: "fields", metadataFileOffset: field.fileOffset,
          detail: `fields[${field.index}]=typeDefinitions[${owner.index}].fieldStart(${owner.fieldStart})`
            + `+${fieldIndex}; ${field.name}, ${field.offsetKind} offset=${field.offset}` });
        return { ...base, status: "confirmed", name: `${type.name}::${field.name}`, fieldRef, type, field };
      }
      if (usage === 5) {
        const meta = this.metadata, fileOffset = meta.record("stringLiteral", index, 8);
        const length = meta.view.getUint32(fileOffset, true), dataIndex = meta.view.getUint32(fileOffset + 4, true);
        const data = meta.tables.get("stringLiteralData")!;
        if (dataIndex + length > data.size) return unknown("String literal exceeds stringLiteralData bounds");
        evidence.push({ source: "metadata", fileOffset,
          detail: `stringLiteral[${index}]: length=${length}, dataIndex=${dataIndex}` },
        { source: "metadata", fileOffset: data.offset + dataIndex,
          detail: `stringLiteralData UTF-8 (${length} bytes)` });
        const bytes = meta.bytes.subarray(data.offset + dataIndex, data.offset + dataIndex + length);
        try {
          const literal = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
          return { ...base, status: "confirmed", literal, name: JSON.stringify(literal) };
        } catch {
          return unknown(`Unknown UTF-8 literal; raw hex=${bytes.toString("hex")}`);
        }
      }
      const r = this.store.registration;
      if (index >= r.methodSpecsCount) return unknown(`MethodSpec index ${index} outside count ${r.methodSpecsCount}`);
      const specAddress = r.methodSpecs + index * 12;
      const methodDefinitionIndex = w.i32(specAddress);
      const classIndexIndex = w.i32(specAddress + 4), methodIndexIndex = w.i32(specAddress + 8);
      const rawSpec = { address: specAddress, methodDefinitionIndex, classIndexIndex, methodIndexIndex };
      evidence.push(this.registrationEvidence(`methodSpecs[${index}] (base=0x${r.methodSpecs.toString(16)})`),
        this.memoryEvidence(specAddress,
          "Il2CppMethodSpec: methodDefinitionIndex i32 +0, classIndexIndex i32 +4, methodIndexIndex i32 +8", 12));
      const method = this.store.methods[methodDefinitionIndex];
      if (!method) {
        return { ...unknown(`Unknown MethodSpec.methodDefinitionIndex ${methodDefinitionIndex}`), methodSpec: rawSpec };
      }
      evidence.push(this.methodEvidence(method));
      let classInst: GenericInst | undefined, methodInst: GenericInst | undefined;
      try {
        classInst = this.instAtIndex(classIndexIndex);
        methodInst = this.instAtIndex(methodIndexIndex);
      } catch (error) {
        return { ...unknown(error instanceof Error ? error.message : String(error)), method, methodSpec: rawSpec };
      }
      evidence.push(...(classInst?.evidence ?? []), ...(methodInst?.evidence ?? []));
      const known = (!classInst || classInst.status === "confirmed")
        && (!methodInst || methodInst.status === "confirmed");
      const [owner, methodName] = splitMethodLabel(method.label);
      const args = (inst?: GenericInst) => inst ? `<${inst.arguments.map(a => a.name ?? "unknown").join(", ")}>` : "";
      return { ...base, status: known ? "confirmed" : "unknown",
        name: known ? `${owner}${args(classInst)}::${methodName}${args(methodInst)}` : undefined,
        method, methodSpec: { ...rawSpec, classInst, methodInst },
        ...(!known ? { reason: "Method definition confirmed; generic arguments remain unknown" } : {}) };
    } catch (error) {
      return unknown(error instanceof Error ? error.message : String(error));
    }
  }
}
function splitMethodLabel(label: string): readonly [string, string] {
  const separator = label.lastIndexOf("::");
  return [label.slice(0, separator), label.slice(separator + 2)];
}
