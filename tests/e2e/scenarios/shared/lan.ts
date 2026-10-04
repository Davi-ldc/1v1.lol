import { poll, type ScenarioContext } from '../index';
import { goToLobby, press, ready, until } from './menu';

/** CSS pixels of the lobby's party UI and the end screen (1280×760 probe viewport), seen in lan runs. */
export const lobby = { partySlot: [772, 356], createParty: [447, 268], partyId: [447, 415], joinWithCode: [447, 523],
  mode: [810, 688], continue: [640, 678] } as const;

type Player = { key: string; mine: boolean; position?: number[]; health?: number; armor?: number; dead?: boolean };

/** observe('match') reduced to what two-player checks read; players keyed by Photon actor. */
export const brief = (match: any) => ({ scene: match.scene?.name, mode: match.mode, started: match.game?.hasStarted,
  state: match.game?.state, result: match.game?.result,
  players: Object.entries(match.players ?? {}).filter(([key]) => key !== 'status').map(([key, p]: [string, any]) =>
    ({ key, mine: p.mine, position: p.position?.map((v: number) => Math.round(v * 10) / 10), health: p.health,
      armor: p.armor, dead: p.dead })) as Player[] });
export type Brief = ReturnType<typeof brief>;

export const self = (view: Brief) => view.players.find(player => player.mine);
export const other = (view: Brief) => view.players.find(player => !player.mine);
export const distance = (p?: number[], q?: number[]) =>
  p && q ? Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!) : Infinity;

/** Samples both players' match views under one label. */
export async function both(a: ScenarioContext, b: ScenarioContext, label: string) {
  const views = (await Promise.all([a.observe('match'), b.observe('match')])).map(brief);
  a.sample(label, views[0]);
  b.sample(label, views[1]);
  return views as [Brief, Brief];
}

/** Polls until each client sees the other within 0.5 m of where that player is (remote interpolation), up to 5 s. */
export async function synced(a: ScenarioContext, b: ScenarioContext) {
  const agree = ([seenByA, seenByB]: [Brief, Brief]) =>
    distance(self(seenByA)?.position, other(seenByB)?.position) < 0.5 &&
    distance(self(seenByB)?.position, other(seenByA)?.position) < 0.5;
  const deadline = performance.now() + 5000;
  let views = await both(a, b, 'sync');
  while (!agree(views) && performance.now() < deadline) {
    await a.wait(250);
    views = await both(a, b, 'sync');
  }
  return { views, synced: agree(views) };
}

export const screenshots = (a: ScenarioContext, b: ScenarioContext, name: string) =>
  Promise.all([a.screenshot(name), b.screenshot(name)]);

export async function walk(player: ScenarioContext, milliseconds: number) {
  await player.page.keyboard.down('w');
  try { await player.wait(milliseconds); } finally { await player.page.keyboard.up('w'); }
}

const playerId = (context: ScenarioContext) =>
  context.page.evaluate(() => (window as any).local.adapters.serverUser?.profileId as string | undefined);

/**
 * Original party flow: both players reach the lobby; A opens Party Up (the "+" slot) and creates a party; B opens it,
 * types the party code and joins with it.
 */
export async function formParty(a: ScenarioContext, b: ScenarioContext) {
  const [readyA, readyB] = await Promise.all([until(a, 'start', ready, 20000), until(b, 'start', ready, 20000)]);
  const [lobbyA, lobbyB] = await Promise.all([goToLobby(a), goToLobby(b)]);
  a.sample('ids', { a: await playerId(a), b: await playerId(b) });
  await press(a, lobby.partySlot);
  await a.wait(2000);
  await press(a, lobby.createParty);
  const created = await poll(a, 'party-created', () => a.observe('party'), party => !!party.roomName, 20000);
  const code = created.value.roomName as string | undefined;
  await press(b, lobby.partySlot);
  await b.wait(2000);
  await press(b, lobby.partyId);
  await b.page.keyboard.type(code ?? '', { delay: 80 });
  await press(b, lobby.joinWithCode);
  const joined = await poll(b, 'party-joined', () => b.observe('party'), party => !!code && party.roomName === code,
    20000);
  await b.wait(2000);
  await screenshots(a, b, 'party');
  const checks: Record<string, boolean> = { loadoutA: readyA.matched, loadoutB: readyB.matched, lobbyA, lobbyB,
    created: created.matched && /^\d$/.test(code ?? ''), joined: joined.matched };
  return { code, checks };
}

