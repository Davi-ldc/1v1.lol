import { activeScene, modeName } from '../game';
import { sample, type Native } from '../native';
import { field, slot, staticField, typeInfo } from '../symbols';

/** CodeStage ObscuredInt stored inline at `object + offset`: value = key ^ hidden when initialized. */
function obscuredInt(n: Native, object: number, offset: number) {
  const O = field.ObscuredInt;
  return n.u8(object, offset + O.inited) === 1
    ? n.i32(object, offset + O.currentCryptoKey) ^ n.i32(object, offset + O.hiddenValue) : null;
}

function player(n: Native, mine = n.call(slot.playerMine, 0)) {
  if (!mine) return { state: 'absent' };
  n.check(mine);
  if (!n.alive(mine)) return { state: 'destroyed', pointer: mine };
  const active = n.call(slot.behaviourActiveAndEnabled, mine, 0) !== 0;
  n.instance(mine, n.u32(typeInfo.PlayerController));
  const transform = n.check(n.call(slot.componentTransform, mine, 0));
  const position = n.scratch(12, at => {
    n.call(slot.transformPosition, transform, at, 0);
    return [0, 4, 8].map(offset => n.f32(at, offset));
  });
  if (!position.every(Number.isFinite)) throw new Error('Invalid player position.');
  const P = field.PlayerController, health = n.u32(mine, P._health);
  return { state: 'observed', pointer: mine, active, position,
    initialized: n.bool(mine, P._initialized), dead: n.bool(mine, P._isDead), frozen: n.bool(mine, P._isFrozen),
    currentState: n.i32(mine, P.currentState),
    health: health ? obscuredInt(n, health, field.PlayerHealth._currentHealth) : null,
    armor: health ? obscuredInt(n, health, field.PlayerHealth._currentArmor) : null };
}

/** Main camera position and forward direction (where the crosshair points). */
function camera(n: Native) {
  const main = n.call(slot.cameraMain, 0);
  if (!main || !n.alive(main)) return { state: 'absent' };
  const transform = n.check(n.call(slot.componentTransform, main, 0));
  const vector = (read: (at: number) => void) => n.scratch(12, at => {
    read(at);
    return [0, 4, 8].map(offset => n.f32(at, offset));
  });
  return { position: vector(at => n.call(slot.transformPosition, transform, at, 0)),
    forward: vector(at => n.call(slot.transformForward, at, transform, 0)) };
}

/** Every player PlayersManager registered, local and remote, as this client sees them, by dictionary key. */
function players(n: Native) {
  if (!n.resolvedClass(typeInfo.PlayersManager)) return {};
  const manager = n.u32(n.staticFields(typeInfo.PlayersManager), staticField.PlayersManager.Instance);
  const all = manager && n.u32(manager, field.PlayersManager._allPlayers), mine = n.call(slot.playerMine, 0);
  const entries = all ? n.dictionary(all) : [];
  return Object.fromEntries(entries.map(([key, at]) => [key, { mine: at === mine, ...player(n, at) }]));
}

/** The match's InGamePlayerInfo nicknames (kill feed and results) by PlayersManager._playerInfos key. */
function names(n: Native) {
  if (!n.resolvedClass(typeInfo.PlayersManager)) return {};
  const manager = n.u32(n.staticFields(typeInfo.PlayersManager), staticField.PlayersManager.Instance);
  const infos = manager && n.u32(manager, field.PlayersManager._playerInfos);
  return Object.fromEntries((infos ? n.dictionary(infos) : [])
    .map(([key, info]) => [key, n.textOrNull(n.u32(info, field.InGamePlayerInfo.Nickname))]));
}

/** The result screen's MatchResultInfo (winners by actor or team) while ResultScreenManager shows one. */
function result(n: Native) {
  if (!n.resolvedClass(typeInfo.ResultScreenManager)) return null;
  const manager = n.u32(n.staticFields(typeInfo.ResultScreenManager), staticField.ResultScreenManager.Instance);
  const R = field.ResultScreenManager, info = manager + R._matchResultInfo, I = field.MatchResultInfo;
  if (!manager || !n.u32(manager, R._activeResultScreen)) return null;
  const winners = n.u32(info, I.Winners);
  return { winners: winners ? n.list(winners) : null, tie: n.bool(info, I.IsTie),
    players: n.i32(info, I.PlayersCount) };
}

