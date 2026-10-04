import type { Native } from '../../../src/page/native';
import { heroOf } from '../ids';
import { ease } from '../shared/motion';
import { readFloats } from '../shared/unity';
import { field, runtime, slot, staticField, typeInfo } from '../symbols';

/** Seconds a hero's shield takes to grow in and to shrink away before it ends. */
const EASE = 0.3;

/** Sphere radius (m) around the player's center, raised by the original BarrierHeightOffset. */
const RADIUS = 5;
/**
 * The sphere's rows: elevation (degrees) and shields, closed for the solid collider that stops shots (6×2.5×0.1; the
 * 6.5×3 one is a trigger; prefab GO 660): 2.5 m spans 28.6° of a 5 m meridian, so rows 28° apart; six close the
 * equator (hexagon side 5.8 m) and the ±28° rows (5.1 m), four the ±56° rows (5.6 m), one each pole. A wider sphere
 * leaves gaps that shots pass through.
 */
const ROWS: [number, number][] = [[-90, 1], [-56, 4], [-28, 6], [0, 6], [28, 6], [56, 4], [90, 1]];
/** [elevation, world yaw] of each barrier, in radians; every row starts half a step off world forward (+Z). */
const SPHERE = ROWS.flatMap(([elevation, count]) => Array.from({ length: count }, (_, index) =>
  [elevation * Math.PI / 180, (index + 0.5) * 2 * Math.PI / count] as const));

/**
 * Adaptation: the beam hero's sphere of Sentinel barriers (heroes/README.md, "The barrier sphere"). `spawn` runs the
 * original BarrierShockwaveAbility.Perform (slot 119429) for one barrier on his client;
 * BarrierShockwaveBehaviour.Update (slot 119455), hooked on every client, poses his barriers on SPHERE and eases their
 * shields in and out; `through` lets his own casts pass them.
 */
