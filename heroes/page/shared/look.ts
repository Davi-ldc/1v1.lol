import { objectsOfType } from '../../../src/page/game';
import { waitFor, type Native } from '../../../src/page/native';
import { beamMaterial } from '../beam/material';
import { heroFile, type HeroId } from '../ids';
import { field, literal, slot, typeInfo } from '../symbols';
import type { HeroFrame } from './frame';
import type { HeroClips } from './motion';
import { array, core, floats, passFloats, readFloats, words } from './unity';

/** hero.mesh.json in a hero's directory (format in heroes/README.md): the scan skinned to Poseidon's body bones. */
interface HeroMesh { bones: string[]; bindposes: number[][]; positions: number[]; normals: number[]; uv: number[];
  indices: number[]; boneIndices: number[]; boneWeights: number[];
  /** Bone local positions its bindposes assume, set on the pack's bones while it shows. */
  skeleton?: Record<string, number[]>;
  /** The body's proportions against Poseidon's, which the hitbox follows (fit). */
  source?: { shape?: Shape } }
type Shape = { arms: number; legs: number; thin: number; body: number; head: number };
/** beam.mesh.json in the beam hero's directory: the Aqua Cannon body mesh, read from the original bundle. */
export interface BeamMesh { source: { name: string }; positions: number[]; normals: number[]; tangents: number[];
  colors: number[]; uv: number[]; triangles: number[] }
export interface HeroLook { mesh: HeroMesh; image: Uint8Array; card?: Uint8Array; clips?: HeroClips; beam?: BeamMesh }
/**
 * A skin showing a scan: its hero's and its own ID, the name of its mesh, materials and card art (the slot's);
 * `glow` (the beam); `animations`: the skin pack prefab whose controllers it moves with.
 */
export interface ScanSkin { hero: string; skin: string; name: string; look: HeroLook; glow?: boolean;
  animations?: string }
/** The skinpacks bundle's AssetBundle name (its AssetBundle object in skinpacks__2246da13….bundle). */
const SKINPACKS = 'a5c3feb7559ed96463c5924cc551191d.bundle_8c5badbd562ed6699eeca57605ade486';

/** Hero `hero`'s files on the host (`files`, its directory's names), fetched before any native change. */
export async function loadHeroLook(hero: HeroId, files: string[]): Promise<HeroLook> {
  const image = files.find(name => /^hero_color\.(png|jpg)$/.test(name));
  if (!files.includes('hero.mesh.json') || !image) throw new Error(`The ${hero} files lack the mesh or the texture.`);
  const bytes = (name: string) => fetch(heroFile(hero, name)).then(async response => new Uint8Array(
    await response.arrayBuffer()));
  const json = <T>(name: string) => fetch(heroFile(hero, name)).then(response => response.json() as Promise<T>);
  const [mesh, color, card, clips, beam] = await Promise.all([json<HeroMesh>('hero.mesh.json'), bytes(image),
    files.includes('hero_card.png') ? bytes('hero_card.png') : undefined,
    files.includes('clips.json') ? json<HeroClips>('clips.json') : undefined,
    files.includes('beam.mesh.json') ? json<BeamMesh>('beam.mesh.json') : undefined]);
  return { mesh, image: color, card, clips, beam };
}

