# Custom heroes

The original client has eleven heroes. This project can add up to two more as declared adaptations: their looks are 3D scans, and their abilities are original abilities with changed timing and effects. The eleven original heroes stay untouched.

The code has two hero slots, each named by its mechanic:

- `beam`: a charged beam with a jump, a hover and a sphere of barriers; a sword in place of the pickaxe; a glow and a charging aura.
- `elastic`: legs that stretch on the right mouse button; slaps on Q whose clap throws a projectile.

The code is public and names the heroes only by slot. What makes a slot a particular person stays private: the 3D models (the hero directories) and the names (`names.json`). `main` tracks neither, and a test fails if a tracked file on `main` names them. Notes about the heroes themselves go in `heroes/specifics.md`, which git ignores on every branch.

The heroes are optional and live in one removable unit, this folder:

- `page/`: the page code, its own symbol map (`symbols.ts`) and observers; a code path below with no folder of this unit in front (`beam/ability.ts`) is inside it;
- `scenarios/`: their probe scenarios;
- `files/`: the heroes directory, ignored on `main`.

Deleting `heroes/` leaves the rest of the project compiling and passing its tests.

How the original champion, skin and ability systems work is in `docs/reference/`.

## Turning them on

`play` and `probe` take one directory, on the `menu` and `lan` profiles only: `--heroes <dir>`. It holds `names.json` and one subdirectory per hero, named by its slot (`HEROES` in `page/ids.ts`):

```
<dir>/names.json
<dir>/beam/manifest.json …
<dir>/elastic/manifest.json …
```

The host checks each subdirectory against its manifest (`heroDirectories` and `heroFiles` in `src/host/server.ts`) and serves its files at `/local/heroes/<slot>/<file>`. It reads `names.json` (`heroNames`) and refuses it unless every key is a slot and every present slot has a valid entry. A missing subdirectory means that slot is not offered and none of its own adapters install. An unknown subdirectory, none at all, or slot directories without `names.json` stop the host with the reason.

The repository's own `heroes/files/`, in the same layout, is where the heroes directory lives. It is out of the public repository: `main` ignores it, a test fails if `main` tracks anything under it, and only the private repository tracks it. Without `--heroes`, `play` on `menu` or `lan` (and so `./start`) uses it as soon as it has a slot's directory. `probe` takes heroes only from `--heroes`, so the other scenarios keep the eleven original heroes.

Without heroes the page has no `hero` feature, the host serves no hero code and the client has its eleven heroes. With them, `hero` joins the profile's features, the page config lists each present slot's files and names (`heroes`), and the host builds `heroes/page/index.ts` into `/local/heroes.js` and loads it before the page bundle. That script registers itself as the page extension of the `hero` feature (`Extension` in `src/page/main.ts`), which installs first among the adapters, right after the Unity instance resolves, so the profile and catalog adapters list the heroes like original ones. Its receipt is `window.local.adapters.hero`, with `beam` and `elastic` for the heroes it added, and its observers (`heroes`, `championCards`, `elastic`, `sword`, `swordAnim`) join `window.local.observe`.

Hero scenarios name the slots they need (`heroes: ['beam']`), and the probe refuses them unless `--heroes` has those directories:

```sh
bun run probe --profile menu --scenario beamsuper,elastic --heroes <dir>
```

A run's manifest records the SHA-256 of each hero's `manifest.json` (`heroes: { beam, elastic }`), of `names.json` (`heroNamesSha256`) and of the heroes bundle (`heroesSha256`).

## names.json

One entry per slot. Every string the player sees that carries a hero's name comes from here.

```json
{
  "beam": {
    "name": "<display name>",
    "champion": "lol.1v1.champions.<id>",
    "skin": "lol.1v1.playerskins.pack.<id>.default",
    "password": "<password prompt>"
  },
  "elastic": { "name": "…", "champion": "lol.1v1.champions.<id>", "skin": "lol.1v1.playerskins.pack.<id>.default" }
}
```

