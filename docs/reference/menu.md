# Menu

The original MainMenu scene: how screens open, what the lobby shows, the loadout, champion and Locker screens, the mode menu, nicknames and deep links. Notation follows the [conventions](il2cpp.md#conventions).

## Screens

`UiManager.get_Instance` (f52078, slot 106396) returns the scene's manager, whose `Start` runs on every MainMenu load. `ScreenSwitchHandler` switches the screens:

- `SwitchScreen(ScreenName, skipScreenValidation, analyticExtraIdentifier)` (`<SwitchScreen>d__25`, f53193) calls `InitScreens` (f53176) if `_didInitialize` (+68) is false, then `ValidateCanMoveToScreen` (f53188, slot 10980). When validation passes, it stores the screen's `MenuScreen` at `_currScreen` (+52) and activates it.
- `ValidateCanMoveToScreen` refuses the current screen, a name missing from `_screensDict` (+56), and any screen whose `MenuScreen.ScreenFeatureRequirements` (+32) fail `LimitedFeaturesManager.ValidateFeature` (see [boot.md](boot.md#age-gate-and-limited-features)). A refusal logs "ScreenSwitchHandler:ValidateCanMoveToScreen: Failed to move to screen <name> because of <reason>".
- `UiManager.ShowLoadoutScreen(category)` (f52125, slot 106428) sets the starting category and switches to Loadout without skipping validation.

Tabs and buttons carry an `OnClickScreenSwitcher` that holds their destination in `_screenToSwitchTo`.

### ScreenName

`ScreenName` (type 2064) declares 38 values. Each value is its member's metadata default (fields 10717 to 10754).

| Value | Name | Value | Name | Value | Name |
|---:|---|---:|---|---:|---|
| 0 | Lobby | 13 | GeneralItemPreview | 26 | ChooseDefaultSkin |
| 1 | Profile | 14 | Quests | 27 | PracticeBattle |
| 2 | Settings | 15 | Loadout | 28 | EnterName |
| 3 | Locker | 16 | EquipmentEquipSelection | 29 | Leaderboards |
| 4 | Shop | 17 | Armory | 30 | RewardsReceived |
| 5 | ChooseMode | 18 | OpenLootbox | 31 | ProductReceived |
| 6 | Party | 19 | LootboxPurchaseSuccess | 32 | ProgressionEvent |
| 7 | BuyItemPreview | 20 | GachaSkinsResults | 33 | ChampionOverview |
| 8 | PurchaseSuccess | 21 | LootboxItemPreview | 34 | ChampionSelection |
| 9 | CoinPurchaseSuccess | 22 | TrophyRoad | 35 | ChampionAbilitiesDetails |
| 10 | BattlePass | 23 | NewsCarousel | 36 | Album |
| 11 | RewardClaim | 24 | Friends | 37 | SetScreen |
| 12 | PremiumPurchaseSuccess | 25 | GuardianEmail | | |

Without Photon, remote config and login, Loadout is refused with `InternetConnectionRequired` and Friends with `RemoteConfigRequired`, both `FeatureValidationResult` values.

## Lobby

The lobby is `ScreenName.Lobby` on `OverlayCanvas/SafeContent/PlayScreen`. Its active buttons, by GameObject name:

| GameObject | Where | Purpose |
|---|---|---|
| `PlayButton` | `BottomPanel/PlayButtonParent` | PLAY for the selected mode |
| `ModeButton_<mode>` | `BottomPanel` | Opens ChooseMode |
| `RvBoosterLobbyButton` | `BottomPanel` | "×2 FREE", the battle pass XP booster |
| `ProfilePanel` | `TopLeftLayout` | Profile and nickname (see [Nicknames](#nicknames)) |
| `RetryConnection` | `TopLeftLayout` | CONNECT, shown while disconnected |
| `FriendsButton`, `SettingsButton` | `TopPanel` | Friends and Settings screens |
| `LockerTab` | navigation | Locker (3) |
| `ShopButton`, `ShopButtonVariantChapter2` | navigation | Shop (4) |
| `BattlePassButton<variant>` | navigation | BattlePass (10), in three variants |
| `PsfShowPersonalOfferPopup` | lobby | Personal offer star |
| `iOSDownload`, `AndroidDownload` | lobby | App Store and Google Play badges |

The three battle pass buttons are `BattlePassButtonWithNotifications`, `BattlePassButtonNoNotifications` and `BattlePassButtonDisabled`; the code swaps between them by notification state. Pressing CONNECT logs `PhotonConnector:OnReconnectPressed`, and the link from the button to `PhotonConnector.OnReconnectPressed` (f47920) is inferred. The party slot ("+") belongs to the party UI and is hidden while the client is disconnected from Photon.

A rewarded video unlocks the booster behind "×2 FREE" (`JustPlay.BattlePass.RVBoosterAnalytics`). `XPBoostUIManager` shows its countdown with `_containerGO` (+16), `_panelGO` (+20), `_timerText` (+24), `_countdownCoroutine` (+28), `_timeLeft` (+32) and `_isCountingDown` (+40). `SetVisibility` (f47785) toggles it.

### Ads and popups on the lobby

- PLAY goes through `GameModeConnector.StartJoinMode` (f45846), which calls `AdsManager.TryShowingVideoAd` (f49763) before `Connector.JoinMode` (f114348). Every ad attempt validates the ad feature first. When the age gate refuses it, `LimitedFeaturesManager.ValidateFeature` opens `AgeLimitedFeaturePopup`.
- `AdsManager.ShouldUserViewAds` (f49756) and `IsRewardedVideoReady` (f49767) depend on the remote `AdsSettingsV3` config, and the ad provider is created only after that config arrives. `RegisterRewardedVideoInfoCallback` (f49777) registers the reward callback.
- `DailySpins.DailySpinsController.Start` (f115944) preloads `Canvas_DailySpinPreviewPopup` through the generic `MenuPopupHandler.GetAddressablePopup<T>` (method 18216). Its state machine compiles to shared generic code (f156799), which turns the menu loader on before `GetPopup` and off after `GetResult`. The catch has no cleanup, so a failed preload leaves the loader on screen.
- `UiManager.get_IsLoaderActive` (f52080) reads the manager's `_loaderUI` (+16, a `LoaderUI`) and its `activeInHierarchy`.

## Loadout

- `LoadoutLobbyButton.OnClick` (f43611) reads a remote-config gate before it opens the Loadout. Without remote config that gate's pointer is null.
- `LoadoutScreen.OnEnable` (f50653) calls `LoadoutInventoryDisplay.DisplayInventory` (f43515). It gets the items (`GetItemsToDisplay`, f43516), sorts, counts and displays them, then handles the badges and the player preview. `EquipmentProductData.IsUnlocked` (f48830) asks `RankRoadManager.GetLockedEquipment` (f43996).
- `LoadoutScreen.EquipItemToSlot` (f50668) equips the item, recalculates and refreshes the UI on the client, then sends a server request and queues it.
- `<EquipWeaponSkin>d__3` (f48777) and `<UnequipWeaponSkin>d__4` (f48781) select the skin locally, then await a backend call and queue cosmetic analytics.
- `LoadoutItemPopup.DisplayItemDetails` (f43564) reads the currency balance through `FirebaseManager` and writes it to `_lolCoinsText` (+60). `DisplayUpgradeButton` (f43566) has a branch that hides the upgrade, maxed and blueprint controls.
- AUTO EQUIP is `LoadoutPlayerDisplay.OnAutoEquipClicked` (f43626). It takes the list from `EquipmentUtils.GetHighestLevelEquipment` (f43367), a stable descending sort by level over `UserEquipment.Equipment`, and fills the slots in that order. Items of equal level keep the dictionary's insertion order.
- `ModeInfo.get_UsesLoadout` (f49905) combines the mode's `_usesLoadout` with `EquipmentV2.are_loadouts_enabled`.
- Dragging an equipped item out without a drop calls `OnUnequipSelected` (f50671) and empties the slot. `LoadoutItemSlot.ShouldAllowDrag` (f43601) counts the non-empty equipped weapon IDs.

## Champions

- `Champions.get__instance` (slot 120092) returns the `Champions` ScriptableObject. It holds every local `ChampionData` in `_championsData` (+12) and indexes them in `_championsMap` (+20). A `ChampionData` has its ID at +12 (`lol.1v1.champions.<name>`) and its `ActiveAbility` at +24.
- `ChampionSelectionScreen` (34) has `OnEnable` (f51449) and `OnChampionSelected` (f51452), which opens the overview.
- `ChampionOverviewScreen` (33) has `SetChampion` (f51430), `InitPlayerModel` (f51439, and f51447 with a skin), `OnSkinSelected` (f51448) and `BrowseToChampionByOffset` (f51444). SELECT runs `SelectChampion` (f51440, slot 120126), which equips `_selectedChampion` (+80, a `ChampionProductData` whose `ProductData.Id` is at +8). The ability panel is `_activeAbilityDisplay` (+32).
- `SwitchToPlayerAbilitiesScreen` (f51441) opens ChampionAbilitiesDetails (35), which needs online services.
- The screens list products from `ChampionProductDataFactory` (`GetAllProducts`, slot 107710). `FirebaseChampionsHandler.Init`, inherited from `AFirebaseSettingsHandler<T>`, fills it from the `ChampionsConfig` document.

## Locker and products

The Locker (3) has three categories: Pickaxes, Emotes and Stickers.

- `AllProductDataFactory.Init` (`<Init>d__5`, f48905) waits for the `ProductsV9` document. It then calls `AddProductsToDictionary` (slot 10006) with skins (`SkinProductDataFactory.GetAllSkins`, slot 10005), emotes (`EmoteProductDataFactory.GetAllEmotes`, slot 107730) and weapon skins (`WeaponSkinsDataFactory.GetAllProducts`, slot 10012), and sets `Initialized` (slot 107682).
- `CategoryController.SetUIPreview` (f117630) looks items up through `AllProductDataFactory.GetProduct`. With an empty factory it ends in a null function call.
- Building the item list calls two methods that throw without remote data: `SubscriptionsManager.IsProductPartOfSubscription` (f52615) throws `ArgumentNullException` without the remote Subscriptions config, and `EmoteProductData.IsLimitedEdition` (f48827) throws `KeyNotFoundException` without the `ProductsV9` emote data, for example for `lol.1v1.playeremotes.pack.1`.
- The weapon-skin and emote factories build their catalogs from local data in their own `Init` routines (`<Init>d__4`, f49395; `<Init>d__1`, f48964). `LocalProductsData` holds the local catalog of skin packs, and the store fields come from `ProductsV9`.
- `LockerScreenController` holds `lockerUI` (+24) and `_currentCategoryController` (+32), `LockerUI` holds `_scrollerController` (+44), and `LockerScrollerController` holds `_itemsPerRow` (+20) and `ActiveItems` (+56).

## Game modes

`ModeMenuManager.OnEnable` (f46135) builds the ChooseMode screen (5) from the remote `GameModesV5` document (`FirebaseGameModesData`). Without that document the screen shows only Practice.

The `GameModesV5` fields, by `JsonProperty` name (`global-metadata.dat` offset 18149556), are `default_mode`, `competitive_modes`, `casual_modes`, `practice_modes`, `custom_modes`, `featured_modes`, `modes_rotation_hour`, `max_wait_time_for_players`, `min_wait_time_for_players`, `late_join_kick_delay`, `modes_info`, `daily_first_win_trophies` and `daily_mode_reveal_xp`.

- The mode lists are lists of lists. An empty outer list divides by zero in `DailyModesRotationManager.CalculateIndexBasedOnModeType` (f46450).
- Without the document, `GameManager.SetGameStartTime` (f45926) and `GameManager.CheckPlayersReady` (f45930) fall back to 10 s player waits; the data class's constructor would give 30 and 15.
- `late_join_kick_delay` drives the late-join kick in `GameManager.OnRoomPropertiesUpdate` (f45947). When `default_mode` is unset, `GameModeHelpers.Init` (f50558) keeps `DefaultLocalGameMode`.
- `ModesProperties._modesInfo` lists every `ModeInfo` (`ModeName`, `IsCustomGame`, `_scenePool`), and `ModesMenuSettings._modeDictionary` maps modes to menu entries. `ModeMenuManager._customModeButtons` holds the Custom category's `LargeButtons`, `MediumButtons` and `SmallButtons` lists.
- `OfflineModes` (the original offline list) feeds Practice.

## Nicknames

- The profile panel button on the lobby runs `ProfilePanelHandler.SwitchToProfileScreen` (f53018), which opens the Profile screen only for a logged-in account.
- `StartEditName` (f53013) opens the name field. A guest reaches it only while the name is empty ("Click to change name").
- `OnEndNameEdit` (f53015) runs a profanity check and `Connector.OnPlayerNameChanged` (f114352), and caches the name in PlayerPrefs under `nickname` (`SaveNicknameToCache`, f53023; `GetCachedNickname`, f53022, reads it back).
- Other players see `ServerUser.GeneralData.Nickname`, which only the backend's answer updates. `Connector.UpdatePhotonInfo` (f114344) publishes it as the Photon NickName. In a party, `PartyRoomConnector.OnPlayerDataChanged` (f48314) sends the `UpdateAllPartyUI` RPC so every client redraws its name tags.
- Every displayed name passes through `AgeGateManager.ToValidNickname` (see [boot.md](boot.md#age-gate-and-limited-features)): `PartyRoomConnector.UpdatePartyMembersUI` (f48324), the `PartyMemberInfo` and `InGamePlayerInfo` constructors, and `FriendData` all call it. A new guest's name comes from `NicknamesGenerator.GeneratedNickname` (f49736).
- `PartyPlayer._playerName` (+72) is the text of a lobby name tag, and `InGamePlayerInfo.Nickname` (+40) is the name shown in a match.

## Deep links

- `PartyShare.ShareLink` (f48357) shares `ApiUrls.GetFullUrl(BaseWebUrl, "party") + "?code=" + code`. `ApiUrls.get_BaseWebUrl` (f98031) returns the literal `https://1v1.lol/`.
- `DeepLinkManager.Awake` (f47451) reads the page address. `OnDeepLinkActivated` (f47452) dispatches by path to the callbacks registered with `Subscribe` (f47454). `/party?code=` reaches `Connector.OnPartyDeepLink` (f114328), which joins that party (see [network.md](network.md#party)).

The Settings screen's editing preferences are in [controls.md](controls.md#editing-preferences).

## Unknowns

- The full contents of the remote documents as served: ProductsV9, Subscriptions, ChampionsConfig and GameModesV5.
- Which store and battle pass flows still open without services; none were exercised.
