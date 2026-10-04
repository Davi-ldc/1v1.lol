import { verdict, type Scenario, type ScenarioContext } from '../index';
import { at, goToLobby, press, ready, until } from '../shared/menu';

/** The features of the age-limit popups that show now (observe('popups')). */
const shown = async (context: ScenarioContext) => ((await context.observe('popups')).ageLimited ?? [])
  .filter((popup: any) => popup.shown).map((popup: any) => String(popup.feature)) as string[];

/** Every age-limit popup feature seen while watching for `ms`, read every 500 ms and sampled under `label`. */
async function watch(context: ScenarioContext, label: string, ms: number) {
  const seen = new Set<string>(), end = Date.now() + ms;
  while (Date.now() < end) {
    for (const feature of await shown(context)) seen.add(feature);
    await context.wait(500);
  }
  context.sample(label, [...seen]);
  return [...seen];
}

// The AgeGate's "get full access / Unlock for free!" popup (AgeLimitedFeaturePopup) offline: every ad attempt
// (AdsManager.TryShowingVideoAd from PLAY, GameModeConnector.StartJoinMode and GameAdsShower) validates its feature
// first, AgeGateManager.IsFeatureAvailable fails on the absent Firebase login, and ValidateFeature opened the popup
// (src/host/wasm.ts ageLimitSilent drops that call). In the lobby, through PLAY (the match starts, its ad skipped
// as before) and for a minute of the match, it never shows.
export const nopopup: Scenario = {
  entry: 'menu',
  async run(context) {
    const { observe, wait, screenshot } = context;
    const checks: Record<string, boolean> = {};
    checks.ready = (await until(context, 'start', menu => ready(menu), 20000)).matched;
    checks.lobby = await goToLobby(context);
    const seen = await watch(context, 'lobby-popups', 10000);
    await screenshot('lobby');
    await press(context, at.play);
    let started = false;
    for (let tick = 0; tick < 120 && !started; tick++) {
      seen.push(...await shown(context));
      await wait(500);
      started = !!(await observe('match')).game?.hasStarted;
    }
    checks.started = started;
    seen.push(...await watch(context, 'match-popups', 30000));
    await screenshot('match-30s');
    seen.push(...await watch(context, 'match-popups-late', 30000));
    await screenshot('match-60s');
    context.sample('seen', seen);
    checks.noPopup = seen.length === 0;
    return verdict(checks);
  },
};
