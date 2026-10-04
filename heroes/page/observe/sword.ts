import { sample, type Native } from '../../../src/page/native';
import { beamSwords, swordJewels, swordLog } from '../beam/sword';
import { heroOf } from '../ids';
import { field, literal, slot, staticField, typeInfo } from '../symbols';

/**
 * The beam hero's sword on this client (beam/sword.ts): per beam player its OwnerID, local flag, whether he holds
 * the pickaxe, the mesh and materials its current skin renderer shows and that material's `_Emission1`, the charge
 * state, where its guard and pommel jewels are on screen (Camera.main, pixels from the bottom left, depth), its
 * pickaxe's WeaponStats.Range and EquipDelay, and the local WeaponsController's equip delay left and aim flag; the
 * last charged swings and sword hits this client dealt and pushes its player took.
 */
export function observeSword(n: Native) {
  return sample(() => {
    const manager = n.resolvedClass(typeInfo.PlayersManager)
      ? n.u32(n.staticFields(typeInfo.PlayersManager), staticField.PlayersManager.Instance) : 0;
    const all = manager ? n.u32(manager, field.PlayersManager._allPlayers) : 0;
    const mine = n.call(slot.playerMine, 0), W = field.WeaponsController, M = field.WeaponModel;
    const name = (object: number) => object && n.alive(object) ? n.text(n.call(slot.objectName, object, 0)) : null;
    const filterType = n.call(slot.typeGetType, n.newString('UnityEngine.MeshFilter, UnityEngine.CoreModule'), 1, 0);
    const rendererType = n.call(slot.typeGetType, n.newString('UnityEngine.Renderer, UnityEngine.CoreModule'), 1, 0);
    const camera = n.call(slot.cameraMain, 0);
    /** `local` (the pickaxe model's frame) on screen through `transform` and the main camera. */
    const screen = (transform: number, local?: number[]) => local && camera && n.alive(camera) ? n.scratch(24, at => {
      local.forEach((value, k) => n.setF32(at, 4 * k, value));
      n.call(slot.transformPoint, transform, at, at + 12, 0);
      n.call(slot.cameraWorldToScreen, camera, at + 12, literal.monoEye, at, 0);
      return [0, 4, 8].map(k => +n.f32(at, k).toFixed(1));
    }) : null;
    const emission = (material: number) => n.scratch(16, at => {
      n.call(slot.materialColor, material, n.call(slot.shaderPropertyId, n.newString('_Emission1'), 0), at, 0);
      return [0, 4, 8].map(k => +n.f32(at, k).toFixed(3));
    });
    return { swings: swordLog.swings.slice(-6), hits: swordLog.hits.slice(-6), knocks: swordLog.knocks.slice(-6),
      players: (all ? n.dictionary(all) : []).map(([, player]) => player)
      .filter(player => n.alive(player) && heroOf(n.textOrNull(n.call(slot.playerChampionId, player, 0))) === 'beam')
      .map(player => {
        const controller = n.u32(player, field.PlayerController._weaponsController);
        const model = n.list(n.u32(controller, W._weaponSlots), 16)
          .find(item => n.alive(item) && n.className(item) === 'MeleeWeaponModel') ?? 0;
        const skins = model ? n.u32(model, M._skinManager) : 0;
        const skin = skins ? n.u32(skins, field.WeaponSkinManager.CurrentSkin) : 0;
        const object = skin && n.alive(skin) ? n.call(slot.componentGameObject, skin, 0) : 0;
        const filter = object ? n.call(slot.gameObjectGetComponent, object, filterType, 0) : 0;
        const renderer = object ? n.call(slot.gameObjectGetComponent, object, rendererType, 0) : 0;
        const materials = renderer ? n.array(n.call(slot.rendererSharedMaterials, renderer, 0), 8) : [];
        const transform = model ? n.call(slot.componentTransform, model, 0) : 0;
        return { id: n.call(slot.playerOwnerId, player, 0), mine: player === mine,
          holding: !!model && n.u32(controller, W.CurrentWeapon) === model,
          mesh: filter ? name(n.call(slot.meshFilterSharedMesh, filter, 0)) : null,
          materials: materials.map(name), emission: materials[0] ? emission(materials[0]) : null,
          state: beamSwords.get(player) ?? null,
          jewel: transform ? screen(transform, swordJewels.guard) : null,
          pommel: transform ? screen(transform, swordJewels.pommel) : null,
          range: model ? n.f32(model, M.Stats + field.WeaponStats.Range) : null,
          equipDelay: model ? n.f32(model, M.Stats + field.WeaponStats.EquipDelay) : null,
          delayLeft: n.f32(controller, W._equipDelayTimeLeft), aiming: n.bool(controller, W._isAiming) };
      }) };
  });
}
