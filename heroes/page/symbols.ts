// The map entries only the custom heroes use, in the shape of src/page/symbols.ts and checked the same way by
// tests/unit/symbols.test.ts. Hero code imports its tables from here: each one is the core table with these added.
import * as core from '../../src/page/symbols';

/** Function-table slots called or hooked by the heroes: [slot, recovered method]. */
export const slots = {
  gameObjectSetLayer: [8417, 'UnityEngine.GameObject::set_layer'],
  gameObjectLayer: [9006, 'UnityEngine.GameObject::get_layer'],
  cameraWorldToScreen: [125043, 'UnityEngine.Camera::WorldToScreenPoint_Injected'], // (Vector3*, eye, out Vector3*)
  transformPoint: [128112, 'UnityEngine.Transform::TransformPoint_Injected'], // (Vector3*, out Vector3*)
  playerChampionId: [107315, 'PlayerController::get_ChampionID'],
  championOverviewSelect: [120126, 'JustPlay.Champions.UI.ChampionOverviewScreen::SelectChampion'],
  objectInstantiate: [127677, 'UnityEngine.Object::Instantiate'], // (Object original)
  objectInstantiateIn: [127679, 'UnityEngine.Object::Instantiate'], // (Object original, Transform parent)
  transformParent: [7047, 'UnityEngine.Transform::get_parent'],
  objectSetName: [7051, 'UnityEngine.Object::set_name'],
  championDataSetId: [120072, 'JustPlay.Champions.ChampionData::set_ID'],
  memberwiseClone: [20800, 'System.Object::MemberwiseClone'],
  arrayCreateInstance: [7163, 'System.Array::CreateInstance'], // (Type elementType, int length)
  setCurrentSkinPack: [31722, 'PlayerSkinManager::SetCurrentSkinPack'], // Table call in <ChangeSkin>d__48::MoveNext.
  meshSetVertices: [26447, 'UnityEngine.Mesh::set_vertices'],
  meshSetTriangles: [126428, 'UnityEngine.Mesh::set_triangles'],
  meshSetNormals: [126327, 'UnityEngine.Mesh::set_normals'],
  meshSetUv: [126331, 'UnityEngine.Mesh::set_uv'],
  meshSetBoneWeights: [126473, 'UnityEngine.Mesh::set_boneWeights'],
  meshSetBindposes: [126291, 'UnityEngine.Mesh::set_bindposes'],
  meshRecalculateBounds: [126477, 'UnityEngine.Mesh::RecalculateBounds'], // ()
  texture2dCtor: [126644, 'UnityEngine.Texture2D::.ctor'], // (int width, int height)
  loadImage: [130840, 'UnityEngine.ImageConversion::LoadImage'], // (Texture2D, byte[])
  materialCtor: [125862, 'UnityEngine.Material::.ctor'], // (Material source)
  materialSetTexture: [125997, 'UnityEngine.Material::SetTexture'], // (string name, Texture value)
  materialSetColor: [125993, 'UnityEngine.Material::SetColor'], // (string name, Color*) — byval pointer
  materialColor: [126070, 'UnityEngine.Material::GetColorImpl_Injected'], // (int nameID, out Color*)
  shaderPropertyId: [125719, 'UnityEngine.Shader::PropertyToID'], // (string name)
  rendererSharedMaterial: [9908, 'UnityEngine.Renderer::get_sharedMaterial'],
  rendererSetSharedMaterial: [8998, 'UnityEngine.Renderer::set_sharedMaterial'],
  materialSetFloat: [125991, 'UnityEngine.Material::SetFloat'], // (string name, float)
  materialDisableKeyword: [9919, 'UnityEngine.Material::DisableKeyword'], // (string)
  textureWhite: [126577, 'UnityEngine.Texture2D::get_whiteTexture'],
  skinnedBakeMesh: [126203, 'UnityEngine.SkinnedMeshRenderer::BakeMesh'], // (Mesh, bool useScale)
  // (VertexAttribute, VertexAttributeFormat, int dim, Array values): fills `values` (Mesh.GetVertices' path, f127252).
  meshChannelInto: [126256, 'UnityEngine.Mesh::GetArrayFromChannelImpl'],
  findObjectsOfTypeAll: [127426, 'UnityEngine.Resources::FindObjectsOfTypeAll'], // (Type): loaded assets too
  rendererSetSharedMaterials: [8020, 'UnityEngine.Renderer::set_sharedMaterials'],
  skinnedBones: [126194, 'UnityEngine.SkinnedMeshRenderer::get_bones'],
  skinnedSharedMesh: [126196, 'UnityEngine.SkinnedMeshRenderer::get_sharedMesh'],
  skinnedSetSharedMesh: [126197, 'UnityEngine.SkinnedMeshRenderer::set_sharedMesh'],
  objectSetHideFlags: [127688, 'UnityEngine.Object::set_hideFlags'],
  transformSetLocalRotation: [8079, 'UnityEngine.Transform::set_localRotation'], // (Quaternion*) — byval pointer
  transformSetLocalPosition: [8783, 'UnityEngine.Transform::set_localPosition'], // (Vector3*) — byval pointer
  transformLocalPosition: [128091, 'UnityEngine.Transform::get_localPosition_Injected'], // (out Vector3*)
  capsuleHeight: [9941, 'UnityEngine.CapsuleCollider::get_height'],
  capsuleSetHeight: [131797, 'UnityEngine.CapsuleCollider::set_height'],
  capsuleCenter: [131803, 'UnityEngine.CapsuleCollider::get_center_Injected'], // (out Vector3*)
  capsuleSetCenter: [131796, 'UnityEngine.CapsuleCollider::set_center'], // (Vector3*) — byval pointer
  capsuleDirection: [131798, 'UnityEngine.CapsuleCollider::get_direction'],
  capsuleRadius: [9934, 'UnityEngine.CapsuleCollider::get_radius'],
  capsuleSetRadius: [9935, 'UnityEngine.CapsuleCollider::set_radius'],
  meshAddBlendShapeFrame: [126276, 'UnityEngine.Mesh::AddBlendShapeFrame'], // (name, weight, Vector3[] ×3)
  skinnedSetBlendShapeWeight: [126201, 'UnityEngine.SkinnedMeshRenderer::SetBlendShapeWeight'], // (int, float)
  applySpeedMultiplier: [8445, 'Invector.CharacterController.vThirdPersonController::ApplySpeedMultiplier'],
  removeSpeedMultiplier: [8448, 'Invector.CharacterController.vThirdPersonController::RemoveSpeedMultiplier'],
  cameraSetHeight: [105514, 'vThirdPersonCamera::SetHeight'],
  rigidbodyPosition: [131744, 'UnityEngine.Rigidbody::get_position_Injected'], // (out Vector3*)
  rigidbodyVelocity: [131733, 'UnityEngine.Rigidbody::get_velocity_Injected'], // (out Vector3*)
  rigidbodySetPosition: [131745, 'UnityEngine.Rigidbody::set_position_Injected'], // (Vector3*)
  rigidbodySetVelocity: [10414, 'UnityEngine.Rigidbody::set_velocity'], // (Vector3*) — byval pointer
  killBuilding: [9039, 'BuildingNetworkController::KillBuilding'], // (string id) → RPC "DestroyBuildingRemote"
  colliderBounds: [131775, 'UnityEngine.Collider::get_bounds_Injected'], // (out Bounds*: center, extents)
  colliderIsTrigger: [131770, 'UnityEngine.Collider::get_isTrigger'],
  // (this, player, double ts): <Perform>d__14 (f42048) PhotonNetwork.Instantiates the barrier on the owner's client.
  barrierPerform: [119429, 'JustPlay.Gameplay.Abilities.BarrierShockwaveAbility::Perform'],
  barrierUpdate: [119455, 'JustPlay.Gameplay.Abilities.BarrierShockwaveBehaviour::Update'], // Engine-invoked.
  toggleBarrier: [8422, 'JustPlay.Gameplay.Abilities.BarrierShockwaveBehaviour::ToggleBarrier'], // (bool on)
  playerOwnerId: [107274, 'PlayerController::get_OwnerID'],
  photonView: [8109, 'Photon.Pun.MonoBehaviourPun::get_photonView'],
  playerCenterPosition: [8064, 'PlayerController::get_CenterPosition'], // (Vector3* sret, this)
  transformSetPosition: [8066, 'UnityEngine.Transform::set_position'], // (Vector3*) — byval pointer
  transformSetRotation: [8314, 'UnityEngine.Transform::set_rotation'], // (Quaternion*) — byval pointer
  transformSetLocalScale: [8311, 'UnityEngine.Transform::set_localScale'], // (Vector3*) — byval pointer
  transformLocalScale: [128100, 'UnityEngine.Transform::get_localScale_Injected'], // (out Vector3*)
  transformFind: [128068, 'UnityEngine.Transform::Find'], // (string name)
  componentsInChildren: [127537, 'UnityEngine.GameObject::GetComponentsInChildren'], // (Type, bool includeInactive)
  gameObjectAddComponent: [127549, 'UnityEngine.GameObject::AddComponent'], // (Type)
  meshFilterSetMesh: [126183, 'UnityEngine.MeshFilter::set_sharedMesh'],
  tryFireWeapon: [8221, 'WeaponsController::TryFireWeapon'], // (bool isFirstClick, bool ignoreEquipDelay)
  playerTakeDamage: [107343, 'PlayerController::TakeDamage'], // (attacker, HitInfo, IDamagingAbility) → RPC "TakeHit"
  playerTakeDamageWeapon: [107341, 'PlayerController::TakeDamage'], // (attacker, HitInfo, WeaponStats*): weapons
  applyKnockback: [10225, 'PlayerController::ApplyKnockback'], // (Vector3* force), on the victim's own client
  isOnMyTeam: [8503, 'PlayerControllerExtensions::IsOnMyTeam'], // static (player, otherPlayer)
  triggerDamageEffects: [103189, 'CombatHelper::TriggerDamageEffects'], // static (victim, int damage): marker, popup
  // (string id, int damage, bool playAnimation, bool hitWithMelee, int playerId) → RPC "HitBuildingRemote"
  hitBuilding: [102481, 'BuildingNetworkController::HitBuilding'],
  overlapSphere: [131563, 'UnityEngine.Physics::OverlapSphereNonAlloc'], // (Vector3*, radius, Collider[], int mask)
  componentInParent: [127488, 'UnityEngine.Component::GetComponentInParent'], // (Type, bool includeInactive)
  dashPerform: [119354, 'JustPlay.Gameplay.Abilities.DashAbility::Perform'], // (player, double timestamp)
  objectDestroy: [8135, 'UnityEngine.Object::Destroy'],
  particlePlay: [131031, 'UnityEngine.ParticleSystem::Play'], // (bool withChildren)
  particleStop: [131034, 'UnityEngine.ParticleSystem::Stop'], // (bool withChildren, ParticleSystemStopBehavior)
  particleSetStartColor: [130972, 'UnityEngine.ParticleSystem::set_startColor'], // (Color*) — byval pointer
  particleSetStartSpeed: [130968, 'UnityEngine.ParticleSystem::set_startSpeed'], // (float)
  particleSetStartSize: [130970, 'UnityEngine.ParticleSystem::set_startSize'], // (float)
  particleSetStartLifetime: [130978, 'UnityEngine.ParticleSystem::set_startLifetime'], // (float)
  particleSetEmissionRate: [130966, 'UnityEngine.ParticleSystem::set_emissionRate'], // (float)
  particleSetGravity: [130980, 'UnityEngine.ParticleSystem::set_gravityModifier'], // (float)
  // (ParticleSystemRenderMode)
  particleRendererSetMode: [131254, 'UnityEngine.ParticleSystemRenderer::set_renderMode'],
  particleRendererSetLength: [131260, 'UnityEngine.ParticleSystemRenderer::set_lengthScale'], // (float)
  particleRendererSetVelocity: [131262, 'UnityEngine.ParticleSystemRenderer::set_velocityScale'], // (float)
  setSpriteAsync: [8642, 'JustPlay.Addressables.ImageExtensions::SetSpriteAsync'], // Table call in f51426.
  // A Unity message: no direct caller (f51449), invoked through the table.
  championScreenOnEnable: [120137, 'JustPlay.Champions.UI.ChampionSelectionScreen::OnEnable'],
  imageSetSprite: [8094, 'UnityEngine.UI.Image::set_sprite'],
  imageSprite: [140980, 'UnityEngine.UI.Image::get_sprite'],
  spriteCreate: [128200, 'UnityEngine.Sprite::Create'], // (Texture2D, Rect*, Vector2* pivot)
  championDataSetActiveAbility: [120078, 'JustPlay.Champions.ChampionData::set_ActiveAbility'],
  // PerformActiveAbilityRPC (f51211) calls it through vtable slot 8 on every client: (this, player, double ts).
  aquaCannonPerform: [119225, 'JustPlay.Gameplay.Abilities.AquaCannonAbility::Perform'],
  // CancelActiveAbilityRPC (f51204) calls it through ICancelableAbility; Interrupt shares f41917 at slot 119229.
  aquaCannonCancel: [119228, 'JustPlay.Gameplay.Abilities.AquaCannonAbility::Cancel'],
  cancelActiveAbility: [119844, 'JustPlay.Gameplay.Abilities.PlayerAbilities::CancelActiveAbility'],
  // AquaCannonBehaviour's frame: Update is engine-invoked; it calls the others directly (callable here by slot).
  aquaCannonUpdate: [119253, 'JustPlay.Gameplay.Abilities.AquaCannonBehaviour::Update'],
  aquaCannonUpdateAiming: [8354, 'JustPlay.Gameplay.Abilities.AquaCannonBehaviour::UpdateAiming'], // (bool smooth)
  aquaCannonPopulate: [8355, 'JustPlay.Gameplay.Abilities.AquaCannonBehaviour::PopulateAquaCannonContactPoints'],
  aquaCannonMovement: [8356, 'JustPlay.Gameplay.Abilities.AquaCannonBehaviour::HandleCannonMovement'],
  aquaCannonApplyHits:
    [119260, 'JustPlay.Gameplay.Abilities.AquaCannonBehaviour::ApplyHitsInAquaCannonContactPoints'],
  timeDeltaTime: [8113, 'UnityEngine.Time::get_deltaTime'],
  transformRotation: [128096, 'UnityEngine.Transform::get_rotation_Injected'], // (out Quaternion*)
  transformLocalRotation: [128098, 'UnityEngine.Transform::get_localRotation_Injected'], // (out Quaternion*)
  loadedAssetBundles: [124402, 'UnityEngine.AssetBundle::GetAllLoadedAssetBundles_Native'],
  assetBundleLoadAsync: [124411, 'UnityEngine.AssetBundle::LoadAssetAsync_Internal'], // (string name, Type)
  asyncOperationDone: [29481, 'UnityEngine.AsyncOperation::get_isDone'],
  assetBundleRequestResult: [124416, 'UnityEngine.AssetBundleRequest::GetResult'],
  gameObjectGetComponent: [127525, 'UnityEngine.GameObject::GetComponent'], // (Type)
  animatorController: [124180, 'UnityEngine.Animator::get_runtimeAnimatorController'],
  animatorSetController: [124181, 'UnityEngine.Animator::set_runtimeAnimatorController'],
  particleMesh: [131292, 'UnityEngine.ParticleSystemRenderer::get_mesh'],
  particleSetMesh: [131293, 'UnityEngine.ParticleSystemRenderer::set_mesh'],
  getParticles: [131013, 'UnityEngine.ParticleSystem::GetParticles'], // (Particle[] particles, int size)
  rendererSetEnabled: [8432, 'UnityEngine.Renderer::set_enabled'],
  rendererEnabled: [9905, 'UnityEngine.Renderer::get_enabled'],
  rendererBounds: [125676, 'UnityEngine.Renderer::get_bounds_Injected'], // (out Bounds*: center, extents)
  behaviourSetEnabled: [8181, 'UnityEngine.Behaviour::set_enabled'],
  meshSetTangents: [126329, 'UnityEngine.Mesh::set_tangents'],
  meshSetColors32: [126346, 'UnityEngine.Mesh::set_colors32'],
  meshMarkDynamic: [126485, 'UnityEngine.Mesh::MarkDynamic'],
  lockOnTarget: [10403, 'CombatHelper::GetLockOnTarget'], // (PlayerController user, float range, float mx, float my)
  photonViewRpc: [8110, 'Photon.Pun.PhotonView::RPC'], // (string methodName, RpcTarget, object[] parameters)
  // (string projectileID, IProjectileEventData): PUN invokes it through its MethodInfo on every client.
  projectileEventRpc: [117807, 'JustPlay.Projectiles.ProjectileManager::ProjectileEventRPC'],
  componentGetComponent: [127485, 'UnityEngine.Component::GetComponent'], // (Type)
  playerChampionLevel: [8308, 'PlayerController::get_ChampionLevel'],
  photonTime: [8373, 'Photon.Pun.PhotonNetwork::get_Time'], // → double
  buttonDown: [9024, 'InputManager::GetButtonDown'], // (int action)
  button: [105449, 'InputManager::GetButton'], // (int action): held
  axis: [105456, 'InputManager::GetAxis'], // (int action) → float
  playerIkLateUpdate: [103257, 'PlayerIK::LateUpdate'], // Engine-invoked for every player, after the Animator.
  // (sret AnimatorStateInfo*, layer)
  animatorStateInfo: [124100, 'UnityEngine.Animator::GetCurrentAnimatorStateInfo'],
  animatorLayerCount: [124094, 'UnityEngine.Animator::get_layerCount'],
  animatorLayerName: [124095, 'UnityEngine.Animator::GetLayerName'], // (int layer)
  animatorInTransition: [124112, 'UnityEngine.Animator::IsInTransition'], // (int layer)
  rewiredLateUpdate: [62095, 'Rewired.InputManager_Base::LateUpdate'], // Unity message (f35174): menu and match.
} as const;

