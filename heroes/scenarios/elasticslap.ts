import { poll, verdict, type Scenario, type ScenarioContext } from '../../tests/e2e/scenarios/index';
import { equipElastic, healthOf, me, slowMotion, startedHero, wallAhead } from './common';

/**
 * Presses Q and watches the local slap for `ms`: the cycle index seen, the largest hand scale, whether PlayerIK was
 * off, with a screenshot `shot` ms after the press (the hit lands 0.23 s in, the clap 0.29 s).
 */
async function slap(context: ScenarioContext, label: string, shot: number, ms = 650) {
  const { page, observe, sample, wait, screenshot } = context;
  const start = Date.now(), seen: { t: number; index: number; hands: number[]; ik: boolean | null }[] = [];
  let shotDone = false;
  await page.keyboard.press('q', { delay: 60 });
  while (Date.now() - start < ms) {
    if (!shotDone && Date.now() - start >= shot) { await screenshot(label); shotDone = true; }
    const view = await observe('elastic');
    const mine = view.slaps?.find((item: any) => item.mine);
    if (mine) seen.push({ t: Date.now() - start, index: mine.index, hands: mine.hands, ik: mine.ik });
    await wait(25); // Paced, so the page keeps rendering frames between reads.
  }
  const result = { index: seen.length ? seen[0]!.index : -1, hand: Math.max(0, ...seen.flatMap(item => item.hands)),
    ikOff: seen.some(item => item.ik === false), samples: seen.length };
  sample(label, { ...result, seen });
  return result;
}

/**
 * A frame strip for visual review: with the slaps `slow`× slower (slowMotion), Q `presses` times half a
 * second apart (the cycle: left, right, clap) and `frames` screenshots over the last slap's `seconds`; returns the
 * slap's state at each screenshot (`shots`) and also read in between (`dense`).
 */
async function strip(context: ScenarioContext, label: string, presses: number, seconds: number, slow = 6, frames = 10) {
  const { page, observe, sample, wait, screenshot } = context;
  const states: any[] = [];
  await slowMotion(context, slow);
  for (let press = 1; press < presses; press++) {
    await page.keyboard.press('q', { delay: 60 });
    await wait(500);
  }
  await page.keyboard.press('q', { delay: 60 });
  const start = Date.now(), dense: any[] = [];
  const read = async () => (await observe('elastic')).slaps?.find((item: any) => item.mine) ?? null;
  for (let frame = 0; frame < frames; frame++) {
    await screenshot(`${label}-${frame}`);
    const state = await read();
    sample(`${label}-${frame}`, state);
    states.push(state);
    dense.push(state);
    // Between screenshots the state is read every 40 ms too: ten screenshots can straddle the hit's peak (the arm's
    // span reading just under 0.95 of its length).
    const next = start + (frame + 1) * seconds * slow * 1000 / frames;
    while (Date.now() < next - 40) {
      dense.push(await read());
      await wait(40);
    }
    await wait(Math.max(0, next - Date.now()));
  }
  await slowMotion(context, 1);
  return { shots: states, dense };
}

