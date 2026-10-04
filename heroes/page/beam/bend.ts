import type { Native } from '../../../src/page/native';
import type { BeamMesh } from '../shared/look';
import { array, core, floats, passFloats, readFloats, words } from '../shared/unity';
import { add, conj, cross, dot, rotate, scale, sub, unit, type V } from '../shared/vec';
import { field, literal, runtime, slot } from '../symbols';

/** Samples of the curve for its arc length and frames. */
const SAMPLES = 64;
/**
 * The color properties of the body's materials (FX_MT_WaterLaser_Core_01: RubfishVFX/StandardTransparencyShaderFresnel;
 * Core_02/03: ComplexGradientTransparencies) and the hue (°) of Core_01's _MainColor, the beam's.
 */
const COLORS = ['_MainColor', '_FresnelLow', '_FresnelHigh', '_HighColor'], HUE = 201;
/** `color` (RGBA, 0–1) with its hue turned by `by` degrees, saturation, value and alpha kept. */
function turn([r, g, b, a]: number[], by: number) {
  const max = Math.max(r!, g!, b!), span = max - Math.min(r!, g!, b!);
  if (!span) return [r!, g!, b!, a!];
  const hue = max === r ? ((g! - b!) / span + 6) % 6 : max === g ? (b! - r!) / span + 2 : (r! - g!) / span + 4;
  const h = ((hue * 60 + by) % 360 + 360) % 360 / 60, f = (k: number) => {
    const t = (k + h) % 6;
    return max - span * Math.max(0, Math.min(t, 4 - t, 1));
  };
  return [f(5), f(3), f(1), a!];
}

/**
 * A stretched part: `bendable` when its mesh is the beam mesh; its particles' `size` once it has some; its original
 * material and the one it shows.
 */
interface Part { transform: number; renderer: number; system: number; original: number; bendable: boolean;
  size?: number; material: number; shown?: number }

/**
 * The Aqua Cannon VFX (prefab PoseidonAquaCannon) bent along a curve and tinted, for the hero's beam: the parts with
 * the beam mesh get a readable copy (`beam.mesh.json`) carried along the curve, the turning parts hide while it bends
 * (heroes/README.md, "The beam"). Without `beam` it stays the original. `straighten` puts the original meshes back: the
 * VFX instance is pooled, Poseidon's beams reuse it.
 */
