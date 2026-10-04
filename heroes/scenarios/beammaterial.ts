import { poll, verdict, type Scenario, type ScenarioContext } from '../../tests/e2e/scenarios/index';
import { equipBeam, startedHero } from './common';

/** The local player's PlayerSkinManager from observe('heroes'). */
const mine = async (context: ScenarioContext) =>
  (await context.observe('heroes')).managers?.find((manager: any) => manager.player?.mine);

// The beam hero's special material (beam/material.ts): Q held a second and released; once the glow is up the body
// shows the glass, the reference evaluated per vertex and the three dispersion fringes (screenshots through the
// effect, for the side-by-side with the reference). Read together mid-effect, the per-vertex pass has run on the posed
// body in the player's place (its world heights around the player's) at a few ms a frame; when the beam ends the
// body shows its own material again.
export const beammaterial: Scenario = {
  entry: 'menu',
  heroes: ['beam'],
  async run(context) {
    const { page, wait, screenshot, observe, sample } = context;
    const checks = await equipBeam(context);
    if (!checks.equipped) return verdict(checks, 'The beam hero was not equipped.');
    checks.started = await startedHero(context);
    await page.keyboard.press('1'); // The rifle out, as in beamsuper.
    await wait(1500);
    await page.keyboard.down('q');
    await wait(1000);
    await page.keyboard.up('q');
    const released = Date.now();
    checks.layers = (await poll(context, 'layers', () => mine(context), manager => ['beam glow', 'beam band']
      .every(name => manager?.materials?.includes(name)) &&
      manager.materials.filter((name: string) => name === 'beam rim').length === 3, 3000)).matched;
    for (const [label, at] of [['material-rise', 600], ['material-hover', 1500], ['material-beam', 2900],
      ['material-late', 4200]] as const) {
      await wait(Math.max(0, released + at - Date.now()));
      await screenshot(label);
      if (label !== 'material-hover') continue;
      const shaded = (await observe('heroes')).material, height = (await observe('match')).player?.position?.[1];
      sample('shaded', { shaded, height });
      const [low, high] = shaded?.bounds ?? [NaN, NaN];
      checks.shaded = shaded?.frames > 10 && shaded.vertices > 0;
      checks.placed = low >= height - 0.3 && high <= height + 2.4 && high - low > 0.5;
      checks.light = shaded?.average < 8;
    }
    checks.restored = (await poll(context, 'restored', () => mine(context),
      manager => manager?.materials?.length === 1 && manager.materials[0] === 'beam', 12000)).matched;
    return verdict(checks);
  },
};