const yaw = ([x, , z]: number[]) => Math.atan2(x!, z!) * 180 / Math.PI;
const pitch = ([x, y, z]: number[]) => Math.asin(y! / Math.hypot(x!, y!, z!)) * 180 / Math.PI;
const turn = (degrees: number) => ((degrees % 360) + 540) % 360 - 180;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * Points the player's camera (the crosshair) at a world point through relative mouse motion, the way a player turns,
 * in correction passes of at most 1500 px. The mouse turns the camera 0.1695 degrees per pixel on both axes
 * (docs/reference/controls.md); a pitch that moves away is taken as the opposite sign (readings lag under load).
 * Needs the pointer lock, under which the cursor may pass the viewport and the camera keeps turning (x 640→3000 turns
 * 217°). `mouse` is where the cursor rests (updated).
 */
export async function aim(player: ScenarioContext, target: number[], mouse: [number, number]) {
  const camera = async () => (await player.observe('match')).camera as { position: number[]; forward: number[] };
  const move = async (dx: number, dy: number) => {
    [mouse[0], mouse[1]] = [mouse[0] + dx, mouse[1] + dy];
    await player.page.mouse.move(mouse[0], mouse[1], { steps: Math.max(1, Math.ceil(Math.hypot(dx, dy) / 40)) });
    await player.wait(400);
  };
  const gain = [0.1695, -0.1695];
  let view = await camera(), error = [180, 90];
  for (let pass = 0; pass < 10; pass++) {
    const to = target.map((value, index) => value - view.position[index]!);
    const next = [turn(yaw(to) - yaw(view.forward)), pitch(to) - pitch(view.forward)];
    if (pass && Math.abs(next[1]!) > Math.abs(error[1]!) + 1) gain[1] = -gain[1]!;
    error = next;
    if (Math.abs(error[0]!) < 0.4 && Math.abs(error[1]!) < 0.4) break;
    await move(clamp(error[0]! / gain[0]!, -1500, 1500), clamp(error[1]! / gain[1]!, -1500, 1500));
    view = await camera();
  }
  player.sample('aim', { target, gain, error, mouse: [...mouse] });
  return error;
}

/**
 * The shooter equips slot 1 (assault rifle), clicks once (the game takes the pointer lock), aims at the victim's chest
 * as the shooter sees it and fires bursts until the victim's own client no longer has a live local player; re-aims
 * between bursts.
 */
export async function shootDown(shooter: ScenarioContext, victim: ScenarioContext, mouse: [number, number]) {
  await shooter.page.keyboard.press('1');
  await shooter.wait(800);
  await shooter.page.mouse.down();
  await shooter.page.mouse.up();
  await shooter.wait(300);
  for (let burst = 0; burst < 12; burst++) {
    const [seen, own] = await both(shooter, victim, `burst-${burst}`);
    const target = other(seen), mine = self(own);
    if (!mine || mine.dead) return true;
    if (!target?.position) return false;
    await aim(shooter, [target.position[0]!, target.position[1]! + 1.2, target.position[2]!], mouse);
    await shooter.page.mouse.down();
    try { await shooter.wait(1200); } finally { await shooter.page.mouse.up(); }
    await shooter.wait(300);
  }
  const mine = self((await both(shooter, victim, 'burst-end'))[1]);
  return !mine || mine.dead === true;
}

/** Waits until both players are in a started match of `mode` on `scene`, sampling every 2 s. */
export async function startedMatch(a: ScenarioContext, b: ScenarioContext, mode: string, scene: string) {
  const started = (view: Brief) => view.mode === mode && view.scene === scene && view.started === true &&
    !!self(view);
  let views = await both(a, b, 'match-0');
  for (let second = 2; second <= 90 && !views.every(started); second += 2) {
    await a.wait(2000);
    views = await both(a, b, `match-${second}`);
  }
  await screenshots(a, b, 'started');
  return { views, started: views.every(started) };
}
