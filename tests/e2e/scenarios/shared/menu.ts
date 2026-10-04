import { poll, type ScenarioContext } from '../index';

/** CSS pixels of the 1280×760 probe viewport, observed in probe runs; not a recovered layout rule. */
export const at = {
  center: [640, 360], home: [1183, 60], play: [1085, 675], championsTab: [398, 695],
  firstCard: [875, 250], popupEquip: [393, 557], armorTab: [1132, 148], weaponSlot3: [195, 578],
  skinBrush: [625, 425], defaultSkin: [140, 620], firstSkin: [326, 620], popupClose: [1220, 60],
} as const;

/** Center of the i-th inventory card: 3 columns 160 px apart, rows 175 px apart, starting at firstCard. */
export const cardAt = (index: number) =>
  [at.firstCard[0] + 160 * (index % 3), at.firstCard[1] + 175 * Math.floor(index / 3)] as const;

/** First of the nine visible inventory cards whose product is not in `equipped` (the order follows item levels). */
export async function unequippedCard(context: ScenarioContext, equipped: readonly (string | null)[]) {
  const entries: any[] = (await context.observe('presentation')).cards?.entries ?? [];
  const card = entries.find(entry => entry.index < 9 && entry.id && !equipped.includes(entry.id));
  return card ? { id: card.id as string, point: cardAt(card.index) } : null;
}

export const weapons = (menu: any): (string | null)[] | undefined => menu.equipment?.weapons;
export const armors = (menu: any): (string | null)[] | undefined => menu.equipment?.armor;

/** Original Loadout screen (ScreenName 15) active, idle and reading the installed ServerUser's equipment. */
export const ready = (menu: any, category = 0) => menu.status === 'observed' && menu.screen === 15 && menu.active &&
  menu.loaderActive === false && menu.category === category && !menu.requestInProgress &&
  menu.equipment?.state === 'observed';

/** Polls the menu observer until `predicate` holds. */
export async function until(context: ScenarioContext, label: string, predicate: (menu: any) => boolean, budget = 5000) {
  const { value: menu, matched } = await poll(context, label, () => context.observe('menu'), predicate, budget);
  return { matched, menu };
}

/** Waits for the popup's own loader (f114840 resumes after the awaited graphic), then samples twice. */
export async function preview({ observe, sample, wait }: ScenarioContext, label: string) {
  const opened = performance.now();
  let view = await observe('presentation');
  while (view.preview?.loaderActive &&
    performance.now() - opened < 45000) { await wait(250); view = await observe('presentation'); }
  sample(`${label}-loaded`, { ms: Math.round(performance.now() - opened), ...view });
  await wait(1000);
  view = await observe('presentation');
  sample(`${label}-settled`, view);
  return view;
}

export const previewAlive = (view: any) => view.preview?.mesh?.alive === true && !!view.preview.materials?.length &&
  view.preview.materials.every((material: any) => material.alive);

export const iconsAlive = (view: any) => !!view.cards?.entries?.length &&
  view.cards.entries.every((card: any) => card.sprite?.alive && card.texture?.alive);

/** A human press: move in steps, optionally hover, then press and release in a later frame. */
export async function press({ page, wait }: ScenarioContext, [x, y]: readonly [number, number], hover = 0) {
  await page.mouse.move(x, y, { steps: 6 });
  if (hover) await wait(hover);
  await page.mouse.down();
  await wait(150);
  await page.mouse.up();
}

/** Home button → Lobby (ScreenName 0), then the 3 s the lobby takes to settle. In the lobby that spot is Settings. */
export async function goToLobby(context: ScenarioContext) {
  if ((await context.observe('menu')).screen !== 0) await context.page.mouse.click(...at.home);
  const { matched } = await until(context, 'lobby', menu => menu.status === 'observed' && menu.screen === 0, 8000);
  await context.wait(3000);
  return matched;
}
