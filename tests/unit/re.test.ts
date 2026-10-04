import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCli } from "../../re/cli.ts";
import { openRe } from "../../re/lib/index.ts";
import { tsvRows } from "../../re/lib/tables.ts";
import { BinaryReader, decodeBody, instructionText, type Instruction } from "../../re/lib/wasm.ts";
import { withBuild } from "./build.ts";

const root = resolve(import.meta.dir, "../..");
const re = openRe(root);
const hex = (n: number, width: number) => n.toString(16).padStart(width, "0");

withBuild.each([
  [3782, "000613_BuildingShapeState_get_ChildIndex_f3782.wat.txt"],
  [44860, "000785_DirectionalEditableBuilding_GetNonArrow_f44860.wat.txt"],
  [45002, "000952_EditingManager_Cancel_f45002.wat.txt"],
] as const)("f%d matches its golden disassembly", (f, filename) => {
  const golden = readFileSync(resolve(root, "re/data/il2cpp/disassembly", filename), "utf8");
  const header = (name: string) => golden.match(new RegExp(`^;; ${name} (.+)$`, "m"))![1];
  const normalize = (line: string) => line.split(";;")[0].trim().replace(/\s+/g, " ");
  const decoded = re.disasm(f);
  const line = (i: Instruction) => normalize(`${hex(i.offset, 8)} +${hex(i.relativeOffset, 4)} ${instructionText(i)}`);
  expect(decoded.complete).toBe(true);
  const expected = golden.split("\n").filter(l => /^[0-9a-f]+ \+/.test(l)).map(normalize);
  expect(decoded.instructions.map(line)).toEqual(expected);
  const [, offset, size] = header("file body offset").match(/^(0x[0-9a-f]+) \(\d+\); size (\d+) bytes$/)!;
  expect(decoded.body).toEqual({ offset: Number(offset), size: Number(size) });
  expect(decoded.signature).toEqual(JSON.parse(header("signature").replaceAll("'", '"')));
  expect(decoded.locals).toEqual([...header("additional local groups").matchAll(/\((\d+), '(\w+)'\)/g)]
    .map(([, count, type]) => ({ count: Number(count), type })));
});

withBuild("metadata cells and Il2CppType pointers decode through registration pointers only", () => {
  expect(re.decodeCell(0xac7514)).toMatchObject({ status: "confirmed", word: 0x20019293, usage: 1, index: 51529,
    name: "UserEquipment", type: { typeDefinitionIndex: 697 } });
  expect(re.decodeCell(0xabea2c)).toMatchObject({ status: "confirmed", type: { kind: 0x15 },
    name: "System.Collections.Generic.List`1<EquipmentProductData>" });
  expect(re.decodeCell(0xad4b70)).toMatchObject({ status: "confirmed", usage: 6, index: 187773,
    name: "JustPlay.ScriptableObjects.FactoryManagedInstance`1<EquipmentProductDataFactory>::get_Instance",
    methodSpec: { methodDefinitionIndex: 17925, classIndexIndex: 2973, methodIndexIndex: -1 } });
  expect(re.decodeCell(0xaf59dc)).toMatchObject({ status: "confirmed", usage: 4, field: { index: 20083 },
    fieldRef: { typeIndex: 28272, fieldIndex: 0 } });
  expect(re.decodeCell(0xaf6c84)).toMatchObject({ status: "confirmed", usage: 5, literal: "" });
  expect(re.decodeIl2CppType(0x9fc76c)).toMatchObject({ status: "confirmed", kind: 0x12, typeDefinitionIndex: 3768 });
  expect(re.decodeIl2CppType(0xf44d0)).toMatchObject({ status: "confirmed", kind: 0x1d, byref: true,
    name: "UnityEngine.TextCore.Text.TextProcessingStack`1<int>[]&" });
  // A cell is not an Il2CppType pointer (nor the reverse); memory outside the image stays unknown.
  expect(re.decodeCell(0x9fc76c).status).toBe("unknown");
  expect(re.decodeIl2CppType(0xac7514).status).toBe("unknown");
  expect(re.decodeCell(0xffffffff).status).toBe("unknown");
});

