# Network

The original client plays online through Photon PUN 2.42 (Photon Unity Networking) on PhotonRealtime 4.1.6.24, over WebSockets. This file covers the transport, the operation and event codes, matchmaking, the connection lifecycle, parties and the in-match RPCs. Notation follows the [conventions](il2cpp.md#conventions). A statement about what a Photon server does beyond what the client shows is marked inferred, from Photon's documented behavior.

## Transport

The client opens one secure WebSocket per server role through the framework's `_SocketCreate` bridge, with the subprotocol `GpBinaryV18`. The URL carries the session parameters `libversion=4.1.6.24`, `sid=30`, `app=<app id>` (`NameServer` on the Name Server) and `IPv6`. The Name Server is `ns.photonengine.io:19093`; the Master and Game server addresses come from the servers' answers. `PhotonServerSettings` sets `DevRegion` to `eu` and the app version to 0.306.

Each binary frame is one Protocol18 message. It starts with `0xF3` and an `EgMessageType` byte (type 16167), where a set `0x80` bit means encrypted: 0 init, 1 init response, 2 operation, 3 operation response, 4 event, 6 internal operation request, 7 internal operation response.

After opening a socket, the client waits for the server's init (`TPeer::OnConnect`, f149130). On Master and Game sockets the init travels in the URL and the client sends no init request. `TPeer::.cctor` (f149147) builds the header `F3 02`. Internal operation 1 is the ping (`TPeer::SendPing`, f149136). Its reply carries the client's time (1) and the server's time (2), which `ReadPingResult` (f149146) reads as int.

Values are tagged with `GpType` codes (type 16193): scalars, compressed and zero forms (`Int1`/`Int2`/`L1`/`L2` and their negative variants, `*Zero`), strings, `Hashtable`, typed `Dictionary` headers, arrays (`64` plus an element code) and custom types (19, slim 128+). These `Protocol18` methods read and write them:

| Method | Function |
|---|---|
| `Read`, `Write` | f113879, f113872 |
| `ReadCompressedUInt32`, `WriteCompressedInt32` | f113886, f113930 |
| `ReadDictionaryType` (two overloads), `WriteDictionaryHeader` | f113910/f113923, f113948 |
| `WriteArrayType` | f113967 |
| `SerializeOperationRequest` | f113959 |
| `DeserializeOperationResponse`, `DeserializeEventData` | f113921, f113916 |

In operation bodies, an empty debug message is written as Null.

## Codes

Every code below is a metadata literal.

| OperationCode (type 19306) | Value | ParameterCode (type 19305) | Value |
|---|---:|---|---:|
| Authenticate | 230 | RoomName | 255 |
| JoinLobby | 229 | ActorNr | 254 |
| LeaveLobby | 228 | TargetActorNr | 253 |
| CreateGame | 227 | ActorList | 252 |
| JoinGame | 226 | Properties | 251 |
| JoinRandomGame | 225 | Broadcast | 250 |
| Leave | 254 | PlayerProperties | 249 |
| RaiseEvent | 253 | GameProperties | 248 |
| SetProperties | 252 | Cache | 247 |
| ChangeGroups | 248 | ReceiverGroup | 246 |
| FindFriends | 222 | Data (also the SQL filter) | 245 |
| GetRegions | 220 | Code | 244 |
| | | Group, Remove, Add | 240, 239, 238 |
| | | EmptyRoomTTL, PlayerTTL | 236, 235 |
| | | ExpectedValues, Address, UserId | 231, 230, 225 |
| | | PeerCount, GameCount, MasterPeerCount | 229, 228, 227 |
| | | MatchMakingType, Token, JoinMode | 223, 221, 215 |
| | | LobbyName, LobbyType, Region | 213, 212, 210 |
| | | MasterClientId, RoomOptionFlags | 203, 191 |

- EventCode (type 19304): Join 255, Leave 254, PropertiesChanged 253, AppStats 226.
- ErrorCode (type 19301): OperationNotAllowedInCurrentState -3, InvalidOperation -2, InvalidAuthentication 32767, GameIdAlreadyExists 32766, GameFull 32765, GameClosed 32764, NoRandomMatchFound 32760, GameDoesNotExist 32758, JoinFailedPeerAlreadyJoined 32750, JoinFailedFoundActiveJoiner 32746.
- GamePropertyKey (type 19303): MaxPlayers 255, IsVisible 254, IsOpen 253, MasterClientId 248, ExpectedUsers 247.
- ActorProperties (type 19302): UserId 253.
- RoomOptionBit (type 19297): DeleteCacheOnLeave 2, SuppressRoomEvents 4, PublishUserId 8, DeleteNullProps 16, BroadcastPropsChangeToAll 32, SuppressPlayerInfo 64.
- ReceiverGroup (type 19309): Others 0, All 1, MasterClient 2.
- EventCaching (type 19310): DoNotCache 0, AddToRoomCache 4, AddToRoomCacheGlobal 5, RemoveFromRoomCache 6, RemoveFromRoomCacheForActorsLeft 7.
- JoinMode (type 19307): Default 0, CreateIfNotExists 1. LobbyType (type 19314): SqlLobby 2.

## Server roles

The Name Server answers two operations:

1. `GetRegions` (220) returns the region list (210, string[]) and their Master addresses (230, string[]).
2. `Authenticate` (230) returns the Master address (230), the player's `UserId` (225) and a token (221). `CallAuthenticate` (f38152) holds the message "Authenticate without Token is only allowed on Name Server".

On the Master:

1. The client sends `Authenticate` with the token. A Photon Master then sends `AppStats` (226) with the players in rooms (229), the players on Master (227) and the games (228), and `OnEvent` (f38225) stores them as `PlayersInRoomsCount`, `PlayersOnMasterCount` and `RoomsCount`. The client never asks for these counts; the push after authentication is Photon behavior (inferred).
2. Matchmaking requests follow (`CreateGame`, `JoinGame`, `JoinRandomGame`, `FindFriends`). Their responses name the Game server (230) and the room (255), and `OnOperationResponse` (f38206) reads both.

On the Game server the client sends `CreateGame` or `JoinGame` with the full room options, then works inside the room through events, properties and RaiseEvents. `GameEnteredOnGameServer` (f38193) reads the actor number (254), the actor list (252), actor properties (249), room properties (248) and the room flags (191).

`LoadBalancingPeer` builds the requests with these parameters:

| Operation | Function | Parameters |
|---|---|---|
| `OpCreateRoom` | f38251 | Master: 255, 213/212, 238 |
| `OpJoinRoom` | f38252 | 215; on the Game server also 249, 250 and the room options |
| `RoomOptionsToOpParameters` | f38249 | 248 (MaxPlayers as int), 241, 232, 235, 236, 237, 239, 191 |
| `OpJoinRandomRoom`, `...OrCreateRoom` | f38253, f38254 | 248 (MaxPlayers as byte), 223, 245 (SQL filter), 238, 215 |
| `OpFindFriends` | f38257 | 1 (user IDs), 2 (options: CreatedOnGs 1, Visible 2, Open 4) |
| `OpRaiseEvent` | f38265 | 244, 245, 247, then 252 or 240 or 246 |
| `OpSetPropertiesOfActor`, `...OfRoom` | f38178, f38183 | 251, 254, 250, 231 |
| `OpChangeGroups` | f38264 | 239, 238 |
| `OpLeaveRoom` | f38255 | |

On the receiving side:

- `OnEvent` (f38225): Join (255) carries 249 and 252, and raises `OnJoinedRoom` for the joiner's own event. Leave (254) carries 233 and 203; any non-zero 203 switches the master client. PropertiesChanged (253) carries 253 (the actor, or 0 for the room) and 251.
- `RoomInfo::InternalCacheProperties` (f38412) reads 255 as any integer, 253/254/249 as bool, 248/245/246 as int and 247 as string[]. `Room::InternalCacheProperties` (f38411) raises `OnMasterClientSwitched` on a new 248. `Player::InternalCacheProperties` (f38306) reads 255 as the name, 253 as the UserId and 254 as bool.
- `LoadBalancingClient.OpSetPropertiesOfActor` (f38176) and `...OfRoom` (f38182) update the local cache only when flag 32 (BroadcastPropsChangeToAll) is off and no expected values are sent. Otherwise the client waits for the server's PropertiesChanged event, which a Photon server sends to the sender too.
- The `FindFriends` response holds 1 as bool[] (online) and 2 as string[] (the room of each user).

The client also depends on server rules it cannot show (inferred from Photon's documentation):

- The lowest remaining actor becomes master client.
- Room-cached events replay to a joiner after its Join event, and `AddToRoomCacheGlobal` ones arrive with sender 0.
- Interest groups include the sender.
- `RaiseEvent` and `ChangeGroups` get no response when they succeed.

## Matchmaking

`ConnectionProperties.GetLobby` (f49615) returns `1v1Lobby` (`1v1Lobby_Mobile` exists too), of type `SqlLobby` (2), which the class's `.cctor` (f49618) sets up. SQL lobbies send no room lists. Rooms carry these columns:

| Column | Holds |
|---|---|
| `C0` | The mode name |
| `C1`, `C2` | The low and high ends of the rating window |
| `powerScore` | A room property set by `CreateRatedRoomOptions` |

Pressing PLAY runs these steps:

1. `GameModeConnector.StartJoinMode` (f45846) checks the party (`PartyInfo.get_IsAlone`), tries a video ad, then calls `Connector.JoinMode` (f114348).
2. `GameModeConnector.JoinRoom` (f45851) calls `PhotonNetwork.JoinRandomRoom` with one of two SQL filters, picked by `ShouldUseRank` (f45852):
   - `ConnectionProperties.GetSqlFilter` (f49617): `C0 = '<mode>'`;
   - `GetRankedSqlFilter` (f49616): `String.Format("{0} >= {1} AND {2} <= {3} AND {4} = '{5}'", …)`, that is `<rating> >= C1 AND <rating> <= C2 AND C0 = '<mode>'`.
3. When nothing matches (`NoRandomMatchFound`), `CreateRoom` (f45853) or `CreateRatedRoom` (f45854) creates a room. `CreateRatedRoomOptions` (f45847) sets `C0`, `C1` and `C2` from `ModeInfo.GetRoomInitialRangeToUseByPlayerRating` (f49912), plus `powerScore`. `ModeInfo.GetMaxRealPlayers` (f49910) gives the room size.
4. While the room waits, `IncreaseRoomRatingRange` (f45857) widens `C1`/`C2` by `ModeInfo.GetRatingRangeIncrement` (f49907). The party and in-game starters have their own (f48158 and f118291).
5. `GameStarter.UpdatePopulatingUI` (f48093) shows "{0}/{1}" through `LoaderUI.UpdateRoomInfo(currPlayers, maxPlayers, showCancel)` (f47126). The search overlay (`LoaderCanvas/Loader`, with a full-screen `ScreenBlocker`) takes every click, and its Cancel button is the only way out of the search.

`GetRatingRangeIncrement` takes a base value (the remote override when it is at least 0, else `RangeIncreaseFactorDefault`, `ModeInfo` +212), divides it by `PhotonNetwork.CountOfPlayers` (f114085) and rounds. `CountOfPlayers` is the sum of `CountOfPlayersOnMaster` (f114083) and `CountOfPlayersInRooms` (f114084), and those counts come only from `AppStats`. With no `AppStats` the divisor is 0 and the rounded result is `int.MinValue`, so the room's window flips to unmatchable values.

A Master answers `JoinRandomGame` by filling the first open, visible room of the lobby that passes the SQL filter and has a free slot (Photon's FillRoom mode; inferred). Missing columns or mismatched types fail a comparison, as SQL NULL does.

## Connection lifecycle

`PhotonConnector` owns the connection.

| Method | Function | Role |
|---|---|---|
| `Connect` | f47909, slot 9547 | Awaits `RegionManager.RefreshRegions` (f47928, slot 9771), then `InitConnection` |
| `InitConnection` | f47916, slot 9773 | Prepares the connection and starts `WaitForConnection` |
| `<WaitForConnection>d__24` | f47934 | Times out the connection |
| `OnConnectedToMaster` | f47910 | Connection complete |
| `OnDisconnected` | f47911 | `ShouldReconnect` (f47912) decides on a reconnect; also calls `HandleNoNetwork` |
| `HandleNoNetwork` | f47914, slot 9769 | Shows "No internet connection" with Retry |
| `OnReconnectPressed` | f47920 | CONNECT and Retry |
| `AttemptReconnect` | f47913, slot 9778 | See [Reconnecting](#reconnecting) |
| `PlannedDisconnect` | f47915, slot 19985 | Disconnects on purpose, with or without a reconnect |

`InitConnection` needs `FirebaseCheaterSettingsData`, and configures custom auth (`ConfigureCustomAuth`, f47917) when `EnablePhotonAuth` is on. `WaitForConnection` then yields `WaitForSecondsRealtime(_connectionTimeout)` (+20, 10 s). Unless `PhotonNetwork.IsConnectedAndReady` is true by then, it logs "PhotonConnector:WaitForConnection Connection timed out" and calls `PhotonNetwork.Disconnect` (f114111).

`InitConnection` is reached only through table slot 9773, from `Connect` and `AttemptReconnect`, so every connection gets the same 10 s budget. It covers the Name Server, Master and authentication hops and is measured in real time, so a page that blocks its main thread (for example while loading a scene) uses it up.

`PhotonPeer.DisconnectTimeout` defaults to 10 000 ms: a peer that hears nothing for that long disconnects with `ClientTimeout`. `RegionManager.RefreshRegions` and `GetAvailableRegions` talk to the Name Server before each connect.

### Reconnecting

`<AttemptReconnect>d__30` (f47923) reads `AppInitializer.IsInitializing` (static +17) at +0x17f and returns early while it is true. `IsInitializing` stays true for as long as `AppInitializer.Initialize` waits for remote config, so a client whose startup never finishes can never reconnect.

When focus returns, `ApplicationFocusMonitor.OnApplicationFocus` (f45892) calls the monitor's own `AttemptReconnect` (f45894) if the client is disconnected and not in a game (`IsInGame`, f45893), so regaining focus reconnects a dropped client. The same monitor can disconnect a player who loses focus in modes that require it (`HandleFocusLoss`, `DoesGameModeRequireFocus`).

## Party

`PartyRoomConnector` runs parties as ordinary Photon rooms on the Master's lobby.

- `CreateParty` (f48306) and `PartyInfo.CreateTemporaryParty` (f48230) name the room with a code from `PhotonUtils.GenerateRandomRoomName(region)` (f116291): `Random.Range(i·s, i·s + s).ToString("00000")`, where `i` is the region's index and `s = GetRegionRangeSegment()` (f116292) `= 10^PartyRoomNameLength / regions`. `PartyRoomNameLength` comes from `GameProperties` (+56, f118201). `GetRegionFromRoomName` (f116293) recovers the region as `code / s`.
- A taken code fails with `GameIdAlreadyExists`. `OnCreateRoomFailed` (f48326) calls `CreateParty` again, which draws a new code.
- `JoinParty(partyCode)` (f48307) refuses codes shorter than `PartyRoomNameLength`. "Join with code" and the deep link both end there.
- `UiManager.UpdatePartyState(toState, isMaster, partyName, hidePartyCode)` (f52109) switches the lobby into party mode. `UpdateAllPartyUI` (f48323) is also an RPC, and redraws every client's party UI. `UpdatePartyMembersUI` (f48324) draws the name tags. `PartyFriendlyBattleUI` holds the friendly-match toggle and options.
- The leader picks the mode (`OnGameModeChanged`, f48315; `UpdatePartyGameMode`, f48321) and presses PLAY (`HandlePartyPlayButton`, f48320; `StartGame`, f48305; `MoveToPartyGameConnector`, f48319).

### Following the leader

When the leader starts, `PartyGameConnector` moves everyone to a game room.

- The leader's client runs `StartGameForParty` (f48149), which calls `JoinRoom`, `CreateRoom` or `CreateRatedRoom` for the mode (f48151, f48144, f48145). The members are reserved as expected users (247; inferred from `RemoveFromRoomExpectedUsers` below). `RatingRangeIncCoroutine` (f48157) widens the rating window.
- The members learn of it through a buffered RPC (PUN event 200). They leave the party room, return to the Master and run `CheckPartyLeaderStatus` (`<CheckPartyLeaderStatus>d__33`, f48164). That routine calls `PhotonNetwork.FindFriends([leader])` (f114135) again and again after a `WaitForSeconds`, and skips the call while `PopupManager.IsPopupOpen` (f52967) is true or `IsValidState` (f48162) is false.
- `PartyGameConnector.OnFriendListUpdate` (f48137) checks `FriendInfo.IsInRoom`, then either joins the leader's room (`PhotonNetwork.JoinRoom`, f114128) or goes back to the party room (`ReturnToPartyRoom`, f48138).
- `GameStarter.RemoveFromRoomExpectedUsers` (f48092) drops expected users who do not arrive.
- After the match, Continue takes the players back to the party room (`RejoinParty`, f48309; `RejoinPartyRoom`, f48310; `CheckPartyLeaderStatusDuringRejoin`, f48311 and f48349, which also polls `FindFriends`).

### Leaving

The LEAVE button (`LeaveButton` under `InPartyPanel`) has one persistent onClick, `PartyRoomConnector.LeaveParty` (f48313, slot 107030). It logs "PartyRoomConnector:LeaveParty", calls `ExitPartyMode` (f48308) only if `PhotonNetwork.IsConnectedAndReady` (f114057), and calls `PhotonNetwork.LeaveRoom` (f114131) only if `InRoom` (f114082), so LEAVE does nothing while the client is disconnected.

`PhotonConnector.OnDisconnected` leads to `PartyRoomConnector.OnDisconnected` (f48338), which calls `LeaveParty`. That call does nothing for the same reason, and party mode and its UI stay on screen until the client reconnects. During a search the overlay covers LEAVE, and Cancel returns to the party room.

`PartyPlayer.LeaveParty` (f48261) and `PartyPlayersManager.LeaveParty` (f48297) only update the party UI objects.

## In-match RPCs

Both `PlayerController.TakeDamage` overloads ([combat.md](combat.md#hit-pipeline)) send the RPC `TakeHit` to the victim's view through `PhotonView.RPC` (f114253). The weapon overload also names `TakeRestorativeHit`, which by its name is the healing variant (inferred).

`ProjectileManager.ProjectileEventRPC(projectileID, eventData)` (f42919, slot 117807) delivers projectile events to every client.

`PhotonNetwork` manages PUN's room cache with these methods. The keys come from its `.cctor` (f114101).

| Method | Function | Cache operation |
|---|---|---|
| `SendInstantiate` | f114149 | Raises event 202 cached 4, or 5 for room objects, keyed by byte 7 (the view ID) |
| `ServerCleanInstantiateAndDestroy` | f114154 | Removes a 202 with cache option 6 and `{7: id}` |
| `OpCleanRpcBuffer` | f114156 | Removes buffered RPCs (event 200) by `{0: view}` |
| `OpRemoveCompleteCacheOfPlayer` | f114198 | Uses code 0 with an actor list |
| `OpRemoveCompleteCache` | f114165 | Clears everything |
| `RemoveCacheOfLeftPlayers` | f114199 | Uses option 7 |

`ServerCleanInstantiateAndDestroy` also raises 204 cached 5 when a scene view is destroyed.

## Unknowns

- The original Name Server's region list and Photon custom-auth provider settings.
- The interval of the leader-status poll and of the rating-window widening.
- The exact base values for `GetRatingRangeIncrement` per mode, and which modes use the ranked filter.
