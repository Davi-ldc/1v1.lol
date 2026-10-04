import { F64, I32, type Native } from '../../../src/page/native';
import { heroOf } from '../ids';
import type { HeroFrame } from '../shared/frame';
import { curve, ease } from '../shared/motion';
import type { HeroNet } from '../shared/net';
import { record, slowMotion } from '../shared/trace';
import { passFloats, readFloats } from '../shared/unity';
import { add, axisAngle, conj, cross, dot, fromTo, length, mul, nlerp, rotate, scale, twoAxis, unit, type Q, type V }
  from '../shared/vec';
import { field, runtime, slot, staticField, typeInfo } from '../symbols';

/**
 * The elastic hero's Q: the cycle (left hand, right hand, both hands), DAMAGE per single slap to each enemy the hand
 * touches and BUILD to each build it touches (the practice pickaxe's per hit: a 150 wall takes two), CADENCE s between
 * presses (the ability's own Cooldown), the cycle restarting after RESET s without Q.
 */
const DAMAGE = 250, BUILD = 75, CADENCE = 0.35, RESET = 1.5;
/**
 * The elastic reach: the target is the nearest enemy ahead within PICK m, the hand stretches up to REACH m from its
 * shoulder, and at the hit it touches enemies with a collider within TOUCH m and builds within GRAZE m of its contact
 * point.
 */
const PICK = 5, REACH = 5, TOUCH = 1.3, GRAZE = 0.9;

/**
 * One slap, with the forearm, the arm and the body moving into it. Phase times (s): the wind-up ends at
 * `wind`, the hit lands at `impact` after an accelerating swing, the follow-through runs to `follow`, the pose blends
 * back to the Animator's by `end`. Hand path points relative to the shoulder in [out, up, forward] (m): cocked back by
 * the ear (`wound`), the arc's control out to the side, the hit (`hit`, else at the target), the elastic overshoot
 * past the hit along the swing (m), the recoil (`through`). Curves (eased between keys): `extension`, the arm's share
 * of its stretched length (bent in the wind-up and the recoil, straight at the hit: the forearm whips), hand scale,
 * torso yaw and pitch (degrees, spread over Spine_01–03; yaw positive turns toward the slapping side's opposite,
 * mirrored for the right hand), the clavicle (degrees about up; negative draws the shoulder back, positive drives it
 * forward), the wrist (degrees; negative: the fingers lag behind the palm, positive: they snap through); the elbow
 * pole at the wind-up, the hit and the recoil.
 */
interface Slap { arms: ('L' | 'R')[]; wind: number; impact: number; follow: number; end: number;
  wound: V; control: V; hit: V; overshoot: number; through: V; extension: number[][]; size: number[][];
  yaw: number[][]; pitch: number[][]; clavicle: number[][]; wrist: number[][]; pole: V[]; inward: number;
  clap: boolean }
const SINGLE = { wind: 0.17, impact: 0.27, follow: 0.43, end: 0.64,
  wound: [0.3, 0.2, -0.3], control: [1, 0.15, 0.7], hit: [-0.1, 0.1, 2.3], overshoot: 0.22,
  through: [-0.15, -0.25, 0.45],
  extension: [[0, 1], [0.17, 0.62], [0.24, 0.93], [0.27, 0.99], [0.43, 0.72], [0.64, 1]],
  size: [[0, 1], [0.17, 1.4], [0.27, 2], [0.31, 2.2], [0.43, 1.7], [0.64, 1]],
  yaw: [[0, 0], [0.17, -20], [0.27, 16], [0.43, 24], [0.64, 0]],
  pitch: [[0, 0], [0.17, -4], [0.27, 6], [0.43, 8], [0.64, 0]],
  clavicle: [[0, 0], [0.17, -14], [0.27, 10], [0.43, 14], [0.64, 0]],
  wrist: [[0, 0], [0.17, -30], [0.24, -35], [0.28, 20], [0.36, 10], [0.64, 0]],
  pole: [[0.5, -0.6, -0.6], [0.8, -0.6, 0], [0.2, -0.9, 0.3]], inward: 0, clap: false };
