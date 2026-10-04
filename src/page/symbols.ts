// Map of the original client as used by the local page: WASM 52b3dc8a…, IL2CPP metadata v31
// (docs/reference/il2cpp.md explains slots, cells and layouts).
// Every entry is checked against re/data/il2cpp (via re/lib) by tests/unit/symbols.test.ts.
// A label is the recovered name; `f<index>` marks a slot no metadata row pins (shared generic or runtime code),
// verified through wasm-elements.tsv — its meaning then comes from the MethodInfo passed with it.
// Entries only the custom heroes use live in heroes/page/symbols.ts, in the same shape.

export type Table = Record<string, readonly [number, string]>;
export const values = <T extends Table>(table: T) =>
  Object.fromEntries(Object.entries(table).map(([key, [value]]) => [key, value])) as {
    readonly [K in keyof T]: T[K][0] };

/** Function-table slots called or hooked by the page: [slot, recovered method]. */
export const slots = {
  objectNew: [1908, 'f1679'], // Inferred: allocates an instance of the class argument.
  initMetadata: [1916, 'f1964'], // Confirmed (f1644): decodes a metadata-usage cell and writes the
    // resolved pointer back.
  gcHandleAlloc: [22606, 'System.Runtime.InteropServices.GCHandle::Alloc'],
  gcHandleFree: [6213, 'System.Runtime.InteropServices.GCHandle::Free'],
  objectAlive: [8060, 'UnityEngine.Object::op_Implicit'],
  componentGameObject: [7058, 'UnityEngine.Component::get_gameObject'],
  componentTransform: [7046, 'UnityEngine.Component::get_transform'],
  gameObjectTransform: [8310, 'UnityEngine.GameObject::get_transform'],
  gameObjectSetActive: [8088, 'UnityEngine.GameObject::SetActive'],
  gameObjectActiveSelf: [8089, 'UnityEngine.GameObject::get_activeSelf'],
  gameObjectActiveInHierarchy: [9132, 'UnityEngine.GameObject::get_activeInHierarchy'],
  behaviourActiveAndEnabled: [17760, 'UnityEngine.Behaviour::get_isActiveAndEnabled'],
  transformPosition: [128089, 'UnityEngine.Transform::get_position_Injected'],
  transformSetParent: [8804, 'UnityEngine.Transform::SetParent'],
  transformForward: [8082, 'UnityEngine.Transform::get_forward'],
  cameraMain: [25439, 'UnityEngine.Camera::get_main'],
  getActiveScene: [128385, 'UnityEngine.SceneManagement.SceneManager::GetActiveScene'],
  sceneBuildIndex: [128370, 'UnityEngine.SceneManagement.Scene::get_buildIndex'],
  sceneName: [128368, 'UnityEngine.SceneManagement.Scene::get_name'],
  loadSceneAsync: [128399, 'UnityEngine.SceneManagement.SceneManager::LoadSceneAsync'],
  applicationVersion: [20262, 'UnityEngine.Application::get_version'],
  spriteTexture: [19945, 'UnityEngine.Sprite::get_texture'],
  imageActiveSprite: [140984, 'UnityEngine.UI.Image::get_activeSprite'],
  meshFilterSharedMesh: [126182, 'UnityEngine.MeshFilter::get_sharedMesh'],
  rendererSharedMaterials: [9912, 'UnityEngine.Renderer::get_sharedMaterials'],
  currentRoom: [8293, 'Photon.Pun.PhotonNetwork::get_CurrentRoom'],
  isConnected: [9775, 'Photon.Pun.PhotonNetwork::get_IsConnected'],
  connectedAndReady: [9770, 'Photon.Pun.PhotonNetwork::get_IsConnectedAndReady'],
  inRoom: [9774, 'Photon.Pun.PhotonNetwork::get_InRoom'],
  networkClientState: [8285, 'Photon.Pun.PhotonNetwork::get_NetworkClientState'],
  isMasterClient: [9321, 'Photon.Pun.PhotonNetwork::get_IsMasterClient'],
  networkAvailable: [9776, 'NetworkManager::IsNetworkAvailable'],
  offlineModes: [108133, 'ModesMenuSettings::GetOfflineModes'],
  offlineMode: [51290, 'Photon.Pun.PhotonNetwork::get_OfflineMode'],
  modeInfo: [8262, 'GameModeManager::get_ModeInfo'],
  gameHasStarted: [9952, 'Assets.Scripts.GameManager::get_HasGameStarted'],
  inputAxis: [105457, 'InputManager::GetAxisRaw'],
  playerMine: [107271, 'PlayerController::get_Mine'],
  uiManagerInstance: [106396, 'UiManager::get_Instance'],
  uiLoaderActive: [106398, 'UiManager::get_IsLoaderActive'],
  showLoadoutScreen: [106428, 'UiManager::ShowLoadoutScreen'],
  serverUserCtor: [20289, 'ServerUser::.ctor'],
  setServerUser: [104038, 'FirebaseManager::SetServerUser'],
  guestUid: [104046, 'FirebaseManager::GetGuestUID'],
  setGeneralDataId: [104099, 'GeneralDataModel::set_ID'],
  setNickname: [104101, 'GeneralDataModel::set_Nickname'],
  cachedNickname: [20129, 'ProfilePanelHandler::GetCachedNickname'],
  saveNickname: [22925, 'ProfilePanelHandler::SaveNicknameToCache'],
  nicknamesInstance: [10948, 'NicknamesGenerator::get_Instance'],
  generatedNickname: [10949, 'NicknamesGenerator::GeneratedNickname'],
  switchToProfileScreen: [110597, 'ProfilePanelHandler::SwitchToProfileScreen'],
  startEditName: [110593, 'ProfilePanelHandler::StartEditName'],
  endNameEdit: [110595, 'ProfilePanelHandler::OnEndNameEdit'],
  updatePhotonInfo: [22928, 'Assets.Scripts.Network.Connector::UpdatePhotonInfo'],
  tmpText: [153284, 'TMPro.TMP_Text::get_text'],
  championsInstance: [120092, 'JustPlay.Champions.Champions::get__instance'],
  defaultChampion: [112906, 'Lol.OneVsOne.Settings.GameProperties::get_DefaultChampion'],
  startingDefaultSkin: [112903, 'Lol.OneVsOne.Settings.GameProperties::get_StartingDefaultSkin'],
  addChampion: [32820, 'UserChampions::AddChampion'],
  equipChampion: [9926, 'UserChampions::EquipChampion'],
  isChampionOwned: [104255, 'UserChampions::IsChampionOwned'],
  championProducts: [107710, 'ChampionProductDataFactory::GetAllProducts'],
  soInstance: [7984, 'f136822'],
  getSkin: [9978, 'SkinProductDataFactory::GetSkin'],
  skinProductCtor: [10100, 'SkinProductData::.ctor'],
  dictionaryAdd: [4947, 'f156650'],
  dictionaryCtor: [4860, 'f4752'], // Confirmed: shared ctor UserEquipment::.ctor (f97416) calls with a MethodInfo.
  dictionaryContains: [6251, 'f4813'],
  dictionaryGet: [7802, 'f4878'],
  getWeaponSkin: [9900, 'WeaponSkinsDataFactory::GetWeaponSkin'],
  weaponSkinProductCtor: [10108, 'WeaponSkinProductData::.ctor'],
  weaponSkinOwned: [107648, 'WeaponSkinProductData::IsOwned'],
  getWeaponSkinsPrefabs: [108077, 'LocalProductsData::GetWeaponSkinsPrefabsDict'],
  weaponSkinPrefab: [24101, 'f107088'],
  tryGetEquipmentData: [10042, 'EquipmentStatsFactory::TryGetEquipmentData'],
  getEmote: [107729, 'EmoteProductDataFactory::GetEmote'],
  emoteProductCtor: [10040, 'EmoteProductData::.ctor'],
  emoteOwned: [107597, 'EmoteProductData::IsOwned'],
  offlineEmoteCount: [112902, 'Lol.OneVsOne.Settings.GameProperties::get_DefaultOfflineEmotesNumber'],
  listCtor: [4806, 'f7641'],
  stringFromAnsi: [163224, 'System.Runtime.InteropServices.Marshal::PtrToStringAnsi'],
  jsonDeserialize: [8886, 'f143688'],
  typeGetType: [157970, 'System.Type::GetType'],
  createInstance: [1919, 'System.Activator::CreateInstance'],
  objectName: [7049, 'UnityEngine.Object::get_name'],
  validateScreen: [10980, 'ScreenSwitchHandler::ValidateCanMoveToScreen'],
  upgradeItem: [28534, 'UserEquipment::UpgradeItem'],
  championDataTryGet: [2210, 'f4891'],
  setChampionLevel: [104258, 'UserChampionData::set_Level'],
  championLevel: [104251, 'UserChampions::GetChampionLevel'],
  listAdd: [3044, 'f8902'],
  findObjectsOfType: [127684, 'UnityEngine.Object::FindObjectsOfType'],
  addressablesInstance: [120421, 'JustPlay.Addressables.AddressablesHandler::get_Instance'],
  addressablesInit: [9567, 'JustPlay.Addressables.AddressablesHandler::Init'],
  downloadRequiredData: [9569, 'JustPlay.Addressables.AddressablesHandler::DownloadAllRequiredData'],
  refreshCatalogs: [10602, 'JustPlay.Addressables.AddressablesHandler::RefreshCatalogs'],
  completedTask: [159770, 'System.Threading.Tasks.Task::get_CompletedTask'],
  taskSucceeded: [159763, 'System.Threading.Tasks.Task::get_IsCompletedSuccessfully'],
  setDidInit: [120426, 'JustPlay.Addressables.AddressablesHandler::set_DidInit'],
  uiManagerStart: [106401, 'UiManager::Start'],
  offlineJoinMode: [104612, 'OfflineGameModeConnector::JoinMode'],
  connectToPhoton: [105566, 'AppInitializer::ConnectToPhoton'],
  setDisconnectTimeout: [49981, 'ExitGames.Client.Photon.PhotonPeer::set_DisconnectTimeout'],
  roomName: [51074, 'Photon.Realtime.Room::get_Name'],
  connectorInstance: [113385, 'Assets.Scripts.Network.Connector::get_Instance'],
  onPlayerDataChanged: [8660, 'Assets.Scripts.Network.Connector::OnPlayerDataChanged'],
  productFactoryInstance: [7988, 'f152009'],
  factoryAllProducts: [107737, 'EquipmentProductDataFactory::GetAllEquipmentProducts'],
  tryGetEquipmentProduct: [8746, 'EquipmentProductDataFactory::TryGetEquipmentProduct'],
  addItem: [32819, 'UserEquipment::AddItem'],
  doesItemExist: [8765, 'UserEquipment::DoesItemExistInEquipment'],
  getItemLevel: [8767, 'UserEquipment::GetItemLevel'],
  editOnRelease: [110403, 'SettingsPanel::OnEditOnRelease'],
  resetEditWithoutConfirm: [110404, 'SettingsPanel::OnResetEditWithoutConfirm'],
  scrollWheelReset: [110405, 'SettingsPanel::OnScrollWheelReset'],
} as const;
export const slot = values(slots);

