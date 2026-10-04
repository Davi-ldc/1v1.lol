import { poll, verdict, type Scenario, type ScenarioContext } from '../../tests/e2e/scenarios/index';
import { aim, both, brief, distance, lobby, other, screenshots, self, startedMatch }
  from '../../tests/e2e/scenarios/shared/lan';
import { at, press } from '../../tests/e2e/scenarios/shared/menu';
import { equipElastic, healthOf, heroDuel, me, places, same, wallAhead } from './common';

/** Whether `place` is gone (`gone`) or still standing on both clients within `ms`. */
const standing = async (a: ScenarioContext, b: ScenarioContext, place: number[] | undefined, label: string,
  gone: boolean, ms = 3000) => {
  const [onA, onB] = await Promise.all([a, b].map(player => poll(player, `${label}-${player === a ? 'a' : 'b'}`,
    () => places(player), list => list.some(same(place)) !== gone, ms)));
  return !!place && onA!.matched && onB!.matched;
};
/** B's own health plus armor (-1 dead or gone), sampled on both clients. */
const health = async (a: ScenarioContext, b: ScenarioContext, label: string) => {
  const own = self((await both(a, b, label))[1]);
  return !own || own.dead ? -1 : (own.health ?? 0) + (own.armor ?? 0);
};
const own = async (player: ScenarioContext) => self(brief(await player.observe('match')))?.position ?? [0, 0, 0];

/** `player` builds a wall on the grid edge ahead of `from` along `dir` (aimed there, Z, click), back to the pickaxe. */
async function wall(player: ScenarioContext, mouse: [number, number], from: number[], dir: number[], label: string) {
  const built = await wallAhead(player, mouse, from, dir, label);
  await player.page.keyboard.press('f');
  return built;
}

/** Both take the pointer lock holding the pickaxe (the 1v1 starts on the wall piece: a click would build). */
async function arm(a: ScenarioContext, b: ScenarioContext) {
  await a.page.keyboard.press('f');
  await b.page.keyboard.press('f');
  await a.wait(500);
  await a.page.mouse.click(...at.center);
  await b.page.mouse.click(...at.center);
  await a.wait(1500);
}

/** After B's death: both result screens, Continue back to the party `code`, the leader's PLAY, the next 1v1 started. */
async function rematch(a: ScenarioContext, b: ScenarioContext, code: string | undefined, label: string) {
  const ended = (view: any) => !!view.game?.result?.winners;
  await Promise.all([poll(a, `${label}-end`, () => a.observe('match'), ended, 30000),
    poll(b, `${label}-end`, () => b.observe('match'), ended, 30000)]);
  await Promise.all([press(a, lobby.continue), press(b, lobby.continue)]);
  const inParty = (party: any) => party.roomName === code && party.photonRoom === code;
  const back = await Promise.all([poll(a, `${label}-back`, () => a.observe('party'), inParty, 30000),
    poll(b, `${label}-back`, () => b.observe('party'), inParty, 30000)]);
  await b.wait(3000);
  await press(a, at.play);
  const match = await startedMatch(a, b, '1v1', 'NormalMap');
  if (match.started) await arm(a, b);
  return back.every(item => item.matched) && match.started;
}

/**
 * Turns `player`'s camera by `degrees` of yaw in one relative mouse motion (0.1695°/px, adapters' aim), in four steps:
 * at 40 px a step, the 180° turn takes 1.8 s on a software-rendered page and the next Q comes after the cycle's 1.5 s
 * reset.
 */
async function turnBy(player: ScenarioContext, mouse: [number, number], degrees: number) {
  mouse[0] += Math.round(degrees / 0.1695);
  await player.page.mouse.move(mouse[0], mouse[1], { steps: 4 });
  await player.wait(150);
}

/**
 * Until A's last slap is past its impact and the ability's Cooldown (0.35 s of game time, as `elastic` reports t); a
 * loaded page drops a Q pressed within it.
 */
const settled = (a: ScenarioContext) => poll(a, 'q-ready', () => a.observe('elastic'),
  view => !view.slaps?.some((item: any) => item.mine && item.t < 0.45), 3000);
