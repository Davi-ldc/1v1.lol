import { verdict, type Scenario } from '../../tests/e2e/scenarios/index';
import { formParty, screenshots, startedMatch } from '../../tests/e2e/scenarios/shared/lan';
import { at, press } from '../../tests/e2e/scenarios/shared/menu';
import { beamLook, beamOf, equipBeam, flight, jumpTwice, sees } from './common';

// The beam hero over the network (lan): A equips him, forms the party with B and starts the 1v1. The skin ID travels
// in the original ChangeSkinsRPC/Photon properties and every client applies the look itself (shared/look.ts): B's
// lobby shows A as the beam hero, and in the match each client sees A's player with his look and ID. A's double jump
// (beam/jump.ts) reaches B: B sees A rise past one jump and turn upside down (the `flip` message).
export const beamlan: Scenario = {
  entry: 'menu',
  players: 2,
  heroes: ['beam'],
  async run(a, b) {
    const picked = await equipBeam(a);
    if (!picked.equipped) return verdict(picked, 'A did not equip the beam hero.');
    const party = await formParty(a, b!);
    const { loadoutA: _, ...formed } = party.checks; // A starts in the lobby: equipBeam checked its Loadout.
    const checks: Record<string, boolean> = { ...picked, ...formed };
    if (!checks.joined) return verdict(checks, 'The party was not formed.');
    checks.peerLobby = (await sees(b!, 'peer-lobby', manager => manager.active && beamLook(manager))).matched;
    await screenshots(a, b!, 'party-hero');
    await press(a, at.play);
    const match = await startedMatch(a, b!, '1v1', 'NormalMap');
    checks.started = match.started;
    if (!match.started) return verdict(checks, 'The 1v1 did not start on both clients.');
    const hero = (mine: boolean) => (manager: any) =>
      manager.player?.mine === mine && manager.player.hero === 'beam' && beamLook(manager);
    const [own, remote] = await Promise.all([sees(a, 'own', hero(true)), sees(b!, 'remote', hero(false))]);
    checks.ownLook = own.matched;
    checks.remoteLook = remote.matched;
    await screenshots(a, b!, 'match-hero');
    await a.page.mouse.click(...at.center);
    await a.wait(1000);
    const ground = (await beamOf(b!, false))?.y as number;
    const seen = await flight(b!, 'flip-seen', ground, () => jumpTwice(a), { mine: false });
    checks.flipSeen = seen.top > 2 && seen.head < 0;
    return verdict(checks);
  },
};
