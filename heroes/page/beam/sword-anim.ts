import type { Native } from '../../../src/page/native';
import { heroOf } from '../ids';
import type { HeroFrame } from '../shared/frame';
import { curve, ease } from '../shared/motion';
import { slowMotion } from '../shared/trace';
import { passFloats, readFloats } from '../shared/unity';
import { add, axisAngle, conj, cross, dot, fromTo, length, lerp, mul, nlerp, rotate, scale, unit, type Q, type V }
  from '../shared/vec';
import { field, slot, staticField, typeInfo } from '../symbols';
import type { SwordState } from './sword';
import { SWORD_TIERS, swordTier } from './sword-spec';

/**
 * The original pickaxe swing: the Animator's "PickaxeLayer" plays
 * "SwingLeft" or "SwingRight" (shortNameHash = CRC32 of the name; 0.883 s at speed 1) from the attack on, and the
 * clips' only event, OnWeaponAnimationEvent(0) "MeleeSwingHit" (→ MeleeWeaponModel.OnDamageTimeStart f106564), lands
 * at HIT s ("swing left" 0.1299, "swing right" 0.1348; abilitiesuxdata and skinpacks bundles). MeleeSwingBehaviour
 * moves the weapon to `_offHandTransform` ("LHandHolder") from the attack on and back to `_mainHandTransform` after.
 */
const LAYER = 'PickaxeLayer', SWINGS = new Set([-141514081, -1751194138]), HIT = 0.13;
/** Seconds the charge pose takes to come in, to go back to the Animator's, and to move between tiers. */
const IN = 0.2, OUT = 0.25, SHIFT = 0.25;
/** A released charge still sets the tier of a swing that starts within this many seconds. */
const GRACE = 0.35;

/**
 * One tier's swing (sword-spec.ts: plain, medium, max), in the right shoulder's frame [right, up, forward] (m)
 * for the hand and the body's frame for the blade: wound (also the charge pose, where the strike starts), the strike's
 * control point, the hit (at HIT), the follow-through end (at `follow`), the blend back to the Animator's by `end`;
 * the blade's direction at those points; torso yaw (degrees, + toward the left) and pitch (+ forward); the right
 * elbow's pole; whether the left hand joins the grip.
 */
interface Swing { wound: V; control: V; hit: V; through: V; follow: number; end: number;
  blades: { wound: V; hit: V; through: V }; yaw: number[][]; pitch: number[][]; pole: V; twoHands: boolean }
const SWINGS_BY_TIER: Swing[] = [
  // Plain: a quick flat slash from the right, across the chest to the left.
  { wound: [0.42, 0.02, -0.28], control: [0.5, 0, 0.42], hit: [-0.05, -0.02, 0.56], through: [-0.42, -0.12, 0.3],
    follow: 0.36, end: 0.72,
    blades: { wound: [0.55, 0.15, -0.8], hit: [-0.25, 0, 1], through: [-0.9, -0.15, -0.3] },
    yaw: [[0, -18], [HIT, 20], [0.36, 32], [0.72, 0]], pitch: [[0, 0], [HIT, 4], [0.36, 6], [0.72, 0]],
    pole: [0.6, -0.7, -0.3], twoHands: false },
  // Medium: drawn over the right shoulder, a diagonal cut down to the left hip.
  { wound: [0.28, 0.42, -0.22], control: [0.38, 0.35, 0.4], hit: [0, -0.12, 0.55], through: [-0.38, -0.38, 0.22],
    follow: 0.42, end: 0.8,
    blades: { wound: [0.25, 0.85, -0.45], hit: [-0.2, -0.35, 0.92], through: [-0.55, -0.8, 0.2] },
    yaw: [[0, -28], [HIT, 18], [0.42, 30], [0.8, 0]], pitch: [[0, -6], [HIT, 10], [0.42, 14], [0.8, 0]],
    pole: [0.8, -0.2, -0.3], twoHands: false },
  // Max: raised over the head in both hands, the body arched back, then slammed down in front.
  { wound: [0.12, 0.55, -0.12], control: [0.1, 0.55, 0.35], hit: [-0.12, -0.15, 0.5], through: [-0.1, -0.4, 0.35],
    follow: 0.5, end: 0.88,
    blades: { wound: [0, 0.25, -1], hit: [0, -0.5, 0.86], through: [0, -0.9, 0.4] },
    yaw: [[0, -6], [HIT, 0], [0.88, 0]], pitch: [[0, -16], [HIT, 22], [0.5, 26], [0.88, 0]],
    pole: [0.8, 0.1, 0.2], twoHands: true },
];
/** The left hand's guard while charging or swinging one-handed, and its counterbalance at the hit, in its frame. */
const GUARD = [0.12, -0.12, 0.38], BALANCE = [0.32, -0.18, -0.15];

