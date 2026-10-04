import type { Native } from '../../../src/page/native';
import { array, core, readFloats, words } from '../shared/unity';
import { rotationMatrix } from '../shared/vec';
import { literal, runtime, slot, typeInfo } from '../symbols';

/**
 * The originals the beam hero's special material is stacked from, by name, loaded in a match: ImmunitySphere is URP
 * Lit with _SURFACE_TYPE_TRANSPARENT, PolyProtonBlue PolygonArsenal/URP/PolygonArsenal-TransparentRimlight,
 * PolyGradient_ADD URP Particles/Unlit additive, Poseidon face PlayerToonShaderMythicTransparent.
 */
const SOURCES = { glass: 'ImmunitySphere', rim: 'PolyProtonBlue', band: 'PolyGradient_ADD', fade: 'Poseidon face' };
/** Glass tint (neutral grey, as the reference's torus) and its alpha at full level. */
const GLASS = [0.72, 0.74, 0.8], CLEAR = 0.24;
/** The three dispersion fringes: Fresnel power (thin to the edge) and hue step between them; strength at full level. */
const FRINGES = [3, 5, 8], STEP = 0.28, FRINGE = 0.5;
/**
 * The reference's spectrum: its 32 jittered wavelengths w ∈ (0, 4] as SAMPLES evenly spaced ones, each with IOR
 * 1.8 − 0.2w; channel c (red 3, green 2, blue 1) weighs w by max(1 − |w − c|, 0), normalized here. On the reference's
 * torus, 6 samples differ from 8 by 0.06/255 on average (measured on a model of the reference).
 */
const SAMPLES = 6;
const WAVES = Array.from({ length: SAMPLES }, (_, k) => (k + 0.5) * 4 / SAMPLES);
const IORS = Float64Array.from(WAVES, w => 1.8 - 0.2 * w), ETAS = IORS.map(ior => 1 / ior);
const [WR, WG, WB] = [3, 2, 1].map(c => {
  const tent = WAVES.map(w => Math.max(1 - Math.abs(w - c), 0)), sum = tent.reduce((a, b) => a + b, 0);
  return Float64Array.from(tent, weight => weight / sum);
}) as [Float64Array, Float64Array, Float64Array];
/**
 * The reference's surface: at a hit the ray refracts 90 % of the time, else (and on total internal reflection) it
 * reflects; its tone map is tanh(7·O/32) over 32 samples whose channel weights add up to 8: tanh(1.75·mean).
 */
const REFRACT = 0.9, TONE = 7 * 8 / 32;
/** Vertices facing away past this cosine are behind culled faces: left clear (black, no alpha). */
const AWAY = -0.3;
/** How much of the body the reference layer covers at full level (the glass and the world show through the rest). */
const OVER = 0.85;

/** The reference's environment by direction (x right, y up of its camera): sky gradient, horizon ring, side light. */
function sky(x: number, y: number) {
  const a = y + 0.7, b = x + 1;
  let e = (1 + y) * (1 + y) / 8;
  if (a > -0.45 && a < 0.45) e += Math.exp(-800 * a * a * a * a);
  if (b < 0.55) e += Math.exp(-300 * b * b * b * b);
  return e;
}

/**
 * The reference per vertex, in camera space (`m`: renderer-local to camera-local rotation, row-major, then the
 * renderer's origin; the camera at the origin, looking along +z, x right, y up), into `out` (Color32): the view ray
 * to the vertex enters through its normal and, per wavelength, leaves as through a ball of that normal (the exit
 * normal is the entry one mirrored about the refracted ray, as across the reference torus's round tube); 10 % of it
 * reflects at the entry. Returns the vertices' world height range (`up`: world y of the renderer's axes and origin).
 */
