import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { inventory } from './pins';

export const PROJECT_ROOT = resolve(import.meta.dir, '../../..');
export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** A project file fixed by SHA-256 (and size, when recorded). */
export interface Pinned { path: string; sha256: string; size?: number }

/** Size and SHA-256 of the 27 preserved originals, and the offsets of WebGL.data's ten entries (`webdata`). */
export const INVENTORY = 'src/host/build/pins.ts';

/**
 * The original Addressables content of build 4.713: its own StreamingAssets settings.json, which points at the
 * 4.701 remote catalog, and that catalog (the preserved StreamingAssets catalog.json is a 4.51 capture and is not
 * used). The only derivation: CDN bundle URLs become the local RuntimePath, so the client never reaches the CDN.
 * Evidence: docs/reference/assets.md.
 */
export const SETTINGS = { path: 'artifacts/original/StreamingAssets/aa/settings.json',
  sha256: '59cdfdd9c9a048787876e7eb071a66e17946e4e9ae3aa42ed696d446cde2fa2a' };
export const CATALOG = { path: 'artifacts/original/referenced-assets/catalog_2024.06.17.13.32.52.json',
  sha256: '45916eb165608b383e74750f2bbd90fc5835b38cd07773015df91fac21f113bf',
  servedSha256: 'ea1aa83645d06995d49ed9c03ff8cce1e881fc59ad5a31f71c0ca8a89444647b' };
const CDN_PREFIX = 'https://justplay-cdn.playtika.com/justbuild/1v1Assets/WebGL/Prod/4.701/';
export const LOCAL_PREFIX = '{UnityEngine.AddressableAssets.Addressables.RuntimePath}/WebGL/';

/** Every bundle of that catalog, [name, size, sha256], served at /StreamingAssets/aa/WebGL/<name>. */
const BUNDLES = 'artifacts/original/referenced-assets/bundles';
export const bundles = ([
  ['localization-asset-tables-english(en)__ddd9d912c658132e144f7b617e8bdc90.bundle', 3085,
    'da12f417faed04ece7a1a15cd291689ba0ee2f9d67bc677e1906d4f3ffe3fa74'],
  ['localization-assets-shared__2d04c9bc46add9904de6f6a0c214a194.bundle', 22311,
    '5fb994ccb8dc8dcff481dc5dafed8a1d56e580b6dd37c86fe386eeb6fec3e210'],
  ['localization-locales__5d9d488470af26fedd08abd30ff2a8c3.bundle', 2576,
    'c4f56d78dd1b3b514ca3658bdf58c572a7fe4639d6715ab5abb2fd23a9eab8cc'],
  ['localization-string-tables-english(en)__b9e6deda00d366acef72ab069ea206b7.bundle', 22197,
    'e29435050263102e139f7049de63c39ea05f1c9255ada0c863477fe19856943e'],
  ['32db710a57b37048e2f120c600c37a02_unitybuiltinshaders_c62c67e1f20bf8f5f9ee5b83fbeed426.bundle', 51345,
    'f381607e65a21737c6a957812079488f01d58c792bd67e57f4c90a1e4beaca59'],
  ['equipmentgraphicdata__646ca1ec36f7a9e079aa7b753c45225a.bundle', 21400111,
    '73a8454e94732e4e6cec9b6884ead910c786310e3f398b1b4d1ea971ca78e346'],
  ['abilitiesuxdata__b0a55cfd381222d3b50d4784754eeddf.bundle', 13097310,
    '94d5769c122bc6bd002c2db7bc45bf6dfe0a7872f27aadc0eed5a70a54ba3504'],
  ['popups__c33d52d05ba7eabb6735ed5f3da58a68.bundle', 18157967,
    '35ff5ec24a22e759350e7349ec74a8865a3d0b7e6f7956e35f492e3895dbe3ec'],
  ['emotesthumbnails__8158559954b462953112471a9e48205e.bundle', 1553917,
    '7b79bb1609df6d6a659d125d2963e2bb9f002cc04b243f935ad78553abab0ed4'],
  ['localization-assets-english(en)__e36a0657703ff4d70f5c7f6dc390be1e.bundle', 346334,
    '0698ceaf9c60d87f9cf89f80048a7080ec5be494e6822ae738bec06960ef554f'],
  ['localization-assets-hebrew(he)__411d7fa338c586e54fd26b9e27f03f53.bundle', 55052,
    '676d527c8c3915d5a28bb4f25f9efb3c232e35e65aaa9fa3cd6bc94e5dab0093'],
  ['localization-assets-spanish(es)__ae7d37420f54cd88177cc93c01964e51.bundle', 63986,
    '9284cad6557c0a6887f9f4c6b46204f1d32886af1f8cf9a8118441bb606a85c9'],
  ['localization-asset-tables-hebrew(he)__7675259620ad3cec13b8dc5775c4c47b.bundle', 3085,
    'd487d42373ba92fddd86b3389da8ce6f116b3c3685a0681d0079aef17b4e4b96'],
  ['localization-asset-tables-spanish(es)__228f70fe71d1a7a8cab312dc17722825.bundle', 3076,
    '446fe08e29ac430fbac8b248b55e23143cc2ad25fdef6d27754c3709befcb4cb'],
  ['localization-string-tables-hebrew(he)__c7d419b72125aac6751a84497cd1acf0.bundle', 22984,
    '8665d0d758116a37436384d696b89445c5c1640d4afeb3c10f02b9447d621d56'],
  ['localization-string-tables-spanish(es)__2b5bc2c6e170ec24ca46848d18f39cc9.bundle', 23713,
    '52eb5a8b5130b4976e54f89c53c415e1b8f15f8fbadb667be859620856af2d52'],
  ['skinpacks__2246da131415c15b9a3e941a0b541ef3.bundle', 15581301,
    '9e7ddc3f3e22f0a33d4c5bfe910d09b595dc003354d4f100ee8e9e35ec6e436b'],
  ['skinsthumbnails__cbbe6bc13ddc4603ecefe38e8571c107.bundle', 20062673,
    '1297b0863ab50346e6c94a47fbd2832d678ff8ebe67dffb5e4884ee7e545baf1'],
  ['weaponskins__4960bdfd29f631c4207b886c4dfe6e08.bundle', 1743378,
    '1900394ddd769f8e4ed148062e6ab4f8d0c7abb7912638e3e409a1f9ced96d06'],
] satisfies [string, number, string][]).map(([name, size, hash]) =>
  ({ name, path: `${BUNDLES}/${name}`, size, sha256: hash }));

