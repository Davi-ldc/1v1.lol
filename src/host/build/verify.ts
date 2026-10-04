import { type IntegrityResult, verifyInputs } from './inputs';

/** Prints a check of the pinned inputs, as `bun run verify` does; true when every pin matched. */
export function report(result: IntegrityResult) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'} integrity: ${result.matched}/${result.checked} pinned inputs ` +
    `(27 originals + Addressables); list ${result.inventorySha256}`);
  for (const issue of result.issues) console.error(`${issue.path}: ${issue.reason}`);
  return result.ok;
}

if (import.meta.main) process.exitCode = report(await verifyInputs()) ? 0 : 1;