- `name`: the champion's display name, on its card and overview (the copied `ChampionData`'s object name, which the catalogs adapter makes the product's `Name`).
- `champion`, `skin`: the champion ID and its default skin's ID. `<id>` is lowercase letters and digits, the same in both: the catalogs adapter gives a champion the skins whose ID carries its last part (`src/page/adapters/catalogs.ts`). Players' equipped champion and skin are stored by these IDs, so changing them resets that choice.
- `password` (optional, beam only): the prompt shown when SELECT asks for the beam hero's password (`lock.json`); without it the prompt is `Password:`.

## Hero directories

Each hero's directory holds a `manifest.json` that lists every file with its SHA-256 and size:

```json
{ "files": { "hero.mesh.json": { "sha256": "<hex>", "bytes": 123456 } } }
```

The host reads it at start, refuses any file that differs, and puts the file names in the page config. Names use letters, digits, `_`, `-` and `.`, and end in `.json`, `.png` or `.jpg`.

| File | Slot | Required | Contents |
|---|---|---|---|
| `hero.mesh.json` | both | yes | The scan, skinned to Poseidon's body bones (below). |
| `hero_color.png` or `.jpg` | both | yes | The scan's texture. |
| `hero_card.png` | both | no | The champion card portrait. |
| `clips.json` | beam | no | Its animation clips (below). |
| `beam.mesh.json` | beam | no | The Aqua Cannon body mesh, read from the original bundle, to bend the beam. |
| `sword.mesh.json`, `sword_albedo.png`, `sword_emission.png` | beam | no | The sword (below). |
| `lock.json` | beam | no | `{ "sha256": "<hex>" }`: the SHA-256 of the password. |
| `projectile.mesh.json`, `projectile.png` | elastic | no | The projectile (below); without it the Q is a Dash. |
| `ability_icon.png` | elastic | no | The hand icon of the Q. |

### hero.mesh.json

The scan in the space of Poseidon's body mesh, skinned to the bones that body's SkinnedMeshRenderer uses, by name and in that order (the look checks the names).

