# Reverse engineering

Static readers for the original build. `bun run re` answers questions about the WASM and the IL2CPP metadata; the tests use the same code to check the symbol map and the patches. People read [docs/reference/](../docs/reference/) for what the original does; the [`re` skill](../.claude/skills/re/SKILL.md) explains the queries and the evidence standard.

| Path | What it is |
|---|---|
| `cli.ts` | `bun run re <command>`: parses the command line and prints to stdout only |
| `lib/` | `index.ts` (`openRe`, the toolkit), `wasm.ts` (module and body decoder), `metadata.ts` (metadata cells and `Il2CppType`), `tables.ts` (the table reader, which pins every input by SHA-256), `format.ts` (output text) |
| `extract/` | the Python extractors, the only Python in the project, run with `-B` |
| `data/` | what the extractors write; local and ignored by git |

## Extractors

Each script finds the repository root from its own location, reads `artifacts/` and writes only into its folder of `data/`.

| Folder | Scripts | Output in `data/` | Read by |
|---|---|---|---|
| `extract/il2cpp/` | `recover.py`, with `static_il2cpp.py` and `wasm_disasm.py`; `export_schemas.py` | `il2cpp/`: `methods.tsv`, `types.tsv`, `fields.tsv`, `parameters.tsv`, `wasm-elements.tsv`, `wasm-structure.json`, `registrations.json`, golden disassemblies in `disassembly/`, and `unity-field-schemas.json` | `bun run re` (`lib/tables.ts` pins their hashes), `tests/unit/re.test.ts`, `tests/unit/symbols.test.ts`, `extract/assets/decode_managed.py` |
| `extract/assets/` | `unity_assets.py`, then `scan_assets.py`, `extract_selected.py`, `decode_managed.py` | `assets/`, one folder per stage ([below](#asset-stages)): the UnityFS and SerializedFile inventory, the prefab hierarchy, meshes, decoded MonoBehaviours and the InputManager asset | [building.md](../docs/reference/building.md), [controls.md](../docs/reference/controls.md) |

```sh
python3 -B re/extract/il2cpp/recover.py           # then export_schemas.py
python3 -B re/extract/assets/unity_assets.py      # then scan_assets.py, extract_selected.py, decode_managed.py
```

`lib/tables.ts` pins the SHA-256 of the IL2CPP tables, so a rebuild that changes them fails loudly. Without `data/il2cpp/`, `bun run re` stops and the tests that read the tables are skipped.

### Asset stages

Each asset script writes one folder of `data/assets/`; a later stage reads an earlier one's folder.

| Folder | Written by | Files |
|---|---|---|
| `inventory/` | `unity_assets.py` | `unityfs-inventory.json`, `serialized-inventory.json`, `objects.jsonl` (every object), `parse-errors.json` |
| `selected/` | `scan_assets.py` | `monoscripts.json`, `relevant-monoscripts.json`, `gameobject-name-counts.json`, `selected-gameobjects.json`, `selected-monobehaviours.json`, `mesh-inventory.json`, `input-manager.bin`, `input-manager.json`, `scan-errors.json` |
| | `extract_selected.py`, reading `monoscripts.json` and `selected-monobehaviours.json` | `objects/` (the bytes of each selected object, named in `raw_file`), `meshes/` (positions and faces as `.obj`), `prefab-hierarchy.json`, `selected-objects.json`, `selected-pptrs.json`, `build-player-settings.json`, `selected-extraction-errors.json`, and `input-manager.json` again, from the followed objects |
| `managed/` | `decode_managed.py`, reading `selected-objects.json`, `objects/` and `il2cpp/unity-field-schemas.json` | `managed-decoded.json`, `managed-decode-failures.json`, `managed-used-schemas.json` |

The integrity inventory of the preserved originals is not here: it is `src/host/build/pins.ts`, which `bun run verify` and every probe check the files against.
