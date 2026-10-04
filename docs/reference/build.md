# Build

1v1.LOL for the web is a Unity 2022.3 WebGL build compiled with IL2CPP. The browser loads four files: a JavaScript loader, an Emscripten framework, a WebAssembly module and a data container.

## Files

The loader is plain JavaScript. The other three ship as gzip `.unityweb` files, and each decompresses byte for byte to the extracted copy in the row below it, with valid gzip headers, CRCs and ISIZE fields.

| File | Bytes | SHA-256 |
|---|---:|---|
| `WebGL.loader.js` | 44,254 | `cc62f6eb95c3d6723669537804b4010787528ec5986ac9a92cf15dfcafa633b2` |
| `WebGL.framework.js.unityweb` | 95,570 | `6a453ff1b3a33e640ebe5e244d4cf25b6e837e1fb18aa9aefa7029269086b614` |
| `WebGL.framework.js` (extracted) | 508,743 | `fbea5b6e338e3f39aab090da7ae250cb629f2f68d558ed6f57874eef00df04a6` |
| `WebGL.wasm.unityweb` | 18,820,781 | `6f31326072fe8522c4acbe45ddf5b7a3890c4c231efa30ef59232b0d1fc27c71` |
| `WebGL.wasm` (extracted) | 84,254,305 | `52b3dc8a49d4a08dc9d2fafe78a35de193df42570dc1088ff5d6e06653390a8f` |
| `WebGL.data.unityweb` | 185,553,366 | `68fd54e4b892f462c16e146471e0b924336517046c290120df35efbd6224df8e` |
| `WebGL.data` (extracted) | 242,458,616 | `e663beb9d4a6e59d6c9284f35cd6aacda62d306721c02960f9a76191b18c4d43` |
| `global-metadata.dat` (inside `WebGL.data`) | 19,738,244 | `7aa3236f174d32b450594a99a5fb3b1374129b518c2a1fa3185403f9bca4ad03` |

The Addressables files that ship next to the build are in [assets.md](assets.md).

## Versions

| Claim | Evidence | Status |
|---|---|---|
| Unity 2022.3.53f1 | `data.unity3d` UnityFS header, format 8, engine revision `2022.3.53f1` (the `5.x.x` field before it is the player version, not the editor version). The WASM also holds `2022.3.53f1_df4e529d20d3` at linear address `0x58c8f`. | Confirmed |
| IL2CPP metadata version 31 | `global-metadata.dat`: `0xFAB11BAF` at offset 0, `31` at offset 4 (little endian) | Confirmed |
| Client version 4.713 | PlayerSettings (`globalgamemanagers:1`): ASCII `4.713` at object offset 620, in the same object as `JustPlay.LOL` (offset 40) and `1v1.LOL` (offset 56) | Bytes confirmed; the field name `bundleVersion` is inferred |
| Build GUID | `boot.config`, line 3: `be484d62f20d40fdb506de53c5cc1f1c` | Confirmed |
| Addressables content 4.701 | `StreamingAssets/aa/settings.json` names the catalog `Prod/4.701/catalog_2024.06.17.13.32.52` | Confirmed; see [assets.md](assets.md) |

## The data container

`WebGL.data` starts with `UnityWebData1.0\0` and a 373-byte header. Its ten entries are contiguous, and the last one ends at the last byte of the file.

| Entry | Offset | Bytes |
|---|---:|---:|
| `data.unity3d` | 373 | 211,297,137 |
| `resources.resource` | 211,297,510 | 1,482,336 |
| `RuntimeInitializeOnLoads.json` | 212,779,846 | 5,648 |
| `ScriptingAssemblies.json` | 212,785,494 | 10,219 |
| `sharedassets1.resource` | 212,795,713 | 6,126,250 |
| `sharedassets11.resource` | 218,921,963 | 237,606 |
| `sharedassets2.resource` | 219,159,569 | 2,946,982 |
| `boot.config` | 222,106,551 | 93 |
| `Il2CppData/Metadata/global-metadata.dat` | 222,106,644 | 19,738,244 |
| `Resources/unity_default_resources` | 241,844,888 | 613,728 |

### data.unity3d

`data.unity3d` (SHA-256 `875739a9…`) is a UnityFS archive, format 8, that decompresses to 874,548,003 bytes. It holds 72 serialized files, all format 22 for platform 20 (WebGL) and none with TypeTrees: `globalgamemanagers`, `globalgamemanagers.assets`, `resources.assets`, `level0` to `level33` with their `sharedassets*.assets`, and `Resources/unity_builtin_extra`.

Their object tables list 2,520,333 objects, including 674,385 GameObjects, 643,336 MonoBehaviours, 6,710 MonoScripts, 1,180 Meshes, 50,659 BoxColliders and 2,294 MeshColliders. Scenes repeat many instances, so these numbers count objects and overstate the number of distinct assets.

With no TypeTrees, a MonoBehaviour's bytes decode only against the field layout recovered from the IL2CPP metadata ([il2cpp.md](il2cpp.md)).

### Scenes

BuildSettings (`globalgamemanagers:11`) lists 34 scenes. `SceneManager` loads a scene by its build index, the # column.