// The elastic hero's Q (elastic/slap.ts, elastic/projectile.ts) in a match, facing a wall it built: Q slaps with the
// left hand and the wall loses 75 of its 150 (the pickaxe's per hit), Q with the right and it breaks, Q claps; each
// hand grows (peaks ×2, the clap ×2.25) over the big mesh hands, with PlayerIK off, and the clap throws the projectile,
// which flies away at about 25 m/s tumbling end over end. PlayerIK is back on at the end. Q, Q fast keeps the weapon
// hidden between the slaps; the strips show the elbow bending in the wind-up and straightening at the hit.
export const elasticslap: Scenario = {
  entry: 'menu',
  heroes: ['elastic'],
  async run(context) {
    const { page, observe, sample, wait, screenshot } = context;
    const checks = await equipElastic(context);
    if (!checks.equipped) return verdict(checks, 'The elastic hero was not equipped.');
    checks.started = await startedHero(context);
    checks.dash = !!(await me(context))?.abilities?.includes('DashAbility');
    const here = (await observe('match')).player?.position as number[];
    const mouse: [number, number] = [640, 380];
    const wall = await wallAhead(context, mouse, here, [1, 0], 'walled', 0); // The nearest wall ahead (+x).
    checks.walled = !!wall;
    await page.keyboard.press('f');
    await wait(4000); // A new build regains its health first (Building.InitialHealthRegenCoroutine).
    // The wall's Health (null: gone), watched while the presses go on unhindered (the cycle lasts while they come
    // within 1.5 s), and what the last single slap hit.
    const wallHealth = () => healthOf(context, wall);
    const full = await wallHealth(), healths: (number | null)[] = [];
    let watching = true;
    const watch = (async () => { while (watching) { healths.push(await wallHealth()); await wait(40); } })();
    const left = await slap(context, 'slap-left', 170);
    const right = await slap(context, 'slap-right', 170);
    const clap = await slap(context, 'clap', 230, 300);
    watching = false;
    await watch;
    const strikes = (await observe('elastic')).strikes as any[];
    sample('wall-slaps', { full, healths, strikes });
    checks.wallHit = full === 150 && healths.includes(75) &&
      strikes.some(item => item.index === 0 && item.builds === 1);
    checks.wallBroken = healths.at(-1) === null;
    // Each screenshot stalls the page for about 0.27 s and under load a slap gets 2–7 reads, so in real time only
    // the cycle and PlayerIK are certain; the hand sizes are sampled and the strips below (6× slower) check the peaks.
    checks.left = left.index === 0 && left.ikOff;
    checks.right = right.index === 1 && right.ikOff;
    checks.clap = clap.index === 2 && clap.ikOff;
    const flight = await poll(context, 'projectile', () => observe('elastic'), view => !!view.projectiles?.length,
      1500);
    const first = flight.value.projectiles?.[0];
    await wait(150);
    await screenshot('projectile');
    const later = (await observe('elastic')).projectiles?.[0];
    sample('flight', { first, later });
    const moved = first && later ? Math.hypot(...later.at.map((v: number, k: number) => v - first.at[k])) /
      Math.max(0.05, later.t - first.t) : 0;
    checks.flies = moved > 15 && moved < 35;
    checks.tumbles = !!first && !!later && later.turns > first.turns;
    await screenshot('projectile-hit');
    await wait(3500);
    checks.ikBack = (await observe('elastic')).ik === true;
    checks.landed = !(await observe('elastic')).projectiles?.length;
    await screenshot('after');
    // Rapid Q, Q (the pickaxe must not flash between them), 4× slower with the grace: the weapon stays hidden
    // from the first slap's end until the second starts and through its end, then shows again.
    const weapon = async () => (await observe('elastic')).weapon as boolean | null;
    const slapping = (view: any) => !!view.slaps?.some((item: any) => item.mine);
    checks.weaponShown = (await poll(context, 'weapon-shown', weapon, shown => shown === true, 3000)).matched;
    await slowMotion(context, 4);
    await page.keyboard.press('q', { delay: 60 });
    const firstEnd = await poll(context, 'qq-first-end', () => observe('elastic'), view => !slapping(view), 6000);
    const between = [await weapon()];
    await wait(500);
    between.push(await weapon());
    await page.keyboard.press('q', { delay: 60 });
    const second = await poll(context, 'qq-second', () => observe('elastic'), slapping, 2000);
    const secondEnd = await poll(context, 'qq-second-end', () => observe('elastic'), view => !slapping(view), 6000);
    const afterEnd = await weapon();
    const back = await poll(context, 'qq-back', weapon, shown => shown === true, 5000);
    await slowMotion(context, 1);
    sample('qq', { between, afterEnd });
    checks.qqHidden = firstEnd.matched && second.matched && secondEnd.matched &&
      between.every(shown => shown === false) && afterEnd === false;
    checks.qqBack = back.matched;
    await wait(1500);
    // Frame strips (6× slower) of a left slap, a right one and a clap, for the visual review: the hand peaks past ×2
    // with the arm stretched past ×2.5 (the clap: past ×2.25, both arms alike), and both end back near ×1. The arm
    // spans little of its stretched length in the wind-up (the elbow bent) and almost all of it at the hit.
    const peaks = ({ shots, dense }: { shots: any[]; dense: any[] }) => {
      const spans = dense.flatMap(item => (item?.arms ?? []).map((arm: any) =>
        arm.need / (arm.k * (arm.base[0] + arm.base[1]))));
      return { hand: Math.max(0, ...dense.flatMap(item => item?.hands ?? [])),
        k: Math.max(0, ...dense.flatMap(item => (item?.arms ?? []).map((arm: any) => arm.k))),
        bent: Math.min(1, ...spans), straight: Math.max(0, ...spans), reads: dense.length,
        end: shots.at(-1)?.hands ?? [], arms: shots.map(item => (item?.arms ?? []).map((arm: any) => arm.k)) };
    };
    const stripLeft = peaks(await strip(context, 'strip-left', 1, 0.64));
    await wait(2000);
    const stripRight = peaks(await strip(context, 'strip-right', 2, 0.64));
    await wait(2000);
    const stripClap = peaks(await strip(context, 'strip-clap', 3, 0.8));
    sample('peaks', { stripLeft, stripRight, stripClap });
    const swings = (strip: typeof stripLeft) => strip.hand > 2 && strip.k > 2.5 &&
      strip.end.every((size: number) => size < 1.3);
    checks.leftPeak = swings(stripLeft);
    checks.rightPeak = swings(stripRight);
    // The hit is straight for an instant: sampled reads peak at 0.9485–0.96, while the wind-up stays bent at
    // 0.30–0.40.
    checks.whips = [stripLeft, stripRight].every(strip => strip.bent < 0.8 && strip.straight > 0.93);
    checks.clapPeak = stripClap.hand > 2.25 && stripClap.arms.every((pair: number[]) => pair.length !== 2 ||
      Math.abs(pair[0]! - pair[1]!) < 0.15 * Math.max(...pair));
    return verdict(checks);
  },
};
