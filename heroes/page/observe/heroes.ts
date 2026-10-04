import { objectsOfType } from '../../../src/page/game';
import { sample, type Native } from '../../../src/page/native';
import { beamAuras } from '../beam/aura';
import { beamLocks } from '../beam/lock-on';
import { beamMaterialStats } from '../beam/material';
import { heroOf, HEROES, roster } from '../ids';
import { readFloats } from '../shared/unity';
import { field, runtime, slot, staticField, typeInfo } from '../symbols';

/** World position of a component (for UI on a screen-space canvas: its screen position, bottom-left origin). */
const screen3 = (n: Native, component: number) =>
  readFloats(n, at => n.call(slot.transformPosition, n.check(n.call(slot.componentTransform, component, 0)), at, 0));
const screen = (n: Native, component: number) => screen3(n, component).slice(0, 2);
/** A Transform's local position. */
const local = (n: Native, transform: number) =>
  readFloats(n, at => n.call(slot.transformLocalPosition, transform, at, 0));
/** The bones a scan's `skeleton` moves (the elastic hero's), read back with Hips' parent Root. */
const SHAPED = ['Hips', 'Elbow_L', 'Hand_L', 'LowerLeg_L', 'Ankle_L', 'Ball_L', 'Elbow_R', 'Hand_R', 'LowerLeg_R',
  'Ankle_R', 'Ball_R'];
/** A skin pack's colliders (SkinPack.PlayerColliders): name, its parent's, and height and radius for capsules. */
function collidersOf(n: Native, manager: number) {
  const pack = n.u32(manager, field.PlayerSkinManager._curSkinPack);
  const name = (item: number) => item ? n.text(n.call(slot.objectName, item, 0)) : null;
  return (pack ? n.list(n.u32(pack, field.SkinPack.PlayerColliders), 64) : []).filter(item => n.alive(item))
    .map(item => {
      const own = n.call(slot.componentTransform, item, 0), capsule = n.className(item) === 'CapsuleCollider';
      return [name(own), name(n.call(slot.transformParent, own, 0)),
        capsule ? n.call(slot.capsuleHeight, item, 0) : null, capsule ? n.call(slot.capsuleRadius, item, 0) : null];
    });
}
/** A CapsuleCollider's height and center height. */
const capsule = (n: Native, collider: number) => collider && n.alive(collider) ? [
  n.call(slot.capsuleHeight, collider, 0),
  n.scratch(12, at => { n.call(slot.capsuleCenter, collider, at, 0); return n.f32(at, 4); })] : null;
/**
 * What the elastic legs change on a player (elastic/stretch.ts): its motor capsule (with the height the motor's
 * Init kept, vThirdPersonMotor.colliderHeight) and legs trigger, its center offset, speed multiplier and, own, camera
 * height; also, own, whether its weapon aims on the same button (WeaponsController._isAiming) and the press that
 * toggles the zoom (_shortPressTime).
 */
function stretchOf(n: Native, player: number, own: boolean) {
  const motor = n.u32(player, field.PlayerController._thirdPersonController);
  const input = own ? n.u32(player, field.PlayerController.ThirdPersonInput) : 0;
  const camera = input ? n.u32(input, field.vThirdPersonInput._tpCamera) : 0;
  const weapons = own ? n.u32(player, field.PlayerController._weaponsController) : 0;
  return { capsule: motor ? capsule(n, n.u32(motor, field.vThirdPersonMotor._capsuleCollider)) : null,
    initial: motor ? n.f32(motor, field.vThirdPersonMotor.colliderHeight) : null,
    legs: motor ? capsule(n, n.u32(motor, field.vThirdPersonController._legsCollider)) : null,
    offset: n.f32(player, field.PlayerController._centerHeightOffset),
    speed: motor ? n.f32(motor, field.vThirdPersonMotor.generalSpeedMultiplier) : null,
    channel: motor ? n.f32(motor, field.vThirdPersonMotor.channelSpeedMultiplier) : null,
    camera: camera ? n.f32(camera, field.vThirdPersonCamera.targetHeight) : null,
    aiming: weapons ? n.bool(weapons, field.WeaponsController._isAiming) : null,
    shortPress: weapons ? n.f32(weapons, field.WeaponsController._shortPressTime) : null };
}

/** Every ChampionSelectionScreen's cards in list order: product ID, activity, screen position and art's name. */
export function observeChampionCards(n: Native) {
  return sample(() => ({ screens: objectsOfType(n, 'JustPlay.Champions.UI.ChampionSelectionScreen').map(view => ({
    active: n.call(slot.behaviourActiveAndEnabled, view, 0) !== 0,
    cards: n.list(n.u32(view, field.ChampionSelectionScreen._championCards), 64).map(card => {
      const product = n.u32(card, field.ChampionCard._champion);
      const display = n.u32(card, field.ChampionCard._championInfoDisplay);
      const icon = display ? n.call(slot.imageSprite, n.u32(display, field.ChampionInfoDisplay._championIcon), 0) : 0;
      return { id: product ? n.text(n.u32(product, field.ProductData.Id)) : null, screen: screen(n, card),
        active: n.call(slot.gameObjectActiveSelf, n.call(slot.componentGameObject, card, 0), 0) === 1,
        icon: n.alive(icon) ? n.text(n.call(slot.objectName, icon, 0)) : null };
    }) })) }));
}

