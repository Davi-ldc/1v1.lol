import { PASSWORD_FILE, passwordKey } from '../page/beam/password';
import { heroFile, type HeroId } from '../page/ids';
import { poll, type ScenarioContext } from '../../tests/e2e/scenarios/index';
import { aim, formParty, startedMatch } from '../../tests/e2e/scenarios/shared/lan';
import { at, goToLobby, press, ready, until } from '../../tests/e2e/scenarios/shared/menu';

/** The overview's select button, where an equipped hero shows SELECTED. */
const SELECT = [545, 546] as const;

/** Whether the host serves `hero`'s optional `file` (the page config lists each hero's files). */
export const serves = (context: ScenarioContext, hero: HeroId, file: string) => context.page.evaluate(
  ([hero, file]) => !!(window as any).local.config.heroes?.[hero]?.files.includes(file), [hero, file] as const);
/** `hero`'s champion ID (names.json, from the page config). */
export const championOf = (context: ScenarioContext, hero: HeroId) => context.page.evaluate(
  hero => (window as any).local.config.heroes[hero].champion as string, hero);

/** A champion's active card on the active selection screen: CSS point, art name and the screen's card count. */
async function championCard(context: ScenarioContext, id: string) {
  const view = await context.observe('championCards');
  const screen = view.screens?.find((screen: any) => screen.active);
  const card = screen?.cards.find((card: any) => card.id === id && card.active);
  context.sample('cards', view);
  return card ? { point: [Math.round(card.screen[0]), Math.round(760 - card.screen[1])] as const,
    icon: card.icon as string | null, cards: screen.cards.length as number } : null;
}

/**
 * From the lobby: own character → overview (33) → CHAMPIONS (34) → `id`'s card (scrolled into the grid) → its
 * overview → SELECT, which equips it and returns to the lobby. `shots`: screenshots of the card and the overview;
 * `inspect` runs on the overview, before SELECT.
 */
export async function pickHero(context: ScenarioContext, id: string,
  { shots = false, inspect }: { shots?: boolean; inspect?: () => Promise<void> } = {}) {
  const { page, wait, screenshot } = context;
  await press(context, at.center, 300);
  const overview = (await until(context, `overview-${id}`, menu => menu.screen === 33, 8000)).matched;
  await page.mouse.click(...at.championsTab);
  const selection = (await until(context, `selection-${id}`, menu => menu.screen === 34, 8000)).matched;
  await wait(2000);
  let card = await championCard(context, id);
  const outside = () => !!card && (card.point[1] < 120 || card.point[1] > 600);
  for (let step = 0; step < 12 && outside(); step++) {
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, card!.point[1] > 600 ? 240 : -240);
    await wait(600);
    card = await championCard(context, id);
  }
  if (shots) await screenshot('card');
  if (!card || outside()) return { overview, selection, card: null, equipped: false };
  await press(context, card.point);
  await wait(3000);
  if (shots) await screenshot('overview');
  await inspect?.();
  await press(context, SELECT);
  const equipped = (await until(context, `equipped-${id}`, menu =>
    menu.equipment?.champion === id && menu.screen === 0, 8000)).matched;
  return { overview, selection, card, equipped };
}

/**
 * From the Loadout: the beam hero equipped through CHAMPIONS (pickHero), this browser having given his password when
 * his directory has one. `art`: his card shows the scan's portrait (sprite "beam") with `hero_card.png`, else
 * Poseidon's.
 */
export async function equipBeam(context: ScenarioContext) {
  const { page } = context;
  const checks: Record<string, boolean> = {};
  checks.ready = (await until(context, 'start', menu => ready(menu), 20000)).matched;
  const champion = await championOf(context, 'beam');
  await page.evaluate(async ([key, url]) => {
    const response = await fetch(url!);
    if (response.ok) localStorage.setItem(key!, (await response.json() as { sha256: string }).sha256);
  }, [passwordKey(champion), heroFile('beam', PASSWORD_FILE)]);
  checks.lobby = await goToLobby(context);
  const picked = await pickHero(context, champion, { shots: true });
  const portrait = await serves(context, 'beam', 'hero_card.png');
  return Object.assign(checks, { overview: picked.overview, selection: picked.selection, card: !!picked.card,
    art: !!picked.card?.icon && (picked.card.icon === 'beam') === portrait, equipped: picked.equipped });
}

/** From the Loadout: the elastic hero equipped through CHAMPIONS (pickHero). */
export async function equipElastic(context: ScenarioContext) {
  const checks: Record<string, boolean> = {};
  checks.ready = (await until(context, 'start', menu => ready(menu), 20000)).matched;
  checks.lobby = await goToLobby(context);
  const picked = await pickHero(context, await championOf(context, 'elastic'));
  return Object.assign(checks, { overview: picked.overview, selection: picked.selection, card: !!picked.card,
    equipped: picked.equipped });
}

