import { waitFor, type Native } from '../../../src/page/native';
import { ease } from '../shared/motion';
import { field, literal, slot } from '../symbols';

/** The abilitiesuxdata bundle's AssetBundle name (its AssetBundle object in abilitiesuxdata__b0a55cfd….bundle). */
const BUNDLE = '1e3ad2b679b4533a8ab4284f46bb33a3.bundle_35f45e272c07fead987342816429b9ad';
/** The UX data whose soldier prefab (RoyalDecreeUXData.<SoldierPrefab> +28) holds the aura. */
const UX = 'Assets/Scripts/Gameplay/AbilitiesSystem/Data/Caesar/Royal Decree UX.asset';
/** The UX data whose aura prefab (CombustUXData.CombustAuraPrefab +28) draws its rays with the spikes' material. */
const RAYS = 'Assets/Scripts/Gameplay/AbilitiesSystem/Data/Pyro/Combust UX.asset';
/** Its parts tinted only by their start color stay; these two are colored by their own gradients and stay off. */
const LOCKED = ['ChargeParticles', 'LightningStrikeTallGold'];
/** Seconds: the aura's fade-in, the blend between two tiers' colors, and its stay once it stops emitting. */
const FADE_IN = 0.3, BLEND = 0.4, LINGER = 1.4;
/** Height (m) of the aura over the player's feet: around the body (the soldier's sits at its feet, 0.1 m). */
const HEIGHT = 0.5;
/**
 * The spikes (heroes/README.md, "The charging aura"), emitted DROP m under the aura and at HUG of its radius. Each
 * SPIKE pair runs from no charge to full: length and speed scales, upward speed (m/s), width, lifetime (s), spikes per
 * second and gravity modifier.
 */
const DROP = 0.45, HUG = 0.6;
const SPIKE = { length: [4, 7.5], stretch: [0.08, 0.15], speed: [1.5, 4], size: [0.05, 0.085], life: [0.3, 0.5],
  rate: [24, 70], pull: [-0.5, -1.4] } as const;
/**
 * Each part's share of the aura's alpha: the additive spikes stack up along the camera's line behind the hero (they
 * white out at full alpha), and the root glow covers the body.
 */
const SHARE = { spikes: 0.6, glow: 0.5 } as const;

/** Each charging beam player's aura as this client shows it, for the observer: hue (°), alpha, scale, spike, on. */
export const beamAuras = new Map<number, { hue: number; alpha: number; scale: number; spike: number;
  emitting: boolean }>();

/** RGB of hue `hue` (°) at saturation 0.85 and full value. */
function rgb(hue: number) {
  const h = ((hue % 360) + 360) % 360 / 60, c = 0.85, x = c * (1 - Math.abs(h % 2 - 1)), m = 1 - c;
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c]
    : [c, 0, x];
  return [r + m, g + m, b + m];
}

/**
 * Adaptation: the beam hero's charging aura in the charge's tier colour, visual only, on every client: a copy of
 * Caesar's AuraChargeYellow under the player, its RisingClouds drawn as spikes (heroes/README.md, "The charging aura").
 * `tiers`: seconds up to and hue; full at `full` s.
 */