/** The Mesh named `name`: vertices, triangles, normals, uv, BoneWeight (4 weights, 4 indices) and bindposes. */
function buildMesh(n: Native, data: HeroMesh, hold: (object: number) => number, name: string) {
  const count = data.positions.length / 3;
  if (count > 65535) throw new Error('The hero mesh needs 32-bit indices.');
  const mesh = hold(n.call(slot.createInstance, n.call(slot.typeGetType, n.newString(core('Mesh')), 1, 0), 0));
  n.call(slot.objectSetName, mesh, n.newString(name), 0);
  n.call(slot.meshSetVertices, mesh, array(n, core('Vector3'), count, floats(data.positions)), 0);
  n.call(slot.meshSetTriangles, mesh, array(n, 'System.Int32', data.indices.length, words(data.indices)), 0);
  n.call(slot.meshSetNormals, mesh, array(n, core('Vector3'), count, floats(data.normals)), 0);
  n.call(slot.meshSetUv, mesh, array(n, core('Vector2'), count, floats(data.uv)), 0);
  const weights = new DataView(new ArrayBuffer(32 * count));
  for (let vertex = 0; vertex < count; vertex++) for (let k = 0; k < 4; k++) {
    weights.setFloat32(32 * vertex + 4 * k, data.boneWeights[4 * vertex + k]!, true);
    weights.setInt32(32 * vertex + 16 + 4 * k, data.boneIndices[4 * vertex + k]!, true);
  }
  n.call(slot.meshSetBoneWeights, mesh, array(n, core('BoneWeight'), count, new Uint8Array(weights.buffer)), 0);
  n.call(slot.meshSetBindposes, mesh, array(n, core('Matrix4x4'), data.bindposes.length,
    floats(data.bindposes.flat())), 0);
  n.call(slot.meshRecalculateBounds, mesh, 0);
  return mesh;
}

/** A Texture2D decoded from the PNG/JPG `image` by ImageConversion.LoadImage. */
function buildTexture(n: Native, image: Uint8Array, hold: (object: number) => number) {
  const texture = hold(n.call(slot.objectNew, n.metadata(typeInfo.Texture2D)));
  n.call(slot.texture2dCtor, texture, 2, 2, 0);
  if (n.call(slot.loadImage, texture, array(n, 'System.Byte', image.length, image), 0) !== 1) {
    throw new Error('LoadImage refused the hero texture.');
  }
  return texture;
}

/** A Sprite named `name` showing the whole PNG `image` (Sprite.Create, pivot at its center), kept by `asset`. */
export function buildSprite(n: Native, image: Uint8Array, name: string, hold: Keep, asset: Keep) {
  const texture = asset(buildTexture(n, image, hold));
  const header = new DataView(image.buffer, image.byteOffset, 24); // PNG IHDR: width, height (big-endian).
  const sprite = n.scratch(24, at => { // Rect (0, 0, width, height) and pivot (0.5, 0.5), passed by pointer.
    [0, 0, header.getUint32(16), header.getUint32(20), 0.5, 0.5].forEach((value, k) => n.setF32(at, 4 * k, value));
    return asset(hold(n.call(slot.spriteCreate, texture, at, at + 16, 0)));
  });
  n.call(slot.objectSetName, sprite, n.newString(name), 0);
  return sprite;
}

type Keep = (object: number) => number;

/**
 * The heroes' champion card art: `<DisplayIcon>d__8::MoveNext` (f51426) loads a card's art through
 * ImageExtensions.SetSpriteAsync (slot 8642, through the table) with the default skin's ThumbnailPath, which the heroes
 * share with Poseidon. For the icon of a ChampionInfoDisplay showing a hero with a portrait, the scan's goes in and
 * the call returns Task.CompletedTask; every other call runs the original. Prepared now, built and installed by the
 * returned function.
 */
async function cardIcon(n: Native, skins: ScanSkin[], hold: Keep, asset: Keep) {
  const D = field.ChampionInfoDisplay, sprites = new Map<string, number>();
  const heroIcon = (image: number) => {
    const display = objectsOfType(n, 'JustPlay.Champions.UI.ChampionInfoDisplay')
      .find(display => n.u32(display, D._championIcon) === image && !!n.u32(display, D._productData));
    return display ? sprites.get(n.text(n.u32(n.u32(display, D._productData), field.ProductData.Id))) : undefined;
  };
  const install = await n.prepareHook(slot.setSpriteAsync, 5, original => (image, key, release, token, m) => {
    try {
      const sprite = heroIcon(image);
      if (sprite) {
        n.call(slot.imageSetSprite, image, sprite, 0);
        return n.call(slot.completedTask, 0);
      }
    } catch (error) { console.error('LOCAL_HERO_CARD', String(error)); }
    return original(image, key, release, token, m);
  });
  return () => {
    for (const { hero, name, look: { card: png } } of skins) {
      if (png) sprites.set(hero, buildSprite(n, png, name, hold, asset));
    }
    install();
  };
}