/**
 * Every PlayerSkinManager in the loaded scenes (lobby, previews, players): its active state, applied skin and the hero
 * slot that skin belongs to, body part with its first SkinnedMeshRenderer's mesh name, how many of its other (rigid)
 * renderers are active, its Animator's controller and, for players, the champion ID and its hero slot, the local flag,
 * the OwnerID, the announced lock's target OwnerID (beam/lock-on.ts), the active ability classes, the first slot's
 * IsActivated and cooldown, whether its motor is grounded, its center's height, its Head bone's height over its Hips
 * (negative upside down), and whether its AquaCannonBehaviour is firing; how many non-static builds
 * BuildingNetworkController registers; and every active Sentinel barrier
 * (PhotonNetwork.Destroy pools them) with its owner (local?), its distance and height from that owner's center, its
 * collider layers, whether its VFX shows, the shots it took and its timestamp.
 */
export function observeHeroes(n: Native) {
  return sample(() => {
    const S = field.PlayerSkinManager, P = field.PlayerSkinPart, mine = n.call(slot.playerMine, 0);
    const controller = n.resolvedClass(typeInfo.BuildingNetworkController)
      ? n.u32(n.staticFields(typeInfo.BuildingNetworkController), staticField.BuildingNetworkController.Instance) : 0;
    const builds = controller ? n.dictionary(n.u32(controller, field.BuildingNetworkController._buildingsIdMapping),
      4096).map(([, building]) => building).filter(building => n.alive(building) &&
      !n.bool(building, field.Building.IsStatic)) : null;
    const at = (component: number) => screen3(n, component);
    // The non-static builds: how many, where (their transforms, rounded), their Health and class.
    const buildings = builds?.length ?? null, places = builds?.map(build => at(build).map(v => +v.toFixed(2))) ?? null;
    const healths = builds?.map(build => n.i32(build, field.Building.Health)) ?? null;
    const kinds = builds?.map(build => n.className(build)) ?? null;
    /**
     * An AquaCannonBehaviour's player hit radius (its level-data copy), its VFX instance's width scale, whether its
     * last cast stopped at an obstacle and that hit's distance.
     */
    const beam = (cannon: number) => {
      const C = field.AquaCannonBehaviour, vfx = n.u32(cannon, C._aquaCannonVfxInstance);
      return { radius: n.f32(cannon, C._abilityLevelData + field.AquaCannonLevelData.PlayerHitRadius),
        stopped: n.bool(cannon, C._wasCannonStoppedByObstacle),
        hit: n.f32(cannon, C._lastHit + field.RaycastHit.m_Distance),
        width: vfx && n.alive(vfx) ? n.scratch(12, scale => {
          n.call(slot.transformLocalScale, n.check(n.call(slot.gameObjectTransform, vfx, 0)), scale, 0);
          return n.f32(scale, 0);
        }) : null };
    };
    const center = (player: number) => n.scratch(12, point => {
      n.call(slot.playerCenterPosition, point, player, 0);
      return [0, 4, 8].map(k => n.f32(point, k));
    });
    const barriers = objectsOfType(n, 'JustPlay.Gameplay.Abilities.BarrierShockwaveBehaviour').filter(barrier =>
      n.alive(barrier) && n.call(slot.behaviourActiveAndEnabled, barrier, 0) !== 0).map(barrier => {
      const owner = n.u32(barrier, field.BarrierShockwaveBehaviour._owner), where = at(barrier);
      const from = owner && n.alive(owner) ? center(owner) : null;
      const data = n.u32(n.check(n.call(slot.photonView, barrier, 0)), field.PhotonView.instantiationDataField);
      const timestamp = data ? n.array(data, 8)[1] : 0;
      const B = field.BarrierShockwaveBehaviour;
      const layer = (collider: number) =>
        n.call(slot.gameObjectLayer, n.call(slot.componentGameObject, collider, 0), 0);
      const layers = [barrier, ...n.list(n.u32(barrier, B._barrierColliders), 8)].filter(item => n.alive(item))
        .map(layer);
      return { mine: owner === mine, distance: from ? Math.hypot(...where.map((value, k) => value - from[k]!)) : null,
        height: from ? where[1]! - from[1]! : null, layers,
        shown: n.call(slot.gameObjectActiveSelf, n.u32(barrier, B._barrierVFX), 0) === 1,
        scale: n.scratch(12, at => { // The shield VFX's scale (eased in and out for a hero's).
          n.call(slot.transformLocalScale, n.check(n.call(slot.gameObjectTransform, n.u32(barrier, B._barrierVFX), 0)),
            at, 0);
          return n.f32(at, 0);
        }),
        hits: n.i32(barrier, B._hitCount),
        timestamp: timestamp ? n.f64(timestamp, runtime.boxedValue) : null };
    });
    const shaded = beamMaterialStats; // The special material's per-vertex pass on this client (beam/material.ts).
    const material = { ...shaded, average: shaded.frames > 1 ? (shaded.total - shaded.first) / (shaded.frames - 1)
      : null };
    return { buildings, places, healths, kinds, barriers,
      managers: objectsOfType(n, 'PlayerSkinManager').map(manager => {
      const body = n.u32(manager, S._currBody);
      const renderers = body ? n.list(n.u32(body, P.Renderers), 16).filter(item => n.alive(item)) : [];
      const skinned = (item: number) => n.className(item) === 'SkinnedMeshRenderer';
      const renderer = renderers.find(skinned), mesh = renderer ? n.call(slot.skinnedSharedMesh, renderer, 0) : 0;
      const bones = renderer ? n.array(n.call(slot.skinnedBones, renderer, 0), 128).filter(bone => n.alive(bone)) : [];
      const bone = (name: string) => bones.find(item => n.text(n.call(slot.objectName, item, 0)) === name);
      const head = bone('Head'), hips = bone('Hips');
      const player = n.u32(manager, S._playerController);
      const abilities = player ? n.u32(player, field.PlayerController._playerAbilities) : 0;
      const slots = abilities ? n.list(n.u32(abilities, field.PlayerAbilities._activeAbilities)) : [];
      const cannon = player ? n.call(slot.componentGetComponent, player, n.call(slot.typeGetType,
        n.newString('JustPlay.Gameplay.Abilities.AquaCannonBehaviour, 1v1'), 1, 0), 0) : 0;
      const A = field.PlayerAbilitySlot, skin = n.textOrNull(n.u32(manager, S.CurrSkinID));
      const champion = player ? n.textOrNull(n.call(slot.playerChampionId, player, 0)) : null;
      return { active: n.call(slot.behaviourActiveAndEnabled, manager, 0) !== 0,
        skin, hero: HEROES.find(hero => roster[hero]?.skin === skin) ?? null,
        body: body ? n.textOrNull(n.u32(body, P.PartName)) : null,
        mesh: n.alive(mesh) ? n.text(n.call(slot.objectName, mesh, 0)) : null,
        material: renderer ? n.array(n.call(slot.rendererSharedMaterials, renderer, 0), 8).filter(item => n.alive(item))
          .map(item => n.text(n.call(slot.objectName, item, 0)))[0] ?? null : null,
        materials: renderer ? n.array(n.call(slot.rendererSharedMaterials, renderer, 0), 8)
          .filter(item => n.alive(item)).map(item => n.text(n.call(slot.objectName, item, 0))) : [],
        controller: (animator => {
          const controller = animator && n.alive(animator) ? n.call(slot.animatorController, animator, 0) : 0;
          return controller && n.alive(controller) ? n.text(n.call(slot.objectName, controller, 0)) : null;
        })(n.u32(manager, S._animator)),
        rigid: renderers.filter(item => !skinned(item) &&
          n.call(slot.gameObjectActiveSelf, n.call(slot.componentGameObject, item, 0), 0) === 1).length,
        // The shaped bones' local positions, and the balls of the feet over the manager's transform (the ground).
        skeleton: hips ? Object.fromEntries([...SHAPED.map(name => [name, (item => item ? local(n, item) : null)(
          bone(name))]), ['Root', local(n, n.call(slot.transformParent, hips, 0))]]) : null,
        feet: ['Ball_L', 'Ball_R'].map(name => (ball => ball ? at(ball)[1]! - at(manager)[1]! : null)(bone(name))),
        colliders: collidersOf(n, manager),
        player: player ? { mine: player === mine, champion, hero: heroOf(champion) ?? null,
          abilities: slots.map(entry => {
            const ability = n.u32(entry, A.Ability);
            return ability ? n.className(ability) : null;
          }),
          activated: slots[0] ? n.bool(slots[0], A.IsActivated) : null,
          cooldown: slots[0] ? n.f32(slots[0], A.CurrentCooldown) : null,
          grounded: (motor => motor ? n.bool(motor, field.vThirdPersonMotor._isGrounded) : null)(
            n.u32(player, field.PlayerController._thirdPersonController)),
          y: center(player)[1], head: head && hips ? at(head)[1]! - at(hips)[1]! : null,
          // The takeoff height HandleFalling keeps for HandleFallDamage (null on the ground).
          takeoff: n.u8(player, field.PlayerController._lastGroundedYPosition)
            ? n.f32(player, field.PlayerController._lastGroundedYPosition + runtime.nullableValue) : null,
          firing: n.alive(cannon) ? n.bool(cannon, field.AquaCannonBehaviour._isFiring) : null,
          lock: (target => target ? n.call(slot.playerOwnerId, target, 0) : null)(beamLocks.get(player) ?? 0),
          stretch: stretchOf(n, player, player === mine),
          aura: beamAuras.get(player) ?? null,
          id: n.call(slot.playerOwnerId, player, 0),
          masks: [field.WeaponsController._buildingsLayerMask, field.WeaponsController._otherHitsLayerMask]
            .map(offset => n.u32(n.u32(player, field.PlayerController._weaponsController), offset)),
          beam: n.alive(cannon) ? beam(cannon) : null } : null };
    }), material };
  });
}
