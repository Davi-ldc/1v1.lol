import type { Native } from '../../../src/page/native';
import type { BeamMesh } from '../shared/look';
import { readFloats } from '../shared/unity';
import { add, length, lerp, scale, sub, type V } from '../shared/vec';
import { field, runtime, slot, staticField, typeInfo } from '../symbols';
import { installBeamBend } from './bend';
import { beamLocks } from './lock-on';

/** Seconds to blend between the straight beam and the curve as the lock changes, so it never jumps. */
const BLEND = 0.12;
/** Straight segments a curved beam is cast along, each through the original Populate. */
const SEGMENTS = 16;
/** Bytes of a RaycastHit and of an AquaCannonContactPoint {RaycastHitIndex, Damageable, PlayerController}. */
const HIT = 44, CONTACT = 12;
/** Building and its subclasses (re/data/il2cpp/types.tsv): the builds a contact's damageable can be. */
const BUILDS = new Set(['Building', 'SimpleEditableBuilding', 'DirectionalEditableBuilding', 'WallBuilding',
  'FloorBuilding', 'RampBuilding', 'RoofBuilding']);

/** Each beam player's beam hue (°) while his release runs, on this client (set by beam/ability.ts). */
export const beamTints = new Map<number, number>();

const bezier = ([p0, p1, p2]: V[], t: number) =>
  p0!.map((value, k) => (1 - t) * (1 - t) * value + 2 * (1 - t) * t * p1![k]! + t * t * p2![k]!);

/**
 * The beam hero's beam on every client: AquaCannonBehaviour.Update (slot 119253) for his behaviour runs the original
 * pieces by slot (UpdateAiming 8354, PopulateAquaCannonContactPoints 8355, HandleCannonMovement 8356,
 * ApplyHitsInAquaCannonContactPoints 119260) with his own barriers letting his casts through, bent along a locked
 * target's curve (heroes/README.md, "The beam"). Adaptation: walls in the beam break at once (KillBuilding, slot 9039).
 */