export function installBeamBend(n: Native, beam?: BeamMesh) {
  const type = (name: string) => n.call(slot.typeGetType, n.newString(name), 1, 0);
  const rendererType = type('UnityEngine.ParticleSystemRenderer, UnityEngine.ParticleSystemModule');
  const systemType = type('UnityEngine.ParticleSystem, UnityEngine.ParticleSystemModule');
  const particleType = type('UnityEngine.ParticleSystem+Particle, UnityEngine.ParticleSystemModule');
  const vectorType = type('UnityEngine.Vector3, UnityEngine.CoreModule');
  const P = field.Particle, controller = field.LaserLengthController;
  // Readable copies of the beam mesh by particle size (the size scales the mesh's ring after the bend): the Mesh and
  // its Vector3[] for set_vertices, held for the page's life; the original vertices and their depth along −Z.
  const copies = new Map<string, { mesh: number; vertices: number }>();
  /** Material copies with their hue turned, by original material and hue (°), held for the page's life. */
  const tinted = new Map<string, number>();
  const base = Float32Array.from(beam?.positions ?? []), count = base.length / 3;
  const depth = Math.max(1e-6, ...Array.from({ length: count }, (_, k) => -base[3 * k + 2]!));
  const instances = new Map<number, { parts: Part[]; end: number; bent: boolean }>();
  const transformVector = (getter: number, transform: number, size = 3) =>
    readFloats(n, at => n.call(getter, transform, at, 0), size);

  // A Particle[1] for GetParticles, held for the page's life.
  const particles = n.check(n.call(slot.arrayCreateInstance, particleType, 1, 0));
  n.gcAlloc(particles);
  function prepare(laser: number) {
    return { end: n.u32(laser, controller._endPointParticle), bent: false,
      parts: n.list(n.u32(laser, controller._particlesToStretch), 16).map(object => {
        const transform = n.check(n.call(slot.gameObjectTransform, object, 0));
        const renderer = n.check(n.call(slot.componentGetComponent, transform, rendererType, 0));
        const original = n.check(n.call(slot.particleMesh, renderer, 0));
        return { transform, renderer, system: n.check(n.call(slot.componentGetComponent, transform, systemType, 0)),
          original, size: 1, bendable: n.textOrNull(n.call(slot.objectName, original, 0)) === beamName,
          material: n.check(n.call(slot.rendererSharedMaterial, renderer, 0)) } as Part;
      }) };
  }
  /** Learns the size of `part`'s particles (it scales the mesh's ring) once it has some. */
  function measure(part: Part) {
    if (n.call(slot.getParticles, part.system, particles, 1, 0)) part.size = n.f32(particles, runtime.arrayData +
      P.m_StartSize);
  }

  /** The readable beam Mesh for particles of `size`: every channel of the original, vertices rewritten per frame. */
  function copy(size: number) {
    const key = size.toFixed(3);
    let entry = copies.get(key);
    if (entry || !beam) return entry;
    const mesh = n.check(n.call(slot.createInstance, type(core('Mesh')), 0));
    n.gcAlloc(mesh);
    n.call(slot.objectSetHideFlags, mesh, literal.dontUnloadUnusedAsset, 0);
    n.call(slot.meshMarkDynamic, mesh, 0);
    n.call(slot.meshSetVertices, mesh, array(n, core('Vector3'), count, floats(beam.positions)), 0);
    n.call(slot.meshSetTriangles, mesh, array(n, 'System.Int32', beam.triangles.length, words(beam.triangles)), 0);
    n.call(slot.meshSetNormals, mesh, array(n, core('Vector3'), count, floats(beam.normals)), 0);
    n.call(slot.meshSetTangents, mesh, array(n, core('Vector4'), count, floats(beam.tangents)), 0);
    n.call(slot.meshSetColors32, mesh, array(n, core('Color32'), count, Uint8Array.from(beam.colors)), 0);
    n.call(slot.meshSetUv, mesh, array(n, core('Vector2'), count, floats(beam.uv)), 0);
    const vertices = n.check(n.call(slot.arrayCreateInstance, vectorType, count, 0));
    n.gcAlloc(vertices);
    copies.set(key, entry = { mesh, vertices });
    return entry;
  }
  const beamName = beam?.source.name;
  /** `material` with the hue of its COLORS turned to `hue` (°), or itself without one. */
  function material(original: number, hue?: number) {
    if (hue === undefined) return original;
    const key = `${original}:${hue}`;
    let copy = tinted.get(key);
    if (copy) return copy;
    copy = n.check(n.call(slot.objectInstantiate, original, 0));
    n.gcAlloc(copy);
    n.call(slot.objectSetHideFlags, copy, literal.dontUnloadUnusedAsset, 0);
    for (const name of COLORS) n.scratch(16, at => {
      n.call(slot.materialColor, original, n.call(slot.shaderPropertyId, n.newString(name), 0), at, 0);
      turn([0, 4, 8, 12].map(k => n.f32(at, k)), hue - HUE).forEach((value, k) => n.setF32(at, 4 * k, value));
      n.call(slot.materialSetColor, copy, n.newString(name), at, 0);
    });
    tinted.set(key, copy!);
    return copy!;
  }

  return {
    /**
     * Bends the VFX of `cannon` (an AquaCannonBehaviour after HandleCannonMovement) along `curve` [start, control,
     * end] up to its parameter `until` (an obstacle cut it there), its hue turned to `hue` (°).
     */
    shape(cannon: number, curve: V[], until: number, hue?: number) {
      const vfx = n.u32(cannon, field.AquaCannonBehaviour._aquaCannonVfxInstance);
      const laser = n.u32(cannon, field.AquaCannonBehaviour._laserLengthController);
      if (!beam || !vfx || !laser || !n.alive(vfx)) return;
      let instance = instances.get(vfx);
      if (!instance) instances.set(vfx, instance = prepare(laser));
      const root = n.check(n.call(slot.gameObjectTransform, vfx, 0));
      const origin = transformVector(slot.transformPosition, root), rotation = transformVector(slot.transformRotation,
        root, 4), width = transformVector(slot.transformLocalScale, root)[0]!;
      // The visible curve from the VFX's start, by arc length, with rotation-minimizing frames (double reflection).
      const at = (t: number) => curve[0]!.map((_, k) => (1 - t) * (1 - t) * origin[k]! + 2 * (1 - t) * t *
        curve[1]![k]! + t * t * curve[2]![k]!);
      const tangent = (t: number) => unit(curve[0]!.map((_, k) => 2 * (1 - t) * (curve[1]![k]! - origin[k]!) +
        2 * t * (curve[2]![k]! - curve[1]![k]!)));
      const points = [at(0)], tangents = [tangent(0)], arcs = [0];
      const start = rotate(rotation, [1, 0, 0]);
      const normals = [unit(sub(start, scale(tangents[0]!, dot(start, tangents[0]!))))];
      for (let i = 1; i <= SAMPLES; i++) {
        const t = until * i / SAMPLES, point = at(t), tangentHere = tangent(t), previous = points[i - 1]!;
        const v1 = sub(point, previous), c1 = dot(v1, v1) || 1e-9;
        const reflected = sub(normals[i - 1]!, scale(v1, 2 * dot(v1, normals[i - 1]!) / c1));
        const tangentReflected = sub(tangents[i - 1]!, scale(v1, 2 * dot(v1, tangents[i - 1]!) / c1));
        const v2 = sub(tangentHere, tangentReflected), c2 = dot(v2, v2) || 1e-9;
        normals.push(unit(sub(reflected, scale(v2, 2 * dot(v2, reflected) / c2))));
        points.push(point);
        tangents.push(tangentHere);
        arcs.push(arcs[i - 1]! + Math.hypot(...v1));
      }
      const total = arcs[SAMPLES]! || 1e-6, inverse = conj(rotation);
      const built = new Set<string>();
      for (const part of instance.parts) {
        if (part.bendable && part.size === undefined) measure(part);
        const size = part.size ?? 1, entry = part.bendable ? copy(size) : undefined;
        if (!entry) { n.call(slot.rendererSetEnabled, part.renderer, 0, 0); continue; }
        const key = size.toFixed(3);
        if (!built.has(key)) {
          built.add(key);
          const ring = 0.5 * width * size;
          for (let k = 0; k < base.length; k += 3) {
            const along = Math.min(1, Math.max(0, -base[k + 2]! / depth)) * total;
            let i = 0, high = SAMPLES - 1; // The sample span holding `along` (arcs grow).
            while (i < high) {
              const middle = (i + high + 1) >> 1;
              if (arcs[middle]! <= along) i = middle; else high = middle - 1;
            }
            const w = Math.min(1, Math.max(0, (along - arcs[i]!) / ((arcs[i + 1]! - arcs[i]!) || 1e-9)));
            const point = add(points[i]!, scale(sub(points[i + 1]!, points[i]!), w));
            const normal = unit(add(normals[i]!, scale(sub(normals[i + 1]!, normals[i]!), w)));
            const forward = unit(add(tangents[i]!, scale(sub(tangents[i + 1]!, tangents[i]!), w)));
            const binormal = cross(normal, forward);
            const world = add(point, add(scale(normal, base[k]! * ring), scale(binormal, base[k + 1]! * ring)));
            const local = rotate(inverse, sub(world, origin));
            [local[0]! / ring, local[1]! / ring, local[2]!].forEach((value, c) =>
              n.setF32(entry.vertices, runtime.arrayData + 4 * (k + c), value));
          }
          n.call(slot.meshSetVertices, entry.mesh, entry.vertices, 0);
          n.call(slot.meshRecalculateBounds, entry.mesh, 0);
        }
        passFloats(n, [0.5, 0.5, 1], at => n.call(slot.transformSetLocalScale, part.transform, at, 0));
        n.call(slot.particleSetMesh, part.renderer, entry.mesh, 0);
        n.call(slot.rendererSetEnabled, part.renderer, 1, 0);
        const shown = material(part.material, hue);
        if (part.shown !== shown) {
          n.call(slot.rendererSetSharedMaterial, part.renderer, shown, 0);
          part.shown = shown;
        }
      }
      if (instance.end && n.alive(instance.end)) passFloats(n, points[SAMPLES]!, at =>
        n.call(slot.transformSetPosition, n.check(n.call(slot.gameObjectTransform, instance!.end, 0)), at, 0));
      instance.bent = true;
    },
    /** Puts the original meshes back and shows the turning parts again on `cannon`'s VFX instance. */
    straighten(cannon: number) {
      const vfx = n.u32(cannon, field.AquaCannonBehaviour._aquaCannonVfxInstance), instance = instances.get(vfx);
      if (!instance?.bent) return;
      for (const part of instance.parts) {
        if (!n.alive(part.renderer)) continue;
        n.call(slot.particleSetMesh, part.renderer, part.original, 0);
        if (!part.bendable) n.call(slot.rendererSetEnabled, part.renderer, 1, 0);
        if (part.shown !== undefined && part.shown !== part.material) {
          n.call(slot.rendererSetSharedMaterial, part.renderer, part.material, 0);
        }
        part.shown = undefined;
      }
      instance.bent = false;
    },
  };
}
