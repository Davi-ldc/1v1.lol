import { verdict, type Scenario } from '../index';
import { at, ready, until } from '../shared/menu';

// Original navigation: Home Button 398623 → UiManager.SwitchToMainScreen f52095 → Lobby (screen 0).
export const reopen: Scenario = {
  entry: 'menu',
  async run(context) {
    const { page, screenshot } = context;
    const checks: Record<string, boolean> = {};
    const start = await until(context, 'start', menu => ready(menu), 10000);
    if (!start.matched) return verdict({}, 'Loadout not ready.');
    await page.mouse.click(...at.home);
    const lobby = await until(context, 'lobby', menu =>
      menu.status === 'observed' && menu.screen === 0 && !menu.active, 8000);
    checks.lobby = lobby.matched;
    await context.wait(3000);
    await screenshot('lobby');
    return verdict(checks);
  },
};
