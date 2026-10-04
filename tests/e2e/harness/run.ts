import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { integrityProblems, PROJECT_ROOT, sha256, verifyInputs } from '../../../src/host/build/inputs';
import type { Profile } from '../../../src/host/profiles';
import { startHost } from '../../../src/host/server';
import { EventLog } from './events';

export type Host = Awaited<ReturnType<typeof startHost>>;
export type Run = Awaited<ReturnType<typeof createRun>>;
type Manifest = Record<string, unknown>;

/** New, exclusive runs/<timestamp>-<kind>-<id>/ directory; existing runs are never reused. */
async function createRun(kind: string) {
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}-${randomUUID().slice(0, 8)}`;
  const path = resolve(PROJECT_ROOT, 'runs', id);
  await mkdir(resolve(PROJECT_ROOT, 'runs'), { recursive: true });
  await mkdir(path);
  const write = (name: string, data: unknown) => Bun.write(resolve(path, name), JSON.stringify(data, null, 2) + '\n');
  return { id, path, write };
}

/** SHA-256 of the code that produced a run: the host, the page, the probe and, when present, the heroes. */
async function sourceHashes() {
  const files = ['package.json', 'bun.lock'];
  for (const directory of ['src', 'tests/e2e', 'heroes/page', 'heroes/scenarios']) {
    if (!existsSync(resolve(PROJECT_ROOT, directory))) continue;
    for (const entry of await readdir(resolve(PROJECT_ROOT, directory), { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) files.push(relative(PROJECT_ROOT, resolve(entry.parentPath, entry.name)));
    }
  }
  const hashes: Record<string, string> = {};
  for (const file of files.sort()) hashes[file] = sha256(await Bun.file(resolve(PROJECT_ROOT, file)).bytes());
  return hashes;
}

interface RunOptions<Summary> {
  /** runs/<timestamp>-<kind>-<id>/ */
  kind: string;
  profile: Profile;
  port?: number;
  /** Extra Host headers (a local reverse proxy's name), access key and player-ID file (play --public). */
  hosts?: string[];
  key?: string;
  /** play --open: the key is optional (src/host/server.ts startHost). */
  open?: boolean;
  lanIds?: string;
  /** The custom heroes' directory (--heroes, heroes/README.md). */
  heroes?: string;
  /** Manifest fields after id, startedAt and profile. */
  manifest: Manifest;
  /** The host's event log, in the run directory. */
  eventsFile: string;
  body(context: { host: Host; run: Run; manifest: Manifest; signal: AbortSignal }): Promise<void>;
  summary(problems: string[], events: EventLog, run: Run): Summary;
}

/**
 * One recorded host session: verify the inputs, open the run with the source hashes, start the host, run `body`
 * (interrupted by SIGINT/SIGTERM through `signal`), stop the host, verify again and write the manifest, the host events
 * and the summary. Exit code: 0 passed or stopped, 1 failed, 2 nothing checked.
 */
export async function withRun<Summary extends { status: string }>(options: RunOptions<Summary>) {
  const inputsBefore = await verifyInputs();
  const run = await createRun(options.kind);
  const manifest: Manifest = { id: run.id, startedAt: new Date().toISOString(), profile: options.profile,
    ...options.manifest, inputsBefore, sources: await sourceHashes() };
  const abort = new AbortController();
  process.once('SIGINT', () => abort.abort());
  process.once('SIGTERM', () => abort.abort());
  const events = new EventLog(), problems: string[] = [];
  let host: Host | undefined;
  try {
    if (!inputsBefore.ok) throw new Error('Preserved inputs failed verification before launch.');
    host = await startHost({ profile: options.profile, port: options.port, hosts: options.hosts, key: options.key,
      open: options.open, lanIds: options.lanIds, heroes: options.heroes, record: events.record });
    Object.assign(manifest, { wasmSha256: host.wasmSha256, pageSha256: host.pageSha256,
      heroesSha256: host.heroesSha256, heroes: host.heroes, heroNamesSha256: host.heroNamesSha256 });
    await options.body({ host, run, manifest, signal: abort.signal });
  } catch (error) {
    problems.push(String(error));
  }
  host?.stop();
  const inputsAfter = manifest.inputsAfter = await verifyInputs();
  problems.push(...integrityProblems(inputsBefore, inputsAfter));
  manifest.finishedAt = new Date().toISOString();
  const summary = options.summary(problems, events, run);
  await run.write('manifest.json', manifest);
  await run.write(options.eventsFile, events.snapshot());
  await run.write('summary.json', summary);
  process.exitCode = summary.status === 'failed' ? 1 : summary.status === 'observed' ? 2 : 0;
  return summary;
}