| # | Scene | # | Scene |
|---:|---|---:|---|
| 0 | `Scenes/InitialScene` | 17 | `Scenes/Maps/BoxFight_Big` |
| 1 | `Scenes/MainMenu` | 18 | `Scenes/Maps/Zombies` |
| 2 | `Scenes/Maps/NormalMap` | 19 | `Scenes/Maps/Battle_Royale/BR_City` |
| 3 | `Scenes/Other/EditHud` | 20 | `Scenes/Maps/Battle_Royale/Mini_BR_City` |
| 4 | `Scenes/Maps/BoxFight_Teams` | 21 | `Scenes/MoveScene` |
| 5 | `Scenes/Maps/Offline/Practice` | 22 | `Scenes/Maps/Offline/WeaponTestOffline` |
| 6 | `Scenes/Maps/BoxFight` | 23 | `Scenes/Maps/Battle_Royale/BR_Practice_City` |
| 7 | `Scenes/Maps/Offline/AimTrainer` | 24 | `Scenes/Maps/Battle_Royale/BR_Western` |
| 8 | `Scenes/Other/LongTutorial` | 25 | `Scenes/Maps/1v1_Clash/Clash_City` |
| 9 | `Scenes/Other/ShortTutorial` | 26 | `Scenes/Maps/1v1_Clash/Clash_Western` |
| 10 | `Scenes/Maps/ZoneWars/Cubes` | 27 | `Scenes/Maps/LOL_Ball/LOLBall_City` |
| 11 | `Scenes/Maps/LOL_Ball/LOLBall_Arena` | 28 | `Scenes/Maps/LOL_Ball/LOLBall_Western` |
| 12 | `Scenes/Maps/Custom1v1Map` | 29 | `Scenes/Maps/Battle_Royale/BR_City_Christmas` |
| 13 | `Scenes/Maps/ZoneWars/CityMap` | 30 | `Scenes/Maps/Battle_Royale/BR_Dragons_Island` |
| 14 | `Scenes/Maps/Farm` | 31 | `Scenes/Other/ClearMemorySceneMove` |
| 15 | `Scenes/Maps/PumpkinBallFarm` | 32 | `Scenes/Maps/Battle_Royale/BR_Western New` |
| 16 | `Scenes/Maps/NormalMapZone` | 33 | `Scenes/Maps/Battle_Royale/BR_Mega` |

The table drops the `Assets/` prefix and `.unity` suffix that every path has. The offline scenes are Practice (5), AimTrainer (7) and WeaponTestOffline (22).

### Code inventory

`ScriptingAssemblies.json` lists 300 assemblies, indexed from 0. The game code is `1v1.dll` (index 181). Input is Rewired (`Rewired.dll` 145, `Rewired_WebGL.dll` 289, `Rewired_Core.dll` 292), and networking is Photon (`PhotonRealtime.dll` 96, `PhotonWebSocket.dll` 166, `PhotonUnityNetworking.dll` 203, `Photon3Unity3D.dll` 295). The list also names `Unity.Addressables.dll` (235), `UserService.Unity.dll` (186) and `Nucleus.V6.WebSockets.Connectors.UnityWebGL.dll` (86). It holds names only; IL2CPP compiled every method body into `WebGL.wasm`.

`RuntimeInitializeOnLoads.json` registers 33 start-up initializers, among them `FirstTimeUserHandler.Init`, `VersionDetector.Init`, `PhotonCustomTypeRegister.RegisterCustomTypes`, `FTUEAnalytics.Init` and `WebCredentialHttpRequest.SetCredentialHttpRequest`.

## The WebAssembly module

`WebGL.wasm` has 615 imported functions and 212,421 bodies, so function indices run from 0 to 213,035. Its one function table has 401,070 slots, 401,069 of them initialized (slot 0 is empty). Memory starts at 512 pages (32 MiB). The module has no custom sections, so it has no name section either. [il2cpp.md](il2cpp.md#from-a-method-to-its-code) shows how a managed method maps to a slot and a body.

## How the loader starts the build

`WebGL.loader.js` defines `createUnityInstance(canvas, config)`. Byte offsets below are in that file.

- Before downloading anything, it stops with an error if the browser lacks WebGL 2 (`does not support graphics API "WebGL 2"`, offset 43,759), WebAssembly (44,178) or WebGL (44,226).
- It downloads `frameworkUrl`, `codeUrl` and `dataUrl`. If a response's bytes still carry the gzip marker `UnityWeb Compressed Content (gzip)` (offset 38,597), a Web Worker inflates them; the loader has no other decompressor. When the server sends `Content-Encoding: gzip`, the browser inflates the file instead.
- `companyName` and `productName` default to `Unity` and `WebGL Player` (offset 2,017). With both set, every download goes through `cachedFetch` (offset 38,961), which stores a file in the loader's own cache (`UnityCache`, IndexedDB plus the Cache API, offset 5,754) only when its cache control is `must-revalidate` or `immutable` (offset 13,826). The default `cacheControl` (offset 881) returns `must-revalidate` for `dataUrl` and any `.bundle` URL and `no-store` for everything else, so by default only the data file and the bundles are cached.
- Before the build runs, the loader reads the `UnityWebData1.0` container (offset 43,142) and writes each entry into the Emscripten file system.

## Unknowns

- Whether these files came from the vendor, and whether the set is complete. A matching hash shows only that a copy has these bytes.
- Which CDN build line served them.
- The PlayerSettings layout, which would confirm that `4.713` is `bundleVersion`.
