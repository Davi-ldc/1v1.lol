import { activeScene, factory, loadoutRoots, objectsOfType, serverUser } from '../game';
import { sample, type Native } from '../native';
import { field, methodInfo, runtime, slot, staticField, typeInfo } from '../symbols';

function productId(n: Native, product: number) {
  if (!product) return null;
  n.instance(product, n.resolvedClass(typeInfo.EquipmentProductData));
  return n.text(n.u32(product, field.ProductData.Id));
}

/** The UserEquipment the UI reads: FirebaseManager.Instance._serverUser.Equipment. */
function equipment(n: Native) {
  const user = serverUser(n), root = user ? n.u32(user, field.ServerUser.Equipment) : 0;
  if (!root) return { state: 'absent' };
  n.instance(root, n.resolvedClass(typeInfo.UserEquipment));
  const U = field.UserEquipment, L = field.Loadout;
  const loadouts = n.u32(root, U.Loadouts), equipped = n.i32(root, U.EquippedLoadout);
  const entries = loadouts ? n.list(loadouts) : [];
  const current = equipped >= 0 && equipped < entries.length ? n.check(entries[equipped]!) : 0;
  const ids = (list: number) => list ? n.list(list).map(id => id ? n.text(id) : null) : null;
  const champions = n.u32(user, field.ServerUser.Champions);
  return { state: 'observed', equippedLoadout: equipped, loadoutCount: entries.length,
    champion: champions ? n.textOrNull(n.u32(champions, field.UserChampions._selectedChampion)) : null,
    maxHealth: n.i32(root, U.MaxHealth), maxArmor: n.i32(root, U.MaxArmor),
    armorSlots: n.u32(root, U.AvailableArmorSlots), weaponSlots: n.u32(root, U.AvailableWeaponSlots),
    armor: current ? ids(n.u32(current, L.EquippedArmor)) : null,
    weapons: current ? ids(n.u32(current, L.EquippedWeapons)) : null };
}

/** LoadoutScreen state as the original UI holds it (getters and memory reads). */
export function observeMenu(n: Native) {
  try {
    const scene = activeScene(n, true);
    const roots = scene.buildIndex === 1 ? loadoutRoots(n) : null;
    if (!roots) return { status: 'waiting', scene };
    const { ui, handler, screen } = roots, S = field.LoadoutScreen, I = field.LoadoutItemScroller;
    const inventory = n.u32(screen, S._inventoryDisplay);
    const scroller = inventory ? n.u32(inventory, field.LoadoutInventoryDisplay._scrollItemList) : 0;
    const used = (list: number) => list ? n.i32(list, field.LoadoutItemList._nextItemIndex) : null;
    const current = n.u32(handler, field.ScreenSwitchHandler._currScreen), queue = n.u32(screen, S._serverRequestTasks);
    return { status: 'observed', scene, version: n.text(n.call(slot.applicationVersion, 0)),
      active: n.call(slot.behaviourActiveAndEnabled, screen, 0) !== 0,
      loaderActive: n.u32(ui, field.UiManager._loaderUI) ? n.call(slot.uiLoaderActive, ui, 0) !== 0 : null,
      screen: current ? n.i32(current, field.MenuScreen.ScreenNameState) : null,
      category: n.i32(screen, S.CurrentScreenCategory), slotPickedFrom: n.i32(screen, S.SlotPickedFrom),
      selectedId: productId(n, n.u32(screen, S.SelectedEquipment)),
      lastViewedId: productId(n, n.u32(screen, S._lastViewedItem)),
      requestInProgress: n.u8(screen, S._serverRequestInProgress) !== 0,
      queuedRequests: queue ? n.u32(queue, runtime.queueSize) : null,
      inventoryCategory: inventory ? n.i32(inventory, field.LoadoutInventoryDisplay.CurrentCategory) : null,
      owned: scroller ? used(n.u32(scroller, I._ownedItemsList)) : null,
      notFound: scroller ? used(n.u32(scroller, I._notFoundItemsList)) : null,
      locked: scroller ? used(n.u32(scroller, I._lockedItemsList)) : null,
      equipment: sample(() => equipment(n)) };
  } catch (error) { return { status: 'error', reason: String(error) }; }
}

