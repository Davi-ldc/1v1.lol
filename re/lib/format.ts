import type { CallReport, CallScanStats, DecodedCell, DecodedType, Evidence, FieldRecord, FunctionIdentity,
  MethodRecord, ReToolkit, SlotInfo, TypeRecord, XrefReport } from "./index.ts";
import { instructionText, type Disassembly, type Instruction } from "./wasm.ts";

const ALIASES = 8, XREF_FUNCTIONS = 40, XREF_CONTEXT = 4;
const hex = (n: number) => `0x${n.toString(16)}`;
const hexOrUnknown = (n: number | null | undefined) => n === null || n === undefined ? "unknown" : hex(n);
const pad = (n: number, width: number) => n.toString(16).padStart(width, "0");
const slotOf = (m: MethodRecord) => `slot:${m.tableSlot || "unknown"}`;
const completeness = (r: CallScanStats) =>
  r.complete ? "confirmed/complete" : `unknown/INCOMPLETE (${r.errors.length} undecoded functions)`;
const errorLines = (r: CallScanStats) => r.errors.map(e =>
  `;; ERROR f${e.funcIndex} wasm@${hex(e.offset)}: ${e.message}; raw=${e.rawHex}; undecodedBytes=${e.remainingBytes}`);

/** One stamp line per query; `--sources` expands it to every input path and SHA-256. */
export function stampText(re: ReToolkit, sources: boolean): string {
  const { wasm, metadata } = re.sources;
  if (!sources) return `;; build wasm ${wasm.sha256.slice(0, 8)} metadata ${metadata.sha256.slice(0, 8)}`;
  return Object.entries(re.sources).map(([key, s]) => `;; source ${key} ${s.path} sha256=${s.sha256}`).join("\n");
}