/** The catalog with its 17 CDN bundle URLs moved to the local RuntimePath; everything else byte-identical. */
export function deriveCatalog(text: string) {
  if (sha256(text) !== CATALOG.sha256) throw new Error('Refusing an unrecognized Addressables catalog.');
  if (text.split(CDN_PREFIX).length - 1 !== 17) throw new Error('Catalog CDN references differ from the recovered 17.');
  const derived = text.replaceAll(CDN_PREFIX, LOCAL_PREFIX), hash = sha256(derived);
  if (hash !== CATALOG.servedSha256) throw new Error(`Derived catalog hash ${hash} differs.`);
  return derived;
}

/** Bytes of a pinned file; refuses any size or hash difference. */
export async function readPinned(file: Pinned) {
  const bytes = await Bun.file(resolve(PROJECT_ROOT, file.path)).bytes();
  if ((file.size !== undefined && bytes.byteLength !== file.size) || sha256(bytes) !== file.sha256) {
    throw new Error(`Local input differs: ${file.path}`);
  }
  return bytes;
}

export interface IntegrityResult {
  ok: boolean;
  checked: number;
  matched: number;
  /** Fingerprint of the verified list itself, to compare before/after a run. */
  inventorySha256: string | null;
  issues: Array<{ path: string; reason: string }>;
}

/** Every pinned input: the 27 preserved originals, then the Addressables files (six paths are in both lists). */
export function pinnedInputs(): Pinned[] {
  if (inventory.length !== 27 || inventory.some(entry => !entry.path.startsWith('artifacts/'))) {
    throw new Error('The inventory must list the 27 preserved inputs under artifacts/.');
  }
  return [...inventory, SETTINGS, CATALOG, ...bundles]
    .map((file: Pinned) => ({ path: file.path, size: file.size, sha256: file.sha256 }));
}

/** Streams the 27 preserved originals and the Addressables files and compares each with its record. Read-only. */
export async function verifyInputs(): Promise<IntegrityResult> {
  const result: IntegrityResult = { ok: false, checked: 0, matched: 0, inventorySha256: null, issues: [] };
  let files: Pinned[];
  try {
    files = pinnedInputs();
    result.inventorySha256 = sha256(JSON.stringify(files));
  } catch (error) {
    result.issues.push({ path: INVENTORY, reason: String(error) });
    return result;
  }
  for (const file of files) {
    result.checked++;
    try {
      const hasher = createHash('sha256');
      let size = 0;
      for await (const chunk of Bun.file(resolve(PROJECT_ROOT, file.path)).stream()) {
        hasher.update(chunk);
        size += chunk.byteLength;
      }
      const digest = hasher.digest('hex');
      if ((file.size === undefined || size === file.size) && digest === file.sha256) result.matched++;
      else result.issues.push({ path: file.path, reason: `size ${size} (expected ${file.size ?? 'unrecorded'}), ` +
        `sha256 ${digest === file.sha256 ? 'matches' : 'differs'}` });
    } catch (error) {
      result.issues.push({ path: file.path, reason: String(error) });
    }
  }
  result.ok = result.issues.length === 0;
  return result;
}

export function integrityProblems(before: IntegrityResult, after: IntegrityResult): string[] {
  const problems: string[] = [];
  if (!before.ok) problems.push('Preserved inputs did not verify before the run.');
  if (!after.ok) problems.push('Preserved inputs changed or became unavailable during the run.');
  if (before.inventorySha256 && before.inventorySha256 !== after.inventorySha256) {
    problems.push('The inventory itself changed during the run.');
  }
  return problems;
}