function game(n: Native) {
  const hasStarted = n.call(slot.gameHasStarted, 0) !== 0, statics = n.staticFields(typeInfo.GameManager);
  const input = n.resolvedClass(typeInfo.InputManager)
    && n.u32(n.staticFields(typeInfo.InputManager), staticField.InputManager.PlayerInput);
  return { hasStarted, state: n.i32(statics, staticField.GameManager.CurrentState), result: result(n),
    paused: n.u8(statics, staticField.GameManager.IsPaused) !== 0,
    axes14And15: input ? [n.call(slot.inputAxis, 14, 0), n.call(slot.inputAxis, 15, 0)] : null };
}

/** Scene, network mode, local player and game state (getters only), in Practice or any other match. */
export function observeMatch(n: Native) {
  try {
    const scene = activeScene(n, true), mode = n.call(slot.modeInfo, 0);
    return { status: 'observed', scene, room: n.call(slot.currentRoom, 0), connected: n.call(slot.isConnected, 0) !== 0,
      mode: modeName(n), usesLoadout: mode ? n.bool(mode, field.ModeInfo._usesLoadout) : null,
      offline: n.call(slot.offlineMode, 0) !== 0,
      inRoom: n.call(slot.inRoom, 0) !== 0, masterClient: n.call(slot.isMasterClient, 0) !== 0,
      player: sample(() => player(n)), players: sample(() => players(n)), names: sample(() => names(n)),
      camera: sample(() => camera(n)), game: sample(() => game(n)) };
  } catch (error) { return { status: 'error', reason: String(error) }; }
}

function weaponModel(n: Native, at: number) {
  if (!at) return null;
  if (!n.u32(at, field.UnityObject.m_CachedPtr)) return { pointer: at, destroyed: true };
  const W = field.WeaponModel, baseData = n.u32(at, W.BaseData), manager = n.u32(at, W._skinManager);
  const skin = manager ? sample(() => {
    const S = field.WeaponSkinManager, current = n.u32(manager, S.CurrentSkin), alive = n.alive(current);
    return { requestedId: n.textOrNull(n.u32(manager, S.EquippedWeaponSkin)),
      appliedId: current ? n.textOrNull(n.u32(current, field.WeaponSkinPack._weaponSkinID)) : null, alive,
      active: alive && n.call(slot.gameObjectActiveSelf, n.call(slot.componentGameObject, current, 0), 0) === 1 };
  }) : null;
  const zoom = at + W.Stats + field.WeaponStats.ZoomSettings, Z = field.CameraZoomSettings;
  return { pointer: at, id: baseData ? n.textOrNull(n.u32(baseData, field.EquipmentBaseData.Id)) : null, skin,
    zoom: { scope: n.bool(zoom, Z.HasScope), type: n.i32(zoom, Z.ScopeType), fieldOfView: n.f32(zoom, Z.FieldOfView) },
    defaultId: n.textOrNull(n.u32(at, W._defaultID)), level: obscuredInt(n, at, W._weaponLevel),
    magazine: obscuredInt(n, at, W._currentMagazine), ammo: obscuredInt(n, at, W._currentAmmo) };
}

