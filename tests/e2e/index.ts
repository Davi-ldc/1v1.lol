import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import type { Page } from 'playwright-core';
import { isProfile, profiles } from '../../src/host/profiles';
import { heroDirectories } from '../../src/host/server';
import { EventLog } from './harness/events';
import { checkIsolation, enterNetworkNamespace, launchGuardedBrowser, verifyNetworkNamespace, type RendererMode }
  from './harness/isolation';
import { withRun, type Run } from './harness/run';
import { scenarios, type ScenarioContext, type ScenarioResult } from './scenarios';

const { values } = parseArgs({ args: Bun.argv.slice(2), strict: true, options: {
  profile: { type: 'string', default: 'baseline' },
  scenario: { type: 'string', default: '' },
  'timeout-ms': { type: 'string', default: '90000' },
  renderer: { type: 'string', default: 'software' },
  interactive: { type: 'boolean', default: false },
  'check-isolation': { type: 'boolean', default: false },
  heroes: { type: 'string' }, // The custom heroes' directory, as in play.
} });
if (!isProfile(values.profile)) throw new Error(`Unknown profile: ${values.profile}`);
const profile = values.profile, definition = profiles[profile];
const features = values.heroes ? [...definition.features, 'hero'] : definition.features;
const heroes = values.heroes ? Object.keys(await heroDirectories(resolve(values.heroes))) : [];
const names = values.scenario ? values.scenario.split(',') : [];
for (const name of names) {
  if (!Object.hasOwn(scenarios, name)) throw new Error(`Unknown scenario: ${name}`);
  const { entry, heroes: needs = [] } = scenarios[name]!;
  if (entry !== definition.entry) throw new Error(`Scenario ${name} needs a ${entry} profile.`);
  const missing = needs.filter(id => !heroes.includes(id));
  if (missing.length) {
    throw new Error(`Scenario ${name} needs --heroes <dir> with ${missing.map(id => `${id}/`).join(' and ')}.`);
  }
}
const timeoutMs = Number(values['timeout-ms']);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) {
  throw new Error('--timeout-ms must be 1000–300000.');
}
if (values.renderer !== 'software' && values.renderer !== 'auto') {
  throw new Error('--renderer must be software or auto.');
}
if (values.interactive && (definition.entry === 'none' || names.length)) {
  throw new Error('--interactive needs a local profile and no scenario.');
}
const renderer = values.renderer as RendererMode;

// Re-executes this script inside a user+network namespace with loopback only; never falls back.
await enterNetworkNamespace(fileURLToPath(import.meta.url), Bun.argv.slice(2));
const network = await verifyNetworkNamespace();

if (values['check-isolation']) {
  const canary = await checkIsolation(renderer);
  console.log(JSON.stringify({ network, canary }, null, 2));
  process.exit(canary.ok ? 0 : 1);
}

const sessions: Array<Record<string, unknown>> = [];
const summary = await withRun({
  kind: profile, profile, eventsFile: 'host-events.json', heroes: values.heroes && resolve(values.heroes),
  manifest: { entry: definition.entry, features, scenarios: names, timeoutMs, renderer, network,
    bunVersion: Bun.version },
  async body({ host, run, manifest, signal }) {
    manifest.canary = await checkIsolation(renderer);
    for (const name of names.length ? names : ['observe']) {
      if (signal.aborted) break;
      sessions.push(await session(host.origin, run, name, signal));
    }
  },
  summary(problems, events, run) {
    const failed = problems.length > 0 || sessions.some(session =>
      session.error || (session.result as ScenarioResult | undefined)?.status === 'failed');
    const status = failed ? 'failed' : values.interactive ? 'stopped' : names.length ? 'passed' : 'observed';
    return { run: `runs/${run.id}`, status, problems, missingResources: events.summary().missingResources,
      sessions: sessions.map(({ console: _, peerConsole: __, ...session }) => session) };
  },
});
console.log(JSON.stringify(summary, null, 2));

/**
 * One fresh browser per player and scenario, so scenarios never inherit each other's game state. A two-player
 * scenario gets a second browser (its own storage, so its own install ID), booted together with the first, in the same
 * namespace and against the same host; its files carry the `peer-` prefix.
 */
async function session(origin: string, run: Run, name: string, signal: AbortSignal) {
  const scenario = scenarios[name];
  await mkdir(resolve(run.path, name));
  const record: Record<string, unknown> = { name };
  const players: Player[] = [];
  try {
    for (const prefix of scenario?.players === 2 ? ['', 'peer-'] : ['']) {
      players.push(await openPlayer(origin, run, name, prefix, signal));
    }
    record.browser = players[0]!.browser.version();
    const [boot, peerBoot] = await Promise.all(players.map(player => player.start()));
    Object.assign(record, { boot }, peerBoot ? { peerBoot } : {});
    if (scenario) record.result = await scenario.run(players[0]!.context, players[1]?.context);
    if (values.interactive) {
      const { page, browser } = players[0]!;
      console.log(`Isolated window open (${profile}). Close the window or press Ctrl+C to stop.`);
      await new Promise<void>(done => {
        page.once('close', () => done());
        browser.once('disconnected', () => done());
        signal.addEventListener('abort', () => done(), { once: true });
      });
    }
  } catch (error) {
    record.error = String(error);
  } finally {
    for (const player of players) await player.finish(record);
  }
  return record;
}

