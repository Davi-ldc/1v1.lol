# Assets

The game keeps its content in two places. Scenes, prefabs and most settings are inside `WebGL.data` (see [build.md](build.md)). Everything loaded through Unity Addressables (skins, emote and skin thumbnails, weapon skin graphics, ability UX data, popups, localization) lives in asset bundles that the game fetches at run time.

## Where an asset comes from

Addressables resolves a key through a catalog to a location with a provider. Three providers matter here:

| Provider | Loads from | Example keys |
|---|---|---|
| `BundledAssetProvider` | an asset bundle, after its bundle dependencies load | `AbilitiesUXData/lol.1v1.abilities.dash` |
| `AssetBundleProvider` | a `.bundle` file, by URL or under `Addressables.RuntimePath` | the 19 bundles below |
| `LegacyResourcesProvider` | `Resources/` inside `data.unity3d`, no bundle | `BuildingsSettings`, `WeaponStatsDatabase` |

Resources-backed locators have no catalogued dependency (`dependencyKeyIndex = -1`) and no extra data, and their content is serialized inside the build. The build's catalog lists `BuildingsSettings`, `BuildsMaterialStatsDatabase`, the building prefabs `Floor`, `Ramp`, `Roof` and `Wall`, `LookAcceleration/LookAccelerationSettings` and its `_Legacy` variant, `WeaponStatsDatabase`, `ArmorStatsDatabase`, `GameProperties` (`Lol.OneVsOne.Settings.GameProperties`), `ModesProperties`, `PhotonServerSettings`, `TheBoxSettings`, `Configurations` and `Playtika.Unity.TheBox.Features.OfflineMode.OfflineModeFeatureModule` among them. Each name identifies the asset's type and says nothing about its field values.

## Settings and the catalog chain

`StreamingAssets/aa/settings.json` (3,270 bytes, SHA-256 `59cdfdd9…`) declares Addressables 1.21.8 for WebGL and defines three catalog locations:

| # | Key | Provider | Location |
|---:|---|---|---|
| 0 | `AddressablesMainContentCatalogRemoteHash` | `TextDataProvider` | the vendor's CDN, `…/1v1Assets/WebGL/Prod/4.701/catalog_2024.06.17.13.32.52.hash` |
| 1 | `AddressablesMainContentCatalogCacheHash` | `TextDataProvider` | `{persistentDataPath}/com.unity.addressables/catalog_2024.06.17.13.32.52.hash` |
| 2 | `AddressablesMainContentCatalog` | `ContentCatalogProvider` | `{RuntimePath}/catalog.json`, depending on 0 and 1 |

Locations 0 and 1 carry `ProviderLoadRequestOptions {"m_IgnoreFailures": true}`, so a failed hash lookup does not stop start-up. The other settings are `m_DisableCatalogUpdateOnStart = false`, `m_IsLocalCatalogInBundle = false`, `m_CatalogRequestsTimeout = 0`, `m_maxConcurrentWebRequests = 500`, `m_ExtraInitializationData = []` and `m_SettingsHash = 123fd717d61de6e51c126aad91a4dae3`.

This build's catalog is the 4.701 one that the settings name, `catalog_2024.06.17.13.32.52.json` (376,379 bytes, SHA-256 `45916eb1…`). Its `.hash` file (32 bytes, SHA-256 `df0adb0b…`) contains `58b3b2478717d7063dd360a1f0f0bf7b`, and the catalog's `m_BuildResultHash` is `0043b757f6f3622d24376a4d3cc6256e`. The file SHA-256, the `.hash` token, `m_BuildResultHash`, `m_SettingsHash`, a bundle's `m_Hash` and its `m_Crc` belong to separate hash domains and are not interchangeable.

The `StreamingAssets/aa/catalog.json` kept with the build (300,608 bytes, SHA-256 `a236b92f…`) is a different release. It dates from 2023, points at `Prod/4.51`, has no `m_BuildResultHash` and shares no bundle ID with 4.701. The two catalogs have 896 internal IDs in common, 66 only in 4.51 and 319 only in 4.701. Even a shared name can hold different content: scene `Offline/Offline` in 4.51 is `Offline/Practice` in 4.701, and `Offline/AimTrainerOffline` is `Offline/AimTrainer`. The bundles of one release cannot stand in for the other's.

