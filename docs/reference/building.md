# Building

Build pieces, the grid, placing, health, damage and editing in build 4.713 (`WebGL.wasm` `52b3dc8a…`, `data.unity3d` `875739a9…`). Notation follows the [conventions](il2cpp.md#conventions); action IDs are in [controls.md](controls.md#rewired-actions).

## Pieces

The game has four buildable pieces, numbered the same way in the `BuildingType` enum and in their `Building` components: Wall 0, Floor 1, Ramp 2, Roof 3. Each piece has its own component class in `1v1.dll`.

| Piece | Root GameObject | Component (MonoScript) | Visual mesh | Collision object |
|---|---|---|---|---|
| Wall | `resources.assets:1709` | `WallBuilding` (3806) | 412 `Wall_New` | GO 2448 `WallCollider`, MeshCollider on mesh 460 `Wall` |
| Floor | `1714` | `FloorBuilding` (6360) | 385 `Floor_New` | GO 2311 `FloorCollider`, BoxCollider size (5, 0.1, 5), center (0, 0.05, 0) |
| Ramp | `1616` | `RampBuilding` (3217) | 409 `Ramp_New` | GO 1774 `defaultCollider`, MeshCollider on mesh 413 `Ramp` |
| Roof | `1703` | `RoofBuilding` (6444) | 390 `Pyramid_New` | GO 2666 `defaultCollider`, MeshCollider on mesh 427 `Pyramid` |

The MonoScripts are in `globalgamemanagers.assets`. The roots sit on layer 14, which the TagManager names `Building`. For traps, `PlayerBuildingManager` also holds `floorTrapPrefab` (+152) and `wallTrapPrefab` (+156).

Mesh extents in local units (X / Y / Z):

| Mesh | Vertices | Triangles | Extent |
|---|---:|---:|---|
| `Ramp_New` | 120 | 88 | 5 / 3.5645 / 5.0452 |
| `Wall_New` | 192 | 148 | 5 / 3.5 / 0.0991 |
| `Floor_New` | 72 | 52 | 5 / 0.0991 / 5 |
| `Pyramid_New` | 40 | 16 | 5.0003 / 1.8214 / 5.0004 |
| collider `Ramp` | 40 | 20 | 5 / 3.5752 / 5.0513 |

The ramp is a sloped slab with some thickness. Its visual mesh and its collider both stay within about 0.1 of an inclined plane, so neither fills the wedge down to a horizontal base.

The three MeshColliders are non-convex and non-trigger, with cooking options 30. All four basic colliders are disabled in the asset (`m_Enabled = false`), and the code enables them at runtime (`Building.EnableCollider`). The asset alone does not show when.

### Variants

`AvailableOptions` lists 18 options for the wall, 5 for the floor, 4 for the ramp and 5 for the roof:

| Piece | Variants |
|---|---|
| Wall | doors, windows, half walls, triangles and arches |
| Floor | whole, three-quarter, half, corner and a bridge |
| Ramp | `FullRamp`, `Half Ramp`, `1 Shaped Ramp` (mesh `Ramp_L_shaped_New`) and `U Shaped Ramp` |
| Roof | the pyramid, plus half and inverted forms |

Every variant except the whole piece is inactive in the asset. Scene objects named `Stairs…` (for example `level19:3037`) are map decoration.

## Grid

`PlayerBuildingManager` (TypeInfo cell `0x00ac56e0`, static `Instance` +0) holds the grid size in two statics. Its class constructor (f45037) writes both with one 8-byte store: `sizeX` (static +4) = 5 and `sizeY` (static +8) = 3.5. A cell is therefore 5 × 5 m across and one wall (3.5 m) high, which matches the mesh extents above.

`BuildingNetworkController` keeps the grid in `_buildingsGrid` (+52, `Dictionary<Vector3, List<Building>>`). `GetGridSnappedPosition` (f44964, slot 102502) snaps a building to it, `GetBuildingIndexFromGrid` and `RemoveBuildingFromGrid` maintain it, and `GetBuildingsOnHeight` answers per-height queries. Each build also has a `BuildingInsideCollider` trigger that fills its whole cell.

## Placing

Instance fields of `PlayerBuildingManager`:

| Field | Offset | Notes |
|---|---:|---|
| `sizeXY` | +20 | |
| `timeBetweenBuilds` | +88 | ObscuredFloat |
| `controllerEditDelay` | +108 | |
| `neighborsTimeToDie` | +112 | see [Damage and destruction](#damage-and-destruction) |
| `rayCastMaxDistance` | +116 | value not decoded |
| `wallMaxDistance`, `floorMaxDistance`, `rampMaxDistance`, `roofMaxDistance` | +120 to +132 | values not decoded |
| `wallPrefab`, `rampPrefab`, `floorPrefab`, `roofPrefab` | +136 to +148 | |
| placed, right, wrong, editing, trap-possible and hit colors | +160 to +240 | `Color` |
| ray-cast layer masks (build, ground, editing, trap, physical, physical without ground) | +256 to +276 | |
| `buildingTypeFromPlayerAction` | +288 | `Dictionary<int, BuildingType>`: action ID to piece |
| `state` | +300 | `PlayerBuildingState`: NONE, BUILDING, EDITING (2), TRAP |
| `buildingManager`, `editingManager`, `trappingManager` | +328, +332, +336 | |

Its statics include `IsUnchangeableBuildings` (static +12) and `IsOneHitBuildings` (static +13).

Selecting a piece and placing it are separate inputs:

1. The piece actions Wall, Floor, Ramp and Roof (2 to 5) pick the type through `buildingTypeFromPlayerAction` and enter the BUILDING state.
2. `BuildingManager` positions the piece (`Calculate`, `PutAtPlanePosition`, `AdjustBuildingRotation`, `IsOk`).
3. Place (16) puts it down with `BuildingManager.PlaceBuilding` (f44930, slot 102468).
4. `BuildingNetworkController.CreateBuilding(type, position, rotation)` (f44940, slot 102484) sends it to everyone, and `CreateBuildingRemote` builds it on each client.

No translucent ghost of the piece shows before it is placed (observed).

## Health

All four basic pieces serialize `MaxHealth` = `Health` = 150, `_destructionAnimationDelay` 0.25, `_maxAlpha` 1 and `_minAlpha` 0.5. Runtime layout of `Building`:

| Field | Offset |
|---|---:|
| `IsStatic` | +22 |
| `BuildingType` | +28 |
| `MaxHealth` | +32 |
| `Health` | +36 |
| `OriginalShapeState` | +52 |
| `CreatorId` | +72 |
| `TimeCreated` | +80 |
| `BuildingRenderer` / `BuildingCollider` | +88 / +92 |
| `Toggleables` | +112 |
| `ID` | +192 |

A new build fills its health over time in `Building.InitialHealthRegenCoroutine` (f44771), whose body is `<InitialHealthRegenCoroutine>d__149::MoveNext` (f44819). At each interval the coroutine takes the Photon time since `TimeCreated` (+80), caps it at the regen duration, and sets the health in proportion, rounded.

`BuildingsSettings` (`resources.assets:8624`) sets the pace: `_initialHealthRegenDuration` 3.5 s and `_initialHealthRegenInterval` 0.25 s. It also holds `_initialHealthPercentage` 1, whose reader was not traced. `UpdateBuildingAlpha` fades the renderer between `_minAlpha` and `_maxAlpha` as health changes (inferred from its name).

## Damage and destruction

`BuildingNetworkController._buildingsIdMapping` (+48; TypeInfo cell `0x00ac1174`, static `Instance` +0) indexes every build by its string ID.

- `Building.TakeDamage(attacker, hitInfo, weaponUsed)` (f44803, slot 102298) sends the hit through `BuildingNetworkController.HitBuilding(id, damage, playAnimation, hitWithMelee, playerId)` (f44804, slot 102481), which raises the RPC `HitBuildingRemote` on every client.
- `BuildingNetworkController.KillBuilding(id)` (f44744, slot 9039) raises `DestroyBuildingRemote` on every client, and each client removes the build (`Building.Die`, `DieAnimationCoroutine`).
- Inferred from the method and field names, not traced: when a build is destroyed, its neighbors check whether they still touch the ground or another build (`CheckIfNeedsToBeDestroyed`, `IsTouchingGround`, `GetAdjacentBuildings`), and the unsupported ones die after `PlayerBuildingManager.neighborsTimeToDie` (+112).
- `KillAllBuildings` clears the map for everyone.

The damage a weapon does to builds comes from its `DamageToBuildings`; see [combat.md](combat.md#weapons).

## Editing

`EditingManager` runs the edit while the player state is EDITING (2). The player's instance is `PlayerBuildingManager.editingManager`, and its fields include the target `_currentEditingObject` (+16), `_finishingEdit` (+24), `_isEditReleased` (+56) and `_isEditing` (+57).

- `HandleEditRay` (f45010, slot 102548) finds the target build by ray. It fills `_currentEditingObject` before the Edit action (7), so a target alone does not mean an edit is in progress.
- `StartEditing` (f45012) enters edit mode. With `ResetEditWithoutConfirm` set, it also resets the selection on entry.
- `UpdateToggling` (f45003): while Place (16) is held, the ray toggles the parts it crosses. Each part is a `ToggleableBuildingPart` (`isToggled` +76, `direction` +68), checked against ownership and context. Releasing 16 ends toggling.
- `UpdateState` (f45006): in state 2 with `_finishingEdit` false, releasing Place (16) with `EditOnRelease` set calls `ConfirmEdit(false)` and `OnStateEnded(false)`. Pressing ResetEdit (8) resets the shape; releasing it with `ResetEditWithoutConfirm` set confirms the edit and ends it.
- `CheckScrollWheelReset` (f45008): with `ScrollWheelReset` set, a ScrollWheel (28) step in either direction calls `ResetEdit` and `ConfirmEdit(false)`. It runs inside an edit, and also from `HandleEditRay` outside one, after the target, range and ownership checks.
- `Building.ConfirmEdit` (f44786) runs `FinishToggling`, picks the shape with `GetStateByToggled`, validates it against the build's shape states (`BuildingShapeState.ChildIndex` +8), and sends it with `BuildingNetworkController.BuildingShapeChanged(id, shapeState, forceValid)` (f44787, slot 102485). An invalid selection is not applied.

With a controller connected, editing reads `ControllerSettings` instead of the `SettingsPanel` flags, except for the scroll reset, which always uses the `SettingsPanel` flag. [controls.md](controls.md#editing-preferences) describes the flags.

## Unknowns

- `resources.assets` has four `PlayerBuildingManager` instances (10135, 10166, 11135, 11297). Their obscured fields were not fully decoded, so the build ranges, `timeBetweenBuilds` and the per-piece maximum distances have no recovered values.
- The asset does not show when the code turns the basic colliders on.
