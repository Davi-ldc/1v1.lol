import { sample, type Native } from '../../../src/page/native';
import { beamSwordAnims } from '../beam/sword-anim';
import { field, slot } from '../symbols';

/**
 * The local player's melee timing and the beam hero's sword poses (beam/sword-anim.ts): the current weapon's class
 * and parent (MeleeWeaponModel.HitAnimationStarted, f106569, parents it to `_offHandTransform`; Finished, f106570, back
 * to `_mainHandTransform`), WeaponsController.TimeSinceAttacked, the PickaxeLayer's current state (AnimatorStateInfo:
 * shortNameHash +0, normalizedTime +12, length +16), PlayerIK's flag, and every posed player.
 */
export function observeSwordAnim(n: Native) {
  return sample(() => {
    const mine = n.call(slot.playerMine, 0);
    if (!mine || !n.alive(mine)) return { state: 'absent' };
    const name = (object: number) => object && n.alive(object) ? n.text(n.call(slot.objectName, object, 0)) : null;
    const weapons = n.u32(mine, field.PlayerController._weaponsController);
    const weapon = weapons ? n.u32(weapons, field.WeaponsController.CurrentWeapon) : 0;
    const melee = !!weapon && n.alive(weapon) && n.className(weapon) === 'MeleeWeaponModel';
    const animator = weapons ? n.u32(weapons, field.WeaponsController._animator) : 0;
    const layer = animator && n.alive(animator) ? Array.from({ length: n.call(slot.animatorLayerCount, animator, 0) },
      (_, k) => k).find(k => n.text(n.call(slot.animatorLayerName, animator, k, 0)) === 'PickaxeLayer') : undefined;
    const pickaxe = layer === undefined ? null : n.scratch(36, at => {
      n.call(slot.animatorStateInfo, at, animator, layer, 0);
      return { hash: n.i32(at, 0), t: +n.f32(at, 12).toFixed(3), length: +n.f32(at, 16).toFixed(3),
        transition: n.call(slot.animatorInTransition, animator, layer, 0) === 1 };
    });
    const parent = weapon && n.alive(weapon)
      ? n.call(slot.transformParent, n.call(slot.componentTransform, weapon, 0), 0) : 0;
    const ik = n.u32(mine, field.PlayerController.PlayerIK);
    return { state: 'observed', weapon: weapon && n.alive(weapon) ? n.className(weapon) : null, name: name(weapon),
      parent: name(parent), main: melee ? name(n.u32(weapon, field.MeleeWeaponModel._mainHandTransform)) : null,
      since: weapons ? +n.f32(weapons, field.WeaponsController.TimeSinceAttacked).toFixed(3) : null,
      ik: ik && n.alive(ik) ? n.bool(ik, field.PlayerIK.IsIKEnabled) : null, pickaxe,
      anim: beamSwordAnims.get(mine) ?? null,
      anims: [...beamSwordAnims].filter(([player]) => n.alive(player)).map(([player, pose]) => ({
        id: n.call(slot.playerOwnerId, player, 0), mine: player === mine, kind: pose.kind, tier: pose.tier })) };
  });
}
