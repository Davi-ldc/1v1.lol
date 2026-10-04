import type { Native } from '../../../src/page/native';
import type { HeroNet } from '../shared/net';
import { slot } from '../symbols';

/**
 * The Seeker's lock-on (CombatHelper.GetLockOnTarget, slot 10403) asked every frame with RANGE and viewport margins
 * MARGIN, its answer the lock at once (heroes/README.md, "The beam"). Each change reaches every client as a `lock`
 * message: the target's OwnerID, −1 for none.
 */
const RANGE = 500, MARGIN = [0.2, 0.3] as const;

/** The lock each beam player's owner announced, on this client: its target PlayerController (0: none). */
export const beamLocks = new Map<number, number>();

export function installBeamLockOn(n: Native, net: HeroNet) {
  net.on('lock', (hero, target) => beamLocks.set(hero, target >= 0 ? net.player(target) : 0));
  const announce = (owner: number, target: number) => net.send('lock', owner, target ? net.ownerId(target) : -1);
  // The owner's announced target, by its player (0: none).
  const announced = new Map<number, number>();
  return {
    /** One frame of the owner's lock-on for `owner` (its release runs). */
    scan(owner: number) {
      const found = n.call(slot.lockOnTarget, owner, RANGE, MARGIN[0], MARGIN[1], 0);
      if (found === (announced.get(owner) ?? 0)) return;
      announced.set(owner, found);
      announce(owner, found);
    },
    /** Ends the owner's lock-on for `owner` (its release ended), announcing the release of a held lock. */
    stop(owner: number) {
      if (announced.get(owner)) announce(owner, 0);
      announced.delete(owner);
    },
    /** This client forgets `player`'s announced lock (its release ended here). */
    forget: (hero: number) => beamLocks.delete(hero),
  };
}
