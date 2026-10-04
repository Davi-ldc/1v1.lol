import { I32, type Native } from '../../../src/page/native';
import { heroFile, heroOf } from '../ids';
import type { HeroFrame } from '../shared/frame';
import { ease } from '../shared/motion';
import type { HeroNet } from '../shared/net';
import { record } from '../shared/trace';
import { array, core, floats, passFloats, readFloats, words } from '../shared/unity';
import { field, literal, slot, staticField, typeInfo } from '../symbols';
import { SWORD_TIERS, swordTier } from './sword-spec';

/** sword.mesh.json in the beam hero's directory (`beam/` under `--heroes`; format in heroes/README.md). */
export interface SwordMesh { hand: number[]; tip: number; pommel: number; jewel: number[]; pommelJewel: number[];
  idle: number[]; positions: number[]; normals: number[]; uv: number[]; triangles: number[] }
export interface SwordFiles { mesh: SwordMesh; albedo: Uint8Array; emission: Uint8Array }

/**
 * A beam player's sword on this client (for beam/sword-anim.ts): whether he holds it, whether its owner is
 * charging it and for how long (s), the tier reached, the jewel's glow (0–1) and the last tiered swing (s, tier).
 */
export interface SwordState { holding: boolean; charging: boolean; charge: number; tier: number; glow: number;
  swingStart?: number; swingTier?: number }
export const beamSwords = new Map<number, SwordState>();
export const swordState = (player: number) => beamSwords.get(player) ?? null;
/** The loaded sword's guard and pommel jewels, in the pickaxe model's frame (for observers). */
export const swordJewels: { guard?: number[]; pommel?: number[] } = {};
/**
 * Evidence on this client: the owner's charged swings (whether TryFireWeapon fired), its sword hits on players
 * (HitInfo.Damage before and after the tier) and the local player's pushes, with the horizontal impulse applied (N·s)
 * and the horizontal speed its Rigidbody reached in the frames after.
 */
export const swordLog = { swings: [] as { tier: number; fired: boolean }[],
  hits: [] as { tier: number; base: number; damage: number }[],
  knocks: [] as { tier: number; at: number; speed: number; impulse: number }[] };

/**
 * The jewels' emission per tier (RGB: the Q's blue, green, red), saturated because the toon shader adds it to the lit
 * base and clips each channel (no tonemapping: a strong colour with some of every channel turns white), and how much
 * brighter a full charge makes it.
 */
const JEWEL = [[0.08, 0.3, 1], [0.1, 1, 0.2], [1, 0.05, 0.03]], BOOST = 0.6;
/** Glow and colour easing (s) toward the charge's level and back to the idle; a tiered swing counts this long. */
const GLOW_EASE = 0.25, SWING = 0.8;
/** The push (N·s): the tier's `knock` × KNOCK horizontally plus KNOCK_UP upward (heroes/README.md, "Sword"). */
const KNOCK = 150, KNOCK_UP = 250;
/** How far (m) another client lets a pushed player's body stray from where it shows that player (heroes/README.md). */
const STRAY = 0.05;

/** The beam's `sword.mesh.json`, `sword_albedo.png` and `sword_emission.png` (`files`: his directory's names). */
export async function loadSword(files: string[]): Promise<SwordFiles | undefined> {
  const names = ['sword.mesh.json', 'sword_albedo.png', 'sword_emission.png'];
  if (!names.every(file => files.includes(file))) return undefined;
  const bytes = (file: string) => fetch(heroFile('beam', file)).then(async response =>
    new Uint8Array(await response.arrayBuffer()));
  const [mesh, albedo, emission] = await Promise.all([
    fetch(heroFile('beam', 'sword.mesh.json')).then(response => response.json() as Promise<SwordMesh>),
    bytes('sword_albedo.png'), bytes('sword_emission.png')]);
  return { mesh, albedo, emission };
}

/**
 * Adaptation: the beam hero's pickaxe is a sword (tiers in sword-spec.ts; heroes/README.md, "Sword"): its look on
 * every client, no pickup time, the owner's charge on Aim and swing through WeaponsController.TryFireWeapon (slot
 * 8221), reach × the tier's `range`, and PlayerController.TakeDamage (slot 107341) × the tier's `damage` with a
 * `swordknock` push that the victim's own client applies.
 */
