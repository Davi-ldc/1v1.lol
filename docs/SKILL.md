---
name: 1v1
description: Run the original 1v1.LOL Unity WebGL client offline and over LAN, with a local server in place of the dead services
---

# 1v1.LOL offline

This project runs the original 1v1.LOL client offline and on a LAN, and the original client is the authority. The host serves the original files, checked by hash, plus two derived ones: the Addressables catalog, pointed at the host instead of the CDN, and the WASM, with byte patches where nothing else reaches the code. The page calls or hooks the client's own methods to supply what the dead services used to. Each change is the smallest one that lets the original code path run without those services. The project rules are in [CLAUDE.md](../CLAUDE.md).

## Pins

| Item | Value |
|---|---|
| Client | 1v1.LOL WebGL build 4.713 |
| Engine | Unity 2022.3.53, IL2CPP to WebAssembly |
| Original WASM | `52b3dc8a…` (`artifacts/extracted/WebGL.wasm`, the decompressed `WebGL.wasm.unityweb`) |
| Metadata | `global-metadata.dat` `7aa3236f…`, version 31 |
| Addressables | catalog 4.701 and its 19 bundles under `artifacts/original/referenced-assets/` |
| Served WASM | practice `fdb733fb…` (8 patches); menu and lan `b565b6a6…` (30 patches) |
| Preserved inputs | 42 files, checked by size and SHA-256 (`bun run verify`, `src/host/build/inputs.ts`) |

`tests/unit/docs.test.ts` fails when this table disagrees with `src/host/profiles.ts` or with the inputs in `src/host/build/`.

## Where to start

