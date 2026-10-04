import { F64, I32, type Native } from '../../../src/page/native';
import { heroOf } from '../ids';
import type { BeamMesh } from '../shared/look';
import { ease, heroPoser, type HeroClips } from '../shared/motion';
import type { HeroNet } from '../shared/net';
import { field, literal, runtime, slot, staticField, typeInfo } from '../symbols';
import { installBeamAura } from './aura';
import { installBeamBarriers } from './barriers';
import { beamTints, installBeamCannon } from './beam';
import { installBeamJump } from './jump';
import { installBeamLockOn } from './lock-on';

/** Seconds the beam hero's ability stays activated once performed: it waits for the release, not for a timer. */
const ARMED = 86400;
/**
 * Holding Ability1 charges the release for CHARGE seconds; the charge sets the hover height (LOW to WALLS walls), the
 * beam's tier and where the jump clip starts (up to its deep crouch, CROUCH s).
 */
const CHARGE = 5, CROUCH = 0.27, LOW = 1;
/**
 * The hero contracts as it charges, from the pose he is in (clip `contract`, additive: feet, knees and torso gather,
 * the head bows): GATHERED of the way in the first GATHER seconds, then deeper until CHARGE, eased. On release the
 * contraction hands over to the jump clip in XFADE seconds.
 */
const GATHER = 0.4, GATHERED = 0.35, XFADE = 0.08;
const depth = (held: number) => GATHERED * ease(held / GATHER) + (1 - GATHERED) * ease(held / CHARGE);
/**
 * The beam's tiers by seconds of charge: its hue (°: blue, green, red) and multiplier of Poseidon's damage to players
 * and builds, for 32, 64 and 80 per hit. Offline a player's tick is ceil(16 · damage) (CalculateAbilityDamage f45576,
 * docs/reference/combat.md), so each multiplier sits half a point under its total to absorb the f32 rounding.
 */
const TIERS = [{ upto: 2.5, hue: 220, damage: 31.5 / 16 }, { upto: CHARGE, hue: 125, damage: 63.5 / 16 },
  { upto: Infinity, hue: 0, damage: 79.5 / 16 }];
type Tier = typeof TIERS[number];
/** The jump clip plays JUMP× faster: a shorter crouch with the same knee bend and stretch. */
const JUMP = 1.85;
/**
 * The release sequence, in seconds after the release press: clips.json clips, when each starts and its speed. The
 * hero jumps, arches back (deepening while it hovers in the glow), then releases the beam.
 */
const STEPS: [string, number, number][] = [['jump', 0, JUMP], ['arch', 0.6, 1], ['release_forward', 2.55, 1]];
/** The jump clip's takeoff mark (s, at 1×) and the beam (clip `release_forward` start + its `release` mark). */
const TAKEOFF = 0.41, FIRE = 2.67;
/** The climb: velocity CLIMB_GAIN × the height still to go, up to CLIMB m/s (about half a second to five walls). */
const CLIMB = 60, CLIMB_GAIN = 8;
/** Sideways speed in the air at full movement input (InputManager.GetAxis), so the hero drifts a little while up. */
const AIR = 3;
/**
 * Easing: EASE seconds for the glow to come and go, for the clips to blend in from and out to the Animator's pose and
 * for the climb's speed to build up; the air drift's velocity follows the input with time constant DRIFT (s).
 */
const EASE = 0.3, DRIFT = 0.15;
/** Hover height in walls of the build grid, measured with the original PlayerBuildingManager.sizeY. */
const WALLS = 5;
/**
 * The column the rise clears: COLUMN m around the player's center, inside its 0.3 m capsule so a wall it touches
 * stays; from HEAD m above its feet, over the 1.5 m capsule, so the floor it stands on stays.
 */
const COLUMN = 0.25, HEAD = 1.6;
/**
 * The barrier sphere (beam/barriers.ts) once the hero hovers: each shield after its own random delay in
 * DELAY seconds, all ending with the beam.
 */
const SHIELDS = 1.2, DELAY = [0.1, 0.75] as const;
/** The beam starts at SMALL× and grows to GROWTH× Poseidon's width and hit radii over its Duration. */
const SMALL = 0.25, GROWTH = 3;
/** The beam's reach in metres (Poseidon's MaxDistance is 60). */
const REACH = 500;