- `bones`: bone names; `bindposes`: one 4×4 matrix (16 numbers, Unity's order) per bone.
- `positions`, `normals` (3 per vertex), `uv` (2 per vertex), `indices` (triangles, at most 65 535 vertices).
- `boneIndices`, `boneWeights`: 4 per vertex.
- `skeleton` (optional): bone name to local position. While the scan shows, those bones (and `Root`, the parent of `Hips`) take these positions, for a body with other proportions than Poseidon's.
- `source.shape` (optional): `{ arms, legs, thin, body, head }`, the body's proportions against Poseidon's; the hitbox follows them (see Looks).

### clips.json

Clip name to `{ fps, length, loop, additive?, bones, rootY?, marks? }`.

- `bones`: bone name to keys `[t, x, y, z, w]`, the bone's `localRotation`. An `additive` clip turns each bone by its key's turn from the first key, on top of the Animator's pose, so it starts and ends in that pose.
- `rootY`: keys `[t, y]`, a Hips height offset.
- `marks`: named times.

The beam slot uses `contract` (the charge), `jump`, `arch` and `release_forward` (the release) and `flip` (the double jump).

### sword.mesh.json

The sword in the pickaxe model's frame: `positions`, `normals`, `uv`, `triangles`; `hand`, `tip` and `pommel`; the centres of its guard and pommel jewels (`jewel`, `pommelJewel`); and the jewels' own emissive colour (`idle`, max channel 1). `sword_albedo.png` is its texture and `sword_emission.png` the mask where the jewels glow.

### projectile.mesh.json

A cylinder along +Z, centred, in metres: `length`, `radius`, `positions`, `normals`, `uv` (into `projectile.png`), `triangles`.

## Adding or replacing a hero

1. **New look or name for an existing slot.** Write a new directory with the files above and its `manifest.json` as `<dir>/<slot>/`, and its entry in `<dir>/names.json`. No code changes.
2. **A different mechanic in a slot.** The slots live in `page/ids.ts` (`HEROES` names the directories, `heroFile` addresses their files, `roster` holds the present heroes' names and `heroOf` maps a champion ID to its slot), the setup in `installHeroes` (`page/index.ts`). Each hero is a copy of Poseidon's champion data under its own IDs (`addHero`); its ability is a copy of an original ability with a hook on that ability's `Perform` (beam: Poseidon's Aqua Cannon, `beam/ability.ts`; elastic: Quick's Dash, `elastic/slap.ts`). A new slot also goes in the host's names check, which takes the slots from `HEROES`.
3. **Map entries.** Slots, cells and offsets only hero code reads go in `page/symbols.ts`, under their recovered names, and `tests/unit/symbols.test.ts` checks them like the core map. A key the core map already has stays there.
4. **Observers.** Add them to `heroObservers` (`page/observe/index.ts`); they join `window.local.observe` only with the `hero` feature. `observe('heroes')` gives each skin manager and player its slot (`hero`), so scenarios never need the IDs.
5. **Scenarios.** Add them to `scenarios/` with the slots they need (`heroes: ['beam']`), and register them in its `index.ts`. `common.ts` reads a slot's champion ID from the page config (`championOf`), picks a champion (`pickHero`), equips each hero, opens a LAN duel (`heroDuel`) and builds or finds a wall (`wallAhead`, `healthOf`).
6. **Check.** `bun run typecheck`, `bun test`, then the hero scenarios with `--heroes <dir>`.

## How the heroes join the original game

`installHeroes` (`page/index.ts`) runs first:

- Each hero is a copy of Poseidon's `ChampionData` (`Object.Instantiate`, so abilities, costs and texts come along) under its champion ID and named by its display name, appended to `Champions._championsData` and indexed in `_championsMap`. `List<T>.Add` for these element types is never instantiated in the build, so the copy follows the original steps itself.
- Its default skin is a `MemberwiseClone` of Poseidon's default `LocalSkinPackProductData` under its skin ID, added to `LocalProductsData._skinPackProducts` and `_skinPackDict`. The catalogs adapter lists it as the hero's only skin, and the original `ChangeSkinsRPC` carries it to every client.
- `ChampionSelectionScreen` gets an extra card per hero past its prefab's 12: a copy of the last card, made before `OnEnable` lays them out.
- The elastic hero moves with the SAMURAI skin pack's controllers (`ShadowAnimator` in a match, `ShadowMenu` in the menu), Shadow's pack, which drives the same skeleton down to the fingers.

Both copy Poseidon's `ChampionData` and default skin. The beam hero's shields are Sentinel's barrier; the elastic hero's Q copies Quick's Dash.

Per-frame work for both heroes runs in one hook after every Animator has written the bones: Rewired's `InputManager_Base.LateUpdate` (`shared/frame.ts`). There, every player showing a hero's scan has its cheat detectors switched off on every client the way the original does after a detection (`Behaviour.set_enabled(false)`, `shared/cheats.ts`), because `FlyingCheatDetector` would flag the hover; offline its limits are 0, so it would flag every jump.

## Looks

`installHeroLook` (`shared/look.ts`) runs after the original `PlayerSkinManager.SetCurrentSkinPack` (slot 31722, called through the table by `<ChangeSkin>d__48`). When a hero's skin shows:

- each SkinnedMeshRenderer of the body part gets the scan's Mesh and a copy of the body's first material with the scan's texture (the packs' toon materials sample `_BaseMap`); both are named by the slot;
- Poseidon's rigid face, the part's other renderer, hides;
- the bones are the renderer's own, checked by name against the mesh;
- a skin with its own controllers takes them the way `ChangeSkin` picks a pack's: `MenuAnimatorController` without a PlayerController, else `AnimatorController`.

When the same cached pack shows another skin, the renderers get their original mesh and materials back, and the face returns.

A mesh with a `skeleton` holds those bones at its local positions after each Animator frame. Root is raised by however much the longer legs lower the ankle that the animation puts lowest, so that foot stays on the ground; a fixed raise would float bent legs. With `source.shape`, the hitbox follows:

- the pack's capsules (`SkinPack.PlayerColliders`): thighs and shins along their axis by `legs`, upper arms and the forearm-and-hand capsules by `arms`, the limbs as thin as `thin` (the Hand capsules keep their radius), the torso's (`Spine_01`, `Spine_02`) by `body`, and the head's scaled by `head` about the Head bone;
- with a player, its motor capsule and legs trigger grow by Root's raise with their centres half of it higher, and `PlayerController._centerHeightOffset` rises by half of it.

Card art: `<DisplayIcon>d__8` loads a card's art through `ImageExtensions.SetSpriteAsync` (slot 8642) with the default skin's thumbnail, which the heroes share with Poseidon. For a card showing a hero with a portrait, the hook sets the scan's sprite (named by the slot) and returns a completed task.

## The beam slot

### Q: the beam

The beam hero's Q is his own copy of Poseidon's Aqua Cannon (`beam/ability.ts`). Every level's Duration becomes `ARMED`, so `PlayerAbilities` keeps the slot activated until it is cancelled, and no level has a Cooldown.

1. Pressing Q arms the ability: the hooked `AquaCannonAbility.Perform` (slot 119225, which `PerformActiveAbilityRPC` calls on every client) only arms, with no beam.
2. Holding Q charges for up to `CHARGE`. He contracts from whatever pose he is in (clip `contract`, additive), and the charging aura grows around him in the tier's colour.
3. Letting go of Q, or pressing Shoot, sends the charge (`charge` message) and the original `PlayerAbilities.CancelActiveAbility`, whose RPC calls `AquaCannonAbility.Cancel` (slot 119228) on every client. For an armed beam hero, Cancel starts the release on every client:
   - the clips in `STEPS`: he jumps, arches back and releases;
   - on the owner, from the takeoff, the Rigidbody's velocity climbs `LOW` to `WALLS` build walls above the release point (by charge) and holds there; position sync shows it to the others. He drifts sideways by the movement input (`AIR`), and the builds above his head break as the climb starts (`KillBuilding`);
   - a sphere of Sentinel barriers appears around him, each after its own random delay;
   - at `FIRE` his behaviour's level data gets Poseidon's Duration for his level, no charge, `REACH` and the tier's damage, and the original `Perform` fires the beam, which grows from `SMALL` to `GROWTH` times Poseidon's width.
4. When the beam ends (`AquaCannonBehaviour._isFiring` drops) he falls.
5. Q during the release cancels it on every client. Before the beam, the slot performs again (no cooldown) and Perform aborts; while the beam fires, the original `AquaCannonBehaviour.Update` sends the cancel. Aborting stops the beam, dismisses the barriers and stops the owner's climb.

His glow covers the body for the whole release (see The glow).

### The beam

`beam/beam.ts` takes over `AquaCannonBehaviour.Update` (slot 119253) for the hero's beam on every client and runs the original pieces by slot: `UpdateAiming` (8354), `PopulateAquaCannonContactPoints` (8355), `HandleCannonMovement` (8356) and, on the owner, `ApplyHitsInAquaCannonContactPoints` (119260) every `FireRate` seconds, the first at once. His own barriers let his casts through, as the original lets an owner's shots through his barrier. The original's aim assist is left out (it turns the camera), and so is its Ability1 cancel, which Perform's abort replaces.

- **Lock-on** (`beam/lock-on.ts`): the Seeker's `CombatHelper.GetLockOnTarget` asked every frame with `RANGE` and viewport margins `MARGIN`; its answer is the lock at once, and each change reaches every client as a `lock` message.
- **Curve**: with a lock, the beam is a quadratic Bézier leaving the origin along the aim, through a control point half the way to the target, to the target's centre; it blends in and out over `BLEND`. Populate runs along it in `SEGMENTS` straight pieces, the contact points gathered and the curve cut at the first obstacle.
- **Bend** (`beam/bend.ts`): the VFX's `LaserLengthController` stretches its particles along local −Z. The beam mesh (FX_MS_LaserMain_01) is not readable in the build, so `beam.mesh.json` gives a readable copy per particle size, carried along the curve by arc length with rotation-minimising frames. The parts whose particles turn about the beam axis (LaserNoise 05/06) hide while it bends. A tint turns the hue of the beam material's colours to the tier's on copies of the materials. The VFX instance is pooled, so `straighten` gives Poseidon's beams their meshes back.
- **Walls**: every frame the owner destroys each non-static build among the contact points with `BuildingNetworkController.KillBuilding` (slot 9039). The original way, a flat damage per tick, would wait for the tick.

### The charging aura

`beam/aura.ts` puts a copy of Caesar's Royal Decree soldier aura (AuraChargeYellow, abilitiesuxdata bundle) under a charging beam hero, on every client. Its glow, rings and rising clouds take their colour only from their start colour, so `ParticleSystem.set_startColor` gives them the tier's colour; the parts with their own gradients stay off, because the build keeps no gradient setter. The rising clouds (RisingClouds) become spikes: drawn stretched along their upward velocity (`ParticleSystemRenderer.set_renderMode` Stretch, with `set_lengthScale` and `set_velocityScale`) with the tapered light ray of Pyro's Combust aura (CombustAura → CombustAuraVFX/ChargeupRays, `lightray2_ADD`), emitted from the feet up and close to the body, and growing with the charge (`SPIKE`). On release or cancel the aura stops emitting and goes after `LINGER`.

### The barrier sphere

`beam/barriers.ts`: on the owner, `spawn` runs the original `BarrierShockwaveAbility.Perform` (slot 119429) for one Sentinel barrier, which every client instantiates and runs as the original does, ending at Photon time `until`. Each client's hooked `BarrierShockwaveBehaviour.Update` (slot 119455) poses the hero's barriers on a sphere (`ROWS`, `RADIUS`) instead of in front of his aim: each new barrier takes a random free slot, facing out, and the sphere follows him. The rows are closed for the solid collider that stops shots. A dismissed barrier turns off (`ToggleBarrier(false)`) and parks far below until its original end. The beam's casts stop at the Barrier layer, so `through` runs the hero's casts with his barriers' colliders on the teammate layer, as the original does for an owner's own shots.

### The glow

`beam/material.ts` imitates a reference shader of a refractive torus with spectral dispersion. The build compiles no shader at runtime and its URP asset copies no opaque texture, so the scan's renderer gets copies of loaded original materials instead, drawn once each over its single submesh:

- glass: URP Lit transparent (ImmunitySphere) with specular highlights and reflections on, neutral grey;
- the reference itself, computed per vertex every frame on the posed body (`SkinnedMeshRenderer.BakeMesh`) as seen from the main camera, written as vertex colours of the renderer's own mesh copy and drawn by a URP Particles/Unlit copy turned alpha-blended and back-culled;
- three Fresnel rims (PolyProtonBlue) whose hues step through the spectrum in time;
- the scan's own look fading out on the transparent mythic toon shader while the level is below 1.

### Double jump

`beam/jump.ts`: in the air, the owner's second Jump press restarts the original jump (`vThirdPersonMotor.isJumping`, `jumpCounter` from `jumpTimer`) once per flight, never while the ability is armed or releasing. Every client plays the `flip` clip from the `flip` message. That flight takes no fall damage: `HandleFallDamage` hurts from the takeoff height `HandleFalling` keeps, and the owner keeps it at `FLOOR` after the second jump.

### Sword

The beam hero's pickaxe is a sword (`beam/sword.ts`, tiers in `beam/sword-spec.ts`).

- **Look**, on every client: the current weapon skin's renderer shows the sword mesh, in that skin's frame, with a per-player copy of the pickaxe skins' material (Fang_Pickaxe _SSS, on PlayerToonShaderEmission). Its emission mask makes only the jewels glow, at their own colour at rest and at the tier's (`JEWEL`) while charging.
- **No pickup time**: no `WeaponStats.EquipDelay`.
- **Charge**: holding the right mouse button (Aim) with the sword charges (`sword` message 1). Letting go swings through the original `WeaponsController.TryFireWeapon` at the tier reached (`sword` 10 + tier). A left click swings at the first tier.
- **Reach and damage**: `WeaponStats.Range` × the tier's `range`; the owner's `PlayerController.TakeDamage` call (slot 107341) gets `HitInfo.Damage` × the tier's `damage`. Builds take the pickaxe's own damage.
- **Push**: a `swordknock` message makes the victim's own client push itself away from the attacker (`PlayerController.ApplyKnockback`) by the tier's `knock` × `KNOCK` plus `KNOCK_UP` upward, in N·s on the player's Rigidbody. On the ground the motor keeps an impulse only for |F| × 0.0005 s (`vThirdPersonMotor.ApplyKnockback`, f118179) and `OnAnimatorMove` (f118086, grounded only) then brakes it, so a purely horizontal push barely moves a player and the upward part lifts the victim. In the air it keeps its speed until it lands, after the same short air time at every tier (the motor's `extraGravity`), so the distance grows with the tier's `knock`. For scale, the Sentinel's shockwave pushes with its `KnockbackForce` forward and `KnockbackUpForce` up.
- **Stray**: other clients move a player by its transform only (`PlayerController.UpdateRemoteTransform`, f48572), while its hit colliders ride its Rigidbody. In combat `Physics.autoSyncTransforms` is off (`PlayerController.ChangeState`, f48568), so a pushed body stays where the push began and swings pass through the player. Each client puts a pushed remote player's body back where it shows that player once they differ by more than `STRAY`.
- **Motion** (`beam/sword-anim.ts`), on every client, written after the Animator without hooking the melee code. A swing is the Animator's own (PickaxeLayer in a swing state), so the strike reaches the hit exactly when the original MeleeSwingHit event deals the damage. While the sword charges, the arm draws back into the tier's wound pose. The right arm is a two-bone IK chain with the hand turned so the blade points along the swing, the torso turns into it and the left hand guards, counterbalances or, at the top tier, joins the grip. A scan without weight on the arm bones only carries the sword in its arms, and its clothes show the torso's turn. The weapon stays in his right hand whenever the original moves it to the left holder.

