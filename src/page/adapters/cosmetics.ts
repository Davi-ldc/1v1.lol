import { factory } from '../game';
import type { Native } from '../native';
import { field, literal, methodInfo, slot, typeInfo } from '../symbols';

/**
 * Weapon-skin and emote catalogues through the local factory constructors (f49395/f48964): staged in private
 * factories and published only once every local entry passes the native lookups. ProductsV9 stays unavailable, not
 * falsely completed. Called by the catalogs adapter in its native turn.
 */
export function installCosmetics(n: Native, localProducts: number) {
  const handles: number[] = [];
  const hold = (object: number) => { handles.push(n.gcAlloc(object)); return object; };
  const type = (name: string) => n.call(slot.typeGetType, n.newString(`${name}, 1v1`), 1, 0);
  const create = (name: string) => hold(n.call(slot.createInstance, type(name), 0));
  try {
    return n.scratch(4, out => {
      const weapons = factory(n, methodInfo.weaponSkinsFactory), emotes = factory(n, methodInfo.emoteFactory);
      const stats = factory(n, methodInfo.equipmentStatsFactory);
      const stagedWeapons = create('WeaponSkinsDataFactory'), stagedEmotes = create('EmoteProductDataFactory');
      const W = field.WeaponSkinsDataFactory, E = field.EmoteProductDataFactory;
      const weaponProducts = n.check(n.u32(stagedWeapons, W._weaponSkinsProductData));
      const byWeapon = n.check(n.u32(stagedWeapons, W._skinsPerWeapon));
      const emoteProducts = n.check(n.u32(stagedEmotes, E._emoteProductsData));
      const prefabs = n.check(n.call(slot.getWeaponSkinsPrefabs, localProducts, 0));
      const melee = n.call(slot.weaponSkinPrefab, prefabs, literal.meleeSkin, 0,
        n.metadata(methodInfo.weaponSkinPrefab));
      const meleeType = n.i32(melee, field.WeaponSkinManager._weaponSkinType);
      if (meleeType !== literal.meleeSkin) throw new Error('Local melee prefab has a different skin type.');
      const meleeIds = new Set(n.list(n.u32(melee, field.WeaponSkinManager._weaponSkinPacks), 64)
        .map(pack => n.text(n.u32(pack, field.WeaponSkinPack._weaponSkinID))));
      const remoteWeaponType = type('WeaponSkinRemoteProductData'), remoteEmoteType = type('LockerRemoteProductData');
      const weaponClass = n.metadata(typeInfo.WeaponSkinProductData),
        emoteClass = n.metadata(typeInfo.EmoteProductData);
      const listClass = n.metadata(typeInfo.WeaponSkinProductList),
        listCtor = n.metadata(methodInfo.weaponSkinListCtor);
      const addWeapon = n.metadata(methodInfo.weaponSkinAdd), addEmote = n.metadata(methodInfo.emoteAdd);
      const contains = n.metadata(methodInfo.skinsPerWeaponContains), get = n.metadata(methodInfo.skinsPerWeaponGet);
      const addGroup = n.metadata(methodInfo.skinsPerWeaponAdd), addSkin = n.metadata(methodInfo.weaponSkinListAdd);
      const localSkins = n.list(n.u32(localProducts, field.LocalProductsData._weaponSkinsProducts), 128);
      const localEmotes = n.list(n.u32(localProducts, field.LocalProductsData._emotes), 256);
      if (!localSkins.length || !localEmotes.length) throw new Error('Local cosmetic catalogue is empty.');

      for (const local of localSkins) {
        const id = n.u32(local, field.LocalProductData.Id),
          weaponId = n.u32(local, field.LocalWeaponSkinProductData.WeaponID);
        const remote = hold(n.call(slot.createInstance, remoteWeaponType, 0));
        const isMelee = meleeIds.has(n.text(id));
        if (isMelee) n.setI32(remote, field.WeaponSkinRemoteProductData.WeaponType, meleeType);
        n.setU32(out, 0, 0);
        const found = n.call(slot.tryGetEquipmentData, stats, weaponId, out, 0) === 1;
        if (!isMelee && !found) throw new Error(`No original equipment data for skin ${n.text(id)}.`);
        const product = hold(n.call(slot.objectNew, weaponClass));
        n.call(slot.weaponSkinProductCtor, product, local, remote, n.u32(out), 0);
        if (isMelee && n.i32(product, field.WeaponSkinProductData.WeaponType) !== meleeType) {
          throw new Error('Melee skin type changed in construction.');
        }
        if (n.call(slot.weaponSkinOwned, product, 0) !== 1) throw new Error(`Weapon skin not owned: ${n.text(id)}.`);
        n.call(slot.dictionaryAdd, weaponProducts, id, product, addWeapon);
        const key = n.u32(product, field.WeaponSkinProductData.WeaponID);
        if (!n.call(slot.dictionaryContains, byWeapon, key, contains)) {
          const list = hold(n.call(slot.objectNew, listClass));
          n.call(slot.listCtor, list, listCtor);
          n.call(slot.dictionaryAdd, byWeapon, key, list, addGroup);
        }
        n.call(slot.listAdd, n.check(n.call(slot.dictionaryGet, byWeapon, key, get)), product, addSkin);
        if (n.call(slot.getWeaponSkin, stagedWeapons, id, 0) !== product) {
          throw new Error('Weapon-skin lookup differs.');
        }
      }
      for (const local of localEmotes) {
        const id = n.u32(local, field.LocalProductData.Id),
          remote = hold(n.call(slot.createInstance, remoteEmoteType, 0));
        const product = hold(n.call(slot.objectNew, emoteClass));
        n.call(slot.emoteProductCtor, product, local, remote, 0);
        if (n.call(slot.emoteOwned, product, 0) !== 1) throw new Error(`Emote not owned: ${n.text(id)}.`);
        n.call(slot.dictionaryAdd, emoteProducts, id, product, addEmote);
        if (n.call(slot.getEmote, stagedEmotes, id, 0) !== product) throw new Error('Emote lookup differs.');
      }

      n.setU32(weapons, W._weaponSkinsProductData, weaponProducts);
      n.setU32(weapons, W._skinsPerWeapon, byWeapon);
      n.setU32(emotes, E._emoteProductsData, emoteProducts);
      return { weaponSkins: localSkins.length, emotes: localEmotes.length };
    });
  } finally {
    for (const handle of handles.reverse()) n.gcFree(handle);
  }
}