withBuild("table slots and type:<index> select exact rows; folded bodies keep every alias", () => {
  expect(re.funcBySlot(104165)).toBe(4073);
  expect(re.methodsBySlot(104165).map(m => m.label)).toEqual(["ServerUser::get_Equipment"]);
  expect(re.methodsByFunc(4073)).toHaveLength(317);
  expect(re.methodsByFunc(3782)).toHaveLength(994);
  expect(re.slot(1908)).toMatchObject({ funcIndex: 1679, status: "non-managed", aliasCount: 0 });
  expect(re.funcBySlot(0)).toBeUndefined();
  expect(re.type("type:1360").map(t => t.index)).toEqual([1360]);
  expect(re.type("1360").map(t => t.fullname)).toEqual(["__StaticArrayInitTypeSize=1360"]);
});

withBuild("whole-module callers and xref scans are complete", () => {
  expect(re.calleesReport(50671).functions).toContain(50668);
  expect(re.callersReport(50668)).toMatchObject({ complete: true, functions: [50667, 50671] });
  // FirebaseManager TypeInfo, loaded where LoadoutInventoryDisplay::GetNumOfOwnedProducts reads ServerUser.Equipment.
  const xref = re.xrefReport(0xac27f4);
  expect(xref.complete).toBe(true);
  expect(xref.hits).toHaveLength(1799);
  expect(xref.hits).toContainEqual({ funcIndex: 43517, offset: 0xeff162 });
}, 30_000);

test("parsers: TSV quoting, LEB bounds, FC opcodes and a stop at an unknown opcode", () => {
  expect([...tsvRows('a\tb\r\n"x\ty"\t"line\n""quote"""\r\nlast\t')])
    .toEqual([["a", "b"], ["x\ty", 'line\n"quote"'], ["last", ""]]);
  expect(() => [...tsvRows('"unterminated')]).toThrow("Unterminated");
  expect(new BinaryReader(Uint8Array.from([...Array(9).fill(0xff), 0])).i64()).toBe((1n << 63n) - 1n);
  expect(new BinaryReader(Uint8Array.from([...Array(9).fill(0x80), 0x7f])).i64()).toBe(-(1n << 63n));
  expect(() => new BinaryReader(Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x10])).u32()).toThrow("Invalid u32");
  const bytes = [0];
  for (let opcode = 0x45; opcode <= 0xc4; opcode++) bytes.push(opcode);
  for (let ext = 0; ext <= 17; ext++) {
    bytes.push(0xfc, ext, ...Array([8, 10, 12, 14].includes(ext) ? 2 : ext >= 9 ? 1 : 0).fill(0));
  }
  bytes.push(0x0b);
  const numeric = decodeBody(Uint8Array.from(bytes), { offset: 0, size: bytes.length });
  expect(numeric.complete).toBe(true);
  expect(numeric.instructions.find(i => i.op === "i64.extend32_s")).toBeDefined();
  expect(numeric.instructions.find(i => i.op === "memory.copy")?.args).toEqual([0, 0]);
  expect(numeric.instructions.find(i => i.op === "table.fill")?.args).toEqual([0]);
  const unknown = decodeBody(Uint8Array.from([0, 0x01, 0xfd, 0x10, 1, 0x0b]), { offset: 0, size: 6 });
  expect(unknown).toMatchObject({ complete: false, error: { offset: 2, rawHex: "fd10010b", remainingBytes: 4 } });
  expect(unknown.instructions.map(i => i.op)).toEqual(["nop"]);
});

withBuild("CLI output is citable and exits 1 on an unknown flag or a bad cell", () => {
  const { wasm, metadata } = re.sources;
  const stamp = `wasm ${wasm.sha256.slice(0, 8)} metadata ${metadata.sha256.slice(0, 8)}`;
  const cell = runCli(["cell", "0xac7514"], re);
  expect(cell.exitCode).toBe(0);
  expect(cell.output.split("\n")[0]).toBe(`;; build ${stamp}`);
  const sources = runCli(["cell", "0xac7514", "--sources"], re).output;
  for (const { path, sha256 } of Object.values(re.sources)) expect(sources).toContain(`${path} sha256=${sha256}`);
  const folded = runCli(["method", "f3782"], re).output;
  expect(folded).toContain("aliasCount=994");
  expect(folded).toContain("+986 more");
  expect(runCli(["cell", "0xac7514", "--output"], re).exitCode).toBe(1);
  expect(runCli(["cell", "0xffffffff"], re).exitCode).toBe(1);
});