### Password

The beam directory may hold `lock.json`; without it the beam hero has no password. With it, pressing SELECT for him in the champion overview (`ChampionOverviewScreen.SelectChampion`, slot 120126) prompts with `names.json`'s `password`, compares the answer's SHA-256 with that file's (`beam/password.ts`), and remembers a correct answer in `localStorage` (`local.<id>.unlocked`). Attempts are unlimited. The check runs in the browser, so it keeps out casual players, not someone who reads the page.

## The elastic slot

### Q: slaps and the projectile

His Q is his own copy of Quick's DashAbility (`elastic/slap.ts`), the build's loaded instant ability; its ID stays the Dash's. Every level's Cooldown becomes `CADENCE`, with one stock and no ReuseDelayTime. The hooked `DashAbility.Perform` (slot 119354) does not dash for him; other champions dash as in the original.

- Each Q press performs the next step of a cycle: left hand, right hand, both hands. The cycle restarts after `RESET` without Q. The owner picks the step and the target (the nearest enemy ahead within `PICK`) and sends `slap`; every client plays it.
- The pose is written after the Animator: the torso twists and leans into the hit, the clavicle draws the shoulder back and then drives it forward, and each slapping arm is a two-bone IK chain whose segments stretch so the hand reaches its path. They stretch only past the share of their length the phase spans, so the elbow is bent in the wind-up and straight at the hit. The wrist lags, then snaps through, and the hand grows at the hit (`SLAPS`). PlayerIK stays off and the held weapon hidden while a slap plays and for `GRACE` after the last one.
- At the hit the owner strikes: every enemy with a collider on the `HitLayerMask`'s player layers within `TOUCH` of the contact point, or its centre that close, takes `DAMAGE` through the original `PlayerController.TakeDamage` with the original hit marker. Both count, because on the owner's client a remote player's colliders can lie metres from its transform. Every non-static build within `GRAZE` takes `BUILD` through `BuildingNetworkController.HitBuilding` (slot 102481), which `Building.TakeDamage` (f44803) calls with a hit's damage (RPC `HitBuildingRemote` to all). The dead and teammates are skipped, as `SliceBehaviour.FixedUpdate` does.
- The clap throws the projectile (`elastic/projectile.ts`), its own entity moved by time on every client like the original projectiles. It flies at `SPEED` up to `RANGE`, tumbling end over end, from between the clapping hands. The owner hurts each player it sweeps over once (`DAMAGE`), with a `knock` message that makes the victim's own client push itself (`KNOCK`); the original has no knockback RPC. It breaks the builds it sweeps over in flight order, once each, up to `WALLS`; at the last it sends `projectilestop` and every client ends the flight there. Players do not count toward the builds.

