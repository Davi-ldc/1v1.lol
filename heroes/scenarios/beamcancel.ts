import { poll, verdict, type Scenario } from '../../tests/e2e/scenarios/index';
import { aim } from '../../tests/e2e/scenarios/shared/lan';
import { equipBeam, height, me, shields, sphere, startedHero } from './common';

// Cancelling the beam hero's Q (Q after the release) in one match: twice while the beam fires (it stops, the barriers
// go; the second sphere reuses pooled barriers and the beam still passes through it), then right after the jump
// ("activate, jump, deactivate": no barriers, no beam). Each time the slot is free again and he falls back unhurt
// (fall damage counts from the takeoff ground).
export const beamcancel: Scenario = {
  entry: 'menu',
  heroes: ['beam'],
  async run(context) {
    const { page, observe, wait, screenshot } = context;
    const checks: Record<string, boolean> = { ...await equipBeam(context) };
    if (!checks.equipped) return verdict(checks, 'The beam hero was not equipped.');
    checks.started = await startedHero(context);
    if (!checks.started) return verdict(checks, 'The match did not start.');
    const spot = (await observe('match')).player?.position as number[];
    await aim(context, [spot[0]! + 10, spot[1]! + 1.5, spot[2]!], [640, 380]); // The horizon.
    await page.keyboard.press('1');
    await wait(500);
    const ground = await height(context);
    const vitals = async () => {
      const player = (await observe('match')).player;
      return (player?.health ?? 0) + (player?.armor ?? 0);
    };
    const before = await vitals();
    // A held tap: down and up in one frame can be missed.
    const tap = async () => { await page.keyboard.down('q'); await wait(120); await page.keyboard.up('q'); };
    const hold = async (seconds: number) => { await wait(1000 * seconds); await page.keyboard.up('q'); };
    const idle = (player: any) => player?.activated === false && player?.firing === false;
    const settled = async () => ({ y: await height(context), player: await me(context),
      barriers: shields(await observe('heroes'), true).length });
    for (const [cycle, beam] of [[1, true], [2, true], [3, false]] as const) {
      await page.keyboard.down('q');
      checks[`armed${cycle}`] = (await poll(context, `armed${cycle}`, () => me(context),
        player => player?.activated === true && player?.firing === false, 5000)).matched;
      await hold(beam ? 1 : 3); // Three seconds of charge: 3.4 walls.
      if (beam) {
        const state = async () => ({ view: await observe('heroes'), player: await me(context) });
        checks[`through${cycle}`] = (await poll(context, `through${cycle}`, state, ({ view, player }) =>
          sphere(view, true) && player?.firing === true && player?.beam?.stopped === false, 6000)).matched;
        await screenshot(`beam${cycle}`);
      } else {
        checks.jumped = (await poll(context, 'jumped', () => height(context), y => y >= ground + 10, 1500)).matched;
      }
      await tap();
      checks[`cancelled${cycle}`] = (await poll(context, `cancelled${cycle}`, () => me(context), idle, 1500)).matched;
      checks[`landed${cycle}`] = (await poll(context, `landed${cycle}`, settled, ({ y, player, barriers }) =>
        y < ground + 1 && idle(player) && barriers === 0, 6000)).matched;
      await screenshot(`landed${cycle}`);
      checks[`unhurt${cycle}`] = await vitals() === before;
    }
    await page.keyboard.down('q');
    checks.rearmed = (await poll(context, 'rearmed', () => me(context),
      player => player?.activated === true && player?.firing === false, 3000)).matched;
    await page.keyboard.up('q');
    return verdict(checks);
  },
};
