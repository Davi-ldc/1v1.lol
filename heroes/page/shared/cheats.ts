import type { Native } from '../../../src/page/native';
import { field, slot } from '../symbols';
import type { HeroFrame } from './frame';

/**
 * Adaptation: the heroes' cheat detectors are off (heroes/README.md): FlyingCheatDetector would flag the beam hero's
 * hover and, with offline limits of 0, every jump. Each player whose PlayerSkinManager shows a hero's scan
 * (`managers`, from shared/look.ts) has its PlayerController.CheatsMonitor._cheatDetectors switched off the way the
 * original does after a detection, Behaviour.set_enabled(false), once per CheatsMonitor, on every client.
 */
export function installHeroCheats(n: Native, frames: HeroFrame, managers: () => number[]) {
  const checked = new Map<number, number>();
  frames.on('LOCAL_HERO_CHEATS', () => {
    for (const manager of managers()) {
      const player = n.u32(manager, field.PlayerSkinManager._playerController);
      const monitor = player && n.alive(player) ? n.u32(player, field.PlayerController.CheatsMonitor) : 0;
      if (!monitor || checked.get(player) === monitor) continue;
      checked.set(player, monitor);
      for (const detector of n.list(n.u32(monitor, field.PlayerCheatsMonitor._cheatDetectors), 16)) {
        if (n.alive(detector)) n.call(slot.behaviourSetEnabled, detector, 0, 0);
      }
    }
  });
}