/** Presses Play and waits for the started match (abilities need it), then lets the game take the pointer lock. */
export async function startedHero(context: ScenarioContext) {
  const { page, observe, wait } = context;
  await press(context, at.play);
  for (let tick = 0; tick < 180; tick++) {
    await wait(500);
    if ((await observe('match')).game?.hasStarted) break;
  }
  await page.mouse.click(...at.center);
  await wait(500);
  return (await observe('match')).game?.hasStarted === true;
}

/**
 * The LAN opening of a hero scenario: A equips its hero (`equip`), forms the party with B and presses PLAY (`moved`
 * runs right after, while the match loads); both reach the 1v1 on NormalMap. Returns the checks, the party code and,
 * when it stopped early, why.
 */
export async function heroDuel(a: ScenarioContext, b: ScenarioContext,
  equip: (context: ScenarioContext) => Promise<Record<string, boolean>>, moved?: () => Promise<void>) {
  const picked = await equip(a);
  if (!picked.equipped) return { checks: picked, reason: 'A did not equip the hero.' };
  const party = await formParty(a, b);
  const { loadoutA: _, ...formed } = party.checks; // A starts in the lobby: `equip` checked its Loadout.
  const checks: Record<string, boolean> = { ...picked, ...formed };
  if (!checks.joined) return { checks, reason: 'The party was not formed.' };
  await press(a, at.play);
  await moved?.();
  const match = await startedMatch(a, b, '1v1', 'NormalMap');
  checks.started = match.started;
  return { checks, code: party.code, reason: match.started ? undefined : 'The 1v1 did not start on both clients.' };
}

/** The local player's hero state from observe('heroes'). */
export const me = async (context: ScenarioContext) =>
  (await context.observe('heroes')).managers?.find((manager: any) => manager.player?.mine)?.player;
/** The other player's hero state as `viewer` sees it. */
export const remote = async (viewer: ScenarioContext) => (await viewer.observe('heroes')).managers
  ?.find((manager: any) => manager.player && !manager.player.mine)?.player;
/** A beam player as `context` sees it: its own (`mine`) or the other's. */
export const beamOf = async (context: ScenarioContext, mine: boolean) => (await context.observe('heroes')).managers
  ?.find((manager: any) => manager.player?.mine === mine && manager.player.hero === 'beam')?.player;
/** The local player's height from observe('match'). */
export const height = async (context: ScenarioContext) =>
  (await context.observe('match')).player?.position?.[1] as number;

/** The beam hero's Sentinel barriers that show (`mine`: the local player's). */
export const shields = (view: any, mine: boolean) => (view.barriers ?? []).filter((barrier: any) =>
  barrier.mine === mine && barrier.shown);
/**
 * All 28 on a sphere 5 m around the hero's center, below to above, with one timestamp: they end together (the synced
 * timestamp + Duration of <PerformAbility>d__30).
 */
export const sphere = (view: any, mine: boolean) => {
  const own = shields(view, mine), heights = own.map((barrier: any) => barrier.height as number);
  return own.length === 28 && own.every((barrier: any) => Math.abs(barrier.distance - 5) < 1) &&
    Math.min(...heights) < -4 && Math.max(...heights) > 4 &&
    new Set(own.map((barrier: any) => barrier.timestamp)).size === 1;
};

/** A PlayerSkinManager showing the beam hero's scan: his skin, its mesh ("beam") and Poseidon's rigid face hidden. */
export const beamLook = (manager: any) => manager?.hero === 'beam' && manager.mesh === 'beam' && manager.rigid === 0;
/**
 * A PlayerSkinManager showing the elastic hero's scan: his skin, its mesh ("elastic"), Poseidon's face hidden and the
 * SAMURAI pack's controller (ShadowMenu without a player, ShadowAnimator in the match).
 */
export const elasticLook = (manager: any) => manager?.hero === 'elastic' && manager.mesh === 'elastic' &&
  manager.rigid === 0 && manager.controller === (manager.player ? 'ShadowAnimator' : 'ShadowMenu');

export type Shape = { arms: number; legs: number; thin: number; body: number; head: number };
/** The served elastic hero mesh's shaped skeleton and its shape factors (`skeleton`, `source.shape`), or nulls. */
export const served = (context: ScenarioContext) => context.page.evaluate(url => fetch(url)
  .then(response => response.json()).then(mesh => ({
    skeleton: (mesh.skeleton ?? null) as Record<string, number[]> | null,
    shape: (mesh.source?.shape ?? null) as Shape | null })), heroFile('elastic', 'hero.mesh.json'));
/** The pack's limb capsules (on a thigh, shin, upper arm or forearm bone) by name, from a manager's `colliders`. */
export const limbs = (manager: any): Record<string, number> => Object.fromEntries((manager?.colliders ?? [])
  .filter((item: any[]) => item[2] !== null && /^(UpperLeg|LowerLeg|Shoulder|Elbow|Hand)_[LR]$/.test(item[0]))
  .map((item: any[]) => [item[0], item[2]]));

