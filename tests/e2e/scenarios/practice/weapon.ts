import { verdict, type Scenario } from '../index';
import { at } from '../shared/menu';

const PICKAXE = 'lol.1v1.weapons.melee.defaultpickaxe';

// Original offline Practice: CreateWeapons falls back to WeaponStatsDatabase._startingWeapons (defaultpickaxe,
// shotgun, AR, sniper), defaultpickaxe first, level 1, DamageToBuildings 75; a new wall has 150, so the second hit
// destroys it (150→75→0). Building damage is not player damage.
export const weapon: Scenario = {
  entry: 'practice',
  async run({ page, elapsed, wait, observe, sample, screenshot }) {
    await wait(Math.max(0, 25000 - elapsed()));
    let building = 0;
    const state = async (label: string) => {
      const edit = await observe('edit', building);
      if (edit.target && !building) building = edit.target;
      const native = await observe('weapons', building);
      sample(label, native);
      return native;
    };
    const before = await state('before');
    const initialized = before.didInitialize === true && before.slots?.[0]?.id === PICKAXE;
    if (!initialized) return verdict({ initialized },
      'Native weapon initialization did not produce the default pickaxe in slot 0.');
    await page.keyboard.press('f');
    await wait(500);
    const selected = await state('selected');
    await screenshot('weapon-equipped');
    await page.mouse.click(...at.center);
    await wait(250);
    await page.keyboard.press('z');
    await wait(300);
    await page.mouse.click(...at.center); // Build a wall through original input.
    await wait(800);
    const wall = await state('wall');
    await page.keyboard.press('f');
    await wait(500);
    await state('reselected');
    await page.keyboard.down('w');
    try { await wait(400); } finally { await page.keyboard.up('w'); }
    await wait(250);
    await state('before-attack');
    let firstHit, secondHit;
    await page.mouse.down();
    try {
      await wait(700);
      firstHit = await state('attack-700ms');
      await wait(700);
      secondHit = await state('attack-1400ms');
    } finally { await page.mouse.up(); }
    await wait(500);
    await state('after-attack');
    await screenshot('weapon-after-attack');
    return verdict({
      initialized,
      selected: selected.currentIndex === 0 && selected.equipped?.id === PICKAXE,
      wall: wall.target?.maxHealth === 150 && wall.target?.health === 150,
      firstHit: firstHit.target?.health === 75,
      secondHitKills: secondHit.target?.health === 0, // The wall object outlives its health during the destroy delay.
    });
  },
};
