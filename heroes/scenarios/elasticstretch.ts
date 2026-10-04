import { poll, verdict, type Scenario, type ScenarioContext } from '../../tests/e2e/scenarios/index';
import { aim, both, other, screenshots } from '../../tests/e2e/scenarios/shared/lan';
import { at, press } from '../../tests/e2e/scenarios/shared/menu';
import { elasticLook, equipElastic, heroDuel, limbs, me, served } from './common';

/** The elastic hero's manager as `context` sees it: its own (`mine`) or the other's. */
const elasticOf = async (context: ScenarioContext, mine: boolean) => (await context.observe('heroes')).managers
  ?.find((manager: any) => manager.player?.mine === mine && manager.player.hero === 'elastic' &&
    elasticLook(manager));

/** The extension's stretch (legs factor, added height), the shaped skeleton's LowerLeg_L and its Root raise. */
async function expected(context: ScenarioContext) {
  const stretch = await context.page.evaluate(() =>
    (window as any).local.adapters.hero?.elastic?.stretch as { legs: number; rise: number });
  const { skeleton } = await served(context);
  return { ...stretch, thigh: skeleton!.LowerLeg_L!, root: skeleton!.Root![1]! };
}

/** A manager's legs factor: its LowerLeg_L local position over the shaped skeleton's. */
const factor = (manager: any, thigh: number[]) => Math.hypot(...manager.skeleton.LowerLeg_L) / Math.hypot(...thigh);
const near = (a: number, b: number, tolerance = 0.02) => Math.abs(a - b) < tolerance;

/**
 * The hitbox, speed and camera as the elastic legs change them, `from` the standing values (elastic/stretch.ts):
 * at stretch `s` (0..1) the motor capsule and legs trigger are `rise`·s taller with their centers half of it higher,
 * the pack's thigh and shin capsules 1 + (`legs` − 1)·s times as long (the arms' as they were), the center offset half
 * of `rise`·s higher, the speed multiplier 2× (grown) and the own camera `rise`·s higher.
 */
function grown(now: any, from: any, { rise, legs }: { rise: number; legs: number }, s: number, own: boolean) {
  const [a, b] = [now.player.stretch, from.player.stretch], [fitted, standing] = [limbs(now), limbs(from)];
  return { capsule: near(a.capsule[0], b.capsule[0] + rise * s) && near(a.capsule[1], b.capsule[1] + rise * s / 2),
    legsTrigger: near(a.legs[0], b.legs[0] + rise * s) && near(a.legs[1], b.legs[1] + rise * s / 2),
    limbs: Object.keys(standing).length === 8 && Object.entries(standing).every(([name, height]) =>
      near(fitted[name]!, height * (/Leg/.test(name) ? 1 + (legs - 1) * s : 1), 1e-3)),
    centerOffset: near(a.offset, b.offset + rise * s / 2),
    ...own ? { speed: near(a.speed, b.speed * (s ? 2 : 1), 1e-3), camera: near(a.camera, b.camera + rise * s) }
      : {} };
}

/**
 * Walking (W) for 2 s: the player's position, grounded state and speed multipliers sampled throughout (`label`), and
 * the ground speed in m/s from 0.6 s on (the acceleration done); `shot` names a mid-walk screenshot.
 */
async function stride(context: ScenarioContext, label: string, shot?: string) {
  const samples: { t: number; at: number[]; grounded: boolean; speed: number; channel: number }[] = [];
  const start = performance.now();
  await context.page.keyboard.down('w');
  try {
    while (performance.now() - start < 2000) {
      const [match, own] = await Promise.all([context.observe('match'), elasticOf(context, true)]);
      samples.push({ t: (performance.now() - start) / 1000, at: match.player?.position,
        grounded: own?.player.grounded, speed: own?.player.stretch.speed, channel: own?.player.stretch.channel });
      if (shot && samples.length === 10) { await context.screenshot(shot); shot = undefined; }
    }
  } finally { await context.page.keyboard.up('w'); }
  const steady = samples.filter(item => item.t >= 0.6), [a, b] = [steady[0]!, steady.at(-1)!];
  const speed = Math.hypot(b.at[0]! - a.at[0]!, b.at[2]! - a.at[2]!) / (b.t - a.t);
  context.sample(label, { speed, airborne: steady.filter(item => !item.grounded).length, samples });
  return speed;
}

