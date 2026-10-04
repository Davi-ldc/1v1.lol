import type { Native } from '../../../src/page/native';
import type { HeroNet } from '../shared/net';
import { field, literal, runtime, slot } from '../symbols';

type Pose = (manager: number, name: string, t: number) => boolean;

/** The takeoff height kept while a second jump flies, so HandleFallDamage (f48665) never hurts that landing. */
const FLOOR = -1e9;
/**
 * Adaptation: the beam hero's double jump (heroes/README.md, "Double jump"). In the air, his owner's second Jump press
 * restarts the original jump (vThirdPersonMotor isJumping, jumpCounter = jumpTimer) once per flight and keeps the
 * takeoff at FLOOR; every client plays the clip `flip` (`length` s) from the `flip` message.
 */
export function installBeamJump(n: Native, net: HeroNet, pose?: Pose, length = 0) {
  const M = field.vThirdPersonMotor;
  /** The owner's players that jumped in the air in this flight. */
  const used = new Set<number>();
  /** When each player's flip started (s), on this client. */
  const flips = new Map<number, number>();
  const now = () => performance.now() / 1000;
  net.on('flip', hero => flips.set(hero, now()));
  return {
    /** One frame of `player` after its Animator: its flip, and its owner's air jump unless `busy`. */
    frame(player: number, mine: boolean, busy: boolean) {
      const start = flips.get(player);
      if (start !== undefined && (busy || now() - start > length ||
        !pose?.(n.check(n.u32(player, field.PlayerController._playerSkinManager)), 'flip', now() - start))) {
        flips.delete(player);
      }
      const motor = mine ? n.u32(player, field.PlayerController._thirdPersonController) : 0;
      if (!motor) return;
      if (n.bool(motor, M._isGrounded)) { used.delete(player); return; }
      const takeoff = field.PlayerController._lastGroundedYPosition + runtime.nullableValue;
      if (used.has(player)) n.setF32(player, takeoff, FLOOR);
      if (busy || used.has(player) || n.call(slot.buttonDown, literal.jumpAction, 0) !== 1) return;
      used.add(player);
      n.setF32(player, takeoff, FLOOR);
      n.write(motor, M.isJumping, Uint8Array.of(1));
      n.setF32(motor, M.jumpCounter, n.f32(motor, M.jumpTimer));
      net.send('flip', player, 0);
    },
  };
}
