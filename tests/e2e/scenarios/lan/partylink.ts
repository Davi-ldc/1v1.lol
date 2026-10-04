import { poll, verdict, type Scenario } from '../index';
import { lobby, screenshots } from '../shared/lan';
import { goToLobby, press, ready, until } from '../shared/menu';

// The original party share link (lan): A creates a party; B opens this host's /party?code=<code> and the original
// DeepLinkManager → Connector.OnPartyDeepLink puts B in A's party. The friendly-match toggle stays hidden. The code
// has one digit (src/host/wasm.ts partyCodes), which JoinParty's length and region checks accept.
export const partylink: Scenario = {
  entry: 'menu',
  players: 2,
  async run(a, b) {
    const [readyA] = await Promise.all([until(a, 'start', ready, 20000), until(b!, 'start', ready, 20000)]);
    const lobbyA = await goToLobby(a);
    await press(a, lobby.partySlot);
    await a.wait(2000);
    await press(a, lobby.createParty);
    const created = await poll(a, 'party-created', () => a.observe('party'), party => !!party.roomName, 20000);
    const code = created.value.roomName as string;
    const base = await a.page.evaluate(() => (window as any).local.adapters.party?.baseWebUrl as string);
    const origin = new URL(b!.page.url()).origin;
    await b!.page.goto(`${origin}/party?code=${code}`, { waitUntil: 'domcontentloaded' });
    const joined = await poll(b!, 'party-joined', () => b!.observe('party').catch(() => ({})),
      (party: any) => party.roomName === code && party.photonRoom === code, 120000);
    await b!.wait(3000);
    await screenshots(a, b!, 'party');
    return verdict({ ready: readyA.matched, lobbyA, created: /^\d$/.test(code ?? ''), base: base === `${origin}/`,
      joined: joined.matched });
  },
};
