import type { Pinned } from './inputs';

/**
 * The preserved originals of build 4.713 and what was checked about their containers. Scope: local integrity and
 * reproducibility, not vendor authenticity. No network requests.
 */

const EXTRACTED = 'artifacts/extracted', DATA = `${EXTRACTED}/data`, ORIGINAL = 'artifacts/original';
const AA = `${ORIGINAL}/StreamingAssets/aa`, REFERENCED = `${ORIGINAL}/referenced-assets`;
const BUNDLES = `${REFERENCED}/bundles`;

/** Size and SHA-256 of the 27 preserved originals, by path. */
export const inventory: Pinned[] = ([
  [`${EXTRACTED}/WebGL.data`, 242458616,
    'e663beb9d4a6e59d6c9284f35cd6aacda62d306721c02960f9a76191b18c4d43'],
  [`${EXTRACTED}/WebGL.framework.js`, 508743,
    'fbea5b6e338e3f39aab090da7ae250cb629f2f68d558ed6f57874eef00df04a6'],
  [`${EXTRACTED}/WebGL.wasm`, 84254305,
    '52b3dc8a49d4a08dc9d2fafe78a35de193df42570dc1088ff5d6e06653390a8f'],
  [`${DATA}/Il2CppData/Metadata/global-metadata.dat`, 19738244,
    '7aa3236f174d32b450594a99a5fb3b1374129b518c2a1fa3185403f9bca4ad03'],
  [`${DATA}/Resources/unity_default_resources`, 613728,
    'd59646b2ab6d2e2024594c5f6f9ecb3ae62355aa4dd48dc16e058ed790bc6c5f'],
  [`${DATA}/RuntimeInitializeOnLoads.json`, 5648,
    '1bdb410392da2203394c0bfca104a503f0b1898ee73376dd6d0d63b8016d10d2'],
  [`${DATA}/ScriptingAssemblies.json`, 10219,
    'd83dd2e193623c493026219a17023b1483529291ab7638abbbdb4244a3d17824'],
  [`${DATA}/boot.config`, 93,
    'f50526c986df343bce91327dcbad2db98b153043e675561856c2fec5f686c5db'],
  [`${DATA}/data.unity3d`, 211297137,
    '875739a9ea7c0724ba5c623093a12aa1f277f32247148182d26886647964c842'],
  [`${DATA}/resources.resource`, 1482336,
    '173257ae6ae090d3fcb68aec88cf5cd6e14d1882a70f7d8831710b0111107cb7'],
  [`${DATA}/sharedassets1.resource`, 6126250,
    'fdd50a89de69556c9bce077260344af5df22a8fdd894c8a34d8423e91d828086'],
  [`${DATA}/sharedassets11.resource`, 237606,
    '893ce8d0b4bd8bc71f3bbd3172d7caadb1bdd1ef52e384a976c48828a947b770'],
  [`${DATA}/sharedassets2.resource`, 2946982,
    'b52bfa2b609a9b5029b8c83ded77b5d08aa1e1dfcdb9a4cbd18e4e09191c19a9'],
  [`${AA}/catalog.json`, 300608,
    'a236b92f069b7deda6e52d89cf7a1d5f62a5a5b54a7a9b789e17bd21dc76e089'],
  [`${AA}/catalog.json.http-gzip`, 75387,
    '7e3672e4ff412b07abe8b7998173928479e8456ded7ba58778c274a8f2478cff'],
  [`${AA}/settings.json`, 3270,
    '59cdfdd9c9a048787876e7eb071a66e17946e4e9ae3aa42ed696d446cde2fa2a'],
  [`${AA}/settings.json.http-gzip`, 913,
    'c295a68c40e24be8b11c07cab47dbf0fb3c3ab0240f6bf327370a57320967fdb'],
  [`${ORIGINAL}/WebGL.data.unityweb`, 185553366,
    '68fd54e4b892f462c16e146471e0b924336517046c290120df35efbd6224df8e'],
  [`${ORIGINAL}/WebGL.framework.js.unityweb`, 95570,
    '6a453ff1b3a33e640ebe5e244d4cf25b6e837e1fb18aa9aefa7029269086b614'],
  [`${ORIGINAL}/WebGL.loader.js`, 44254,
    'cc62f6eb95c3d6723669537804b4010787528ec5986ac9a92cf15dfcafa633b2'],
  [`${ORIGINAL}/WebGL.wasm.unityweb`, 18820781,
    '6f31326072fe8522c4acbe45ddf5b7a3890c4c231efa30ef59232b0d1fc27c71'],
  [`${BUNDLES}/localization-asset-tables-english(en)__ddd9d912c658132e144f7b617e8bdc90.bundle`, 3085,
    'da12f417faed04ece7a1a15cd291689ba0ee2f9d67bc677e1906d4f3ffe3fa74'],
  [`${BUNDLES}/localization-assets-shared__2d04c9bc46add9904de6f6a0c214a194.bundle`, 22311,
    '5fb994ccb8dc8dcff481dc5dafed8a1d56e580b6dd37c86fe386eeb6fec3e210'],
  [`${BUNDLES}/localization-locales__5d9d488470af26fedd08abd30ff2a8c3.bundle`, 2576,
    'c4f56d78dd1b3b514ca3658bdf58c572a7fe4639d6715ab5abb2fd23a9eab8cc'],
  [`${BUNDLES}/localization-string-tables-english(en)__b9e6deda00d366acef72ab069ea206b7.bundle`, 22197,
    'e29435050263102e139f7049de63c39ea05f1c9255ada0c863477fe19856943e'],
  [`${REFERENCED}/catalog_2024.06.17.13.32.52.hash`, 32,
    'df0adb0be3d6ff25a6abad6fc147933a0b42d3644cb2c34b4f61de84926aeb23'],
  [`${REFERENCED}/catalog_2024.06.17.13.32.52.json`, 376379,
    '45916eb165608b383e74750f2bbd90fc5835b38cd07773015df91fac21f113bf'],
] satisfies [string, number, string][]).map(([path, size, sha256]) => ({ path, size, sha256 }));