export async function installBeamBarriers(n: Native, sentinel: number) {
  const height = n.f32(sentinel, field.BarrierShockwaveAbility.BarrierHeightOffset);
  const levels = n.list(n.u32(sentinel, field.Ability.dataPerLevel), 32);
  /**
   * Barriers seen in their Update (so active), held (GC handle) until destroyed. PhotonNetwork.Destroy pools them and
   * Instantiate reuses them, so an entry belongs to one instantiation (its PhotonView's `instantiationDataField`):
   * its owner, sphere slot (-1 unless a hero's), whether it is parked (dismissed) and when it last updated.
   */
  const seen = new Map<number, { data: number; owner: number; index: number; handle: number; parked: boolean;
    last: number; born: number; end: number }>();
  /** Each shield VFX transform's own scale, read before this adapter first scaled it (pooled objects keep theirs). */
  const originals = new Map<number, number[]>();
  /** `barrier`'s shield VFX at `factor` of its own scale. */
  function shieldScale(barrier: number, factor: number) {
    const vfx = n.u32(barrier, field.BarrierShockwaveBehaviour._barrierVFX);
    if (!vfx || !n.alive(vfx)) return;
    const transform = n.check(n.call(slot.gameObjectTransform, vfx, 0));
    n.scratch(12, at => {
      let original = originals.get(transform);
      if (!original) {
        n.call(slot.transformLocalScale, transform, at, 0);
        originals.set(transform, original = [0, 4, 8].map(k => n.f32(at, k)));
      }
      original.forEach((value, k) => n.setF32(at, 4 * k, value * factor));
      n.call(slot.transformSetLocalScale, transform, at, 0);
    });
  }
  /** Owners whose barriers go (until this time, s): one still initializing when `dismiss` ran goes when first seen. */
  const doomed = new Map<number, number>();
  const now = () => performance.now() / 1000;
  /** Updated within the last half second: active, not back in the pool. */
  const active = (entry: { last: number }) => entry.last > now() - 0.5;
  /**
   * A dismissed barrier: the original ToggleBarrier(false) (slot 8422: its VFX and colliders off), then parked far
   * below until <PerformAbility>d__30 ends it as usual, whose shockwave reaches nobody there. PhotonNetwork.Destroy
   * would pool it with that wait pending, which later turns off the barrier reusing the object.
   */
  function park(barrier: number, entry: { parked: boolean }) {
    n.call(slot.toggleBarrier, barrier, 0, 0);
    entry.parked = true;
  }
  /** A random SPHERE slot that no shown barrier of `owner` holds (any slot once all are held). */
  function freeSlot(owner: number) {
    const held = new Set([...seen.values()].filter(entry => entry.owner === owner && active(entry) && !entry.parked)
      .map(entry => entry.index));
    const free = SPHERE.map((_, index) => index).filter(index => !held.has(index));
    const pool = free.length ? free : SPHERE.map((_, index) => index);
    return pool[Math.floor(Math.random() * pool.length)]!;
  }
  const hero = (player: number) => heroOf(n.textOrNull(n.call(slot.playerChampionId, player, 0))) === 'beam';

  function place(barrier: number, owner: number, index: number) {
    const center = readFloats(n, at => n.call(slot.playerCenterPosition, at, owner, 0));
    const [elevation, yaw] = SPHERE[index]!;
    const transform = n.check(n.call(slot.componentTransform, barrier, 0));
    // Unity's Euler(-elevation, yaw, 0) = yaw·pitch: the shield's normal (local Z) points out of the sphere.
    const [sy, cy, sx, cx] = [Math.sin(yaw / 2), Math.cos(yaw / 2), Math.sin(-elevation / 2), Math.cos(-elevation / 2)];
    n.scratch(16, at => {
      [center[0]! + Math.cos(elevation) * Math.sin(yaw) * RADIUS, center[1]! + height + Math.sin(elevation) * RADIUS,
        center[2]! + Math.cos(elevation) * Math.cos(yaw) * RADIUS].forEach((value, k) => n.setF32(at, 4 * k, value));
      n.call(slot.transformSetPosition, transform, at, 0);
      [cy * sx, sy * cx, -sy * sx, cy * cx].forEach((value, k) => n.setF32(at, 4 * k, value));
      n.call(slot.transformSetRotation, transform, at, 0);
    });
  }

  const install = await n.prepareHook(slot.barrierUpdate, 2, original => (barrier, method) => {
    original(barrier, method);
    try {
      for (const [object, { handle }] of seen) if (!n.alive(object)) { n.gcFree(handle); seen.delete(object); }
      const data = n.u32(n.check(n.call(slot.photonView, barrier, 0)), field.PhotonView.instantiationDataField);
      let entry = seen.get(barrier);
      if (entry && entry.data !== data) { n.gcFree(entry.handle); seen.delete(barrier); entry = undefined; }
      if (!entry) {
        // Until Initialize (async) finds this instantiation's owner, `_owner` is empty or a pooled leftover: its
        // OwnerID must match the instantiation data's PlayerId (get__ownerID, f42054).
        const owner = n.u32(barrier, field.BarrierShockwaveBehaviour._owner);
        const id = data ? n.i32(n.array(data, 8)[0]!, runtime.boxedValue) : null;
        if (!owner || n.call(slot.playerOwnerId, owner, 0) !== id) return 0;
        // It ends at its timestamp (instantiation data [1]) + its Duration for the owner's level.
        const level = Math.min(Math.max(n.call(slot.playerChampionLevel, owner, 0), 0), levels.length - 1);
        const end = n.f64(n.array(data, 8)[1]!, runtime.boxedValue) +
          n.f32(levels[level]!, runtime.boxedValue + field.BarrierShockwaveLevelData.Duration);
        seen.set(barrier, entry = { data, owner, index: hero(owner) ? freeSlot(owner) : -1, handle: n.gcAlloc(barrier),
          parked: false, last: now(), born: now(), end });
        if ((doomed.get(owner) ?? 0) > now()) park(barrier, entry);
      }
      entry.last = now();
      if (entry.parked) return n.scratch(12, at => {
        n.setF32(at, 4, -1000);
        n.call(slot.transformSetPosition, n.check(n.call(slot.componentTransform, barrier, 0)), at, 0);
        return 0;
      });
      if (entry.index < 0 || !n.alive(entry.owner)) {
        shieldScale(barrier, 1);
        return 0;
      }
      place(barrier, entry.owner, entry.index);
      shieldScale(barrier, Math.min(ease((now() - entry.born) / EASE),
        ease((entry.end - n.call(slot.photonTime, 0)) / EASE)));
    } catch (error) { console.error('LOCAL_BEAM_BARRIERS', String(error)); }
    return 0;
  }, 0);
  install();

  return {
    count: SPHERE.length,
    /** Runs `cast` with `player`'s shown barriers' colliders on the teammate layer, then puts them back. */
    through(player: number, cast: () => void) {
      const objects = [...seen].filter(([, entry]) => entry.owner === player && active(entry) && !entry.parked)
        .flatMap(([barrier]) => n.list(n.u32(barrier, field.BarrierShockwaveBehaviour._barrierColliders), 8))
        .map(collider => n.check(n.call(slot.componentGameObject, collider, 0)));
      const layers = objects.map(object => n.call(slot.gameObjectLayer, object, 0));
      const teammate = n.u32(n.staticFields(typeInfo.Layer), staticField.Layer.PlayerNoCollision);
      for (const object of objects) n.call(slot.gameObjectSetLayer, object, teammate, 0);
      try { cast(); } finally {
        objects.forEach((object, k) => n.call(slot.gameObjectSetLayer, object, layers[k]!, 0));
      }
    },
    /** Dismisses `player`'s barriers on this client, including any still initializing. */
    dismiss(player: number) {
      doomed.set(player, now() + 2);
      for (const [barrier, entry] of seen) if (entry.owner === player && active(entry) && !entry.parked) {
        park(barrier, entry);
      }
    },
    /** One barrier of `player` that ends at Photon time `until`: timestamp `until` − its Duration for the level. */
    spawn(player: number, until: number) {
      const level = Math.min(Math.max(n.call(slot.playerChampionLevel, player, 0), 0), levels.length - 1);
      const duration = n.f32(levels[level]!, runtime.boxedValue + field.BarrierShockwaveLevelData.Duration);
      n.call(slot.barrierPerform, sentinel, player, until - duration, 0);
    },
  };
}
