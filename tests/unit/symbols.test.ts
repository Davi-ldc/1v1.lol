import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";
import * as symbols from "../../src/page/symbols.ts";
import * as patchExports from "../../src/host/wasm.ts";
import { profiles } from "../../src/host/profiles.ts";
import { openRe, type FieldRecord, type SourceKey, type TypeRecord } from "../../re/lib/index.ts";
import { decodeBody } from "../../re/lib/wasm.ts";
import { withBuild } from "./build.ts";

const root = resolve(import.meta.dir, "../..");
const re = openRe(root);
const hex = (n: number) => `0x${n.toString(16)}`;
type Table = Readonly<Record<string, readonly [number, string]>>;
type FieldMap = Readonly<Record<string, Readonly<Record<string, number>>>>;

/**
 * A map of the original client: the core one (src/page/symbols.ts, used in src/page) and, when this checkout has the
 * custom heroes, theirs (heroes/page/symbols.ts, used in heroes/page). Both pass the same checks.
 */
interface SymbolMap { name: string; dir: string; file: string; slots: Table; typeInfos: Table; methodInfos: Table;
  stringLiterals: Table; virtualSlots: Table; literals: Table; fields: FieldMap; staticFields: FieldMap;
  runtime: Readonly<Record<string, number>> }
const page = resolve(root, "src/page"), heroPage = resolve(root, "heroes/page");
const heroesFile = resolve(heroPage, "symbols.ts");
const heroes = existsSync(heroesFile) ? await import(heroesFile) : undefined;
const maps: SymbolMap[] = [
  { name: "core", dir: page, file: resolve(page, "symbols.ts"), ...symbols, fields: symbols.field,
    staticFields: symbols.staticField },
  ...heroes ? [{ name: "heroes", dir: heroPage, file: heroesFile, ...heroes, fields: heroes.fields,
    staticFields: heroes.staticFields, runtime: heroes.runtimes }] : [],
];
const allTypeInfos: Table = Object.assign({}, ...maps.map(map => map.typeInfos));

function finish(block: string, failures: readonly string[], sources: readonly SourceKey[]): void {
  if (failures.length) {
    const evidence = sources.map(key => `${re.sources[key].path} sha256=${re.sources[key].sha256}`).join("\n");
    throw new Error(`${block}: ${failures.length} mismatch(es)\n${failures.join("\n")}\nEvidence:\n${evidence}`);
  }
  expect(failures).toEqual([]);
}
function attempt(failures: string[], context: string, check: () => void): void {
  try { check(); }
  catch (error) { failures.push(`${context}: ${error instanceof Error ? error.message : String(error)}`); }
}

