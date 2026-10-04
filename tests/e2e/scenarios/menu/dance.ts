import { poll, verdict, type Scenario, type ScenarioContext } from '../index';
import { at, goToLobby, press, ready, until } from '../shared/menu';

/** One B press (`hold` ms down) and the wheel and emote states seen until 2.5 s after the release. */
async function tryB(context: ScenarioContext, label: string, hold: number) {
  const { page, observe, wait, sample } = context;
  const before = await observe('emotes');
  await page.keyboard.down('b');
  await wait(hold);
  const held = await observe('emotes');
  await page.keyboard.up('b');
  let played = false, id: string | null = null;
  const end = performance.now() + 2500;
  while (performance.now() < end && !played) {
    const view = await observe('emotes');
    played = view.emote?.playing === true;
    id = view.emote?.id ?? null;
    if (!played) await wait(100);
  }
  const trial = { hold, lastIdBefore: before.wheel?.selected ?? null, shown: held.wheel?.showing === true,
    lastIdHeld: held.wheel?.selected ?? null, played, id };
  sample(label, trial);
  return trial;
}
type Trial = Awaited<ReturnType<typeof tryB>>;

// Rewired Default keyboard map, action OpenWheel=32: B (level0_381 at 0x2148). ChoiceWheelManager.Update (f45400):
// IsButtonDown (f45403: GetButtonTimedPressDown(32, 0.1 s) on PC) shows the wheel; its ShowWheel (f45404) sets
// _lastId to the first emote when empty, and OnOptionHighlighted (f15626) to the one under the mouse. IsButtonUp
// (f45405: GetButtonUp(32), any length) plays _lastId when set. The manager lives in the match scene (Awake f45398, no
// DontDestroyOnLoad), so each match starts with no _lastId: taps shorter than 0.1 s do nothing until B is first held,
// then replay the last dance.
export const dance: Scenario = {
  entry: 'menu',
  async run(context) {
    const { page, observe, screenshot, wait } = context;
    const checks: Record<string, boolean> = {};
    checks.ready = (await until(context, 'start', menu => ready(menu), 20000)).matched;
    checks.lobby = await goToLobby(context);
    await press(context, at.play);
    checks.matchStarted = (await poll(context, 'match', () => observe('match'), v =>
      v.scene?.buildIndex !== 1 && v.player?.initialized === true && v.game?.hasStarted === true, 60000)).matched;
    if (!checks.matchStarted) return verdict(checks);
    await page.mouse.click(...at.center, { delay: 100 });
    await wait(2000);
    const trials = [];
    for (const [index, hold] of [40, 40, 300, 40, 300, 300].entries()) {
      trials.push(await tryB(context, `b-${index}-${hold}`, hold));
      if (index === 2) await screenshot('dance');
      await poll(context, `idle-${index}`, () => observe('emotes'), v => v.emote?.playing !== true, 8000);
      await wait(500);
    }
    context.sample('trials', trials);
    const [tap, tapAgain, hold, replay] = trials as [Trial, Trial, Trial, Trial];
    checks.tapsIdleFirst = !tap.shown && !tap.played && !tapAgain.played;
    checks.holdOpensAndPlays = hold.shown && hold.played;
    checks.tapReplays = !replay.shown && replay.played && replay.id === hold.id;
    checks.holdsAgain = trials.slice(4).every(trial => trial.shown && trial.played);
    return verdict(checks);
  },
};