/** Space held long enough for a frame to read it down: one jump, or two 350 ms apart. */
export const jump = (context: ScenarioContext) => context.page.keyboard.press('Space', { delay: 80 });
export const jumpTwice = async (context: ScenarioContext) => {
  await jump(context);
  await context.wait(350);
  await jump(context);
};
/**
 * A beam player (`mine` or the other) sampled while `act` plays and for `ms`: its top height over `ground`, its lowest
 * Head over Hips, whether it ended grounded there, and whether the takeoff HandleFalling keeps for the fall damage
 * stayed a real height (`kept`) or was cancelled (`cancelled`, below −1e8); `shot` names a screenshot of its first
 * upside-down sample.
 */
export async function flight(context: ScenarioContext, label: string, ground: number, act: () => Promise<void>,
  { ms = 2500, mine = true, shot }: { ms?: number; mine?: boolean; shot?: string } = {}) {
  const acting = act(), end = Date.now() + ms;
  const seen: { y: number; head: number; grounded: boolean; takeoff: number | null }[] = [];
  while (Date.now() < end) {
    const hero = await beamOf(context, mine);
    if (!hero) continue;
    seen.push({ y: hero.y - ground, head: hero.head, grounded: hero.grounded, takeoff: hero.takeoff });
    if (shot && hero.head < 0) { await context.screenshot(shot); shot = undefined; }
  }
  await acting;
  const last = seen.at(-1), takeoffs = seen.map(item => item.takeoff).filter(value => value !== null);
  const result = { top: Math.max(...seen.map(item => item.y)), head: Math.min(...seen.map(item => item.head)),
    landed: !!last?.grounded && Math.abs(last.y) < 0.5, samples: seen.length,
    kept: takeoffs.some(value => value > -1e3), cancelled: takeoffs.some(value => value < -1e8) };
  context.sample(label, { ...result, seen });
  return result;
}

/** Sets the review slow motion (heroes/shared/trace.ts): the heroes' poses run `factor` times slower; 1 to stop. */
export const slowMotion = (context: ScenarioContext, factor: number) =>
  context.page.evaluate(value => { (globalThis as { heroSlow?: number }).heroSlow = value; }, factor);

/** The builds `player` sees (observe('heroes') `places`, each [x, y, z]). */
export const places = async (player: ScenarioContext) => ((await player.observe('heroes')).places ?? []) as number[][];
/** Whether a place is `place` (within 10 cm). */
export const same = (place?: number[]) => (item: number[]) =>
  !!place && Math.hypot(...item.map((v, k) => v - place[k]!)) < 0.1;
/** The nearest build at wall height within 6 m of `from`, more than `margin` m beyond it along `dir` ([x, z]). */
export const beyond = (list: number[][], from: number[], dir: number[], margin = 0.5) => {
  const away = (place: number[]) => Math.hypot(place[0]! - from[0]!, place[2]! - from[2]!);
  return list.filter(place => Math.abs(place[1]! - from[1]! - 1.75) < 0.6 && away(place) < 6 &&
    (place[0]! - from[0]!) * dir[0]! + (place[2]! - from[2]!) * dir[1]! > margin).sort((p, q) => away(p) - away(q))[0];
};
/**
 * `player`'s wall on the grid edge ahead of `from` along `dir` (`beyond`): aimed there, built with Z and a click unless
 * one stands there already. The wall piece may stay in hand.
 */
export async function wallAhead(player: ScenarioContext, mouse: [number, number], from: number[], dir: number[],
  label: string, margin = 0.5) {
  await aim(player, [from[0]! + 10 * dir[0]!, from[1]! + 1.5, from[2]! + 10 * dir[1]!], mouse);
  if (!beyond(await places(player), from, dir, margin)) {
    await player.page.keyboard.press('z');
    await player.wait(400);
    await player.page.mouse.down();
    await player.page.mouse.up();
  }
  const built = await poll(player, label, () => places(player), list => !!beyond(list, from, dir, margin), 3000);
  return beyond(built.value, from, dir, margin);
}
/** The Health of the build at `place` as `player` sees it (null: gone). */
export async function healthOf(player: ScenarioContext, place?: number[]) {
  const view = await player.observe('heroes'), list = (view.places ?? []) as number[][];
  const index = place ? list.findIndex(same(place)) : -1;
  return index < 0 ? null : (view.healths as number[])[index]!;
}

/** Polls `player`'s PlayerSkinManagers until one matches, sampling under `label`. */
export const sees = (player: ScenarioContext, label: string, matches: (manager: any) => boolean, budget = 20000) =>
  poll(player, label, () => player.observe('heroes'), view => !!view.managers?.some(matches), budget);