/** Local WeaponsController and, optionally, the health of a building (memory reads only). */
export function observeWeapons(n: Native, building = 0) {
  try {
    if (!n.resolvedClass(typeInfo.PlayerController)) return { status: 'unavailable',
      reason: 'PlayerController unresolved.' };
    const mine = n.u32(n.staticFields(typeInfo.PlayerController), staticField.PlayerController.Mine);
    if (!mine) return { status: 'unavailable', reason: 'No local player.' };
    const controller = n.u32(mine, field.PlayerController._weaponsController);
    if (!controller) return { status: 'unavailable', reason: 'No local WeaponsController.' };
    const B = field.Building;
    const target = building && n.u32(building, field.UnityObject.m_CachedPtr)
      ? { pointer: building, maxHealth: n.i32(building, B.MaxHealth), health: n.i32(building, B.Health) } : null;
    const W = field.WeaponsController, slots = n.u32(controller, W._weaponSlots);
    return { status: 'observed', controller, didInitialize: n.bool(controller, W._didInitialize),
      holding: n.bool(controller, W.IsHoldingWeapon), currentIndex: n.i32(controller, W._currentEquippedWeaponIndex),
      previousIndex: n.i32(controller, W._prevEquippedWeaponIndex),
      equipped: weaponModel(n, n.u32(controller, W.CurrentWeapon)),
      slots: slots ? n.list(slots).map(model => weaponModel(n, model)) : null, target };
  } catch (error) { return { status: 'unavailable', reason: String(error) }; }
}

/** Native wheel entries and the local EmoteManager's RPC-driven playback state. */
export function observeEmotes(n: Native) {
  return sample(() => {
    const mine = n.call(slot.playerMine, 0), manager = mine ? n.u32(mine, field.PlayerController._emoteManager) : 0;
    const wheel = n.resolvedClass(typeInfo.ChoiceWheelManager)
      ? n.u32(n.staticFields(typeInfo.ChoiceWheelManager), staticField.ChoiceWheelManager.Instance) : 0;
    const W = field.ChoiceWheelManager, E = field.EmoteManager;
    return {
      wheel: wheel ? { showing: n.bool(wheel, W.IsShowing), initialized: n.bool(wheel, W._didInit),
        selected: n.textOrNull(n.u32(wheel, W._lastId)),
        ids: n.list(n.u32(wheel, W._wheelOptions)).map(option =>
          n.textOrNull(n.u32(option, field.WheelOption._id))) } : null,
      emote: manager ? { playing: n.bool(manager, E._isPlaying),
        id: n.textOrNull(n.u32(manager, E._currAnimationId)) } : null,
    };
  });
}

/** PlayerBuildingManager editing state and the shape of the targeted (or retained) building. */
export function observeEdit(n: Native, retainedBuilding = 0) {
  const statics = (cell: number) => n.resolvedClass(cell) ? n.staticFields(cell) : 0;
  try {
    const settings = statics(typeInfo.SettingsPanel), buildingStatics = statics(typeInfo.PlayerBuildingManager);
    const manager = buildingStatics ? n.u32(buildingStatics, staticField.PlayerBuildingManager.Instance) : 0;
    if (!manager) return { status: 'unavailable', reason: 'No PlayerBuildingManager.' };
    const editing = n.u32(manager, field.PlayerBuildingManager.editingManager);
    const target = n.u32(editing, field.EditingManager._currentEditingObject), building = target || retainedBuilding;
    let shape: { building: number; childIndex: number | null; toggled: number } | null = null;
    if (building && n.u32(building, field.UnityObject.m_CachedPtr)) {
      const original = n.u32(building, field.Building.OriginalShapeState),
        parts = n.u32(building, field.Building.Toggleables);
      const toggled = (parts ? n.array(parts, 64) : []).filter(part =>
        n.u8(part, field.ToggleableBuildingPart.isToggled)).length;
      shape = { building, childIndex: original ? n.i32(original, field.BuildingShapeState.ChildIndex) : null, toggled };
    }
    const S = staticField.SettingsPanel;
    return { status: 'observed', state: n.i32(manager, field.PlayerBuildingManager.state), target, shape,
      preferences: settings ? { editOnRelease: n.u8(settings, S.EditOnRelease),
        resetEditWithoutConfirm: n.u8(settings, S.ResetEditWithoutConfirm),
        scrollWheelReset: n.u8(settings, S.ScrollWheelReset) } : null };
  } catch (error) { return { status: 'unavailable', reason: String(error) }; }
}
