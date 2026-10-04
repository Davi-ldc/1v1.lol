---
name: milestone
description: Validate and close a milestone in this project. The three-command budget, the probe queue, isolated probe scenarios, hashes before and after, a commit message that records the result, and when to ask the user for visual review. Use when finishing any change to gameplay, menu or tooling.
---

# Closing a milestone

## Validate (at most three commands, no repeats)

1. `bun run typecheck`, then write `bun test` to a file and check the file for `0 fail`.
2. `bun run probe --profile practice --scenario movement,edit,weapon` and/or
3. `bun run probe --profile <menu|lan> --scenario <the affected scenarios>`

Run only the scenarios the change can affect. The run is in `runs/<id>/` (`summary.json`, per-scenario `samples.json`, screenshots); `runs/` is disposable, so what matters goes into the commit message. The probe's isolation, flags and exit codes are in `docs/architecture.md` (Probe).

Scenario checks encode results already confirmed; a new expectation needs its own evidence first. A new scenario goes in `tests/e2e/scenarios/<practice|menu|lan>/` (a hero's in `heroes/scenarios/`), registered by name, with `verdict()` checks, shared coordinates and helpers from `tests/e2e/scenarios/shared/menu.ts` (`shared/lan.ts` for two players), and real input only (no native writes).

## Probe queue

Probes share the CPU and software rendering slows under load, so timed checks can miss. Every probe waits for the slot:

```sh
while pgrep -f '^bun tests/e2e/index.ts' > /dev/null; do sleep 5; done
```

Wait on that pattern only, never on a scenario name. Close the browsers after each run.

## Record

- The commit message records the result: confirmed, inferred or unknown, the run IDs and the served WASM hashes. When the change alters what works, update the README's "What works". Docs are in English, each file under 40 KB.
- What the change taught about the original client goes into the matching `docs/reference/<system>.md`, stated in the original's terms (method, field, offset, hash). Our own design goes into `docs/architecture.md`; a hero's tuning constants into `heroes/README.md` by name, and why a value was chosen into the git-ignored `heroes/specifics.md`.
- Commit on `main` with the user's identity only: no `Co-Authored-By` or "Generated with" lines. Push only when the user asks. Never add `artifacts/`, dumps or `runs/`; hero files go only to the private repository.

## Ask the user

Only for a meaningful visual review or a decision that is theirs. The user's own server runs with `bun run play --profile <practice|menu|lan>` (loopback; their personal browser, not the namespace). Say what to look at, and do not run automation against it at the same time. Restarting a server the user's friends are playing on drops them: ask first, and after a restart tell the user to reload instead of opening a new tab. Agents and probes do not replace the user's acceptance.