/** A's next Q once settled; whether slap `index` (left, right, clap) started. */
async function slapQ(a: ScenarioContext, index: number) {
  await settled(a);
  await a.page.keyboard.press('q', { delay: 60 });
  return (await poll(a, `q-${index}`, () => a.observe('elastic'),
    view => !!view.slaps?.some((item: any) => item.mine && item.index === index), 1500)).matched;
}

/**
 * A's left slap facing away (no enemy within 70°: it misses; landed before A turns back, so it picks no one), then,
 * turned back to B within the cycle's 1.5 s, the right one.
 */
async function awayThenRight(a: ScenarioContext, mouse: [number, number]) {
  await turnBy(a, mouse, 180);
  await a.wait(600);
  const left = await slapQ(a, 0);
  await settled(a);
  await turnBy(a, mouse, -180);
  return left && await slapQ(a, 1);
}

/**
 * A's clap from where it stands, aimed at B: the left and right slaps facing away (no enemy within 70° and nothing
 * behind: without a target a hand reaches 2.3 m straight ahead and grazes builds within 0.9 m, which would spend a
 * wall in front of A), then turned back for the clap within the cycle's 1.5 s.
 */
async function clap(a: ScenarioContext, mouse: [number, number]) {
  await turnBy(a, mouse, 180);
  await a.wait(600);
  const slaps = await slapQ(a, 0) && await slapQ(a, 1);
  await settled(a);
  await turnBy(a, mouse, -180);
  return slaps && await slapQ(a, 2);
}

