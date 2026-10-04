import { verdict, type Scenario } from '../index';
import { armors, at, goToLobby, press, ready, unequippedCard, until, weapons } from '../shared/menu';

// Loadout change (a weapon into slot 3, as in the loadout scenario) and an armor, then the lobby PLAY with its mode:
// the local loadout and armor reach the native match through Connector.OnPlayerDataChanged before
// OfflineGameModeConnector.JoinMode.
export const lobbyplay: Scenario = {
  entry: 'menu',
  async run(context) {
    const { page, observe, sample, wait, screenshot } = context;
    const checks: Record<string, boolean> = {};
    const start = await until(context, 'start', menu => ready(menu), 10000);
    if (!start.matched) return verdict({}, 'Loadout not ready.');
    const target = await unequippedCard(context, weapons(start.menu) ?? []);
    if (!target) return verdict({}, 'No unequipped weapon card is visible.');
    sample('target', target);
    for (const [point, matches] of [[target.point, (menu: any) => menu.lastViewedId === target.id],
      [at.popupEquip, (menu: any) => menu.selectedId === target.id],
      [at.weaponSlot3, (menu: any) => weapons(menu)?.[2] === target.id]] as const) {
      await page.mouse.click(point[0], point[1]);
      await until(context, 'equip', matches);
    }
    checks.equipped = weapons(await observe('menu'))?.[2] === target.id;
    await page.mouse.click(...at.armorTab);
    await until(context, 'armor-tab', menu => ready(menu, 1) && menu.inventoryCategory === 1);
    await page.mouse.click(...at.firstCard);
    const card = await until(context, 'armor-card', menu =>
      typeof menu.lastViewedId === 'string' && menu.lastViewedId.startsWith('lol.1v1.armors.'));
    await page.mouse.click(...at.popupEquip);
    checks.armorEquipped = (await until(context, 'armor-equipped', menu =>
      armors(menu)?.[0] === card.menu.lastViewedId)).matched;
    const equipped = (await observe('menu')).equipment;
    sample('loadout-before-play', equipped);
    checks.lobby = await goToLobby(context);
    await press(context, at.play);
    let match: any, arms: any;
    for (let tick = 0; tick < 120; tick++) {
      await wait(500);
      match = await observe('match');
      if (match.scene?.buildIndex !== 1 && match.player?.state === 'observed') {
        arms = await observe('weapons');
        if (arms.didInitialize) break;
      }
    }
    sample('match', match);
    sample('weapons', arms);
    checks.matchStarted = match?.player?.state === 'observed' && arms?.didInitialize === true;
    checks.weaponLoadoutTransferred = JSON.stringify(arms?.slots?.slice(1).map((weapon: any) => weapon?.id ?? '')) ===
      JSON.stringify(equipped.weapons);
    checks.armorStatsTransferred = match?.player?.health === equipped.maxHealth &&
      match?.player?.armor === equipped.maxArmor;
    await screenshot('match');
    return verdict(checks);
  },
};