function shade(count: number, pos: Float32Array, nor: Float32Array, m: Float64Array, up: Float64Array,
  out: Uint8Array) {
  const m0 = m[0]!, m1 = m[1]!, m2 = m[2]!, m3 = m[3]!, m4 = m[4]!, m5 = m[5]!, m6 = m[6]!, m7 = m[7]!, m8 = m[8]!;
  const cx = m[9]!, cy = m[10]!, cz = m[11]!, ux = up[0]!, uy = up[1]!, uz = up[2]!, uo = up[3]!;
  let low = Infinity, high = -Infinity;
  for (let v = 0, o = 0, c = 0; v < count; v++, o += 3, c += 4) {
    const lx = pos[o]!, ly = pos[o + 1]!, lz = pos[o + 2]!, height = uo + ux * lx + uy * ly + uz * lz;
    if (height < low) low = height;
    if (height > high) high = height;
    let dx = m0 * lx + m1 * ly + m2 * lz + cx, dy = m3 * lx + m4 * ly + m5 * lz + cy;
    let dz = m6 * lx + m7 * ly + m8 * lz + cz;
    const il = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx *= il; dy *= il; dz *= il;
    const ax = nor[o]!, ay = nor[o + 1]!, az = nor[o + 2]!;
    let nx = m0 * ax + m1 * ay + m2 * az, ny = m3 * ax + m4 * ay + m5 * az, nz = m6 * ax + m7 * ay + m8 * az;
    const nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx *= nl; ny *= nl; nz *= nl;
    let cos = -(dx * nx + dy * ny + dz * nz);
    if (cos < AWAY) { out[c] = out[c + 1] = out[c + 2] = out[c + 3] = 0; continue; }
    out[c + 3] = 255;
    if (cos < 0) { nx = -nx; ny = -ny; nz = -nz; cos = -cos; }
    const reflected = (1 - REFRACT) * sky(dx + 2 * cos * nx, dy + 2 * cos * ny), sin2 = 1 - cos * cos;
    let r = 0, g = 0, b = 0;
    for (let k = 0; k < SAMPLES; k++) {
      // In: t = refract(d, n, 1/ior), its cosine ct. The ball's exit normal e = n − 2(n·t)t = n + 2ct·t meets t at
      // ct again, so out = refract(t, −e, ior) = ior·t + (cos − ior·ct)·e: never totally reflected. Only x, y count.
      const ior = IORS[k]!, eta = ETAS[k]!, ct = Math.sqrt(1 - eta * eta * sin2), f = eta * cos - ct;
      const tx = eta * dx + f * nx, ty = eta * dy + f * ny, s = cos - ior * ct;
      const e = REFRACT * sky(ior * tx + s * (nx + 2 * ct * tx), ior * ty + s * (ny + 2 * ct * ty)) + reflected;
      r += WR[k]! * e; g += WG[k]! * e; b += WB[k]! * e;
    }
    out[c] = Math.round(255 * Math.tanh(TONE * r));
    out[c + 1] = Math.round(255 * Math.tanh(TONE * g));
    out[c + 2] = Math.round(255 * Math.tanh(TONE * b));
  }
  return [low, high];
}

/**
 * The per-vertex pass on this client: frames, total, slowest and first (setup) ms, the JS shading's share of the
 * total, vertices, and the last body's world height range.
 */
export const beamMaterialStats = { frames: 0, total: 0, max: 0, first: 0, shading: 0, vertices: 0, bounds: [0, 0] };

type Layer = { material: number; kind: keyof typeof SOURCES };

/**
 * The beam hero's special material, after a reference shader of a refractive torus with spectral dispersion: copies of
 * loaded originals stacked on the scan's renderer (glass, the reference shaded per vertex every frame, three Fresnel
 * fringes, the scan fading out), since the build compiles no shader at runtime (heroes/README.md, "The glow").
 * `frame` returns the renderer's Material[] for a level and time (null until the originals are loaded).
 */