/** TypeInfo cells (metadata usage 1): [cell, recovered type]. */
export const typeInfos = {
  AppInitializer: [0xac09f8, 'AppInitializer'],
  LoadingScreenManager: [0xac4624, 'LoadingScreenManager'],
  UiManager: [0xac7268, 'UiManager'],
  FirebaseManager: [0xac27f4, 'FirebaseManager'],
  FirebaseConfigHandler: [0xac27c4, 'FirebaseConfigHandler'],
  ServerUser: [0xac6420, 'ServerUser'],
  SkinProductData: [0xac656c, 'SkinProductData'],
  WeaponSkinProductData: [0xac7828, 'WeaponSkinProductData'],
  EmoteProductData: [0xac2234, 'EmoteProductData'],
  WeaponSkinProductList: [0xabf0cc, 'System.Collections.Generic.List`1<WeaponSkinProductData>'],
  StringList: [0xabef78, 'System.Collections.Generic.List`1<string>'],
  UserEquipment: [0xac7514, 'UserEquipment'],
  UpgradeableItems: [0xabbd54, 'System.Collections.Generic.Dictionary`2<string, UserUpgradeableItem>'],
  EquipmentProductData: [0xac2350, 'EquipmentProductData'],
  PlayerController: [0xac56f8, 'PlayerController'],
  PhotonNetwork: [0xac55ac, 'Photon.Pun.PhotonNetwork'],
  PlayersManager: [0xac575c, 'PlayersManager'],
  ResultScreenManager: [0xac5ff4, 'ResultScreenManager'],
  ModesMenuSettings: [0xac4cd0, 'ModesMenuSettings'],
  CheaterSettingsHandler:
    [0xaba930, 'AFirebaseSettingsHandler`1<Assets.Scripts.Login.FirebaseConfig.FirebaseCheaterSettingsData>'],
  GameModesHandler: [0xaba944, 'AFirebaseSettingsHandler`1<FirebaseGameModesData>'],
  PartyInfo: [0xac54e8, 'PartyInfo'],
  ChoiceWheelManager: [0xac1420, 'ChoiceWheelManager'],
  PlayerBuildingManager: [0xac56e0, 'PlayerBuildingManager'],
  GameManager: [0xac2a28, 'Assets.Scripts.GameManager'],
  InputManager: [0xac3f0c, 'InputManager'],
  SettingsPanel: [0xac6484, 'SettingsPanel'],
  EquipmentProductList: [0xabea2c, 'System.Collections.Generic.List`1<EquipmentProductData>'],
  String: [0xac6920, 'string'],
} as const;
export const typeInfo = values(typeInfos);

