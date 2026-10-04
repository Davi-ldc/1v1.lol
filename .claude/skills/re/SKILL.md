---
name: re
description: Investigate the original 1v1.LOL WASM/IL2CPP build before changing behavior. Find methods, types, fields and metadata cells, disassemble and trace calls with `bun run re`, and record findings with evidence. Use for any question about how the original client works.
---

# Reverse engineering the original client

Source of truth: `artifacts/extracted/WebGL.wasm` (SHA-256 52b3dc8a…) and the IL2CPP tables in `re/data/il2cpp/` (methods, types, fields, parameters, wasm-elements, registrations). Never guess what the binary does. Start with `docs/reference/`, which describes what is already known per system; its notation is in `docs/reference/il2cpp.md` (Conventions). `re/README.md` describes the tool, its library and the extractors.

## Tool (`re/cli.ts`, stdout only)

```sh
bun run re method <name|f123|slot:456>   # label, funcIndex, tableSlot, body offset/size, params, alias count
bun run re slot <n>                      # table slot → function (managed or not)
bun run re type <name|type:697> [--methods]
bun run re field <Type|type:697> <offset|name> [--instance|--static]
bun run re cell <0xaddr> [--il2cpptype]  # metadata-usage cell → TypeInfo/MethodDef/MethodRef/FieldInfo/string
bun run re disasm <f123|slot:456>        # instructions with call targets named; first column is the file offset
bun run re calls <f123>  |  bun run re callers <f123>
bun run re xref <0xaddr> [--all]         # i32.const sites of a cell, grouped per function (capped unless --all)
```

Each output starts with one stamp line (`;; build wasm 52b3dc8a metadata 7aa3236f`); `--sources` lists every input path and hash. Inputs are verified by SHA-256 when loaded.

`tableSlot ≠ funcIndex ≠ file offset`. Identical bodies are folded: one function can have hundreds of aliases, so a name is only pinned by a table slot or a MethodInfo.

Enum members and `const` fields have no storage; their values are metadata defaults, in the `metadataDefault` column of `re/data/il2cpp/fields.tsv`. The tool does not print them.

## Evidence standard

- Confirmed: read from bytes, metadata, disassembly or a run, with file/hash plus method, field or offset.
- Inferred: depends on an unverified link; say which.
- Unknown: leave it unknown. Serialized values are not effective values after remote balancing.

## Recording

- A symbol the page uses goes into `src/page/symbols.ts` with its recovered label (or `f<index>` when no row pins the slot). `tests/unit/symbols.test.ts` must pass.
- How the original works goes into the matching `docs/reference/<system>.md`, in English, with its evidence and without describing our code. Results go into the commit message. `runs/` is disposable. No per-task report files.
- `artifacts/` and the data files in `re/data/` are pinned by hash: read them, never edit them.

## Delegation

Mechanical sweeps (decode tables, disassemble a call chain, list callers, cross-check offsets) go to the read-only `re-sweep` agent, briefed as in the `delegate` skill: exact inputs, the question and this evidence standard. What a finding means is the lead's judgment, verified before use.
