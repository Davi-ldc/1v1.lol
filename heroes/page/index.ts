// The custom heroes, a declared adaptation (heroes/README.md): this module is its own bundle, /local/heroes.js, which
// the host serves before the page bundle only when `play` or `probe` gets --heroes. It registers itself as a page
// extension (src/page/main.ts) that installs before the core adapters, so they list the heroes as originals.
import { localProducts } from '../../src/page/game';
import type { Extension } from '../../src/page/main';
import type { Native } from '../../src/page/native';
import { armBeamAbility, installBeamAbility } from './beam/ability';
import { PASSWORD_FILE, installBeamPassword } from './beam/password';
import { installBeamSword, loadSword, swordState } from './beam/sword';
import { installBeamSwordAnim } from './beam/sword-anim';
import { ICON_FILE, installElasticIcon } from './elastic/icon';
import { installElasticProjectile, PROJECTILE_IMAGE, PROJECTILE_MESH, type ProjectileMesh } from './elastic/projectile';
import { armElasticAbility, installElasticSlap } from './elastic/slap';
import { installElasticStretch } from './elastic/stretch';
import { type Hero, heroFile, type HeroId, HEROES, POSEIDON, POSEIDON_SKIN, QUICK, roster, SENTINEL } from './ids';
import { heroObservers } from './observe';
import { installHeroCheats } from './shared/cheats';
import { installHeroFrame } from './shared/frame';
import { installHeroLook, loadHeroLook } from './shared/look';
import { installHeroNet } from './shared/net';
import { field, methodInfo, runtime, slot } from './symbols';

/** The SAMURAI pack (Shadow's skin, the Ninja) whose controllers the elastic hero moves with. */
const SAMURAI = 'Assets/Prefabs/SkinPacks/SAMURAI.prefab';

/**
 * List<T>.Add for a reference T whose Add the build never instantiates (no MethodInfo): the original steps, growing
 * `_items` to twice its length (minimum 4) through Array.CreateInstance of the element type.
 */
function append(n: Native, list: number, item: number, elementType: string) {
  let items = n.u32(list, runtime.listItems);
  const size = n.u32(list, runtime.listSize), length = n.u32(items, runtime.arrayLength);
  if (size >= length) {
    const type = n.call(slot.typeGetType, n.newString(elementType), 1, 0);
    const grown = n.check(n.call(slot.arrayCreateInstance, type, Math.max(4, 2 * length), 0));
    for (let index = 0; index < size; index++) {
      n.setU32(grown, runtime.arrayData + 4 * index, n.u32(items, runtime.arrayData + 4 * index));
    }
    n.setU32(list, runtime.listItems, items = grown);
  }
  n.setU32(items, runtime.arrayData + 4 * size, item);
  n.setU32(list, runtime.listSize, size + 1);
  n.setU32(list, runtime.listVersion, n.u32(list, runtime.listVersion) + 1);
}

const byId = (n: Native, list: number, offset: number, id: string) =>
  n.list(list, 64).find(item => n.text(n.u32(item, offset)) === id) ?? 0;

/**
 * Poseidon copied as `hero` (heroes/README.md, "How the heroes join the original game"): his ChampionData by
 * Object.Instantiate under its champion ID, named by its display name, appended to Champions._championsData and
 * _championsMap; his default LocalSkinPackProductData by MemberwiseClone under its skin ID, appended to
 * LocalProductsData and _skinPackDict.
 */
