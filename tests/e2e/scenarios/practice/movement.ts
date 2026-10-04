import { verdict, type Scenario } from '../index';
import { at } from '../shared/menu';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// W held gives axes [0,1] and moves the player; released gives [0,0].
export const movement: Scenario = {
  entry: 'practice',
  async run({ page, elapsed, wait, observe, sample, screenshot }) {
    await wait(Math.max(0, 25000 - elapsed()));
    const before = await observe('match');
    sample('before', before);
    if (before.player?.state !== 'observed') return verdict({}, 'No local player.');
    await page.mouse.click(...at.center); // Focus through real input.
    await wait(250);
    const focused = await observe('match');
    sample('focused', focused);
    await page.keyboard.down('w');
    let held;
    try {
      await wait(1200);
      held = await observe('match');
      sample('w-held', held);
    } finally { await page.keyboard.up('w'); }
    await wait(250);
    const released = await observe('match');
    sample('w-released', released);
    await screenshot('movement');
    const [a, b] = [focused.player?.position ?? [], held.player?.position ?? []];
    return verdict({
      forwardAxis: same(held.game?.axes14And15, [0, 1]),
      moved: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) > 1,
      releasedAxis: same(released.game?.axes14And15, [0, 0]),
    });
  },
};