const typeAliases: Readonly<Record<string, string>> = {
  UnityObject: "UnityEngine.Object",
  Delegate: "System.Delegate",
  MulticastDelegate: "System.MulticastDelegate",
  Queue: "System.Collections.Generic.Queue`1",
  ObscuredInt: "CodeStage.AntiCheat.ObscuredTypes.ObscuredInt",
  Champions: "JustPlay.Champions.Champions", // Not the global Champions API class.
  Ability: "JustPlay.Gameplay.Abilities.Ability",
  object: "System.Object", // Primitive spelling used in the recovered parentType column.
};
const typeCache = new Map<string, TypeRecord>();
function resolveType(key: string): TypeRecord {
  const cached = typeCache.get(key);
  if (cached) return cached;
  const name = typeAliases[key] ?? key;
  const matches = re.type(name);
  const exact = matches.filter(t => t.fullname === name);
  let candidates = exact.length ? exact : matches.filter(t => t.fullname.endsWith(`.${name}`));
  if (exact.length > 1) {
    // E.g. six types share the fullname SettingsPanel. The page's verified TypeInfo
    // cell pins typedef 1980; never pick an arbitrary row or infer the image.
    const entry = allTypeInfos[key];
    if (entry) {
      const decoded = re.decodeCell(entry[0]), definition = decoded.type?.definition;
      if (decoded.status === "confirmed" && decoded.name === name && definition) {
        candidates = exact.filter(t => t.index === definition.index);
      }
    }
  }
  if (candidates.length !== 1) throw new Error(`type ${JSON.stringify(name)} is unknown/ambiguous: ${candidates.map(t =>
    `${t.fullname} [type:${t.index}, ${t.image}]`).join(" | ") || "no exact/unique .Name suffix"}`);
  typeCache.set(key, candidates[0]);
  return candidates[0];
}
const ancestryCache = new Map<number, readonly TypeRecord[]>();
function ancestry(type: TypeRecord): readonly TypeRecord[] {
  const cached = ancestryCache.get(type.index);
  if (cached) return cached;
  const result: TypeRecord[] = [], seen = new Set<number>();
  let current = type;
  while (true) {
    if (seen.has(current.index)) throw new Error(`Cycle in parent chain at type:${current.index}`);
    seen.add(current.index);
    result.push(current);
    if (current.parentIndex < 0) break;
    if (!current.parentType) {
      throw new Error(`Unknown parent type for type:${current.index}, parent Il2CppType index:${current.parentIndex}`);
    }
    // parentType is already decoded in the IL2CPP tables. Select a generic *definition* only
    // when the recovered spelling includes an explicit `arity<argument-list>.
    const parent = current.parentType.match(/^(.+`\d+)</)?.[1] ?? current.parentType;
    current = resolveType(parent);
  }
  ancestryCache.set(type.index, result);
  return result;
}
const fieldName = (name: string) => name.replace(/^<(.+)>k__BackingField$/, "$1");
function fieldEvidence(f: FieldRecord): string {
  return `${f.declaringTypeName}::${f.name} [field:${f.index}, type:${f.declaringType}, offset:${f.offset}, ${
    f.offsetKind}, attrs:${hex(f.attributes)}, global-metadata@${hex(f.fileOffset)}, fieldOffsetEntryAddress:${
    f.fieldOffsetEntryAddress === null ? "unknown" : hex(f.fieldOffsetEntryAddress)}]`;
}
function verifyField(typeKey: string, key: string, offset: number, storage: "instance" | "static-field-block"): void {
  const chain = ancestry(resolveType(typeKey));
  const unboxed = storage === "instance" && chain.some(t => t.fullname === "System.ValueType");
  const expected = offset + (unboxed ? 8 : 0);
  const fields = chain.flatMap(t => [...re.fieldsOf(t)]);
  const named = fields.filter(f => fieldName(f.name) === key);
  const matching = named.filter(f => f.offset === expected && f.offsetKind === storage
    && !!(f.attributes & 0x10) === (storage === "static-field-block"));
  if (matching.length !== 1) {
    const atOffset = fields.filter(f => f.offset === expected && f.offsetKind === storage);
    throw new Error(`map offset=${offset}, expected DB offset=${expected}${unboxed ? " (unboxed +8)"
      : ""}, ${storage}; matched ${matching.length}. Named fields: ${named.map(fieldEvidence).join(" | ")
      || "none"}. At expected offset: ${atOffset.map(fieldEvidence).join(" | ") || "none"}`);
  }
}

for (const map of maps) {
withBuild(`${map.name} map: slots pin their exact managed row or an explicitly unnamed function`, () => {
  const failures: string[] = [];
  for (const [key, [slot, label]] of Object.entries(map.slots)) {
    attempt(failures, `slots.${key} [slot:${slot}, label:${label}]`, () => {
      const methods = re.methodsBySlot(slot), f = re.funcBySlot(slot);
      const pinned = () => methods.map(m => `${m.index}:${m.label}`).join(" | ") || "none";
      if (/^f\d+$/.test(label)) {
        if (f !== Number(label.slice(1)) || methods.length) {
          throw new Error(`actual f${f ?? "unknown"}; pinned rows=${pinned()}`);
        }
      } else {
        const matching = methods.filter(m => m.label === label);
        if (matching.length !== 1 || matching[0].funcIndex !== f) {
          throw new Error(`actual f${f ?? "unknown"}; exact matches=${matching.length}; pinned rows=${pinned()}`);
        }
      }
    });
  }
  finish("slots", failures, ["elements", "methods"]);
});

withBuild(`${map.name} map: type and method registries match confirmed decoded names`, () => {
  const failures: string[] = [];
  for (const [group, table] of [["typeInfos", map.typeInfos], ["methodInfos", map.methodInfos],
    ["stringLiterals", map.stringLiterals]] as const) {
    for (const [key, [address, label]] of Object.entries(table)) {
      attempt(failures, `${group}.${key} [${hex(address)}]`, () => {
        const decoded = re.decodeCell(address);
        if (decoded.status !== "confirmed" || decoded.name !== label) {
          const actual = `${decoded.status} ${JSON.stringify(decoded.name)}`;
          throw new Error(`expected ${JSON.stringify(label)}; actual ${actual}; ${decoded.reason ?? ""}`);
        }
        const usages = group === "typeInfos" ? [1] : group === "stringLiterals" ? [5] : [3, 6];
        if ("usage" in decoded && !usages.includes(decoded.usage ?? -1)) {
          throw new Error(`Unexpected metadata usage kind ${decoded.usage}`);
        }
      });
    }
  }
  finish("metadata registries", failures, ["wasm", "registrations", "types", "methods"]);
});

withBuild(`${map.name} map: virtual slots and literal constants match metadata`, () => {
  const failures: string[] = [];
  for (const [key, [vslot, label]] of Object.entries(map.virtualSlots)) {
    attempt(failures, `virtualSlots.${key}`, () => {
      const rows = re.findMethods(label).filter(m => m.label === label);
      if (rows.length !== 1 || rows[0].slot !== vslot) {
        throw new Error(`expected one ${label} at managed slot ${vslot}; found ${rows.map(m => m.slot).join(",")
          || "none"}`);
      }
    });
  }
  for (const [key, [value, label]] of Object.entries(map.literals)) attempt(failures, `literals.${key}`, () => {
    const separator = label.lastIndexOf("::"),
      fields = re.fieldByName(label.slice(0, separator), label.slice(separator + 2));
    if (fields.length !== 1 || fields[0].metadataDefault?.value !== value) {
      throw new Error(`expected ${label} = ${value}; found ${JSON.stringify(fields.map(f => f.metadataDefault))}`);
    }
  });
  finish("virtual slots and literals", failures, ["methods", "fields"]);
});

withBuild(`${map.name} map: instance fields match names, ancestor layout and unboxed value-type offsets`, () => {
  const failures: string[] = [];
  for (const [typeKey, table] of Object.entries(map.fields)) for (const [key, offset] of Object.entries(table)) {
    attempt(failures, `field.${typeKey}.${key}`, () => verifyField(typeKey, key, offset, "instance"));
  }
  // The page also reads ProductData fields through EquipmentProductData instances.
  for (const [key, offset] of Object.entries(map.fields.ProductData ?? {})) {
    attempt(failures, `inherited EquipmentProductData.${key}`, () =>
      verifyField("EquipmentProductData", key, offset, "instance"));
  }
  finish("instance fields", failures, ["types", "fields"]);
});

withBuild(`${map.name} map: static fields belong to the static_fields block, not instance/literal storage`, () => {
  const failures: string[] = [];
  for (const [typeKey, table] of Object.entries(map.staticFields)) for (const [key, offset] of Object.entries(table)) {
    attempt(failures, `staticField.${typeKey}.${key}`, () => verifyField(typeKey, key, offset, "static-field-block"));
  }
  finish("static fields", failures, ["types", "fields"]);
});
}

withBuild("every patch window matches its original, unfolded function and direct patch callees are identified", () => {
  const failures: string[] = [];
  const bytes = readFileSync(re.sources.wasm.path);
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  expect(hash).toBe(re.sources.wasm.sha256);
  expect(patchExports.ORIGINAL_WASM_SHA256).toBe(hash);
  const groups = Object.entries(patchExports).filter((entry): entry is [string, patchExports.Patch[]] =>
    Array.isArray(entry[1]));
  // Every served patch belongs to an exported group checked below, and every group is served by some profile.
  const served = new Set(Object.values(profiles).flatMap(profile => profile.patches));
  expect([...served].filter(patch => !groups.some(([, patches]) => patches.includes(patch)))).toEqual([]);
  expect(groups.filter(([, patches]) => !patches.some(patch => served.has(patch))).map(([name]) => name)).toEqual([]);
  const byFunction = new Map<number, patchExports.Patch[]>();
  for (const [group, patches] of groups) for (const [index, patch] of patches.entries()) {
    attempt(failures, `${group}[${index}] f${patch.f}@${hex(patch.offset)}`, () => {
      const decoded = re.disasm(patch.f), body = decoded.body;
      if (!body || !decoded.complete) {
        throw new Error(`Unknown/incomplete function body: ${decoded.error?.message ?? "import"}`);
      }
      // A folded body is shared: patching it would change every aliased method.
      const aliases = re.methodsByFunc(patch.f);
      if (aliases.length > 1) {
        throw new Error(`folded body shared by ${aliases.length} methods: ${aliases.slice(0, 3).map(m =>
          m.label).join(" | ")}`);
      }
      if (!patch.before.length || patch.offset < body.offset
        || patch.offset + patch.before.length > body.offset + body.size)
        throw new Error(`window length ${patch.before.length} outside [${hex(body.offset)}, ${hex(body.offset
          + body.size)})`);
      const actual = bytes.subarray(patch.offset, patch.offset + patch.before.length);
      if (patch.before.some((byte, i) => byte !== actual[i])) {
        throw new Error(`before=${Buffer.from(patch.before).toString("hex")}; original=${actual.toString("hex")}`);
      }
      if (patch.after.length !== patch.before.length) throw new Error("Patch changes its window length");
      const patches = byFunction.get(patch.f) ?? [];
      patches.push(patch);
      byFunction.set(patch.f, patches);
    });
  }
  const directTargets = new Set<number>(), originalTargets = new Set<number>();
  for (const [f, patches] of byFunction) attempt(failures, `replacement instruction decoding f${f}`, () => {
    const original = re.disasm(f), body = original.body!;
    for (const instruction of original.instructions) { // disasm offsets are absolute file offsets
      const start = instruction.offset;
      if ((instruction.op === "call" || instruction.op === "return_call")
        && patches.some(p => start >= p.offset && start + instruction.size <= p.offset + p.before.length)) {
        originalTargets.add(Number(instruction.args[0]));
      }
    }
    // Only an in-memory copy is changed. Never invoke deriveWasm, compile or run it.
    const copy = Uint8Array.from(bytes.subarray(body.offset, body.offset + body.size));
    const touched = new Set<number>();
    for (const patch of patches) {
      for (let i = 0; i < patch.after.length; i++) {
        const offset = patch.offset - body.offset + i;
        if (touched.has(offset)) throw new Error(`Overlapping replacement byte at ${hex(body.offset + offset)}`);
        touched.add(offset);
        copy[offset] = patch.after[i];
      }
    }
    const decoded = decodeBody(copy, { offset: 0, size: copy.length });
    if (!decoded.complete) throw new Error(`Unknown instruction at ${hex(body.offset
      + decoded.error!.offset)}: ${decoded.error!.message}; raw=${decoded.error!.rawHex}`);
    for (const instruction of decoded.instructions) {
      const start = body.offset + instruction.offset;
      if ((instruction.op === "call" || instruction.op === "return_call")
        && patches.some(p => start >= p.offset && start + instruction.size <= p.offset + p.after.length)) {
        directTargets.add(Number(instruction.args[0]));
      }
    }
  });
  const expected = [
    [170492, 7058, "UnityEngine.Component::get_gameObject", ["i32", "i32"], ["i32"]],
    [50251, 8027, "GameObjectExtensions::SetActiveEfficient", ["i32", "i32", "i32"], []],
  ] as const;
  for (const [f, slot, label, params, results] of expected) attempt(failures, `direct patch callee f${f}`, () => {
    const aliases = re.methodsByFunc(f);
    if (aliases.length !== 1 || aliases[0].label !== label || re.funcBySlot(slot) !== f) {
      throw new Error(`expected unique ${label}, slot:${slot}; aliases=${aliases.map(m =>
        `${m.index}:${m.label}`).join(" | ")}`);
    }
    const signature = re.disasm(f).signature;
    if (JSON.stringify(signature) !== JSON.stringify({ params, results })) {
      throw new Error(`Wrong signature ${JSON.stringify(signature)}`);
    }
  });
  // Calls inside replacements either keep an original call of that window or are the two confirmed introductions.
  const introduced = [...directTargets].filter(f => !originalTargets.has(f)).sort((a, b) => a - b);
  if (JSON.stringify(introduced) !== JSON.stringify([50251, 170492])) {
    failures.push(`Direct targets introduced by replacement windows: ${introduced.map(f =>
      `f${f}`).join(", ")}; expected f50251, f170492`);
  }
  finish("patches", failures, ["wasm", "methods", "elements"]);
}, 10_000);

/** The tables page code reads, by the name it reads them under. */
const TABLES = ["slot", "typeInfo", "methodInfo", "vslot", "literal", "stringLiteral", "field", "staticField",
  "runtime"];
/**
 * Every `table.key` (and `field.Type.key`, `staticField.Type.key`) a page file reads, through a property access, a
 * string element access (`field['Photon.Realtime.Player']`) or an alias (`const L = field.AquaCannonLevelData`).
 * Parsed with TypeScript, so comments and strings never keep an entry alive.
 */
function references(file: string) {
  const found = new Set<string>(), alias = new Map<string, string>();
  const base = (node: ts.Expression): string | undefined => {
    if (ts.isIdentifier(node)) return TABLES.includes(node.text) ? node.text : alias.get(node.text);
    if (ts.isPropertyAccessExpression(node)) {
      const owner = base(node.expression);
      return owner && `${owner}.${node.name.text}`;
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
      const owner = base(node.expression);
      return owner && `${owner}.${node.argumentExpression.text}`;
    }
    return undefined;
  };
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const target = base(node.initializer);
      if (target && /^(field|staticField)\.[^.]+$/.test(target)) alias.set(node.name.text, target);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const reference = base(node);
      if (reference) found.add(reference);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  return found;
}
/** The files of a map's own code: every TypeScript file in its directory but the map. */
const codeOf = (map: SymbolMap) => [...new Bun.Glob("**/*.ts").scanSync(map.dir)].map(file => resolve(map.dir, file))
  .filter(file => file !== map.file).sort();

for (const map of maps) test(`${map.name} map: every key is read by its own code`, () => {
  const files = codeOf(map), read = new Set(files.flatMap(file => [...references(file)]));
  expect(files.length).toBeGreaterThan(0);
  const dead: string[] = [];
  for (const [prefix, table] of [["slot", map.slots], ["typeInfo", map.typeInfos], ["methodInfo", map.methodInfos],
    ["vslot", map.virtualSlots], ["literal", map.literals], ["stringLiteral", map.stringLiterals],
    ["runtime", map.runtime]] as const) {
    for (const key of Object.keys(table)) if (!read.has(`${prefix}.${key}`)) dead.push(`${prefix}.${key}`);
  }
  for (const [prefix, table] of [["field", map.fields], ["staticField", map.staticFields]] as const) {
    for (const [type, fields] of Object.entries(table)) for (const key of Object.keys(fields)) {
      if (!read.has(`${prefix}.${type}.${key}`)) dead.push(`${prefix}.${type}.${key}`);
    }
  }
  if (dead.length) throw new Error(`Keys in ${relative(root, map.file)} no ${map.name} code reads:\n${dead.sort()
    .join("\n")}\nScanned ${files.length} page files.`);
  expect(dead).toEqual([]);
});

test("the hero map adds keys and never redefines a core one", () => {
  const [core, hero] = maps;
  if (!hero) return;
  const keys = (map: SymbolMap) => [
    ...[map.slots, map.typeInfos, map.methodInfos, map.virtualSlots, map.literals, map.stringLiterals, map.runtime]
      .flatMap((table, k) => Object.keys(table).map(key => `${k}.${key}`)),
    ...[map.fields, map.staticFields].flatMap((table, k) => Object.entries(table).flatMap(([type, fields]) =>
      Object.keys(fields).map(key => `f${k}.${type}.${key}`)))];
  const own = new Set(keys(core!));
  expect(keys(hero).filter(key => own.has(key))).toEqual([]);
});