function addHero(n: Native, hold: (object: number) => number, { champion: id, name, skin: skinId }: Hero) {
  const champions = n.check(n.call(slot.championsInstance, 0));
  const heroes = n.check(n.u32(champions, field.Champions._championsData));
  const base = byId(n, heroes, field.ChampionData.ID, POSEIDON);
  if (!base) throw new Error(`${POSEIDON} is not a local hero.`);
  if (byId(n, heroes, field.ChampionData.ID, id)) throw new Error(`${id} already exists.`);
  const hero = hold(n.call(slot.objectInstantiate, base, 0));
  if (n.u32(hero) !== n.u32(base)) throw new Error('Instantiate returned another class.');
  const heroId = n.newString(id);
  n.call(slot.championDataSetId, hero, heroId, 0);
  n.call(slot.objectSetName, hero, n.newString(name), 0);
  append(n, heroes, hero, 'JustPlay.Champions.ChampionData, 1v1');
  n.call(slot.dictionaryAdd, n.check(n.u32(champions, field.Champions._championsMap)), heroId, hero,
    n.metadata(methodInfo.championMapAdd));

  const local = localProducts(n), packs = n.check(n.u32(local, field.LocalProductsData._skinPackProducts));
  const baseSkin = byId(n, packs, field.LocalProductData.Id, POSEIDON_SKIN);
  if (!baseSkin) throw new Error(`${POSEIDON_SKIN} is not a local skin pack.`);
  const skin = hold(n.call(slot.memberwiseClone, baseSkin, 0));
  const skinText = n.newString(skinId);
  n.setU32(skin, field.LocalProductData.Id, skinText);
  append(n, packs, skin, 'LocalSkinPackProductData, 1v1');
  n.call(slot.dictionaryAdd, n.check(n.u32(local, field.LocalProductsData._skinPackDict)), skinText, skin,
    n.metadata(methodInfo.skinPackDictAdd));
  return { hero, base, heroes: n.list(heroes, 64).length, skins: n.list(packs, 128).length };
}

/**
 * A card for every hero: ChampionSelectionScreen.OnEnable (slot 120137, a Unity message) shows the ordered champion
 * products on the prefab's 12 `_championCards` and hides the cards left over. Before it runs, the last card is copied
 * next to it (Object.Instantiate with its parent: the grid lays the copy out) until the cards cover the heroes.
 */
async function installCards(n: Native) {
  const install = await n.prepareHook(slot.championScreenOnEnable, 2, original => (screen, m) => {
    try {
      const cards = n.check(n.u32(screen, field.ChampionSelectionScreen._championCards));
      const heroes = n.list(n.u32(n.call(slot.championsInstance, 0), field.Champions._championsData), 64).length;
      for (let count = n.list(cards, 64).length; count < heroes; count++) {
        const last = n.check(n.list(cards, 64)[count - 1]!);
        const parent = n.call(slot.transformParent, n.call(slot.componentTransform, last, 0), 0);
        append(n, cards, n.check(n.call(slot.objectInstantiateIn, last, parent, 0)),
          'JustPlay.Champions.UI.ChampionCard, 1v1');
      }
    } catch (error) { console.error('LOCAL_HERO_CARDS', String(error)); }
    original(screen, m);
    return 0;
  }, 0);
  install();
}

const fetchBytes = (url: string) => fetch(url).then(async response => new Uint8Array(await response.arrayBuffer()));

/**
 * The heroes whose directories the host serves (by slot: `files`, the names in each one, and its names.json entry),
 * each a Poseidon copy showing its scan, with its own Q: the beam (`beam`) and the elastic (`elastic`) hero. A slot
 * without a directory is not added and none of its own adapters install.
 */
