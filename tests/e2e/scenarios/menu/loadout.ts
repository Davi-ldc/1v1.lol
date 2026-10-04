import { verdict, type Scenario } from '../index';
import { at, iconsAlive, preview, previewAlive, ready, unequippedCard, until, weapons } from '../shared/menu';

const SCAR = 'lol.1v1.weapons.scar', PUMP = 'lol.1v1.weapons.pump_shotgun';

// Equip goes through LoadoutScreen f50668; drag-out through slot EndDrag f43604 → OnUnequipSelected f50671.
// SlotPickedFrom stays 2 after removal, as in the original: it is not normalized.
// Graphics come from the original getter over Addressables (EquipmentBaseData._loadedAssets owns them).
// The card is the first visible unequipped weapon: the inventory order follows item levels.
export const loadout: Scenario = {
  entry: 'menu',
  async run(context) {
    const { page, screenshot } = context;
    const checks: Record<string, boolean> = {};
    const start = await until(context, 'start', menu => ready(menu), 10000);
    if (!start.matched || JSON.stringify(weapons(start.menu)) !== JSON.stringify([SCAR, PUMP, '']) ||
      start.menu.selectedId !== null) {
      return verdict({}, 'Expected a ready Loadout with [scar, pump, empty] and no selection.');
    }
    const target = await unequippedCard(context, weapons(start.menu) ?? []);
    if (!target) return verdict({}, 'No unequipped weapon card is visible.');
    context.sample('target', target);
    const steps = [
      { name: 'card', point: target.point, matches: (menu: any) => menu.lastViewedId === target.id },
      { name: 'equip', point: at.popupEquip, matches: (menu: any) => menu.selectedId === target.id },
      { name: 'slot', point: at.weaponSlot3,
        matches: (menu: any) => weapons(menu)?.[2] === target.id && menu.selectedId === null },
    ] as const;
    for (const step of steps) {
      await page.mouse.click(step.point[0], step.point[1]);
      checks[step.name] = (await until(context, step.name, step.matches)).matched;
      if (step.name === 'card') {
        const popup = await preview(context, 'popup');
        checks.previewAlive = previewAlive(popup);
        checks.weaponIconsAlive = iconsAlive(popup);
      }
      await screenshot(`loadout-${step.name}`);
      if (!checks[step.name]) return verdict(checks);
    }
    await page.mouse.move(...at.weaponSlot3);
    await page.mouse.down();
    try {
      await page.mouse.move(650, 440, { steps: 16 }); // Free background outside slots, grid and AutoEquip.
      checks.dragBegin = (await until(context, 'drag-begin', menu =>
        menu.selectedId === target.id && menu.slotPickedFrom === 2)).matched;
      await screenshot('loadout-drag-begin');
    } finally { await page.mouse.up(); }
    const removed = await until(context, 'drag-end', menu => weapons(menu)?.[2] === '' && menu.selectedId === null);
    checks.removed = removed.matched && weapons(removed.menu)?.[0] === SCAR && weapons(removed.menu)?.[1] === PUMP &&
      removed.menu.queuedRequests === 0;
    await screenshot('loadout-drag-end');
    await page.mouse.click(...at.armorTab);
    checks.armorTab = (await until(context, 'armor-tab', menu =>
      ready(menu, 1) && menu.inventoryCategory === 1)).matched;
    checks.armorIconsAlive = iconsAlive(await preview(context, 'armor-cards'));
    await screenshot('loadout-armor');
    return verdict(checks);
  },
};
