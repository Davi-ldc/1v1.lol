import { DASH_ICON, ELASTIC_ICON, ICON_FILE } from '../page/elastic/icon';
import { MENU_LEGS } from '../page/elastic/stretch';
import { POSEIDON, POSEIDON_SKIN, QUICK } from '../page/ids';
import { poll, verdict, type Scenario, type ScenarioContext } from '../../tests/e2e/scenarios/index';
import { at, goToLobby, press, ready, until } from '../../tests/e2e/scenarios/shared/menu';
import { championOf, elasticLook, pickHero, served, serves, type Shape } from './common';

/**
 * The shaped skeleton read back from `manager` against the served mesh's `skeleton`: every limb bone at its local
 * position (1 mm; the knees and ankles `legs` times it: elastic/stretch.ts MENU_LEGS in the menu; Root is raised
 * each frame to keep the lowest foot down, shared/look.ts), the lower ball of the feet within 8 cm of the manager's
 * transform (on the ground) and, for a player, its motor capsule taller than the motor's own
 * (vThirdPersonMotor.colliderHeight, kept by its Init) by Root's raise (shared/look.ts's fit).
 */
async function shaped(context: ScenarioContext, label: string, manager: any, legs = 1) {
  const { skeleton } = await served(context);
  const expected = skeleton && Object.fromEntries(Object.entries(skeleton).map(([bone, value]) =>
    [bone, /^(LowerLeg|Ankle)_/.test(bone) ? value.map(v => v * legs) : value]));
  context.sample(label, { skeleton: manager?.skeleton, feet: manager?.feet, stretch: manager?.player?.stretch,
    expected });
  if (!expected) return {};
  const off = Object.entries(expected).filter(([bone, value]) => bone !== 'Root' && (!manager?.skeleton?.[bone] ||
    value.some((v, k) => Math.abs(v - manager.skeleton[bone][k]) > 1e-3))).map(([bone]) => bone);
  const feet: (number | null)[] = manager?.feet ?? [], stretch = manager?.player?.stretch;
  return { bones: !off.length, feet: feet.every(y => y !== null) && Math.abs(Math.min(...feet as number[])) < 0.08,
    capsule: stretch ? Math.abs(stretch.capsule[0] - stretch.initial - expected.Root![1]!) < 1e-3 : undefined };
}

/** Every capsule of the pack by name: [height, radius]. */
const capsules = (manager: any): Record<string, number[]> => Object.fromEntries((manager?.colliders ?? [])
  .filter((item: any[]) => item[2] !== null).map((item: any[]) => [item[0], [item[2], item[3]]]));
/** A pack capsule [height, radius] as heroes/shared/look.ts's fit shapes it (the Root's Collider stays). */
function fitted(name: string, [height, radius]: number[], shape: Shape) {
  if (/^(UpperLeg|LowerLeg)_/.test(name)) return [height! * shape.legs, radius! * shape.thin];
  if (/^Shoulder_/.test(name)) return [height! * shape.arms, radius! * shape.thin];
  if (/^Hand_/.test(name)) return [height! * shape.arms, radius!];
  if (/^Spine_0[12]$/.test(name)) return [height!, radius! * shape.body];
  if (name === 'HeadCollider') return [height! * shape.head, radius! * shape.head];
  return [height!, radius!];
}
/** Every capsule `shown` as fit shapes the pack's `own` (f32 read back). */
const fits = (shown: Record<string, number[]>, own: Record<string, number[]>, shape: Shape) =>
  Object.entries(own).every(([name, size]) => fitted(name, size, shape).every((v, k) =>
    Math.abs(shown[name]![k]! - v) < 1e-4));