const SLAPS: Slap[] = [{ ...SINGLE, arms: ['L'] }, { ...SINGLE, arms: ['R'] },
  { arms: ['L', 'R'], wind: 0.22, impact: 0.32, follow: 0.54, end: 0.8,
    wound: [0.45, 0.15, -0.25], control: [0.95, 0.12, 0.7], hit: [0, -0.2, 1.9], overshoot: 0.1,
    through: [0.25, -0.25, 0.5], extension: [[0, 1], [0.22, 0.65], [0.29, 0.94], [0.32, 0.99], [0.54, 0.75], [0.8, 1]],
    size: [[0, 1], [0.22, 1.6], [0.32, 2.25], [0.37, 2.4], [0.54, 2], [0.8, 1]], yaw: [[0, 0]],
    pitch: [[0, 0], [0.22, -9], [0.32, 11], [0.54, 8], [0.8, 0]],
    clavicle: [[0, 0], [0.22, -16], [0.32, 14], [0.54, 10], [0.8, 0]],
    wrist: [[0, 0], [0.22, -20], [0.3, -25], [0.33, 10], [0.8, 0]],
    pole: [[0.6, -0.7, -0.4], [1, -0.5, 0], [0.5, -0.8, 0.2]], inward: 0.14, clap: true }];
/** The torso's share of the twist and lean per spine bone, base to top. */
const SPINE = [['Spine_01', 0.3], ['Spine_02', 0.4], ['Spine_03', 0.3]] as const;
/** The overshoot's share of the follow-through (s), before the recoil. */
const FLICK = 0.05;
/** The blend weight with the Animator's pose: in over IN s, out from `follow` to `end`. */
const IN = 0.07;
/** The held weapon shows again GRACE s after the last slap ends, so quick presses do not flash the pickaxe. */
const GRACE = 0.5;

/**
 * One slap of a hero as its owner resolved it (read by observe/elastic.ts): the cycle index; the target pick (the
 * target's OwnerID or -1, the nearest enemy's horizontal distance and angle off the body's forward); the frames' t
 * (s into the slap); then the strike (its t, the contact point, the target's center, the colliders found on the
 * player layers, the players hit by OwnerID and the builds hit) or `missed` (it ended without striking).
 */
export interface Strike { index: number; target: number; d: number | null; angle: number | null; frames: number[];
  t?: number; at?: V; to?: V | null; colliders?: number; players?: number[]; builds?: number; missed?: boolean }
/** Each hero's last slaps on its owner's client, newest last. */
export const elasticStrikes = new Map<number, Strike[]>();

interface Run { index: number; start: number; target: number; hit: boolean; ik: number;
  hidden: { renderer: number; handle: number }[]; sizes: Map<number, V>; from?: Map<string, V>; record?: Strike }
/** Elastic players slapping on this client: cycle index and seconds into it (read by observe/elastic.ts). */
export const elasticSlaps = new Map<number, { index: number; t: number; hands: number[]; ik: boolean | null;
  arms: { side: string; k: number; need: number; base: number[] }[] }>();

/**
 * The elastic hero's ActiveAbility: his own copy (Object.Instantiate, which copies the SerializeReference level data)
 * of Quick's DashAbility, the build's loaded instant ability (Resources.FindObjectsOfTypeAll finds no SliceAbility
 * asset). Every level: Cooldown CADENCE, MaxStock 1, ReuseDelayTime 0 (DashLevelData +8/+20/+24). Its Perform is
 * taken over below; its ID stays Dash's.
 */
