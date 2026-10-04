import { verdict, type Scenario, type ScenarioContext } from '../../tests/e2e/scenarios/index';
import { aim } from '../../tests/e2e/scenarios/shared/lan';
import { equipBeam, slowMotion, startedHero } from './common';

const click = async ({ page, wait }: ScenarioContext) => {
  await page.mouse.down();
  await wait(60);
  await page.mouse.up();
};

/** observe('swordAnim') sampled as fast as the page answers for `ms`, while `act` plays. */
async function watch(context: ScenarioContext, label: string, act: () => Promise<void>, ms: number) {
  const seen: any[] = [], start = Date.now(), acting = act();
  while (Date.now() - start < ms) seen.push({ at: Date.now() - start, ...await context.observe('swordAnim') });
  await acting;
  context.sample(label, seen.map(({ at, anim, pickaxe, parent, ik }) => ({ at, anim, state: pickaxe?.hash,
    t: pickaxe ? +(pickaxe.t * pickaxe.length).toFixed(3) : null, parent, ik })));
  return seen;
}
const swings = (seen: any[]) => seen.filter(item => item.anim?.kind === 'swing');

/**
 * A frame strip: with the swing `slow`× slower (slowMotion), the right button held `hold` ms and let go (the sword's
 * tiered swing) or, with no hold, the left button (a plain swing), and `frames` screenshots over it.
 */
async function strip(context: ScenarioContext, label: string, hold: number, seconds: number, slow = 6, frames = 10) {
  const { page, wait, screenshot } = context;
  await slowMotion(context, slow);
  await wait(400);
  if (hold) {
    await page.mouse.down({ button: 'right' });
    await wait(hold);
    await screenshot(`${label}-charge`);
    await page.mouse.up({ button: 'right' });
  } else await click(context);
  const start = Date.now();
  for (let frame = 0; frame < frames; frame++) {
    const due = start + (frame / (frames - 1)) * seconds * slow * 1000;
    if (Date.now() < due) await wait(due - Date.now());
    await screenshot(`${label}-${frame}`);
  }
  await slowMotion(context, 1);
  await wait(1200);
}

// The beam hero's sword motion (beam/sword-anim.ts) over the original melee swing: a plain swing (left button), the
// right button held into the max and medium charge poses and let go (the sword's tiered swing, beam/sword.ts),
// PlayerIK back after, and slowed frame strips of the three swings.
export const beamswordanim: Scenario = {
  entry: 'menu',
  heroes: ['beam'],
  async run(context) {
    const { page, observe, wait, screenshot } = context;
    const checks = await equipBeam(context);
    if (!checks.equipped) return verdict(checks, 'The beam hero was not equipped.');
    checks.started = await startedHero(context);
    await page.keyboard.press('f');
    await wait(1500);
    const at = (await observe('match')).player?.position as number[], view = (await observe('match')).camera;
    if (at && view) {
      const flat = Math.hypot(view.forward[0], view.forward[2]) || 1;
      await aim(context, [at[0] + 12 * view.forward[0] / flat, at[1] + 1.4, at[2] + 12 * view.forward[2] / flat],
        [640, 380]);
    }
    const idle = await observe('swordAnim');
    checks.melee = idle.weapon === 'MeleeWeaponModel';
    // A plain swing: the strike reaches the hit with the original MeleeSwingHit (0.13 s into SwingLeft/Right).
    const plain = swings(await watch(context, 'plain', () => click(context), 1300));
    checks.plainSwing = plain.length > 3 && plain.every(item => item.anim.tier === 0);
    checks.rightHand = plain.some(item => item.anim.shown);
    checks.full = plain.some(item => item.anim.w > 0.99);
    // Charging: the right button held through the tiers (0.6 s and 1.2 s), let go into the max swing.
    await wait(800);
    const charge = await watch(context, 'charge', async () => {
      await page.mouse.down({ button: 'right' });
      await wait(1500);
    }, 1450);
    const tiers = charge.filter(item => item.anim?.kind === 'charge').map(item => item.anim.tier);
    checks.chargePose = tiers.includes(0) && tiers.includes(1) && tiers.includes(2);
    await screenshot('charge-max');
    const max = swings(await watch(context, 'max', () => page.mouse.up({ button: 'right' }), 1300));
    checks.maxSwing = max.length > 3 && max.every(item => item.anim.tier === 2);
    // A medium charge let go into its swing (no screenshot while held: its stall would cross the 1.2 s tier).
    await wait(1000);
    await page.mouse.down({ button: 'right' });
    await wait(850);
    const medium = swings(await watch(context, 'medium', () => page.mouse.up({ button: 'right' }), 1300));
    checks.mediumSwing = medium.length > 3 && medium.every(item => item.anim.tier === 1);
    // After the swing the Animator's pose and PlayerIK are back.
    const after = (await watch(context, 'after', () => wait(0), 300)).at(-1);
    checks.ikBack = !after?.anim && after?.ik === true;
    // Frame strips for the visual review, each tier.
    await strip(context, 'plain', 0, 0.72);
    await strip(context, 'medium', 650, 0.8);
    await strip(context, 'max', 1500, 0.88);
    return verdict(checks);
  },
};
