# Combat

Health, the hit pipeline, weapons and abilities in build 4.713 (`WebGL.wasm` `52b3dc8a…`, `global-metadata.dat` `7aa3236f…`, `data.unity3d` `875739a9…`). Notation follows the [conventions](il2cpp.md#conventions). Movement, jumps, falls and knockback are in [movement.md](movement.md).

## Health and armor

`PlayerController._health` (+136) holds the player's `PlayerHealth`:

| Field | Offset | Notes |
|---|---:|---|
| `IsFallDamageEnabled` | +57 | |
| `DefenceMultiplier` | +60 | multiplies ability damage taken |
| `CanDie` | +68 | |
| `_fallDamageDistance` | +80 | |
| `_fallDeathDistance` | +84 | |
| `_fallDamageCurve` | +88 | `AnimationCurve` |
| `_maxHealth` / `_maxArmor` | +92 / +108 | ObscuredInt |
| `_currentHealth` / `_currentArmor` | +184 / +200 | ObscuredInt |

ObscuredInt's layout is in [il2cpp.md](il2cpp.md#built-in-types). A player spawns with 100 health and 100 armor (observed).

## Hit pipeline

`CombatHelper` builds and applies hits:

| Method | Function | Slot | Role |
|---|---|---|---|
| `GetHitInfo` | f45563 | 103179 | builds a `HitInfo`; the overload that takes `weaponID` and `weaponLevel` |
| `ProcessHitDamage` | f45575 | 103184 | applies an ability hit, scaled by its `percentageDamage` parameter |
| `ProcessHitDamage` | f45580 | 103188 | the overload for a weapon hit, which takes `WeaponStats` |
| `ProcessHitWithFlatDamage` | f45577 | 103185 | applies a hit with a fixed amount |
| `CalculateAbilityDamage(playerSource, damageMultiplier)` | f45576 | 8381 | ability damage, returns int |
| `TriggerDamageEffects` | f45581 | 103189 | hit marker and floating damage number |

`GetHitInfo` has three more overloads on `CombatHelper` (f45562, f45564, f45565). The class also has `CalculateHitResult`, `CalculateDamageResult`, `GetHitDistanceMultiplier`, `HasHitBarrier`, `ShouldProcessHit`, `ApplyHitDamage`, `CombineHits` and `GetLockOnTarget`.

`HitInfo` is a class. Selected fields: `ShouldShowDamageNumber` +8, `ShouldBlockShots` +9, `DamageSourceID` +12 (weapon or ability ID), `WeaponLevel` +16, `HitCollider` +20, `HitPoint` +24, `HitNormal` +36, `Distance` +64, `Type` +76, `HitLayer` +77, `CombinedHitInfo` +88, `Damage` +92, `SentTime` +96, `DamagerId` +104.

Damage reaches a player through `PlayerController.TakeDamage`, which raises the RPC `TakeHit` on the victim's view (see [network.md](network.md#in-match-rpcs)). Weapons and abilities use different overloads:

| Path | Parameters | Function | Slot | Damage |
|---|---|---|---|---|
| Weapon | `attacker, hitInfo, weaponUsed` | f48588 | 107341 | the victim's `IDamageable` sends `HitInfo.Damage` |
| Ability | `attacker, hitInfo, ability` | f48590 | 107343 | `DamageSourceID` is the ability's ID |

`FloatingIconManager.CreateDamagePopup` (f46518) draws the floating number in the color from `PlayerColors.GetFloatingDamageTextColor`.

### Ability damage formula

`CalculateAbilityDamage` (f45576) computes `ceil((0.4 · PowerScore + 200) · x)`. `x` is the multiplier the ability passes in, and PowerScore is the source player's (`Photon.Realtime.Player.get_PowerScore`). The 0.4 and the 200 are fields of the `Abilities` singleton (`SOManagedInstance<Abilities>`): `_baseAbilityPowerScoreMultiplier` (+16, read by `get_BaseAbilityPowerScoreMultiplier`, f42236) and `_baseAbilityDamageModifier` (+12, read by `get_BaseAbilityDamageModifier`, f42235).

`ProcessHitDamage` (f45575) passes its `percentageDamage` as `x` and adds the result to `HitInfo.Damage`. It then multiplies the damage by the target's `PlayerHealth.DefenceMultiplier` (+60) when the hit object is a `PlayerController`, and by the attacker's `PlayerController.OffenceMultiplier` (+52) unless the hit object is the attacker itself. In an observed 1v1, PowerScore is 0, so the base is 200, and both multipliers are 1.

The arithmetic is f32, so `ceil` can round up a value that is meant to be whole: 0.30000001 · 200 = 60.000004 gives 61.

## Weapons

`WeaponStatsDatabase` (`resources.assets:8750`, resource key `weaponstatsdatabase`) holds `_startingWeapons` (+16), `_defaultLoadout` (+20), `_loadoutMeleeWeapon` (+24) and `_weaponsData` (+28, a list of `WeaponBaseData`).

`WeaponBaseData` (`JustPlay.Equipment`, a subclass of `EquipmentBaseData`):

| Member | Offset | Notes |
|---|---:|---|
| `Stats` | +52 | `WeaponStats`, the settings that do not depend on level |
| `SkinType` | +580 | |
| `_statsByLevel` | +612 | one `WeaponLevelStats` per level |
| `DAMAGE_MULT_BEYOND_LEVEL_CAP` | | a literal constant, with no storage |

`GetStatsForLevel` (f43399, slot 118029) clamps `level − 1` into `_statsByLevel`, so level 1 reads row 0. `HybridWeaponBaseData` adds `ZoomedInStats` (+620) and `ZoomedInDamageMultiplier` (+752).

Selected `WeaponStats` fields: `WeaponType` +8, `AttackType` +12, `CrosshairType` +24, `RoundsPerShot` +28, `Range` +44, `EquipDelay` +48, `CanHoldToFire` +52, `UsesAimAssist` +53, `CanZoom` +57, `UsesAmmo` +60, `CanHitAllies` +84, `CanDamageSelf` +96, `MaxTargetsHit` +140, `MaxTerrainPierceCount` +144, `BulletPrefab` +156, `RaycastType` +164, `SimulatePhysicsCastsForRemotePlayers` +168, `SphereCastSize` +172, `BoxCastSize` +176, `ProjectilePrefab` +184, `ProjectileData` +188, `ShootFromCamera` +212, `ExplosionData` +216, `HasChannelTime` +244, `ChannelTime` +248, `ZoomSettings` +264, `AnimationSettings` +288, `EffectsSettings` +360.

`WeaponLevelStats`: `RoundsPerMinute` +8, `RecoilForce` +12, `RecoilDuration` +16, `RecoilReturnForce` +20, `BurstFireCount` +24, `BurstFireDelay` +28, `DamageSettings` +32, `AmmoSettings` +80, `SpreadSettings` +104, `PowerScore` +124, then the upgrade costs `BlueprintsToUpgrade` +128, `LOLCoinsToUpgrade` +132 and `LOLTokensToUpgrade` +136.

`WeaponDamageSettings`:

| Field | Offset |
|---|---:|
| `IsRestorative` / `RestorationType` | +8 / +12 |
| `HealthToPlayers` / `ArmorToPlayers` | +16 / +20 |
| `DamageToPlayers` | +24 |
| `DamageToBuildings` | +28 |
| `DamageToSelfMult` | +32 |
| `CanHeadshot` / `HeadshotMultiplier` | +36 / +40 |
| `IsDamageAffectedByDistance` | +44 |
| `MaxDamageDistance` / `MinDamageDistance` | +48 / +52 |

The pickaxe `lol.1v1.weapons.melee.pickaxe` (`resources.assets:8710`) has `BaseLevel` 1 and 50 level rows. Row 0 reads 100 rounds per minute, `DamageToPlayers` 6 and `DamageToBuildings` 30, with `Range` 3. At level 1, three swings took a 150 wall to 120, 90 and 60 (observed). The three `defaultpickaxe` entries (`resources.assets:8685–8687`) are separate weapons with their own IDs. The one Practice equips deals 75 to buildings at level 1, so a new wall falls in two hits.

### Equipping and firing

`PlayerController._weaponsController` (+116) holds the player's `WeaponsController`:

| Field | Offset |
|---|---:|
| `CurrentWeapon` | +84 |
| `IsHoldingWeapon` | +88 |
| `_startingWeapons` | +160 |
| `_playerController` | +172 |
| `_altWeaponSlots` / `_weaponSlots` | +192 / +196 |
| `_prevEquippedWeaponIndex` / `_currentEquippedWeaponIndex` | +200 / +204 |
| `_didInitialize` | +240 |
| `_currState` | +260 |
| `_isUsingAltWeaponSlots` | +277 |

`WeaponModel`: `BaseData` +16, `BasePrefab` +548, `WeaponUser` +552, `_weaponRenderContainer` +648, `_weaponFireOrigin` +652, `_defaultID` +664, `_weaponLevel` +668, `_currentMagazine` +692, `_currentAmmo` +708. The last three are ObscuredInt.

1. `<InitializeWeapons>d__191` (f136929) gets the starting weapons from `GetStartingWeapons` (slot 28442, f106795). It resolves each `WeaponBaseData` and skin to a `Task<WeaponModel>` through the factory `WeaponBaseData.GetWeaponModel(skinID)` (slot 28475, f43401). It sets `_didInitialize` only after the factory and attachment chain finishes.
2. `WeaponsController.Update` (f106746) returns early until `_didInitialize` is set.
3. `WeaponModel.Initialize(weaponBaseData, weaponLevel, basePrefab)` (f106695, slot 103372) stores the data and reads the level's stats. `AddWeaponToUser(WeaponModel)` (f106789, slot 10399) puts a model in an empty slot.
4. `WeaponModel.get_ID` (f106622, slot 7991) returns `BaseData.Id` (+12, declared on `EquipmentBaseData`). It falls back to `_defaultID` only when that is null.
5. `EquipWeapon(WeaponModel)` (f106812) starts `EquipDelayCoroutine` with `WeaponStats.EquipDelay`.
6. `TryFireWeapon` (f106754) fires. A melee swing hits through `MeleeWeaponModel.CastHit` (f106567), a BoxCast whose distance is `WeaponStats.Range`.

A `WeaponModel` copies `Stats` when it is created and keeps reading that copy.

### Scopes

`CameraZoomSettings` (`WeaponStats.ZoomSettings`): `HasScope` +8, `ScopeType` +12, `FieldOfView` +16, `Distance` +20, `RightOffset` +24, `ZoomDuration` +28. `WeaponsController.UpdateScopeState` (f106756) shows the scope from the model's copy.

| Weapon | `HasScope` | `ScopeType` | Aim FOV |
|---|---|---|---:|
| `lol.1v1.weapons.railgun` | false | | 45 |
| `lol.1v1.weapons.military_sniper` | true | Sniper | 15 |
| auto sniper | true | Sniper | 15 |

The camera's default field of view is 50.534.

## Abilities

Each champion has an `ActiveAbility`, a ScriptableObject in `JustPlay.Gameplay.Abilities` whose per-level data is held by `[SerializeReference]`. `Object.Instantiate` copies that data along with the ability. A player keeps its abilities in `PlayerAbilities._activeAbilities` (+56) as `PlayerAbilitySlot`s:

| Slot field | Offset |
|---|---:|
| `IsEmpty` | +8 |
| `Ability` | +12 |
| `CurrentCooldown` | +16 |
| `CurrentReuseDelay` | +20 |
| `IsActivated` | +24 |
| `SlotIndex` | +28 |
| `Player` | +32 |
| `CurrentStock` / `MaxStock` | +36 / +40 |
| `CurrentUltimateCharge` / `MaxUltimateCharge` | +44 / +48 |

An ability runs through these steps:

1. Ability1 (action 52) or Ability2 (54) performs. `PerformActiveAbilityRPC` calls the ability's `Perform` through the vtable on every client.
2. `PlayerAbilities.CancelActiveAbility` sends `CancelActiveAbilityRPC` to all. That RPC starts the cooldown and calls the ability's `Cancel` on every client.
3. `<DeactivateAbility>d__54` and `<ApplyCooldown>d__52` keep the slot `IsActivated` and hold back the cooldown for the asset's `Duration`.
4. `PlayerAbilitySlot.ApplyCooldown` (f51220) reads the cooldown through `IActiveAbilityLevelData.get_Cooldown`, and `PlayerAbilitySlot.Update` (f51179) refills the stock.

### Poseidon's Aqua Cannon

`AquaCannonAbility.Perform` is slot 119225. `AquaCannonAbility.Cancel` is slot 119228; its body, f41917, is folded with `Interrupt`. It gets the player's `AquaCannonBehaviour` through `TryGetComponent` and calls `TryCancel()` on that behavior's `_cts` itself, the same work that `AquaCannonBehaviour.Cancel` (f41918) does.

`AquaCannonLevelData` (metadata offsets): `Cooldown` 8, `Duration` 12, `ChargeTime` 16, `FireRate` 20, `NonPlayerHitRadius` 24, `PlayerHitRadius` 28, `MaxDistance` 32, `DpsPercentage` 36, `BuildingsFlatDamage` 40. Poseidon's `MaxDistance` is 60.

`AquaCannonBehaviour` sits on the player:

| Field | Offset |
|---|---:|
| `_isFiring` | +16 |
| `_player` | +20 |
| `_ability` | +24 |
| `_abilityLevelData` | +28, an inline copy, so `FireRate` is at +40 and `DpsPercentage` at +56 |
| `_abilityUxData` | +64 |
| `_cts` | +68 |
| `_timeFromLastDamage` | +72 (ObscuredFloat) |
| `_aquaCannonHitPlayers` | +140 |
| `_aquaCannonVfxInstance` | +148 |
| `_laserLengthController` | +152 |
| `_currentDirection` / `_currentOriginPoint` | +176 / +188 |

Every frame, `PopulateAquaCannonContactPoints` (f41926) reads the hit radii from the behavior's copy of the level data. On each tick, `ApplyHitInAquaCannonContactPoint` (f41928) applies `ProcessHitWithFlatDamage` to builds (`BuildingsFlatDamage`) and `ProcessHitDamage` with `DpsPercentage × FireRate` to players. At PowerScore 0, `CalculateAbilityDamage` turns that into `ceil(200 · DpsPercentage · FireRate)`, and Poseidon's values (0.8 and 0.1) give 16 per tick.

`LaserLengthController` sets the beam's length on its stretched particles; `HandleCannonMovement` never changes the VFX scale. `AquaCannonBehaviour.Update` sends `CancelActiveAbilityRPC` when the beam ends.

### Quick's Dash and Slice

`DashAbility.Perform` is slot 119354 (f41992). `DashLevelData` holds `Cooldown` +8, `Distance` +12, `Speed` +16, `MaxStock` +20 and `ReuseDelayTime` +24.

`SliceBehaviour.FixedUpdate` (f51102) skips teammates through `IsOnMyTeam` (slot 8503). `SliceBehaviour.ApplyHit` (f51103) calls `TriggerDamageEffects` after the damage. In a match, `Resources.FindObjectsOfTypeAll` finds no loaded `SliceAbility` asset (observed).

### Ability icons

An ability's icon is the `Icon` of its `AbilityUXData`. `AbilityExtensions.GetUXData` loads that from Addressables under `AbilitiesUXData/` plus the ability ID, so two abilities with the same ID show the same icon. Quick's Dash uses the sprite `Quick_Active`.

`Image.set_sprite` (slot 8094) applies the icon in three places:

| Place | Caller | Image field |
|---|---|---|
| HUD | `<LoadAbilityIcon>d__32` (f51256) | `AbilitySlotUI._abilityImage` +24 |
| Champion overview | `ChampionAbilityDisplay.<Init>d__10` (f51418) | `ChampionAbilityDisplay._icon` +20 |
| Kill feed | `KillFeedItem.<SetIconByDamageSource>d__31` (f46045) | `_firstIconImage` +32, `_secondIconImage` +36 |

`AbilitySlotUI` keeps its slot in `_abilitySlot` (+120), and `ChampionOverviewScreen` holds its `ChampionAbilityDisplay` in `_activeAbilityDisplay` (+32).

## Unknowns

- How `HitInfo.Damage` for a weapon hit is scaled by distance and headshots before `TakeDamage`. Neither `GetHitDistanceMultiplier` nor `CalculateDamageResult` has been traced.
- The `EquipmentGraphicData/<weapon id>` assets are not in `data.unity3d`; they load from Addressables.
