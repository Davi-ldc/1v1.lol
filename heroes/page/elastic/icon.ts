import { objectsOfType } from '../../../src/page/game';
import type { Native } from '../../../src/page/native';
import { roster } from '../ids';
import { buildSprite } from '../shared/look';
import { field, literal, slot } from '../symbols';

/** The Dash's icon (AbilityUXData.Icon of Quick's Dash, which the slaps copy), by Sprite name. */
export const DASH_ICON = 'Quick_Active';
/** The hand's file in the elastic hero's directory, and its Sprite name. */
export const ICON_FILE = 'ability_icon.png', ELASTIC_ICON = 'ElasticSlap';
/** His slaps' ability (the Dash copy) once installed (read by heroes/observe/elastic.ts). */
export const elasticIcon = { ability: 0 };

/**
 * Adaptation: the elastic hero's Q shows a hand (ICON_FILE) instead of the Dash's boot. The hook on Image.set_sprite
 * (slot 8094) swaps it only on an image showing his ability, since his copy keeps Quick's ID (heroes/README.md).
 */
export async function installElasticIcon(n: Native, ability: number, image: Uint8Array,
  hold: (object: number) => number) {
  const asset = (object: number) => {
    n.call(slot.objectSetHideFlags, object, literal.dontUnloadUnusedAsset, 0);
    return object;
  };
  const hand = buildSprite(n, image, ELASTIC_ICON, hold, asset);
  const id = (product: number) => product ? n.textOrNull(n.u32(product, field.ProductData.Id)) : null;
  const icon = (display: number) => display ? n.u32(display, field.ChampionAbilityDisplay._icon) : 0;
  const his = (target: number) => {
    for (const ui of objectsOfType(n, 'JustPlay.Gameplay.Abilities.UI.AbilitySlotUI')) {
      if (n.u32(ui, field.AbilitySlotUI._abilityImage) !== target) continue;
      const held = n.u32(ui, field.AbilitySlotUI._abilitySlot);
      return !!held && n.u32(held, field.PlayerAbilitySlot.Ability) === ability;
    }
    const O = field.ChampionOverviewScreen;
    for (const screen of objectsOfType(n, 'JustPlay.Champions.UI.ChampionOverviewScreen')) {
      if (icon(n.u32(screen, O._activeAbilityDisplay)) !== target) continue;
      return id(n.u32(screen, O._selectedChampion)) === roster.elastic?.champion;
    }
    const K = field.KillFeedItem;
    return objectsOfType(n, 'KillFeedItem')
      .some(item => n.u32(item, K._firstIconImage) === target || n.u32(item, K._secondIconImage) === target);
  };
  const install = await n.prepareHook(slot.imageSetSprite, 3, original => (target, sprite, m) => {
    try { // Table calls are rare (a few per second at most), so each sprite's name is read.
      if (sprite && n.textOrNull(n.call(slot.objectName, sprite, 0)) === DASH_ICON && his(target)) sprite = hand;
    } catch (error) { console.error('LOCAL_ELASTIC_ICON', String(error)); }
    return original(target, sprite, m);
  }, 0);
  install();
  elasticIcon.ability = ability;
  return { sprite: ELASTIC_ICON };
}
