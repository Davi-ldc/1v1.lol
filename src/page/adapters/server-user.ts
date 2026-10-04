import { factory, firebaseManager, localProducts } from '../game';
import { waitFor, type Native } from '../native';
import { field, literal, methodInfo, runtime, slot, typeInfo, vslot } from '../symbols';

/**
 * The offline profile: one ServerUser built by its original constructor (UserEquipment and the other models
 * included), with everything recovered unlocked at its original maximum: every catalogue product through AddItem and
 * UpgradeItem to its LevelCap, every local hero at MAX_LEVEL, every local skin owned.
 * Installed by the original FirebaseManager.SetServerUser. There is no auth user, so UserExists/IsLoggedIn stay false.
 * Requires the menu WASM (AddItem/AddChampion analytics calls removed, see src/host/wasm.ts).
 *
 * Adaptation: an AUTO EQUIP preset. The original LoadoutPlayerDisplay.OnAutoEquipClicked (f43626) takes
 * EquipmentUtils.GetHighestLevelEquipment (f43367), a stable OrderByDescending on Level over UserEquipment.Equipment,
 * and fills the slots in that order. Every item is at its cap (50), so the dictionary order decides; UserEquipment's
 * constructor (f97416) starts it with scar and pump_shotgun. The profile gets a fresh dictionary from the same class
 * and shared constructor, and the preset goes in first, so the original AUTO EQUIP picks it; the rest follows in
 * catalogue order. The initial loadout (scar, pump_shotgun) is the constructor's and stays.
 */
const AUTO_EQUIP = ['lol.1v1.weapons.plasma_rifle', 'lol.1v1.weapons.hellfire_shotgun', 'lol.1v1.weapons.rpg',
  'lol.1v1.armors.body.energy'];

