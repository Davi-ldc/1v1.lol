import { verdict, type Scenario } from '../index';
import { at } from '../shared/menu';

// A wall placed at shape 0; G/select/release confirms shape 3; each reset
// (wheel up, wheel down, G + right button) restores shape 0.
export const edit: Scenario = {
  entry: 'practice',
  async run({ page, elapsed, wait, observe, sample, screenshot }) {
    await wait(Math.max(0, 25000 - elapsed()));
    let building = 0;
    const state = async (label: string) => {
      const native = await observe('edit', building);
      if (native.target) building = native.target;
      sample(label, native);
      return native;
    };
    const checks: Record<string, boolean> = {};
    const start = await state('start');
    checks.preferences = !!start.preferences && Object.values(start.preferences).every(value => value === 1);
    await page.mouse.click(...at.center); // Place through original input.
    await wait(600);
    const placed = await state('placed');
    checks.placed = !!placed.target && placed.shape?.childIndex === 0;
    for (const reset of ['wheel-up', 'wheel-down', 'right-button'] as const) {
      await page.mouse.move(...at.center, { steps: 8 });
      await wait(250);
      await page.keyboard.press('g');
      await wait(300);
      await state(`${reset}-grid`);
      await screenshot(`${reset}-grid`);
      await page.mouse.down();
      await wait(180);
      await page.mouse.move(640, 390, { steps: 3 }); // Drag across the selected part.
      await wait(180);
      await state(`${reset}-select-held`);
      await page.mouse.up();
      await wait(350);
      checks[`${reset}-confirm`] = (await state(`${reset}-confirm`)).shape?.childIndex === 3;
      await screenshot(`${reset}-edited`);
      await page.mouse.move(800, 330, { steps: 8 }); // Aim at another visible part.
      await wait(300);
      await state(`${reset}-aim`);
      if (reset === 'right-button') {
        await page.keyboard.press('g');
        await wait(250);
        await state('right-button-grid-again');
        await page.mouse.down({ button: 'right' });
        await wait(150);
        await state('right-button-held');
        await page.mouse.up({ button: 'right' });
      } else {
        await page.mouse.wheel(0, reset === 'wheel-up' ? -120 : 120);
      }
      await wait(350);
      checks[`${reset}-reset`] = (await state(`${reset}-reset`)).shape?.childIndex === 0;
      await screenshot(`${reset}-reset`);
    }
    return verdict(checks);
  },
};
