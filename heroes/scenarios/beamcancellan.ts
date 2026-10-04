import { poll, verdict, type Scenario } from '../../tests/e2e/scenarios/index';
import { aim, both, other, self } from '../../tests/e2e/scenarios/shared/lan';
import { equipBeam, heroDuel, remote, shields } from './common';

// Cancelling the beam hero's Q over the network (lan): A (the beam) and B start a 1v1 and A aims away from B. A arms,
// releases and cancels right after the jump: B sees A rise and fall back, with no barriers and no beam. A then fires:
// B's assault rifle burst at A hits A's barriers, not A, while B sees A's beam pass them (only their owner's casts go
// through, as the Cyborg's). A cancels: B sees the beam stop, the barriers go and A land.
export const beamcancellan: Scenario = {
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
    const view = (await both(a, b!, 'away'))[0], from = self(view)?.position, seen = other(view)?.position;
    if (from && seen) { // 20 m away from B and 10 m up: the beam reaches nobody.
      const dx = from[0]! - seen[0]!, dz = from[2]! - seen[2]!, k = 20 / (Math.hypot(dx, dz) || 1);
      await aim(a, [from[0]! + dx * k, from[1]! + 10, from[2]! + dz * k], mouse);
    }
    const ground = from?.[1] ?? 0;
    await b!.page.keyboard.press('1'); // B's assault rifle; its first click takes the pointer lock.
    await b!.wait(800);
    await b!.page.mouse.down();
    await b!.page.mouse.up();
    const bMouse: [number, number] = [640, 380];
    const vitals = async () => { const mine = self((await both(a, b!, 'vitals'))[0]); return mine?.dead ? -1 :
      (mine?.health ?? 0) + (mine?.armor ?? 0); };
    const tap = async () => { await a.page.keyboard.down('q'); await a.wait(120); await a.page.keyboard.up('q'); };
    const state = async () => ({ y: other((await both(a, b!, 'seen'))[1])?.position?.[1] ?? 0,
      view: await b!.observe('heroes'), player: await remote(b!) });
    for (const [cycle, beam] of [[1, false], [2, true]] as const) {
      await a.page.keyboard.down('q'); // Charging: 3 s (3.4 walls) to jump, the full 5.5 s (five walls) to fire.
      const charging = performance.now();
      checks[`armedSeen${cycle}`] = (await poll(b!, `armed-seen-${cycle}`, () => remote(b!),
        player => player?.activated === true && player?.firing === false, 5000)).matched;
      if (beam && from) await aim(b!, [from[0]!, from[1]! + 18, from[2]!], bMouse); // Where A will hover.
      await a.wait(Math.max(0, (beam ? 5500 : 3000) - (performance.now() - charging)));
      await a.page.keyboard.up('q');
      checks[`goneSeen${cycle}`] = (await poll(b!, `gone-seen-${cycle}`, state, ({ y, view, player }) => beam
        ? player?.firing === true && shields(view, false).length === 28 : y >= ground + 10, 7000)).matched;
      if (beam) {
        const before = await vitals();
        await b!.page.mouse.down();
        try { await b!.wait(1200); } finally { await b!.page.mouse.up(); }
        const seen = await state();
        const hits = shields(seen.view, false).reduce((sum: number, barrier: any) => sum + barrier.hits, 0);
        b!.sample('blocked', { before, after: await vitals(), hits });
        checks.blockedSeen = hits > 0 && await vitals() === before;
        checks.throughSeen = seen.player?.firing === true && seen.player?.beam?.stopped === false;
      }
      await tap();
      checks[`cancelSeen${cycle}`] = (await poll(b!, `cancel-seen-${cycle}`, state, ({ y, view, player }) =>
        y < ground + 1 && player?.firing === false && player?.activated === false && !shields(view, false).length,
        7000)).matched;
    }
    return verdict(checks);
  },
};