/** Lobby → the elastic hero equipped → PLAY → spawned as him (the elastic scenario's flow). */
async function spawned(context: ScenarioContext, checks: Record<string, boolean>) {
  const { observe, wait } = context;
  Object.assign(checks, await equipElastic(context));
  if (!checks.equipped) return false;
  await press(context, at.play);
  for (let tick = 0; tick < 180; tick++) {
    await wait(500);
    if ((await observe('match')).game?.hasStarted) break;
  }
  checks.spawned = (await poll(context, 'spawn', () => elasticOf(context, true), manager => !!manager, 20000)).matched;
  return checks.spawned;
}

// The elastic hero's legs (elastic/stretch.ts), alone, with the pickaxe: Space held jumps as the
// original without growing; a right click does not grow; the right button held grows the legs to their factor (bones
// read back), the hitbox, speed and camera grow, and walking covers about twice the ground; released, everything is
// back and the landing did no damage. With the rifle the button also zooms as the original: a click does not grow, a
// hold zooms and grows, and both end on release.
export const elasticstretch: Scenario = {
  entry: 'menu',
  heroes: ['elastic'],
  async run(context) {
    const { page, observe, sample, wait, screenshot } = context;
    const checks: Record<string, boolean> = {};
    if (!await spawned(context, checks)) return verdict(checks, 'The elastic hero did not spawn.');
    const stretch = await expected(context), { legs, thigh } = stretch;
    await wait(1500);
    await page.keyboard.press('f'); // the pickaxe (it does not zoom), and the click that takes the pointer
    await wait(500);
    await page.mouse.click(...at.center);
    await wait(1000);
    const base = await elasticOf(context, true), health = (await observe('match')).player?.health;
    sample('standing', base);
    // Standing, the motor capsule is the shaped body's: the motor's own (colliderHeight) taller by Root's raise.
    checks.shapedCapsule = near(base.player.stretch.capsule[0], base.player.stretch.initial + stretch.root, 1e-3);
    await screenshot('standing');
    const slow = await stride(context, 'walk-standing');
    const still = (manager: any) => near(factor(manager, thigh), 1, 1e-3) &&
      Object.values(grown(manager, base, stretch, 0, true)).every(Boolean);
    await page.keyboard.down('Space'); // held: the original jump only
    try {
      await wait(250);
      const jump = await elasticOf(context, true);
      await wait(1100);
      const after = await elasticOf(context, true);
      sample('space-held', { jump, after });
      checks.spaceJumpsOnly = jump.player.grounded === false && still(jump) && still(after);
    } finally { await page.keyboard.up('Space'); }
    await wait(1200);
    /** A right click shorter than HOLD (0.25 s): the state while pressed and 500 ms after the release. */
    const click = async () => {
      await page.mouse.down({ button: 'right' });
      let pressed: any;
      try {
        await wait(100);
        pressed = await elasticOf(context, true);
      } finally { await page.mouse.up({ button: 'right' }); }
      await wait(500);
      return { pressed, after: await elasticOf(context, true) };
    };
    const tap = await click();
    sample('click', tap);
    checks.clickNoStretch = still(tap.pressed) && still(tap.after);
    await page.mouse.down({ button: 'right' });
    let fast = 0;
    try {
      await wait(1600);
      const held = await elasticOf(context, true);
      sample('grown', held);
      checks.legsGrown = near(factor(held, thigh), legs);
      Object.assign(checks, Object.fromEntries(Object.entries(grown(held, base, stretch, 1, true))
        .map(([key, ok]) => [`grown_${key}`, ok])));
      await screenshot('stretched');
      fast = await stride(context, 'walk-stretched', 'walking-stretched');
    } finally { await page.mouse.up({ button: 'right' }); }
    sample('speeds', { slow, fast, ratio: fast / slow });
    checks.twiceAsFast = fast / slow > 1.85 && fast / slow < 2.15;
    await wait(1200);
    const back = await elasticOf(context, true);
    sample('released', back);
    checks.legsBack = near(factor(back, thigh), 1, 1e-3);
    Object.assign(checks, Object.fromEntries(Object.entries(grown(back, base, stretch, 0, true))
      .map(([key, ok]) => [`back_${key}`, ok])));
    checks.unhurt = (await observe('match')).player?.health === health;
    await screenshot('released');
    await page.keyboard.press('1'); // the rifle (the HUD's slot 1), which zooms on the same button
    await wait(1200);
    const rifleClick = await click(); // what the original's zoom does with it is sampled; it never grows
    if (rifleClick.after.player.stretch.aiming) await click();
    checks.rifleClickNoStretch = still(rifleClick.pressed) && still(rifleClick.after);
    await wait(500);
    await page.mouse.down({ button: 'right' });
    let aimed: any;
    try {
      await wait(1600);
      aimed = await elasticOf(context, true);
      await screenshot('rifle-held');
    } finally { await page.mouse.up({ button: 'right' }); }
    await wait(1200);
    const done = await elasticOf(context, true);
    sample('rifle', { click: rifleClick, aimed, done });
    checks.holdZoomsAndGrows = aimed.player.stretch.aiming === true && near(factor(aimed, thigh), legs);
    checks.releaseEndsBoth = done.player.stretch.aiming === false && still(done);
    return verdict(checks);
  },
};