/** TypeInfo cells (metadata usage 1): [cell, recovered type]. */
export const typeInfos = {
  BuildingNetworkController: [0xac1174, 'BuildingNetworkController'],
  ProjectileManager: [0xac59ec, 'JustPlay.Projectiles.ProjectileManager'],
  Layer: [0xac4494, 'Layer'],
  Texture2D: [0xac6d60, 'UnityEngine.Texture2D'],
  Material: [0xac4994, 'UnityEngine.Material'],
  HitInfo: [0xac2d80, 'HitInfo'],
} as const;

/** MethodInfo cells, resolved at runtime through slot.initMetadata: [cell, recovered method]. */
export const methodInfos = {
  championMapAdd: [0xad1314, 'System.Collections.Generic.Dictionary`2<string, JustPlay.Champions.ChampionData>::Add'],
  skinPackDictAdd: [0xad17f8, 'System.Collections.Generic.Dictionary`2<string, LocalSkinPackProductData>::Add'],
} as const;

export const stringLiterals = {} as const;
export const virtualSlots = {} as const;

/** Metadata literal constants: [value, recovered constant]. */
export const literals = {
  dontUnloadUnusedAsset: [32, 'UnityEngine.HideFlags::DontUnloadUnusedAsset'],
  jumpAction: [0, 'RewiredConsts.Action::Jump'],
  aimAction: [19, 'RewiredConsts.Action::Aim'],
  monoEye: [2, 'MonoOrStereoscopicEye::Mono'],
  ability1Action: [52, 'RewiredConsts.Action::Ability1'],
  horizontalAction: [14, 'RewiredConsts.Action::Horizontal'],
  verticalAction: [15, 'RewiredConsts.Action::Vertical'],
  rpcAll: [0, 'Photon.Pun.RpcTarget::All'],
  shootAction: [18, 'RewiredConsts.Action::Shoot'],
  stopEmitting: [1, 'UnityEngine.ParticleSystemStopBehavior::StopEmitting'],
  stretchParticles: [1, 'UnityEngine.ParticleSystemRenderMode::Stretch'],
  positionAttribute: [0, 'UnityEngine.Rendering.VertexAttribute::Position'],
  normalAttribute: [1, 'UnityEngine.Rendering.VertexAttribute::Normal'],
  float32Format: [0, 'UnityEngine.Rendering.VertexAttributeFormat::Float32'],
} as const;