function aliasesText(methods: readonly MethodRecord[], limit: number): string {
  const shown = methods.slice(0, limit).map(m => `${m.label} [method:${m.index}, ${slotOf(m)}]`);
  if (methods.length > limit) shown.push(`+${methods.length - limit} more`);
  return `aliasCount=${methods.length}${shown.length ? `; ${shown.join(" | ")}` : ""}`;
}
export function functionText(info: FunctionIdentity, limit = ALIASES): string {
  const names = info.exports.map(n => `export ${n}`);
  if (info.import) names.unshift(`import ${info.import.module}.${info.import.name}`);
  const role = names.length ? `; ${names.join(" | ")}` : info.aliasCount ? "" : "; name/role unknown";
  return `[${info.status}] f${info.funcIndex} ${aliasesText(info.aliases, limit)}${role}`;
}
export function slotText(info: SlotInfo): string {
  if (info.funcIndex === undefined) return `[unknown] slot:${info.slot} absent from wasm-elements.tsv`;
  const pinned = info.methods.map(m => `${m.label} [method:${m.index}]`).join(" | ");
  const folded = functionText({ ...info, funcIndex: info.funcIndex });
  return `[${info.status}] slot:${info.slot} -> f${info.funcIndex} wasmType=${info.typeIndex}; `
    + `${pinned ? `pinned ${pinned}` : "no managed row pins this slot"}\n  ${folded}`;
}
export function methodText(re: ReToolkit, m: MethodRecord): string {
  const parameters = re.parameters(m).map(p => `${p.name}:${p.type}`).join(", ");
  const body = `bodyOffset=${hexOrUnknown(m.bodyOffset)} bodySize=${m.bodySize ?? "unknown"}`;
  const folded = m.funcIndex === null ? "no recovered non-generic function mapping"
    : `aliasCount=${re.methodsByFunc(m.funcIndex).length}`;
  return `[confirmed] method:${m.index} ${m.image} ${m.label}(${parameters}) -> ${m.returnTypeName}\n`
    + `  token=${m.tokenHex} metadata@${hex(m.fileOffset)} type:${m.declaringType} parameterStart=${m.parameterStart}`
    + ` vslot=${m.slot}\n  f${m.funcIndex ?? "unknown"} ${slotOf(m)} ${body} ${folded}`;
}
function fieldDetail(f: FieldRecord): string {
  return `${f.name}: ${f.type} offset=${f.offset ?? "unknown"} ${f.offsetKind} attrs=${hex(f.attributes)}`
    + ` metadata@${hex(f.fileOffset)} offsetEntry=${hexOrUnknown(f.fieldOffsetEntryAddress)}`;
}
export function fieldText(f: FieldRecord): string {
  return `[confirmed] field:${f.index} type:${f.declaringType} ${f.image} ${f.declaringTypeName}::${fieldDetail(f)}`;
}
export function typeText(re: ReToolkit, t: TypeRecord, withMethods: boolean): string {
  const lines = [
    `[confirmed] type:${t.index} ${t.image} ${t.fullname} token=${hex(t.token)} metadata@${hex(t.fileOffset)}`
      + ` parent=${t.parentType || "none/unknown"}`,
    `  parentIl2CppTypeIndex=${t.parentIndex} byvalTypeIndex=${t.byvalTypeIndex}`
      + ` runtimeSizes=${JSON.stringify(t.runtimeSizes)}`,
    `  declared fieldStart=${t.fieldStart} fieldCount=${t.field_count}`
      + ` methodStart=${t.methodStart} methodCount=${t.method_count}`,
    ...re.fieldsOf(t).map(f => `  field:${f.index} ${fieldDetail(f)}`),
  ];
  if (withMethods) {
    lines.push(...re.methodsOf(t).map(m => `  method:${m.index} ${m.label} f${m.funcIndex ?? "unknown"} ${slotOf(m)}`
      + ` aliasCount=${m.funcIndex === null ? 0 : re.methodsByFunc(m.funcIndex).length}`
      + ` metadata@${hex(m.fileOffset)}`));
  }
  return lines.join("\n");
}
function evidenceText(evidence: readonly Evidence[]): string[] {
  const items = new Set(evidence.map(e => e.source + (e.fileOffset === undefined ? "" : `@${hex(e.fileOffset)}`)
    + (e.address === undefined ? "" : ` mem=${hex(e.address)}`)
    + (e.metadataFileOffset === undefined ? "" : ` metadata@${hex(e.metadataFileOffset)}`) + `: ${e.detail}`));
  return items.size ? [`  evidence ${[...items].join(" | ")}`] : [];
}
function typeWords(t: DecodedType): string {
  return `Il2CppType*=${hex(t.address)} raw=[${t.raw.map(hex).join(", ")}]`
    + (t.kind === undefined ? "" : ` kind=${hex(t.kind)} ${t.kindName}`)
    + (t.typeDefinitionIndex === undefined ? "" : ` type:${t.typeDefinitionIndex}`)
    + (t.generic ? ` Il2CppGenericClass*=${hex(t.generic.address)} raw=[${t.generic.raw.map(hex).join(", ")}]` : "");
}
export function cellText(re: ReToolkit, cell: DecodedCell): string {
  const lines = [`[${cell.status}] cell ${hex(cell.address)} initial=${hexOrUnknown(cell.word)}`
    + ` ${cell.usageName ?? "unknown"}[${cell.index ?? "unknown"}] ${cell.name ?? "unknown"}`];
  if (cell.type) lines.push(`  ${typeWords(cell.type)}`);
  const spec = cell.methodSpec, method = cell.method;
  if (spec) {
    lines.push(`  Il2CppMethodSpec*=${hex(spec.address)} methodDefinitionIndex=${spec.methodDefinitionIndex}`
      + ` classIndexIndex=${spec.classIndexIndex} methodIndexIndex=${spec.methodIndexIndex}`);
  }
  if (method) {
    const body = method.funcIndex === null ? "body unknown"
      : `f${method.funcIndex} aliasCount=${re.methodsByFunc(method.funcIndex).length}`;
    const instance = cell.usage === 6 ? "; instantiated MethodRef body unknown" : "";
    lines.push(`  definition method:${method.index} ${body}${instance}`);
  }
  const ref = cell.fieldRef;
  if (ref) lines.push(`  fieldRef typeIndex=${ref.typeIndex} relativeFieldIndex=${ref.fieldIndex}`);
  if (cell.reason) lines.push(`  unknown: ${cell.reason}`);
  return [...lines, ...evidenceText(cell.evidence)].join("\n");
}
export function il2CppTypeText(t: DecodedType): string {
  return [`[${t.status}] ${typeWords(t)} ${t.name ?? "unknown"}`, ...(t.reason ? [`  unknown: ${t.reason}`] : []),
    ...evidenceText(t.evidence)].join("\n");
}
function annotation(re: ReToolkit, ins: Instruction): string {
  if (ins.op === "call" || ins.op === "return_call") {
    return ` ;; ${functionText(re.functionInfo(Number(ins.args[0])), 1)}`;
  }
  if (ins.op === "call_indirect" || ins.op === "return_call_indirect") {
    return ` ;; wasmType=${ins.args[0]} table=${ins.args[1]}; target unknown`;
  }
  const address = ins.op === "i32.const" ? Number(ins.args[0]) >>> 0 : 0;
  if (!address || address % 4) return "";
  const cell = re.decodeCell(address);
  if (cell.status !== "confirmed" && !cell.type && !cell.methodSpec && !cell.fieldRef) return "";
  return ` ;; inferred cell ${hex(address)}: [${cell.status}] ${cell.usageName}[${cell.index}]`
    + ` ${cell.name ?? `unknown (${cell.reason})`}`;
}
export function disassemblyText(re: ReToolkit, d: Disassembly, slot?: number): string {
  const identity = slot === undefined ? functionText(re.functionInfo(d.funcIndex)) : slotText(re.slot(slot));
  const signature = `(${d.signature.params.join(", ")}) -> (${d.signature.results.join(", ")})`;
  const locals = d.locals.map(l => `${l.count}x${l.type}`).join(", ") || "none";
  const body = d.body ? `bodyOffset=${hex(d.body.offset)} bodySize=${d.body.size}` : "imported; no body";
  const lines = [...identity.split("\n").map(line => `;; ${line}`),
    `;; wasmType=${d.typeIndex} ${signature} locals=${locals} ${body}`,
    ...d.instructions.map(ins => `${pad(ins.offset, 8)} +${pad(ins.relativeOffset, 4)}  ${"  ".repeat(ins.depth)}`
      + `${instructionText(ins)}${annotation(re, ins)}`)];
  const e = d.error;
  if (e) {
    lines.push(`${pad(e.offset, 8)} +${pad(e.relativeOffset, 4)}  unknown raw=${e.rawHex || "<end-of-body>"}`,
      `;; ERROR: stopped this function: ${e.message}; ${e.remainingBytes} undecoded bytes (raw capped at 32)`);
  }
  lines.push(`;; decode ${d.complete ? "complete" : "INCOMPLETE/unknown"}`);
  return lines.join("\n");
}
export function callsText(re: ReToolkit, direction: string, f: number, report: CallReport): string {
  const header = `;; ${direction} f${f}: ${report.functions.length} functions by direct call/return_call`;
  return [`${header}; ${completeness(report)}`, ...report.functions.map(g => functionText(re.functionInfo(g), 1)),
    ...errorLines(report)].join("\n");
}
/** One line per function (hit count, first site and the next instructions); `all` adds every site. */
export function xrefText(re: ReToolkit, report: XrefReport, all: boolean): string {
  const cell = re.decodeCell(report.address);
  const functions = [...Map.groupBy(report.hits, hit => hit.funcIndex)];
  const shown = all ? functions : functions.slice(0, XREF_FUNCTIONS);
  const target = cell.status === "confirmed" ? `${cell.usageName} ${cell.name}` : "no decoded metadata cell";
  const lines = [`;; xref ${hex(report.address)} (${target}): ${report.hits.length} i32.const sites`
    + ` in ${functions.length} functions; ${completeness(report)}`];
  for (const [f, hits] of shown) {
    const instructions = re.disasm(f).instructions;
    const site = (offset: number) => {
      const at = instructions.findIndex(ins => ins.offset === offset);
      return `@${hex(offset)} | ${instructions.slice(at + 1, at + 1 + XREF_CONTEXT).map(instructionText).join("; ")}`;
    };
    lines.push(`${functionText(re.functionInfo(f), 1)}; sites=${hits.length} ${site(hits[0].offset)}`);
    if (all) lines.push(...hits.slice(1).map(hit => `  ${site(hit.offset)}`));
  }
  if (shown.length < functions.length) lines.push(`;; ${functions.length - shown.length} more functions (--all)`);
  return [...lines, ...errorLines(report)].join("\n");
}
