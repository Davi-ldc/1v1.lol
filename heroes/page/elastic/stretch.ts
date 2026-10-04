import type { Native } from '../../../src/page/native';
import type { HeroFrame } from '../shared/frame';
import { ease } from '../shared/motion';
import type { HeroNet } from '../shared/net';
import { array, core, floats, passFloats, readFloats } from '../shared/unity';
import { sub } from '../shared/vec';
import { field, literal, slot } from '../symbols';

/** The right button held this long (s) grows the legs to LEGS times their length in EASE seconds; released, they ease
 *  back. */
const HOLD = 0.25, LEGS = 1.8, EASE = 0.3;
/** The legs of an elastic hero in the menu (lobby, party, overview: no player), as a factor of their length. */
export const MENU_LEGS = 0.88;
/**
 * ApplySpeedMultiplier(100) (slot 8445: generalSpeedMultiplier ×2): twice the speed. Walking with W alone already moves
 * on the sprint table, 6.0 m/s, so 50 gives only 1.5× (9.2 m/s).
 */
const SPEED = 100;

interface Mesh { bones: string[]; bindposes: number[][]; positions: number[]; boneIndices: number[];
  boneWeights: number[] }
interface Look { renderer(manager: number): number | undefined; legs(manager: number, factor: number): void;
  mesh(skin: string): number; managers(): number[] }

/**
 * The blend shape that takes the legs to `factor` times their length in the bind pose while the knees and ankles
 * translate (shared/look.ts `legs`): each vertex moves along its leg bones' segments in proportion to where it lies in
 * them (w_UpperLeg · t_thigh · e_thigh + w_LowerLeg · t_shin · e_shin), so each segment changes evenly, the knee stays
 * whole and the feet ride the ankles. Also the standing height it adds, in mesh units.
 */
function stretchShape(mesh: Mesh, factor: number) {
  const origin = (bone: string) => { // a rigid bindpose's bone origin in mesh space: -Rᵀt
    const m = mesh.bindposes[mesh.bones.indexOf(bone)]!;
    return [0, 1, 2].map(c => -(m[c * 4]! * m[12]! + m[c * 4 + 1]! * m[13]! + m[c * 4 + 2]! * m[14]!));
  };
  const segments = ['L', 'R'].flatMap(side => {
    const hip = origin(`UpperLeg_${side}`), knee = origin(`LowerLeg_${side}`), ankle = origin(`Ankle_${side}`);
    return [[`UpperLeg_${side}`, hip, knee], [`LowerLeg_${side}`, knee, ankle]] as const;
  }).map(([bone, from, to]) => ({ bone: mesh.bones.indexOf(bone), from, axis: sub(to, from),
    grow: sub(to, from).map(v => v * (factor - 1)) }));
  const count = mesh.positions.length / 3, deltas = new Array<number>(count * 3).fill(0);
  for (let v = 0; v < count; v++) {
    const p = mesh.positions.slice(v * 3, v * 3 + 3);
    for (let k = 0; k < 4; k++) {
      const segment = segments.find(item => item.bone === mesh.boneIndices[v * 4 + k]);
      const w = mesh.boneWeights[v * 4 + k]!;
      if (!segment || !w) continue;
      const d = sub(p, segment.from), a = segment.axis;
      const t = Math.min(1, Math.max(0, (d[0]! * a[0]! + d[1]! * a[1]! + d[2]! * a[2]!) /
        (a[0]! ** 2 + a[1]! ** 2 + a[2]! ** 2)));
      for (let c = 0; c < 3; c++) deltas[v * 3 + c] += w * t * segment.grow[c]!;
    }
  }
  const rise = ['L', 'R'].map(side => origin(`UpperLeg_${side}`)[1]! - origin(`Ankle_${side}`)[1]!);
  return { deltas, rise: (factor - 1) * (rise[0]! + rise[1]!) / 2 };
}

/**
 * Adaptation: the elastic hero's legs (heroes/README.md, "Right mouse button: stretch"). His owner reads
 * InputManager.GetButton(Aim) after the Animator and sends `stretch`; every client eases the leg bones' targets, the
 * mesh's "stretch" blend shape and the hitbox, and the owner moves twice as fast with its camera following the height.
 * In the menu (a PlayerSkinManager without a PlayerController) the legs show at MENU_LEGS through a "menu" blend shape.
 */
