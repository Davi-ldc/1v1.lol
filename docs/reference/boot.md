# Boot

How the original 1v1.LOL WebGL client starts, what it asks of its page and services, and where it stops when those services are missing. Notation follows the [conventions](il2cpp.md#conventions).

## Page bridges

The page that hosted the game defined JavaScript globals that `WebGL.framework.js` calls. That page was not preserved, so their implementations are unknown. Offsets are UTF-8 byte offsets in the extracted framework.

| Offset | Framework wrapper | Global it calls | Contract |
|---:|---|---|---|
| 28466 | `_CheckIfConnected` | `checkIfConnected()` | The answer arrives later through `OnGotWebResponse` |
| 28514 | `_CheckLegitUrl` | (inline list) | The allowed-origin list includes `http://localhost` |
| 30804 | `_GetFirestoreListener` | `getFirestoreListener` | Callbacks via `unityInstance.SendMessage`; schema unknown |
| 35914 | `_InitFirebase` | `initializeFireBase()` | No arguments, no try/catch, return value ignored |
| 91977 | `_NucleusWebSocketConnect` | `new WebSocket(url, subprotocols)` | Nucleus transport |
| 95415 | `_OnUnityReady` | `onUnityReady()` | Wrapped in try/catch; a pure observer |
| 96489 | `_RefreshToken` | `returnIdToken()` | Firebase token refresh |
| 105000 | `_SignInAnonymously` | `signInAnonymously()` | Answer through `OnGotWebResponse` |
| 105050 | `_SignInWithGoogle` | `signInWithGoogle()` | Same |
| 105260 | `_SocketCreate` | WebSocket with a protocol from the WASM | Photon transport (see [network.md](network.md)) |
| 107120 | `_WebPurchase` | `xsollaPurchase` | Callback `PurchaseComplete` |

With no page globals, the first visible failure is `initializeFireBase is not defined`, thrown from `_InitFirebase`. A failing `onUnityReady` is caught and only logged. `createUnityInstance` still resolves with progress 1, which only means that the engine started.

## Engine start

The loader fetches `WebGL.framework.js`, `WebGL.wasm` and `WebGL.data` and starts the engine (PhysX, Input Manager, WebGL 2). It then requests `StreamingAssets/aa/settings.json` for Addressables. The scenes and their build indices are listed in [build.md](build.md#scenes).

`Assets.Scripts.GameManager.Awake` (f45922, slot 113303) checks `PlatformManager.IsEditor` (f51878) at file offset `0x00fced57`. In the editor it keeps the serialized `_debugMode = true` and boots a scene directly: it creates `PUNPrefabPool`, and `ModesProperties.Init` (f49720) builds the mode dictionary from the serialized `ModeInfo`s. In a player build `IsEditor` is false and this branch does not run.

## Firebase manager

`FirebaseManager` lives on the `PersistentObjects` GameObject (`level0`, GameObject PathID 119, component 518) and receives every page callback.

- `FirebaseManager.Start` (f97301, state machine `<Start>d__64`, f97366) allocates a `WebAuthenticationHandler`, stores it at `FirebaseManager._authHandler` (+60) and awaits its `Init` (`<Init>d__8`, f97084). `Init` calls the `InitFirebase` import (table slot 20045 → f188), yields once and returns true. The awaited bool goes to `FirebaseManager.DidInit` (static +24), so `DidInit` becomes true as soon as `initializeFireBase()` returns, whether or not Firebase exists.
- Every request (check, sign-in, token) sets `WebAuthenticationHandler._gotResponse` (+8) to false, calls its page global, and waits in its state machine with `UniTask.WaitUntil` for the response. `<CheckIfConnected>d__9` (f97076) is one such state machine.
- Responses arrive as one JSON string through `FirebaseManager.OnGotWebResponse` (f97306), which passes it to `WebAuthenticationHandler.OnGotWebResponse` (f97059). The handler parses it with `JsonUtility.FromJson<JustPlay.Auth.AuthResponse>` (cell `0xae8f44`) into `{ Result, Response }`. `Result` is an `AuthTaskResult`: Success 0, Cancelled 1, Error 2.
- `HandleAuthResponse` (`<HandleAuthResponse>d__77`, f97349) branches on `Result` with a `br_table` at file offset `0x0200a479`. Only Success reaches `Player.GetUserData`; Error logs `Response` and completes false.
- `AppInitializer.SignInToFirebase` (`<SignInToFirebase>d__26`, f47113) throws "Failed to sign in to firebase" when sign-in returns false.

`FirebaseManager.GetGuestUID` reads the install ID from PlayerPrefs (`install_id`). With no signed-in user, `UserExists` and `IsLoggedIn` stay false.

## AppInitializer.Initialize

`<Initialize>d__20::MoveNext` (f47100) drives the whole startup.

| Step | File offset |
|---|---|
| Sets `IsInitializing = true` (static +17) | `0x0101ae18` |
| Reads `NetworkManager.get_IsNetworkReachable` (slot 9558); false clears `didInit` and `ableToConnect` | `0x0101ae62` |
| ANDs `!NetworkManager.IsNetworkBlocked` (static +4) into both | `0x0101af7b` |
| Without network, logs "AppInitializer:Initialize: No internet connection, initializing only assets" | `0x0101b010` |
| Always awaits `GetRemoteConfig`, then starts `StartOfflineMonitor` | `0x0101b04d`, `0x0101b21d` |
| Runs `InitializeConnection` only if the remote config arrived and the network is usable | `0x0101b67d` |
| Awaits `InitializeAddressables` (slot 9566) and ANDs its result into `didInit` | `0x0101b8dd`, `0x0101bb19` |
| Invokes `OnInitialized` (static +12) or `OnInitializationFailed` (static +8) | `0x0101be1e` |
| Writes `DidInit` (static +16) and clears `IsInitializing` | `0x0101bec4`, `0x0101bf1d` |

`InitializeConnection` (`<InitializeConnection>d__23`, f47108) fetches region info (`FetchRegionInfoHandler`), signs in to Firebase and runs `ConnectToPhoton` (`<ConnectToPhoton>d__27`, f47084). These calls go through table slots, so their exact order is inferred from the method set and the log strings. On error it logs "AppInitializer:InitializeConnection: Error with {0}. Error: {1} ".

`IsInitializing` stays true while `GetRemoteConfig` waits, and a client that is still initializing cannot reconnect (see [network.md](network.md#reconnecting)).

`StartOfflineMonitor` (`<StartOfflineMonitor>d__21`, f47117) needs `FirebaseConfigHandler.IsDataAvailable` and `FirebaseVersionData.HardOfflineTimeout` (+8). Only a positive timeout starts `HardOfflineTimeout` (`<HardOfflineTimeout>d__28`, f47096). That routine waits until `Time.realtimeSinceStartup` passes the deadline, then cancels its token if initialization has neither finished nor stopped. It does not switch the game to offline mode.

`InitializeAddressables` is described in [assets.md](assets.md#start-up).

## Remote config

`FirebaseConfigHandler` holds the remote-config state in static fields: `IsDataAvailable` (static +0), `_onDataLoaded` (static +8), `_isFetchingRemoteConfig` (static +16), `_firebaseSettingsHandlers` (static +20), `_dataTaskCompletionSource` (static +24) and the selected proxy, `_firebaseConfigProxy` (static +28).

- The string entry point, `ActivateRemoteConfig(string)` (f98130), sets the proxy's `DidCheckConf` (+8) and always passes `isSuccess = true` to the completion routine, `ActivateRemoteConfig(bool, string)` (f98131).
- The completion routine clears `_isFetchingRemoteConfig`. Only on success does it parse the payload as `Dictionary<string,string>` (Newtonsoft), set `IsDataAvailable`, and call each registered handler's `Init` (virtual slot 4) with the dictionary. In both cases it then calls `TaskCompletionSource<bool>.SetResult(isSuccess)` and `_onDataLoaded`.
- On a false result, `<GetRemoteConfig>d__22` (f47092) logs "Failed to fetch remote config" and returns before `FirebaseGameModesData.DataTask` and `GameModeHelpers.Init`.

Each document has a handler keyed by an ID parameter and a config parameter. The document's value is a JSON string of the form `{"Configs": {"<id>": {...}}}`. These registrations appear in `FirebaseConfigHandler.InitFirebaseConfigObjects` (f98104) and in the consumers:

| Config parameter | ID parameter | Data class | Consumers |
|---|---|---|---|
| `GameModesV5` | `GameModesID` | `FirebaseGameModesData` | Mode lists, waits, rotation ([menu](menu.md#game-modes)) |
| `GeneralConfigV6` | `GeneralConfigID` | `FirebaseGeneralConfig` | General settings |
| `AdsSettingsV3` | `AdsSettingsID` | `FirebaseAdsSettingsData` | Ad provider setup |
| `GameplaySettings` | `GameplaySettingsID` | `FirebaseGameplaySettings` | Gameplay tuning |
| `CheaterSettings` | `CheaterSettingsID` | `FirebaseCheaterSettingsData` | Cheat detectors, `EnablePhotonAuth` |
| `ChampionsConfig` | (handler's own) | `FirebaseChampionsHandler` data | `ChampionProductDataFactory` |
| `ProductsV9` | (handler's own) | Products data | Store fields, emote data, `AllProductDataFactory` |
| `EquipmentV2` | (handler's own) | Equipment data | `are_loadouts_enabled` |

`ModeInfo.get_UsesLoadout` (f49905) reads `are_loadouts_enabled` from `EquipmentV2`.

The registration keys are confirmed, but the full schema of each document was not recovered. `CheaterSettings` has the sub-objects `fast_landing_config`, `flying_config`, `excessive_fire_rate`, `excessive_ability_usage`, `weapon_mismatch_config` and the flag `enable_photon_auth`. These JSON names come from the fields' `JsonProperty` attributes (`global-metadata.dat` offset 18207711).

## The server user

The game's view of the player is one `ServerUser`, reached through `FirebaseManager.Instance._serverUser` (+64). Its constructor builds the sub-models, among them `GeneralData` (+8), `Equipment` (+28, a `UserEquipment`), `Friends` (+64) and `Champions` (+76). A logged-in session receives the user from `Player.GetUserData` and installs it with `FirebaseManager.SetServerUser`.

- `GeneralDataModel.ID` (+8) must be non-null for any feature that requires login.
- `GeneralDataModel.Nickname` (+12) is the name other players see. `Connector.UpdatePhotonInfo` (f114344) publishes it.
- `GeneralDataModel.AgeGate` (+72) is an `AgeGateData` whose `IsUnderage` is a `Nullable<bool>` at +8 (`hasValue` +8, value +9). The backend fills it.
- The `UserEquipment` constructor (f97416) starts the owned-items dictionary (`Equipment`) with `scar` and `pump_shotgun`.

## Age gate and limited features

`AgeGateManager` decides what an account may use.

| Method | Function | Role |
|---|---|---|
| `IsFeatureAvailable(GameFeatureCategory)` | f51668, slot 9766 | Current user; needs the Firebase login |
| `IsFeatureAvailable(ServerUser, GameFeatureCategory)` | f51672 | Reads the user's `AgeGate` |
| `ToValidNickname(string)` | f51669 | Keeps a name only if `IsFeatureAvailable(Names)` |
| `HandleNickname()` | f51667 | Renames the player's own profile to a generated name |
| `SetAge`, `GetCachedAge`, `IsAgeCached`, `DidSaveAge` | f51663, f51662, f51661, f51664 | Age entry and cache |

When `ToValidNickname` refuses a name, it returns `NicknamesGenerator.ToGeneratedNickname` (f49735) instead. `HandleNickname` runs after `SetAge`'s server reply (f51678 +0x8bc) when the age gate had no value.

`LimitedFeaturesManager.ValidateFeature(FeatureRequirements, featureToAccess)` (f47571, slot 20184) checks three requirements in order and returns the first failure:

| Result | Requirement | Check |
|---:|---|---|
| 1 | `InternetConnectionRequired` | `NetworkManager.IsNetworkAvailable` |
| 2 | `RemoteConfigRequired` | `FirebaseConfigHandler.IsDataAvailable` |
| 3 | `LoginRequired` | `ServerUser.GeneralData.ID` non-null |

When the age gate refuses a feature, `ValidateFeature` calls `MenuPopupHandler.ShowAgeLimit` (at `0x01040ca8`), which opens `AgeLimitedFeaturePopup` ("get full access", "Unlock for free!"), and returns 4.

`NetworkManager.IsNetworkAvailable` (f47854, slot 9776) requires all of `Application.internetReachability != 0`, `NetworkManager._isConnectedToPhoton` (static +12), `!PhotonNetwork.offlineMode` (static +44) and `!NetworkManager.IsNetworkBlocked` (static +4).

## Loading screen and scenes

`LoadingScreenManager` sits on the `LoadingScreen` GameObject (`level0`, PathID 39, component 385).

- `LoadMainScene` is subscribed to `AppInitializer.OnInitialized` and also waits until `completedCount` equals `jobs.Count - 1`.
- `StartOffline` (f47586) marks the tutorial finished, sets `_currMaxFeel` (+96) to 1, sets `LoadingFinished` (static +9) and starts `FillLoadingBar`. It does not check for a login.
- `HandleNoConnection` (f47597) shows `InitialScenePopups.NoInternet` through `AddressablePopup.Show` unless `FirebaseManager.IsBanned`.

The `MainMenu` scene loads as build index 1 (`LoadSceneAsync`, slot 128399). Its `UiManager` and screens are covered in [menu.md](menu.md).

Offline rooms use Photon's offline mode. `OfflineGameModeConnector.JoinMode` (f49926) sets `PhotonNetwork.OfflineMode = true`. When offline mode holds, `StartOfflineRoom` (f49927) creates a room with `PhotonUtils.BasicRoomOptions(maxPlayers: 1, modeName, shouldStartOpen: true)` and no name, lobby or expected users. When it does not take, `JoinMode` sets `_startOfflineMode` (+44) and calls `PhotonConnector.PlannedDisconnect`. The `Practice` connector sits on `GameModes/Practice` in `level1`, inactive in the scene file.

`Lol.OneVsOne.Settings.GameProperties` (`resources.assets:8785`) holds `_defaultOfflineGameMode` (+160) and the party code length, `_partyRoomNameLength` (+56, read by `get_PartyRoomNameLength`, f118201).

## Offline gates

Where startup and features stop when the services are gone:

| Gate | Where | Effect without the service |
|---|---|---|
| `initializeFireBase` global | `_InitFirebase` | Uncaught `ReferenceError`; startup stops in the page |
| Firebase sign-in | `SignInToFirebase` (f47113) | Exception; `InitializeConnection` fails |
| Remote config | `GetRemoteConfig` (f47092) | No data; `IsInitializing` stays true; game modes are not initialized |
| Network reachability | `Initialize` (f47100) | "initializing only assets"; no Photon connection |
| Addressables catalog check | `AddressablesHandler.Init` | `DidInit` never set; required data never downloads |
| Feature validation | `ValidateFeature` (f47571) | Screens and actions refuse with result 1, 2 or 3 |
| Age gate | `IsFeatureAvailable` (f51668) | Ads open `AgeLimitedFeaturePopup`; names shown to others become generated |
| Photon custom auth | `PhotonConnector.InitConnection` (f47916) | Needs `FirebaseCheaterSettingsData` |

With `EnablePhotonAuth`, `InitConnection` also needs a Firebase token, through `ConfigureCustomAuth` (f47917). That token requirement is inferred.

## Unknowns

- The hosting page and its exact global implementations.
- The full JSON of every remote-config document, and which ones a match strictly needs.
- The value of `_defaultOfflineGameMode`.
- Whether `OnInitializationFailed` is wired to `HandleNoConnection`, and whether the NoInternet popup's button calls `StartOffline`.
- The browser implementation of `NetworkManager.get_IsNetworkReachable`.
