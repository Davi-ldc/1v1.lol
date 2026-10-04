import { openRe, type FieldStorage, type ReToolkit } from "./lib/index.ts";
import { callsText, cellText, disassemblyText, fieldText, functionText, il2CppTypeText, methodText, slotText, stampText,
  typeText, xrefText } from "./lib/format.ts";

const HELP = `Static reader for the original build (stdout only). Usage: bun run re <command> [--sources]
  method <name|f<index>|slot:<n>>         signature, token, function, table slot, body and folded alias count
  slot <n>                                table slot -> function and the rows that pin it
  type <name|type:<index>> [--methods]    declared fields with offsets and storage; --methods adds methods
  field <type|type:<index>> <offset|name> [--instance|--static]   declared fields by offset or name
  cell <0xaddress> [--il2cpptype]         metadata-usage cell; --il2cpptype decodes an Il2CppType* instead
  disasm <f<index>|slot:<n>>              instructions with direct callees and metadata cells annotated
  calls <f<index>>                        direct callees
  callers <f<index>>                      direct callers from a whole-module scan
  xref <0xaddress> [--all]                i32.const sites grouped per function; --all lists every site
--sources replaces the build stamp with every input path and SHA-256.`;

// command -> [minimum arguments, maximum arguments, flags]
const COMMANDS: Readonly<Record<string, readonly [number, number, readonly string[]]>> = {
  method: [1, Infinity, []], slot: [1, 1, []], type: [1, Infinity, ["--methods"]],
  field: [2, 2, ["--instance", "--static"]], cell: [1, 1, ["--il2cpptype"]], disasm: [1, 1, []],
  calls: [1, 1, []], callers: [1, 1, []], xref: [1, 1, ["--all"]],
};
const METHODS = 24;

function number(value: string, label: string, signed = false): number {
  const pattern = signed ? /^(?:-?\d+|0x[0-9a-f]+)$/i : /^(?:\d+|0x[0-9a-f]+)$/i;
  const n = Number(value);
  if (!pattern.test(value) || !Number.isSafeInteger(n) || n > 0xffffffff || (!signed && n < 0)) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(value)}`);
  }
  return n;
}

function query(re: ReToolkit, command: string, args: readonly string[], flags: ReadonlySet<string>): [string, boolean] {
  if (command === "method") {
    const q = args.join(" "), methods = re.findMethods(q), lines: string[] = [];
    let known = methods.length > 0;
    if (/^slot:\d+$/.test(q)) {
      const info = re.slot(Number(q.slice(5)));
      lines.push(slotText(info));
      known ||= info.funcIndex !== undefined;
    } else if (/^f\d+$/.test(q)) {
      const info = re.functionInfo(Number(q.slice(1)));
      lines.push(functionText(info));
      known ||= info.status !== "unknown";
    }
    lines.push(...methods.slice(0, METHODS).map(m => methodText(re, m)));
    if (methods.length > METHODS) lines.push(`;; ${methods.length - METHODS} more methods; refine the query`);
    if (!methods.length) lines.push("[unknown] no managed method row matches");
    return [lines.join("\n"), known];
  }
  if (command === "slot") {
    const info = re.slot(number(args[0], "table slot"));
    return [slotText(info), info.funcIndex !== undefined];
  }
  if (command === "type") {
    const types = re.type(args.join(" "));
    const text = types.map(t => typeText(re, t, flags.has("--methods"))).join("\n");
    return [text || "[unknown] no type matches", !!types.length];
  }
  if (command === "field") {
    if (flags.size > 1) throw new Error("Choose --instance OR --static, not both");
    const storage: FieldStorage | undefined = flags.has("--static") ? "static-field-block"
      : flags.has("--instance") ? "instance" : undefined;
    const [type, name] = args;
    const found = /^(?:-?\d+|0x[0-9a-f]+)$/i.test(name) ? re.fieldAt(type, number(name, "field offset", true))
      : re.fieldByName(type, name);
    const fields = found.filter(f => !storage || f.offsetKind === storage);
    const text = fields.map(f => fieldText(f)).join("\n");
    return [text || "[unknown] no declared field matches (inherited fields are not merged)", !!fields.length];
  }
  if (command === "cell") {
    const address = number(args[0], "memory address");
    if (flags.has("--il2cpptype")) {
      const type = re.decodeIl2CppType(address);
      return [il2CppTypeText(type), type.status === "confirmed"];
    }
    const cell = re.decodeCell(address);
    return [cellText(re, cell), cell.status === "confirmed"];
  }
  if (command === "xref") {
    const report = re.xrefReport(number(args[0], "memory address"));
    return [xrefText(re, report, flags.has("--all")), report.complete];
  }
  const selector = args[0], f = re.resolveFunction(selector);
  if (command === "disasm") {
    const decoded = re.disasm(f), slot = selector.startsWith("slot:") ? Number(selector.slice(5)) : undefined;
    return [disassemblyText(re, decoded, slot), decoded.complete];
  }
  const report = command === "calls" ? re.calleesReport(f) : re.callersReport(f);
  return [callsText(re, command, f, report), report.complete];
}

function run(re: ReToolkit, args: readonly string[]): [string, boolean] {
  const [command = "help", ...rest] = args;
  if (command === "help" || command === "--help") return [HELP, true];
  if (!Object.hasOwn(COMMANDS, command)) throw new Error(`Unknown command ${JSON.stringify(command)}; use --help`);
  const [min, max, allowed] = COMMANDS[command];
  const flags = new Set(rest.filter(arg => arg.startsWith("--")));
  const positional = rest.filter(arg => !arg.startsWith("--"));
  for (const flag of flags) if (!allowed.includes(flag)) throw new Error(`Unknown flag ${flag}`);
  if (positional.length < min || positional.length > max || positional.some(arg => !arg)) {
    throw new Error("Wrong argument count; use --help");
  }
  return query(re, command, positional, flags);
}

/** Exported for in-process tests; only the import.meta.main branch writes to stdout. */
export function runCli(args: readonly string[], re: ReToolkit = openRe()): { output: string; exitCode: number } {
  let text: string, ok: boolean;
  try {
    [text, ok] = run(re, args.filter(arg => arg !== "--sources"));
  } catch (error) {
    [text, ok] = [`unknown/error: ${error instanceof Error ? error.message : String(error)}`, false];
  }
  return { output: `${stampText(re, args.includes("--sources"))}\n${text}`, exitCode: ok ? 0 : 1 };
}

if (import.meta.main) {
  const result = runCli(Bun.argv.slice(2));
  console.log(result.output);
  process.exitCode = result.exitCode;
}