/**
 * The beam hero's own copy of Poseidon's AquaCannonAbility (Object.Instantiate copies its level data), made his
 * ActiveAbility: every level's Duration becomes ARMED and its Cooldown 0 (heroes/README.md, "Q: the beam"). Returns
 * Poseidon's Duration, DpsPercentage and BuildingsFlatDamage by level.
 */
export function armBeamAbility(n: Native, hero: number, base: number, hold: (object: number) => number) {
  const original = n.check(n.u32(base, field.ChampionData.ActiveAbility));
  const ability = hold(n.call(slot.objectInstantiate, original, 0));
  if (n.u32(ability) !== n.u32(original)) throw new Error('Instantiate returned another ability class.');
  const levels = (owner: number) => n.list(n.u32(owner, field.Ability.dataPerLevel), 32);
  const copies = levels(ability), sources = levels(original);
  if (!copies.length || copies.length !== sources.length || copies.some((copy, index) => copy === sources[index] ||
    n.className(copy) !== 'AquaCannonLevelData')) throw new Error('The ability copy shares or lacks its level data.');
  const L = field.AquaCannonLevelData, duration = runtime.boxedValue + L.Duration;
  const durations = copies.map(copy => n.f32(copy, duration));
  const dps = copies.map(copy => n.f32(copy, runtime.boxedValue + L.DpsPercentage));
  const flat = copies.map(copy => n.i32(copy, runtime.boxedValue + L.BuildingsFlatDamage));
  for (const copy of copies) {
    n.setF32(copy, duration, ARMED);
    n.setF32(copy, runtime.boxedValue + field.AquaCannonLevelData.Cooldown, 0);
  }
  n.call(slot.championDataSetActiveAbility, hero, ability, 0);
  return { durations, dps, flat };
}

interface Run { ability: number; manager: number; start: number; fired: boolean; firing: boolean; target: number;
  handle: number; cannon?: number; radii?: number[];
  /**
   * The contraction's depth at release, the jump clip's time the charge reached (it goes on from there), the takeoff
   * (s into the run) and the tier.
   */
  depth: number; crouch: number; takeoff: number; tier: Tier;
  /** The owner's shields still to spawn (seconds into the run) and the Photon time when they all end. */
  shields?: number[]; until?: number;
  /** The owner's eased air drift (m/s, x and z) and the clip and time last posed. */
  drift: number[]; pose?: [string, number] }
/** The hero's glow (heroes/shared/look.ts) at a level 0..1, for the whole release. */
type Glow = (manager: number, level: number, t?: number) => void;

/**
 * Adaptation: the beam hero's Aqua Cannon arms on press and fires on release, on every client (heroes/README.md,
 * "Q: the beam").
 * Boundary: AquaCannonAbility.Perform (slot 119225) and Cancel (slot 119228), hooked; PlayerIK.LateUpdate (slot
 * 103257) runs the charge and the release sequence after each Animator.
 */