export async function installBeamCannon(n: Native, barriers: { through(player: number, cast: () => void): void },
  hero: (player: number) => boolean, beam?: BeamMesh) {
  const C = field.AquaCannonBehaviour, L = field.AquaCannonLevelData;
  const vector = (base: number, offset: number) => [0, 4, 8].map(k => n.f32(base, offset + k));
  const setVector = (base: number, offset: number, value: V) =>
    value.forEach((component, k) => n.setF32(base, offset + 4 * k, component));
  const center = (player: number) => readFloats(n, at => n.call(slot.playerCenterPosition, at, player, 0));
  // By behaviour: the blend toward the curve (0..1), the last locked target's center, seconds since the owner's last
  // hit tick, the builds it destroyed.
  const states = new Map<number, { weight: number; end?: V; tick: number; killed: Set<number> }>();

  /** This frame's curve [origin, control, end] after UpdateAiming, or null for the straight beam. */
  function curve(cannon: number, player: number, state: { weight: number; end?: V }, dt: number) {
    const target = beamLocks.get(player) ?? 0;
    const live = target && n.alive(target) && !n.bool(target, field.PlayerController._isDead);
    if (live) state.end = center(target);
    state.weight = Math.min(1, Math.max(0, state.weight + (live ? dt : -dt) / BLEND));
    if (!state.weight || !state.end) return null;
    const origin = vector(cannon, C._currentOriginPoint), way = vector(cannon, C._currentDirection);
    const reach = n.f32(cannon, C._abilityLevelData + L.MaxDistance), unit = scale(way, 1 / (length(way) || 1));
    const half = length(sub(state.end, origin)) / 2, w = state.weight * state.weight * (3 - 2 * state.weight);
    return [origin, add(origin, scale(unit, reach / 2 + (half - reach / 2) * w)),
      lerp(add(origin, scale(unit, reach)), state.end, w)];
  }

  /**
   * Populate along `bend` in SEGMENTS, its results gathered into the behaviour's arrays as one cast's; returns the
   * curve parameter where an obstacle cut it (1 for none).
   */
  function castAlong(cannon: number, bend: V[]) {
    const origin = n.read(cannon, C._currentOriginPoint, 12), direction = n.read(cannon, C._currentDirection, 12);
    const reach = n.f32(cannon, C._abilityLevelData + L.MaxDistance);
    const points = Array.from({ length: SEGMENTS + 1 }, (_, index) => bezier(bend, index / SEGMENTS));
    const hits: { hit: Uint8Array; damageable: number; player: number }[] = [];
    let obstacle: Uint8Array | undefined, until = 1;
    for (let index = 0; index < SEGMENTS && !obstacle; index++) {
      const from = points[index]!, way = sub(points[index + 1]!, from);
      setVector(cannon, C._currentOriginPoint, from);
      setVector(cannon, C._currentDirection, way);
      n.setF32(cannon, C._abilityLevelData + L.MaxDistance, length(way));
      n.call(slot.aquaCannonPopulate, cannon, 0);
      const contacts = n.u32(cannon, C._aquaCannonHitPlayers), raycasts = n.u32(cannon, C._raycastHits);
      for (let k = 0; k < n.i32(cannon, C._aquaCannonHitPlayersLength); k++) {
        const at = runtime.arrayData + CONTACT * k, damageable = n.u32(contacts, at + 4);
        if (hits.some(hit => hit.damageable === damageable)) continue;
        hits.push({ hit: n.read(raycasts, runtime.arrayData + HIT * n.i32(contacts, at), HIT), damageable,
          player: n.u32(contacts, at + 8) });
      }
      if (!n.bool(cannon, C._wasCannonStoppedByObstacle)) continue;
      obstacle = n.read(cannon, C._lastHit, HIT);
      until = (index + n.f32(cannon, C._lastHit + field.RaycastHit.m_Distance) / (length(way) || 1)) / SEGMENTS;
    }
    n.write(cannon, C._currentOriginPoint, origin);
    n.write(cannon, C._currentDirection, direction);
    n.setF32(cannon, C._abilityLevelData + L.MaxDistance, reach);
    const contacts = n.u32(cannon, C._aquaCannonHitPlayers), raycasts = n.u32(cannon, C._raycastHits);
    const count = Math.min(hits.length, n.u32(contacts, runtime.arrayLength), n.u32(raycasts, runtime.arrayLength));
    hits.slice(0, count).forEach(({ hit, damageable, player }, k) => {
      n.write(raycasts, runtime.arrayData + HIT * k, hit);
      n.setI32(contacts, runtime.arrayData + CONTACT * k, k);
      n.setU32(contacts, runtime.arrayData + CONTACT * k + 4, damageable);
      n.setU32(contacts, runtime.arrayData + CONTACT * k + 8, player);
    });
    n.setI32(cannon, C._aquaCannonHitPlayersLength, count);
    n.write(cannon, C._wasCannonStoppedByObstacle, Uint8Array.of(obstacle ? 1 : 0));
    if (obstacle) n.write(cannon, C._lastHit, obstacle);
    return until;
  }
  const bender = installBeamBend(n, beam);
  /** Destroys the non-static builds among `cannon`'s contact points, each once (KillBuilding's RPC runs on all). */
  function breakWalls(cannon: number, killed: Set<number>) {
    const controller = n.resolvedClass(typeInfo.BuildingNetworkController)
      ? n.u32(n.staticFields(typeInfo.BuildingNetworkController), staticField.BuildingNetworkController.Instance) : 0;
    const contacts = n.u32(cannon, C._aquaCannonHitPlayers);
    if (!controller || !contacts) return;
    for (let k = 0; k < n.i32(cannon, C._aquaCannonHitPlayersLength); k++) {
      const build = n.u32(contacts, runtime.arrayData + CONTACT * k + 4);
      if (!build || killed.has(build) || !n.alive(build) || !BUILDS.has(n.className(build))) continue;
      if (n.bool(build, field.Building.IsStatic) || n.bool(build, field.Building._isDestroySignaled)) continue;
      killed.add(build);
      n.call(slot.killBuilding, controller, n.check(n.u32(build, field.Building.ID)), 0);
    }
  }

  const install = await n.prepareHook(slot.aquaCannonUpdate, 2, original => (cannon, method) => {
    const player = n.u32(cannon, C._player);
    if (!player || !hero(player)) return original(cannon, method);
    try {
      if (!n.bool(cannon, C._isFiring)) {
        if (states.delete(cannon)) bender.straighten(cannon);
        return 0;
      }
      let state = states.get(cannon);
      if (!state) states.set(cannon, state = { weight: 0, tick: Infinity, killed: new Set() });
      const dt = n.call(slot.timeDeltaTime, 0);
      let bend: V[] | null = null, until = 1;
      barriers.through(player, () => {
        n.call(slot.aquaCannonUpdateAiming, cannon, 1, 0);
        bend = curve(cannon, player, state!, dt);
        if (bend) until = castAlong(cannon, bend);
        else n.call(slot.aquaCannonPopulate, cannon, 0);
      });
      n.call(slot.aquaCannonMovement, cannon, 0);
      if (!bend) { // The straight beam drawn the same way: along the aim, to its first obstacle.
        const origin = vector(cannon, C._currentOriginPoint), way = vector(cannon, C._currentDirection);
        const reach = n.f32(cannon, C._abilityLevelData + L.MaxDistance), unit = scale(way, 1 / (length(way) || 1));
        bend = [origin, add(origin, scale(unit, reach / 2)), add(origin, scale(unit, reach))];
        if (n.bool(cannon, C._wasCannonStoppedByObstacle)) {
          until = n.f32(cannon, C._lastHit + field.RaycastHit.m_Distance) / reach;
        }
      }
      bender.shape(cannon, bend, until, beamTints.get(player));
      if (player === n.call(slot.playerMine, 0)) {
        breakWalls(cannon, state.killed);
        state.tick += dt;
        if (state.tick >= n.f32(cannon, C._abilityLevelData + L.FireRate)) {
          state.tick = 0;
          n.call(slot.aquaCannonApplyHits, cannon, 0);
        }
      }
    } catch (error) { console.error('LOCAL_BEAM_BEAM', String(error)); }
    return 0;
  }, 0);
  install();
}
