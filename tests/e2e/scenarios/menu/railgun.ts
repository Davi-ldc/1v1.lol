import { verdict, type Scenario } from '../index';
import { at, goToLobby, press, ready, until, weapons } from '../shared/menu';

const RAILGUN = 'lol.1v1.weapons.railgun';

// Railgun scope (adapters/railgun-scope.ts): the railgun goes into weapon slot 3 on the original Loadout, the lobby's
// PLAY starts a match, and there the railgun (key 3) carries the snipers' zoom and shows the scope when aimed.
export const railgun: Scenario = {
  entry: 'menu',
  async run(context) {
    const { page, observe, sample, wait, screenshot } = context;
    const start = await until(context, 'start', ready, 20000);
    // Scroll the inventory with the wheel until the railgun card sits inside the grid (CSS y 180–600).
    const cardPoint = async () => {
      const entries: any[] = (await observe('presentation', 1)).cards?.entries ?? [];
      const screen = entries.find(entry => entry.id === RAILGUN)?.screen;
      return screen ? [Math.round(screen[0]), Math.round(760 - screen[1])] as const : null;
    };
    let point = await cardPoint();
    for (let step = 0; step < 20 && point && (point[1] < 180 || point[1] > 600); step++) {
      await page.mouse.move(1035, 420);
      await page.mouse.wheel(0, point[1] > 600 ? 175 : -175);
      await wait(600);
      point = await cardPoint();
    }
    sample('card', point);
    if (!start.matched || !point || point[1] < 180 || point[1] > 600) {
      return verdict({ ready: start.matched, visible: false });
    }
    for (const [target, matches] of [[point, (menu: any) => menu.lastViewedId === RAILGUN],
      [at.popupEquip, (menu: any) => menu.selectedId === RAILGUN],
      [at.weaponSlot3, (menu: any) => weapons(menu)?.[2] === RAILGUN]] as const) {
      await page.mouse.click(target[0], target[1]);
      await until(context, 'equip', matches);
    }
    const equipped = weapons(await observe('menu'))?.[2] === RAILGUN;
    const lobby = await goToLobby(context);
    await press(context, at.play);
    for (let tick = 0; tick < 180; tick++) { // Weapons switch once the match has started (after the countdown).
      await wait(500);
      if ((await observe('match')).game?.hasStarted) break;
    }
    await page.mouse.click(...at.center);
    await page.keyboard.press('3');
    await wait(1000);
    const held = await observe('weapons');
    sample('held', held.equipped);
    await page.mouse.down({ button: 'right' });
    try {
      await wait(1500);
      await screenshot('aim');
    } finally { await page.mouse.up({ button: 'right' }); }
    const zoom = held.equipped?.zoom;
    return verdict({ equipped, lobby, held: held.equipped?.id === RAILGUN,
      scope: zoom?.scope === true && zoom?.type === 0 && zoom?.fieldOfView === 15 });
  },
};
