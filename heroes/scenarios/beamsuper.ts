import { poll, verdict, type Scenario } from '../../tests/e2e/scenarios/index';
import { aim } from '../../tests/e2e/scenarios/shared/lan';
import { equipBeam, healthOf, height, me, shields, sphere, startedHero, wallAhead } from './common';

// The beam hero's Q (beam/ability.ts) in a match, under a floor he built: Q arms it without the charge or the beam
// and, held, it charges past Poseidon's Duration (5 s at level 10); letting Q go releases it: the floor above breaks,
// he rises five walls (17.5 m) inside a sphere of barriers that appear one by one (random delays) and end together,
// fires the original Aqua Cannon beam, falls back when it ends and, with no cooldown, Q arms it again at once.
export const beamsuper: Scenario = {
  entry: 'menu',
  heroes: ['beam'],
  async run(context) {
    const { page, observe, sample, wait, screenshot } = context;
    const checks = await equipBeam(context);
    if (!checks.equipped) return verdict(checks, 'The beam hero was not equipped.');
    await startedHero(context);
    // A floor over the hero (X, crosshair straight up), for the release to break.
    const builds = async () => (await observe('heroes')).buildings as number;
    const spot = (await observe('match')).player?.position as number[];
    const mouse: [number, number] = [640, 380];
    if (spot) await aim(context, [spot[0]!, spot[1]! + 6, spot[2]!], mouse);
    const before = await builds();
    await page.keyboard.press('x');
    await wait(400);
    await page.mouse.down();
    await page.mouse.up();
    checks.built = (await poll(context, 'built', builds, count => count > before, 3000)).matched;
    // A ramp over the head too (C, same aim): its box crosses the column the release clears, whatever level it
    // starts at.
    const ramps = async () => {
      const view = await observe('heroes'), here = (await observe('match')).player?.position as number[];
      const near = (at: number[]) => Math.hypot(at[0]! - here[0]!, at[2]! - here[2]!) < 3;
      return ((view.kinds ?? []) as string[]).map((kind, k) => ({ kind, at: (view.places as number[][])[k]! }))
        .filter(build => build.kind === 'RampBuilding' && near(build.at));
    };
    await page.keyboard.press('c');
    await wait(400);
    await page.mouse.down();
    await page.mouse.up();
    checks.rampBuilt = (await poll(context, 'ramp-built', ramps, list => list.length > 0, 3000)).matched;
    await screenshot('built');
    await aim(context, [spot![0]! + 10, spot![1]! + 1.5, spot![2]!], mouse); // Back to the horizon.
    await page.keyboard.press('1');
    await wait(500);
    const upright = (await me(context))?.head as number; // Head over hips (m) before the charge.
    sample('standing-head', upright);
    await page.keyboard.down('q'); // Held: the charge, full after 5 s (the highest jump, the red beam).
    const pressed = Date.now();
    checks.armed = (await poll(context, 'armed', () => me(context),
      player => player?.activated === true && player?.firing === false, 5000)).matched;
    await screenshot('armed');
    // The charge's aura in the tier's color, stronger as it charges: blue at 1 s, green at 3.5 s, red at 5.5 s.
    const auraAt = async (ms: number, label: string) => {
      await wait(Math.max(0, ms - (Date.now() - pressed)));
      const player = await me(context);
      sample(label, { aura: player?.aura, head: player?.head });
      await screenshot(label);
      return { ...player?.aura, head: player?.head as number };
    };
    const blue = await auraAt(1000, 'aura-blue'), green = await auraAt(3500, 'aura-green');
    const red = await auraAt(5500, 'aura-red');
    const tinted = (aura: any, hue: number) => aura?.emitting === true && Math.abs(aura.hue - hue) < 5;
    checks.aura = tinted(blue, 220) && tinted(green, 125) && tinted(red, 0) && red.alpha > blue.alpha &&
      red.scale > blue.scale && red.spike > blue.spike + 2;
    // The contraction starts from his pose and deepens: the head drops toward the hips, more at 5.5 s than at 1 s.
    checks.contracts = upright - red.head > 0.1 && blue.head > red.head + 0.02 && blue.head < upright + 0.02;
    await wait(Math.max(0, 6000 - (Date.now() - pressed)));
    checks.stillArmed = (await poll(context, 'still-armed', () => me(context),
      player => player?.activated === true && player?.firing === false, 100)).matched;
    const ground = await height(context), standing = await builds();
    sample('ground', ground);
    await page.keyboard.up('q');
    checks.broke = (await poll(context, 'broke', builds, count => count < standing, 2000)).matched;
    checks.rampBroke = (await poll(context, 'ramp-broke', ramps, list => !list.length, 2000)).matched;
    checks.auraOff = (await poll(context, 'aura-off', () => me(context), player => player?.aura?.emitting !== true,
      1000)).matched;
    // The faster jump: a 0.2 s crouch, then five walls in about half a second.
    checks.quick = (await poll(context, 'quick', () => height(context), y => y >= ground + 15, 1200)).matched;
    checks.staggered = (await poll(context, 'staggered', () => observe('heroes'), view => {
      const count = shields(view, true).length;
      return count > 0 && count < 28;
    }, 3000)).matched;
    // The scan's glow material.
    const body = async () => (await observe('heroes')).managers?.find((manager: any) => manager.player?.mine)?.material;
    checks.glow = (await poll(context, 'glow', body, material => material === 'beam glow', 2000)).matched;
    await screenshot('glow');
    checks.rose = (await poll(context, 'rose', () => height(context), y => y >= ground + 15, 4000)).matched;
    checks.sphere = (await poll(context, 'sphere', () => observe('heroes'), view => sphere(view, true), 4000)).matched;
    await screenshot('hover');
    checks.fired = (await poll(context, 'fired', () => me(context), player => player?.firing === true, 5000)).matched;
    // The glow stays on for the whole release: still on once the beam fires.
    checks.glowMid = (await body()) === 'beam glow';
    // A little sideways in the air (3 m/s at full input), while it fires.
    const flat = async () => ((await observe('match')).player?.position as number[]).filter((_, k) => k !== 1);
    const from = await flat();
    await page.keyboard.down('d');
    try { await wait(1000); } finally { await page.keyboard.up('d'); }
    const drift = Math.hypot(...(await flat()).map((value, k) => value - from[k]!));
    sample('drift', drift);
    checks.drift = drift > 1 && drift < 6;
    // Growing over the whole beam (5 s at level 10) to 3× Poseidon's: player hit radius 0.3 → 0.9, VFX width in step.
    const scaled = (player: any) => Math.abs(player?.beam?.width * 0.3 - player?.beam?.radius) < 0.01;
    checks.growing = (await poll(context, 'growing', () => me(context), player => scaled(player) &&
      player.beam.radius > 0.1 && player.beam.radius < 0.6, 3000)).matched;
    await screenshot('beam');
    checks.grown = (await poll(context, 'grown', () => me(context), player => scaled(player) &&
      player.beam.radius > 0.85, 6000)).matched;
    const state = async () => ({ y: await height(context), player: await me(context) });
    checks.landed = (await poll(context, 'landed', state,
      ({ y, player }) => y < ground + 1 && player?.firing === false && player?.cooldown === 0, 15000)).matched;
    await screenshot('landed');
    const after = await me(context);
    const material = await body();
    checks.restored = Math.abs(after?.beam?.radius - 0.3) < 0.01 && (after?.beam?.width ?? 1) === 1 &&
      material === 'beam';
    // A short charge (half a second: about one wall up, the blue beam) at the nearest wall in front, built if none:
    // it goes at the beam's first contact, not chipped by its ticks.
    const here = (await observe('match')).player?.position as number[];
    const wall = await wallAhead(context, mouse, here, [1, 0], 'walled', 0);
    checks.walled = !!wall;
    await page.keyboard.press('1');
    // Aimed as it will hover (the camera keeps its direction): at the wall's middle from about 4.5 m up.
    if (wall) await aim(context, [wall[0]!, wall[1]! - 4.5, wall[2]!], mouse);
    await page.keyboard.down('q');
    checks.rearmed = (await poll(context, 'rearmed', () => me(context),
      player => player?.activated === true && player?.firing === false, 3000)).matched;
    await wait(300);
    await page.keyboard.up('q');
    checks.fired2 = (await poll(context, 'fired-2', () => me(context), player => player?.firing === true, 5000))
      .matched;
    const firedAt = Date.now();
    // The wall's Health at each read until it is gone (null). The owner kills it on contact (KillBuilding in
    // beam/beam.ts), but the original tick of the same contact can land a frame before, and two ticks can also fell a
    // 150 wall. Under load the reads cannot tell those apart, so this checks that the wall in the beam's path is gone
    // within the search.
    const healths: (number | null)[] = [];
    const wallHealth = async () => {
      healths.push(await healthOf(context, wall));
      return healths.at(-1)!;
    };
    const gone = await poll(context, 'wall-gone', wallHealth, health => health === null, 1500);
    sample('wall-gone-ms', { ms: Date.now() - firedAt, healths });
    checks.wallGone = !!wall && gone.matched;
    await screenshot('wall-gone');
    return verdict(checks);
  },
};
