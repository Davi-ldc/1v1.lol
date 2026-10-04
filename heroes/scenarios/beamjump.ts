import { verdict, type Scenario } from '../../tests/e2e/scenarios/index';
import { beamOf, equipBeam, flight, jump, jumpTwice, startedHero } from './common';

// The beam hero's double jump (beam/jump.ts): Space jumps as the original, upright; Space again in the air jumps again,
// higher, in a front flip (the head passes below the hips); after landing, unhurt, it works again.
export const beamjump: Scenario = {
  entry: 'menu',
  heroes: ['beam'],
  async run(context) {
    const { observe, wait } = context;
    const checks = await equipBeam(context);
    if (!checks.equipped) return verdict(checks, 'The beam hero was not equipped.');
    checks.started = await startedHero(context);
    await wait(1500);
    const ground = (await beamOf(context, true))?.y as number, health = (await observe('match')).player?.health;
    const single = await flight(context, 'single', ground, () => jump(context));
    const double = await flight(context, 'double', ground, () => jumpTwice(context), { shot: 'flip' });
    const again = await flight(context, 'again', ground, () => jumpTwice(context));
    checks.jumped = single.top > 0.5 && single.landed;
    checks.upright = single.head > 0.3;
    checks.higher = double.top > single.top + 0.5 && double.landed;
    checks.flipped = double.head < 0;
    checks.again = again.top > single.top + 0.5 && again.head < 0 && again.landed;
    checks.unhurt = (await observe('match')).player?.health === health;
    // The second jump cancels that flight's fall damage; a single jump keeps the original takeoff height, so a normal
    // fall still hurts as in the original.
    checks.fallKept = single.kept && !single.cancelled;
    checks.fallCancelled = double.cancelled && again.cancelled;
    return verdict(checks);
  },
};