/** The List`1<WeaponSkinProductData> values of Dictionary`2<string, …>, whose method labels pass 120 columns. */
const SKINS_PER_WEAPON = 'System.Collections.Generic.Dictionary`2<string, ' +
  'System.Collections.Generic.List`1<WeaponSkinProductData>>';

/** MethodInfo cells, resolved at runtime through slot.initMetadata: [cell, recovered method]. */
export const methodInfos = {
  productFactoryInstance:
    [0xad4b70, 'JustPlay.ScriptableObjects.FactoryManagedInstance`1<EquipmentProductDataFactory>::get_Instance'],
  championFactoryInstance:
    [0xad4b50, 'JustPlay.ScriptableObjects.FactoryManagedInstance`1<ChampionProductDataFactory>::get_Instance'],
  skinFactoryInstance:
    [0xad4bb4, 'JustPlay.ScriptableObjects.FactoryManagedInstance`1<SkinProductDataFactory>::get_Instance'],
  localProductsInstance: [0xadb9f4, 'JustPlay.ScriptableObjects.SOManagedInstance`1<LocalProductsData>::get_Instance'],
  skinDictionaryAdd: [0xad1b8c, 'System.Collections.Generic.Dictionary`2<string, SkinProductData>::Add'],
  jsonDictionary: [0xae8a24, 'Newtonsoft.Json.JsonConvert::DeserializeObject<' +
    'System.Collections.Generic.Dictionary`2<string, string>>'],
  championDataTryGet: [0xad1cec, 'System.Collections.Generic.Dictionary`2<string, UserChampionData>::TryGetValue'],
  stringListAdd: [0xad8a3c, 'System.Collections.Generic.List`1<string>::Add'],
  stringListCtor: [0xad8a30, 'System.Collections.Generic.List`1<string>::.ctor'],
  weaponSkinsFactory:
    [0xad4bc4, 'JustPlay.ScriptableObjects.FactoryManagedInstance`1<WeaponSkinsDataFactory>::get_Instance'],
  equipmentStatsFactory:
    [0xad4b84, 'JustPlay.ScriptableObjects.FactoryManagedInstance`1<EquipmentStatsFactory>::get_Instance'],
  emoteFactory:
    [0xad4b68, 'JustPlay.ScriptableObjects.FactoryManagedInstance`1<EmoteProductDataFactory>::get_Instance'],
  weaponSkinPrefab: [0xae4ca4, 'DictionaryExtensions::GetValueOrDefault<WeaponSkinType, WeaponSkinManager>'],
  weaponSkinAdd: [0xad1e14, 'System.Collections.Generic.Dictionary`2<string, WeaponSkinProductData>::Add'],
  skinsPerWeaponContains: [0xad1104, `${SKINS_PER_WEAPON}::ContainsKey`],
  skinsPerWeaponAdd: [0xad1100, `${SKINS_PER_WEAPON}::Add`],
  skinsPerWeaponGet: [0xad110c, `${SKINS_PER_WEAPON}::get_Item`],
  weaponSkinListCtor: [0xad92d8, 'System.Collections.Generic.List`1<WeaponSkinProductData>::.ctor'],
  weaponSkinListAdd: [0xad92dc, 'System.Collections.Generic.List`1<WeaponSkinProductData>::Add'],
  emoteAdd: [0xad144c, 'System.Collections.Generic.Dictionary`2<string, EmoteProductData>::Add'],
  upgradeableItemsCtor: [0xad1d44, 'System.Collections.Generic.Dictionary`2<string, UserUpgradeableItem>::.ctor'],
  loadingOnInitRemoteConfig: [0xae9438, 'LoadingScreenManager::OnInitRemoteConfig'],
  modesPropertiesInstance: [0xadba14, 'JustPlay.ScriptableObjects.SOManagedInstance`1<ModesProperties>::get_Instance'],
} as const;
export const methodInfo = values(methodInfos);