export function beamMaterial(n: Native, mesh: () => number, positions: number[], texture: () => number) {
  const sources = new Map<string, number>(), count = positions.length / 3;
  // Each renderer's layers and mesh copy, built once and held for the session.
  const stacks = new Map<number, { layers: Layer[]; shown: number; faded: boolean; copy: number }>();
  // The bake target, the arrays its positions and normals are read into, the vertex colors (shared, held).
  let bake = 0, read: number[] = [], colors = 0, searched = -Infinity;
  const bytes = new Uint8Array(4 * count), matrix = new Float64Array(12), up = new Float64Array(4);
  const hold = (object: number) => {
    n.gcAlloc(n.check(object));
    return object;
  };
  const keep = (object: number) => {
    n.call(slot.objectSetHideFlags, hold(object), literal.dontUnloadUnusedAsset, 0);
    return object;
  };
  const color = (material: number, property: string, rgba: number[]) => n.scratch(16, at => {
    rgba.forEach((value, k) => n.setF32(at, 4 * k, value));
    n.call(slot.materialSetColor, material, n.newString(property), at, 0);
  });
  const float = (material: number, property: string, value: number) =>
    n.call(slot.materialSetFloat, material, n.newString(property), value, 0);
  const vector = (getter: number, object: number, size: number) =>
    readFloats(n, at => n.call(getter, object, at, 0), size);
  /** The originals, found among the loaded materials at most once a second until all are. */
  function find(now: number) {
    if (sources.size === Object.keys(SOURCES).length || now - searched < 1) return;
    searched = now;
    const type = n.call(slot.typeGetType, n.newString(core('Material')), 1, 0);
    for (const material of n.array(n.call(slot.findObjectsOfTypeAll, type, 0), 20000)) {
      const title = n.alive(material) ? n.textOrNull(n.call(slot.objectName, material, 0)) : null;
      const kind = Object.entries(SOURCES).find(([, name]) => name === title)?.[0];
      if (kind && !sources.has(kind)) sources.set(kind, material);
    }
  }
  /**
   * A copy of `kind`'s original, held for the session (GC handle; DontUnloadUnusedAsset, or the next scene load's
   * UnloadUnusedAssets destroys it); the glass is "beam glow", the body's first material at full level.
   */
  function copy(kind: keyof typeof SOURCES) {
    const material = hold(n.call(slot.objectNew, n.metadata(typeInfo.Material)));
    n.call(slot.materialCtor, material, sources.get(kind)!, 0); // Its native object: hide flags only after.
    n.call(slot.objectSetName, material, n.newString(kind === 'glass' ? 'beam glow' : `beam ${kind}`), 0);
    n.call(slot.objectSetHideFlags, material, literal.dontUnloadUnusedAsset, 0);
    return { material, kind };
  }
  function build() {
    const glass = copy('glass');
    n.call(slot.materialDisableKeyword, glass.material, n.newString('_SPECULARHIGHLIGHTS_OFF'), 0);
    n.call(slot.materialDisableKeyword, glass.material, n.newString('_ENVIRONMENTREFLECTIONS_OFF'), 0);
    float(glass.material, '_SpecularHighlights', 1);
    float(glass.material, '_EnvironmentReflections', 1);
    float(glass.material, '_Smoothness', 1);
    float(glass.material, '_Metallic', 0);
    const band = copy('band');
    n.call(slot.materialSetTexture, band.material, n.newString('_BaseMap'), n.call(slot.textureWhite, 0), 0);
    float(band.material, '_Cull', 2); // UnityEngine.Rendering.CullMode Back, BlendMode OneMinusSrcAlpha.
    for (const property of ['_DstBlend', '_DstBlendAlpha']) float(band.material, property, 10);
    const rims = FRINGES.map(power => {
      const rim = copy('rim');
      float(rim.material, 'FresnelSize', power);
      color(rim.material, 'Albedo', [0, 0, 0, 0]);
      return rim;
    });
    const fade = copy('fade');
    n.call(slot.materialSetTexture, fade.material, n.newString('_BaseMap'), texture(), 0);
    // The renderer's own mesh while it glows, its vertex colors the reference seen from this client's camera.
    const own = keep(n.check(n.call(slot.objectInstantiate, mesh(), 0)));
    n.call(slot.objectSetName, own, n.newString('beam'), 0);
    n.call(slot.meshMarkDynamic, own, 0);
    return { layers: [fade, glass, band, ...rims], shown: 0, faded: true, copy: own };
  }
  /** `renderer`'s layers: those of a destroyed renderer (a past match's) when there is one, else new ones. */
  function stackOf(renderer: number) {
    let stack = stacks.get(renderer);
    if (stack) return stack;
    const dead = [...stacks.keys()].find(item => !n.alive(item));
    if (dead !== undefined) { stack = stacks.get(dead)!; stacks.delete(dead); }
    stack ??= build();
    stacks.set(renderer, stack);
    return stack;
  }
  /**
   * One frame of the reference on `renderer`'s posed body, into its mesh copy's vertex colors. BakeMesh with its scale
   * gives vertices relative to the renderer's position and rotation: world = position + rotation·vertex.
   */
  function paint(renderer: number, own: number) {
    const started = performance.now();
    if (!bake) {
      bake = keep(n.check(n.call(slot.createInstance, n.call(slot.typeGetType, n.newString(core('Mesh')), 1, 0), 0)));
      read = [0, 1].map(() => hold(array(n, core('Vector3'), count, new Uint8Array(12 * count))));
      colors = hold(array(n, core('Color32'), count, bytes));
    }
    n.call(slot.skinnedBakeMesh, renderer, bake, 1, 0);
    const [positions, normals] = [literal.positionAttribute, literal.normalAttribute].map((attribute, k) => {
      n.call(slot.meshChannelInto, bake, attribute, literal.float32Format, 3, read[k]!, 0);
      return new Float32Array(n.read(read[k]!, runtime.arrayData, 12 * count).buffer);
    });
    const camera = n.check(n.call(slot.componentTransform, n.check(n.call(slot.cameraMain, 0)), 0));
    const body = n.check(n.call(slot.componentTransform, renderer, 0));
    const [eye, view, origin, turn] = [[slot.transformPosition, camera, 3], [slot.transformRotation, camera, 4],
      [slot.transformPosition, body, 3], [slot.transformRotation, body, 4]].map(([getter, of, size]) =>
      vector(getter!, of!, size!));
    const c = rotationMatrix(view!), r = rotationMatrix(turn!);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) matrix[3 * i + j] = c[i]! * r[j]! + c[3 + i]! * r[3 + j]! + c[6 + i]! * r[6 + j]!;
      matrix[9 + i] = [0, 1, 2].reduce((sum, k) => sum + c[3 * k + i]! * (origin![k]! - eye![k]!), 0);
    }
    up.set([r[3]!, r[4]!, r[5]!, origin![1]!]);
    const shading = performance.now(), S = beamMaterialStats;
    S.bounds = shade(count, positions!, normals!, matrix, up, bytes);
    S.shading += performance.now() - shading;
    n.write(colors, runtime.arrayData, bytes);
    n.call(slot.meshSetColors32, own, colors, 0);
    const spent = performance.now() - started;
    if (!S.frames) S.first = spent;
    else S.max = Math.max(S.max, spent);
    S.frames++;
    S.total += spent;
    S.vertices = count;
  }
  return {
    /** The Material[] for `renderer` at `level` (0..1] and time `t`, or null while the originals are not loaded. */
    frame(renderer: number, level: number, t: number) {
      for (const [kind, source] of sources) if (!n.alive(source)) sources.delete(kind); // Unloaded with its scene.
      find(t);
      if (sources.size < Object.keys(SOURCES).length && !stacks.has(renderer)) return null;
      const stack = stackOf(renderer);
      if (n.call(slot.skinnedSharedMesh, renderer, 0) === mesh()) {
        n.call(slot.skinnedSetSharedMesh, renderer, stack.copy, 0);
      }
      for (const { material, kind } of stack.layers) {
        if (kind === 'fade') color(material, '_Color', [1, 1, 1, 1 - level]);
        if (kind === 'glass') color(material, '_BaseColor', [...GLASS, CLEAR * level]);
        if (kind === 'band') color(material, '_BaseColor', [1, 1, 1, OVER * level]);
      }
      stack.layers.filter(layer => layer.kind === 'rim').forEach(({ material }, k) =>
        color(material, 'FresnelColor', [...spectrum(t * 0.12 + k * STEP, FRINGE * level), 1]));
      if (n.call(slot.skinnedSharedMesh, renderer, 0) === stack.copy) paint(renderer, stack.copy);
      const faded = level < 1;
      if (!stack.shown || stack.faded !== faded) {
        const layers = stack.layers.filter(layer => faded || layer.kind !== 'fade').map(layer => layer.material);
        stack.shown = hold(array(n, core('Material'), layers.length, words(layers)));
        stack.faded = faded;
      }
      return stack.shown;
    },
    /** `renderer` no longer shows the material: its own mesh again. */
    release(renderer: number) {
      const stack = stacks.get(renderer);
      if (stack && n.alive(renderer) && n.call(slot.skinnedSharedMesh, renderer, 0) === stack.copy) {
        n.call(slot.skinnedSetSharedMesh, renderer, mesh(), 0);
      }
    },
  };
}

/** RGB of `hue` (0..1, red → violet → red) at `value`. */
function spectrum(hue: number, value: number) {
  return [0, 2 / 3, 1 / 3].map(shift =>
    value * Math.min(1, Math.max(0, Math.abs((((hue + shift) % 1) + 1) % 1 * 6 - 3) - 1)));
}