His Q shows a hand (`ability_icon.png`) instead of the Dash's boot (`elastic/icon.ts`). Ability icons reach their Image through `Image.set_sprite` (slot 8094) once loaded: the HUD (f51256, `AbilitySlotUI._abilityImage`), the overview (f51418, `ChampionAbilityDisplay._icon`) and the kill feed (f46045). His copy keeps Quick's ID, so both load the same UX data, and the hook swaps the icon only on an image showing his ability: a HUD slot holding his copy, his overview, or a kill feed icon (a Dash deals no damage; his hits name the copy's ID).

### Right mouse button: stretch

`elastic/stretch.ts`. Space jumps as in the original. Holding the right mouse button (Aim) past `HOLD` grows his legs to `LEGS` times their length; letting go shrinks them back, each over `EASE`. Aim's other readers keep working: with a weapon that zooms, a click zooms and never grows, and holding zooms while the legs grow. The owner sends `stretch` and every client eases from where it is:

- the leg bones' targets and the mesh's `stretch` blend shape;
- the hitbox: the motor capsule and legs trigger grow upward by the added height, the pack's leg capsules lengthen, and the centre offset rises by half of it;
- the owner moves `SPEED` times as fast (`vThirdPersonController.ApplySpeedMultiplier`) and its camera follows the height.

In the menu (a body with no player: lobby, party slots, champion overview) his legs show at `MENU_LEGS` through a second blend shape, `menu`. In a match they keep their length.

## Tuning

Every value lives in a constant at the top of its file.

### Beam

| What | Constants | File |
|---|---|---|
| Charge time, tiers (hue and damage multiplier) | `CHARGE`, `TIERS` | `beam/ability.ts` |
| Hover height, in build walls | `LOW`, `WALLS` | `beam/ability.ts` |
| Beam reach and growth | `REACH`, `SMALL`, `GROWTH` | `beam/ability.ts` |
| Release timing | `STEPS`, `TAKEOFF`, `FIRE`, `JUMP` | `beam/ability.ts` |
| Climb, drift and easing | `CLIMB`, `CLIMB_GAIN`, `AIR`, `EASE`, `DRIFT` | `beam/ability.ts` |
| Contraction | `GATHER`, `GATHERED`, `XFADE`, `CROUCH` | `beam/ability.ts` |
| Cleared column | `COLUMN`, `HEAD` | `beam/ability.ts` |
| Barrier timing | `SHIELDS`, `DELAY` | `beam/ability.ts` |
| Barrier sphere | `ROWS`, `RADIUS`, `EASE` | `beam/barriers.ts` |
| Lock-on | `RANGE`, `MARGIN` | `beam/lock-on.ts` |
| Beam curve | `BLEND`, `SEGMENTS` | `beam/beam.ts` |
| Aura | `FADE_IN`, `BLEND`, `LINGER`, `HEIGHT`, `SPIKE`, `DROP`, `HUG`, `SHARE` | `beam/aura.ts` |
| Glow | `GLASS`, `CLEAR`, `FRINGES`, `STEP`, `FRINGE`, `OVER` | `beam/material.ts` |
| Sword tiers (hold time, damage, reach, push) | `SWORD_TIERS` | `beam/sword-spec.ts` |
| Sword push, jewels, glow | `KNOCK`, `KNOCK_UP`, `JEWEL`, `BOOST`, `GLOW_EASE`, `STRAY` | `beam/sword.ts` |
| Sword motion | `SWINGS_BY_TIER`, `GUARD`, `BALANCE`, `IN`, `OUT`, `SHIFT`, `GRACE` | `beam/sword-anim.ts` |
| Beam damage per hit to a player, offline: ceil(16 × the tier's `damage`) | `TIERS` | `beam/ability.ts` |

The beam's damage comes from `CombatHelper.CalculateAbilityDamage` with no power score ([combat.md](../docs/reference/combat.md#ability-damage-formula)).

### Elastic

| What | Constants | File |
|---|---|---|
| Slap damage, build damage, cadence, cycle reset | `DAMAGE`, `BUILD`, `CADENCE`, `RESET` | `elastic/slap.ts` |
| Target pick, reach, contact radii | `PICK`, `REACH`, `TOUCH`, `GRAZE` | `elastic/slap.ts` |
| Slap motion | `SLAPS`, `SPINE`, `FLICK`, `IN`, `GRACE` | `elastic/slap.ts` |
| Projectile flight | `SPEED`, `RANGE`, `GROW`, `SHRINK`, `TUMBLE`, `SPAWN` | `elastic/projectile.ts` |
| Projectile damage, push, builds | `DAMAGE`, `KNOCK`, `WALLS` | `elastic/projectile.ts` |
| Projectile hit margins, material | `PLAYER`, `BUILD`, `SMOOTHNESS`, `METALLIC` | `elastic/projectile.ts` |
| Stretch | `HOLD`, `LEGS`, `EASE`, `SPEED`, `MENU_LEGS` | `elastic/stretch.ts` |

## Network messages

The heroes' own state crosses the network as the Seeker's projectile event: a PUN `ProjectileEventRPC` to all, with a projectile ID of the form `hero:<kind>:<sender's OwnerID>` that matches no live projectile, carrying one integer (`shared/net.ts`). The hook on `ProjectileEventRPC` takes these IDs and passes every other one to the original.

| Kind | Sent by | Value |
|---|---|---|
| `lock` | the beam hero's owner, on each lock change | the target's OwnerID, or −1 |
| `charge` | the beam hero's owner, on release | the charge in milliseconds |
| `flip` | the double-jumping owner | 0 |
| `sword` | the beam hero's owner | 1 when a charge starts, 10 + tier on the swing, 0 when the charge is dropped |
| `swordknock` | the attacker's client | victim OwnerID × 4 + tier |
| `stretch` | the elastic hero's owner | the wanted stretch state |
| `slap` | the elastic hero's owner | cycle step + 3 × (target OwnerID + 1) |
| `projectile` | the elastic hero's owner | the packed throw direction |
| `projectilestop` | the projectile's owner, at the last build | the stop distance in centimetres |
| `knock` | the projectile's owner | the victim's OwnerID; the victim's own client applies the push |

Damage itself goes through the original paths: `PlayerController.TakeDamage` (RPC `TakeHit` on the victim's view) for players, with the original hit marker and floating damage, and the original build damage RPC for builds.

## Probe instrumentation

Some hero modules keep short logs that only the observers read (`swordLog`, `elasticStrikes`, `elasticKnocks`, `elasticEnded`), each list kept to its last entries by `record` (`shared/trace.ts`); `beamMaterialStats` counts the glow's per-vertex pass. Probes slow the heroes' poses for visual review through `globalThis.heroSlow`, read by `slowMotion` in `shared/trace.ts` and set by `slowMotion` in `scenarios/common.ts`.