export async function installBeamSword(n: Native, net: HeroNet, frames: HeroFrame, files: SwordFiles) {
  const W = field.WeaponsController, M = field.WeaponModel, S = field.WeaponStats;
  const now = () => performance.now() / 1000;
  const hold = (object: number) => { n.gcAlloc(n.check(object)); return object; };
  const asset = (object: number) => {
    n.call(slot.objectSetHideFlags, object, literal.dontUnloadUnusedAsset, 0);
    return hold(object);
  };
  const type = (name: string) => n.call(slot.typeGetType, n.newString(name), 1, 0);
  /** `size` floats an injected getter (this, out) writes. */
  const read = (getter: number, object: number, size: number) =>
    readFloats(n, at => n.call(getter, object, at, 0), size);
  const rendererType = type('UnityEngine.Renderer, UnityEngine.CoreModule');
  const filterType = type('UnityEngine.MeshFilter, UnityEngine.CoreModule');
  const name = (object: number) => n.textOrNull(n.call(slot.objectName, object, 0));
  const hero = (player: number) => heroOf(n.textOrNull(n.call(slot.playerChampionId, player, 0))) === 'beam';
  const players = () => {
    const manager = n.resolvedClass(typeInfo.PlayersManager)
      ? n.u32(n.staticFields(typeInfo.PlayersManager), staticField.PlayersManager.Instance) : 0;
    const all = manager ? n.u32(manager, field.PlayersManager._allPlayers) : 0;
    return (all ? n.dictionary(all) : []).map(([, player]) => player).filter(player => n.alive(player));
  };
  /** The player's pickaxe (its MeleeWeaponModel among WeaponsController._weaponSlots) and its controller. */
  const pickaxe = (player: number) => {
    const controller = n.u32(player, field.PlayerController._weaponsController);
    const slots = controller ? n.u32(controller, W._weaponSlots) : 0;
    const model = slots ? n.list(slots, 16).find(item => n.alive(item) && n.className(item) === 'MeleeWeaponModel') : 0;
    return model ? { controller, model } : null;
  };
  swordJewels.guard = files.mesh.jewel;
  swordJewels.pommel = files.mesh.pommelJewel;

  // The textures, a mesh per skin frame and a material per player. Unity objects get their hide flags once
  // constructed (a bare objectNew has no native side yet).
  const texture = (bytes: Uint8Array) => {
    const image = n.check(n.call(slot.objectNew, n.metadata(typeInfo.Texture2D)));
    n.call(slot.texture2dCtor, image, 2, 2, 0);
    if (n.call(slot.loadImage, image, array(n, 'System.Byte', bytes.length, bytes), 0) !== 1) {
      throw new Error('LoadImage refused a sword texture.');
    }
    return asset(image);
  };
  const albedo = texture(files.albedo), emission = texture(files.emission);
  let source = 0;
  const materials = new Map<number, number>();
  const meshes = new Map<string, number>();
  /**
   * The sword mesh in a skin's frame: v_skin = S⁻¹·R⁻¹·(v_model − t) for its local TRS under "Renders", and the
   * normals S·R⁻¹·n, normalized.
   */
  function meshFor(skin: number) {
    const t = read(slot.transformLocalPosition, skin, 3), r = read(slot.transformLocalRotation, skin, 4);
    const s = read(slot.transformLocalScale, skin, 3);
    const key = [...t, ...r, ...s].map(value => value.toFixed(4)).join(',');
    let mesh = meshes.get(key);
    if (mesh) return mesh;
    const inverse = (v: number[]) => { // R⁻¹·v for the unit quaternion r (x, y, z, w)
      const [x, y, z, w] = r as [number, number, number, number];
      const cx = -x, cy = -y, cz = -z;
      const ix = w * v[0]! + cy * v[2]! - cz * v[1]!, iy = w * v[1]! + cz * v[0]! - cx * v[2]!;
      const iz = w * v[2]! + cx * v[1]! - cy * v[0]!, iw = -cx * v[0]! - cy * v[1]! - cz * v[2]!;
      return [ix * w + iw * -cx + iy * -cz - iz * -cy, iy * w + iw * -cy + iz * -cx - ix * -cz,
        iz * w + iw * -cz + ix * -cy - iy * -cx];
    };
    const data = files.mesh, count = data.positions.length / 3, positions: number[] = [], normals: number[] = [];
    for (let v = 0; v < count; v++) {
      const p = inverse([0, 1, 2].map(k => data.positions[v * 3 + k]! - t[k]!));
      positions.push(...p.map((value, k) => value / (s[k] || 1)));
      const normal = inverse(data.normals.slice(v * 3, v * 3 + 3)).map((value, k) => value * (s[k] || 1));
      const length = Math.hypot(...normal) || 1;
      normals.push(...normal.map(value => value / length));
    }
    mesh = asset(n.call(slot.createInstance, type(core('Mesh')), 0));
    n.call(slot.objectSetName, mesh, n.newString('beam sword'), 0);
    n.call(slot.meshSetVertices, mesh, array(n, core('Vector3'), count, floats(positions)), 0);
    n.call(slot.meshSetNormals, mesh, array(n, core('Vector3'), count, floats(normals)), 0);
    n.call(slot.meshSetUv, mesh, array(n, core('Vector2'), count, floats(data.uv)), 0);
    n.call(slot.meshSetTriangles, mesh, array(n, 'System.Int32', data.triangles.length, words(data.triangles)), 0);
    n.call(slot.meshRecalculateBounds, mesh, 0);
    meshes.set(key, mesh);
    return mesh;
  }
  const color = (material: number, property: string, rgba: number[]) => n.scratch(16, at => {
    rgba.forEach((value, k) => n.setF32(at, 4 * k, value));
    n.call(slot.materialSetColor, material, n.newString(property), at, 0);
  });
  /** Fang_Pickaxe _SSS, from the pickaxe's skins (every skin pack is under "Renders"). */
  function find(model: number) {
    if (source) return;
    const renderers = n.array(n.call(slot.componentsInChildren, n.call(slot.componentGameObject, model, 0),
      rendererType, 1, 0), 64);
    source = renderers.flatMap(renderer => n.array(n.call(slot.rendererSharedMaterials, renderer, 0), 8))
      .find(material => n.alive(material) && name(material) === 'Fang_Pickaxe _SSS') ?? 0;
    if (!source) throw new Error('No Fang_Pickaxe _SSS material.');
  }
  /** The player's sword material: Fang_Pickaxe _SSS's copy with the sword's albedo and emission mask, no rim. */
  function materialOf(player: number) {
    let material = materials.get(player);
    if (material && n.alive(material)) return material;
    material = n.check(n.call(slot.objectNew, n.metadata(typeInfo.Material)));
    n.call(slot.materialCtor, material, source, 0);
    n.call(slot.objectSetName, material, n.newString('beam sword'), 0);
    asset(material);
    n.call(slot.materialSetTexture, material, n.newString('_BaseMap'), albedo, 0);
    n.call(slot.materialSetTexture, material, n.newString('_Emission'), emission, 0);
    color(material, '_Color', [1, 1, 1, 1]);
    n.call(slot.materialSetFloat, material, n.newString('_UseRim'), 0, 0);
    materials.set(player, material);
    return material;
  }

  // Per beam player: the skin renderer showing the sword, the pickaxe's own Range, the glow and emission shown.
  const shown = new Map<number, { renderer: number; mesh: number; handle: number }>();
  const ranges = new Map<number, number>();
  const glows = new Map<number, number>(), emissions = new Map<number, number[]>();
  /** The owner's charge (when Aim went down) and its armed tier after letting go (until `until`). */
  let charging: number | undefined, armed: { tier: number; until: number } | undefined;

  function look(player: number, model: number) {
    find(model);
    const manager = n.u32(model, M._skinManager);
    const skin = manager ? n.u32(manager, field.WeaponSkinManager.CurrentSkin) : 0;
    if (!skin || !n.alive(skin)) return;
    const object = n.call(slot.componentGameObject, skin, 0);
    const renderer = n.call(slot.gameObjectGetComponent, object, rendererType, 0);
    const filter = n.call(slot.gameObjectGetComponent, object, filterType, 0);
    if (!renderer || !filter) return;
    const transform = n.call(slot.componentTransform, skin, 0), mesh = meshFor(transform);
    const last = shown.get(player);
    if (last?.renderer === renderer && n.call(slot.meshFilterSharedMesh, filter, 0) === mesh) return;
    n.call(slot.meshFilterSetMesh, filter, mesh, 0);
    n.call(slot.rendererSetSharedMaterials, renderer, array(n, core('Material'), 1, words([materialOf(player)])), 0);
    if (last) n.gcFree(last.handle);
    shown.set(player, { renderer, mesh, handle: n.gcAlloc(renderer) });
  }

  /** When each player's charge began on this client (its `sword` 1 message). */
  const starts = new Map<number, number | undefined>();
  net.on('sword', (player, value) => {
    const state = beamSwords.get(player) ?? { holding: false, charging: false, charge: 0, tier: 0, glow: 0 };
    state.charging = value === 1;
    if (value >= 10) Object.assign(state, { swingStart: now(), swingTier: value - 10 });
    beamSwords.set(player, state);
    starts.set(player, value === 1 ? now() : undefined);
  });
  /** Remote players the sword pushed, whose bodies this client keeps where it shows them while they live. */
  const pushed = new Map<number, number>();
  const bodyOf = (player: number) =>
    n.u32(n.u32(player, field.PlayerController._thirdPersonController), field.vThirdPersonMotor.Rigidbody);
  net.on('swordknock', (attacker, value) => {
    const victim = net.player(Math.floor(value / 4)), tier = SWORD_TIERS[value % 4]!;
    if (!victim || !n.alive(attacker)) return;
    if (victim !== n.call(slot.playerMine, 0)) {
      if (!pushed.has(victim)) pushed.set(victim, n.gcAlloc(victim));
      return;
    }
    const from = position(attacker), to = position(victim);
    const away = [to[0]! - from[0]!, 0, to[2]! - from[2]!], length = Math.hypot(...away) || 1;
    const push = tier.knock * KNOCK;
    passFloats(n, [away[0]! / length * push, KNOCK_UP, away[2]! / length * push],
      at => n.call(slot.applyKnockback, victim, at, 0));
    record(swordLog.knocks, { tier: value % 4, at: now(), speed: 0, impulse: push });
  });
  const position = (component: number) =>
    read(slot.transformPosition, n.check(n.call(slot.componentTransform, component, 0)), 3);

  frames.on('LOCAL_BEAM_SWORD', () => {
    const mine = n.call(slot.playerMine, 0), t = now(), dt = n.call(slot.timeDeltaTime, 0);
    const knock = swordLog.knocks.at(-1);
    if (knock && t - knock.at < 0.3 && mine) { // The pushed player's peak horizontal speed.
      const v = read(slot.rigidbodyVelocity, bodyOf(mine), 3);
      knock.speed = Math.max(knock.speed, Math.hypot(v[0]!, v[2]!));
    }
    for (const [victim, handle] of pushed) { // A pushed remote player's body back where it is shown.
      if (!n.alive(victim) || n.bool(victim, field.PlayerController._isDead)) {
        n.gcFree(handle);
        pushed.delete(victim);
        continue;
      }
      const body = bodyOf(victim), shown = position(victim);
      if (body && n.alive(body) && Math.hypot(...read(slot.rigidbodyPosition, body, 3).map((v, k) => v - shown[k]!))
        > STRAY) n.scratch(12, at => {
        shown.forEach((value, k) => n.setF32(at, 4 * k, value));
        n.call(slot.rigidbodySetPosition, body, at, 0);
        [0, 4, 8].forEach(k => n.setF32(at, k, 0));
        n.call(slot.rigidbodySetVelocity, body, at, 0);
      });
    }
    const step = Math.min(1, dt / GLOW_EASE);
    for (const player of players()) {
      if (!hero(player)) continue;
      const found = pickaxe(player);
      if (!found) continue;
      const { controller, model } = found;
      look(player, model);
      n.setF32(model, M.Stats + S.EquipDelay, 0);
      if (!ranges.has(model)) ranges.set(model, n.f32(model, M.Stats + S.Range));
      const holding = n.u32(controller, W.CurrentWeapon) === model;
      const state = beamSwords.get(player) ?? { holding, charging: false, charge: 0, tier: 0, glow: 0 };
      state.holding = holding;
      if (player === mine) owner(player, controller, model, holding, state, t);
      const start = starts.get(player);
      state.charge = state.charging && start !== undefined ? Math.max(0, t - start) : 0;
      state.tier = SWORD_TIERS.indexOf(swordTier(state.charge));
      // The glow follows the charge's tier level (a third per tier); the jewels' emission eases from their own
      // colour to the tier's, brighter with the level, and back.
      const level = state.charging ? (state.tier + 1) / SWORD_TIERS.length : 0;
      const glow = glows.get(player) ?? 0, next = glow + (level - glow) * step;
      glows.set(player, next);
      state.glow = ease(Math.min(1, next));
      const target = state.charging ? JEWEL[state.tier]!.map(value => value * (1 + BOOST * level)) : files.mesh.idle;
      const lit = (emissions.get(player) ?? files.mesh.idle).map((value, k) => value + (target[k]! - value) * step);
      emissions.set(player, lit);
      color(materialOf(player), '_Emission1', [...lit, 1]);
      beamSwords.set(player, state);
    }
  });

  /** The owner's charge and swing: Aim held with the sword charges; let go, it swings at the tier reached. */
  function owner(player: number, controller: number, model: number, holding: boolean, state: SwordState, t: number) {
    const aiming = holding && n.call(slot.button, literal.aimAction, 0) === 1;
    if (aiming && charging === undefined) {
      charging = t;
      net.send('sword', player, 1);
    } else if (!aiming && charging !== undefined) {
      const tier = SWORD_TIERS.indexOf(swordTier(Math.max(0, t - charging)));
      charging = undefined;
      if (holding) { // Let go with the sword in hand: the swing; switched away: the charge is dropped.
        armed = { tier, until: t + SWING };
        net.send('sword', player, 10 + tier);
        setRange(model, tier);
        record(swordLog.swings, { tier, fired: n.call(slot.tryFireWeapon, controller, 1, 1, 0) === 1 });
      } else net.send('sword', player, 0);
    }
    if (armed && t > armed.until) armed = undefined;
    setRange(model, armed?.tier ?? 0);
    state.charging = charging !== undefined;
  }
  const setRange = (model: number, tier: number) =>
    n.setF32(model, M.Stats + S.Range, ranges.get(model)! * SWORD_TIERS[tier]!.range);

  // Damage: the attacker's call to the victim's TakeDamage, for the beam hero's sword in the owner's hand.
  const install = await n.prepareHook(slot.playerTakeDamageWeapon, [I32, I32, I32, I32, I32], original =>
    (victim, attacker, hitInfo, stats, method) => {
      let tier = -1;
      try {
        const mine = n.call(slot.playerMine, 0);
        const found = attacker === mine && hitInfo && hero(attacker) ? pickaxe(attacker) : null;
        if (found && n.u32(found.controller, W.CurrentWeapon) === found.model) {
          tier = armed?.tier ?? 0;
          const base = n.f32(hitInfo, field.HitInfo.Damage);
          n.setF32(hitInfo, field.HitInfo.Damage, base * SWORD_TIERS[tier]!.damage);
          record(swordLog.hits, { tier, base, damage: n.f32(hitInfo, field.HitInfo.Damage) });
        }
      } catch (error) { console.error('LOCAL_BEAM_SWORD', String(error)); }
      original(victim, attacker, hitInfo, stats, method);
      if (tier >= 0) {
        try { net.send('swordknock', attacker, net.ownerId(victim) * 4 + tier); }
        catch (error) { console.error('LOCAL_BEAM_SWORD', String(error)); }
      }
      return 0;
    }, 0);
  install();
  return { vertices: files.mesh.positions.length / 3, tip: files.mesh.tip };
}