/** Instance field offsets by type, as in the core map. */
export const fields = {
  Champions: { _championsMap: 20 },
  ChampionData: { ActiveAbility: 24 },
  Ability: { ID: 12, dataPerLevel: 24 },
  DashLevelData: { Cooldown: 0, MaxStock: 12, ReuseDelayTime: 16 },
  HitInfo: { DamageSourceID: 12, DamagerPos: 48, Damage: 92 },
  AquaCannonLevelData: { Cooldown: 0, Duration: 4, ChargeTime: 8, FireRate: 12, NonPlayerHitRadius: 16,
    PlayerHitRadius: 20, MaxDistance: 24, DpsPercentage: 28, BuildingsFlatDamage: 32 },
  AquaCannonBehaviour: { _isFiring: 16, _player: 20, _abilityLevelData: 28, _raycastHits: 92, _lastHit: 96,
    _aquaCannonHitPlayers: 140, _aquaCannonHitPlayersLength: 144, _aquaCannonVfxInstance: 148,
    _laserLengthController: 152, _wasCannonStoppedByObstacle: 160, _currentDirection: 176, _currentOriginPoint: 188 },
  RaycastHit: { m_Distance: 28 },
  BarrierShockwaveAbility: { BarrierHeightOffset: 36 },
  BarrierShockwaveLevelData: { Duration: 4 },
  BarrierShockwaveBehaviour: { _barrierVFX: 24, _barrierColliders: 36, _owner: 56, _hitCount: 108 },
  // A barrier's [PlayerId, timestamp (double), ability ID] from BarrierShockwaveAbility.Perform (f42048).
  PhotonView: { instantiationDataField: 24 },
  HomingProjectileLockOnEvent: { TargetID: 0 },
  LaserLengthController: { _particlesToStretch: 16, _endPointParticle: 20 },
  PlayerCheatsMonitor: { _cheatDetectors: 16 },
  Particle: { m_StartSize: 84 }, // UnityEngine.ParticleSystem.Particle
  LocalProductsData: { _skinPackDict: 132 },
  WeaponStats: { Range: 36, EquipDelay: 40 },
  PlayerController: { CheatsMonitor: 64, ThirdPersonInput: 68, PlayerIK: 72, _thirdPersonController: 96,
    _playerSkinManager: 128, _playerAbilities: 148, _lastGroundedYPosition: 176, _centerHeightOffset: 216 },
  vThirdPersonMotor: { jumpTimer: 68, jumpCounter: 76, channelSpeedMultiplier: 348, generalSpeedMultiplier: 352,
    _isGrounded: 448, isJumping: 449, Rigidbody: 508, _capsuleCollider: 512, colliderHeight: 532 },
  vThirdPersonController: { _legsCollider: 620 },
  vThirdPersonInput: { _tpCamera: 40 },
  vThirdPersonCamera: { targetHeight: 184 },
  PlayerIK: { IsIKEnabled: 24, _skinManager: 48 },
  PlayerSkinManager: { CurrSkinID: 32, _currBody: 44, _animator: 56, _playerController: 60, _curSkinPack: 96 },
  SkinPack: { PlayerColliders: 52, AnimatorController: 56, MenuAnimatorController: 60 },
  PlayerSkinPart: { PartName: 16, Renderers: 32 },
  PlayerAbilities: { _activeAbilities: 56 },
  PlayerAbilitySlot: { Ability: 12, CurrentCooldown: 16, IsActivated: 24 },
  ChampionSelectionScreen: { _championCards: 16 },
  ChampionOverviewScreen: { _activeAbilityDisplay: 32, _selectedChampion: 80 },
  ChampionCard: { _championInfoDisplay: 16, _champion: 60 },
  ChampionInfoDisplay: { _championIcon: 16, _productData: 36 },
  ChampionAbilityDisplay: { _icon: 20 },
  AbilitySlotUI: { _abilityImage: 24, _abilitySlot: 120 },
  KillFeedItem: { _firstIconImage: 32, _secondIconImage: 36 },
  WeaponsController: { TimeSinceAttacked: 108, HitLayerMask: 112, _buildingsLayerMask: 136, _otherHitsLayerMask: 144,
    _animator: 188, _isAiming: 222, _equipDelayTimeLeft: 244, _shortPressTime: 268 },
  MeleeWeaponModel: { _mainHandTransform: 752 },
  Building: { IsStatic: 22, ID: 192, _isDestroySignaled: 209 },
  RoyalDecreeUXData: { SoldierPrefab: 28 },
  CombustUXData: { CombustAuraPrefab: 28 },
  BuildingNetworkController: { _buildingsIdMapping: 48 },
} as const;

