import { factory, initSettings, localProducts, settingsHandler } from '../game';
import { waitFor, type Native } from '../native';
import { field, methodInfo, slot, typeInfo } from '../symbols';
import { installCosmetics } from './cosmetics';

const CHAMPION_PREFIX = 'lol.1v1.champions.', SKIN_PREFIX = 'lol.1v1.playerskins.pack.';
/**
 * Adaptation: heroes with no local skin carrying their name, matched by theme to the six local Mythic skins, the only
 * unassigned looks among the catalog's skin packs (no recovered field links them).
 */
const THEMED_SKINS: Record<string, string> = {
  caesar: '65', // AncientEmpire, SM_Chr_Leader_Male_Mythic_01
  tron: '66', // SciFiCity, Character_CyborgNinja_Mythic_01 ("Electro")
  magma: '67', // Dungeons, Character_Rock_Golem_Mythic ("Pyro")
  jade: '68', // Samurai, Character_Samurai_Warrior_Mythic ("Jade Dragon")
  shadow: '69', // Samurai, Character_Ninja_Mythic
  frosty: '293', // Dungeons, Character_Snowman_Mythic
};

/**
 * Skin, cosmetic and hero catalogues from local original data only; store fields keep their code defaults.
 * - Skins: every LocalProductsData skin pack product goes through the original SkinProductData(local, remote) into
 *   SkinProductDataFactory, with an empty SkinRemoteProductData created by reflection, as Newtonsoft would.
 * - Weapon skins and emotes: adapters/cosmetics.ts, in the same native turn.
 * - Heroes: a ChampionsConfig document goes to the original FirebaseChampionsHandler.Init, whose DataTask's only
 *   consumer is ChampionProductDataFactory: each local ChampionData, named by its asset, with the skins whose ID
 *   carries the hero's name (default "<hero>.default") or its THEMED_SKINS Mythic skin.
 * Requires the menu WASM and the installed ServerUser.
 */
export async function installCatalogs(n: Native) {
  let handler = 0;
  if (!await waitFor(() => handler = settingsHandler(n, 'FirebaseChampionsHandler'), 200)) {
    throw new Error('FirebaseChampionsHandler is not registered.');
  }
  let stage = 'skins';
  try {
    // Synchronous from here on: the catalogues are filled in one native turn.
    const skinFactory = factory(n, methodInfo.skinFactoryInstance), local = localProducts(n);
    const skinProducts = n.check(n.u32(skinFactory, field.SkinProductDataFactory._skinProductsData));
    const remoteType = n.call(slot.typeGetType, n.newString('SkinRemoteProductData, 1v1'), 1, 0);
    const skinClass = n.metadata(typeInfo.SkinProductData), add = n.metadata(methodInfo.skinDictionaryAdd);
    const skinIds: string[] = [];
    let skins = 0;
    for (const item of n.list(n.u32(local, field.LocalProductsData._skinPackProducts), 128)) {
      const id = n.u32(item, field.LocalProductData.Id);
      skinIds.push(n.text(id));
      if (n.call(slot.getSkin, skinFactory, id, 0)) continue;
      const product = n.check(n.call(slot.objectNew, skinClass));
      n.call(slot.skinProductCtor, product, item, n.check(n.call(slot.createInstance, remoteType, 0)), 0);
      n.call(slot.dictionaryAdd, skinProducts, id, product, add);
      skins++;
    }

    stage = 'cosmetics';
    const cosmetics = installCosmetics(n, local);

    stage = 'champions';
    const startingSkin = n.text(n.call(slot.startingDefaultSkin, 0));
    const heroes = n.list(n.u32(n.call(slot.championsInstance, 0), field.Champions._championsData), 64);
    const products: Record<string, { Name: string; default_skin: string; skins: string[] }> = {};
    for (const data of heroes) {
      const id = n.text(n.u32(data, field.ChampionData.ID));
      if (!id.startsWith(CHAMPION_PREFIX)) throw new Error(`Unexpected champion ID ${id}.`);
      const hero = id.slice(CHAMPION_PREFIX.length), themed = `${SKIN_PREFIX}${THEMED_SKINS[hero]}`;
      const named = skinIds.filter(skin => skin.startsWith(`${SKIN_PREFIX}${hero}.`));
      const own = named.length ? named : skinIds.includes(themed) ? [themed] : [];
      products[id] = { Name: n.text(n.call(slot.objectName, data, 0)), skins: own,
        default_skin: own.find(skin => skin.endsWith('.default')) ?? own[0] ?? startingSkin };
    }
    initSettings(n, handler, ['ChampionsID', 'ChampionsConfig'],
      { products, featured_champion_banner: { is_enabled: false } });
    const championFactory = factory(n, methodInfo.championFactoryInstance);

    stage = 'products';
    let champions = 0;
    const count = () => champions = n.list(n.call(slot.championProducts, championFactory, 0), 64).length;
    if (!await waitFor(() => count() >= heroes.length, 100)) {
      throw new Error(`ChampionProductDataFactory built ${champions}/${heroes.length} products.`);
    }
    return { skins, champions, ...cosmetics };
  } catch (error) {
    throw new Error(`${stage}: ${String(error)}`);
  }
}
