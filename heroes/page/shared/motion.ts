import type { Native } from '../../../src/page/native';
import { field, slot } from '../symbols';
import { mul, nlerp } from './vec';

/** clips.json in the beam hero's directory (`beam/` under `--heroes`; format in heroes/README.md). */
export interface HeroClip { fps: number; length: number; loop: boolean; additive?: boolean;
  bones: Record<string, number[][]>; rootY?: number[][]; marks?: Record<string, number> }
export type HeroClips = Record<string, HeroClip>;

/** Rest Hips.localPosition.y of the packs' shared skeleton (POSEIDON.prefab). */
const HIPS_Y = 0.8763;

/** Value of `keys` ([t, ...values]) at `t`: linear between neighbours, quaternions normalized (nlerp). */
function sampleKeys(keys: number[][], t: number) {
  let index = 0;
  while (index < keys.length - 1 && keys[index + 1]![0]! <= t) index++;
  const a = keys[index]!, b = keys[Math.min(index + 1, keys.length - 1)]!;
  const span = b[0]! - a[0]!, w = span > 0 ? Math.min(1, Math.max(0, (t - a[0]!) / span)) : 0;
  const sign = a.length === 5 && a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]! + a[4]! * b[4]! < 0 ? -1 : 1;
  const value = a.slice(1).map((v, k) => v + (sign * b[k + 1]! - v) * w);
  if (value.length !== 4) return value;
  const norm = Math.hypot(...value);
  return value.map(v => v / norm);
}

/** Smoothstep of `x` clamped to 0..1: the easing of every hero transition. */
export const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** `keys` ([t, value]) at `t`, eased between neighbours. */
export const curve = (keys: number[][], t: number) => {
  if (t <= keys[0]![0]!) return keys[0]![1]!;
  for (let k = 1; k < keys.length; k++) {
    const [t0, v0] = keys[k - 1]!, [t1, v1] = keys[k]!;
    if (t <= t1!) return v0! + (v1! - v0!) * ease((t - t0!) / (t1! - t0!));
  }
  return keys.at(-1)![1]!;
};

/**
 * Bone poses written after the Animator: for each player playing a clip, the clip's bones (by name, from the body
 * renderer's bones) get their sampled localRotation and Hips its localPosition.y. An additive clip turns each bone
 * by its key's turn from the first key over the Animator's rotation (and moves the Hips by its height's change), so it
 * starts and ends in the Animator's pose.
 * `weight` below 1 mixes the clip with the Animator's pose (its rotations and Hips height), for eased transitions.
 */
export function heroPoser(n: Native, clips: HeroClips) {
  const bones = new Map<number, Map<string, number>>();
  /**
   * Each additively posed bone's base (the Animator's rotation) and what went over it. A remote player's Animator
   * writes nothing off screen (vThirdPersonAnimator.HandleAnimatorUpdateTime, f118084: CullCompletely unless its
   * _photonView is mine): a bone still holding what went over it keeps its last base.
   */
  const bases = new Map<number, { base: number[]; wrote: number[] }>();
  /** The same for an additive clip's Hips height: the Animator's and what went over it. */
  const heights = new Map<number, { base: number; wrote: number }>();
  /** The player's bone Transforms by name, from its current body SkinnedMeshRenderer. */
  function boneMap(manager: number) {
    const body = n.u32(manager, field.PlayerSkinManager._currBody);
    const renderer = body ? n.list(n.u32(body, field.PlayerSkinPart.Renderers), 16)
      .find(item => n.alive(item) && n.className(item) === 'SkinnedMeshRenderer') : undefined;
    if (!renderer) return null;
    return new Map(n.array(n.call(slot.skinnedBones, renderer, 0), 128)
      .map(bone => [n.text(n.call(slot.objectName, bone, 0)), bone] as const));
  }
  return function pose(manager: number, name: string, t: number, weight = 1) {
    const clip = clips[name];
    if (!clip) throw new Error(`Unknown hero clip ${name}.`);
    let map = bones.get(manager);
    if (!map || [...map.values()].some(bone => !n.alive(bone))) {
      const found = boneMap(manager);
      if (!found) return false;
      bones.set(manager, map = found);
    }
    const time = Math.min(t, clip.length);
    n.scratch(16, at => {
      for (const [bone, keys] of Object.entries(clip.bones)) {
        const transform = map!.get(bone);
        if (!transform) continue;
        let value = sampleKeys(keys, time);
        if (clip.additive || weight < 1) {
          n.call(slot.transformLocalRotation, transform, at, 0);
          const current = [0, 4, 8, 12].map(k => n.f32(at, k));
          if (clip.additive) {
            const last = bases.get(transform);
            const base = last && current.every((v, k) => Math.abs(v - last.wrote[k]!) < 1e-5) ? last.base : current;
            const [x, y, z, w] = keys[0]!.slice(1);
            value = mul(nlerp([0, 0, 0, 1], mul(value, [-x!, -y!, -z!, w!]), weight), base);
            bases.set(transform, { base, wrote: value });
          } else value = nlerp(current, value, weight);
        }
        value.forEach((v, k) => n.setF32(at, 4 * k, v));
        n.call(slot.transformSetLocalRotation, transform, at, 0);
      }
      const hips = map!.get('Hips');
      if (clip.rootY && hips) {
        n.call(slot.transformLocalPosition, hips, at, 0);
        if (clip.additive) { // The height changes by the clip's change from its first key, over the Animator's.
          const current = n.f32(at, 4), last = heights.get(hips);
          const base = last && Math.abs(current - last.wrote) < 1e-5 ? last.base : current;
          const y = base + (sampleKeys(clip.rootY, time)[0]! - clip.rootY[0]![1]!) * weight;
          n.setF32(at, 4, y);
          heights.set(hips, { base, wrote: Math.fround(y) });
        } else {
          [0, HIPS_Y + sampleKeys(clip.rootY, time)[0]!, 0].forEach((value, k) =>
            n.setF32(at, 4 * k, n.f32(at, 4 * k) + (value - n.f32(at, 4 * k)) * weight));
        }
        n.call(slot.transformSetLocalPosition, hips, at, 0);
      }
    });
    return true;
  };
}
