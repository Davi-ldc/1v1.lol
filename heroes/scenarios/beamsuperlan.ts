import { poll, verdict, type Scenario } from '../../tests/e2e/scenarios/index';
import { aim, both, brief, other, screenshots, self } from '../../tests/e2e/scenarios/shared/lan';
import { equipBeam, heroDuel, me, remote, sphere } from './common';

// The beam hero's Q over the network (lan): A (the beam) and B start a 1v1; A aims 3 m beside B, arms with Q and
// releases with Q. B's client shows A armed, rising five walls inside its sphere of 28 barriers and firing the
// original beam through them; A locks on B (B gets the lock), the beam bends onto B, who takes the original damage
// (applied by A's client through TakeHit; the red tier, 80 a tick: B reads 200 less multiples of 80 until it dies),
// and A lands.
export const beamsuperlan: Scenario = {
  entry: 'menu',
  players: 2,
  heroes: ['beam'],
  async run(a, b) {
    const mouse: [number, number] = [640, 380];
    const duel = await heroDuel(a, b!, equipBeam, () => a.page.mouse.move(...mouse, { steps: 6 }));
    if (duel.reason) return verdict(duel.checks, duel.reason);
    const checks = duel.checks;
    await a.page.mouse.down(); // The game takes the pointer lock (before arming: a shot would release).
    await a.page.mouse.up();
    await a.wait(500);
    // A aims 3 m to B's side (across the line A→B): the straight beam misses B, the locked one bends onto it.
    const target = async () => {
      const view = (await both(a, b!, 'target'))[0], seen = other(view)?.position, from = self(view)?.position;
      if (!seen || !from) return null;
      const dx = seen[0]! - from[0]!, dz = seen[2]! - from[2]!, side = 3 / (Math.hypot(dx, dz) || 1);
      return [seen[0]! - dz * side, seen[1]! + 1.2, seen[2]! + dx * side];
    };
    // Aimed already as it will hover (five walls up, the camera keeps its direction): B stays in the crosshair.
    const first = await target();
    if (first) await aim(a, [first[0]!, first[1]! - 17.5, first[2]!], mouse);
    // B looks up at where A will hover, to see the curve come down (its click takes the pointer lock).
    await b!.page.mouse.down();
    await b!.page.mouse.up();
    const hover = self((await both(a, b!, 'hover'))[0])?.position;
    if (hover) await aim(b!, [hover[0]!, hover[1]! + 18, hover[2]!], [640, 380]);
    const ground = self((await both(a, b!, 'ground'))[0])?.position?.[1] ?? 0;
    const health = async () => { const mine = self((await both(a, b!, 'health'))[1]); return mine?.dead ? -1 :
      (mine?.health ?? 0) + (mine?.armor ?? 0); };
    const before = await health();
    const bId = (await me(b!))?.id;
    await a.page.keyboard.down('q'); // Held 5.5 s: the full charge, five walls.
    const charging = performance.now();
    checks.armedSeen = (await poll(b!, 'armed-seen', () => remote(b!),
      player => player?.activated === true && player?.firing === false, 5000)).matched;
    // B sees A's charge aura (beam/aura.ts), red past the full charge (B's clock starts a little later).
    await a.wait(Math.max(0, 5200 - (performance.now() - charging)));
    checks.auraSeen = (await poll(b!, 'aura-seen', () => remote(b!),
      player => player?.aura?.emitting === true && player.aura.hue < 40, 1000)).matched;
    await a.wait(Math.max(0, 5500 - (performance.now() - charging)));
    await a.page.keyboard.up('q');
    // B's health plus armor from its own client until it dies (-1: dead or gone), from the release on.
    const healths: number[] = [];
    let watching = true;
    const watch = (async () => {
      while (watching && healths.at(-1) !== -1) {
        const own = self(brief(await b!.observe('match')));
        healths.push(!own || own.dead ? -1 : (own.health ?? 0) + (own.armor ?? 0));
        await b!.wait(20);
      }
    })();
    const heightSeen = async () => other((await both(a, b!, 'rise'))[1])?.position?.[1] ?? 0;
    checks.roseSeen = (await poll(b!, 'rose-seen', heightSeen, y => y >= ground + 15, 5000)).matched;
    checks.sphereSeen = (await poll(b!, 'sphere-seen', () => b!.observe('heroes'), view => sphere(view, false), 5000))
      .matched;
    checks.firingSeen = (await poll(b!, 'firing-seen', () => remote(b!), player => player?.firing === true, 5000))
      .matched;
    await screenshots(a, b!, 'beam');
    // B in its lock window: A locks on B (the Seeker's GetLockOnTarget, 2×) and B gets the lock by RPC.
    checks.locked = (await poll(a, 'locked', () => me(a), player => player?.lock === bId, 2000)).matched;
    checks.lockedSeen = (await poll(b!, 'locked-seen', () => remote(b!), player => player?.lock === bId, 1000)).matched;
    await screenshots(a, b!, 'curve');
    await Promise.race([watch, a.wait(8000)]);
    watching = false;
    await watch;
    b!.sample('healths', healths);
    checks.damaged = healths.includes(-1);
    const hurt = healths.filter(value => value !== -1 && value !== before);
    checks.perHit = hurt.length > 0 && hurt.every(value => (before - value) % 80 === 0);
    checks.landedSeen = (await poll(b!, 'landed-seen', heightSeen, y => y < ground + 1, 15000)).matched;
    await screenshots(a, b!, 'landed');
    return verdict(checks);
  },
};