/**
 * The scans' looks on every client (heroes/README.md, "Looks"): after the original PlayerSkinManager.SetCurrentSkinPack
 * (slot 31722) applies one of `skins`, the body part's SkinnedMeshRenderer shows the scan's Mesh and a copy of its
 * material with the scan's texture, and Poseidon's rigid face hides; another skin on the same pack gets the originals
 * back. A skin with `animations` moves with that pack's controllers; a mesh with a `skeleton` holds the body's bones at
 * its local positions while it shows, and its hitbox follows `source.shape` (fit).
 */
export async function installHeroLook(n: Native, skins: ScanSkin[], frames: HeroFrame) {
  const S = field.PlayerSkinManager, P = field.PlayerSkinPart;
  // Built once for the session. The handles keep the managed side; the native assets need DontUnloadUnusedAsset,
  // or the next scene load's UnloadUnusedAssets destroys them.
  const hold = (object: number) => { n.gcAlloc(n.check(object)); return object; };
  const asset = (object: number) => {
    n.call(slot.objectSetHideFlags, object, literal.dontUnloadUnusedAsset, 0);
    return object;
  };
  // Changed renderers and faces are held (GC handles) until restored or destroyed, so their pointers stay theirs;
  // so are moved bones (with their own local positions) until they get them back.
  type Moved = { name: string; bone: number; handle: number; value: number[]; target: number[] };
  // `legs`: a factor on the leg bones' targets (elastic/stretch.ts), grounded with the rest (frame); `fit`: the
  // hitbox fitted to the moved bones, with each collider's own size (fit, unfit).
  type Box = { collider: number; height: number; radius: number; center: number[] };
  type Fit = { packed: boolean; limbs: Box[]; player: number; boxes: Box[]; offset: number; handles: number[] };
  type Swapped = { mesh: number; materials: number; handles: number[]; moved: Moved[]; legs: number; manager: number;
    shape?: Shape; fit?: Fit };
  const swapped = new Map<number, Swapped>();
  const hidden = new Map<number, number>();
  // Per skin: its Mesh and Texture2D (built below) and Material[] (from the body's own, at its first swap).
  const shown = skins.map(skin => ({ ...skin, mesh: 0, texture: 0, materials: 0 }));
  let special = 0, specials = 0;
  const color = (material: number, name: string, rgba: number[]) =>
    passFloats(n, rgba, at => n.call(slot.materialSetColor, material, n.newString(name), at, 0));
  const bones = (renderer: number) => n.array(n.call(slot.skinnedBones, renderer, 0), 128)
    .map(bone => n.text(n.call(slot.objectName, bone, 0)));
  const place = (bone: number, value: number[]) =>
    passFloats(n, value, at => n.call(slot.transformSetLocalPosition, bone, at, 0));
  /**
   * The renderer's bones back at their own local positions, then, with a mesh `skeleton` (its own arm and leg
   * segments, Root raised), at its positions by Transform.set_localPosition. Root is Hips' parent.
   */
  function pose(renderer: number, entry: Swapped, skeleton?: Record<string, number[]>) {
    unfit(entry);
    for (const { bone, handle, value } of entry.moved.splice(0)) {
      if (n.alive(bone)) place(bone, value);
      n.gcFree(handle);
    }
    if (!skeleton) return;
    const named = n.array(n.call(slot.skinnedBones, renderer, 0), 128).filter(bone => n.alive(bone))
      .map(bone => [n.text(n.call(slot.objectName, bone, 0)), bone] as const);
    const hips = named.find(([name]) => name === 'Hips')?.[1];
    for (const [name, bone] of [...named, ...hips ? [['Root', n.call(slot.transformParent, hips, 0)] as const] : []]) {
      const target = skeleton[name];
      if (!target || !n.alive(bone)) continue;
      const own = readFloats(n, at => n.call(slot.transformLocalPosition, bone, at, 0));
      entry.moved.push({ name, bone, handle: n.gcAlloc(bone), value: own, target });
      place(bone, target);
    }
  }
  /**
   * After the Animator: the moved bones at their targets, and Root raised by what the longer legs lower the ankle that
   * the animation puts lowest, so that foot stays where the animation puts it (a fixed raise floats bent legs).
   */
  function frame({ moved, legs }: Swapped) {
    const root = moved.find(item => item.name === 'Root');
    const ankles = moved.filter(item => item.name.startsWith('Ankle_'));
    const heights = () => ankles.map(item => readFloats(n, at => n.call(slot.transformPosition, item.bone, at, 0))[1]!);
    const before = root && ankles.every(item => n.alive(item.bone)) ? heights() : [];
    for (const { name, bone, target } of moved) {
      if (name === 'Root' || !n.alive(bone)) continue;
      place(bone, /^(LowerLeg|Ankle)_/.test(name) ? target.map(v => v * legs) : target);
    }
    if (!root || !before.length || !n.alive(root.bone)) return;
    const after = heights(), low = before.indexOf(Math.min(...before));
    place(root.bone, [root.value[0]!, root.value[1]! + before[low]! - after[low]!, root.value[2]!]);
  }
  const capsule = (collider: number): Box => ({ collider, height: n.call(slot.capsuleHeight, collider, 0),
    radius: n.call(slot.capsuleRadius, collider, 0),
    center: readFloats(n, at => n.call(slot.capsuleCenter, collider, at, 0)) });
  const resize = ({ collider }: Box, height: number, radius: number, center: number[]) => {
    n.call(slot.capsuleSetHeight, collider, height, 0);
    n.call(slot.capsuleSetRadius, collider, radius, 0);
    passFloats(n, center, at => n.call(slot.capsuleSetCenter, collider, at, 0));
  };
  /**
   * The hitbox fitted to the shaped body (`source.shape`) while it shows, each part once it exists (heroes/README.md,
   * "Looks"): the pack's limb, torso and head capsules (SkinPack.PlayerColliders) by the shape's factors and, with a
   * player, its motor capsule, legs trigger and center offset raised with Root.
   */
  function fit(entry: Swapped) {
    if (!n.alive(entry.manager)) return;
    const root = entry.moved.find(item => item.name === 'Root'), rise = root ? root.target[1]! - root.value[1]! : 0;
    const fitted = entry.fit ??= { packed: false, limbs: [], player: 0, boxes: [], offset: 0, handles: [] };
    const shape = entry.shape, pack = n.u32(entry.manager, S._curSkinPack);
    if (!fitted.packed && shape && pack) {
      fitted.packed = true;
      for (const collider of n.list(n.u32(pack, field.SkinPack.PlayerColliders), 64)) {
        if (!n.alive(collider) || n.className(collider) !== 'CapsuleCollider') continue;
        const own = n.call(slot.componentTransform, collider, 0), name = n.text(n.call(slot.objectName, own, 0));
        const box = capsule(collider), axis = n.call(slot.capsuleDirection, collider, 0);
        const along = (f: number, thin: number) => resize(box, box.height * f, box.radius * thin,
          box.center.map((v, k) => k === axis ? v * f : v));
        if (/^(UpperLeg|LowerLeg)_[LR]$/.test(name)) along(shape.legs, shape.thin);
        else if (/^Shoulder_[LR]$/.test(name)) along(shape.arms, shape.thin);
        else if (/^Hand_[LR]$/.test(name)) along(shape.arms, 1);
        else if (/^Spine_0[12]$/.test(name)) along(1, shape.body);
        else if (name === 'HeadCollider') {
          const [offset, size] = [slot.transformLocalPosition, slot.transformLocalScale].map(get =>
            readFloats(n, at => n.call(get, own, at, 0)));
          resize(box, box.height * shape.head, box.radius * shape.head,
            box.center.map((v, k) => v * shape.head + (shape.head - 1) * offset![k]! / size![k]!));
        } else continue;
        fitted.limbs.push(box);
        fitted.handles.push(n.gcAlloc(collider));
      }
    }
    const player = n.u32(entry.manager, S._playerController);
    const motor = player && n.alive(player) ? n.u32(player, field.PlayerController._thirdPersonController) : 0;
    if (fitted.player || !motor) return;
    fitted.player = player;
    fitted.handles.push(n.gcAlloc(player));
    fitted.offset = n.f32(player, field.PlayerController._centerHeightOffset);
    n.setF32(player, field.PlayerController._centerHeightOffset, fitted.offset + rise / 2);
    for (const collider of [n.u32(motor, field.vThirdPersonMotor._capsuleCollider),
      n.u32(motor, field.vThirdPersonController._legsCollider)]) {
      if (!collider || !n.alive(collider)) continue;
      const box = capsule(collider);
      fitted.boxes.push(box);
      fitted.handles.push(n.gcAlloc(collider));
      resize(box, box.height + rise, box.radius, box.center.map((v, k) => k === 1 ? v + rise / 2 : v));
    }
  }
  /** Every fitted collider and the center offset back at their own values. */
  function unfit(entry: Swapped) {
    const fitted = entry.fit;
    if (!fitted) return;
    for (const box of [...fitted.limbs, ...fitted.boxes]) {
      if (n.alive(box.collider)) resize(box, box.height, box.radius, box.center);
    }
    if (fitted.player && n.alive(fitted.player)) {
      n.setF32(fitted.player, field.PlayerController._centerHeightOffset, fitted.offset);
    }
    fitted.handles.forEach(handle => n.gcFree(handle));
    entry.fit = undefined;
  }
  /**
   * A pack's controllers [match, menu], from its prefab in the loaded skinpacks bundle by
   * AssetBundle.LoadAssetAsync_Internal (the build keeps no synchronous load), polled between frames; loaded once.
   */
  const packs = new Map<string, Promise<number[]>>();
  function controllers(prefab: string) {
    let loading = packs.get(prefab);
    if (loading) return loading;
    packs.set(prefab, loading = (async () => {
      const type = (name: string) => n.call(slot.typeGetType, n.newString(name), 1, 0);
      const bundle = n.array(n.call(slot.loadedAssetBundles, 0), 64)
        .find(item => n.textOrNull(n.call(slot.objectName, item, 0)) === SKINPACKS);
      if (!bundle) throw new Error('The skinpacks bundle is not loaded.');
      const request = n.check(n.call(slot.assetBundleLoadAsync, bundle, n.newString(prefab),
        type('UnityEngine.GameObject, UnityEngine.CoreModule'), 0));
      const handle = n.gcAlloc(request);
      try {
        if (!await waitFor(() => n.call(slot.asyncOperationDone, request, 0) === 1, 100)) {
          throw new Error(`${prefab} did not load.`);
        }
        const pack = n.check(n.call(slot.gameObjectGetComponent,
          n.check(n.call(slot.assetBundleRequestResult, request, 0)), type('SkinPack, 1v1'), 0));
        return [field.SkinPack.AnimatorController, field.SkinPack.MenuAnimatorController]
          .map(offset => asset(hold(n.u32(pack, offset))));
      } finally { n.gcFree(handle); }
    })());
    return loading;
  }
  /** `skin`'s pack controller on `manager`'s Animator, after the frame, while it still shows that skin. */
  function animate(manager: number, skin: typeof shown[number]) {
    controllers(skin.animations!).then(([match, menu]) => {
      if (!n.alive(manager) || n.textOrNull(n.u32(manager, S.CurrSkinID)) !== skin.skin) return;
      const animator = n.u32(manager, S._animator), player = n.u32(manager, S._playerController);
      const controller = player && n.alive(player) ? match! : menu!;
      if (animator && n.alive(animator) && n.call(slot.animatorController, animator, 0) !== controller) {
        n.call(slot.animatorSetController, animator, controller, 0);
      }
    }).catch(error => console.error('LOCAL_HERO_LOOK', String(error)));
  }

  function apply(manager: number, skin?: typeof shown[number]) {
    for (const [renderer, { handles, moved, fit: fitted }] of swapped) {
      if (n.alive(renderer)) continue;
      [...handles, ...moved.map(item => item.handle), ...fitted?.handles ?? []].forEach(handle => n.gcFree(handle));
      swapped.delete(renderer);
    }
    for (const [object, handle] of hidden) if (!n.alive(object)) { n.gcFree(handle); hidden.delete(object); }
    const body = n.u32(manager, S._currBody), hero = !!skin;
    for (const renderer of body ? n.list(n.u32(body, P.Renderers), 16) : []) {
      if (!n.alive(renderer)) continue;
      if (n.className(renderer) !== 'SkinnedMeshRenderer') { // Poseidon's rigid face (SM_Chr_PoseidonFace_01).
        const object = n.check(n.call(slot.componentGameObject, renderer, 0)), handle = hidden.get(object);
        if (hero && !handle) hidden.set(object, n.gcAlloc(object));
        if (!hero && handle) { n.gcFree(handle); hidden.delete(object); }
        if (hero || handle) n.call(slot.gameObjectSetActive, object, hero ? 0 : 1, 0);
        continue;
      }
      let original = swapped.get(renderer);
      if (skin) {
        if (JSON.stringify(bones(renderer)) !== JSON.stringify(skin.look.mesh.bones)) {
          throw new Error('Body bones differ.');
        }
        if (!original) {
          const shared = n.call(slot.rendererSharedMaterials, renderer, 0);
          swapped.set(renderer, original = { mesh: n.call(slot.skinnedSharedMesh, renderer, 0), materials: shared,
            handles: [n.gcAlloc(shared), n.gcAlloc(renderer)], moved: [], legs: 1, manager });
        }
        original.manager = manager;
        if (!skin.materials) {
          const sources = n.array(original.materials, 8), copy = (source: number, name: string) => {
            const material = hold(n.call(slot.objectNew, n.metadata(typeInfo.Material)));
            n.call(slot.materialCtor, material, n.check(source), 0);
            n.call(slot.objectSetName, material, n.newString(name), 0);
            // The packs' toon materials sample `_BaseMap` (skinpacks bundle, "Poseidon shader"), not `_MainTex`.
            n.call(slot.materialSetTexture, asset(material), n.newString('_BaseMap'), skin.texture, 0);
            return material;
          };
          skin.materials = hold(array(n, core('Material'), 1, words([copy(sources[0]!, skin.name)])));
          if (skin.glow) {
            // The glow: the body's second material, "Poseidon_Silver" (shader with TCP2_RIM_LIGHTING), on the scan.
            special = copy(sources[1] ?? sources[0]!, `${skin.name} glow`);
            color(special, '_BaseColor', [1, 1, 1, 1]);
            color(special, '_Emission', [0, 0, 0, 1]);
            n.call(slot.materialSetFloat, special, n.newString('_RimMin'), 0.1, 0);
            n.call(slot.materialSetFloat, special, n.newString('_RimMax'), 0.95, 0);
            specials = hold(array(n, core('Material'), 1, words([special])));
          }
        }
        n.call(slot.skinnedSetSharedMesh, renderer, skin.mesh, 0);
        n.call(slot.rendererSetSharedMaterials, renderer, skin.materials, 0);
        original.shape = skin.look.mesh.source?.shape;
        pose(renderer, original, skin.look.mesh.skeleton);
      } else if (original) {
        n.call(slot.skinnedSetSharedMesh, renderer, original.mesh, 0);
        n.call(slot.rendererSetSharedMaterials, renderer, original.materials, 0);
        pose(renderer, original);
        original.handles.forEach(handle => n.gcFree(handle));
        swapped.delete(renderer);
      }
    }
  }

  const install = await n.prepareHook(slot.setCurrentSkinPack, 5, original => (manager, pack, packData, skinId, m) => {
    original(manager, pack, packData, skinId, m);
    try {
      const id = n.textOrNull(skinId), skin = shown.find(skin => skin.skin === id);
      apply(manager, skin);
      if (skin?.animations) animate(manager, skin);
    } catch (error) { console.error('LOCAL_HERO_LOOK', String(error)); }
    return 0;
  }, 0);
  // Synchronous from here on: the objects are built, then the hooks go in.
  const installCard = skins.some(skin => skin.look.card) ? await cardIcon(n, skins, hold, asset) : undefined;
  for (const skin of shown) {
    skin.mesh = asset(buildMesh(n, skin.look.mesh, hold, skin.name));
    skin.texture = asset(buildTexture(n, skin.look.image, hold));
  }
  install();
  // The humanoid Animator writes the avatar's local positions to the bones every frame, so moved bones get their
  // targets again after it (heroes/shared/frame.ts).
  if (shown.some(skin => skin.look.mesh.skeleton)) {
    frames.on('LOCAL_HERO_LOOK', () => {
      for (const entry of swapped.values()) {
        if (!entry.moved.length) continue;
        frame(entry);
        fit(entry);
      }
    });
  }
  installCard?.();
  const glowing = shown.find(skin => skin.glow);
  const material = glowing && beamMaterial(n, () => glowing.mesh, glowing.look.mesh.positions, () => glowing.texture);
  /**
   * The hero's glow, the "special material" (beam/material.ts, after a reference shader): at `level`
   * (0..1, eased by the caller) and time `t` (seconds) the body of `manager` shows its layers; at 0, its own material
   * again. Until the layers' originals are loaded, the toon special with its rim cycling the spectrum stands in.
   */
  function glow(manager: number, level: number, t = 0) {
    const body = n.u32(manager, S._currBody);
    const renderer = body ? n.list(n.u32(body, P.Renderers), 16).find(item => swapped.has(item)) : undefined;
    if (!renderer || !n.alive(renderer) || !specials || !glowing) return;
    if (level <= 0) {
      n.call(slot.rendererSetSharedMaterials, renderer, glowing.materials, 0);
      material?.release(renderer);
      return;
    }
    const layers = material?.frame(renderer, level, t);
    n.call(slot.rendererSetSharedMaterials, renderer, layers ?? specials, 0);
    if (layers) return;
    const hue = (t * 0.6) % 1, channel = (shift: number) => // HSV(hue, 1, 1) × 2 (HDR), by the level.
      2 * level * Math.min(1, Math.max(0, Math.abs(((hue + shift) % 1) * 6 - 3) - 1));
    color(special, '_RimColor', [channel(0), channel(2 / 3), channel(1 / 3), 1]);
  }
  /** The scan's SkinnedMeshRenderer on `manager`'s current body, if it shows a scan. */
  const renderer = (manager: number) => {
    const body = n.u32(manager, S._currBody);
    return body ? n.list(n.u32(body, P.Renderers), 16).find(item => swapped.has(item)) : undefined;
  };
  /** Sets `manager`'s leg factor (frame); the Mesh built for `skin`. */
  const legs = (manager: number, factor: number) => {
    const entry = swapped.get(renderer(manager) ?? 0);
    if (entry) entry.legs = factor;
  };
  const mesh = (skin: string) => shown.find(item => item.skin === skin)?.mesh ?? 0;
  /** The live managers showing a scan now. */
  const managers = () => [...swapped.values()].map(entry => entry.manager).filter(manager => n.alive(manager));
  return { renderer, legs, mesh, managers,
    receipt: shown.map(({ skin, look: { mesh: data, card } }) => ({ skin, vertices: data.positions.length / 3,
    triangles: data.indices.length / 3, bones: data.bones.length, card: !!card })), glow: glowing && glow };
}