/** Cosmetic ownership and selection, directly from the installed profile (also during matches). */
export function observeCosmetics(n: Native) {
  return sample(() => {
    const skins = n.u32(serverUser(n), field.ServerUser.Skins), E = field.ServerSkinsEntry;
    const ids = (offset: number) => {
      const list = n.u32(skins, offset);
      return list ? n.list(list, 256).map(id => n.textOrNull(id)) : null;
    };
    return { weaponSkins: ids(E.WeaponSkins), emotes: ids(E.OwnedEmotes),
      equippedWeaponSkins: ids(E.EquippedWeaponSkins), equippedEmotes: ids(E.EquippedEmotes) };
  });
}

/** Every OnClickScreenSwitcher in the loaded scenes (inactive included): object name, active, target ScreenName. */
export function observeSwitchers(n: Native) {
  try {
    return { status: 'observed', switchers: objectsOfType(n, 'OnClickScreenSwitcher').map(component => {
      const object = n.call(slot.componentGameObject, component, 0);
      return { name: n.text(n.call(slot.objectName, object, 0)),
        active: n.call(slot.gameObjectActiveSelf, object, 0) === 1,
        screen: n.i32(component, field.OnClickScreenSwitcher._screenToSwitchTo) };
    }) };
  } catch (error) { return { status: 'error', reason: String(error) }; }
}

/**
 * Liveness of the graphic assets the Loadout UI is bound to: the popup preview mesh/materials and the first
 * owned cards' sprites/textures. Unity null semantics (op_Implicit), not pointer truthiness. Uses the shared
 * getters only (never instance-creating ones).
 */
export function observePresentation(n: Native, all = 0) {
  const asset = (pointer: number) => ({ pointer, alive: n.alive(pointer) });
  try {
    const roots = loadoutRoots(n);
    if (!roots) return { status: 'waiting' };
    const popup = n.u32(roots.screen, field.LoadoutScreen._itemPopup);
    const render = popup ? n.u32(popup, field.LoadoutItemPopup._equipment3DRender) : 0;
    const preview = render ? sample(() => {
      const R = field.Equipment3DRender, G = field.EquipmentGraphicData;
      const filter = n.u32(render, R._itemMeshFilter), renderer = n.u32(render, R._itemMeshRenderer);
      const active = (gameObject: number) =>
        n.alive(gameObject) ? n.call(slot.gameObjectActiveSelf, gameObject, 0) === 1 : null;
      const objectOf = (component: number) => n.alive(component) ? n.call(slot.componentGameObject, component, 0) : 0;
      // What DisplayModel (f114840) left behind: its loader, the branch it took, and the graphics BaseData retains.
      const product = n.u32(popup, field.LoadoutItemPopup._itemDisplayed);
      const baseData = product ? n.u32(product, field.EquipmentProductData.BaseData) : 0;
      const skins = n.u32(popup, field.LoadoutItemPopup._skinsListDisplay);
      const retained = baseData ? n.u32(baseData, field.EquipmentBaseData._loadedAssets) : 0;
      const responses = retained ? n.list(retained, 1024) : null;
      const graphics = responses ? [...new Set(responses.map(response => n.u32(response, runtime.assetResponseAsset)))]
        .map(graphic => {
          if (!graphic) return { graphic: 0 };
          const materials = n.u32(graphic, G.Materials);
          return { alive: n.alive(graphic), id: n.textOrNull(n.u32(graphic, G.ID)), mesh: asset(n.u32(graphic, G.Mesh)),
            prefab: asset(n.u32(graphic, G.Prefab)), materials: materials ? n.list(materials).map(asset) : null };
        }) : null;
      const S = field.WeaponSkinItemDisplay;
      return { popupActive: n.alive(popup) && n.call(slot.behaviourActiveAndEnabled, popup, 0) !== 0,
        loaderActive: active(n.u32(render, R._loadingImage)),
        meshContainerActive: active(n.u32(render, R._itemMeshContainer)),
        spriteActive: active(objectOf(n.u32(render, R._itemSprite))),
        rawImageActive: active(objectOf(n.u32(render, R._itemRawImage))),
        id: baseData ? n.textOrNull(n.u32(baseData, field.EquipmentBaseData.Id)) : null,
        skin: n.alive(skins) ? n.textOrNull(n.u32(skins, field.WeaponSkinListDisplay._skinSelected)) : null,
        skinOptions: n.alive(skins)
          ? n.list(n.u32(skins, field.WeaponSkinListDisplay._weaponSkinItems), 128).map(widget => {
            const product = n.u32(widget, S._skinDisplayed);
            return { active: n.alive(widget) && n.call(slot.behaviourActiveAndEnabled, widget, 0) === 1,
              id: product ? n.text(n.u32(product, field.ProductData.Id)) : null,
              selected: active(n.u32(widget, S._selectedFrame)), locked: active(n.u32(widget, S._lockedState)) };
          }) : null, graphics, retainedResponses: responses?.length ?? 0,
        mesh: n.alive(filter) ? asset(n.call(slot.meshFilterSharedMesh, filter, 0)) : null,
        materials: n.alive(renderer) ? n.array(n.call(slot.rendererSharedMaterials, renderer, 0)).map(asset) : null };
    }) : null;
    const cards = sample(() => {
      // Rows/index/modulo as in f43522@0xeffb45 and f45524@0xfaf719. Never call GetNextItem: it mutates +20.
      const inventory = n.u32(roots.screen, field.LoadoutScreen._inventoryDisplay);
      const scroller = n.u32(inventory, field.LoadoutInventoryDisplay._scrollItemList);
      const owned = n.u32(scroller, field.LoadoutItemScroller._ownedItemsList);
      const rows = n.list(n.u32(owned, field.LoadoutItemList._loadoutItemRows));
      const used = n.u32(owned, field.LoadoutItemList._nextItemIndex);
      const row = (index: number) => n.list(n.u32(rows[index]!, field.LoadoutItemRow._loadoutItems));
      const width = used ? row(0).length : 0;
      if (used > rows.length * width) throw new Error('Used slots exceed the native rows.');
      return { category: n.i32(inventory, field.LoadoutInventoryDisplay.CurrentCategory), used,
        entries: Array.from({ length: Math.min(used, all ? 64 : 12) }, (_, index) => ({ index, ...sample(() => {
          const item = row(Math.floor(index / width))[index % width]!;
          if (all) { // Every owned card with its screen position (bottom-left origin) instead of its graphics.
            const at = n.scratch(12, cell => {
              n.call(slot.transformPosition, n.check(n.call(slot.componentTransform, item, 0)), cell, 0);
              return [n.f32(cell, 0), n.f32(cell, 4)];
            });
            return { id: productId(n, n.u32(item, field.LoadoutItem.ItemDisplayed)), screen: at };
          }
          const image = n.u32(item, field.LoadoutItem._itemImage);
          if (!n.alive(image)) throw new Error('Card image is not a live Unity object.');
          const sprite = n.call(slot.imageActiveSprite, image, 0);
          return { id: productId(n, n.u32(item, field.LoadoutItem.ItemDisplayed)), sprite: asset(sprite),
            texture: n.alive(sprite) ? asset(n.call(slot.spriteTexture, sprite, 0)) : null };
        }) })) };
    });
    return { status: 'observed', preview, cards };
  } catch (error) { return { status: 'error', reason: String(error) }; }
}