/**
 * A charge or swing in progress: tier, start, the hand's start (swing), the swing's clock (`last`) and its Animator
 * state's seconds (`state`, which tells a new swing), the last targets and weight.
 */
interface Pose { kind: 'charge' | 'swing' | 'release'; tier: number; start: number; from?: V; last?: number;
  state?: number; hand?: V; blade?: V; yaw?: number; pitch?: number; weight?: number; ik: number;
  shift?: { from: number; at: number }; fromCharge?: boolean }
/** Beam players posed on this client (read by observe/sword-anim.ts). */
export const beamSwordAnims = new Map<number, { kind: string; tier: number; t: number; w: number; hand: V;
  blade: V; hit: boolean; shown: boolean }>();

/**
 * Adaptation: the sword's own motion on every client, written after the Animator (heroes/shared/frame.ts) over its
 * pose, without hooking the melee code (heroes/README.md, "Sword"): the Animator's own swing (LAYER in a SWINGS state)
 * timed to its MeleeSwingHit, the charge's wound pose, a two-bone arm IK with the blade along the swing, and the weapon
 * kept in the right hand. PlayerIK (IsIKEnabled +24) is off while a pose shows.
 */
export async function installBeamSwordAnim(n: Native, frames: HeroFrame,
  state: (player: number) => SwordState | null) {
  const now = () => performance.now() / 1000;
  const poses = new Map<number, Pose>();
  const layers = new Map<number, number>();
  /** Per weapon: its local pose under the main hand holder (measured idle) and its mesh renderers. */
  const grips = new Map<number, { position: V; rotation: Q }>();
  const meshes = new Map<number, number[]>();
  /** Bones this module turned: its last rotation, the one it started from, the player. */
  const written = new Map<number, { wrote: Q; base: Q; player: number }>();
  const vector = (call: number, transform: number, size = 3) =>
    readFloats(n, at => n.call(call, transform, at, 0), size);
  const write = (call: number, transform: number, values: V) =>
    passFloats(n, values, at => n.call(call, transform, at, 0));
  const position = (t: number) => vector(slot.transformPosition, t);
  const world = (t: number) => vector(slot.transformRotation, t, 4);
  const local = (t: number) => vector(slot.transformLocalRotation, t, 4);
  const offset = (t: number) => vector(slot.transformLocalPosition, t);
  const parent = (t: number) => n.call(slot.transformParent, t, 0);
  const tierIndex = (held: number) => SWORD_TIERS.indexOf(swordTier(held));
  const same = (a: Q, b: Q) => a.every((v, k) => Math.abs(v - b[k]!) < 1e-5);
  /** The bone's rotation as the Animator left it this frame, else the one this module started from. */
  function base(bone: number) {
    const current = local(bone), last = written.get(bone);
    return last && same(current, last.wrote) ? last.base : current;
  }
  function put(player: number, bone: number, value: Q, from: Q) {
    write(slot.transformSetLocalRotation, bone, value);
    written.set(bone, { wrote: value.map(Math.fround), base: from, player });
  }
  const players = () => {
    const manager = n.resolvedClass(typeInfo.PlayersManager)
      ? n.u32(n.staticFields(typeInfo.PlayersManager), staticField.PlayersManager.Instance) : 0;
    const all = manager ? n.u32(manager, field.PlayersManager._allPlayers) : 0;
    return (all ? n.dictionary(all) : []).map(([, player]) => player)
      .filter(player => n.alive(player) && !n.bool(player, field.PlayerController._isDead));
  };
  /**
   * The skeleton holding the weapon, from the hand its main hand holder hangs on: the arm up from it (elbow,
   * shoulder, clavicle), the chest (Spine_03) and the torso bone turned (Spine_02), the neck, and the other arm by the
   * mirrored names. The previous champion's skeleton stays under PolyPlayer (inactive, beside POSEIDON(Clone)), so
   * body bones read before the swap are stale, and the avatar maps RightHand to "Hand_L". Keys name the roles:
   * Shoulder_R, Elbow_R, Hand_R are the sword arm.
   */
  const maps = new Map<number, Map<string, number>>();
  function bones(weapon: number) {
    const main = n.u32(weapon, field.MeleeWeaponModel._mainHandTransform), hand = main ? parent(main) : 0;
    if (!hand || !n.alive(hand)) return null;
    let map = maps.get(hand);
    if (map && [...map.values()].every(bone => n.alive(bone))) return map;
    const elbow = parent(hand), shoulder = parent(elbow), clavicle = parent(shoulder), chest = parent(clavicle);
    const label = (bone: number) => n.textOrNull(n.call(slot.objectName, bone, 0)) ?? '';
    const side = label(hand).endsWith('_L') ? ['_L', '_R'] : ['_R', '_L'];
    const find = (above: number, bone: number) => {
      const other = label(bone).slice(0, -side[0]!.length) + side[1];
      return above && n.alive(above) ? n.call(slot.transformFind, above, n.newString(other), 0) : 0;
    };
    const clavicleL = find(chest, clavicle), shoulderL = find(clavicleL, shoulder), elbowL = find(shoulderL, elbow);
    const handL = find(elbowL, hand);
    map = new Map(Object.entries({ Spine_02: parent(chest), Neck: n.call(slot.transformFind, chest,
      n.newString('Neck'), 0), Shoulder_R: shoulder, Elbow_R: elbow, Hand_R: hand, Shoulder_L: shoulderL,
      Elbow_L: elbowL, Hand_L: handL }).filter(([, bone]) => bone && n.alive(bone)));
    maps.set(hand, map);
    return map;
  }
  /** Seconds into the PickaxeLayer's swing state (normalizedTime × length), or null outside one. */
  function swing(animator: number) {
    let layer = layers.get(animator);
    if (layer === undefined) {
      const count = n.call(slot.animatorLayerCount, animator, 0);
      layer = Array.from({ length: count }, (_, k) => k)
        .find(k => n.textOrNull(n.call(slot.animatorLayerName, animator, k, 0)) === LAYER) ?? -1;
      layers.set(animator, layer);
    }
    if (layer < 0) return null;
    return n.scratch(36, at => {
      n.call(slot.animatorStateInfo, at, animator, layer, 0);
      return SWINGS.has(n.i32(at, 0)) ? Math.min(n.f32(at, 12), 1) * n.f32(at, 16) : null;
    });
  }
  /**
   * The weapon's blade in the world now: from the grip (the weapon's root) toward the farthest corner of its largest
   * shown mesh renderer's bounds, snapped to that renderer's own principal axis (a weapon is modelled along one), so
   * it holds for the pickaxe (grip near the handle's end) and for a sword (grip at the hilt) alike, and follows the
   * mesh as PlayerIK.UpdateWeaponAnimationRotation (f106592) turns it inside the weapon.
   */
  function bladeNow(weapon: number) {
    let renderers = meshes.get(weapon);
    if (!renderers?.length || renderers.some(item => !n.alive(item))) {
      const type = n.call(slot.typeGetType, n.newString('UnityEngine.Renderer, UnityEngine.CoreModule'), 1, 0);
      const object = n.call(slot.componentGameObject, weapon, 0);
      meshes.set(weapon, renderers = n.array(n.call(slot.componentsInChildren, object, type, 1, 0), 64)
        .filter(item => n.alive(item) && ['MeshRenderer', 'SkinnedMeshRenderer'].includes(n.className(item))));
    }
    // The weapon keeps every skin's model under "Renders", only the shown one active (its Renderer.enabled stays true).
    const shown = (item: number) => n.call(slot.rendererEnabled, item, 0) === 1 &&
      n.call(slot.gameObjectActiveInHierarchy, n.call(slot.componentGameObject, item, 0), 0) === 1;
    const boxes = renderers.filter(shown).map(renderer =>
      ({ renderer, box: readFloats(n, at => n.call(slot.rendererBounds, renderer, at, 0), 6) }));
    const largest = boxes.sort((a, b) => b.box[3]! * b.box[4]! * b.box[5]! - a.box[3]! * a.box[4]! * a.box[5]!)[0];
    if (!largest) return null;
    const grip = position(n.call(slot.componentTransform, weapon, 0)), { box } = largest;
    let far: V = box.slice(0, 3), most = -1;
    for (let k = 0; k < 8; k++) {
      const corner = [0, 1, 2].map(c => box[c]! + ((k >> c) & 1 ? 1 : -1) * box[3 + c]!);
      const d = length(add(corner, grip, -1));
      if (d > most) { most = d; far = corner; }
    }
    const frame = world(n.call(slot.componentTransform, largest.renderer, 0));
    const inMesh = rotate(conj(frame), add(far, grip, -1));
    const axis = [0, 1, 2].reduce((best, c) => Math.abs(inMesh[c]!) > Math.abs(inMesh[best]!) ? c : best, 0);
    const snapped = [0, 0, 0];
    snapped[axis] = Math.sign(inMesh[axis]!) || 1;
    return rotate(frame, snapped);
  }

  function end(player: number) {
    const pose = poses.get(player);
    poses.delete(player);
    beamSwordAnims.delete(player);
    for (const [bone, entry] of written) {
      if (entry.player !== player) continue;
      if (n.alive(bone) && same(local(bone), entry.wrote)) write(slot.transformSetLocalRotation, bone, entry.base);
      written.delete(bone);
    }
    const ik = n.alive(player) ? n.u32(player, field.PlayerController.PlayerIK) : 0;
    if (pose && ik && n.alive(ik)) n.write(ik, field.PlayerIK.IsIKEnabled, Uint8Array.of(pose.ik));
  }
  const ikState = (player: number, pose?: Pose) => {
    if (pose) return pose.ik;
    const ik = n.u32(player, field.PlayerController.PlayerIK);
    return ik && n.alive(ik) && !n.bool(ik, field.PlayerIK.IsIKEnabled) ? 0 : 1;
  };

  /** One frame of `player`'s pose: torso, the sword arm, the left arm. */
  function draw(player: number, pose: Pose, map: Map<string, number>, target: { hand: V; blade: V; yaw: number;
    pitch: number; pole: V; left: V | 'grip'; w: number }, weapon: number) {
    const spine = map.get('Spine_02'), neck = map.get('Neck');
    const shoulder = map.get('Shoulder_R'), elbow = map.get('Elbow_R'), hand = map.get('Hand_R');
    if (![spine, shoulder, elbow, hand].every(bone => bone && n.alive(bone))) return;
    const ik = n.u32(player, field.PlayerController.PlayerIK);
    if (ik && n.alive(ik)) n.write(ik, field.PlayerIK.IsIKEnabled, Uint8Array.of(0));
    const w = target.w, up = [0, 1, 0];
    // Transform.get_forward returns through its first argument.
    const facing = readFloats(n, at => n.call(slot.transformForward, at, n.check(n.call(slot.componentTransform,
      player, 0)), 0));
    const fwd = unit([facing[0]!, 0, facing[2]!]), right = unit(cross(up, fwd));
    // The torso turns into the swing; the neck takes back part of the yaw so the gaze stays ahead.
    const turn = (bone: number, q: Q) => {
      const from = base(bone), above = world(parent(bone));
      put(player, bone, mul(conj(above), mul(q, mul(above, from))), from);
    };
    turn(spine!, mul(axisAngle(right, target.pitch * w), axisAngle(up, target.yaw * w)));
    if (neck && n.alive(neck)) turn(neck, axisAngle(up, -0.4 * target.yaw * w));
    const body = (rel: V, out: V) => add(add(scale(out, rel[0]!), up, rel[1]!), fwd, rel[2]!);
    const arm = (side: 'L' | 'R', goal: V, pole: V, out: V) => {
      const s = map.get(`Shoulder_${side}`), e = map.get(`Elbow_${side}`), h = map.get(`Hand_${side}`);
      if (![s, e, h].every(bone => bone && n.alive(bone))) return;
      const pS = position(s!), baseE = offset(e!), baseH = offset(h!), a = length(baseE), b = length(baseH);
      const d = Math.min(Math.max(length(add(goal, pS, -1)), Math.abs(a - b) + 1e-3), a + b - 1e-3);
      const n0 = unit(add(goal, pS, -1)), poleWorld = body(pole, out);
      const m = unit(add(poleWorld, n0, -dot(poleWorld, n0)));
      const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
      const pE = add(pS, add(scale(n0, cosA), m, Math.sqrt(1 - cosA * cosA)), a);
      const animS = base(s!), aboveS = world(parent(s!)), qS = mul(aboveS, animS);
      const aimS = mul(fromTo(unit(rotate(qS, unit(baseE))), unit(add(pE, pS, -1))), qS);
      put(player, s!, nlerp(animS, mul(conj(aboveS), aimS), w), animS);
      const animE = base(e!), aboveE = world(s!), qE = mul(aboveE, animE), atE = position(e!);
      const aimE = mul(fromTo(unit(rotate(qE, unit(baseH))), unit(add(add(pS, n0, d), atE, -1))), qE);
      put(player, e!, nlerp(animE, mul(conj(aboveE), aimE), w), animE);
    };
    const pR = position(shoulder!), goal = add(pR, body(target.hand, right));
    arm('R', goal, target.pole, right);
    // The hand turns so the blade (bladeNow, seen from the weapon's root and carried to Hand_R's frame through the main
    // hand holder and the weapon's pose there) points along the swing.
    const grip = weapon ? grips.get(weapon) : undefined, bladeWorld = unit(body(target.blade, right));
    const main = weapon ? n.u32(weapon, field.MeleeWeaponModel._mainHandTransform) : 0;
    const transform = weapon ? n.call(slot.componentTransform, weapon, 0) : 0;
    const current = weapon ? bladeNow(weapon) : null;
    if (grip && main && n.alive(main) && current) {
      const fromRoot = rotate(conj(world(transform)), current);
      const bladeLocal = unit(rotate(mul(local(main), grip.rotation), fromRoot));
      const animH = base(hand!), aboveH = world(elbow!), qH = mul(aboveH, animH);
      const aimH = mul(fromTo(unit(rotate(qH, bladeLocal)), bladeWorld), qH);
      put(player, hand!, nlerp(animH, mul(conj(aboveH), aimH), w), animH);
    }
    const left = scale(right, -1), shoulderL = map.get('Shoulder_L'), pL = shoulderL ? position(shoulderL) : pR;
    const leftGoal = target.left === 'grip' ? add(position(hand!), bladeWorld, -0.11)
      : add(pL, body(target.left, left));
    arm('L', leftGoal, [0.8, -0.6, -0.2], left);
    beamSwordAnims.set(player, { kind: pose.kind, tier: pose.tier, t: now() - pose.start, w, hand: target.hand,
      blade: target.blade, hit: pose.kind === 'swing' && (pose.last ?? 0) >= HIT, shown: false });
  }
  /** The weapon shown in the right hand while the original holds it elsewhere (LHandHolder). */
  function holdRight(weapon: number) {
    const grip = grips.get(weapon), main = n.u32(weapon, field.MeleeWeaponModel._mainHandTransform);
    const transform = n.call(slot.componentTransform, weapon, 0);
    if (!grip || !main || !n.alive(main) || parent(transform) === main) return false;
    const qD = world(main), pD = position(main);
    write(slot.transformSetPosition, transform, add(pD, rotate(qD, grip.position)));
    write(slot.transformSetRotation, transform, mul(qD, grip.rotation));
    return true;
  }

  /** The charge pose for the tier `held` reaches (its swing's wound pose), easing between tiers. */
  function chargeTarget(pose: Pose, held: number, t: number) {
    const index = tierIndex(held);
    if (index !== pose.tier) { pose.shift = { from: pose.tier, at: t }; pose.tier = index; }
    const k = pose.shift ? ease(Math.min(1, (t - pose.shift.at) / SHIFT)) : 1;
    const a = SWINGS_BY_TIER[pose.shift?.from ?? index]!, b = SWINGS_BY_TIER[index]!;
    const tremble = 0.003 + 0.012 * Math.min(1, held / SWORD_TIERS[2].from);
    const shake = [Math.sin(2 * Math.PI * 15 * t) * tremble, Math.sin(2 * Math.PI * 19 * t + 1) * tremble * 0.6, 0];
    return { hand: add(lerp(a.wound, b.wound, k), shake), blade: unit(lerp(a.blades.wound, b.blades.wound, k)),
      yaw: a.yaw[0]![1]! + (b.yaw[0]![1]! - a.yaw[0]![1]!) * k,
      pitch: a.pitch[0]![1]! + (b.pitch[0]![1]! - a.pitch[0]![1]!) * k, pole: b.pole,
      left: (b.twoHands && k > 0.5 ? 'grip' : GUARD) as V | 'grip' };
  }
  /** The swing's targets `t` s in, from the hand's start (relative to the right shoulder). */
  function swingTarget(pose: Pose, t: number) {
    const spec = SWINGS_BY_TIER[pose.tier]!, from = pose.from ?? spec.wound, wind = pose.fromCharge ? 0 : 0.05;
    let hand: V, blade: V;
    if (t < wind) {
      hand = lerp(from, spec.wound, ease(t / wind));
      blade = unit(lerp(pose.blade ?? spec.blades.wound, spec.blades.wound, ease(t / wind)));
    } else if (t < HIT) {
      const u = ((t - wind) / (HIT - wind)) ** 2, v = 1 - u, start = pose.fromCharge ? from : spec.wound;
      hand = add(add(scale(start, v * v), spec.control, 2 * u * v), spec.hit, u * u);
      blade = unit(lerp(pose.fromCharge && pose.blade ? pose.blade : spec.blades.wound, spec.blades.hit, u));
    } else {
      const u = ease(Math.min(1, (t - HIT) / (spec.follow - HIT)));
      hand = lerp(spec.hit, spec.through, u);
      blade = unit(lerp(spec.blades.hit, spec.blades.through, u));
    }
    const w = (pose.fromCharge ? 1 : ease(Math.min(1, t / 0.05))) *
      (1 - ease(Math.max(0, (t - spec.follow) / (spec.end - spec.follow))));
    const left = spec.twoHands ? 'grip' as const : lerp(GUARD, BALANCE, curve([[0, 0], [HIT, 1], [spec.end, 0]], t));
    return { hand, blade, yaw: curve(spec.yaw, t), pitch: curve(spec.pitch, t), pole: spec.pole, left, w };
  }

  frames.on('LOCAL_BEAM_SWORD_ANIM', () => {
    const t = now(), slow = slowMotion();
    for (const player of poses.keys()) {
      if (!n.alive(player) || n.bool(player, field.PlayerController._isDead)) end(player);
    }
    for (const player of players()) {
      if (heroOf(n.textOrNull(n.call(slot.playerChampionId, player, 0))) !== 'beam') continue;
      try { frame(player, t, slow); } catch (error) {
        console.error('LOCAL_BEAM_SWORD_ANIM', String(error));
        end(player);
      }
    }
  });
  /** One frame of a beam player: the swing, the charge or the release, and the weapon in the right hand. */
  function frame(player: number, t: number, slow: number) {
    const weapons = n.u32(player, field.PlayerController._weaponsController);
    const weapon = weapons ? n.u32(weapons, field.WeaponsController.CurrentWeapon) : 0;
    const melee = !!weapon && n.alive(weapon) && n.className(weapon) === 'MeleeWeaponModel';
    const animator = weapons ? n.u32(weapons, field.WeaponsController._animator) : 0;
    if (!animator || !n.alive(animator)) return;
    const map = melee ? bones(weapon) : null;
    if (!map) {
      if (poses.has(player)) end(player);
      return;
    }
    const seconds = melee && animator && n.alive(animator) ? swing(animator) : null;
    let pose = poses.get(player);
    // Idle, the weapon in the main hand: its local pose there.
    if (melee && seconds === null && !pose && !grips.has(weapon)) {
      const transform = n.call(slot.componentTransform, weapon, 0);
      const main = n.u32(weapon, field.MeleeWeaponModel._mainHandTransform);
      if (main && parent(transform) === main) {
        grips.set(weapon, { position: offset(transform), rotation: local(transform) });
      }
    }
    const known = state(player), held = known?.charging ? known.charge : null;
    if (seconds !== null) {
      if (!pose || pose.kind !== 'swing' || seconds + 0.05 < (pose.state ?? 0)) {
        const fromCharge = pose?.kind === 'charge' || pose?.kind === 'release';
        const tiered = known?.swingStart !== undefined && t - known.swingStart < GRACE;
        poses.set(player, pose = { kind: 'swing', tier: tiered ? known!.swingTier ?? 0 : 0, start: t,
          from: pose?.hand, blade: pose?.blade, fromCharge, ik: ikState(player, pose) });
      }
      pose.state = seconds;
      const at = slow > 1 ? (t - pose.start) / slow : seconds;
      pose.last = at;
      if (at >= SWINGS_BY_TIER[pose.tier]!.end) end(player);
      else draw(player, pose, map, swingTarget(pose, at), melee ? weapon : 0);
    } else if (pose?.kind === 'swing') { // The Animator left the swing: the follow-through ends on this clock.
      const at = slow > 1 ? (t - pose.start) / slow : Math.max(pose.last ?? 0, t - pose.start);
      pose.last = at;
      if (at >= SWINGS_BY_TIER[pose.tier]!.end) end(player);
      else draw(player, pose, map, swingTarget(pose, at), melee ? weapon : 0);
    } else if (held !== null && melee) {
      if (pose?.kind !== 'charge') {
        poses.set(player, pose = { kind: 'charge', tier: 0, start: t, ik: ikState(player, pose) });
      }
      const target = chargeTarget(pose, held, t), w = ease(Math.min(1, (t - pose.start) / IN));
      draw(player, pose, map, { ...target, w }, weapon);
      Object.assign(pose, { hand: target.hand, blade: target.blade, yaw: target.yaw, pitch: target.pitch, weight: w });
    } else if (pose) { // Let go without a swing: the charge pose eases back to the Animator's.
      if (pose.kind === 'charge') Object.assign(pose, { kind: 'release', start: t });
      const w = (pose.weight ?? 1) * (1 - ease(Math.min(1, (t - pose.start) / OUT)));
      const spec = SWINGS_BY_TIER[pose.tier]!;
      if (w <= 0.001) end(player);
      else draw(player, pose, map, { hand: pose.hand ?? spec.wound, blade: pose.blade ?? spec.blades.wound,
        yaw: pose.yaw ?? 0, pitch: pose.pitch ?? 0, pole: spec.pole, left: spec.twoHands ? 'grip' : GUARD, w },
      melee ? weapon : 0);
    }
    const shown = melee && holdRight(weapon), entry = beamSwordAnims.get(player);
    if (entry) entry.shown = shown;
  }
}
