import { poll, verdict, type Scenario } from '../index';
import { distance, formParty, lobby, screenshots, self, shootDown, startedMatch, synced, walk } from '../shared/lan';
import { at, press } from '../shared/menu';

// The original custom 1v1 between two players (lan): party by code, the leader's PLAY, both in NormalMap; movement
// seen by the other client, A's assault rifle kills B, the master's result on both, and Continue back to the party.
export const duel: Scenario = {
  entry: 'menu',
  players: 2,
  async run(a, b) {
    const { code, checks } = await formParty(a, b!);
    if (!checks.joined) return verdict(checks, 'The party was not formed.');
    await press(a, at.play);
    const mouse: [number, number] = [640, 380];
    await a.page.mouse.move(...mouse, { steps: 6 }); // Rests at the center while the match loads.
    const match = await startedMatch(a, b!, '1v1', 'NormalMap');
    checks.started = match.started;
    if (!match.started) return verdict(checks, 'The 1v1 did not start on both clients.');

    // B leaves its spawn protection; both walk toward each other.
    await Promise.all([walk(a, 800), walk(b!, 1800)]);
    const sync = await synced(a, b!);
    await screenshots(a, b!, 'moved');
    checks.moved = distance(self(sync.views[0])?.position, self(match.views[0])?.position) > 2;
    checks.synced = sync.synced;

    checks.killed = await shootDown(a, b!, mouse);
    await screenshots(a, b!, 'killed');

    // The master decides; both result screens name A (actor 1) the only winner.
    const ended = (view: any) => !!view.game?.result?.winners;
    const [endA, endB] = await Promise.all([poll(a, 'end', () => a.observe('match'), ended, 30000),
      poll(b!, 'end', () => b!.observe('match'), ended, 30000)]);
    await screenshots(a, b!, 'end');
    const winners = [endA, endB].map(end => JSON.stringify(end.value.game?.result?.winners));
    checks.result = endA.matched && endB.matched && winners.every(list => list === '[1]');

    await Promise.all([press(a, lobby.continue), press(b!, lobby.continue)]);
    const inParty = (party: any) => party.roomName === code && party.photonRoom === code;
    const [backA, backB] = await Promise.all([poll(a, 'back', () => a.observe('party'), inParty, 30000),
      poll(b!, 'back', () => b!.observe('party'), inParty, 30000)]);
    checks.backInParty = backA.matched && backB.matched;
    await b!.wait(3000);
    await screenshots(a, b!, 'back');
    return verdict(checks);
  },
};
