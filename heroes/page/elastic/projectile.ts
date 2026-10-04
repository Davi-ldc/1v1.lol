import type { Native } from '../../../src/page/native';
import type { HeroFrame } from '../shared/frame';
import { ease } from '../shared/motion';
import type { HeroNet } from '../shared/net';
import { record } from '../shared/trace';
import { array, core, floats, passFloats, readFloats, words } from '../shared/unity';
import { add, cross, dot, lookRotation, mul, unit, type V } from '../shared/vec';
import { field, literal, slot, staticField, typeInfo } from '../symbols';

/** The projectile's files in the elastic hero's directory (`elastic/` under `--heroes`): its mesh and its texture. */
export const PROJECTILE_MESH = 'projectile.mesh.json', PROJECTILE_IMAGE = 'projectile.png';
/** PROJECTILE_MESH (format in heroes/README.md). */
export interface ProjectileMesh { length: number; radius: number; positions: number[]; normals: number[];
  uv: number[]; triangles: number[] }

/** Flight: speed (m/s), range (m), scale-in and shrink-out times (s). */
const SPEED = 25, RANGE = 80, GROW = 0.15, SHRINK = 0.25;
/** End-over-end tumble (turns per second), eased in over GROW so it leaves the hands pointing ahead. */
const TUMBLE = 1.1;
/**
 * Damage per player hit (once per flight) and the knockback impulse: away and up (N·s; ×1/40 kg = 20 and 12 m/s).
 */
const DAMAGE = 600, KNOCK = [800, 480] as const;
/** Builds a flight breaks: it flies on through the first and ends at the second. */
const WALLS = 2;
/** Spawn point from the thrower's center: forward and up (m), between the clapping hands. */
const SPAWN = [1.9, 0.15] as const;
/**
 * The wet look: the original URP Lit material "Lit" (no keywords: environment reflections and specular highlights
 * on; skinpacks bundle 2246da13…, renderer "Bats Emmiter" in POSEIDON.prefab, the elastic hero's own pack), copied
 * white with this smoothness and a little metal (a white dielectric's 4% highlight barely shows on white), and the
 * projectile's atlas as its _BaseMap.
 */
const LIT = 'Lit', SMOOTHNESS = 0.95, METALLIC = 0.25;
/** Margins (m) around the projectile for players (radius, half height) and for builds (half a grid cell). */
const PLAYER = [0.4, 0.9] as const, BUILD = 2.5;

/** Direction ↔ int for the `projectile` message: yaw in 0.1° (0–3599) × 2048 + (pitch + 90°) in 0.1° (0–1800). */
const pack = (d: V) => {
  const yaw = Math.round(((Math.atan2(d[0]!, d[2]!) * 180 / Math.PI) + 360) % 360 * 10) % 3600;
  const pitch = Math.round((Math.asin(Math.max(-1, Math.min(1, d[1]!))) * 180 / Math.PI + 90) * 10);
  return yaw * 2048 + pitch;
};
const unpack = (value: number) => {
  const yaw = Math.floor(value / 2048) / 10 * Math.PI / 180, pitch = ((value % 2048) / 10 - 90) * Math.PI / 180;
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
};

interface Flight { hero: number; origin: V; dir: V; right: V; up: V; start: number; object: number; handle: number;
  transform: number; along: number; hit: Set<number>; killed: Set<number>; stop?: number }
/**
 * The live flights on this client, for the observer: position, scale, tumble (turns), seconds since the throw and
 * where it ends (m along its flight, once known).
 */
export const elasticProjectiles: { at: V; scale: number; turns: number; t: number; hero: number; stop?: number }[] = [];
/** The flights that ended on this client (last 16): seconds flown and their stop, if any. */
export const elasticEnded: { t: number; stop?: number }[] = [];
/**
 * The knocks this client received (last 16): the victim's OwnerID, the impulse along the thrower's last flight, and
 * whether it was applied (the victim is this client's live player) or the victim was already dead.
 */
export const elasticKnocks: { victim: number; impulse: V; applied: boolean; dead: boolean }[] = [];

/**
 * The elastic hero's clap projectile on every client (heroes/README.md, "Q: slaps and the projectile"): an entity of
 * its own moved by time like the original projectiles (f42857). The owner hurts each player it sweeps over once
 * (PlayerController.TakeDamage, slot 107343) and breaks up to WALLS builds (KillBuilding, slot 9039); the push is
 * applied by the victim's own client (PlayerController.ApplyKnockback, slot 10225), as the original has no RPC for it.
 */
