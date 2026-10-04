import { verdict, type Scenario, type ScenarioContext } from '../../tests/e2e/scenarios/index';
import { equipBeam, startedHero } from './common';

/** The local beam player's sword report (observe 'sword'). */
const mySword = async (context: ScenarioContext) =>
  (await context.observe('sword')).players?.find((player: any) => player.mine);

/** The strongest channel of an emission colour: 0 red, 1 green, 2 blue. */
const dominant = (rgb?: number[] | null) => rgb ? rgb.indexOf(Math.max(...rgb)) : -1;

/**
 * A crop of the page around a Unity screen point (pixels from the bottom left, with depth): CLOSE CSS pixels each
 * way, read at native resolution. A CSS zoom of the canvas would not do: Unity sizes its back buffer from the
 * canvas's transformed bounds.
 */
const CLOSE = 100;
async function closeUp(context: ScenarioContext, label: string, point?: number[] | null) {
  if (!point || point[2]! <= 0) return;
  const [x, y, width, height] = await context.page.evaluate(([px, py]) => {
    const canvas = document.querySelector('canvas')!, box = canvas.getBoundingClientRect();
    const scale = box.width / canvas.width;
    return [box.left + px! * scale, box.top + box.height - py! * scale, innerWidth, innerHeight];
  }, point);
  const left = Math.max(0, Math.min(width - 2 * CLOSE, x - CLOSE)), top = Math.max(0, Math.min(height - 2 * CLOSE,
    y - CLOSE));
  await context.screenshot(label, { x: left, y: top, width: 2 * CLOSE, height: 2 * CLOSE });
}

// The beam hero's sword (beam/sword.ts): F takes the sword at once; its jewels glow at their own violet; holding the
// right button charges it through the tiers, the jewels easing to blue, green and red; letting go swings at the tier
// reached and the jewels ease back to violet.
export const beamsword: Scenario = {
  entry: 'menu',
  heroes: ['beam'],
  async run(context) {
    const { page, sample, wait, screenshot } = context;
    const checks = await equipBeam(context);
    if (!checks.equipped) return verdict(checks, 'The beam hero was not equipped.');
    checks.started = await startedHero(context);
    await page.keyboard.press('f');
    await wait(150);
    const taken = await mySword(context);
    sample('taken', taken);
    checks.instant = taken?.holding === true && taken.delayLeft <= 0 && taken.equipDelay === 0;
    await wait(1000);
    const shown = await mySword(context);
    sample('shown', shown);
    checks.sword = shown?.mesh === 'beam sword' && shown.materials?.join() === 'beam sword';
    checks.reach0 = Math.abs(shown?.range - 4.5) < 0.01;
    // At rest the jewels keep their own violet: blue strongest, then red.
    checks.idle = dominant(shown?.emission) === 2 && shown.emission[0] > shown.emission[1];
    await screenshot('sword');
    await closeUp(context, 'jewel-idle', shown?.jewel);
    await page.mouse.down({ button: 'right' });
    const tiers: number[] = [], glows: number[] = [], hues: number[] = [], pressed = Date.now();
    // 0.4 s, 0.95 s and 1.6 s after the press: the three tiers (thresholds 0.6 s and 1.2 s), each with a close-up of
    // the jewels (a screenshot takes about half a second); the whole view at the last, which lasts.
    for (const [at, label] of [[400, 'charge-0'], [950, 'charge-1'], [1600, 'charge-2']] as const) {
      await wait(Math.max(0, pressed + at - Date.now()));
      const now = await mySword(context);
      sample(label, now);
      tiers.push(now?.state?.tier);
      glows.push(now?.state?.glow);
      hues.push(dominant(now?.emission));
      await closeUp(context, `jewel-${tiers.length - 1}`, now?.jewel);
    }
    await screenshot('charge-2');
    checks.tiers = tiers.join() === '0,1,2';
    checks.glowing = glows[0]! > 0 && glows[2]! > glows[0]!;
    checks.hues = hues.join() === '2,1,0'; // Blue, green, red.
    await page.mouse.up({ button: 'right' });
    await wait(120);
    const swung = await mySword(context);
    sample('swung', swung);
    checks.swing = swung?.state?.swingTier === 2 && Math.abs(swung.range - 9) < 0.01;
    await screenshot('swing');
    await wait(1500);
    const after = await mySword(context);
    sample('after', after);
    checks.dark = after?.state?.glow < 0.05 && Math.abs(after.range - 4.5) < 0.01 &&
      dominant(after.emission) === 2 && Math.abs(after.emission[0] - shown?.emission[0]) < 0.05;
    return verdict(checks);
  },
};