export function armElasticAbility(n: Native, hero: number, dash: number, hold: (object: number) => number) {
  if (n.className(dash) !== 'DashAbility') throw new Error('Quick has no DashAbility.');
  const ability = hold(n.call(slot.objectInstantiate, dash, 0));
  const levels = (owner: number) => n.list(n.u32(owner, field.Ability.dataPerLevel), 32);
  const copies = levels(ability), sources = levels(dash);
  if (!copies.length || copies.length !== sources.length || copies.some((copy, index) => copy === sources[index] ||
    n.className(copy) !== 'DashLevelData')) throw new Error('The Dash copy shares or lacks its level data.');
  const D = field.DashLevelData;
  for (const copy of copies) {
    n.setF32(copy, runtime.boxedValue + D.Cooldown, CADENCE);
    n.setI32(copy, runtime.boxedValue + D.MaxStock, 1);
    n.setF32(copy, runtime.boxedValue + D.ReuseDelayTime, 0);
  }
  n.call(slot.championDataSetActiveAbility, hero, ability, 0);
  return ability;
}

/** The projectile (projectile.ts): throws one from the clap and hurts a player with the original hit. */
type Projectile = { launch(hero: number): void; hurt(victim: number, attacker: number, damage: number, at: V): void };

/**
 * The elastic hero's slaps on every client (heroes/README.md, "Q: slaps and the projectile"): DashAbility.Perform
 * (slot 119354) for him does not dash; his owner picks the cycle step and the target and sends `slap`, and every
 * client plays it after the Animator (shared/frame.ts) with stretching two-bone arms and growing hands, PlayerIK off
 * and the held weapon hidden. At the hit the owner strikes what the hand touches; the clap throws the projectile.
 */
