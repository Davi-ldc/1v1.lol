---
name: delegate
description: Split work into parallel agent fronts in this repo. One task per front, each in its own git worktree with exclusive file ownership; registries merged by the lead; the briefing template, scoped gates and the integration checklist. Use before launching any subagent that edits files, runs probes or does RE sweeps.
---

# Delegating fronts

The lead splits the work, briefs each front, reviews and merges. A front gets one task. Code fronts run in their own git worktree (`isolation: "worktree"`) and commit on their own branch; mechanical RE sweeps go to the read-only `re-sweep` agent. Probes run one at a time, so more fronts than the probe queue can serve only wait.

## What can be delegated

- Feature slice: one adapter in `src/page/adapters/` (or a hero file in `heroes/page/`), its observer function and its scenario in `tests/e2e/scenarios/<practice|menu|lan>/` (or `heroes/scenarios/`).
- Tool or harness: `re/**`, `tests/e2e/harness/**`, `src/host/server.ts`, `src/host/build/**`, `src/host/photon/**`.
- Docs: one or more files in `docs/` or `docs/reference/`, in English, each under 40 KB.
- RE sweep: no files; a report with evidence (`re` skill).

## Ownership and registries

Worktrees keep fronts from overwriting each other, but two fronts editing the same file still conflict at merge. Give each front exclusive files and name the neighbors it must avoid.

The registries are shared: `src/page/symbols.ts`, `src/host/wasm.ts`, `src/host/profiles.ts`, `src/page/main.ts`, `tests/e2e/scenarios/index.ts`, the adapter and patch tables in `docs/architecture.md`, the pins in `docs/SKILL.md`, `CLAUDE.md`, `README.md` and `.claude/**`. A front may add the entries it needs in its own branch (symbol rows with evidence, patches with the new pinned WASM hash, scenario registration, table rows) and lists them in its report. Only the lead edits `CLAUDE.md`, `README.md` and `.claude/**`, unless the brief hands them to the front. When two branches change `MENU_WASM`, the lead recomputes it at merge.

## Brief

1. Goal, in the original's terms.
2. Owned files (exact paths); everything else read-only. Name the fronts working nearby.
3. Inputs and evidence to start from; what is already confirmed.
4. Setup: `git merge --ff-only main`, then link the untracked inputs to the main checkout's folders: `artifacts`, `node_modules`, the extracted data `re/data` and, for hero work, the hero directories `heroes/files`:

   ```sh
   main=<main checkout>
   ln -s "$main/artifacts" artifacts
   ln -s "$main/node_modules" node_modules
   ln -s "$main/re/data" re/data
   ln -s "$main/heroes/files" heroes/files
   ```

5. Constraints: `CLAUDE.md`, the relevant skill, contracts other files depend on.
6. Gates, at most three: `bun run typecheck`, `bun test` (written to a file, checked for `0 fail`), and the probe scenarios the change can affect.
7. Report: files changed, gates with run IDs, registry entries, confirmed/inferred/unknown, open questions, the commit.

Fronts commit only on their own branch, with no `Co-Authored-By` or "Generated with" lines. They never touch `main`, never push, never use bare `git stash`, and never restart the user's `play` server.

## Probes

Every front's probes go through the probe queue in the `milestone` skill. When one front's probes are urgent, the lead may stop the other fronts' queued waits and tell them when to resume.

## Integration (lead)

1. `git log main..<branch>` and `git diff --stat main...<branch>`: ownership respected, nothing outside the brief.
2. Read the diff, merge, resolve conflicts keeping both sides, remove duplicate registry keys.
3. Run the gates on the merged `main` yourself.
4. Close with the `milestone` skill (validation, commit).
5. Remove the front's worktree and branch: `git worktree remove <path>` and `git branch -d <branch>`.