export async function installServerUser(n: Native, identity?: (device: string) => Promise<string>) {
  let manager = 0;
  if (!await waitFor(() => (manager = firebaseManager(n)) && n.alive(manager), 200)) {
    throw new Error('FirebaseManager.Instance did not appear.');
  }
  // lan profile: the host maps the original install ID to the player's four-digit ID, shown as the profile ID.
  const hostId = identity ? await identity(n.text(n.call(slot.guestUid, manager, 0))) : undefined;
  const receipt = { grantedCount: 0, retainedCount: 0, maxedCount: 0, championCount: 0, skinCount: 0,
    weaponSkinCount: 0, emoteCount: 0, profileId: '', nickname: '' };
  const handles: number[] = [];
  let stage = 'catalogue';
  try {
    // Synchronous from here on: construction, grants and installation happen in one native turn.
    n.instance(manager, n.resolvedClass(typeInfo.FirebaseManager));
    const userClass = n.metadata(typeInfo.ServerUser), equipmentClass = n.metadata(typeInfo.UserEquipment);
    if (n.klassName(userClass) !== 'ServerUser' || n.klassName(equipmentClass) !== 'UserEquipment') {
      throw new Error('ServerUser metadata differs.');
    }
    const productClass = n.metadata(typeInfo.EquipmentProductData), stringClass = n.metadata(typeInfo.String);
    // get_Instance runs the original Init, including its synchronous local fallback.
    const equipmentFactory = factory(n, methodInfo.productFactoryInstance);
    if (n.className(equipmentFactory) !== 'EquipmentProductDataFactory') {
      throw new Error('Catalogue factory class differs.');
    }
    if (!n.u32(equipmentFactory, field.UnityObject.m_CachedPtr)) throw new Error('Catalogue factory is not alive.');
    const catalogue = n.instance(n.call(slot.factoryAllProducts, equipmentFactory, 0),
      n.metadata(typeInfo.EquipmentProductList));
    handles.push(n.gcAlloc(catalogue));
    const version = n.u32(catalogue, runtime.listVersion);
    const listed = n.list(catalogue, 4096).map(product =>
      ({ product, id: n.text(n.u32(product, field.ProductData.Id)) }));
    if (!listed.length) throw new Error('Original equipment catalogue is empty.');
    if (AUTO_EQUIP.some(id => !listed.some(entry => entry.id === id))) throw new Error('AUTO EQUIP preset not listed.');
    const rank = (id: string) => AUTO_EQUIP.includes(id) ? AUTO_EQUIP.indexOf(id) : AUTO_EQUIP.length;
    const products = listed.sort((a, b) => rank(a.id) - rank(b.id)).map(entry => entry.product);

    stage = 'constructor';
    const user = n.instance(n.call(slot.objectNew, userClass), userClass);
    handles.push(n.gcAlloc(user));
    n.call(slot.serverUserCtor, user, 0);
    const equipment = n.instance(n.u32(user, field.ServerUser.Equipment), equipmentClass);
    const itemsClass = n.metadata(typeInfo.UpgradeableItems);
    const items = n.instance(n.call(slot.objectNew, itemsClass), itemsClass);
    handles.push(n.gcAlloc(items));
    n.call(slot.dictionaryCtor, items, n.metadata(methodInfo.upgradeableItemsCtor));
    n.setU32(equipment, field.UserEquipment.Equipment, items);

    // The original install ID (GetGuestUID → PlayerPrefs "install_id") identifies the profile, so
    // Connector.UpdatePhotonInfo publishes this user rather than a temporary guest.
    stage = 'profile';
    const general = n.check(n.u32(user, field.ServerUser.GeneralData));
    const uid = hostId === undefined ? n.call(slot.guestUid, manager, 0) : n.newString(hostId);
    if (!n.textOrNull(uid)) throw new Error('GetGuestUID returned no ID.');
    n.call(slot.setGeneralDataId, general, uid, 0);
    if (n.u32(general, field.GeneralDataModel.ID) !== uid) throw new Error('GeneralData.ID was not set.');
    receipt.profileId = n.text(uid);

    // Adaptation: an adult's age gate and a guest nickname. The lost backend filled
    // GeneralData.AgeGate; without it AgeGateManager.IsFeatureAvailable (f51672) fails, so
    // LimitedFeaturesManager.ValidateFeature (f47571) opens "Age limited feature" ("get full access") and
    // HandleNickname (f51667) swaps nicknames for generated ones. AgeGateData (built as its JSON deserializer does)
    // gets IsUnderage = false: Nullable<bool> hasValue at +8, value at +9. The nickname is the original guest one,
    // ProfilePanelHandler's cached "nickname" (PlayerPrefs), or else one from the original NicknamesGenerator, cached.
    stage = 'age gate';
    const ageGateType = n.call(slot.typeGetType, n.newString('AgeGateData, 1v1'), 1, 0);
    const ageGate = n.check(n.call(slot.createInstance, ageGateType, 0));
    handles.push(n.gcAlloc(ageGate));
    n.setU32(ageGate, field.AgeGateData.IsUnderage, 1);
    n.setU32(general, field.GeneralDataModel.AgeGate, ageGate);
    let nickname = n.call(slot.cachedNickname, 0);
    if (!n.textOrNull(nickname)) {
      nickname = n.check(n.call(slot.generatedNickname, n.check(n.call(slot.nicknamesInstance, 0)), 0));
      n.call(slot.saveNickname, nickname, 0);
    }
    n.call(slot.setNickname, general, nickname, 0);
    receipt.nickname = n.text(nickname);

    const id = (string: number) => {
      const text = n.text(n.instance(string, stringClass));
      if (!text) throw new Error('Empty equipment ID.');
      return text;
    };
    const level = (item: number) => n.call(slot.getItemLevel, equipment, item, 0);
    n.scratch(4, cell => {
      stage = 'grants';
      for (const product of products) {
        if (n.u32(catalogue, runtime.listVersion) !== version) {
          throw new Error('Native catalogue changed during setup.');
        }
        n.instance(product, productClass);
        const item = n.u32(product, field.ProductData.Id), itemId = id(item);
        const baseData = n.check(n.u32(product, field.EquipmentProductData.BaseData));
        if (id(n.u32(baseData, field.EquipmentBaseData.Id)) !== itemId) {
          throw new Error(`Product/BaseData IDs differ: ${itemId}`);
        }
        const kind = n.i32(product, field.EquipmentProductData.Type);
        const baseLevel = n.i32(product, field.EquipmentProductData.BaseLevel);
        if (kind < 0 || kind > 2 || baseLevel < 0) throw new Error('Product type/BaseLevel is invalid.');
        n.setU32(cell, 0, 0);
        if (n.call(slot.tryGetEquipmentProduct, equipmentFactory, item, cell, 0) !== 1 || n.u32(cell) !== product) {
          throw new Error(`Exact lookup failed for ${itemId}.`);
        }
        const owned = n.call(slot.doesItemExist, equipment, item, 0);
        if (owned !== 0 && owned !== 1) throw new Error('Ownership predicate did not return bool.');
        if (owned) receipt.retainedCount++;
        else {
          n.call(slot.addItem, equipment, item, 0);
          if (n.call(slot.doesItemExist, equipment, item, 0) !== 1 || level(item) !== baseLevel) {
            throw new Error('AddItem did not keep the original BaseLevel.');
          }
          receipt.grantedCount++;
        }
        // Every item at its original level cap (WeaponBaseData/ArmorBaseData.LevelCap) through UpgradeItem.
        const cap = n.callVirtual(baseData, vslot.levelCap), current = level(item);
        if (cap > current) n.call(slot.upgradeItem, equipment, item, cap - current, 0);
        if (level(item) !== Math.max(cap, current)) {
          throw new Error(`UpgradeItem did not reach LevelCap for ${itemId}.`);
        }
        if (cap > current) receipt.maxedCount++;
      }

      // Every local hero (Resources "Champions") through the original AddChampion, raised to Champions.MAX_LEVEL with
      // UserChampionData.set_Level, and the original default GameProperties.DefaultChampion equipped.
      stage = 'champions';
      const champions = n.check(n.u32(user, field.ServerUser.Champions));
      const owned = n.check(n.u32(champions, field.UserChampions.OwnedChampions));
      const tryGet = n.metadata(methodInfo.championDataTryGet);
      for (const data of n.list(n.u32(n.call(slot.championsInstance, 0), field.Champions._championsData), 64)) {
        const hero = n.u32(data, field.ChampionData.ID);
        n.call(slot.addChampion, champions, hero, 0);
        n.setU32(cell, 0, 0);
        if (n.call(slot.championDataTryGet, owned, hero, cell, tryGet) !== 1) {
          throw new Error('AddChampion did not add the hero.');
        }
        n.call(slot.setChampionLevel, n.check(n.u32(cell)), literal.championMaxLevel, 0);
        if (n.call(slot.championLevel, champions, hero, 0) !== literal.championMaxLevel) {
          throw new Error('Hero is not at MAX_LEVEL.');
        }
        receipt.championCount++;
      }
      const defaultChampion = n.call(slot.defaultChampion, 0);
      if (!receipt.championCount || n.call(slot.isChampionOwned, champions, defaultChampion, 0) !== 1) {
        throw new Error('Default champion is not a local hero.');
      }
      n.call(slot.equipChampion, champions, defaultChampion, 0);
    });

    // Ownership uses the original local IDs; the first local dances are this offline profile's wheel preset.
    stage = 'skins';
    const skins = n.check(n.u32(user, field.ServerUser.Skins));
    const local = localProducts(n), add = n.metadata(methodInfo.stringListAdd);
    const grant = (source: number, target: number) => {
      const entries = n.list(n.u32(local, source), 128), owned = n.check(n.u32(skins, target));
      for (const entry of entries) n.call(slot.listAdd, owned, n.u32(entry, field.LocalProductData.Id), add);
      return entries;
    };
    receipt.skinCount = grant(field.LocalProductsData._skinPackProducts, field.ServerSkinsEntry.CharacterSkins).length;
    receipt.weaponSkinCount = grant(field.LocalProductsData._weaponSkinsProducts,
      field.ServerSkinsEntry.WeaponSkins).length;
    const emotes = grant(field.LocalProductsData._emotes, field.ServerSkinsEntry.OwnedEmotes);
    receipt.emoteCount = emotes.length;
    const count = n.call(slot.offlineEmoteCount, 0);
    const dances = emotes.filter(entry => n.i32(entry, field.LocalEmoteProductData.Type) === literal.danceEmote)
      .slice(0, count);
    if (count <= 0 || dances.length !== count) throw new Error('Not enough local dances for the original wheel size.');
    const equipped = n.check(n.call(slot.objectNew, n.metadata(typeInfo.StringList)));
    n.call(slot.listCtor, equipped, n.metadata(methodInfo.stringListCtor));
    n.setU32(skins, field.ServerSkinsEntry.EquippedEmotes, equipped);
    for (const dance of dances) n.call(slot.listAdd, equipped, n.u32(dance, field.LocalProductData.Id), add);

    stage = 'install';
    if (n.u32(manager, field.FirebaseManager._serverUser)) {
      throw new Error('FirebaseManager already holds a ServerUser.');
    }
    n.call(slot.setServerUser, manager, user, 0);
    if (n.u32(manager, field.FirebaseManager._serverUser) !== user) {
      throw new Error('SetServerUser did not install the local ServerUser.');
    }
  } catch (error) {
    throw new Error(`${stage}: ${String(error)}`);
  } finally {
    // Installed, the ServerUser is held by FirebaseManager.Instance; the handles only covered construction.
    for (const handle of handles) try { n.gcFree(handle); } catch { /* keep the setup result */ }
  }

  // Online, server responses refresh the Photon profile (Connector.UpdatePhotonInfo: weapons, armor, champion,
  // skins); offline equips never reach it, so the original Connector.OnPlayerDataChanged runs before each
  // offline mode join, and the match spawns with the current profile.
  const installJoin = await n.prepareHook(slot.offlineJoinMode, 2, original => (connector, method) => {
    const instance = n.call(slot.connectorInstance, 0);
    if (instance) n.call(slot.onPlayerDataChanged, instance, 0);
    return original(connector, method);
  }, 0);
  installJoin();
  return receipt;
}