// The elastic hero (heroes/page/index.ts) after the beam hero: CHAMPIONS shows a 13th card copied from the prefab's
// 12th, the card opens his overview, SELECT equips him, the lobby shows his scan moving with the SAMURAI pack's
// controllers, and PLAY spawns him with his slap Q (a Dash copy). The match shows the scan idle, walking and with the
// pickaxe swinging, for the visual review.
export const elastic: Scenario = {
  entry: 'menu',
  heroes: ['beam', 'elastic'],
  async run(context) {
    const { page, observe, sample, wait, screenshot } = context;
    const checks: Record<string, boolean> = {};
    checks.ready = (await until(context, 'start', menu => ready(menu), 20000)).matched;
    checks.lobby = await goToLobby(context);
    // His Q's icon (elastic/icon.ts) on his overview, when the host serves the hand. The overview's ⓘ, his abilities
    // screen, answers "No internet connection" offline, so it is not checked.
    const hand = await serves(context, 'elastic', ICON_FILE), champion = await championOf(context, 'elastic');
    const icons = async (label: string) => {
      const { icons } = await observe('elastic');
      sample(label, icons);
      return icons;
    };
    const iconOn = (shown: any, id: string) => shown.overview?.find((screen: any) => screen.champion === id)?.sprite;
    const first = await pickHero(context, champion, { shots: true, inspect: async () => {
      if (hand) checks.overviewIcon = iconOn(await icons('overview-icons'), champion) === ELASTIC_ICON;
    } });
    Object.assign(checks, { overview: first.overview, selection: first.selection, cards: first.card?.cards === 13,
      card: !!first.card });
    // With his card art the card shows its portrait (sprite "elastic"), else Poseidon's art.
    const portrait = await serves(context, 'elastic', 'hero_card.png');
    checks.art = !!first.card?.icon && (first.card.icon === 'elastic') === portrait;
    if (!checks.card) return verdict(checks, 'The elastic hero has no visible card.');
    checks.equipped = first.equipped;
    if (!checks.equipped) return verdict(checks, 'The elastic hero was not equipped.');
    const shown = async (label: string) => (await poll(context, label, () => observe('heroes'),
      view => !!view.managers?.some((manager: any) => manager.active && elasticLook(manager)), 10000)).matched;
    checks.lobbyLook = await shown('lobby-heroes');
    await wait(2000);
    const lobbyBody = (await observe('heroes')).managers
      ?.find((manager: any) => manager.active && elasticLook(manager));
    const lobby = await shaped(context, 'lobby-skeleton', lobbyBody, MENU_LEGS);
    let own: Record<string, number[]> = {};
    if (lobby.bones !== undefined) Object.assign(checks, { lobbyBones: lobby.bones, lobbyFeet: lobby.feet });
    await screenshot('lobby');
    if (lobby.bones !== undefined) {
      // Poseidon, whose default pack this skin shares: the same instance gets its mesh, bones, Root and hitbox back.
      const poseidon = await pickHero(context, POSEIDON, { inspect: async () => {
        if (hand) checks.poseidonIcon = ![null, undefined, ELASTIC_ICON]
          .includes(iconOn(await icons('poseidon-icons'), POSEIDON));
      } });
      await wait(1500);
      const back = (await observe('heroes')).managers?.find((manager: any) => manager.active &&
        manager.skin === POSEIDON_SKIN);
      sample('restored', back);
      checks.restored = poseidon.equipped && !!back && back.mesh !== 'elastic' &&
        !!back.skeleton?.Root?.every((v: number) => Math.abs(v) < 1e-4);
      // The capsules shown with the elastic hero, against the same pack's own (11 on the body, the Root's): the shape.
      const { shape } = await served(context), worn = capsules(lobbyBody);
      own = capsules(back);
      sample('hitbox', { worn, own, shape });
      checks.lobbyHitbox = !!shape && Object.keys(own).length === 12 && fits(worn, own, shape);
      await screenshot('restored');
      // Quick, whose Dash his slaps copy (same UX data): its overview keeps the boot.
      if (hand) await pickHero(context, QUICK, { inspect: async () => {
        checks.quickIcon = iconOn(await icons('quick-icons'), QUICK) === DASH_ICON;
        await screenshot('quick-overview');
      } });
      checks.reequipped = (await pickHero(context, champion)).equipped && await shown('lobby-again');
      await wait(1500);
    }
    await press(context, at.play);
    for (let tick = 0; tick < 180; tick++) {
      await wait(500);
      if ((await observe('match')).game?.hasStarted) break;
    }
    const mine = (view: any) => view.managers?.find((manager: any) => manager.player?.mine);
    const spawned = await poll(context, 'heroes', () => observe('heroes'), view => elasticLook(mine(view)), 20000);
    const self = mine(spawned.value);
    checks.champion = self?.player.champion === champion;
    checks.look = elasticLook(self);
    checks.slapAbility = !!self?.player.abilities?.includes('DashAbility'); // His Q (elastic/slap.ts).
    sample('self', self);
    if (hand) checks.hudIcon = (await poll(context, 'hud-icons', async () => (await observe('elastic')).icons,
      shown => shown.hud?.find((slot: any) => slot.his)?.sprite === ELASTIC_ICON, 8000)).matched;
    await wait(1000);
    const standing = await shaped(context, 'match-skeleton', mine(await observe('heroes')));
    if (standing.bones !== undefined) {
      Object.assign(checks, { matchBones: standing.bones, matchFeet: standing.feet, matchCapsule: !!standing.capsule });
      const { shape } = await served(context), worn = capsules(mine(await observe('heroes')));
      sample('match-hitbox', worn);
      if (shape && Object.keys(own).length) checks.matchHitbox = fits(worn, own, shape);
    }
    await screenshot('match');
    await page.keyboard.down('w');
    try { // Three phases of the walk cycle, so each arm shows swinging forward and back.
      await wait(700);
      await screenshot('walk');
      await wait(350);
      await screenshot('walk2');
      await wait(350);
      await screenshot('walk3');
    } finally { await page.keyboard.up('w'); }
    await page.keyboard.press('f'); // The pickaxe (weapon scenario), swung with the original mouse input.
    await wait(600);
    await screenshot('pickaxe');
    await page.mouse.down();
    try { await wait(300); await screenshot('swing'); } finally { await page.mouse.up(); }
    await wait(800);
    await page.keyboard.press('1'); // The rifle (the HUD's slot 1): the support hand on it by PlayerIK.
    await wait(1200);
    await screenshot('rifle');
    sample('rifle-skeleton', mine(await observe('heroes'))?.skeleton);
    return verdict(checks);
  },
};