/**
 * The party as PartyInfo holds it, the Photon room this client is in with its players' nicknames by actor, this
 * browser's cached nickname and the lobby's name tags (each active PartyPlayer's _playerName); static reads and
 * getters only.
 */
export function observeParty(n: Native) {
  return sample(() => {
    const statics = n.resolvedClass(typeInfo.PartyInfo) ? n.staticFields(typeInfo.PartyInfo) : 0;
    const P = staticField.PartyInfo, room = n.call(slot.currentRoom, 0);
    const text = (offset: number) => statics ? n.textOrNull(n.u32(statics, offset)) : null;
    const players = room ? n.dictionary(n.u32(room, field.Room.players)) : [];
    return { nickname: n.textOrNull(n.call(slot.cachedNickname, 0)),
      nicknames: Object.fromEntries(players.map(([actor, player]) =>
        [actor, n.textOrNull(n.u32(player, field['Photon.Realtime.Player'].nickName))])),
      tags: objectsOfType(n, 'PartyPlayer').filter(player => n.alive(player)
        && n.call(slot.gameObjectActiveInHierarchy, n.check(n.call(slot.componentGameObject, player, 0)), 0) !== 0)
        .map(player => n.textOrNull(n.call(slot.tmpText, n.u32(player, field.PartyPlayer._playerName), 0))),
      roomName: text(P.PartyRoomName), partyId: text(P.PartyId), leader: text(P.PartyLeader),
      temporary: statics ? n.bool(statics, P.IsTemporaryParty) : null,
      friendly: statics ? n.bool(statics, P.IsFriendlyBattle) : null,
      photonRoom: room ? n.textOrNull(n.call(slot.roomName, room, 0)) : null,
      masterClient: n.call(slot.isMasterClient, 0) !== 0, network: n.call(slot.networkAvailable, 0) !== 0,
      ready: n.call(slot.connectedAndReady, 0) !== 0, clientState: n.call(slot.networkClientState, 0),
      initializing: n.resolvedClass(typeInfo.AppInitializer)
        ? n.bool(n.staticFields(typeInfo.AppInitializer), staticField.AppInitializer.IsInitializing)
        : null };
  });
}

