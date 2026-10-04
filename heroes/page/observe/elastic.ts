import { objectsOfType } from '../../../src/page/game';
import { sample, type Native } from '../../../src/page/native';
import { elasticIcon } from '../elastic/icon';
import { elasticEnded, elasticKnocks, elasticProjectiles } from '../elastic/projectile';
import { elasticSlaps, elasticStrikes } from '../elastic/slap';
import { field, slot } from '../symbols';

/**
 * The elastic hero on this client: each slapping player (OwnerID, local?) with its cycle index, seconds into the slap,
 * hand scales and PlayerIK flag (elastic/slap.ts); the local player's last slaps as it resolved them (pick, frames,
 * strike or miss: elasticStrikes); the projectile flights with their thrower's OwnerID, position, scale, tumble
 * (turns), seconds and stop (elastic/projectile.ts), the flights that ended and the knocks received; the local
 * player's PlayerIK flag and whether its held weapon shows (any of its renderers enabled; the slaps disable them).
 */
export function observeElastic(n: Native) {
  return sample(() => {
    const mine = n.call(slot.playerMine, 0), id = (player: number) => n.call(slot.playerOwnerId, player, 0);
    const ik = mine && n.alive(mine) ? n.u32(mine, field.PlayerController.PlayerIK) : 0;
    const weapons = mine && n.alive(mine) ? n.u32(mine, field.PlayerController._weaponsController) : 0;
    const weapon = weapons ? n.u32(weapons, field.WeaponsController.CurrentWeapon) : 0;
    const type = n.call(slot.typeGetType, n.newString('UnityEngine.Renderer, UnityEngine.CoreModule'), 1, 0);
    const renderers = weapon && n.alive(weapon) ? n.array(n.call(slot.componentsInChildren,
      n.call(slot.componentGameObject, weapon, 0), type, 1, 0), 64).filter(item => n.alive(item)) : null;
    return {
      weapon: renderers && renderers.some(item => n.call(slot.rendererEnabled, item, 0) === 1),
      slaps: [...elasticSlaps].filter(([player]) => n.alive(player))
        .map(([player, state]) => ({ id: id(player), mine: player === mine, ...state })),
      strikes: elasticStrikes.get(mine) ?? [],
      projectiles: elasticProjectiles.filter(flight => n.alive(flight.hero))
        .map(({ hero, at, scale, turns, t, stop }) => ({ id: id(hero), at, scale, turns, t, stop })),
      ended: elasticEnded,
      knocks: elasticKnocks,
      ik: ik && n.alive(ik) ? n.bool(ik, field.PlayerIK.IsIKEnabled) : null,
      icons: icons(n),
    };
  });
}

/**
 * The ability icons showing (elastic/icon.ts), by Sprite name: each HUD slot's, with its ability's class and
 * whether it is his copy; the active ability's on each overview, with the overview's champion.
 */
function icons(n: Native) {
  const sprite = (image: number) => {
    const shown = image && n.alive(image) ? n.call(slot.imageSprite, image, 0) : 0;
    return shown ? n.textOrNull(n.call(slot.objectName, shown, 0)) : null;
  };
  const id = (product: number) => product ? n.textOrNull(n.u32(product, field.ProductData.Id)) : null;
  const icon = (display: number) => display ? n.u32(display, field.ChampionAbilityDisplay._icon) : 0;
  const alive = (type: string) => objectsOfType(n, type).filter(object => n.alive(object));
  const S = field.AbilitySlotUI, O = field.ChampionOverviewScreen;
  return {
    hud: alive('JustPlay.Gameplay.Abilities.UI.AbilitySlotUI').map(ui => {
      const held = n.u32(ui, S._abilitySlot), ability = held ? n.u32(held, field.PlayerAbilitySlot.Ability) : 0;
      return { ability: ability ? n.className(ability) : null, his: !!ability && ability === elasticIcon.ability,
        sprite: sprite(n.u32(ui, S._abilityImage)) };
    }),
    overview: alive('JustPlay.Champions.UI.ChampionOverviewScreen').map(screen => ({
      champion: id(n.u32(screen, O._selectedChampion)),
      sprite: sprite(icon(n.u32(screen, O._activeAbilityDisplay))) })),
  };
}