export function installElasticProjectile(n: Native, net: HeroNet, frames: HeroFrame, mesh: ProjectileMesh,
  image: Uint8Array, source: () => number) {
  const now = () => performance.now() / 1000;
  const flights: Flight[] = [];
  /** Each thrower's last flight direction, for its `knock` messages. */
  const directions = new Map<number, V>();
  const type = (name: string) => n.call(slot.typeGetType, n.newString(name), 1, 0);
  const keep = (object: number, name: string) => {
    n.gcAlloc(n.check(object));
    n.call(slot.objectSetHideFlags, object, literal.dontUnloadUnusedAsset, 0);
    n.call(slot.objectSetName, object, n.newString(name), 0);
    return object;
  };
  let built = 0, material = 0;
  /** The projectile's Mesh, built once and kept (DontUnloadUnusedAsset). */
  function body() {
    if (built && n.alive(built)) return built;
    const count = mesh.positions.length / 3;
    built = keep(n.call(slot.createInstance, type(core('Mesh')), 0), 'projectile');
    n.call(slot.meshSetVertices, built, array(n, core('Vector3'), count, floats(mesh.positions)), 0);
    n.call(slot.meshSetTriangles, built, array(n, 'System.Int32', mesh.triangles.length, words(mesh.triangles)), 0);
    n.call(slot.meshSetNormals, built, array(n, core('Vector3'), count, floats(mesh.normals)), 0);
    n.call(slot.meshSetUv, built, array(n, core('Vector2'), count, floats(mesh.uv)), 0);
    n.call(slot.meshRecalculateBounds, built, 0);
    return built;
  }
  /**
   * The wet white material, built once: a copy of LIT from the thrower's current skin pack (its renderers, inactive
   * ones too), white, SMOOTHNESS and METALLIC, with the atlas as its _BaseMap.
   */
  function wet(hero: number) {
    if (material && n.alive(material)) return material;
    const manager = n.check(n.u32(hero, field.PlayerController._playerSkinManager));
    const pack = n.check(n.u32(manager, field.PlayerSkinManager._curSkinPack));
    const renderers = n.array(n.call(slot.componentsInChildren, n.check(n.call(slot.componentGameObject, pack, 0)),
      type(core('Renderer')), 1, 0), 256);
    const lit = renderers.flatMap(renderer => n.array(n.call(slot.rendererSharedMaterials, renderer, 0), 8))
      .find(item => n.alive(item) && n.textOrNull(n.call(slot.objectName, item, 0)) === LIT);
    if (!lit) throw new Error(`The thrower's skin pack has no "${LIT}" material.`);
    material = n.check(n.call(slot.objectNew, n.metadata(typeInfo.Material)));
    n.call(slot.materialCtor, material, lit, 0);
    keep(material, 'projectile');
    passFloats(n, [1, 1, 1, 1], at => n.call(slot.materialSetColor, material, n.newString('_BaseColor'), at, 0));
    n.call(slot.materialSetFloat, material, n.newString('_Smoothness'), SMOOTHNESS, 0);
    n.call(slot.materialSetFloat, material, n.newString('_Metallic'), METALLIC, 0);
    const texture = n.check(n.call(slot.objectNew, n.metadata(typeInfo.Texture2D)));
    n.call(slot.texture2dCtor, texture, 2, 2, 0);
    if (n.call(slot.loadImage, texture, array(n, 'System.Byte', image.length, image), 0) !== 1) {
      throw new Error('LoadImage refused the projectile atlas.');
    }
    keep(texture, 'projectile');
    n.call(slot.materialSetTexture, material, n.newString('_BaseMap'), texture, 0);
    return material;
  }
  const center = (player: number) => readFloats(n, at => n.call(slot.playerCenterPosition, at, player, 0));
  const vector = (call: number, transform: number) => readFloats(n, at => n.call(call, transform, at, 0));
  const players = () => {
    const manager = n.resolvedClass(typeInfo.PlayersManager)
      ? n.u32(n.staticFields(typeInfo.PlayersManager), staticField.PlayersManager.Instance) : 0;
    const all = manager ? n.u32(manager, field.PlayersManager._allPlayers) : 0;
    return (all ? n.dictionary(all) : []).map(([, player]) => player).filter(player => n.alive(player));
  };

  function spawn(hero: number, dir: V) {
    const yaw = unit([dir[0]!, 0, dir[2]!]);
    const origin = add(add(center(hero), yaw, SPAWN[0]), [0, 1, 0], SPAWN[1]);
    const right = unit(cross([0, 1, 0], dir)), up = cross(dir, right);
    const object = n.check(n.call(slot.createInstance, type(core('GameObject')), 0));
    n.call(slot.objectSetName, object, n.newString('projectile'), 0);
    const filter = n.check(n.call(slot.gameObjectAddComponent, object, type(core('MeshFilter')), 0));
    n.call(slot.meshFilterSetMesh, filter, body(), 0);
    const renderer = n.check(n.call(slot.gameObjectAddComponent, object, type(core('MeshRenderer')), 0));
    n.call(slot.rendererSetSharedMaterial, renderer, wet(hero), 0);
    const transform = n.check(n.call(slot.gameObjectTransform, object, 0));
    directions.set(hero, dir);
    // The owner's first sweep starts at the thrower's center: the projectile comes out of the clap, so a player
    // standing between the hands and the spawn point is hit too.
    flights.push({ hero, origin, dir, right, up, start: now(), object, handle: n.gcAlloc(object), transform,
      along: -SPAWN[0], hit: new Set(), killed: new Set() });
  }
  net.on('projectile', (hero, value) => spawn(hero, unpack(value)));
  /** The thrower's latest flight ends `along` m out (the owner's own message comes back to it too). */
  function stop(hero: number, along: number) {
    const flight = flights.findLast(item => item.hero === hero);
    if (flight && flight.stop === undefined) flight.stop = along;
  }
  net.on('projectilestop', (hero, value) => stop(hero, value / 100));
  net.on('knock', (hero, victimId) => {
    const victim = net.player(victimId), dir = directions.get(hero);
    if (!dir) return;
    const away = unit([dir[0]!, 0, dir[2]!]), impulse = [away[0]! * KNOCK[0], KNOCK[1], away[2]! * KNOCK[0]];
    const applied = !!victim && victim === n.call(slot.playerMine, 0);
    record(elasticKnocks, { victim: victimId, impulse, applied,
      dead: !!victim && n.alive(victim) && n.bool(victim, field.PlayerController._isDead) });
    if (applied) passFloats(n, impulse, at => n.call(slot.applyKnockback, victim, at, 0));
  });

  /**
   * The owner's sweep from `from` to `to` metres along the flight: players and builds inside the box the tumbling
   * projectile fills (its length up and along, its diameter across).
   */
  function sweep(flight: Flight, from: number, to: number, scale: number) {
    const halfW = mesh.radius * scale, halfL = mesh.length * scale / 2;
    const inside = (point: V, margin: number, height: number) => {
      const rel = add(point, flight.origin, -1), along = dot(rel, flight.dir);
      return along >= from - halfL - margin && along <= to + halfL + margin &&
        Math.abs(dot(rel, flight.right)) <= halfW + margin && Math.abs(dot(rel, flight.up)) <= halfL + height;
    };
    for (const player of players()) {
      if (player === flight.hero || flight.hit.has(player) || n.bool(player, field.PlayerController._isDead)) continue;
      if (!inside(center(player), PLAYER[0], PLAYER[1])) continue;
      flight.hit.add(player);
      hurt(player, flight.hero, DAMAGE, add(flight.origin, flight.dir, to));
      net.send('knock', flight.hero, net.ownerId(player));
    }
    const controller = n.resolvedClass(typeInfo.BuildingNetworkController)
      ? n.u32(n.staticFields(typeInfo.BuildingNetworkController), staticField.BuildingNetworkController.Instance) : 0;
    if (!controller || flight.killed.size >= WALLS) return;
    const reached: { id: number; build: number; along: number }[] = [];
    for (const [id, build] of n.dictionary(n.u32(controller, field.BuildingNetworkController._buildingsIdMapping),
      4096)) {
      if (flight.killed.has(build) || !n.alive(build) || n.bool(build, field.Building.IsStatic) ||
        n.bool(build, field.Building._isDestroySignaled)) continue;
      const place = vector(slot.transformPosition, n.check(n.call(slot.componentTransform, build, 0)));
      const along = dot(add(place, flight.origin, -1), flight.dir);
      if (inside(place, BUILD, BUILD)) reached.push({ id, build, along });
    }
    for (const { id, build, along } of reached.sort((p, q) => p.along - q.along)) {
      flight.killed.add(build);
      n.call(slot.killBuilding, controller, id, 0);
      if (flight.killed.size < WALLS) continue;
      const end = Math.max(to, along);
      stop(flight.hero, end);
      net.send('projectilestop', flight.hero, Math.round(end * 100));
      return;
    }
  }
  /**
   * `damage` to `victim` from `attacker` by the original ability path (RPC "TakeHit"), the hit seen at `at`, then the
   * original hit marker and floating damage (CombatHelper.TriggerDamageEffects, slot 103189, as
   * SliceBehaviour.ApplyHit f51103 after its damage).
   */
  function hurt(victim: number, attacker: number, damage: number, at: V) {
    const hit = n.check(n.call(slot.objectNew, n.metadata(typeInfo.HitInfo)));
    const handle = n.gcAlloc(hit);
    try {
      n.setU32(hit, field.HitInfo.DamageSourceID, source());
      n.setF32(hit, field.HitInfo.Damage, damage);
      n.write(hit, field.HitInfo.DamagerPos, Uint8Array.of(1));
      at.forEach((value, k) => n.setF32(hit, field.HitInfo.DamagerPos + 4 + 4 * k, value));
      n.call(slot.playerTakeDamage, victim, attacker, hit, 0, 0);
    } finally { n.gcFree(handle); }
    n.call(slot.triggerDamageEffects, victim, Math.round(damage), 0);
  }

  frames.on('LOCAL_ELASTIC_PROJECTILE', () => {
    const mine = n.call(slot.playerMine, 0), t0 = now();
    elasticProjectiles.length = 0;
    for (const flight of [...flights]) {
      // A flight shrinks out over its last SHRINK s: on its way to RANGE, or in place at its stop.
      const life = flight.stop === undefined ? RANGE / SPEED : flight.stop / SPEED + SHRINK;
      const t = t0 - flight.start, along = Math.min(flight.stop ?? RANGE, SPEED * t);
      if (t >= life || !n.alive(flight.object)) {
        if (n.alive(flight.object)) n.call(slot.objectDestroy, flight.object, 0);
        record(elasticEnded, { t: +t.toFixed(2), stop: flight.stop });
        n.gcFree(flight.handle);
        flights.splice(flights.indexOf(flight), 1);
        continue;
      }
      const shrink = 1 - ease(Math.max(0, (t - life + SHRINK) / SHRINK));
      const scale = Math.max(0.001, ease(Math.min(1, t / GROW)) * shrink);
      // The tumble's angle: its speed eases in over GROW (the integral of ease, so the spin never jumps).
      const spin = t < GROW ? GROW * (t / GROW) ** 3 * (1 - 0.5 * t / GROW) : t - GROW / 2;
      const turns = TUMBLE * spin, angle = turns * 2 * Math.PI;
      const tumble = [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)]; // about its own right (local X), end over end
      const at = add(flight.origin, flight.dir, along);
      passFloats(n, at, p => n.call(slot.transformSetPosition, flight.transform, p, 0));
      passFloats(n, mul(lookRotation(flight.dir, flight.up), tumble),
        p => n.call(slot.transformSetRotation, flight.transform, p, 0));
      passFloats(n, [scale, scale, scale], p => n.call(slot.transformSetLocalScale, flight.transform, p, 0));
      // The hit volume is the whole projectile while it grows in (only its shrink at the end makes it smaller).
      if (flight.hero === mine && n.alive(mine)) sweep(flight, flight.along, along, t < GROW ? 1 : scale);
      flight.along = along;
      elasticProjectiles.push({ at, scale, turns, t, hero: flight.hero, stop: flight.stop });
    }
  });
  const forward = (component: number) => unit(readFloats(n, at =>
    n.call(slot.transformForward, at, n.check(n.call(slot.componentTransform, component, 0)), 0)));
  return {
    /** The owner throws along its camera's aim (its body's forward without a camera), to every client. */
    launch(hero: number) {
      const camera = n.call(slot.cameraMain, 0);
      net.send('projectile', hero, pack(camera && n.alive(camera) ? forward(camera) : forward(hero)));
    },
    hurt,
  };
}