/** Static-field offsets (the class static_fields block). */
export const staticFields = {
  PlayerBuildingManager: { sizeY: 8 }, // sizeY: grid height (3.5, .cctor f45037).
  BuildingNetworkController: { Instance: 0 },
  ProjectileManager: { _instance: 12 },
  Layer: { PlayerNoCollision: 16 }, // Read by <Initialize>d__29 (f42073) for a teammate's barrier.
} as const;

/** IL2CPP wasm32 runtime layouts. */
export const runtimes = {
  boxedValue: 8, // A boxed value type's fields follow the object header (klass, monitor).
  nullableValue: 4, // Confirmed: Nullable`1<float>::get_Value f157418 checks hasValue at +0 and reads value at +4.
} as const;

type Merged<A, B> = { readonly [K in keyof A | keyof B]: (K extends keyof A ? A[K] : unknown) &
  (K extends keyof B ? B[K] : unknown) };
/** Core field tables with the hero keys added, type by type. */
const merge = <A extends object, B extends object>(a: A, b: B) => Object.fromEntries(
  [...new Set([...Object.keys(a), ...Object.keys(b)])].map(type =>
    [type, { ...(a as Record<string, object>)[type], ...(b as Record<string, object>)[type] }])) as Merged<A, B>;

export const slot = { ...core.slot, ...core.values(slots) };
export const typeInfo = { ...core.typeInfo, ...core.values(typeInfos) };
export const methodInfo = { ...core.methodInfo, ...core.values(methodInfos) };
export const literal = { ...core.literal, ...core.values(literals) };
export const field = merge(core.field, fields);
export const staticField = merge(core.staticField, staticFields);
export const runtime = { ...core.runtime, ...runtimes };