export async function installBeamAbility(n: Native, { durations, dps, flat }: ReturnType<typeof armBeamAbility>,
  sentinel: number, net: HeroNet, clips?: HeroClips, glow?: Glow, beam?: BeamMesh) {
  // Armed and releasing players are held (GC handle) until done or destroyed, so a pointer never stands for another.
  // `fresh`: armed this frame by the very press still read as down, which must not count as a release; `since`: the
  // charge's start (s); `sent`: when the owner last asked for the release.
  const armed = new Map<number, { ability: number; handle: number; fresh: boolean; since: number; sent?: number }>();
  /** Each hero's charge (s) its owner sent with the release, on this client, until the release starts. */
  const charges = new Map<number, number>();
  const now = () => performance.now() / 1000;
  const runs = new Map<number, Run>();
  /** The owner's cancelled sequences: its slot is deactivated next frame (after PerformActiveAbilityRPC returns). */
  const deactivate = new Map<number, number>();
  /** The original AquaCannonAbility.Cancel: the behaviour's `_cts.TryCancel()` (f41917 → f41918). */
  let stopBeam: ((ability: number, player: number, method: number) => number) | undefined;
  const barriers = await installBeamBarriers(n, sentinel);
  const lock = installBeamLockOn(n, net);
  net.on('charge', (hero, milliseconds) => charges.set(hero, milliseconds / 1000));
  const disarm = (player: number) => {
    const entry = armed.get(player);
    if (entry) { n.gcFree(entry.handle); armed.delete(player); }
    return entry;
  };
  /** Each hero's last clip pose, eased back to the Animator's over EASE once its run ends: since when (s). */
  const ends = new Map<number, { manager: number; name: string; time: number; since: number }>();
  const finish = (player: number) => {
    const run = runs.get(player);
    if (!run) return;
    if (player === n.call(slot.playerMine, 0)) lock.stop(player);
    lock.forget(player);
    beamTints.delete(player);
    scaleBeam(run, 1); // The VFX instance is pooled: Poseidon's beams reuse it.
    if (run.pose) ends.set(player, { manager: run.manager, name: run.pose[0], time: run.pose[1], since: now() });
    n.gcFree(run.handle);
    runs.delete(player);
  };
  const behaviour = n.call(slot.typeGetType, n.newString('JustPlay.Gameplay.Abilities.AquaCannonBehaviour, 1v1'),
    1, 0);
  const pose = clips ? heroPoser(n, clips) : undefined;
  const jump = installBeamJump(n, net, pose, clips?.flip?.length), aura = installBeamAura(n, TIERS, CHARGE);
  /** Each hero's glow level (0..1) by its PlayerSkinManager: up over EASE while it releases, down after. */
  const glows = new Map<number, number>();
  function shine(player: number, manager: number) {
    const on = runs.has(player), level = glows.get(manager) ?? 0;
    if (!glow || !on && !level) return;
    const next = Math.min(1, Math.max(0, level + (on ? 1 : -1) * n.call(slot.timeDeltaTime, 0) / EASE));
    glow(manager, ease(next), now());
    if (next) glows.set(manager, next);
    else glows.delete(manager);
  }
  let releasing = false;
  const hero = (player: number) => heroOf(n.textOrNull(n.call(slot.playerChampionId, player, 0))) === 'beam';
  const rigidbody = (player: number) => n.check(n.u32(
    n.check(n.u32(player, field.PlayerController._thirdPersonController)), field.vThirdPersonMotor.Rigidbody));
  const height = (body: number) => n.scratch(12, at => {
    n.call(slot.rigidbodyPosition, body, at, 0);
    return n.f32(at, 4);
  });

  /**
   * The builds directly above the player, up to `top`: every non-static Building of BuildingNetworkController's
   * `_buildingsIdMapping` whose solid box crosses the player's column (COLUMN m around its center, from HEAD m up),
   * destroyed through the original KillBuilding (RPC "DestroyBuildingRemote" to all). The box counts, because a ramp
   * over the head has its origin at the player's own level.
   */
  function breakAbove(player: number, top: number) {
    const controller = n.resolvedClass(typeInfo.BuildingNetworkController)
      ? n.u32(n.staticFields(typeInfo.BuildingNetworkController), staticField.BuildingNetworkController.Instance) : 0;
    if (!controller) return;
    const [x, y, z] = position(n.check(n.call(slot.componentTransform, player, 0)));
    const above = n.dictionary(n.u32(controller, field.BuildingNetworkController._buildingsIdMapping), 4096)
      .filter(([, building]) => {
        if (!n.alive(building) || n.bool(building, field.Building.IsStatic)) return false;
        const box = solid(building);
        return !!box && box[0][0]! < x + COLUMN && box[1][0]! > x - COLUMN && box[0][2]! < z + COLUMN &&
          box[1][2]! > z - COLUMN && box[1][1]! > y + HEAD && box[0][1]! < top + 2;
      });
    for (const [id] of above) n.call(slot.killBuilding, controller, id, 0);
  }
  /**
   * A build's solid colliders' world box [min, max] (Collider.get_bounds_Injected; triggers such as its
   * BuildingInsideCollider fill the whole cell, so they are left out), or null without any.
   */
  function solid(building: number) {
    const colliders = n.array(n.call(slot.componentsInChildren, n.call(slot.componentGameObject, building, 0),
      colliderType, 0, 0), 32).filter(item => n.alive(item) && n.call(slot.colliderIsTrigger, item, 0) === 0);
    if (!colliders.length) return null;
    const box = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
    for (const collider of colliders) n.scratch(24, at => {
      n.call(slot.colliderBounds, collider, at, 0);
      for (let k = 0; k < 3; k++) {
        box[0]![k] = Math.min(box[0]![k]!, n.f32(at, 4 * k) - n.f32(at, 12 + 4 * k));
        box[1]![k] = Math.max(box[1]![k]!, n.f32(at, 4 * k) + n.f32(at, 12 + 4 * k));
      }
    });
    return box;
  }
  const colliderType = n.call(slot.typeGetType, n.newString('UnityEngine.Collider, UnityEngine.PhysicsModule'), 1, 0);
  const position = (transform: number) => n.scratch(12, at => {
    n.call(slot.transformPosition, transform, at, 0);
    return [0, 4, 8].map(offset => n.f32(at, offset));
  });

  /** Fires the original beam: Poseidon's Duration for the player's level, no charge, REACH, the tier's damage. */
  function fire(run: Run, player: number) {
    const cannon = n.check(n.call(slot.componentGetComponent, player, behaviour, 0));
    const data = field.AquaCannonBehaviour._abilityLevelData, L = field.AquaCannonLevelData;
    const level = Math.min(Math.max(n.call(slot.playerChampionLevel, player, 0), 0), durations.length - 1);
    n.setF32(cannon, data + L.Duration, durations[level]!);
    n.setF32(cannon, data + L.ChargeTime, 0);
    n.setF32(cannon, data + L.MaxDistance, REACH);
    n.setF32(cannon, data + L.DpsPercentage, dps[level]! * run.tier.damage);
    n.setI32(cannon, data + L.BuildingsFlatDamage, Math.round(flat[level]! * run.tier.damage));
    run.cannon = cannon;
    run.radii = radii.map(offset => n.f32(cannon, data + offset));
    releasing = true;
    try { n.call(slot.aquaCannonPerform, run.ability, player, n.call(slot.photonTime, 0), 0); }
    finally { releasing = false; }
  }
  /** Hit radii re-read each frame by PopulateAquaCannonContactPoints (f41926), in the behaviour's level-data copy. */
  const radii = [field.AquaCannonLevelData.NonPlayerHitRadius, field.AquaCannonLevelData.PlayerHitRadius];
  /**
   * The beam at `scale`× Poseidon's: hit radii and the VFX instance's width (its length stays the hit distance the
   * LaserLengthController sets on its stretched particles; HandleCannonMovement never sets the scale).
   */
  function scaleBeam(run: Run, scale: number) {
    if (!run.cannon || !n.alive(run.cannon)) return;
    const data = field.AquaCannonBehaviour._abilityLevelData;
    radii.forEach((offset, index) => n.setF32(run.cannon!, data + offset, run.radii![index]! * scale));
    const vfx = n.u32(run.cannon, field.AquaCannonBehaviour._aquaCannonVfxInstance);
    if (vfx && n.alive(vfx)) n.scratch(12, at => {
      [scale, scale, 1].forEach((value, k) => n.setF32(at, 4 * k, value));
      n.call(slot.transformSetLocalScale, n.check(n.call(slot.gameObjectTransform, vfx, 0)), at, 0);
    });
  }

  /** One frame of a release run for `player`; `mine` moves its own Rigidbody toward the hover height. */
  function step(player: number, run: Run, mine: boolean) {
    if (!n.alive(player) || n.bool(player, field.PlayerController._isDead)) return finish(player);
    const t = performance.now() / 1000 - run.start;
    const current = [...STEPS].reverse().find(([, start]) => t >= start)!;
    run.pose = [current[0], (t - current[1]) * current[2] + (current[0] === 'jump' ? run.crouch : 0)];
    const handover = ease(t / XFADE); // The charge's contraction hands over to the jump clip.
    if (handover < 1) pose?.(run.manager, 'contract', run.depth, 1 - handover);
    pose?.(run.manager, ...run.pose, handover);
    if (mine) barriers.through(player, () => lock.scan(player)); // Its own barriers block not its line of sight.
    if (mine && !run.shields && t >= SHIELDS) { // Until the beam ends: FIRE + Poseidon's Duration for the level.
      const level = Math.min(Math.max(n.call(slot.playerChampionLevel, player, 0), 0), durations.length - 1);
      run.until = n.call(slot.photonTime, 0) + FIRE + durations[level]! - t;
      run.shields = Array.from({ length: barriers.count }, () => t + DELAY[0] + Math.random() * (DELAY[1] - DELAY[0]))
        .sort((a, b) => a - b);
    }
    while (run.shields?.length && t >= run.shields[0]!) { run.shields.shift(); barriers.spawn(player, run.until!); }
    if (!run.fired && t >= FIRE) { run.fired = true; fire(run, player); }
    if (run.fired) { // Until the original beam stops firing (or fails to start within a second).
      const C = field.AquaCannonBehaviour, cannon = run.cannon!;
      if (n.alive(cannon) && n.bool(cannon, C._isFiring)) run.firing = true;
      else if (run.firing || t >= FIRE + 1) return finish(player);
      // Smoothstep from SMALL to GROWTH over the Duration in the behaviour's level-data copy.
      const g = Math.min(1, (t - FIRE) / n.f32(cannon, C._abilityLevelData + field.AquaCannonLevelData.Duration));
      scaleBeam(run, SMALL + (GROWTH - SMALL) * g * g * (3 - 2 * g));
    }
    if (mine && t >= run.takeoff) n.scratch(12, at => { // Proportional climb, then hold, by velocity.
      const body = rigidbody(player), climb = CLIMB * ease((t - run.takeoff) / EASE); // The climb's speed builds up.
      n.setF32(at, 4, Math.min(climb, Math.max(-8, CLIMB_GAIN * (run.target - height(body)))));
      n.call(slot.rigidbodySetVelocity, body, at, 0);
      // AIR m/s sideways by the movement axes themselves, moved directly: the motor zeroes its input and the sideways
      // velocity while the barriers channel and the beam immobilizes. The drift's velocity eases toward the input.
      const input = [literal.horizontalAction, literal.verticalAction].map(action => n.call(slot.axis, action, 0));
      const camera = n.call(slot.cameraMain, 0), dt = n.call(slot.timeDeltaTime, 0);
      let goal = [0, 0];
      if ((input[0] || input[1]) && camera && n.alive(camera)) {
        const [fx, fz] = n.scratch(12, f => {
          n.call(slot.transformForward, f, n.check(n.call(slot.componentTransform, camera, 0)), 0);
          const flat = Math.hypot(n.f32(f, 0), n.f32(f, 8)) || 1;
          return [n.f32(f, 0) / flat, n.f32(f, 8) / flat];
        });
        goal = [AIR * (fz! * input[0]! + fx! * input[1]!), AIR * (-fx! * input[0]! + fz! * input[1]!)];
      }
      run.drift = run.drift.map((value, k) => value + (goal[k]! - value) * (1 - Math.exp(-dt / DRIFT)));
      if (Math.hypot(...run.drift) < 1e-3) return;
      n.call(slot.rigidbodyPosition, body, at, 0);
      n.setF32(at, 0, n.f32(at, 0) + run.drift[0]! * dt);
      n.setF32(at, 8, n.f32(at, 8) + run.drift[1]! * dt);
      n.call(slot.rigidbodySetPosition, body, at, 0);
    });
  }

  /**
   * Cancels `player`'s sequence on this client and dismisses its barriers; its owner also stops climbing and, after a
   * Perform (`performed`), deactivates the slot next frame.
   */
  function abort(player: number, ability: number, performed: boolean) {
    stopBeam?.(ability, player, 0);
    barriers.dismiss(player);
    if (player === n.call(slot.playerMine, 0)) {
      n.scratch(12, still => n.call(slot.rigidbodySetVelocity, rigidbody(player), still, 0));
      if (performed) deactivate.set(player, ability);
    }
    finish(player);
  }

  const installPerform = await n.prepareHook(slot.aquaCannonPerform, [I32, I32, F64, I32], original =>
    (ability, player, timestamp, method) => {
      if (releasing || !hero(player)) return original(ability, player, timestamp, method);
      if (runs.has(player)) {
        try { abort(player, ability, true); } catch (error) { console.error('LOCAL_HERO_ABILITY', String(error)); }
        return 0;
      }
      disarm(player);
      charges.delete(player);
      armed.set(player, { ability, handle: n.gcAlloc(player), fresh: true, since: now() });
      return 0;
    }, 0);
  const installCancel = await n.prepareHook(slot.aquaCannonCancel, 3, original => {
    stopBeam = original;
    return (ability, player, method) => {
      if (runs.has(player)) {
        try { abort(player, ability, false); } catch (error) { console.error('LOCAL_HERO_ABILITY', String(error)); }
        return 0;
      }
      const entry = disarm(player);
      if (!entry || n.bool(player, field.PlayerController._isDead)) return original(ability, player, method);
      try {
        finish(player);
        const held = charges.get(player) ?? now() - entry.since, charge = Math.min(1, held / CHARGE);
        charges.delete(player);
        const wall = n.f32(n.staticFields(typeInfo.PlayerBuildingManager), staticField.PlayerBuildingManager.sizeY);
        const target = height(rigidbody(player)) + (LOW + (WALLS - LOW) * charge) * wall;
        const tier = TIERS.find(candidate => held < candidate.upto)!, crouch = CROUCH * ease(charge);
        beamTints.set(player, tier.hue);
        runs.set(player, { ability, manager: n.check(n.u32(player, field.PlayerController._playerSkinManager)),
          start: now(), fired: false, firing: false, target, handle: n.gcAlloc(player), depth: depth(held), crouch,
          takeoff: (TAKEOFF - crouch) / JUMP, tier, drift: [0, 0] });
        if (player === n.call(slot.playerMine, 0)) breakAbove(player, target);
      } catch (error) { console.error('LOCAL_HERO_ABILITY', String(error)); }
      return 0;
    };
  }, 0);
  const installFrame = await n.prepareHook(slot.playerIkLateUpdate, 2, original => (ik, method) => {
    original(ik, method);
    try {
      const manager = n.u32(ik, field.PlayerIK._skinManager);
      const player = manager ? n.u32(manager, field.PlayerSkinManager._playerController) : 0;
      const mine = n.call(slot.playerMine, 0), charging = player ? armed.get(player) : undefined;
      if (player && hero(player)) {
        jump.frame(player, player === mine, !!charging || runs.has(player));
        aura.frame(player, charging?.since);
        shine(player, manager);
        const end = ends.get(player); // The last clip pose eases out to the Animator's.
        if (end && (charging || runs.has(player) || now() - end.since >= EASE)) ends.delete(player);
        else if (end) pose?.(end.manager, end.name, end.time, 1 - ease((now() - end.since) / EASE));
      }
      if (!armed.size && !runs.size && !deactivate.size) return 0;
      for (const player of armed.keys()) if (!n.alive(player)) disarm(player); // Destroyed with its match.
      const run = player ? runs.get(player) : undefined;
      if (run) step(player, run, player === mine);
      const cancelled = player && player === mine ? deactivate.get(player) : undefined;
      if (cancelled !== undefined) {
        deactivate.delete(player);
        n.call(slot.cancelActiveAbility, n.check(n.u32(player, field.PlayerController._playerAbilities)), cancelled, 0);
      }
      if (charging) { // The contraction deepens from the pose he is in as the charge grows, on every client.
        pose?.(n.check(n.u32(player, field.PlayerController._playerSkinManager)), 'contract',
          depth(now() - charging.since));
      }
      const entry = player === mine ? charging : undefined;
      if (entry?.fresh) entry.fresh = false;
      else if (entry && !entry.sent && (n.call(slot.button, literal.ability1Action, 0) !== 1 ||
        n.call(slot.buttonDown, literal.shootAction, 0) === 1)) {
        net.send('charge', player, Math.round(1000 * (now() - entry.since)));
        entry.sent = 0;
      }
      if (entry?.sent !== undefined && now() - entry.sent > 0.25) { // Asked again until its Cancel arrives.
        entry.sent = now();
        n.call(slot.cancelActiveAbility, n.check(n.u32(player, field.PlayerController._playerAbilities)),
          entry.ability, 0);
      }
    } catch (error) { console.error('LOCAL_HERO_ABILITY', String(error)); }
    return 0;
  }, 0);
  await installBeamCannon(n, barriers, hero, beam);
  installPerform();
  installCancel();
  installFrame();
  return { armedDuration: ARMED, durations, reach: REACH, clips: !!pose };
}