/** StringLiteral cells (metadata usage 5), resolved at runtime through slot.initMetadata: [cell, literal]. */
export const stringLiterals = {
  baseWebUrl: [0xb0ad0c, '"https://1v1.lol/"'], // ApiUrls::get_BaseWebUrl (f98031).
} as const;
export const stringLiteral = values(stringLiterals);

/** Managed virtual (vtable) slots called through native.callVirtual: [slot, recovered method]. */
export const virtualSlots = {
  settingsHandlerInit: [4, 'AFirebaseSettingsHandler::Init'],
  levelCap: [6, 'JustPlay.Equipment.EquipmentBaseData::get_LevelCap'],
} as const;
export const vslot = values(virtualSlots);

/** Metadata literal constants: [value, recovered constant]. */
export const literals = {
  championMaxLevel: [10, 'JustPlay.Champions.Champions::MAX_LEVEL'],
  meleeSkin: [1, 'WeaponSkinType::Melee'],
  danceEmote: [0, 'EmoteType::Dance'],
} as const;
export const literal = values(literals);

/**
 * Instance field offsets by type, keyed by recovered field name (backing fields by property name).
 * Value-type fields are unboxed (DB offset − 8).
 */
export const field = {
  UnityObject: { m_CachedPtr: 8 },
  Delegate: { m_target: 16, method: 20 },
  MulticastDelegate: { delegates: 60 },
  LoadingScreenManager: { _loadingJobs: 72, _completedLoadingJobsCount: 112 },
  UiManager: { _loaderUI: 16, _switchHandler: 20, _loadoutScreen: 44, _friendlyBattleUI: 48 },
  ScreenSwitchHandler: { _currScreen: 52 },
  MenuScreen: { ScreenNameState: 12 }, // ScreenName enum: Loadout = 15.
  ModeInfo: { ModeName: 12, _scenePool: 24, IsOffline: 28, IsCustomGame: 29, MinPlayers: 40, MaxPlayers: 41,
    _usesLoadout: 96 },
  ModesProperties: { _modesInfo: 12 },
  ModeUI: { ModeName: 8, LayoutType: 28 },
  LoadBalancingClient: { LoadBalancingPeer: 8 },
  Room: { players: 60 },
  'Photon.Realtime.Player': { nickName: 36 },
  'JustPlay.AgeGate.AgeLimitedFeaturePopup': { _featureToAccess: 28 },
  PhotonPeer: { disconnectTimeout: 92 },
  PartyFriendlyBattleUI: { _friendlyBattleToggleContainer: 20, _friendlyBattleOptionsContainer: 24 },
  FirebaseCheaterSettingsData: { FlyingConfig: 12 },
  FirebaseGameModesData: { CustomModes: 24 },
  ModeMenuManager: { _customModeButtons: 92 },
  ModeButtonCategory: { LargeButtons: 0, MediumButtons: 4, SmallButtons: 8 },
  FirebaseManager: { _serverUser: 64 },
  ServerUser: { GeneralData: 8, Equipment: 28, Skins: 56, Champions: 76 },
  GeneralDataModel: { ID: 8, Nickname: 12, AgeGate: 72 },
  AgeGateData: { IsUnderage: 8 },
  UserChampions: { OwnedChampions: 8, _selectedChampion: 16 },
  ServerSkinsEntry: { CharacterSkins: 8, WeaponSkins: 12, EquippedWeaponSkins: 24, OwnedEmotes: 28,
    EquippedEmotes: 32 },
  OnClickScreenSwitcher: { _screenToSwitchTo: 16 },
  AddressablesHandler: { DidDownloadRequiredData: 16, DidInit: 17 },
  Champions: { _championsData: 12 },
  ChampionData: { ID: 12 },
  LocalProductsData: { _skinPackProducts: 36, _emotes: 40, _weaponSkinsProducts: 44 },
  LocalProductData: { Id: 8 },
  LocalWeaponSkinProductData: { WeaponID: 32 },
  LocalEmoteProductData: { Type: 28 },
  SkinProductDataFactory: { _skinProductsData: 8 },
  WeaponSkinsDataFactory: { _weaponSkinsProductData: 8, _skinsPerWeapon: 16 },
  WeaponSkinProductData: { WeaponType: 104, WeaponID: 112 },
  WeaponSkinRemoteProductData: { WeaponType: 120 },
  WeaponSkinManager: { CurrentSkin: 16, EquippedWeaponSkin: 20, _weaponSkinPacks: 28, _weaponSkinType: 32 },
  WeaponSkinPack: { _weaponSkinID: 28 },
  EmoteProductDataFactory: { _emoteProductsData: 8 },
  UserUpgradeableItem: { Level: 8 },
  UserEquipment: { MaxHealth: 12, MaxArmor: 16, Equipment: 20, EquippedLoadout: 28, AvailableArmorSlots: 36,
    AvailableWeaponSlots: 40, Loadouts: 44 },
  Loadout: { EquippedArmor: 12, EquippedWeapons: 16 },
  ProductData: { Id: 8, Rarity: 64 },
  EquipmentProductData: { Type: 96, BaseData: 100, BaseLevel: 108 },
  EquipmentBaseData: { Id: 12, BaseRarity: 24, BasePowerScore: 32, _loadedAssets: 40 },
  WeaponBaseData: { Stats: 52 },
  WeaponStats: { ZoomSettings: 256 },
  CameraZoomSettings: { HasScope: 0, ScopeType: 4, FieldOfView: 8 },
  EquipmentGraphicData: { ID: 12, Prefab: 16, Mesh: 20, Materials: 24 },
  LoadoutScreen: { SlotPickedFrom: 28, CurrentScreenCategory: 32, SelectedEquipment: 36, _inventoryDisplay: 40,
    _itemPopup: 48, _serverRequestTasks: 104, _lastViewedItem: 108, _serverRequestInProgress: 116 },
  LoadoutInventoryDisplay: { CurrentCategory: 16, _scrollItemList: 20 },
  LoadoutItemScroller: { _ownedItemsList: 32, _notFoundItemsList: 44, _lockedItemsList: 56 },
  LoadoutItemList: { _loadoutItemRows: 16, _nextItemIndex: 20 },
  LoadoutItemRow: { _loadoutItems: 16 },
  LoadoutItem: { ItemDisplayed: 16, _itemImage: 52 },
  LoadoutItemPopup: { _equipment3DRender: 40, _skinsListDisplay: 104, _itemDisplayed: 244 },
  WeaponSkinListDisplay: { _weaponSkinItems: 24, _skinSelected: 60 },
  WeaponSkinItemDisplay: { _selectedFrame: 28, _lockedState: 48, _skinDisplayed: 64 },
  ChoiceWheelManager: { IsShowing: 16, _wheelOptions: 20, _didInit: 65, _lastId: 84 },
  WheelOption: { _id: 36 },
  EmoteManager: { _isPlaying: 65, _currAnimationId: 72 },
  Equipment3DRender: { _itemSprite: 20, _itemRawImage: 24, _itemMeshContainer: 28, _itemMeshRenderer: 32,
    _itemMeshFilter: 36, _loadingImage: 40 },
  PlayerController: { currentState: 56, _weaponsController: 116, _health: 136, _emoteManager: 156, _isFrozen: 172,
    _initialized: 174, _isDead: 175 },
  XPBoostUIManager: { _containerGO: 16 },
  PlayerHealth: { _currentHealth: 184, _currentArmor: 200 },
  PlayersManager: { _playerInfos: 52, _allPlayers: 68 },
  InGamePlayerInfo: { Nickname: 40 },
  ResultScreenManager: { _activeResultScreen: 204, _matchResultInfo: 208 },
  MatchResultInfo: { Winners: 0, IsTie: 4, PlayersCount: 24 },
  ObscuredInt: { currentCryptoKey: 0, hiddenValue: 4, inited: 13 },
  WeaponsController: { CurrentWeapon: 84, IsHoldingWeapon: 88, _weaponSlots: 196, _prevEquippedWeaponIndex: 200,
    _currentEquippedWeaponIndex: 204, _didInitialize: 240 },
  WeaponModel: { BaseData: 16, Stats: 20, _skinManager: 644, _defaultID: 664, _weaponLevel: 668,
    _currentMagazine: 692, _currentAmmo: 708 },
  PlayerBuildingManager: { state: 300, editingManager: 332 },
  EditingManager: { _currentEditingObject: 16 },
  Building: { MaxHealth: 32, Health: 36, OriginalShapeState: 52, Toggleables: 112 },
  BuildingShapeState: { ChildIndex: 8 },
  ToggleableBuildingPart: { isToggled: 76 },
  PartyPlayer: { _playerName: 72 },
} as const;