/**
 * Local mode definitions (ModesProperties) with their menu entry (ModesMenuSettings), in definition order, and the
 * Large/Medium/Small button counts of every ModeMenuManager's Custom category.
 */
export function observeModes(n: Native) {
  return sample(() => {
    const properties = n.check(n.call(slot.soInstance, n.metadata(methodInfo.modesPropertiesInstance)));
    const menu = n.resolvedClass(typeInfo.ModesMenuSettings) ? n.u32(n.staticFields(typeInfo.ModesMenuSettings),
      staticField.ModesMenuSettings._modeDictionary) : 0;
    const layouts = new Map((menu ? n.dictionary(menu, 256) : []).map(([name, ui]) =>
      [n.text(name), n.i32(ui, field.ModeUI.LayoutType)]));
    const M = field.ModeInfo, C = field.ModeButtonCategory;
    const customButtons = objectsOfType(n, 'ModeMenuManager').map(manager => {
      const custom = manager + field.ModeMenuManager._customModeButtons;
      return [C.LargeButtons, C.MediumButtons, C.SmallButtons].map(offset => n.list(n.u32(custom, offset)).length);
    });
    const modes = n.list(n.u32(properties, field.ModesProperties._modesInfo), 256).map(mode => {
      const name = n.text(n.u32(mode, M.ModeName)), pool = n.u32(mode, M._scenePool);
      return { name, custom: n.bool(mode, M.IsCustomGame), offline: n.bool(mode, M.IsOffline),
        players: [n.u8(mode, M.MinPlayers), n.u8(mode, M.MaxPlayers)], layout: layouts.get(name) ?? null,
        scenes: pool ? n.dictionary(pool).map(([scene]) => n.text(scene)) : [] };
    });
    return { customButtons, modes };
  });
}

/**
 * The profile's items in UserEquipment.Equipment order (the tie-break of EquipmentUtils.GetHighestLevelEquipment,
 * a stable OrderByDescending on Level) with their catalogue type, rarity, base power score and level.
 */
export function observeItems(n: Native) {
  return sample(() => {
    const user = serverUser(n), root = user ? n.u32(user, field.ServerUser.Equipment) : 0;
    if (!root) return { items: [] };
    const catalogue = n.list(n.call(slot.factoryAllProducts, factory(n, methodInfo.productFactoryInstance), 0), 4096);
    const products = new Map(catalogue.map(product => [n.text(n.u32(product, field.ProductData.Id)), product]));
    const B = field.EquipmentBaseData;
    return { items: n.dictionary(n.u32(root, field.UserEquipment.Equipment), 4096).map(([key, item]) => {
      const id = n.text(key), product = products.get(id);
      const base = product ? n.u32(product, field.EquipmentProductData.BaseData) : 0;
      return { id, level: n.i32(item, field.UserUpgradeableItem.Level),
        type: product ? n.i32(product, field.EquipmentProductData.Type) : null,
        rarity: product ? n.i32(product, field.ProductData.Rarity) : null,
        baseRarity: base ? n.i32(base, B.BaseRarity) : null, power: base ? n.i32(base, B.BasePowerScore) : null };
    }) };
  });
}

/**
 * Every AgeLimitedFeaturePopup (the AgeGate's "get full access / Unlock for free!" window,
 * AgeLimitedFeaturePopup.prefab in the popups bundle, opened by MenuPopupHandler.ShowAgeLimit from
 * LimitedFeaturesManager.ValidateFeature): whether it shows and the feature it was opened for.
 */
export function observePopups(n: Native) {
  return sample(() => ({ ageLimited: objectsOfType(n, 'JustPlay.AgeGate.AgeLimitedFeaturePopup')
    .filter(popup => n.alive(popup)).map(popup => ({
      shown: n.call(slot.behaviourActiveAndEnabled, popup, 0) !== 0,
      feature: n.textOrNull(n.u32(popup, field['JustPlay.AgeGate.AgeLimitedFeaturePopup']._featureToAccess)),
    })) }));
}
