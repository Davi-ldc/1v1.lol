import { verdict, type Scenario } from '../index';
import { aim } from '../shared/lan';
import { at, goToLobby, press, ready, until } from '../shared/menu';

// Scroll resets an edited build in matches started from the lobby, for every player (adaptation):
// SettingsPanel.InitSettingsInputs gives the scroll-reset toggle the default on (src/host/wasm.ts scrollReset), so
// SettingsPanel.ScrollWheelReset is on unless the player saved it off, and EditingManager.CheckScrollWheelReset
// (f45008) resets the aimed build. Edit on release and reset without confirm keep their original defaults (on).
export const editmenu: Scenario = {
  entry: 'menu',
  async run(context) {
    const { page, wait, observe, sample, screenshot } = context;
    const checks: Record<string, boolean> = {};
    checks.ready = (await until(context, 'start', menu => ready(menu), 20000)).matched;
    checks.lobby = await goToLobby(context);
    await press(context, at.play);
    for (let tick = 0; tick < 180 && !checks.started; tick++) {
      await wait(500);
      checks.started = (await observe('match')).game?.hasStarted === true;
    }
    await page.mouse.click(...at.center);
    await wait(800);
    const spot = (await observe('match')).player?.position as number[];
    const mouse: [number, number] = [640, 380];
    if (spot) await aim(context, [spot[0]! + 10, spot[1]! + 1.5, spot[2]!], mouse); // The horizon ahead.
    let building = 0;
    const state = async (label: string) => {
      const native = await observe('edit', building);
      if (native.target) building = native.target;
      sample(label, native);
      return native;
    };
    checks.scrollReset = (await state('start')).preferences?.scrollWheelReset === 1;
    await page.keyboard.press('z'); // A wall ahead, through original input.
    await wait(400);
    await page.mouse.down();
    await page.mouse.up();
    await wait(600);
    const placed = await state('placed');
    checks.placed = !!placed.target && placed.shape?.childIndex === 0;
    await page.keyboard.press('g');
    await wait(300);
    await page.mouse.down();
    await wait(180);
    mouse[1] += 10;
    await page.mouse.move(mouse[0], mouse[1], { steps: 3 }); // Drag across the selected part; releasing confirms.
    await wait(180);
    await page.mouse.up();
    await wait(400);
    const edited = await state('edited');
    checks.edited = typeof edited.shape?.childIndex === 'number' && edited.shape.childIndex !== 0;
    await screenshot('edited');
    if (spot) await aim(context, [spot[0]! + 10, spot[1]! + 2, spot[2]! + 1], mouse); // Another part of it.
    await wait(300);
    await state('aim');
    await page.mouse.wheel(0, -120);
    await wait(400);
    checks.reset = (await state('reset')).shape?.childIndex === 0;
    await screenshot('reset');
    return verdict(checks);
  },
};
