import { existsSync } from 'node:fs';
import type { Page } from 'playwright-core';
import type { Entry } from '../../../src/host/profiles';
import { duel } from './lan/duel';
import { lobbyui } from './lan/lobbyui';
import { matchmaking } from './lan/matchmaking';
import { partyleave } from './lan/partyleave';
import { partylink } from './lan/partylink';
import { photonbudget } from './lan/photonbudget';
import { photonreconnect } from './lan/photonreconnect';
import { rename } from './lan/rename';
import { zonewars } from './lan/zonewars';
import { armor } from './menu/armor';
import { autoequip } from './menu/autoequip';
import { champions } from './menu/champions';
import { cosmetics } from './menu/cosmetics';
import { dance } from './menu/dance';
import { editmenu } from './menu/editmenu';
import { loadout } from './menu/loadout';
import { lobbyplay } from './menu/lobbyplay';
import { nopopup } from './menu/nopopup';
import { railgun } from './menu/railgun';
import { reopen } from './menu/reopen';
import { edit } from './practice/edit';
import { movement } from './practice/movement';
import { weapon } from './practice/weapon';

/** Everything a scenario may use: real input on `page`, read-only observers and recording. */
export interface ScenarioContext {
  page: Page;
  /** Milliseconds since the page was opened. */
  elapsed(): number;
  wait(milliseconds: number): Promise<void>;
  /** window.local.observe[name](...args) in the page: a core observer (src/page/main.ts) or an extension's. */
  observe(name: string, ...args: number[]): Promise<any>;
  sample(label: string, data: unknown): void;
  /** The page as `name`.png in the run, or only `clip` (CSS pixels) of it. */
  screenshot(name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void>;
}
export interface ScenarioResult { status: 'passed' | 'failed'; checks: Record<string, boolean>; reason?: string }
/**
 * `players: 2` gives the scenario a second, independent player (`peer`) on the same host; `heroes` names the custom
 * heroes it needs by slot (heroes/page/ids.ts), and the probe refuses it unless `--heroes` has their directories.
 */
export interface Scenario {
  entry: Entry;
  players?: 2;
  heroes?: string[];
  run(context: ScenarioContext, peer?: ScenarioContext): Promise<ScenarioResult>;
}

/** Passed only when every check holds; expectations come from runs already confirmed. */
export const verdict = (checks: Record<string, boolean>, reason?: string): ScenarioResult =>
  ({ status: Object.values(checks).every(Boolean) && !reason ? 'passed' : 'failed', checks,
    ...(reason ? { reason } : {}) });

/** Re-reads every 100 ms until `matches` holds or `budget` ms pass; samples the last value under `label`. */
export async function poll<T>({ sample, wait }: ScenarioContext, label: string, read: () => Promise<T>,
  matches: (value: T) => boolean, budget = 5000) {
  const deadline = performance.now() + budget;
  let value = await read();
  while (!matches(value) && performance.now() < deadline) {
    await wait(100);
    value = await read();
  }
  sample(label, value);
  return { value, matched: matches(value) };
}

/** The custom heroes' scenarios (heroes/scenarios/), when this checkout has them. */
const heroes = new URL('../../../heroes/scenarios/index.ts', import.meta.url);
const { heroScenarios } = existsSync(heroes)
  ? await import(heroes.href) as { heroScenarios: Record<string, Scenario> } : { heroScenarios: {} };

export const scenarios: Record<string, Scenario> = { movement, edit, weapon, loadout, armor, reopen, champions,
  lobbyplay, cosmetics, duel, zonewars, autoequip, partylink, lobbyui, rename, railgun, editmenu, nopopup,
  matchmaking, dance, photonbudget, photonreconnect, partyleave, ...heroScenarios };
