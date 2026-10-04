import { verdict, type Scenario } from '../index';
import { armors, press, ready, until, weapons } from '../shared/menu';

const W = 'lol.1v1.weapons.', A = 'lol.1v1.armors.body.';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// The original AUTO EQUIP (adapters/server-user.ts): the constructor's loadout stays until it is pressed, then the
// preset fills the slots in order.
export const autoequip: Scenario = {
  entry: 'menu',
  async run(context) {
    const { sample, observe, screenshot, wait } = context;
    const start = await until(context, 'start', menu => ready(menu), 20000);
    sample('items', await observe('items'));
    await press(context, [690, 604]); // AUTO EQUIP, under the character.
    await wait(3000);
    const after = await until(context, 'after', menu => ready(menu), 10000);
    await screenshot('autoequip');
    return verdict({
      initial: same(weapons(start.menu), [`${W}scar`, `${W}pump_shotgun`, '']) && same(armors(start.menu), ['']),
      weapons: same(weapons(after.menu), [`${W}plasma_rifle`, `${W}hellfire_shotgun`, `${W}rpg`]),
      armor: same(armors(after.menu), [`${A}energy`]),
    });
  },
};
