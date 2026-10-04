import { poll, verdict, type Scenario, type ScenarioContext } from '../index';
import { both, screenshots } from '../shared/lan';
import { at, goToLobby, press, ready, until } from '../shared/menu';

/** The "Cancel" of the "Searching for players..." overlay (1280×760 probe viewport). */
const cancel = [433, 380] as const;

const room = (context: ScenarioContext, label: string, matches: (name: string | null) => boolean) =>
  poll(context, label, () => context.observe('party'), party => matches(party.photonRoom ?? null), 20000);

// Matchmaking between two solo players (lan): A presses PLAY, cancels the search and presses PLAY again; B's PLAY
// then finds A's room (JoinRandomGame with the client's SQL lobby filter) and both reach the started match.
export const matchmaking: Scenario = {
  entry: 'menu',
  players: 2,
  async run(a, b) {
    const checks: Record<string, boolean> = {};
    const [readyA, readyB] = await Promise.all([until(a, 'start', ready, 20000), until(b!, 'start', ready, 20000)]);
    checks.ready = readyA.matched && readyB.matched;
    checks.lobby = (await Promise.all([goToLobby(a), goToLobby(b!)])).every(Boolean);
    await press(a, at.play);
    checks.searching = (await room(a, 'search-1', name => !!name)).matched;
    await a.wait(2000);
    await a.screenshot('search-1');
    await press(a, cancel);
    checks.cancelled = (await room(a, 'cancelled', name => !name)).matched;
    await a.wait(3000);
    await press(a, at.play);
    const searching = await room(a, 'search-2', name => !!name);
    checks.searchingAgain = searching.matched;
    await a.wait(2000);
    await press(b!, at.play);
    checks.sameRoom = (await room(b!, 'joined', name => name === searching.value.photonRoom)).matched;
    let views = await both(a, b!, 'match-0');
    for (let second = 2; second <= 90 && !views.every(view => view.started === true); second += 2) {
      await a.wait(2000);
      views = await both(a, b!, `match-${second}`);
    }
    await screenshots(a, b!, 'started');
    checks.started = views.every(view => view.started === true);
    return verdict(checks);
  },
};
