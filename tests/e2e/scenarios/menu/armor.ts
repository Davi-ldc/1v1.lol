import { verdict, type Scenario } from '../index';
import { armors, at, preview, previewAlive, ready, until } from '../shared/menu';

// Original flow: popup Equip → LoadoutItemPopup.EquipItem f43569 → OnEquipSelected f50669, which for
// EquipmentType.Armor calls OnEquipToSlotSelected(0): the armor replaces slot 0 without a slot click. Native
// UserEquipment.EquipItemToSlot f97468 writes Loadouts[EquippedLoadout].EquippedArmor[0] and recalculates stats.
// Fresh session: no earlier weapon drag (SlotPickedFrom -1).
export const armor: Scenario = {
  entry: 'menu',
  async run(context) {
    const { page, screenshot } = context;
    const checks: Record<string, boolean> = {};
    const start = await until(context, 'start', menu => ready(menu), 10000);
    if (!start.matched) return verdict({}, 'Loadout not ready.');
    await page.mouse.click(...at.armorTab);
    checks.armorTab = (await until(context, 'armor-tab', menu =>
      ready(menu, 1) && menu.inventoryCategory === 1)).matched;
    await page.mouse.click(...at.firstCard);
    const card = await until(context, 'card', menu =>
      typeof menu.lastViewedId === 'string' && menu.lastViewedId.startsWith('lol.1v1.armors.'));
    checks.card = card.matched;
    if (!card.matched) return verdict(checks);
    const chosen = card.menu.lastViewedId as string;
    checks.previewAlive = previewAlive(await preview(context, 'armor-popup'));
    await screenshot('armor-popup');
    await page.mouse.click(...at.popupEquip);
    const equipped = await until(context, 'equipped', menu => armors(menu)?.[0] === chosen && menu.selectedId === null);
    checks.equipped = equipped.matched && equipped.menu.queuedRequests === 0 && !equipped.menu.requestInProgress;
    await screenshot('armor-equipped');
    return verdict(checks);
  },
};