export function installElasticStretch(n: Native, champion: string, skin: string, mesh: Mesh, look: Look,
  frames: HeroFrame, net: HeroNet) {
  const shape = stretchShape(mesh, LEGS), scan = n.check(look.mesh(skin));
  for (const [name, deltas] of [['stretch', shape.deltas], ['menu', stretchShape(mesh, MENU_LEGS).deltas]] as const) {
    n.call(slot.meshAddBlendShapeFrame, scan, n.newString(name), 100,
      array(n, core('Vector3'), deltas.length / 3, floats(deltas)), 0, 0, 0);
  }
  /** Blend shape `index` (0 stretch, 1 menu) of `manager`'s body at `weight`, while it shows this mesh. */
  const weigh = (manager: number, index: number, weight: number) => {
    const renderer = look.renderer(manager);
    if (renderer && n.call(slot.skinnedSharedMesh, renderer, 0) === scan) {
      n.call(slot.skinnedSetBlendShapeWeight, renderer, index, weight, 0);
    }
  };
  const menus = new Set<number>();
  const now = () => performance.now() / 1000;
  const elastic = (player: number) => n.textOrNull(n.call(slot.playerChampionId, player, 0)) === champion;
  const vector = (call: (at: number) => void) => readFloats(n, call);
  type Capsule = { collider: number; height: number; center: number[]; along?: number };
  /** Each stretching player (GC handle held) and its own collider sizes, center offset and camera height. */
  const states = new Map<number, { from: number; to: number; since: number; handle: number; capsules: Capsule[];
    offset: number; camera: number; height: number }>();
  const level = ({ from, to, since }: { from: number; to: number; since: number }) =>
    from + (to - from) * ease((now() - since) / EASE);
  const owner = { player: 0, down: 0, sent: 0, fast: false };

  /** The player's capsules as they are: motor and legs (grow upward), the pack's leg limbs (lengthen). */
  function capsules(player: number) {
    const motor = n.u32(player, field.PlayerController._thirdPersonController);
    const manager = n.u32(player, field.PlayerController._playerSkinManager);
    const pack = manager ? n.u32(manager, field.PlayerSkinManager._curSkinPack) : 0;
    const read = (collider: number, along?: number): Capsule => ({ collider, along,
      height: n.call(slot.capsuleHeight, collider, 0),
      center: vector(at => n.call(slot.capsuleCenter, collider, at, 0)) });
    const roots = motor ? [n.u32(motor, field.vThirdPersonMotor._capsuleCollider),
      n.u32(motor, field.vThirdPersonController._legsCollider)] : [];
    const onLeg = (collider: number) => { // on a thigh or shin bone, or on a child of one
      const own = n.call(slot.componentTransform, collider, 0);
      return [own, n.call(slot.transformParent, own, 0)].some(item => item &&
        /^(UpperLeg|LowerLeg)_[LR]$/.test(n.text(n.call(slot.objectName, item, 0))));
    };
    const limbs = (pack ? n.list(n.u32(pack, field.SkinPack.PlayerColliders), 64) : []).filter(collider =>
      n.alive(collider) && n.className(collider) === 'CapsuleCollider' && onLeg(collider));
    return [...roots.filter(collider => collider && n.alive(collider)).map(collider => read(collider)),
      ...limbs.map(collider => read(collider, n.call(slot.capsuleDirection, collider, 0)))];
  }
  function camera(player: number) {
    const input = n.u32(player, field.PlayerController.ThirdPersonInput);
    return input ? n.u32(input, field.vThirdPersonInput._tpCamera) : 0;
  }
  /** Look and hitbox of `player` at stretch `s` (0..1), from its own values. */
  function apply(player: number, state: NonNullable<ReturnType<typeof states.get>>, s: number) {
    const manager = n.u32(player, field.PlayerController._playerSkinManager);
    if (manager) {
      look.legs(manager, 1 + s * (LEGS - 1));
      weigh(manager, 0, 100 * s);
    }
    const rise = s * shape.rise;
    for (const { collider, height, center, along } of state.capsules) {
      if (!n.alive(collider)) continue;
      const grow = along === undefined ? rise : (LEGS - 1) * s * height;
      n.call(slot.capsuleSetHeight, collider, height + grow, 0);
      const moved = [...center];
      if (along === undefined) moved[1] += grow / 2;
      else moved[along] *= 1 + (LEGS - 1) * s;
      passFloats(n, moved, at => n.call(slot.capsuleSetCenter, collider, at, 0));
    }
    n.setF32(player, field.PlayerController._centerHeightOffset, state.offset + rise / 2);
    if (state.camera && n.alive(state.camera)) n.call(slot.cameraSetHeight, state.camera, state.height + rise, 0);
  }

  net.on('stretch', (player, value) => {
    if (!elastic(player)) return;
    const state = states.get(player), mine = player === n.call(slot.playerMine, 0), cam = mine ? camera(player) : 0;
    states.set(player, state ? { ...state, from: level(state), to: value ? 1 : 0, since: now() } : {
      from: 0, to: value ? 1 : 0, since: now(), handle: n.gcAlloc(player), capsules: capsules(player),
      offset: n.f32(player, field.PlayerController._centerHeightOffset), camera: cam,
      height: cam ? n.f32(cam, field.vThirdPersonCamera.targetHeight) : 0 });
    if (mine && !!value !== owner.fast) { // Twice as fast while grown (the motor runs on its owner).
      const motor = n.check(n.u32(player, field.PlayerController._thirdPersonController));
      n.call(value ? slot.applySpeedMultiplier : slot.removeSpeedMultiplier, motor, SPEED, 0);
      owner.fast = !!value;
    }
  });

  frames.on('LOCAL_ELASTIC_STRETCH', () => {
    const listed = look.managers();
    for (const manager of listed) {
      const player = n.u32(manager, field.PlayerSkinManager._playerController);
      if (!(player && n.alive(player)) && n.textOrNull(n.u32(manager, field.PlayerSkinManager.CurrSkinID)) === skin) {
        look.legs(manager, MENU_LEGS);
        weigh(manager, 1, 100);
        menus.add(manager);
      } else if (menus.delete(manager)) {
        look.legs(manager, 1);
        weigh(manager, 1, 0);
      }
    }
    for (const manager of menus) if (!listed.includes(manager)) menus.delete(manager);
    const mine = n.call(slot.playerMine, 0);
    if (mine !== owner.player) Object.assign(owner, { player: mine, down: 0, sent: 0, fast: false });
    if (mine && n.alive(mine) && elastic(mine)) {
      const down = n.call(slot.button, literal.aimAction, 0) === 1;
      owner.down = down ? owner.down || now() : 0;
      const want = owner.down && now() - owner.down >= HOLD ? 1 : 0;
      if (want !== owner.sent) { owner.sent = want; net.send('stretch', mine, want); }
    }
    for (const [player, state] of states) {
      if (!n.alive(player)) { n.gcFree(state.handle); states.delete(player); continue; }
      const s = level(state);
      apply(player, state, s);
      if (state.to === 0 && s === 0) { n.gcFree(state.handle); states.delete(player); }
    }
  });
  return { legs: LEGS, rise: shape.rise };
}
