import { poll, verdict, type Scenario, type ScenarioContext } from '../index';
import { formParty, lobby, screenshots } from '../shared/lan';
import { press } from '../shared/menu';

/** The party's LEAVE button (1280×760 probe viewport). */
const leave = [1024, 145] as const;

/** Out of the party: PartyInfo cleared and no Photon room. */
const left = (context: ScenarioContext, label: string) => poll(context, label, () => context.observe('party'),
  party => !party.roomName && !party.photonRoom, 15000);

async function join(b: ScenarioContext, code: string) {
  await press(b, lobby.partySlot);
  await b.wait(2000);
  await press(b, lobby.partyId);
  await b.page.keyboard.type(code, { delay: 80 });
  await press(b, lobby.joinWithCode);
  return poll(b, 'rejoined', () => b.observe('party'), party => party.roomName === code, 20000);
}

// The party's LEAVE (lan): the original Button calls PartyRoomConnector.LeaveParty (f48313), which exits party mode
// and leaves the Photon room only while IsConnectedAndReady. B leaves A's party and joins it again with the code;
// then the leader A leaves and B stays as the new leader.
export const partyleave: Scenario = {
  entry: 'menu',
  players: 2,
  async run(a, b) {
    const { code, checks } = await formParty(a, b!);
    if (!checks.joined) return verdict(checks, 'The party was not formed.');
    await press(b!, leave);
    checks.leftB = (await left(b!, 'left-b')).matched;
    checks.droppedB = (await poll(a, 'dropped-b', () => a.observe('party'),
      party => Object.keys(party.nicknames ?? {}).length === 1, 10000)).matched;
    await screenshots(a, b!, 'left-b');
    checks.rejoined = (await join(b!, code ?? '')).matched;
    await b!.wait(2000);
    await press(a, leave);
    checks.leftA = (await left(a, 'left-a')).matched;
    checks.leaderB = (await poll(b!, 'leader-b', () => b!.observe('party'),
      party => party.roomName === code && party.masterClient, 10000)).matched;
    await screenshots(a, b!, 'left-a');
    return verdict(checks);
  },
};