export async function installElasticSlap(n: Native, net: HeroNet, frames: HeroFrame, projectile: Projectile) {
  const now = () => performance.now() / 1000;
  const runs = new Map<number, Run>();
  const cycles = new Map<number, { index: number; last: number }>();
  /** The owner's pick for its slap message, recorded with the run the message starts. */
  const picks = new Map<number, Strike>();
  const elastic = (player: number) => heroOf(n.textOrNull(n.call(slot.playerChampionId, player, 0))) === 'elastic';
  const vector = (call: number, transform: number, size = 3) =>
    readFloats(n, at => n.call(call, transform, at, 0), size);
  const write = (call: number, transform: number, values: V) =>
    passFloats(n, values, at => n.call(call, transform, at, 0));
  const position = (t: number) => vector(slot.transformPosition, t);
  const world = (t: number) => vector(slot.transformRotation, t, 4);
  const local = (t: number) => vector(slot.transformLocalRotation, t, 4);
  const offset = (t: number) => vector(slot.transformLocalPosition, t);
  const parent = (t: number) => n.call(slot.transformParent, t, 0);
  const center = (player: number) => readFloats(n, at => n.call(slot.playerCenterPosition, at, player, 0));
  const forward = (player: number) => {
    const [x, , z] = readFloats(n, at => n.call(slot.transformForward, at,
      n.check(n.call(slot.componentTransform, player, 0)), 0));
    return unit([x!, 0, z!]);
  };
  const players = () => {
    const manager = n.resolvedClass(typeInfo.PlayersManager)
      ? n.u32(n.staticFields(typeInfo.PlayersManager), staticField.PlayersManager.Instance) : 0;
    const all = manager ? n.u32(manager, field.PlayersManager._allPlayers) : 0;
    return (all ? n.dictionary(all) : []).map(([, player]) => player)
      .filter(player => n.alive(player) && !n.bool(player, field.PlayerController._isDead));
  };
  /** Teammates are never hit, as SliceBehaviour.FixedUpdate (f51102) skips them (IsOnMyTeam, slot 8503). */
  const enemy = (player: number, hero: number) => player !== hero && n.alive(player) &&
    !n.bool(player, field.PlayerController._isDead) && n.call(slot.isOnMyTeam, player, hero, 0) === 0;
  /** Each enemy of `hero` with its horizontal distance, angle off the body's forward (degrees) and height offset. */
  function enemies(hero: number) {
    const from = center(hero), fwd = forward(hero);
    return players().filter(player => enemy(player, hero)).map(player => {
      const to = add(center(player), from, -1), flat = [to[0]!, 0, to[2]!], d = length(flat);
      const angle = d > 1e-3 ? Math.acos(Math.min(1, Math.max(-1, dot(unit(flat), fwd)))) * 180 / Math.PI : 0;
      return { player, d, angle, dy: to[1]! };
    }).sort((p, q) => p.d - q.d);
  }
  /** The nearest enemy ahead of `hero` (within 70°) within `range` m, else 0. */
  function ahead(hero: number, range: number) {
    return enemies(hero).find(({ d, angle, dy }) => d <= range && Math.abs(dy) <= 2 && (d <= 0.3 || angle <= 70))
      ?.player ?? 0;
  }
  const type = (name: string) => n.call(slot.typeGetType, n.newString(name), 1, 0);
  const types = { player: type('PlayerController, 1v1'), build: type('Building, 1v1') };
  /** The colliders Physics.OverlapSphereNonAlloc finds, held for the page's life. */
  const found = n.check(n.call(slot.arrayCreateInstance, type('UnityEngine.Collider, UnityEngine.PhysicsModule'), 32,
    0));
  n.gcAlloc(found);
  /** The colliders on `layers` within `radius` m of `at` and the distinct alive components of `kind` owning them. */
  function touched(at: V, radius: number, layers: number, kind: number) {
    const count = passFloats(n, at, point => n.call(slot.overlapSphere, point, radius, found, layers, 0));
    const owners = n.array(found, 32).slice(0, count).filter(collider => n.alive(collider))
      .map(collider => n.call(slot.componentInParent, collider, kind, 0, 0)).filter(owner => owner && n.alive(owner));
    return { count, owners: [...new Set(owners)] };
  }
  /** A single slap's hit point from its shoulder at `pS`: toward the run's target up to REACH, else `pS + straight`. */
  function reachFrom(pS: V, run: Run, straight: V) {
    if (!run.target || !n.alive(run.target)) return add(pS, straight);
    const to = add(center(run.target), pS, -1);
    return add(pS, scale(unit(to), Math.min(REACH, length(to))));
  }
  /**
   * The owner's hit for `run`, once its impact time has come, even on a late frame or as the next slap takes it over:
   * a loaded page can skip the whole window from impact to end. The clap throws; a single slap strikes at its hit
   * point, its target picked again if it has none alive (the body may have turned since the press).
   */
  function land(hero: number, run: Run, t: number) {
    run.hit = true;
    if (run.record) run.record.t = +t.toFixed(3);
    const spec = SLAPS[run.index]!;
    if (spec.clap) return projectile.launch(hero);
    if (!run.target || !enemy(run.target, hero)) run.target = ahead(hero, PICK);
    const side = spec.arms[0]!, shoulder = bones(hero)?.get(`Shoulder_${side}`);
    if (!shoulder || !n.alive(shoulder)) return;
    const fwd = forward(hero), right = unit(cross([0, 1, 0], fwd)), out = side === 'L' ? scale(right, -1) : right;
    const straight = add(add(scale(out, spec.hit[0]!), [0, 1, 0], spec.hit[1]!), fwd, spec.hit[2]!);
    strike(hero, run, reachFrom(position(shoulder), run, straight), t);
  }
  /**
   * The owner's single slap landing at `at` (heroes/README.md, "Q: slaps and the projectile"): each enemy with a
   * collider or its centre within TOUCH m takes DAMAGE (projectile.ts hurt), and each non-static build with a collider
   * within GRAZE m takes BUILD through BuildingNetworkController.HitBuilding (slot 102481). The run's record gets what
   * it hit.
   */
  function strike(hero: number, run: Run, at: V, t: number) {
    const weapons = n.u32(hero, field.PlayerController._weaponsController), W = field.WeaponsController;
    const mask = (offset: number) => weapons ? n.i32(weapons, offset) : 0;
    const buildLayers = mask(W._buildingsLayerMask);
    const playerLayers = mask(W.HitLayerMask) & ~buildLayers & ~mask(W._otherHitsLayerMask);
    const reached = touched(at, TOUCH, playerLayers, types.player);
    const close = players().filter(player => length(add(center(player), at, -1)) <= TOUCH);
    const victims = [...new Set([...reached.owners, ...close])].filter(player => enemy(player, hero));
    for (const victim of victims) projectile.hurt(victim, hero, DAMAGE, at);
    const controller = n.resolvedClass(typeInfo.BuildingNetworkController)
      ? n.u32(n.staticFields(typeInfo.BuildingNetworkController), staticField.BuildingNetworkController.Instance) : 0;
    const builds = controller ? touched(at, GRAZE, buildLayers, types.build).owners.filter(build =>
      !n.bool(build, field.Building.IsStatic) && !n.bool(build, field.Building._isDestroySignaled)) : [];
    for (const build of builds) {
      n.call(slot.hitBuilding, controller, n.u32(build, field.Building.ID), BUILD, 1, 1,
        n.call(slot.playerOwnerId, hero, 0), 0);
    }
    const near = run.target && n.alive(run.target) ? run.target : enemies(hero)[0]?.player;
    const round = (v: V) => v.map(value => +value.toFixed(2));
    Object.assign(run.record ?? {}, { t: +t.toFixed(3), at: round(at), to: near ? round(center(near)) : null,
      colliders: reached.count, players: victims.map(player => net.ownerId(player)), builds: builds.length });
  }
  /**
   * The player's bone Transforms by name, from its current body's SkinnedMeshRenderer, cached per renderer: after a
   * champion or skin swap the old skeleton stays alive but inactive, so a cache per skin manager would pose it.
   */
  const maps = new Map<number, Map<string, number>>();
  function bones(player: number) {
    const manager = n.u32(player, field.PlayerController._playerSkinManager);
    const body = manager ? n.u32(manager, field.PlayerSkinManager._currBody) : 0;
    const renderer = body ? n.list(n.u32(body, field.PlayerSkinPart.Renderers), 16)
      .find(item => n.alive(item) && n.className(item) === 'SkinnedMeshRenderer') : 0;
    if (!renderer) return null;
    let map = maps.get(renderer);
    if (map && [...map.values()].every(bone => n.alive(bone))) return map;
    map = new Map(n.array(n.call(slot.skinnedBones, renderer, 0), 128).filter(bone => n.alive(bone))
      .map(bone => [n.text(n.call(slot.objectName, bone, 0)), bone] as const));
    maps.set(renderer, map);
    return map;
  }
  type Hidden = { renderer: number; handle: number }[];
  /** The held weapon's renderers, disabled (they come back GRACE s after the last slap), less those in `kept`. */
  function hide(player: number, kept: Hidden = []) {
    const weapons = n.u32(player, field.PlayerController._weaponsController);
    const weapon = weapons ? n.u32(weapons, field.WeaponsController.CurrentWeapon) : 0;
    if (!weapon || !n.alive(weapon)) return kept;
    const type = n.call(slot.typeGetType, n.newString('UnityEngine.Renderer, UnityEngine.CoreModule'), 1, 0);
    const object = n.call(slot.componentGameObject, weapon, 0);
    const renderers = n.array(n.call(slot.componentsInChildren, object, type, 1, 0), 64)
      .filter(item => n.alive(item) && !kept.some(entry => entry.renderer === item));
    for (const renderer of renderers) n.call(slot.rendererSetEnabled, renderer, 0, 0);
    return [...kept, ...renderers.map(renderer => ({ renderer, handle: n.gcAlloc(renderer) }))];
  }
  /** Weapons a finished slap left hidden, shown again at `at` (s) unless another slap takes them first. */
  const pending = new Map<number, { at: number; hidden: Hidden }>();
  function show(player: number) {
    const entry = pending.get(player);
    if (!entry) return;
    pending.delete(player);
    for (const { renderer, handle } of entry.hidden) {
      if (n.alive(renderer)) n.call(slot.rendererSetEnabled, renderer, 1, 0);
      n.gcFree(handle);
    }
  }
  function finish(player: number) {
    const run = runs.get(player);
    if (!run) return;
    if (run.record && !run.hit) run.record.missed = true;
    runs.delete(player);
    elasticSlaps.delete(player);
    for (const [hand, size] of run.sizes) if (n.alive(hand)) write(slot.transformSetLocalScale, hand, size);
    pending.set(player, { at: now() + GRACE * slowMotion(), hidden: run.hidden });
    const ik = n.alive(player) ? n.u32(player, field.PlayerController.PlayerIK) : 0;
    if (ik && n.alive(ik)) n.write(ik, field.PlayerIK.IsIKEnabled, Uint8Array.of(run.ik));
  }

  // A slap during another takes it over (its hidden weapon, saved hand scales and IK state), from the hands' pose,
  // after the owner lands the old one if its impact time came; one within GRACE of the last takes the still hidden
  // weapon back.
  net.on('slap', (hero, value) => {
    const old = runs.get(hero), ik = n.u32(hero, field.PlayerController.PlayerIK), waiting = pending.get(hero);
    pending.delete(hero);
    const before = old ? (now() - old.start) / slowMotion() : 0;
    if (old && !old.hit && hero === n.call(slot.playerMine, 0) && before >= SLAPS[old.index]!.impact) {
      land(hero, old, before);
    }
    if (old?.record && !old.hit) old.record.missed = true;
    const picked = picks.get(hero);
    picks.delete(hero);
    if (picked) {
      if (!elasticStrikes.has(hero)) elasticStrikes.set(hero, []);
      record(elasticStrikes.get(hero)!, picked);
    }
    runs.set(hero, { index: value % 3, start: now(), target: net.player(Math.floor(value / 3) - 1), hit: false,
      ik: old ? old.ik : ik && n.alive(ik) && !n.bool(ik, field.PlayerIK.IsIKEnabled) ? 0 : 1,
      hidden: old ? old.hidden : hide(hero, waiting?.hidden), sizes: old ? old.sizes : new Map(), record: picked });
  });

  /** One frame of `run` on `hero`: torso, arms, hands, the owner's hit. */
  function step(hero: number, run: Run, mine: boolean) {
    const spec = SLAPS[run.index]!, t = (now() - run.start) / slowMotion();
    if (run.record && run.record.frames.length < 64) run.record.frames.push(+t.toFixed(3));
    // Landed before the end check: a frame past the end still lands a slap whose impact time came between frames.
    if (mine && !run.hit && t >= spec.impact) land(hero, run, t);
    if (t >= spec.end) return finish(hero);
    const map = bones(hero);
    if (!map) return;
    const w = Math.min(ease(t / IN), 1 - ease(Math.max(0, (t - spec.follow) / (spec.end - spec.follow))));
    const fwd = forward(hero), up = [0, 1, 0], right = unit(cross(up, fwd));
    const ik = n.u32(hero, field.PlayerController.PlayerIK);
    if (ik && n.alive(ik)) n.write(ik, field.PlayerIK.IsIKEnabled, Uint8Array.of(0));
    /** `bone` turned by `turn` in world space, written as its local rotation. */
    const turnWorld = (bone: number, turn: Q) =>
      write(slot.transformSetLocalRotation, bone, mul(conj(world(parent(bone))), mul(turn, world(bone))));
    // The torso twists and leans into the swing, spread over the spine (about the world up and the body's right).
    const mirror = spec.arms.length === 1 && spec.arms[0] === 'R' ? -1 : 1;
    const yaw = mirror * curve(spec.yaw, t) * w, pitch = curve(spec.pitch, t) * w;
    for (const [name, part] of SPINE) {
      const bone = map.get(name);
      if (bone && n.alive(bone)) turnWorld(bone, mul(axisAngle(right, pitch * part), axisAngle(up, yaw * part)));
    }
    const sides = spec.arms.map(side => {
      const shoulder = map.get(`Shoulder_${side}`)!, elbow = map.get(`Elbow_${side}`)!, hand = map.get(`Hand_${side}`)!;
      return { side, shoulder, elbow, hand, out: side === 'L' ? scale(right, -1) : right };
    });
    // The clavicles draw the shoulders back in the wind-up and drive them forward into the hit (about up: positive
    // moves the left one's tip forward, the right one's back).
    for (const { side } of sides) {
      const clavicle = map.get(`Clavicle_${side}`);
      if (!clavicle || !n.alive(clavicle)) continue;
      turnWorld(clavicle, axisAngle(up, (side === 'L' ? 1 : -1) * curve(spec.clavicle, t) * w));
    }
    const arms: { side: string; k: number; need: number; base: number[] }[] = [];
    const middle = sides.length === 2
      ? scale(add(position(sides[0]!.shoulder), position(sides[1]!.shoulder)), 0.5) : null;
    for (const { side, shoulder, elbow, hand, out } of sides) {
      if (![shoulder, elbow, hand].every(bone => bone && n.alive(bone))) continue;
      const frame = (rel: V) => add(add(scale(out, rel[0]!), up, rel[1]!), fwd, rel[2]!);
      const pS = position(shoulder), from = run.from ?? (run.from = new Map());
      const start = from.get(side) ?? (() => { const rel = add(position(hand), pS, -1);
        const value = [dot(rel, out), dot(rel, up), dot(rel, fwd)]; from.set(side, value); return value; })();
      const hit = spec.clap
        ? add(add(add(middle!, fwd, spec.hit[2]!), up, spec.hit[1]!), out, spec.inward * curve(spec.size, t))
        : reachFrom(pS, run, frame(spec.hit));
      // The path: cocked back by the ear, an accelerating arc out and around to the hit, an elastic overshoot past it
      // along the swing, then the recoil across the body.
      const wound = add(pS, frame(spec.wound)), control = add(pS, frame(spec.control));
      const over = add(hit, unit(add(hit, control, -1)), spec.overshoot), recoil = add(pS, frame(spec.through));
      const begin = add(pS, frame(start)), flick = Math.min(spec.follow, spec.impact + FLICK);
      let target: V;
      if (t < spec.wind) target = add(begin, add(wound, begin, -1), ease(t / spec.wind));
      else if (t < spec.impact) {
        const u = ((t - spec.wind) / (spec.impact - spec.wind)) ** 2, v = 1 - u;
        target = add(add(scale(wound, v * v), control, 2 * u * v), hit, u * u);
      } else if (t < flick) target = add(hit, add(over, hit, -1), ease((t - spec.impact) / (flick - spec.impact)));
      else target = add(over, add(recoil, over, -1), ease(Math.min(1, (t - flick) / (spec.follow - flick))));
      // Stretch: the segments grow only past the share of their length the arm should span (`extension`), so the
      // elbow stays bent in the wind-up and the recoil and straightens at the hit: the forearm whips.
      const baseE = offset(elbow), baseH = offset(hand), a0 = length(baseE), b0 = length(baseH);
      const need = length(add(target, pS, -1));
      const k = 1 + (Math.max(1, need / ((a0 + b0) * curve(spec.extension, t))) - 1) * w;
      arms.push({ side, k, need, base: [a0, b0] });
      write(slot.transformSetLocalPosition, elbow, scale(baseE, k));
      write(slot.transformSetLocalPosition, hand, scale(baseH, k));
      // Two-bone IK: the elbow toward the phase's pole (wind-up, hit, recoil), the shoulder and the elbow aimed
      // (their animated twist kept).
      const a = a0 * k, b = b0 * k, d = Math.min(Math.max(need, Math.abs(a - b) + 1e-3), a + b - 1e-3);
      const [p0, p1, p2] = spec.pole as [V, V, V];
      const poleAt = t < spec.wind ? p0 : t < spec.impact
        ? add(p0, add(p1, p0, -1), ease((t - spec.wind) / (spec.impact - spec.wind)))
        : add(p1, add(p2, p1, -1), ease(Math.min(1, (t - spec.impact) / (spec.follow - spec.impact))));
      const n0 = unit(add(target, pS, -1)), pole = frame(poleAt);
      const m = unit(add(pole, n0, -dot(pole, n0)));
      const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
      const pE = add(pS, add(scale(n0, cosA), m, Math.sqrt(1 - cosA * cosA)), a);
      const animS = local(shoulder), qS = world(shoulder);
      const aimS = mul(fromTo(unit(rotate(qS, unit(baseE))), unit(add(pE, pS, -1))), qS);
      write(slot.transformSetLocalRotation, shoulder, nlerp(animS, mul(conj(world(parent(shoulder))), aimS), w));
      const animE = local(elbow), qE = world(elbow), atE = position(elbow);
      const aimE = mul(fromTo(unit(rotate(qE, unit(baseH))), unit(add(target, atE, -1))), qE);
      write(slot.transformSetLocalRotation, elbow, nlerp(animE, mul(conj(world(shoulder)), aimE), w));
      // The hand: the wrist lags behind the palm, then snaps through (spec.wrist); the palm toward the hit.
      const finger = map.get(`MiddleFinger_${side}_01`), thumb = map.get(`Thumb_${side}_01`);
      if (finger && thumb && n.alive(finger) && n.alive(thumb)) {
        const along = unit(offset(finger));
        const palmLocal = scale(unit(cross(along, unit(offset(thumb)))), side === 'R' ? 1 : -1);
        const forearm = unit(add(position(hand), position(elbow), -1));
        // The single slap's palm turns mostly toward the hit, so the giant hand shows to the camera behind.
        const facing = spec.clap ? scale(out, -1) : unit(add(scale(fwd, 0.85), unit(add(hit, wound, -1)), 0.5));
        const fingers = rotate(axisAngle(unit(cross(forearm, facing)), curve(spec.wrist, t)), forearm);
        const animH = local(hand), aimH = twoAxis(along, fingers, palmLocal, facing);
        write(slot.transformSetLocalRotation, hand, nlerp(animH, mul(conj(world(elbow)), aimH), w));
      }
      if (!run.sizes.has(hand)) run.sizes.set(hand, vector(slot.transformLocalScale, hand));
      const size = curve(spec.size, t);
      write(slot.transformSetLocalScale, hand, [size, size, size]);
    }
    elasticSlaps.set(hero, { index: run.index, t, hands: sides.map(() => curve(spec.size, t)),
      ik: ik && n.alive(ik) ? n.bool(ik, field.PlayerIK.IsIKEnabled) : null, arms });
  }

  frames.on('LOCAL_ELASTIC_SLAP', () => {
    const mine = n.call(slot.playerMine, 0);
    for (const [hero, run] of [...runs]) {
      if (!n.alive(hero) || n.bool(hero, field.PlayerController._isDead)) { finish(hero); continue; }
      step(hero, run, hero === mine);
    }
    for (const [player, { at }] of [...pending]) if (now() >= at || !n.alive(player)) show(player);
  });
  const install = await n.prepareHook(slot.dashPerform, [I32, I32, F64, I32], original =>
    (ability, player, timestamp, method) => {
      if (!elastic(player)) return original(ability, player, timestamp, method);
      try {
        if (player === n.call(slot.playerMine, 0)) {
          const cycle = cycles.get(player) ?? { index: -1, last: -Infinity }, t = now();
          cycle.index = t - cycle.last > RESET ? 0 : (cycle.index + 1) % 3;
          cycle.last = t;
          cycles.set(player, cycle);
          const target = cycle.index < 2 ? ahead(player, PICK) : 0, nearest = enemies(player)[0];
          picks.set(player, { index: cycle.index, target: target ? net.ownerId(target) : -1,
            d: nearest ? +nearest.d.toFixed(2) : null, angle: nearest ? Math.round(nearest.angle) : null, frames: [] });
          net.send('slap', player, cycle.index + 3 * ((target ? net.ownerId(target) : -1) + 1));
        }
      } catch (error) { console.error('LOCAL_ELASTIC_SLAP', String(error)); }
      return 0;
    }, 0);
  install();
}
