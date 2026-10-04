---
name: native-adapter
description: Conventions for changing how the local page interacts with the original Unity client. Native calls, table-slot hooks, WASM byte patches, observers and profiles. Use before editing src/page/ or src/host/wasm.ts.
---

# Changing the local layer

The goal is the original game running 1:1. The local layer only supplies what the missing servers used to supply, at the native boundary that reverse engineering found (see the `re` skill). `docs/architecture.md` describes the whole layer, the native runtime's API and one line per adapter and per patch. The checklists for adding an adapter or a WASM patch are in `docs/SKILL.md`.

## Where things live

- `src/host/wasm.ts`: byte patches `{ f, offset, before, after, why }`, grouped per purpose. `deriveWasm` checks the original bytes, overlap and the profile's pinned SHA-256; a patched function must not be a folded body (`tests/unit/symbols.test.ts`).
- `src/host/profiles.ts`: per profile, the entry scene, page `features`, Addressables, patches and the pinned WASM hash.
- `src/page/native.ts`: the native runtime. Use its reads, writes, guards, `scratch`, `waitFor` and `prepareHook`; do not re-implement them.
- `src/page/symbols.ts`: every slot, cell and offset, with its recovered name, read literally (`slot.x`, `field.Type.key`), since the unused-key test only sees that form. A raw slot, cell or offset in any other file is a bug.
- `src/page/game.ts`: read accessors of original singletons (scene, mode, FirebaseManager and ServerUser, LoadoutScreen, LocalProductsData, factories, remote-config handlers).
- `src/page/adapters/`: one concern per file. `main.ts` lists them in install order, and the first failure stops the entry.
- `src/page/browser.ts`: guards, the auth Error reply and raw pointer lock, before the loader. `boot.ts`: the original scene entry. `observe/`: read-only observers (`window.local.observe`).
- `heroes/page/`: the custom heroes, an optional unit outside `src/page/` with its own map (`heroes/README.md`).

## Rules

- Prefer, in order: the original code path, then a table-slot hook (`prepareHook`, forwarding every call it does not own), then a byte patch. Each needs RE evidence.
- Never fabricate logins, balances, completion flags, success callbacks, AsyncOperationHandles or replacement assets. Unknown data gets a faulted or absent path, not a fake success.
- The only local user is the native `ServerUser` from its original constructor, installed by `FirebaseManager::SetServerUser`; `UserExists` and `IsLoggedIn` stay false.
- Supply data through original constructors and methods with original IDs and levels. Stage factories privately and publish only after native lookups succeed.
- Async patches keep task completion and native notifications. Adapters stay synchronous once native mutation starts; install hooks last.
- A constant that tunes a hero is listed by name in `heroes/README.md`; why it has its value goes in the git-ignored `heroes/specifics.md`. Hero code names a hero only by its slot.
- Observers never write game state and avoid instance-creating getters (`mesh`, `materials`).

## Checks

`bun run typecheck` and `bun test`, then the relevant scenarios through the `milestone` skill.