## Catalog format

The catalog JSON stores its tables as base64 strings: `m_KeyDataString`, `m_BucketDataString`, `m_EntryDataString` and `m_ExtraDataString`. Once decoded:

- Keys are tagged: tag 0 is a string, tag 4 an int32. A numeric string key is not an index.
- Buckets hold a key offset, an entry count and the entry indices.
- Entries start with an int32 count. Each entry is seven little-endian int32s: internal ID, provider, dependency key, dependency hash, extra data offset, primary key and resource type. Entry `E` starts at byte `4 + 28 × E`.
- Extras with tag 7 hold an assembly and class name followed by UTF-16LE JSON, here `AssetBundleRequestOptions`.
- Dependencies resolve through buckets, not through `dependencyHashCode`.
- `m_InternalIdPrefixes` is empty, so internal IDs need no prefix expansion.

| 4.701 catalog | Count |
|---|---:|
| Distinct internal IDs | 1,215 |
| Keys (and buckets) | 2,467 |
| Entries | 1,724 |
| `BundledAssetProvider` entries | 1,462 |
| `LegacyResourcesProvider` entries | 209 |
| `AssetBundleProvider` entries (bundles) | 19 |
| Scene entries (`SceneInstance`, empty provider) | 34 |
| Declared bundle bytes | 92,216,401 |

Every bundle's request options set `m_Timeout = 0`, `m_RetryCount = 0`, `m_UseCrcForCachedBundles = true` and `m_UseUWRForLocalBundles = false`.

## The 19 bundles

Seventeen bundle IDs are absolute URLs on the vendor's CDN under `…/1v1Assets/WebGL/Prod/4.701/`. The other two, `abilitiesuxdata` and `popups` (entries 0 and 1), point at `{RuntimePath}/WebGL/`. The hash suffix of each name equals its `AssetBundleRequestOptions.m_Hash`.

| Bundle | Bytes | SHA-256 |
|---|---:|---|
| `abilitiesuxdata__b0a55cfd381222d3b50d4784754eeddf.bundle` | 13,097,310 | `94d5769c122b…` |
| `popups__c33d52d05ba7eabb6735ed5f3da58a68.bundle` | 18,157,967 | `35ff5ec24a22…` |
| `32db710a57b37048e2f120c600c37a02_unitybuiltinshaders_c62c67e1f20bf8f5f9ee5b83fbeed426.bundle` | 51,345 | `f381607e65a2…` |
| `equipmentgraphicdata__646ca1ec36f7a9e079aa7b753c45225a.bundle` | 21,400,111 | `73a8454e9473…` |
| `emotesthumbnails__8158559954b462953112471a9e48205e.bundle` | 1,553,917 | `7b79bb1609df…` |
| `skinpacks__2246da131415c15b9a3e941a0b541ef3.bundle` | 15,581,301 | `9e7ddc3f3e22…` |
| `skinsthumbnails__cbbe6bc13ddc4603ecefe38e8571c107.bundle` | 20,062,673 | `1297b0863ab5…` |
| `weaponskins__4960bdfd29f631c4207b886c4dfe6e08.bundle` | 1,743,378 | `1900394ddd76…` |
| `localization-locales__5d9d488470af26fedd08abd30ff2a8c3.bundle` | 2,576 | `c4f56d78dd1b…` |
| `localization-assets-shared__2d04c9bc46add9904de6f6a0c214a194.bundle` | 22,311 | `5fb994ccb8dc…` |
| `localization-assets-english(en)__e36a0657703ff4d70f5c7f6dc390be1e.bundle` | 346,334 | `0698ceaf9c60…` |
| `localization-assets-hebrew(he)__411d7fa338c586e54fd26b9e27f03f53.bundle` | 55,052 | `676d527c8c39…` |
| `localization-assets-spanish(es)__ae7d37420f54cd88177cc93c01964e51.bundle` | 63,986 | `9284cad6557c…` |
| `localization-asset-tables-english(en)__ddd9d912c658132e144f7b617e8bdc90.bundle` | 3,085 | `da12f417faed…` |
| `localization-asset-tables-hebrew(he)__7675259620ad3cec13b8dc5775c4c47b.bundle` | 3,085 | `d487d42373ba…` |
| `localization-asset-tables-spanish(es)__228f70fe71d1a7a8cab312dc17722825.bundle` | 3,076 | `446fe08e29ac…` |
| `localization-string-tables-english(en)__b9e6deda00d366acef72ab069ea206b7.bundle` | 22,197 | `e29435050263…` |
| `localization-string-tables-hebrew(he)__c7d419b72125aac6751a84497cd1acf0.bundle` | 22,984 | `8665d0d75811…` |
| `localization-string-tables-spanish(es)__2b5bc2c6e170ec24ca46848d18f39cc9.bundle` | 23,713 | `52eb5a8b5130…` |

