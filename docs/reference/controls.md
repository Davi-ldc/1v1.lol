# Controls

Input, the camera, the emote wheel and the editing preferences of build 4.713 (`WebGL.wasm` `52b3dc8a…`, `global-metadata.dat` `7aa3236f…`, `data.unity3d` `875739a9…`). Notation follows the [conventions](il2cpp.md#conventions).

## Two input systems

Gameplay input goes through Rewired, wrapped by the game's own `InputManager` (1v1.dll, MonoScript `globalgamemanagers.assets:3026`). Unity's legacy input manager is also present, and the camera still reads it.

| Layer | Where | Used for |
|---|---|---|
| Rewired `InputManager` | `level0:381` (InitialScene), prefab `sharedassets2.assets:1355` | every gameplay action |
| 1v1 `InputManager` | statics in TypeInfo cell `0x00ac3f0c` | wrapping Rewired for the game code |
| Unity `InputManager` | `globalgamemanagers:2`, 524 axes | `Mouse X` and `Mouse Y` for the camera |

Both Rewired `InputManager` objects are `dontDestroyOnLoad`.

The wrapper keeps the Rewired player in the static `PlayerInput` (static +0) and `_isControllerConnected` at static +20. Its readers are `GetButtonDown` (slot 9024), `GetButton` (slot 105449), `GetAxis` (slot 105456) and `GetAxisRaw` (f46977).

The Unity asset holds the stock Unity axes, which are not the game's bindings: Horizontal a/d, Vertical s/w, Fire1 left ctrl or mouse 0, Fire2 left alt or mouse 1, Jump space and Cancel escape. Mouse X, Mouse Y and Mouse ScrollWheel are type-1 axes with a sensitivity of about 0.1.

The Rewired configuration payloads (14,488 bytes each) contain action names such as `Floor`, `ResetEdit`, `Rotate`, `ScrollBuildings` and `Place Building`. The MonoScript `DefaultControls` exists (`globalgamemanagers.assets:3351`), but no serialized instance of it was found in `data.unity3d`.

## Rewired actions

`RewiredConsts.Action` (type 2639) holds the action IDs as literal constants:

| ID | Action | ID | Action | ID | Action |
|---:|---|---:|---|---:|---|
| 0 | Jump | 17 | Pause | 36 | FastDiveToggle |
| 1 | Slot1 | 18 | Shoot | 39 | Play |
| 2 | Wall | 19 | Aim | 40 to 43 | NavigateUp/Down/Left/Right |
| 3 | Floor | 20 | Reload | 44 | Select |
| 4 | Ramp | 21 | Slot2 | 45 | Back |
| 5 | Roof | 22 | Slot3 | 46 | TabRight |
| 6 | Trap | 25 | ChangeControllerState | 47 | TabLeft |
| 7 | Edit | 26 | Crouch | 48 | DropWeapon |
| 8 | ResetEdit | 27 | Slot4 | 49 | Options |
| 9 | Interact | 28 | ScrollWheel | 50 | RotateCharacter |
| 10 | Rotate | 30 | NextSpectate | 51 | LeftTrigger |
| 11 | ScrollBuildings | 31 | PreviousSpectate | 52 | Ability1 |
| 12 | MouseX | 32 | OpenWheel | 54 | Ability2 |
| 13 | MouseY | 33 | FreeCursorMode | | |
| 14 | Horizontal | 34 | Slot5 | | |
| 15 | Vertical | 35 | Slot6 | | |
| 16 | Place | | | | |

[movement.md](movement.md#input) describes how the motor reads the movement axes.

The keyboard map itself was not decoded. These keys were observed:

| Key | Effect |
|---|---|
| W, A, S, D | move |
| C | select the ramp |
| G | edit |
| Left mouse button | shoot or place |
| Right mouse button | aim, and reset an edit |
| B | open the emote wheel |
| Q | fire Ability1 |

## Controllers

Rewired handles physical controllers (`DualShock4Driver`, `WebGLGamepadMappingType`), and the WebGL framework reads them with `navigator.getGamepads`.

- `InputManager.IsPsControllerConnected` (f46978, slot 105458) matches the controller name against `ps4`, `dualshock`, `wireless controller`, `sony`, `playstation`, `dualsense`, `ps5`, `ps3` and `xbox`.
- `InputManager` tracks the last device used (`IsMouseLastUsed`, `IsPhysicalControllerLastUsed`, `IsCustomControllerLastUsed`, `GetLastUsedController`) and raises `OnControllerConnected`, `OnControllerDisconnected` and `OnLastUsedControllerChanged`. It swaps maps with `SwitchControllerMap` and draws button glyphs with `GetActionGlyph`.
- `ControllerSettings` and `ControllerOptions` hold the controller's own options. While `_isControllerConnected` (static +20) is true, editing reads them in place of the keyboard options.

## Camera

The third-person camera is Invector's `vThirdPersonCamera`, managed by `CameraManager` (TypeInfo cell `0x00ac12d8`; instance at static +0; `MainCamera` +24, `TPCamera` +28).

### Pipeline

1. `vThirdPersonInput.LateUpdate` (f118141) calls `InputHandle` (f118145), which calls `CameraInput` (f118152).
2. `InputCalculations.GetCameraRotationValuesBasedOnInput` (f46942) calls `CalculateCameraRotation` (f46935), whose mouse branch calls `UnityEngine.Input.GetAxis` (f21987, slot 15038) with the strings `Mouse X` and `Mouse Y`. Mouse look therefore reads Unity's axes and bypasses Rewired.
3. That branch multiplies by 6.052175521850586, by the `SettingsPanel` sensitivities, by an optional zoom modifier and by `Time.timeScale`. It does not use `deltaTime`.
4. `vThirdPersonCamera.RotateCamera` (f47046) computes `mouseX += x·xMouseSensitivity` (yaw) and `mouseY -= y·yMouseSensitivity` (pitch). If `lockCamera` (+36) is false, it clamps the pitch to `yMinLimit`/`yMaxLimit` and the yaw to `xMinLimit`/`xMaxLimit`; if true, it copies both angles from `currentTarget.root.localEulerAngles`.
5. `CameraMovement` (f47032) reads the look target's forward and right, slerps, sets the pivot rotation, places the camera with `LookRotation`, and resets `movementSpeed` (+104/+108).

At the default settings, one pixel of mouse motion was observed to turn the camera about 0.1695° on both axes.

### Guards and the cursor

- `ShouldStopCamera` (f118153) freezes the camera while the game is paused (`GameManager.WasPaused`, static +9), after the game has ended, while the weapon disallows camera movement, while the choice wheel shows, while the HUD is in free-cursor mode, or while a Clash match is waiting. It checks neither the browser's pointer lock nor `Application.isFocused`.
- `PausePanel.Update` (f46215) calls `ChangeCursorVisibility` every frame unless the choice wheel shows. That helper (f116329) sets `Cursor.visible = v` and `Cursor.lockState = !v`.
- `CameraManager.OnPlayerSpawned` (f47426) binds the local `PlayerController` through `SetMainTarget` (f47038), which stores `target` (+20) and `currentTarget` (+100) and initializes the rig.
- `Init` (f47029) and `SetMainTarget` copy `target.eulerAngles.x` straight into the pitch, `mouseY` (+172). `SetRotation` (f47044) instead subtracts 360 from angles of 180 and up.
- `WeaponsController.Update` (f106746) can also rotate the camera while auto-aim (`_isAutoAiming`, +224) is on.

### Serialized defaults (NormalMap and `level5`)

| Field | Value |
|---|---|
| `defaultDistance` | 2.57 |
| `rightOffset` | 0.2 |
| `_initHeight` | 1.5 |
| `xMouseSensitivity`, `yMouseSensitivity` | 1, 1 |
| `yMinLimit`, `yMaxLimit` (pitch) | −89, 80 |
| `smoothCameraRotation` | 10000 |
| `UseCameraFollowSmoothing` | false |
| native camera `fieldOfView` | 50.534 |
| dive FOV (`CameraManager`) | 80 |

For the view, `CameraMovement` clamps the pitch minus the recoil pitch (`_currentRecoil.y`, +236) to ±89.9. The pitch accumulator itself stays within the serialized limits.

### Camera field layout

`vThirdPersonCamera`:

| Offset | Field | Role |
|---:|---|---|
| +20 | `target` | |
| +24 | `smoothCameraRotation` | |
| +36 | `lockCamera` | |
| +44 | `defaultDistance` | |
| +56, +60 | `xMouseSensitivity`, `yMouseSensitivity` | |
| +64, +68 | `yMinLimit`, `yMaxLimit` | pitch limits |
| +72 | `UseCameraFollowSmoothing` | |
| +76 | `CameraFollowSmoothing` | |
| +100 | `currentTarget` | |
| +104 | `movementSpeed` | `Vector2` |
| +112 | `shouldMoveCamera` | |
| +124 | `targetLookAt` | |
| +164 | `_camera` | native camera |
| +168 | `distance` | current distance |
| +172 | `mouseY` | pitch |
| +176 | `mouseX` | yaw |
| +188 | `cullingDistance` | |
| +204, +208 | `xMinLimit`, `xMaxLimit` | yaw limits |
| +232 | `_currentRecoil` | `Vector2`; recoil pitch at +236 |

`vThirdPersonInput` has `charController` at +24, `_weaponsController` at +28 and `_tpCamera` at +40.

### Pointer lock in the WebGL framework

Under pointer lock, the framework (`WebGL.framework.js` `fbea5b6e…`) reads `movementX`/`movementY` (`Browser.calculateMouseEvent`, `JSEvents.fillMouseEventData`). Its `requestPointerLock` ignores the promise the browser returns. Its `_UnlockMouse` bridge refers to an undefined global, `lockedOccured`, so it throws a `ReferenceError`; the framework catches and logs it, and the bridge never releases the lock. Browsers also refuse a new lock right after the user leaves one.

## Emote wheel

`ChoiceWheelManager` handles B (OpenWheel, action 32):

- `Update` (f45400) opens the wheel only when B is held for 0.1 s. `IsButtonDown` (f45403) is `GetButtonTimedPressDown(32, 0.1)`.
- Only two methods write `_lastId` (+84): `ShowWheel` (f45404) picks the first emote when it is empty, and `OnOptionHighlighted` (slot 102987) picks the emote under the cursor.
- Releasing B after any duration (`IsButtonUp`, f45405: `GetButtonUp(32)`) plays `_lastId` if one is set.
- `Awake` (f45398) does not call `DontDestroyOnLoad`, so every match starts with `_lastId` empty. A quick tap does nothing until the wheel has been held open once in that match; after that, a tap replays the last emote.
- While the wheel shows, the camera stops and the cursor stays free (see [Guards and the cursor](#guards-and-the-cursor)).

## Editing preferences

Three `SettingsPanel` statics (TypeInfo cell `0x00ac6484`) change how editing ends:

| Static | Offset | PlayerPrefs key | Toggle callback | UI default |
|---|---:|---|---|---|
| `EditOnRelease` | +5 | `EditOnRelease` | `OnEditOnRelease`, slot 110403, f46267 | true |
| `ResetEditWithoutConfirm` | +6 | `ResetEditOnRelease` | `OnResetEditWithoutConfirm`, slot 110404, f46269 | true |
| `ScrollWheelReset` | +7 | `ScrollWheelReset` | `OnScrollWheelReset`, slot 110405, f46268 | false |

- The class constructor (f46294) leaves all three flags false. `SettingsPanel.InitSettingsInputs` (f46257) sets the UI defaults, a saved PlayerPrefs value overrides them, and `Start` (f46259) copies the toggles into the statics. A route that skips the settings UI leaves the flags false.
- Each callback initializes the `SettingsPanel` class and stores its bool argument, ignoring `this` and the MethodInfo.
- The panel is `level5:42207` and its toggles are `level5:43260`, `level5:36317` and `level5:41815`.

[building.md](building.md#editing) describes what each flag does inside `EditingManager`.

## Unknowns

- The Rewired keyboard and mouse maps: the schema stops at the nested type `PlatformVars_WindowsStandalone`.
- Where `DefaultControls` is used, if anywhere.
