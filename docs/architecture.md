# Architecture

This project runs the original 1v1.LOL Unity WebGL client (build 4.713, Unity 2022.3.53, IL2CPP) offline and on a LAN. A local Bun host serves the preserved original files, a WASM derived from the original by a short list of byte patches, and a page bundle that installs native adapters into the running client. Between them, the host and the adapters supply what the lost backend used to: a player profile, catalogs, remote config and a Photon server. How the original client works is in the references listed in [SKILL.md](SKILL.md#references).

## Layout

```
src/host/          Bun host: loopback only, read-only
  server.ts          routes, CSP, gzip, ETag, access key, hero directories, page HTML
  profiles.ts        baseline | practice | menu | lan
  wasm.ts            byte patches and deriveWasm
  play.ts            bun run play
  start.ts           ./start, after setup: the lan host behind a quick tunnel
  photon/            local Photon server: sockets, protocol, rooms, player IDs
  build/             the original build
    pins.ts            size and SHA-256 of the 27 preserved originals; WebGL.data's entries
    inputs.ts          every pinned input, their check, the derived Addressables catalog
    setup.ts           bun run setup: artifacts/ from playtika/, or --pack the other way
    verify.ts          bun run verify
src/page/          browser bundle, served as /local/page.js
  main.ts            config, adapter install order, window.local
  native.ts          the native runtime
  symbols.ts         the map of slots, cells and offsets
  game.ts            read accessors of original singletons
  boot.ts            original scene entry
  browser.ts         network guards, raw pointer lock, auth reply
  adapters/          one concept per file, each restoring the original offline
  observe/           read-only observers for scenarios
tests/
  unit/              bun test: maps and patches against IL2CPP, host, Photon, native runtime, re, setup, docs
  e2e/               bun run probe
    index.ts           flags, namespace, sessions
    harness/           isolation.ts (namespace, guarded browser, canaries), events.ts, run.ts (the run record)
    scenarios/         index.ts (registry); practice/, menu/, lan/; shared/menu.ts, shared/lan.ts
re/                reverse engineering (re/README.md)
  cli.ts             bun run re
  lib/               readers of the WASM, metadata and tables
  extract/           Python extractors: il2cpp/, assets/
heroes/            the custom heroes, an optional unit (heroes/README.md)
  page/              page extension, its symbol map and observers
  scenarios/         their probe scenarios
docs/              SKILL.md entry, reference/ for the original game, this file
.claude/skills/    procedures: re, native-adapter, milestone, delegate, humanizer
start              POSIX sh: Bun, the packages, bun run setup, then src/host/start.ts
```

Git ignores these on `main`; the private repository also tracks `heroes/files/`:

```
artifacts/           original/ (the build as served, StreamingAssets/, referenced-assets/) and extracted/
heroes/files/        the hero directories by slot and names.json
re/data/             what re/extract/ writes
runs/                one directory per probe or play session
.lan/                play --public: the access key and the player IDs
.cache/cloudflared/  ./start: the downloaded cloudflared and the tunnel log
```

## Host

`startHost` (`src/host/server.ts`) binds `127.0.0.1` and answers only `GET` and `HEAD` (405 otherwise). Every response carries a strict CSP (`connect-src 'self'`, no frames, objects or forms), `nosniff`, `no-referrer` and a same-origin resource policy. A path that contains `..`, `\` or NUL once decoded gets 400. A route the profile does not supply answers 404 and is recorded as `missing-resource`.

### Routes

| Route | Body |
|---|---|
| `/` | The page: canvas, `#local-config` JSON (profile, entry, features, key, `heroes`: each hero's files and names by slot), a status line while the client loads, `/local/heroes.js` (with heroes), `/local/page.js`, the original `WebGL.loader.js` |
| `/party` | The same page, for the original party share link (`lan` only) |
| `/WebGL.loader.js` | `artifacts/original/WebGL.loader.js` |
| `/WebGL.framework.js`, `/WebGL.data` | The extracted files; their gzip variant is the original `.unityweb` |
| `/WebGL.wasm` | The original, or the profile's derived WASM |
| `/StreamingAssets/aa/settings.json` | The original Addressables settings (pinned) |
| `/StreamingAssets/aa/catalog.json` | The 4.701 catalog with its CDN bundle URLs moved to the local `RuntimePath` |
| `/StreamingAssets/aa/WebGL/<bundle>` | The 19 pinned bundles |
| `/local/page.js` | The page bundle, built at start by `Bun.build` as a deterministic IIFE |
| `/local/heroes.js` | The heroes bundle, built and served only with heroes (`--heroes`); it registers itself in `window.localExtensions` before the page runs |
| `/local/heroes/<slot>/<file>` | Each present hero's files (JSON, JPEG or PNG), checked against its `manifest.json` by size and SHA-256 when the host starts |
| `/local/id?device=` | The four-digit player ID for a browser's install ID (`lan`) |
| `/photon` | WebSocket upgrade to the local Photon server, subprotocol `GpBinaryV18` (`lan`) |

`baseline` serves no Addressables routes.

### Delivery

Every body is revalidated: `Cache-Control: no-cache` with an ETag, and a 304 on a matching `If-None-Match`. A preserved file's ETag comes from its size and modification time, and a body built in memory gets a content hash. The comparison is weak, since a tunnel edge that recodes a body hands back `W/"…"`.

Clients that accept gzip get a gzip variant, with `Vary: Accept-Encoding`. For `WebGL.framework.js` and `WebGL.data` that variant is the original `.unityweb`, which decompresses byte-identical to the extracted file. Every body built in memory (the derived WASM, the Addressables settings, catalog and bundles, the page and its scripts, the hero files) is compressed once, and all of them start compressing when the host starts. The loader, and the original WASM that `baseline` serves, have no gzip variant. `idleTimeout` is 255 s, the longest Bun allows, so a request waiting for a compression (the derived WASM takes over 10 s) or for a slow tunnel is not cut.

The loader keeps the data file and the bundles in its own IndexedDB cache by default ([build.md](reference/build.md#how-the-loader-starts-the-build)). The page passes `cacheControl: () => 'no-store'`, which keeps every download out of it: writing there blocked the page for about 10 s, long enough for Photon to time out, and made MainMenu load three times slower. The browser's HTTP cache, revalidated by ETag, keeps the files instead.

### Access modes

| Mode | Who gets in |
|---|---|
| Local (default) | Requests whose Host is `localhost` or `127.0.0.1` on the host's port, or any `--host` name (a local reverse proxy such as `tailscale serve`); any other Host gets 403 |
| Public (`play --public`) | Any Host name, but every request needs the access key. `?k=<key>`, or a `/k/<key>/` path prefix (the party share link's base), answers with a cookie and a redirect; later requests carry the cookie; without it the host answers 404 |
| Public and open (`--public --open`) | Anyone who has the tunnel address. The key links still set the cookie, and the page carries no key, so the party share link is the bare address |

With `--public`, `play` creates the key once (12 random bytes, base64url) in `.lan/key` and saves the player IDs in `.lan/ids.json`, so the link and the IDs survive restarts; otherwise the IDs last as long as the host. The public mode is meant for a tunnel that forwards to the loopback host (`cloudflared tunnel --url http://127.0.0.1:8080`), and `./start` runs one ([Start](#start)).

### Inputs

`src/host/build/` pins the original build. `pins.ts` records the size and SHA-256 of the 27 preserved originals and the offsets of `WebGL.data`'s ten entries (`webdata`). `inputs.ts` adds the Addressables settings, the 4.701 catalog and its 19 bundles. Six of those appear in both lists, so 48 checks cover 42 files. `bun run verify` streams them all and compares. Every probe and play session runs the same check before and after (`harness/run.ts`), along with a hash of the list itself. `deriveCatalog` moves only the 17 CDN bundle URLs to the local `RuntimePath`, so the client never reaches a CDN; its output hash is pinned too.

`bun run setup` (`setup.ts`) runs that check and rebuilds each file that fails it, through a temporary file that replaces the file only when its size and hash match the pin. An original comes from `playtika/` (tracked; the game company's files), which mirrors the paths under `artifacts/original/`. In `playtika/`, a file over 45 MB is stored as `<name>.part-00`, `.part-01`, … of at most 45,000,000 bytes each; today that is only `WebGL.data.unityweb`, in five parts. An extracted file is the gunzipped `.unityweb`, or a `WebGL.data` entry cut at its `webdata` offset. Setup never reaches the network, stops with an error when an original is in neither `playtika/` nor `artifacts/original/`, and ends with the check again. `--pack` writes `playtika/` from a verified `artifacts/original/`.

### Profiles

`src/host/profiles.ts` defines what each profile serves and what the page installs. The served WASM hashes are pinned there and listed in [SKILL.md](SKILL.md#pins).

| Profile | Entry | Page features | WASM |
|---|---|---|---|
| `baseline` | none | none | the original; control run |
| `practice` | Practice (scene 5) through the `GameManager.Awake` debug route | `browser`, `editPreferences` | `awakeGate`, `noAds` |
| `menu` | MainMenu (scene 1) and the original `LoadoutScreen` | `browser`, `serverUser`, `catalogs`, `screens`, `requiredData`, `railgunScope` | every patch group |
| `lan` | as `menu` | `menu` plus `photon`, `gameModes`, `party`, `rename` | same as `menu` |

`hero` joins `menu` and `lan` when `play` or `probe` has heroes (`--heroes`); the host refuses `--heroes` on `practice`. `menu` and `lan` share one WASM. `deriveWasm` refuses any source build but the original. It checks that every patch's `before` bytes match, that `after` has the same length and that no two patches overlap, validates the result with `WebAssembly.validate`, and refuses to serve it unless its hash equals the profile's pin. The pin is the only check on the `after` bytes, so every new patch changes it.

### WASM patches

A patch is `{ f, offset, before, after, why }`: a file offset inside function `f`, the original bytes and their replacement of the same length. `windowPatch` builds one from a shorter body padded with `nop`. Each group is a named export of `src/host/wasm.ts`.

| Group | Function | Effect |
|---|---|---|
| `awakeGate` | f45922 `GameManager.Awake` | The editor check yields true, which enables the debug bootstrap used to enter Practice; the global `IsEditor` stays untouched |
| `noAds` | f49756 `AdsManager.ShouldUserViewAds` | Returns false |
| | f49757 `AdsManager.PrepareInterstitialAd` | Returns before its stack allocation |
| | f49760 `AdsManager.HideEmbeddedAds` | Returns; no embedded ad exists |
| | f49764 `AdsManager.UpdateEmbeddedAdsVisibility` | Returns |
| | f49765 `AdsManager.UpdateBannerVisibility` | Returns |
| | f49767 `AdsManager.IsRewardedVideoReady` | Returns false: the ad provider is created only after a remote ads config, so none exists offline |
| | f49777 `AdsManager.RegisterRewardedVideoInfoCallback` | Returns; no reward is granted |
| `menuAccess` | f43611 `LoadoutLobbyButton.OnClick` | Drops the remote-config gate instead of dereferencing the absent config |
| `loadouts` | f49905 `ModeInfo.get_UsesLoadout` | A mode whose native `_usesLoadout` is set uses the loadout; the absent EquipmentV2 `are_loadouts_enabled` counts as true |
| `localSelection` | f48777 `<EquipWeaponSkin>d__3.MoveNext` (3 windows) | After the native local selection, skips the backend call and its await, notifies the original listeners, completes the local `Task(true)` and drops the analytics call |
| | f48781 `<UnequipWeaponSkin>d__4.MoveNext` (3 windows) | The same for unequip |
| | f50668 `LoadoutScreen.EquipItemToSlot` | Returns after the native equip, recalculation and UI refresh, before the server request |
| | f43566 `LoadoutItemPopup.DisplayUpgradeButton` | Takes the method's own branch that hides upgrade, maxed and blueprint controls |
| | f43564 `LoadoutItemPopup.DisplayItemDetails` | Hides the currency component instead of reading an absent balance |
| `grantAnalytics` | f97472 `UserEquipment.AddItem` | Keeps the level and dictionary update, drops the final analytics call |
| | f97446 `UserChampions.AddChampion` | Keeps the `Level=0` entry, drops the same call |
| `dailySpins` | f115944 `DailySpinsController.Start` | Returns before registering listeners or preloading popups |
| | f115945 `DailySpinsController.OnDestroy` | Returns; Start registered nothing |
| `scrollReset` | f46257 `SettingsPanel.InitSettingsInputs` | The scroll-wheel edit reset toggle defaults to on; a saved value still wins |
| `ageLimitSilent` | f47571 `LimitedFeaturesManager.ValidateFeature` | Drops the `ShowAgeLimit` popup call and still returns the failure, so the ad stays skipped |
| `validNicknames` | f51669 `AgeGateManager.ToValidNickname` | Keeps the typed nickname, which offline `IsFeatureAvailable(Names)` would replace with a generated one |
| `partyCodes` | f118201 `GameProperties.get_PartyRoomNameLength` | Returns 1, so party codes have one digit and `JoinParty` accepts them |
| | f116291 `PhotonUtils.GenerateRandomRoomName` (2 sites) | Formats the room number with `"0"` instead of `"00000"` |
| `photonBudget` | f47934 `<WaitForConnection>d__24.MoveNext` | Waits a constant 60 s instead of `_connectionTimeout` (10 s), for connect and every reconnect |

### Photon server

`src/host/photon/` serves the three roles the client reaches, Name Server, Master and Game server, over one WebSocket endpoint. The page's WebSocket rewrites every `*.photonengine.io`, `*.exitgames.com` and `*.photon.lan` URL to `/photon`, carrying the original host as `server` and the browser's install ID as `device`.

- `server.ts` owns the sockets. It takes each socket's role from its original host, sends the init the client waits for on open, answers pings, `GetRegions` and `Authenticate` (the Name Server issues a `lan:` token that Master and Game server require), and hands every other operation to `rooms.ts`. It records operations in the run's events, keeping only the first three RaiseEvents of each event code.
- `protocol.ts` encodes and decodes GpBinaryV18 (Protocol18) frames, making the same choices as the client's writer, so every message the client writes re-encodes to the same bytes.
- `rooms.ts` implements the LoadBalancing operations the client uses: lobbies, create, join, join random with the client's two SQL lobby filter forms, leave, raise event (with groups, receivers and the PUN room cache), set properties, change groups and find friends. The Master sends AppStats after authentication. The lowest remaining actor becomes master client.
- `ids.ts` gives each browser the lowest free four-digit player ID, keyed by the original install ID. The Name Server returns it as the user ID.
- The only region is `eu`. Master and Game addresses are `wss://master.photon.lan:19090` and `wss://game.photon.lan:19091`, which the page sends back to `/photon`.

## Page runtime

### Boot

`main.ts` reads `#local-config` and, with the `browser` feature, installs the browser shims before the loader runs. It then creates the Unity instance, installs the profile's native adapters in a fixed order, delivers the pending auth replies and starts the scene entry. Page extensions in `window.localExtensions` (the heroes) install first, so the adapters see what they add. The first adapter that throws stops the entry, and its status and reason land in `window.local.adapters`. Practice's `editPreferences` is the exception: it runs once the scene has loaded and only logs a failure.

`browser.ts` installs:

- network guards for the personal browser: `window.open`, `WebSocket`, `RTCPeerConnection` and `WebTransport` fail, except Photon sockets in `lan`, which go to `/photon`;
- raw (unadjusted) pointer lock on the canvas, falling back to adjusted input only on `NotSupportedError`;
- the framework's Firebase calls, answered with the recovered Error reply once the adapters are installed. No account or token exists.

`boot.ts` waits for the `LoadingScreenManager` subscribed to `AppInitializer.OnInitRemoteConfig`, then loads Practice (scene 5) or MainMenu (scene 1), hides the old loading overlay, and in MainMenu calls the original `ShowLoadoutScreen(Weapons)`. It polls every 100 ms for up to 60 s and reports each checkpoint (`scene-requested`, `scene-loaded`, `loadout-requested`, `screen-active` or `blocked`) as a `LOCAL_BOOT` console line, which the probe waits for.

### The native runtime

`native.ts` wraps the Emscripten module (`HEAPU8` and the indirect function table). Adapters, observers and the heroes use it instead of touching memory directly.

- Reads and writes take a base and an offset (`n.u32(object, field.Type.key)`), and every address is checked to be positive, aligned and inside memory, so a null base fails instead of reading low memory.
- `call(slot, ...)` calls through the function table after checking the arity, and restores the stack on failure; `callVirtual` goes through the vtable at klass+192.
- `check` and `instance(p, klass)` guard pointers handed to native code; `scratch` lends zeroed native memory for one call; `newString`, `text`, `array`, `list` and `dictionary` cross managed types.
- `metadata(cell)` resolves a metadata usage cell through the runtime's own initializer (slot 1916).
- `gcAlloc`/`gcFree` hold managed objects with GC handles while JavaScript keeps them.
- `prepareHook(slot, params, make, results)` builds a replacement for a table slot from a tiny generated WASM module (`bridge`) and returns the install function. Install refuses if the slot changed in the meantime. `make` receives the original, and a hook forwards every call it does not own to it.
- `waitFor(ready, polls)` polls every 100 ms; `sample(read)` turns an observer's failure into a reported `unavailable` section.

### The symbol map

`symbols.ts` names the parts of the original client the page uses: function-table slots, TypeInfo cells, MethodInfo cells, string literals, virtual slots, enum literals, instance fields, static fields and runtime layout constants. Slots, cells, virtual slots and literals are `[value, recovered name]` pairs; field offsets are keyed by type and recovered field name. Code reads them literally (`slot.x`, `field.Type.key`), so the unused-key test in `tests/unit/symbols.test.ts` can see every use. The same test checks every entry against the IL2CPP tables through `re/lib`. The heroes add their entries in `heroes/page/symbols.ts`, in the same shape; the unused-key check runs per map over its own folder, and the hero map never redefines a core key. A raw slot, cell or offset in any other file is a bug. A name of the form `f<index>` marks shared generic or runtime code that no metadata row pins; its meaning then comes from the MethodInfo passed with it.

### Adapters

An adapter is `install(n)`. It throws `stage: reason` on failure and returns counts for `window.local.adapters`. It works through original constructors and methods, a table-slot hook, or (rarely) a value the client reads; it never fabricates a login, a balance, a completion flag or a success callback. The rows below follow the install order.

| Adapter | Feature | Boundary |
|---|---|---|
| `server-user.ts` | `serverUser` | One `ServerUser` from its original constructor, every recovered item at its original `LevelCap` and every champion at `MAX_LEVEL`, installed by `FirebaseManager.SetServerUser`; `IsLoggedIn` stays false. `GeneralData` gets an adult age gate and the original guest nickname. The AUTO EQUIP preset goes first in `UserEquipment`'s dictionary. In `lan`, the player ID comes from `/local/id` |
| `catalogs.ts` | `catalogs` | Skin products through `SkinProductData` into `SkinProductDataFactory`; champions through a local ChampionsConfig given to `FirebaseChampionsHandler.Init`; champions without a skin carrying their name get a themed Mythic skin |
| `cosmetics.ts` | (catalogs) | Weapon-skin and emote catalogs staged in private factories and published once every entry passes the native lookups; ProductsV9 stays unavailable |
| `screens.ts` | `screens` | `ValidateCanMoveToScreen` lets the offline screens through; each `UiManager.Start` moves out of their Canvas the switchers and buttons of screens the offline menu does not offer (Locker, Shop, BattlePass, offers, app-store badges, the XP booster) |
| `required-data.ts` | `requiredData` | Runs the original `AddressablesHandler.Init` and `DownloadAllRequiredData` on the local catalog, recording Init's end through its own `DidInit` setter |
| `game-modes.ts` | `gameModes` | A local GameModesV5 document through its handler's `Init`, so the mode menu lists Practice and the local custom modes; every other field stays on its absent-data fallback |
| `party.ts` | `party` | The share link's base URL literal points at this host; the friendly-match toggle leaves its Canvas |
| `rename.ts` | `rename` | The profile panel's button opens the original name field; after `OnEndNameEdit`, the cached name goes into `GeneralData.Nickname` and the original `UpdatePhotonInfo` and party refresh publish it |
| `railgun-scope.ts` | `railgunScope` | The railgun's `ZoomSettings` become the military sniper's (scope, FOV 15) |
| `photon-connect.ts` | `photon` | Gives `FirebaseCheaterSettingsData` its handler with Photon auth off and runs the original `ConnectToPhoton`; `PhotonPeer.DisconnectTimeout` becomes 30 s; clears `AppInitializer.IsInitializing` so `AttemptReconnect` can reconnect |
| `edit-preferences.ts` | `editPreferences` | Turns on EditOnRelease, ResetEditWithoutConfirm and ScrollWheelReset through the original toggle callbacks (practice) |

`game.ts` holds read accessors shared by adapters and observers: the active scene, the current mode, `FirebaseManager` and its `ServerUser`, the `UiManager` and `LoadoutScreen`, `objectsOfType`, remote-config handlers and their local `initSettings`, `LocalProductsData` and factory instances.

### Observers

`window.local.observe.<name>()` returns plain JSON for scenarios: `match`, `weapons`, `edit`, `emotes`, `menu`, `presentation`, `switchers`, `cosmetics`, `party`, `modes`, `items` and `popups`, plus the heroes' own observers. Observers never write game state and avoid getters that create instances (`mesh`, `materials`). Each section goes through `sample`, so one failing read does not hide the others.

## Heroes

The custom heroes, in two slots named by mechanic (`beam`, `elastic`), are a declared adaptation kept apart from the restoration of the original. All of it is in `heroes/`: the page extension in `heroes/page/`, with its own symbol map and observers, and the scenarios, with their own registry, in `heroes/scenarios/`. They install only when `play` or `probe` has their directories (`--heroes <dir>`, one subdirectory per slot and a private `names.json` with each hero's display name and IDs; `play` also takes the repository's `heroes/files/`). Nothing outside that folder imports it: the host, the scenario registry and the tests look for it at run time, so deleting `heroes/` leaves the rest working. [heroes/README.md](../heroes/README.md) describes them.

## Tools

| Command | What it does |
|---|---|
| `./start [--port n] [--open] [--local]` | Bun, the packages and `bun run setup`, then the `lan` host behind a quick tunnel ([Start](#start)) |
| `bun run setup [--pack]` | Builds `artifacts/` from `playtika/` wherever it fails its pins, then checks them ([Inputs](#inputs)) |
| `bun run verify` | Checks every pinned input by size and SHA-256 |
| `bun run play [--profile p] [--port n] [--host name] [--public] [--open] [--heroes dir]` | Starts the host for a personal browser and records a run under `runs/` ([Play](#play)) |
| `bun run probe [--profile p] [--scenario a,b] [--heroes dir] [--timeout-ms n] [--renderer software\|auto] [--interactive] [--check-isolation]` | Runs the scenarios of `tests/e2e/` in an isolated namespace ([Probe](#probe)) |
| `bun run re <command>` | Reverse-engineering queries over the WASM and IL2CPP tables (stdout only; [re/README.md](../re/README.md)) |
| `bun run typecheck`, `bun test` | `tsc --noEmit`; the invariant tests in `tests/unit/` (without the original build or the IL2CPP tables in `re/data/`, the ones that read them are skipped) |

### Probe

The probe is `tests/e2e/`. `index.ts` checks the flags, then re-executes itself inside a user and network namespace (`unshare`) with only loopback up, and never falls back to an unisolated run. It refuses a scenario whose entry differs from the profile's, and a hero scenario, which names the hero slots it needs (`heroes`), unless `--heroes` has their directories. The profile defaults to `baseline`.

Every probe browser is guarded. It aborts requests outside the host's origin, closes every WebSocket except the host's `/photon`, and blocks service workers, downloads, popups, `RTCPeerConnection` and `WebTransport`. Before the scenarios, canaries prove that such a browser cannot reach a loopback server outside its origin by fetch, a worker's fetch, a WebSocket, `RTCPeerConnection`, `WebTransport`, a popup or a navigation. `--check-isolation` runs only that check and prints the result.

Each scenario then gets a fresh, disposable Chromium, with SwiftShader software rendering unless `--renderer auto`. A two-player scenario gets a second browser with its own storage, hence its own install ID, in the same namespace and against the same host; its files carry the `peer-` prefix. `--timeout-ms` (90 s by default, 1 to 300 s) bounds the wait for the page's boot checkpoint. Without `--scenario`, one session named `observe` boots the profile and records it; on `baseline` it watches the original for that budget. `--interactive` opens a visible window (WSLg) on a profile with an entry and takes no scenario.

`harness/run.ts` wraps each session, and `play` uses it too: verify the inputs, open `runs/<timestamp>-<kind>-<id>/`, record the source, WASM, page and heroes hashes, start the host, run, stop, verify again, then write the manifest, the host's events and the summary. Exit codes are 0 (passed or stopped), 1 (failed) and 2 (nothing checked).

A scenario (`scenarios/<practice|menu|lan>/`, registered by name in `scenarios/index.ts`) uses real input on the page plus the read-only observers, records samples and screenshots, and returns named boolean checks through `verdict()`. The registry adds the heroes' scenarios from `heroes/scenarios/index.ts` when that file exists. Checks encode results already confirmed; a new expectation needs its own evidence first. Shared coordinates and helpers live in `shared/menu.ts`, and two-player helpers (forming a party, aiming, reading both clients) in `shared/lan.ts`.

Software rendering slows under load, so timed checks can miss when probes share the CPU. The `milestone` skill runs them one at a time.

### Play

`src/host/play.ts` serves `practice` (the default), `menu` or `lan` to a personal browser. `--public` needs `lan`, and `--open` needs `--public`. `--host` can be given more than once. On `menu` and `lan` without `--heroes`, `play` takes `heroes/files/` when it holds a hero's directory. With `--public`, it prints the link with the access key for each `--host` name, plus the local one. The run is recorded like a probe's, under `runs/<timestamp>-play-<profile>-<id>/`.

### Start

`start` is a POSIX shell script for a fresh clone on Linux, WSL or macOS. When `bun` is neither on PATH nor in `$BUN_INSTALL/bin` (`~/.bun` by default), it installs Bun 1.4.0 with the official installer. It runs `bun install --frozen-lockfile` when `package.json` or `bun.lock` changed since the last install (a checksum in `node_modules/.start`), then `bun run setup`, and hands over to `src/host/start.ts`.

`start.ts` takes `cloudflared` from PATH, or else downloads release 2026.9.3 from GitHub into `.cache/cloudflared/<version>/`. It pins one asset per platform (Linux x64 and arm64, macOS x64 and arm64, the macOS ones as `.tgz`) and refuses an asset whose SHA-256 differs. It runs a quick tunnel to `127.0.0.1:<port>` without autoupdate, logging to `.cache/cloudflared/tunnel.log`, and takes the trycloudflare.com name from cloudflared's output once a connection is registered, giving up after 60 s. It then starts `play --profile lan --public --host <name>`, which prints the ready link with the key and the local one. `--open` goes to `play`; `--local` skips the tunnel and `--public`, and cannot be combined with `--open`. Ctrl+C, or either process exiting, sends both a SIGTERM, and one still running 15 s later gets a SIGKILL.