export function installBeamAura(n: Native, tiers: { upto: number; hue: number }[], full: number) {
  const now = () => performance.now() / 1000;
  const auras = new Map<number, { instance: number; handle: number; transform: number; root: number;
    systems: number[]; scale: number; spikes: number; spikesRenderer: number; stopped?: number }>();
  const particle = n.call(slot.typeGetType, n.newString('UnityEngine.ParticleSystem, UnityEngine.ParticleSystemModule'),
    1, 0);
  const renderer = n.call(slot.typeGetType,
    n.newString('UnityEngine.ParticleSystemRenderer, UnityEngine.ParticleSystemModule'), 1, 0);
  let template = 0, rays = 0, loading = false, retry = 0;

  function load() {
    if (loading || now() < retry) return;
    loading = true;
    (async () => {
      const bundle = n.array(n.call(slot.loadedAssetBundles, 0), 64)
        .find(item => n.textOrNull(n.call(slot.objectName, item, 0)) === BUNDLE);
      if (!bundle) throw new Error('The abilitiesuxdata bundle is not loaded.');
      const type = n.call(slot.typeGetType, n.newString('UnityEngine.Object, UnityEngine.CoreModule'), 1, 0);
      /** A UX asset of the bundle, loaded between frames; `use` reads it while the request is held. */
      const asset = async (name: string, use: (ux: number) => number) => {
        const request = n.check(n.call(slot.assetBundleLoadAsync, bundle, n.newString(name), type, 0));
        const handle = n.gcAlloc(request);
        try {
          if (!await waitFor(() => n.call(slot.asyncOperationDone, request, 0) === 1, 100)) throw new Error(`${name}?`);
          const found = use(n.check(n.call(slot.assetBundleRequestResult, request, 0)));
          n.gcAlloc(found); // Held for the page's life.
          return found;
        } finally { n.gcFree(handle); }
      };
      const child = (prefab: number, path: string) => n.check(n.call(slot.componentGameObject, n.check(
        n.call(slot.transformFind, n.check(n.call(slot.gameObjectTransform, prefab, 0)), n.newString(path), 0)), 0));
      rays = await asset(RAYS, ux => n.check(n.call(slot.rendererSharedMaterial, n.check(n.call(
        slot.gameObjectGetComponent, child(n.check(n.u32(ux, field.CombustUXData.CombustAuraPrefab)),
          'CombustAuraVFX/ChargeupRays'), renderer, 0)), 0)));
      template = await asset(UX, ux => child(n.check(n.u32(ux, field.RoyalDecreeUXData.SoldierPrefab)),
        'AuraChargeYellow'));
    })().catch(error => {
      console.error('LOCAL_HERO_AURA', String(error));
      retry = now() + 2;
    }).finally(() => { loading = false; });
  }

  function create(player: number) {
    const instance = n.check(n.call(slot.objectInstantiateIn, template,
      n.check(n.call(slot.componentTransform, player, 0)), 0));
    const handle = n.gcAlloc(instance), transform = n.check(n.call(slot.gameObjectTransform, instance, 0));
    for (const name of LOCKED) {
      const child = n.call(slot.transformFind, transform, n.newString(name), 0);
      if (child) n.call(slot.gameObjectSetActive, n.check(n.call(slot.componentGameObject, child, 0)), 0, 0);
    }
    const systems = n.array(n.call(slot.componentsInChildren, instance, particle, 0, 0), 32)
      .filter(item => n.alive(item));
    const root = n.check(n.call(slot.gameObjectGetComponent, instance, particle, 0));
    const scale = n.scratch(12, at => {
      n.call(slot.transformLocalScale, transform, at, 0);
      const own = n.f32(at, 0);
      [0, HEIGHT, 0].forEach((value, k) => n.setF32(at, 4 * k, value));
      n.call(slot.transformSetLocalPosition, transform, at, 0);
      return own;
    });
    // The spikes: RisingClouds drawn stretched, DROP m lower (the aura's local +Z is up; its scale is `scale`).
    const clouds = n.check(n.call(slot.transformFind, transform, n.newString('RisingClouds'), 0));
    const cloudsObject = n.check(n.call(slot.componentGameObject, clouds, 0));
    const spikes = n.check(n.call(slot.gameObjectGetComponent, cloudsObject, particle, 0));
    const spikesRenderer = n.check(n.call(slot.gameObjectGetComponent, cloudsObject, renderer, 0));
    n.call(slot.particleRendererSetMode, spikesRenderer, literal.stretchParticles, 0);
    n.call(slot.rendererSetSharedMaterial, spikesRenderer, rays, 0);
    n.scratch(12, at => {
      [0, 0, -DROP / scale].forEach((value, k) => n.setF32(at, 4 * k, value));
      n.call(slot.transformSetLocalPosition, clouds, at, 0);
      [HUG, HUG, HUG].forEach((value, k) => n.setF32(at, 4 * k, value));
      n.call(slot.transformSetLocalScale, clouds, at, 0);
    });
    n.call(slot.particlePlay, root, 1, 0);
    return { instance, handle, transform, root, systems, scale, spikes, spikesRenderer };
  }
  /** The spikes at charge `c` (0..1): each SPIKE value from its first to its second. */
  function grow(aura: { spikes: number; spikesRenderer: number }, c: number) {
    const at = (pair: readonly [number, number]) => pair[0] + (pair[1] - pair[0]) * c;
    n.call(slot.particleRendererSetLength, aura.spikesRenderer, at(SPIKE.length), 0);
    n.call(slot.particleRendererSetVelocity, aura.spikesRenderer, at(SPIKE.stretch), 0);
    n.call(slot.particleSetStartSpeed, aura.spikes, at(SPIKE.speed), 0);
    n.call(slot.particleSetStartSize, aura.spikes, at(SPIKE.size), 0);
    n.call(slot.particleSetStartLifetime, aura.spikes, at(SPIKE.life), 0);
    n.call(slot.particleSetEmissionRate, aura.spikes, at(SPIKE.rate), 0);
    n.call(slot.particleSetGravity, aura.spikes, at(SPIKE.pull), 0);
    return at(SPIKE.length);
  }
  function drop(player: number) {
    const aura = auras.get(player);
    if (!aura) return;
    if (n.alive(aura.instance)) n.call(slot.objectDestroy, aura.instance, 0);
    n.gcFree(aura.handle);
    auras.delete(player);
    beamAuras.delete(player);
  }
  /** The hue (°) after `t` seconds of charge, eased across each tier's edge over BLEND. */
  function hueAt(t: number) {
    let hue = tiers[0]!.hue;
    for (let k = 0; k + 1 < tiers.length; k++) {
      hue += (tiers[k + 1]!.hue - tiers[k]!.hue) * ease((t - tiers[k]!.upto + BLEND / 2) / BLEND);
    }
    return hue;
  }

  return {
    /** One frame of `player`'s aura (after its Animator): charging since `since` (s, this page's clock), or not. */
    frame(player: number, since?: number) {
      let aura = auras.get(player);
      if (aura && !n.alive(aura.instance)) { drop(player); aura = undefined; }
      if (!template || !n.alive(template) || !n.alive(rays)) load(); // Ready before a remote hero's first charge.
      if (since === undefined) {
        if (!aura) return;
        if (aura.stopped === undefined) {
          aura.stopped = now();
          n.call(slot.particleStop, aura.root, 1, literal.stopEmitting, 0);
          const shown = beamAuras.get(player);
          if (shown) shown.emitting = false;
        } else if (now() - aura.stopped > LINGER) drop(player);
        return;
      }
      if (aura?.stopped !== undefined) { drop(player); aura = undefined; } // Charging again while it faded.
      if (!aura) {
        if (!template || !n.alive(template) || !n.alive(rays)) { template = 0; load(); return; }
        auras.set(player, aura = create(player));
      }
      const t = now() - since, charge = ease(t / full), hue = hueAt(t);
      const alpha = (0.4 + 0.6 * charge) * ease(t / FADE_IN), scale = aura.scale * (0.9 + 0.45 * charge);
      n.scratch(16, at => {
        [...rgb(hue), alpha].forEach((value, k) => n.setF32(at, 4 * k, value));
        for (const system of aura!.systems) {
          const share = system === aura!.spikes ? SHARE.spikes : system === aura!.root ? SHARE.glow : 1;
          n.setF32(at, 12, alpha * share);
          n.call(slot.particleSetStartColor, system, at, 0);
        }
        [scale, scale, scale].forEach((value, k) => n.setF32(at, 4 * k, value));
        n.call(slot.transformSetLocalScale, aura!.transform, at, 0);
      });
      beamAuras.set(player, { hue, alpha, scale, spike: grow(aura, charge), emitting: true });
    },
  };
}