/** Static-field offsets (the class static_fields block). */
export const staticField = {
  AppInitializer: { OnInitRemoteConfig: 0, IsInitializing: 17 },
  FirebaseConfigHandler: { _firebaseSettingsHandlers: 20 },
  FirebaseManager: { Instance: 20 },
  PartyInfo: { PartyRoomName: 8, PartyId: 12, PartyLeader: 16, IsTemporaryParty: 20, IsFriendlyBattle: 21 },
  PlayerController: { Mine: 0 },
  PhotonNetwork: { NetworkingClient: 8 },
  PlayersManager: { Instance: 0 },
  ResultScreenManager: { Instance: 0 },
  ModesMenuSettings: { _modeDictionary: 0 },
  ChoiceWheelManager: { Instance: 0 },
  PlayerBuildingManager: { Instance: 0 },
  GameManager: { IsPaused: 8, CurrentState: 12 },
  InputManager: { PlayerInput: 0 },
  SettingsPanel: { EditOnRelease: 5, ResetEditWithoutConfirm: 6, ScrollWheelReset: 7 },
} as const;

/** IL2CPP wasm32 runtime layouts (not metadata fields; generic definitions carry no offsets). */
export const runtime = {
  queueSize: 20, // Inferred: Queue`1 over references lays out _array, _head, _tail, _size after the 8-byte header.
  assetResponseAsset: 8, // Confirmed: AssetResponse<T> ctor f153296@0x30b5e8d stores Asset at +8 (handle at +12).
  // Confirmed: Il2CppClass vtable of VirtualInvokeData {methodPtr, method} at klass+192: slot 4 at +224/+228
  // (FirebaseConfigHandler.ActivateRemoteConfig f98131@0x205717b), slot 6 at +240/+244
  // (IsItemMaxLevel f97484@0x2013096).
  vtable: 192,
  klassName: 8,
  klassStaticFields: 92,
  stringLength: 8,
  stringChars: 12,
  arrayLength: 12,
  arrayData: 16,
  listItems: 8,
  listSize: 12,
  listVersion: 16,
  // Confirmed: Dictionary`2<int, PlayerController>::TryGetValue f155836 reads _entries at +12 and entry i's value
  // at +16 + 16i + 12; FindEntry f155823 reads _buckets +8, _comparer +32 (so _count +16).
  // Entry: hashCode, next, key, value.
  dictionaryEntries: 12,
  dictionaryCount: 16,
  dictionaryEntry: 16,
  // Confirmed: AFirebaseSettingsHandler<T> statics in declaration order; consumers read Data at +8 and
  // IsDataAvailable at +12 (GameManager::SetGameStartTime f45926, FlyingCheatDetector::GetMaxFlyingTime f51356).
  settingsData: 8,
  settingsAvailable: 12,
} as const;
