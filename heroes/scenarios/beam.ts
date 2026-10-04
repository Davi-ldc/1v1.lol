import { poll, verdict, type Scenario } from '../../tests/e2e/scenarios/index';
import { at, press } from '../../tests/e2e/scenarios/shared/menu';
import { beamLook, championOf, equipBeam } from './common';

// The beam hero (heroes/page/index.ts): CHAMPIONS lists him at max level in the prefab's 12th card, the card opens his
// overview, SELECT equips him, the lobby shows him, and PLAY spawns him with Poseidon's original abilities and his own
// skin ID, showing his scan (shared/look.ts).
export const beam: Scenario = {
  entry: 'menu',
  heroes: ['beam'],
  async run(context) {
    const { page, observe, sample, wait, screenshot } = context;
    const checks = await equipBeam(context);
    if (!checks.equipped) return verdict(checks, 'The beam hero was not equipped.');
    checks.lobbyLook = (await poll(context, 'lobby-heroes', () => observe('heroes'),
      view => !!view.managers?.some((manager: any) => manager.active && beamLook(manager)), 10000)).matched;
    await wait(2000);
    await screenshot('lobby');
    await press(context, at.play);
    for (let tick = 0; tick < 180; tick++) {
      await wait(500);
      if ((await observe('match')).game?.hasStarted) break;
    }
    const mine = (view: any) => view.managers?.find((manager: any) => manager.player?.mine);
    const spawned = await poll(context, 'heroes', () => observe('heroes'), view => beamLook(mine(view)), 20000);
    const self = mine(spawned.value);
    checks.champion = self?.player.champion === await championOf(context, 'beam');
    checks.look = beamLook(self);
    checks.poseidonAbility = !!self?.player.abilities?.includes('AquaCannonAbility');
    sample('self', self);
    await screenshot('match');
    await page.keyboard.down('w'); // The original locomotion on the scan.
    await wait(700);
    await screenshot('walk');
    await page.keyboard.up('w');
    return verdict(checks);
  },
};