Find the task, read the docs in the order given, then load the skill. Skills are in `.claude/skills/<name>/SKILL.md`, and the code layout is in [architecture.md](architecture.md#layout). A change to gameplay also needs the reference for its system ([References](#references)).

| Task | Read | Skill |
|---|---|---|
| How the original client works | [il2cpp.md](reference/il2cpp.md), then the system's reference | `re` |
| Adapter or observer | [Adapters](architecture.md#adapters), [Add an adapter](#add-an-adapter) | `native-adapter` |
| WASM patch | [il2cpp.md](reference/il2cpp.md), [Add a WASM patch](#add-a-wasm-patch) | `native-adapter`, `re` |
| Profile, `src/host/profiles.ts` | [Profiles](architecture.md#profiles) | `native-adapter` |
| Host server, `play`, `./start` | [Host](architecture.md#host), [Tools](architecture.md#tools) | |
| Local Photon server | [Photon server](architecture.md#photon-server), [network.md](reference/network.md) | `re` |
| Pinned inputs, `src/host/build/` | [Inputs](architecture.md#inputs), [build.md](reference/build.md) | |
| `re` tool or an extractor, `re/` | [re/README.md](../re/README.md) | `re` |
| Unit test, `tests/unit/` | [Tools](architecture.md#tools) | |
| Scenario or probe harness, `tests/e2e/` | [Probe](architecture.md#probe) | `milestone` |
| Running a probe | wait in the [probe queue](../.claude/skills/milestone/SKILL.md#probe-queue) | `milestone` |
| Custom hero, `heroes/` | [heroes/README.md](../heroes/README.md) | `native-adapter` |
| Docs | the Docs rules in [CLAUDE.md](../CLAUDE.md#docs), [References](#references) | `humanizer` |
| Splitting work across agents | | `delegate` |
| Closing a change | | `milestone` |

## Glossary

- fNNNN: a function index in the WASM. `bun run re disasm fNNNN` prints it. A function index, a table slot and a file offset are three different numbers.
- Slot: an index in the WASM function table. Only a call that goes through the table can be hooked; a direct call cannot.
- Cell: a metadata usage cell in linear memory that holds a resolved TypeInfo, MethodRef or StringLiteral pointer.
- Patch: a byte-for-byte change to one function body, with its `before`, `after` and reason (`src/host/wasm.ts`).
- Adapter: one concept on the page side (`src/page/adapters/`). It hooks or calls original methods and declares its native boundary.
- Observer: a read-only function in `src/page/observe/` that returns plain JSON to scenarios through `window.local.observe`.
- Feature: a name in the `Feature` union (`src/host/profiles.ts`) for one part of the page: the browser shims, an adapter or the heroes' extension. A profile lists the features its page installs.
- Profile: `baseline`, `practice`, `menu` or `lan`. It picks the entry scene, the features and the patches. The player profile is a different thing, the native `ServerUser`.
- Probe: an isolated, scripted browser session that runs scenarios and checks their results (`bun run probe`).
- Scenario: one probe script, in `tests/e2e/scenarios/<practice|menu|lan>/` or, for the heroes, `heroes/scenarios/`. It drives real input and reads native state through observers.
- Canary: a loopback server outside the page's origin. The probe browser must fail to reach it by every channel, and a request that arrives there fails the run.
- Declared adaptation: a deliberate departure from the original, stated in one line where it happens.
- Hero: a custom champion, built on copies of original champions and abilities, in one of two slots named by its mechanic (`beam`, `elastic`). All of it is in `heroes/`. A hero turns on only when its directory (`<dir>/beam/`, `<dir>/elastic/`) and `<dir>/names.json` are under `--heroes <dir>` or, for `play`, under the repository's `heroes/files/`. Its models and names are private; tracked files name it only by slot.
- PUN: Photon Unity Networking, the client's multiplayer layer.
- Front and lead: when work is split across agents, each front owns some files in its own worktree, and the lead merges them (`delegate` skill).

## References

The files in `reference/` describe the original game and never this project. Their notation is defined once, in [il2cpp.md](reference/il2cpp.md#conventions), so read that section first.

- [build.md](reference/build.md): the shipped files, versions, the data container, scenes and how the loader starts.
- [il2cpp.md](reference/il2cpp.md): conventions, and how to read the WASM, metadata, slots, cells and object layouts.
- [boot.md](reference/boot.md): startup, Firebase, remote config, the server user, the age gate and the offline gates.
- [assets.md](reference/assets.md): Addressables, catalogs and bundles.
- [menu.md](reference/menu.md): screens, lobby, loadout, champions, Locker, game modes, nicknames, deep links.
- [network.md](reference/network.md): Photon, matchmaking, the connection, parties and in-match RPCs.
- [controls.md](reference/controls.md): input, controllers, the camera, the emote wheel and editing preferences.
- [movement.md](reference/movement.md): the motor's input, jumps, fall damage, knockback, remote players, cheats.
- [building.md](reference/building.md): build pieces, the grid, placing, health, damage and editing.
- [combat.md](reference/combat.md): health, the hit pipeline, weapons and abilities.

[architecture.md](architecture.md) describes this project, and [heroes/README.md](../heroes/README.md) the custom heroes. The README says what works today; each commit message says how its change was checked.

## Add an adapter

1. Find the native boundary with the `re` skill and describe the original behavior in the system's reference.
2. Add every slot, cell and offset the adapter uses to `src/page/symbols.ts` under its recovered name. `bun test` checks them.
3. Write `src/page/adapters/<name>.ts`. It exports an async `install<Name>(n)` that returns its counts as an object and throws `stage: reason` on failure.
4. Add the feature to the `Feature` union and to the profiles that need it (`src/host/profiles.ts`).
5. Add the adapter to the `adapters` list in `src/page/main.ts`, at its place in the install order.
6. If a scenario reads its state, add an observer in `src/page/observe/` and list it in the `observe` object of `main.ts`.
7. Add a scenario under `tests/e2e/scenarios/<profile>/` and register it by name in `tests/e2e/scenarios/index.ts`.
8. Add its row to the adapter table in [architecture.md](architecture.md#adapters). If it changes the README's "What works" or its declared adaptations, update them.

## Add a WASM patch

1. `bun run re disasm f<index>` prints each instruction with its file offset in the first column. The replacement has the same length as the bytes it replaces, padded with `nop` (`0x01`). The function must not be a folded body: `bun run re method f<index>` shows `aliasCount=1`.
2. Add `{ f, offset, before, after, why }`, or a `windowPatch`, to a named group in `src/host/wasm.ts`. `why` says what changes in the original's terms; a declared adaptation starts with "Adaptation:".
3. Add the group to the profile's patches in `src/host/profiles.ts` (`menuPatches` for menu and lan).
4. Run `bun test`. The host test fails with "Derived WASM hash … differs from the profile". After checking the patch, put that hash in the profile's `wasmSha256` (`MENU_WASM` for menu and lan).
5. Update [Pins](#pins), which the docs test checks, and the patch table in [architecture.md](architecture.md#wasm-patches).
