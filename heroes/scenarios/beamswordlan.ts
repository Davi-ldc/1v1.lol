import { poll, verdict, type Scenario, type ScenarioContext } from '../../tests/e2e/scenarios/index';
import { aim, both, other, screenshots, self, type Brief } from '../../tests/e2e/scenarios/shared/lan';
import { at } from '../../tests/e2e/scenarios/shared/menu';
import { equipBeam, heroDuel } from './common';

/** B's own health plus armor (-1 dead or gone), from a pair of views. */
const vital = (own?: ReturnType<typeof self>) => !own || own.dead ? -1 : (own.health ?? 0) + (own.armor ?? 0);
/** Each tier's horizontal push (N·s): beam/sword-spec.ts `knock` (1, 3, 9) × beam/sword.ts KNOCK (150). */
const PUSH = [150, 450, 1350];
/** Where A swings from: within tier 0's reach (the pickaxe's Range 3 × 1.5) with margin. */
const REACH: [number, number] = [2.4, 3.4];
/** The beam hero's run speed with the pickaxe (m/s, measured in probe runs), for tap lengths. */
const SPEED = 7;
const flat = (p?: number[], q?: number[]) => p && q ? Math.hypot(p[0]! - q[0]!, p[2]! - q[2]!) : Infinity;

/**
 * `player` walks to within `reach` m (horizontally) of the point `where` gives (its own position and the target, as
 * its client sees them): it waits until it stands still, aims at the target, and taps W or S for a time proportional
 * to the distance left at run speed, short of it (holding a key until a polled distance matches overshoots under
 * load). Returns the distance reached.
 */
async function walkTo(player: ScenarioContext, mouse: [number, number], label: string, reach: [number, number],
  where: () => Promise<{ me?: number[]; target?: number[] }>) {
  let d = Infinity;
  for (let step = 0; step < 12; step++) {
    let at = await where();
    for (let k = 0; k < 15; k++) { // Still: two reads 200 ms apart within 5 cm.
      await player.wait(200);
      const next = await where();
      const moved = flat(next.me, at.me);
      at = next;
      if (moved < 0.05) break;
    }
    if (!at.me || !at.target) return Infinity;
    d = flat(at.me, at.target);
    await aim(player, [at.target[0]!, at.target[1]! + 1.2, at.target[2]!], mouse);
    if (d >= reach[0] && d <= reach[1]) break;
    const key = d > reach[1] ? 'w' : 's', left = Math.abs(d - (reach[0] + reach[1]) / 2);
    await player.page.keyboard.down(key);
    await player.wait(Math.min(800, Math.max(60, left / SPEED * 700)));
    await player.page.keyboard.up(key);
  }
  player.sample(`${label}-reached`, d);
  return d;
}

// The beam hero's sword over the network (beam/sword.ts): A, as the beam, walks up to B and hits B once per tier, a
// left click (tier 0), a right-button charge of 1.6 s (tier 2) and of 0.9 s (tier 1), each from REACH. A's hits carry
// the pickaxe's damage ×3, ×5 and ×4 and B's own client loses that much; it pushes itself away, at least 1.5 m at tier
// 0, farther at tier 2, at speeds growing with the tier, and walks back; B sees the sword in A's hand. The three hits
// (240) outdo B's 200: the last kills B, whose despawn cuts its flight, so that one (tier 1) is checked by its push.
export const beamswordlan: Scenario = {
  entry: 'menu',
  players: 2,
  heroes: ['beam'],
  async run(a, b) {
    const duel = await heroDuel(a, b!, equipBeam);
    if (duel.reason) return verdict(duel.checks, duel.reason);
    const checks = duel.checks;
    // Both take the pointer lock holding the pickaxe (the 1v1 starts on the wall piece: a click would build).
    await a.page.keyboard.press('f');
    await b!.page.keyboard.press('f');
    await a.wait(500);
    await a.page.mouse.click(...at.center);
    await b!.page.mouse.click(...at.center);
    await a.wait(1500);
    const mouse: [number, number] = [640, 380], mouseB: [number, number] = [640, 380];
    const view = async (label: string) => (await both(a, b!, label)) as [Brief, Brief];
    const home = self((await view('home'))[1])?.position;
    const approach = () => walkTo(a, mouse, 'approach', REACH, async () => {
      const [seen] = await view('approach');
      return { me: self(seen)?.position, target: other(seen)?.position };
    });
    await approach();
    checks.seenSword = (await poll(b!, 'seen-sword', () => b!.observe('sword'),
      view => !!view.players?.some((player: any) => !player.mine && player.mesh === 'beam sword'), 5000)).matched;
    await screenshots(a, b!, 'swords');
    const results: { tier: number; reach: number; drop: number; died: boolean; moved: number; swing?: any; hit?: any;
      push?: any }[] = [];
    for (const [tier, hold] of [[0, 0], [2, 1600], [1, 900]] as const) {
      const reach = await approach();
      const own = self((await view(`before-${tier}`))[1]), start = own?.position, before = vital(own);
      if (hold) {
        await a.page.mouse.down({ button: 'right' });
        await a.wait(hold);
        await a.page.mouse.up({ button: 'right' });
      } else {
        await a.page.mouse.down();
        await a.wait(80);
        await a.page.mouse.up();
      }
      // B's own client for 2.5 s: its health after the hit and its farthest horizontal distance from where it stood.
      let after = before, moved = 0;
      for (const until = Date.now() + 2500; Date.now() < until;) {
        const seen = self((await view(`flight-${tier}`))[1]);
        after = Math.min(after, vital(seen));
        moved = Math.max(moved, flat(seen?.position, start));
      }
      const dealt = await a.observe('sword'), knocks = (await b!.observe('sword')).knocks ?? [];
      const last = (entries: any[] | undefined) => entries?.findLast((entry: any) => entry.tier === tier);
      results.push({ tier, reach: +reach.toFixed(2), drop: after < 0 ? before : before - after, died: after < 0,
        moved: +moved.toFixed(2), swing: hold ? last(dealt.swings) : undefined, hit: last(dealt.hits),
        push: last(knocks) });
      if (after < 0) break;
      // B walks back to where it stood first, near its spawn, for the next swing.
      if (home && moved > 2) {
        await walkTo(b!, mouseB, 'home', [0, 1.5], async () =>
          ({ me: self((await view('return'))[1])?.position, target: home }));
      }
    }
    a.sample('results', results);
    for (const { tier, reach, drop, died, hit, push } of results) {
      checks[`reach${tier}`] = reach >= REACH[0] && reach <= REACH[1];
      // The hit carries the tier's multiple of the pickaxe's damage; B loses it all, or what it had left.
      const ratio = hit ? hit.damage / hit.base : 0;
      checks[`damage${tier}`] = Math.abs(ratio - [3, 4, 5][tier]!) < 0.01 &&
        (died ? drop <= hit.damage + 1 : Math.abs(drop - hit.damage) <= 1);
      checks[`push${tier}`] = !!push && Math.abs(push.impulse - PUSH[tier]!) < 0.5;
    }
    const of = (tier: number) => results.find(result => result.tier === tier);
    checks.moved0 = of(0)?.moved! >= 1.5 && !of(0)!.died;
    checks.moved2 = of(2)?.moved! > of(0)?.moved! && !of(2)!.died;
    checks.faster = of(0)?.push?.speed < of(1)?.push?.speed && of(1)?.push?.speed < of(2)?.push?.speed;
    checks.allTiers = results.length === 3;
    await screenshots(a, b!, 'after');
    return verdict(checks);
  },
};