/** Checked for every WebGL.data entry: inside the container, byte-identical to its extracted file, in the manifest. */
const checked = { withinContainer: true, extractedBytesIdentical: true, manifestMatches: true } as const;

/** WebGL.data, a UnityWebData1.0 container: its ten entries at the offsets `bun run setup` cuts them from. */
export const webdata = {
  magic: 'UnityWebData1.0',
  headerSize: 373,
  size: 242458616,
  entries: [
    { path: 'data.unity3d', offset: 373, size: 211297137,
      sha256: '875739a9ea7c0724ba5c623093a12aa1f277f32247148182d26886647964c842', ...checked },
    { path: 'resources.resource', offset: 211297510, size: 1482336,
      sha256: '173257ae6ae090d3fcb68aec88cf5cd6e14d1882a70f7d8831710b0111107cb7', ...checked },
    { path: 'RuntimeInitializeOnLoads.json', offset: 212779846, size: 5648,
      sha256: '1bdb410392da2203394c0bfca104a503f0b1898ee73376dd6d0d63b8016d10d2', ...checked },
    { path: 'ScriptingAssemblies.json', offset: 212785494, size: 10219,
      sha256: 'd83dd2e193623c493026219a17023b1483529291ab7638abbbdb4244a3d17824', ...checked },
    { path: 'sharedassets1.resource', offset: 212795713, size: 6126250,
      sha256: 'fdd50a89de69556c9bce077260344af5df22a8fdd894c8a34d8423e91d828086', ...checked },
    { path: 'sharedassets11.resource', offset: 218921963, size: 237606,
      sha256: '893ce8d0b4bd8bc71f3bbd3172d7caadb1bdd1ef52e384a976c48828a947b770', ...checked },
    { path: 'sharedassets2.resource', offset: 219159569, size: 2946982,
      sha256: 'b52bfa2b609a9b5029b8c83ded77b5d08aa1e1dfcdb9a4cbd18e4e09191c19a9', ...checked },
    { path: 'boot.config', offset: 222106551, size: 93,
      sha256: 'f50526c986df343bce91327dcbad2db98b153043e675561856c2fec5f686c5db', ...checked },
    { path: 'Il2CppData/Metadata/global-metadata.dat', offset: 222106644, size: 19738244,
      sha256: '7aa3236f174d32b450594a99a5fb3b1374129b518c2a1fa3185403f9bca4ad03', ...checked },
    { path: 'Resources/unity_default_resources', offset: 241844888, size: 613728,
      sha256: 'd59646b2ab6d2e2024594c5f6f9ecb3ae62355aa4dd48dc16e058ed790bc6c5f', ...checked },
  ],
  headerConsumedExactly: true,
  entriesContiguous: true,
  lastEntryReachesEof: true,
};

/** global-metadata.dat's header. */
export const metadata = { magic: 0xfab11baf, version: 31, headerOffset: 0 };

/** data.unity3d's UnityFS header. */
export const unityfs = {
  signature: 'UnityFS', formatVersion: 8, playerVersion: '5.x.x', engineRevision: '2022.3.53f1',
};
