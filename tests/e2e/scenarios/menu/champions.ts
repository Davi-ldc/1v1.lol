import { verdict, type Scenario } from '../index';
import { at, goToLobby, press, ready, until } from '../shared/menu';

const QUICK = 'lol.1v1.champions.quick';

// With a ServerUser, clicking the lobby character runs PartyMemberClickManager.CheckForEmote f48241 →
// UserChampions.EquippedChampion → UiManager.ShowChampionOverviewScreen f52123 (ScreenName.ChampionOverview=33),
// whose entry validation the screens adapter opens offline. The equipped hero is GameProperties.DefaultChampion.
export const champions: Scenario = {
  entry: 'menu',
  async run(context) {
    const { page, screenshot } = context;
    const checks: Record<string, boolean> = {};
    const start = await until(context, 'start', menu => ready(menu), 10000);
    if (!start.matched) return verdict({}, 'Loadout not ready.');
    checks.equippedDefault = start.menu.equipment?.champion === QUICK;
    checks.lobby = await goToLobby(context);
    await press(context, at.center, 300); // A human click on the 3D character.
    checks.overview = (await until(context, 'overview', menu =>
      menu.status === 'observed' && menu.screen === 33, 8000)).matched;
    await context.wait(10000); // Ability rows update after GetUXData loads AbilitiesUXData/<id>.
    context.sample('switchers', await context.observe('switchers'));
    await screenshot('champion-overview');
    await page.mouse.click(...at.championsTab); // The overview's CHAMPIONS tab (three tabs, Locker hidden) → 34.
    checks.selection = (await until(context, 'selection', menu =>
      menu.status === 'observed' && menu.screen === 34, 8000)).matched;
    await context.wait(2000);
    await screenshot('champion-selection');
    return verdict(checks);
  },
};