Four of these were checked, the English and shared localization bundles. They have UnityFS format 8 headers from Unity 2021.3.37f1, with TypeTrees and no GameObjects, meshes or colliders.

Two chains in the decoded catalog show how a key reaches its bundles:

- Key `English (en)` (type `Locale`, entry 973) depends on key 2106, whose bucket (byte 35768) leads to entry 1559, `localization-locales__5d9d….bundle`.
- Key `AbilitiesUXData/lol.1v1.abilities.dash`, the Dash ability's UX data (type `DashUXData`, entry 1457), depends on key 2466, the string `-1342720430`. Its bucket (byte 40156) leads to entries 0 (`abilitiesuxdata`) and 1549 (`unitybuiltinshaders`).

## Start-up

The game initializes Addressables before the main menu needs any bundle:

1. `AppInitializer.InitializeAddressables` (f47077, slot 9566; state machine f47104) calls `AddressablesHandler.Init` (f51710, slot 9567).
2. `Init` runs `RefreshCatalogs` (f51718, slot 10602), which checks the CDN for a catalog update. That check is the only remote step in `Init`. `DidInit` (field +17) records that `Init` finished, and only its setter writes it. The setter (f22612, slot 120426) has no direct callers, so the code reaches it through the table.
3. `DownloadAllRequiredData` (f51711, slot 9569; state machine f51724) waits for `DidInit`, then downloads the dependencies of every label in `AddressablesData._requiredData` (`List<AssetLabelReference>`, field +12), which it reads through `SOManagedInstance<AddressablesData>.Instance`. It logs `[AddressablesHandler] - DownloadAllRequiredData - downloading {0} bytes` and sets `DidDownloadRequiredData` (field +16) when it is done.
4. `InitializeAddressables` returns `DidInit`, which `AppInitializer.Initialize` ANDs into its result (see [boot.md](boot.md#appinitializerinitialize)).

Loading ability UX data and skin packs waits for `DidDownloadRequiredData` (observed).

## What needs the network

| Resource | Source | Without the network |
|---|---|---|
| Scenes, prefabs, Resources settings | inside `WebGL.data` | available |
| Catalog hash check (locations 0 and 1) | CDN and browser storage | failures ignored (`m_IgnoreFailures`) |
| `catalog.json` | `{RuntimePath}` next to the build | available if served with the build |
| 17 CDN bundles | `Prod/4.701` on the CDN | missing unless served locally; the IDs are absolute URLs |
| 2 RuntimePath bundles | next to the build | available if served with the build |
| Balancing CSVs | DigitalOcean Spaces | not recovered |

Remote configuration, products and login are covered in [boot.md](boot.md) and [menu.md](menu.md).

## Unknowns

- The labels inside `AddressablesData._requiredData`.
- Which step of `Init` calls the `DidInit` setter.
- What `OfflineModeFeatureModule` configures.
- `WeaponStatsDatabase` declares two constant CSV locations on DigitalOcean Spaces, `BR_BALANCE_URL` (field 2314, `BR Weapon Balance.csv`) and `GACHA_BALANCE_URL` (field 2315, `Gacha Weapons v2.csv`). Their content and format, whether the game needs them and whether it has a built-in fallback were not recovered.