// The elastic hero's Q over the network (elastic/slap.ts, elastic/projectile.ts): a slap or projectile that hits B is
// lethal, so it ends a 1v1 and the next starts through the original Continue → party → PLAY. Match 1: A slaps a wall it
// built beside itself twice (seen by B, gone on both); from a few metres its left slap facing away misses, and turned
// back its right slap kills B. Match 2: pressed against B, the left slap kills B. Match 3: A builds a wall ahead, steps
// back a grid cell and builds another; B builds one toward A and one behind itself. The first projectile breaks A's two
// walls and ends at the second (B unhurt); the second breaks B's front wall, kills B (B's own client applies the
// knock) and ends at B's back wall, broken.
export const elasticslaplan: Scenario = {
  entry: 'menu',
  players: 2,
  heroes: ['elastic'],
  async run(a, b) {
    const party = await heroDuel(a, b!, equipElastic);
    if (party.reason) return verdict(party.checks, party.reason);
    const checks = party.checks;
    await arm(a, b!);
    const bId = (await me(b!))?.id;
    const strikes = async () => ((await a.observe('elastic')).strikes ?? []) as any[];
    const near = async () => { const [seen] = await both(a, b!, 'approach');
      return distance(self(seen)?.position, other(seen)?.position); };
    // Short steps, each left to settle: on a loaded page a 60 ms tap moves A for a whole slow frame, and A can go
    // on 2–3 m after the last one.
    const tap = async (key: string) => {
      await a.page.keyboard.down(key);
      await a.wait(60);
      await a.page.keyboard.up(key);
      await a.wait(500);
    };
    const facing = async (mouse: [number, number]) => {
      const seen = other((await both(a, b!, 'target'))[0])?.position;
      if (seen) await aim(a, [seen[0]!, seen[1]! + 1.2, seen[2]!], mouse);
    };

    // Match 1. A slaps a wall it builds beside itself twice: 75 each (the pickaxe's per hit), seen on both clients.
    let [startA, startB] = await both(a, b!, 'start');
    let posA = self(startA)!.position!, posB = self(startB)!.position!;
    const toward = (from: number[], to: number[]) => {
      const flat = [to[0]! - from[0]!, to[2]! - from[2]!], length = Math.hypot(flat[0]!, flat[1]!) || 1;
      return [flat[0]! / length, flat[1]! / length];
    };
    let dir = toward(posA, posB);
    const mouseA: [number, number] = [640, 380], mouseB: [number, number] = [640, 380];
    const wallA = await wall(a, mouseA, posA, [-dir[1]!, dir[0]!], 'walled-a');
    checks.walledA = !!wallA;
    await a.wait(4000); // A new build regains its health first (Building.InitialHealthRegenCoroutine).
    await a.page.keyboard.press('q', { delay: 60 });
    checks.wallHitSeen = (await poll(b!, 'wall-hit-b', () => healthOf(b!, wallA), value => value === 75, 2500)).matched;
    await a.wait(300);
    await a.page.keyboard.press('q', { delay: 60 });
    checks.wallBroken = await standing(a, b!, wallA, 'wall-broken', true, 2500);
    await a.wait(1700); // The next Q starts the cycle over with the left hand.
    // A walks up to 3.6–5 m of B, aimed at B's chest: the elastic arm reaches B from there.
    await facing(mouseA);
    let far = await near();
    for (let step = 0; step < 40 && far > 4.8; step++) { await tap('w'); far = await near(); }
    for (let step = 0; step < 10 && far < 3.6; step++) { await tap('s'); far = await near(); }
    a.sample('far', far);
    await facing(mouseA);
    const full = await health(a, b!, 'health-0');
    checks.fullHealth = full === 200;
    checks.farPresses = await awayThenRight(a, mouseA);
    await a.page.evaluate(() => { const end = performance.now() + 700; while (performance.now() < end); });
    await a.screenshot('slap-far'); // The original hit marker and floating damage on A's screen.
    const farDead = (await poll(b!, 'slap-far', () => health(a, b!, 'health-far'), value => value === -1, 3000))
      .matched;
    const recent = (await strikes()).slice(-2);
    const leftFar = recent.find(item => item.index === 0), rightFar = recent.find(item => item.index === 1);
    a.sample('far-strikes', { leftFar, rightFar });
    // The left slap faced away: no target, no player struck. The right one picked B at 3.6–5 m and killed it; it landed
    // on the first frame after the stall, none of its frames inside its impact-to-end window (0.27–0.64 s).
    checks.leftMissed = leftFar?.target === -1 && !leftFar?.players?.length;
    checks.slapRight = farDead && rightFar?.d > 3.6 && rightFar?.d < 5 && !!rightFar?.players?.includes(bId);
    checks.rightLate = rightFar?.t >= 0.64 && !rightFar.frames.some((t: number) => t >= 0.27 && t < 0.64);

    // Match 2. The left slap, pressed against B, where a loaded page's late key-up can leave A (0.7–0.8 m from B) and
    // B's copy on A's client jumps.
    checks.match2 = await rematch(a, b!, party.code, 'match-2');
    if (!checks.match2) return verdict(checks, 'The second 1v1 did not start.');
    await facing(mouseA);
    let close = await near();
    for (let step = 0; step < 40 && close > 0.85; step++) { await tap('w'); close = await near(); }
    a.sample('close', close);
    checks.close = close < 1.2;
    await facing(mouseA);
    checks.closeFull = await health(a, b!, 'health-close') === 200;
    checks.closePress = await slapQ(a, 0);
    const closeDead = (await poll(b!, 'slap-close', () => health(a, b!, 'health-close-hit'), value => value === -1,
      3000)).matched;
    const leftClose = (await strikes()).slice(-1).find(item => item.index === 0);
    a.sample('close-strike', leftClose);
    checks.slapLeft = closeDead && !!leftClose?.players?.includes(bId);
    await screenshots(a, b!, 'slap-close');

    // Match 3. Walls on the line from A to B: A's ahead of A (W1), then, a grid cell back, A's next one (W0); B's
    // toward A (front) and behind itself (back).
    checks.match3 = await rematch(a, b!, party.code, 'match-3');
    if (!checks.match3) return verdict(checks, 'The third 1v1 did not start.');
    [startA, startB] = await both(a, b!, 'start-3');
    posA = self(startA)!.position!;
    posB = self(startB)!.position!;
    dir = toward(posA, posB);
    const back = [-dir[0]!, -dir[1]!];
    const front = await wall(b!, mouseB, posB, back, 'wall-front');
    const behind = await wall(b!, mouseB, posB, dir, 'wall-back');
    const w1 = await wall(a, mouseA, posA, dir, 'wall-1');
    // A steps back (facing B) until W1 is 6.5 m ahead, so the next grid edge ahead is free for W0.
    const ahead = (from: number[], place?: number[]) =>
      place ? (place[0]! - from[0]!) * dir[0]! + (place[2]! - from[2]!) * dir[1]! : NaN;
    await aim(a, [posB[0]!, posA[1]! + 1.5, posB[2]!], mouseA);
    let here = await own(a);
    for (let step = 0; step < 30 && ahead(here, w1) < 6.5; step++) { await tap('s'); here = await own(a); }
    a.sample('stepped-back', { here, w1: ahead(here, w1) });
    const w0 = await wall(a, mouseA, here, dir, 'wall-0');
    const lined = [w0, w1, front, behind].map(place => ahead(here, place));
    a.sample('walls', { w0, w1, front, behind, ahead: lined });
    checks.walls = lined.every(value => !Number.isNaN(value)) && lined[0]! + 3 < lined[1]! && lined[1]! + 3 < lined[2]!;
    await a.wait(4000);
    // Each client's flights that ended: seconds flown and stop (m from the spawn point, SPAWN 1.9 m ahead of A's
    // center), which must sit at the second wall, the flight gone right after (not at RANGE's 3.2 s).
    const ended = async (player: ScenarioContext) => ((await player.observe('elastic')).ended ?? []) as
      { t: number; stop?: number }[];
    // A new ended flight on each client since `counts` (two throws: under the log's 16), stopped at `place`.
    const endedAt = async (label: string, counts: number[], place?: number[]) => {
      const views = await Promise.all([a, b!].map((player, k) => poll(player, label, () => ended(player),
        list => list.length > counts[k]!, 4000)));
      const last = views.map(view => view.value.at(-1));
      a.sample(label, last);
      return last.every(item => item?.stop !== undefined && Math.abs(item.stop - (ahead(here, place) - 1.9)) < 1 &&
        item.t < item.stop / 25 + 0.25 + 1); // Removed on its first frame past stop/SPEED + SHRINK (a slow page's).
    };
    const counts = async () => (await Promise.all([ended(a), ended(b!)])).map(list => list.length);
    const before = await counts();
    // Throw 1: W0 and W1 broken, the flight ends at W1 on both clients, B's front wall stands and B is unhurt.
    await facing(mouseA);
    checks.clap1 = await clap(a, mouseA);
    checks.firstBroken = await standing(a, b!, w0, 'w0-gone', true);
    checks.secondBroken = await standing(a, b!, w1, 'w1-gone', true);
    checks.endsAtSecond = await endedAt('ended-1', before, w1);
    await a.wait(1500);
    checks.thirdStands = await standing(a, b!, front, 'front-stands', false, 1000);
    checks.unhurt = await health(a, b!, 'health-throw-1') === 200;
    const between = await counts();
    await screenshots(a, b!, 'throw-1');
    // Throw 2: B's front wall broken, B killed with the knock on its own client, the flight ends at B's back wall.
    await a.wait(1700);
    await facing(mouseA);
    checks.clap2 = await clap(a, mouseA);
    checks.seen = (await poll(b!, 'projectile-seen', () => b!.observe('elastic'), view => !!view.projectiles?.length,
      2500)).matched;
    await screenshots(a, b!, 'projectile');
    checks.projectile = (await poll(b!, 'projectile-hit', () => health(a, b!, 'health-3'), value => value === -1, 3000))
      .matched;
    checks.frontBroken = await standing(a, b!, front, 'front-gone', true);
    checks.backBroken = await standing(a, b!, behind, 'back-gone', true);
    checks.endsAtBack = await endedAt('ended-2', between, behind);
    // The knock for B reaches B's own client (800 away, 480 up). The 600 has killed B first,
    // so whether it is applied and moves the body is sampled, not required.
    const knocks = ((await b!.observe('elastic')).knocks ?? []) as { victim: number; impulse: number[] }[];
    b!.sample('knocks', knocks);
    const knock = knocks.findLast(item => item.victim === bId);
    checks.knocked = !!knock && Math.abs(Math.hypot(knock.impulse[0]!, knock.impulse[2]!) - 800) < 1 &&
      Math.abs(knock.impulse[1]! - 480) < 1;
    await screenshots(a, b!, 'after');
    return verdict(checks);
  },
};
