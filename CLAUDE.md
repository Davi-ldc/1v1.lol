# Project rules

Start at [docs/SKILL.md](docs/SKILL.md) and read the references it lists for your task. Subagents read it too.

## Goal and evidence

- Recreate the original 1v1.LOL Unity client 1:1 for offline and LAN play; only the server is ours. Do not build an approximate shooter.
- Reverse engineer before changing gameplay. Do not invent controls, dimensions, grid, reach, collisions, fire rate or damage.
- Every conclusion cites a file hash and an object, field, method or offset. Keep confirmed, inferred and unknown apart.
- Names and dummy DLLs are not recovered bodies; a loader that boots is not a working match.
- Offline player profile: the original constructor's native `ServerUser` (not a login). Everything recovered is unlocked at the original maximum level, with the original slots and stats and no invented progression.
- Keep: C selects the ramp; no translucent preview; a ramp is not a solid wedge; selecting is not placing.
- A deliberate departure from the original is a declared adaptation: the code says so in one line, with the reason.

## Simplicity

- Simplify whenever possible. One native runtime (`src/page/native.ts`), one map (`src/page/symbols.ts`), one probe; each concept is one adapter (`src/page/adapters/`). The custom heroes are one optional unit, the `heroes/` folder (with its own map), installed only with hero directories (`--heroes`). Code lines are at most 120 columns.
- Every slot, cell or offset in use goes into the map under its recovered name (`bun run re`) and is checked by `tests/unit/symbols.test.ts`.
- Native state is the authority; no mirrors. Delete code that is proven unused.
- Comments say what the code does and why, in the original's terms. They never carry run IDs, dates, agent names or the history of attempts; explanations of the original game belong in `docs/reference/`.

## Safety and tools

- `artifacts/` holds the original files and bundles, pinned by hash and never tracked: `bun run setup` builds it from `playtika/`, or the user copies in their own build. `src/host/build/pins.ts` is their inventory. `re/extract/` holds the scripts that extract data from the original build; the data they write stays local in `re/data/`. `runs/` is disposable; the run IDs and results that matter go into the commit message.
- The original game files are tracked in `playtika/`, with a notice that they are Playtika's (user decision). The hero files (`heroes/files/`) are tracked only in the private repository; `main` ignores them, and a test enforces it. Game files are never downloaded, and each is checked by size and SHA-256 before it is served. The client never uses a CDN. Do not mix versions or catalogs.
- The custom heroes' models and names are private. Tracked files name a hero only by its slot (`beam`, `elastic`), and a test enforces it on `main`; the names live in the heroes directory's `names.json`, and notes about the heroes themselves in the git-ignored `heroes/specifics.md`.
- Do not use real accounts or connect the client to the old services. Git never tracks dumps or `runs/`.
- Probes run in a namespace with no outside network, a disposable browser and canaries, with no fallback. `play` runs the user's browser against a loopback-only server with CSP and guards; it is not equivalent to the namespace.
- Adapters declare their native boundary and evidence, and never fake success for unknown data.
- Bun, never npm or npx. Write and Edit for code and docs; Bun to generate artifacts. Python appears only as the extractors in `re/extract/`, run with `-B`; anywhere else it only reads and prints.

## Docs

- Everything is in English. Every Markdown file stays under 40 KB; aim for short, direct files. Prose is not hard-wrapped: one line per paragraph or list item.
- `docs/reference/` describes only the original game. `docs/architecture.md` describes this project; `heroes/README.md` describes the heroes unit and the hero directories (`--heroes`, the repository's `heroes/files/`), which `main` never tracks.
- Skills hold procedure, never state. Use the [humanizer skill](.claude/skills/humanizer/SKILL.md) for prose.

## Fronts

- Delegate with the `delegate` skill: each front owns its files, and research is not duplicated. Shared registries are integrated by the lead after checking them.
- Probes run one at a time, through the probe queue in the `milestone` skill.
- Short steps, at most three validation commands per milestone. Visual review happens with the user; agents do not replace that acceptance.