// Over the network: A plays the elastic hero against B in the 1v1; A holds the right button and B's client grows A's
// legs (bones read back) and hitbox (motor capsule, legs trigger, center offset) from the `stretch` message, and
// shrinks them back when A releases.
export const elasticstretchlan: Scenario = {
  entry: 'menu',
  players: 2,
  heroes: ['elastic'],
  async run(a, b) {
    const duel = await heroDuel(a, b!, equipElastic);
    if (duel.reason) return verdict(duel.checks, duel.reason);
    const checks = duel.checks;
    const seen = await poll(b!, 'remote', () => elasticOf(b!, false), manager => !!manager, 20000);
    checks.remoteLook = seen.matched;
    if (!seen.matched) return verdict(checks, 'B does not see A as the elastic hero.');
    const stretch = await expected(b!), { legs, thigh } = stretch;
    // Both take the pickaxe before the click that takes the pointer lock (in build mode a click places a wall), and
    // B walks toward A and looks at it for the screenshots.
    for (const player of [a, b!]) {
      await player.page.keyboard.press('f');
      await player.wait(500);
      await player.page.mouse.click(...at.center);
    }
    const look = async () => {
      const target = other((await both(a, b!, 'positions'))[1])?.position;
      if (target) await aim(b!, [target[0]!, target[1]! + 1.2, target[2]!], [640, 380]);
    };
    await look();
    await b!.page.keyboard.down('w');
    try { await b!.wait(1300); } finally { await b!.page.keyboard.up('w'); }
    await look();
    await a.wait(1000);
    const base = await elasticOf(b!, false);
    // A's shaped body on B, against B's own player (the same player prefab, not shaped): taller by Root's raise.
    const own = (await me(b!))?.stretch;
    const [body, root] = [base.player.stretch, stretch.root];
    b!.sample('shaped', { body, own, root });
    checks.seenShaped = !!own && near(body.capsule[0], own.capsule[0] + root, 1e-3) &&
      near(body.capsule[1], own.capsule[1] + root / 2, 1e-3) && near(body.legs[0], own.legs[0] + root, 1e-3) &&
      near(body.legs[1], own.legs[1] + root / 2, 1e-3) && near(body.offset, own.offset + root / 2, 1e-3);
    await screenshots(a, b!, 'standing');
    await a.page.mouse.down({ button: 'right' });
    try {
      const held = await poll(b!, 'remote-grown', () => elasticOf(b!, false),
        manager => near(factor(manager, thigh), legs), 4000);
      checks.seenLegs = held.matched;
      Object.assign(checks, Object.fromEntries(Object.entries(grown(held.value, base, stretch, 1, false))
        .map(([key, ok]) => [`seen_${key}`, ok])));
      await a.wait(1200);
      await screenshots(a, b!, 'stretched');
    } finally { await a.page.mouse.up({ button: 'right' }); }
    const back = await poll(b!, 'remote-back', () => elasticOf(b!, false),
      manager => near(factor(manager, thigh), 1, 1e-3), 4000);
    checks.seenBack = back.matched && Object.values(grown(back.value, base, stretch, 0, false)).every(Boolean);
    return verdict(checks);
  },
};