type Player = Awaited<ReturnType<typeof openPlayer>>;

/** A fresh guarded browser and page for one player; nothing is loaded until `start`. */
async function openPlayer(origin: string, run: Run, name: string, prefix: string, signal: AbortSignal) {
  const events = new EventLog(), samples: Array<{ at: number; label: string; data: unknown }> = [];
  const wait = (milliseconds: number) => delay(milliseconds, undefined, { signal });
  const { browser, context: browserContext } =
    await launchGuardedBrowser(origin, events.record, { headless: !values.interactive, renderer });
  const page = await browserContext.newPage();
  page.on('console', message => events.record(`console-${message.type()}`, { text: message.text() }));
  page.on('pageerror', error => events.record('page-error', { message: error.message, stack: error.stack }));
  page.on('dialog', dialog => void dialog.dismiss());
  page.on('requestfailed', request =>
    events.record('request-failed', { url: request.url(), error: request.failure()?.errorText }));
  page.on('crash', () => events.record('page-crash', {}));
  let opened = performance.now();
  const context: ScenarioContext = {
    page,
    elapsed: () => performance.now() - opened,
    wait,
    observe: async (observer, ...args) => {
      const timeout = new AbortController();
      const timer = delay(5000, undefined, { signal: timeout.signal })
        .then(() => { throw new Error(`Observer ${observer} timed out.`); });
      timer.catch(() => {});
      try {
        return await Promise.race([page.evaluate(([observer, args]) =>
          (window as any).local.observe[observer](...args), [observer, args] as const), timer]);
      } finally { timeout.abort(); }
    },
    sample: (label, data) => samples.push({ at: Math.round(performance.now() - opened), label, data }),
    screenshot: async (file, clip) => {
      await page.screenshot({ path: resolve(run.path, name, `${prefix}${file}.png`), timeout: 10000, clip });
    },
  };
  return {
    page, browser, context,
    /** Opens the page and waits for the original entry (baseline: watches the original for the budget). */
    async start() {
      const booted = definition.entry === 'none' ? null : bootCheckpoint(page, signal);
      booted?.catch(() => {});
      await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
      opened = performance.now();
      const boot = booted ? await booted : await wait(timeoutMs);
      if (definition.entry === 'menu') await wait(1500);
      return boot;
    },
    /** Records the page state, the last screenshot, samples and events, then closes the browser. */
    async finish(record: Record<string, unknown>) {
      const key = (field: string) => prefix ? `peer${field[0]!.toUpperCase()}${field.slice(1)}` : field;
      try {
        record[key('page')] = await page.evaluate(() => {
          const { observe: _, ...state } = (window as any).local;
          return state;
        });
        await page.screenshot({ path: resolve(run.path, name, `${prefix}screen.png`), timeout: 10000 });
      } catch (error) { record[key('finishError')] = String(error); }
      await browser.close().catch(() => {});
      const console = record[key('console')] = events.summary();
      await run.write(`${name}/${prefix}samples.json`, { result: record.result, console, samples });
      await run.write(`${name}/${prefix}events.json`, events.snapshot());
    },
  };
}

/** Resolves on the page's terminal boot checkpoint; rejects when it is blocked, fails, closes or times out. */
function bootCheckpoint(page: Page, signal: AbortSignal) {
  return new Promise<unknown>((resolveBoot, reject) => {
    const timer = setTimeout(() => reject(new Error('No boot checkpoint within the timeout.')), timeoutMs);
    const finish = (outcome: () => void) => { clearTimeout(timer); page.off('console', onConsole); outcome(); };
    const onConsole = (message: { text(): string }) => {
      const text = message.text();
      if (text.startsWith('LOCAL_BOOT_FAILED')) return finish(() => reject(new Error(text)));
      if (!text.startsWith('LOCAL_BOOT ')) return;
      const checkpoint = JSON.parse(text.slice('LOCAL_BOOT '.length)) as { phase: string; message: string };
      if (checkpoint.phase === 'blocked') finish(() => reject(new Error(checkpoint.message)));
      else if (['scene-loaded', 'screen-active'].includes(checkpoint.phase)) finish(() => resolveBoot(checkpoint));
    };
    page.on('console', onConsole);
    page.once('close', () => finish(() => reject(new Error('Page closed before booting.'))));
    signal.addEventListener('abort', () => finish(() => reject(new Error('Interrupted.'))), { once: true });
  });
}
