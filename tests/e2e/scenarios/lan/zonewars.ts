import { poll, verdict, type Scenario } from '../index';
import { distance, formParty, lobby, screenshots, self, shootDown, startedMatch, synced, walk } from '../shared/lan';
import { at, press } from '../shared/menu';

// The original custom Zone Wars (Zone_Custom, Cubes) between two players (lan): the leader picks it on Change Mode
// (Custom tab, scrolled to the ZONE card), PLAY; movement seen by the other client, A's assault rifle takes B down
// before the storm does, A (actor 1) the winner on both, and Continue back to the party.
export const zonewars: Scenario = {
  entry: 'menu',
  players: 2,
  async run(a, b) {
    const { code, checks } = await formParty(a, b!);
    if (!checks.joined) return verdict(checks, 'The party was not formed.');
    await press(a, lobby.mode);
    await a.wait(3000);
    await press(a, [733, 692]); // Custom tab.
    await a.wait(2500);
    for (let step = 0; step < 12; step++) { // Scrolls the Custom Games cards until ZONE is in view.
      await a.page.mouse.move(640, 400);
      await a.page.mouse.wheel(0, -400);
      await a.wait(700);
    }
    await press(a, [1045, 300]); // ZONE.
    const mode = (view: any) => view.mode === 'Zone_Custom';
    const [pickedA, pickedB] = await Promise.all([poll(a, 'picked', () => a.observe('match'), mode, 10000),
      poll(b!, 'picked', () => b!.observe('match'), mode, 10000)]);
    checks.picked = pickedA.matched && pickedB.matched;
    await screenshots(a, b!, 'picked');
    if (!checks.picked) return verdict(checks, 'Zone_Custom was not selected.');

    await press(a, at.play);
    const mouse: [number, number] = [640, 380];
    await a.page.mouse.move(...mouse, { steps: 6 });
    const match = await startedMatch(a, b!, 'Zone_Custom', 'Cubes');
    checks.started = match.started;
    if (!match.started) return verdict(checks, 'Zone Wars did not start on both clients.');

    await Promise.all([walk(a, 800), walk(b!, 800)]);
    const sync = await synced(a, b!);
    await screenshots(a, b!, 'moved');
    checks.moved = distance(self(sync.views[0])?.position, self(match.views[0])?.position) > 2;
    checks.synced = sync.synced;

    checks.killed = await shootDown(a, b!, mouse);
    await screenshots(a, b!, 'killed');

    const ended = (view: any) => !!view.game?.result?.winners;
    const [endA, endB] = await Promise.all([poll(a, 'end', () => a.observe('match'), ended, 60000),
      poll(b!, 'end', () => b!.observe('match'), ended, 60000)]);
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