async function installHeroes(n: Native, present: Partial<Record<HeroId, Hero>>) {
  for (const id of HEROES) if (present[id]) roster[id] = present[id];
  const { beam, elastic } = roster;
  const beamLook = beam && await loadHeroLook('beam', beam.files);
  const sword = beam && await loadSword(beam.files);
  const password = beam?.files.includes(PASSWORD_FILE) ? await fetch(heroFile('beam', PASSWORD_FILE))
    .then(response => response.json() as Promise<{ sha256: string }>).then(file => file.sha256) : undefined;
  const elasticLook = elastic && await loadHeroLook('elastic', elastic.files);
  const elasticHas = (name: string) => !!elastic?.files.includes(name);
  const elasticFile = (name: string) => heroFile('elastic', name);
  const projectile = elasticHas(PROJECTILE_MESH) && elasticHas(PROJECTILE_IMAGE) ? {
    mesh: await fetch(elasticFile(PROJECTILE_MESH)).then(response => response.json() as Promise<ProjectileMesh>),
    image: await fetchBytes(elasticFile(PROJECTILE_IMAGE)),
  } : undefined;
  const icon = elasticHas(ICON_FILE) ? await fetchBytes(elasticFile(ICON_FILE)) : undefined;
  const handles: number[] = [];
  const hold = (object: number) => { handles.push(n.gcAlloc(n.check(object))); return object; };
  let stage = 'beam';
  try {
    const heroes = n.check(n.u32(n.check(n.call(slot.championsInstance, 0)), field.Champions._championsData));
    const shield = beamLook && byId(n, heroes, field.ChampionData.ID, SENTINEL);
    const sentinel = shield ? n.u32(shield, field.ChampionData.ActiveAbility) : 0;
    if (beamLook && (!sentinel || n.className(sentinel) !== 'BarrierShockwaveAbility')) {
      throw new Error('No Sentinel barrier.');
    }
    const beamHero = beamLook && addHero(n, hold, beam);
    const aqua = beamHero && armBeamAbility(n, beamHero.hero, beamHero.base, hold);
    stage = 'elastic';
    const elasticHero = elasticLook && addHero(n, hold, elastic);
    await installCards(n);
    const quick = elasticHero && projectile ? byId(n, heroes, field.ChampionData.ID, QUICK) : 0;
    const slaps = quick ? armElasticAbility(n, elasticHero!.hero,
      n.check(n.u32(quick, field.ChampionData.ActiveAbility)), hold) : 0;
    stage = 'looks';
    const net = await installHeroNet(n), frames = await installHeroFrame(n);
    const looks = [...beamLook ? [{ hero: beam.champion, skin: beam.skin, name: 'beam', look: beamLook, glow: true }]
      : [], ...elasticLook ? [{ hero: elastic.champion, skin: elastic.skin, name: 'elastic', look: elasticLook,
      animations: SAMURAI }] : []];
    const shown = looks.length ? await installHeroLook(n, looks, frames) : undefined;
    if (shown) installHeroCheats(n, frames, shown.managers);
    const stretch = elasticLook && shown
      ? installElasticStretch(n, elastic.champion, elastic.skin, elasticLook.mesh, shown, frames, net) : undefined;
    stage = 'slaps';
    if (slaps) {
      const thrown = installElasticProjectile(n, net, frames, projectile!.mesh, projectile!.image,
        () => n.u32(slaps, field.Ability.ID));
      await installElasticSlap(n, net, frames, thrown);
    }
    const slapIcon = slaps && icon ? await installElasticIcon(n, slaps, icon, hold) : undefined;
    stage = 'sword';
    const swordReceipt = sword ? await installBeamSword(n, net, frames, sword) : undefined;
    if (swordReceipt) await installBeamSwordAnim(n, frames, swordState);
    stage = 'password';
    const passwordReceipt = beamHero && await installBeamPassword(n, password);
    stage = 'ability';
    const ability = aqua && await installBeamAbility(n, aqua, sentinel, net, beamLook?.clips, shown?.glow,
      beamLook?.beam);
    const last = elasticHero || beamHero;
    return { heroes: last?.heroes, skins: last?.skins, look: shown?.receipt,
      beam: beamHero && { hero: beam.champion, skin: beam.skin, password: passwordReceipt, ability,
        sword: swordReceipt },
      elastic: elasticHero && { hero: elastic.champion, skin: elastic.skin, stretch, slaps: !!slaps,
        icon: slapIcon } };
  } catch (error) {
    throw new Error(`${stage}: ${String(error)}`);
  } finally {
    for (const handle of handles) try { n.gcFree(handle); } catch { /* keep the setup result */ }
  }
}

const heroes: Extension = {
  name: 'hero',
  install: (n, config) => installHeroes(n, config.heroes ?? {}),
  observers: heroObservers,
};
(window.localExtensions ??= []).push(heroes);
