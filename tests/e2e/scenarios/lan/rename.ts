import { poll, verdict, type Scenario, type ScenarioContext } from '../index';
import { formParty, lobby, screenshots, shootDown, startedMatch } from '../shared/lan';
import { at, press } from '../shared/menu';

const NAME_A = 'Alpha', NAME_B = 'Bravo';

/** Clicks the profile panel (top left), types `name` and confirms it. */
async function typeName(player: ScenarioContext, name: string) {
  await press(player, [70, 70]);
  await player.wait(1500);
  await player.page.keyboard.press('Control+A');
  await player.page.keyboard.type(name, { delay: 80 });
  await player.page.keyboard.press('Enter');
}

/** Both names, exactly as typed, among `names`. */
const named = (names: unknown[]) => names.includes(NAME_A) && names.includes(NAME_B);

// Renaming on the lobby's profile panel (lan, adapters/rename.ts, src/host/wasm.ts validNicknames): in a party, A and
// B each type a name; the original saves it (cached "nickname") and publishes it through Photon. Both clients show
// both names exactly as typed in the room, on the tags above the lobby characters (PartyPlayer), in the match
// (InGamePlayerInfo, kill feed and results) and back in the party; after a reload A keeps its name.
export const rename: Scenario = {
  entry: 'menu',
  players: 2,
  async run(a, b) {
    const { code, checks } = await formParty(a, b!);
    if (!checks.joined) return verdict(checks, 'The party was not formed.');
    await typeName(a, NAME_A);
    const saved = await poll(a, 'saved', () => a.observe('party'), (party: any) => party.nickname === NAME_A, 10000);
    await typeName(b!, NAME_B);
    const party = (party: any) => named(Object.values(party.nicknames ?? {})) && named(party.tags ?? []);
    const [partyA, partyB] = await Promise.all([poll(a, 'party-names', () => a.observe('party'), party, 20000),
      poll(b!, 'party-names', () => b!.observe('party'), party, 20000)]);
    await screenshots(a, b!, 'renamed');
    Object.assign(checks, { saved: saved.matched, partyA: partyA.matched, partyB: partyB.matched });

    await press(a, at.play);
    const mouse: [number, number] = [640, 380];
    await a.page.mouse.move(...mouse, { steps: 6 });
    const match = await startedMatch(a, b!, '1v1', 'NormalMap');
    checks.started = match.started;
    if (!match.started) return verdict(checks, 'The 1v1 did not start on both clients.');
    const inMatch = (view: any) => named(Object.values(view.names ?? {}));
    const [matchA, matchB] = await Promise.all([poll(a, 'match-names', () => a.observe('match'), inMatch, 10000),
      poll(b!, 'match-names', () => b!.observe('match'), inMatch, 10000)]);
    Object.assign(checks, { matchA: matchA.matched, matchB: matchB.matched });

    checks.killed = await shootDown(a, b!, mouse);
    const ended = (view: any) => !!view.game?.result?.winners;
    await Promise.all([poll(a, 'end', () => a.observe('match'), ended, 30000),
      poll(b!, 'end', () => b!.observe('match'), ended, 30000)]);
    await screenshots(a, b!, 'end');
    await Promise.all([press(a, lobby.continue), press(b!, lobby.continue)]);
    const back = (view: any) => view.roomName === code && view.photonRoom === code && party(view);
    const [backA, backB] = await Promise.all([poll(a, 'back-names', () => a.observe('party'), back, 30000),
      poll(b!, 'back-names', () => b!.observe('party'), back, 30000)]);
    await screenshots(a, b!, 'back');
    Object.assign(checks, { backA: backA.matched, backB: backB.matched });

    await a.page.reload({ waitUntil: 'domcontentloaded' });
    const kept = await poll(a, 'kept', () => a.observe('party').catch(() => ({})),
      (view: any) => view.nickname === NAME_A, 90000);
    return verdict({ ...checks, kept: kept.matched });
  },
};
