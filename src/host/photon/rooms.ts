import type { ServerWebSocket } from 'bun';
import { encodeMessage, type Entries, type Message, type Params, type Value } from './protocol';
import type { PhotonSocket } from './server';

/**
 * Photon LoadBalancing rooms for the Master and Game server roles of the local server, as the original client
 * (PhotonRealtime 4.1.6.24, PUN 2.42) writes and reads them (docs/reference/network.md). Evidence (WebGL.wasm
 * 52b3dc8a, `bun run re`):
 * - Codes are metadata literals: OperationCode type:19306, ParameterCode type:19305, EventCode type:19304, ErrorCode
 *   type:19301, GamePropertyKey type:19303, ActorProperties type:19302, ReceiverGroup type:19309, EventCaching
 *   type:19310, JoinMode type:19307, LobbyType type:19314, RoomOptionBit type:19297.
 * - Requests (LoadBalancingPeer): OpCreateRoom f38251 (Master: only 255, 213/212, 238); OpJoinRoom f38252 (215; on
 *   the Game server also 249, 250 and the room options); RoomOptionsToOpParameters f38249 (248 with MaxPlayers as int,
 *   241, 232, 235, 236, 237, 239, 191 = RoomOptionBit flags); OpJoinRandomRoom f38253 and OpJoinRandomOrCreateRoom
 *   f38254 (248 with MaxPlayers as byte, 223, 245 = SQL filter, 238, 215); OpFindFriends f38257 (1 = user IDs,
 *   2 = CreatedOnGs 1 | Visible 2 | Open 4); OpRaiseEvent f38265 (244, 245, 247, then 252 or 240 or 246);
 *   OpSetPropertiesOfActor f38178 and OfRoom f38183 (251, 254, 250, 231); OpChangeGroups f38264 (239, 238);
 *   OpLeaveRoom f38255.
 * - Reads (LoadBalancingClient): OnOperationResponse f38206 (Master Create/Join/JoinRandom: 230 as string, optional
 *   255; Leave: DisconnectToReconnect; FindFriends: 1 as bool[], 2 as string[]); GameEnteredOnGameServer f38193
 *   (254 as int, 252 as int[], 249 = actor number to properties, 248, 191); ReadoutProperties f38188; OnEvent f38225
 *   (Join 255: 249, 252 and OnJoinedRoom for the joiner's own event; Leave 254: 233, 203; PropertiesChanged 253: 253
 *   = actor or 0 for the room, 251); EventData .ctor f113781 (sender 254, data 245); RoomInfo::InternalCacheProperties
 *   f38412 (255 any integer, 253/254/249 bool, 248/245/246 int, 247 string[]); Room::InternalCacheProperties f38411
 *   (OnMasterClientSwitched on a new 248); Room::InternalCacheRoomFlags f38410; Player::InternalCacheProperties
 *   f38306 (255 name, 253 UserId, 254 bool).
 * - OpSetPropertiesOfActor f38176 and OfRoom f38182 update the sender's cache only without flag 32 and without
 *   expected values, so those changes are broadcast back to the sender too.
 * - PUN room cache (PhotonNetwork): SendInstantiate f114149 (202, cache 4 or 5 for room objects, byte key 7 = id),
 *   ServerCleanInstantiateAndDestroy f114154 (cache 6 removes 202 by {7: id}; 204 cached 5 for scene views),
 *   OpCleanRpcBuffer f114156 (200 by {0: view}), OpRemoveCompleteCacheOfPlayer f114198 (code 0 with an actor list),
 *   OpRemoveCompleteCache f114165, RemoveCacheOfLeftPlayers f114199 (cache 7); keys from .cctor f114101.
 * Server-side rules the client cannot show (inferred from Photon's documented behaviour): the lowest remaining actor
 * becomes master client; room-cached events replay to a joiner after its Join event, AddToRoomCacheGlobal ones with
 * sender 0; interest groups include the sender; RaiseEvent and ChangeGroups get no response when they succeed.
 */

/** Photon.Realtime.OperationCode (type:19306). */
export const Op = {
  Authenticate: 230, JoinLobby: 229, LeaveLobby: 228, CreateGame: 227, JoinGame: 226, JoinRandomGame: 225, Leave: 254,
  RaiseEvent: 253, SetProperties: 252, ChangeGroups: 248, FindFriends: 222, GetRegions: 220,
} as const;
/** Photon.Realtime.ParameterCode (type:19305). JoinRandomGame sends the SQL lobby filter as Data (f38253). */
export const Param = {
  RoomName: 255, ActorNr: 254, TargetActorNr: 253, ActorList: 252, Properties: 251, Broadcast: 250,
  PlayerProperties: 249, GameProperties: 248, Cache: 247, ReceiverGroup: 246, Data: 245, Code: 244, Group: 240,
  Remove: 239, Add: 238, EmptyRoomTTL: 236, PlayerTTL: 235, ExpectedValues: 231, Address: 230, UserId: 225,
  PeerCount: 229, GameCount: 228, MasterPeerCount: 227, MatchMakingType: 223, Token: 221, JoinMode: 215,
  LobbyName: 213, LobbyType: 212, Region: 210, MasterClientId: 203, RoomOptionFlags: 191, FindFriendsRequestList: 1,
  FindFriendsOptions: 2, FindFriendsResponseOnlineList: 1, FindFriendsResponseRoomIdList: 2,
} as const;
/** Photon.Realtime.ErrorCode (type:19301). */
export const Err = {
  OperationNotAllowedInCurrentState: -3, InvalidOperation: -2, InvalidAuthentication: 32767,
  GameIdAlreadyExists: 32766, GameFull: 32765, GameClosed: 32764, NoRandomMatchFound: 32760, GameDoesNotExist: 32758,
  JoinFailedPeerAlreadyJoined: 32750, JoinFailedFoundActiveJoiner: 32746,
} as const;
/** Photon.Realtime.EventCode (type:19304). */
const Ev = { Join: 255, Leave: 254, PropertiesChanged: 253, AppStats: 226 } as const;
/** Photon.Realtime.GamePropertyKey (type:19303) and ActorProperties.UserId (type:19302). */
const Key = { MaxPlayers: 255, IsVisible: 254, IsOpen: 253, MasterClientId: 248, ExpectedUsers: 247, UserId: 253 };
/** Photon.Realtime.RoomOptionBit (type:19297). */
const Flag = {
  DeleteCacheOnLeave: 2, SuppressRoomEvents: 4, PublishUserId: 8, DeleteNullProps: 16, BroadcastPropsChangeToAll: 32,
  SuppressPlayerInfo: 64,
} as const;
/** ReceiverGroup (type:19309), EventCaching (type:19310), JoinMode (type:19307), LobbyType (type:19314). */
const Receivers = { Others: 0, All: 1, MasterClient: 2 } as const;
const Caching = {
  DoNotCache: 0, AddToRoomCache: 4, AddToRoomCacheGlobal: 5, RemoveFromRoomCache: 6,
  RemoveFromRoomCacheForActorsLeft: 7,
} as const;
const JoinMode = { Default: 0, CreateIfNotExists: 1 } as const;
const SQL_LOBBY = 2;
/** FindFriends option bits (f38257); CreatedOnGs (1) holds for every room with actors here. */
const Friends = { Visible: 2, Open: 4 } as const;

type Socket = ServerWebSocket<PhotonSocket>;
/** An active actor: its number, socket, properties (Hashtable) and interest groups. */
export interface Actor { nr: number; socket: Socket; props: Entries; groups: Set<number>; room: Room }
/** A room-cached event: sender (0 when global), code and data. */
interface Cached { actor: number; code: number; data: Value | undefined }
/**
 * A room, reserved on the Master by `creator` and `live` once created on the Game server. `props` is the room's
 * Hashtable, GamePropertyKey entries included; `actors` are in join order, so by ascending number.
 */
interface Room {
  name: string; lobby: string; creator: string; live: boolean; props: Entries; flags: number; emptyTtl: number;
  actors: Actor[]; last: number; cache: Cached[]; expiry?: ReturnType<typeof setTimeout>;
}

/**
 * The rooms of the local Photon server, shared by its Master and Game server roles. `send` delivers and records one
 * message; `sockets` are the open sockets (FindFriends' online state); `gameServer` is the address Master hands out.
 */
export function photonRooms({ send, record, sockets, gameServer }: {
  send: (socket: Socket, message: Message) => void; record: (kind: string, data: unknown) => void;
  sockets: Set<Socket>; gameServer: string;
}) {
  const rooms = new Map<string, Room>();
  const respond = (socket: Socket, code: number, params: Params = new Map(), returnCode = 0,
    debugMessage: string | null = null) =>
    send(socket, { kind: 'response', internal: false, code, returnCode, debugMessage, params });
  const refuse = (socket: Socket, code: number, [returnCode, message]: [number, string]) =>
    respond(socket, code, new Map(), returnCode, message);
  /** What the server does not implement gets InvalidOperation and a record, never a pretended success. */
  const unimplemented = (socket: Socket, code: number, what: string) => {
    record('photon-unimplemented', { id: socket.data.id, role: socket.data.role, code, what });
    respond(socket, code, new Map(), Err.InvalidOperation, `Not implemented by the local server: ${what}`);
  };
  const emit = (to: Actor[], code: number, params: Params) => {
    const bytes = encodeMessage({ kind: 'event', code, params });
    for (const actor of to) actor.socket.sendBinary(bytes);
  };
  const relay = (to: Actor[], code: number, sender: number, data: Value | undefined) => {
    const params = new Map<number, Value>([[Param.ActorNr, { int: sender }]]);
    if (data !== undefined) params.set(Param.Data, data);
    emit(to, code, params);
  };

  /** The lobby a request names (213, 212), else the one the socket joined; '' is the default lobby. */
  const lobbyOf = (socket: Socket, params: Params) => {
    const name = str(params.get(Param.LobbyName));
    return name ? `${name}/${num(params.get(Param.LobbyType)) ?? 0}` : socket.data.lobby ?? '';
  };
  /** Master's answer: the Game server and the room name (OnOperationResponse f38206 reads 230 and 255). */
  const toGame = (socket: Socket, code: number, name: string) =>
    respond(socket, code, new Map<number, Value>([[Param.Address, gameServer], [Param.RoomName, name]]));

  function joinLobby(socket: Socket, params: Params) {
    // Only SQL lobbies (the client's ConnectionProperties.GetLobby) get no room lists; others need GameList events.
    if (num(params.get(Param.LobbyType)) !== SQL_LOBBY) {
      return unimplemented(socket, Op.JoinLobby, 'room lists of non-SQL lobbies');
    }
    socket.data.lobby = lobbyOf(socket, params);
    respond(socket, Op.JoinLobby);
  }

  /** Master CreateGame: reserves the name (a GUID when absent) until its creator creates it on the Game server. */
  function reserve(socket: Socket, code: number, params: Params) {
    const creator = socket.data.userId!, name = str(params.get(Param.RoomName)) || crypto.randomUUID();
    for (const [other, room] of rooms) if (!room.live && room.creator === creator) rooms.delete(other);
    if (rooms.has(name)) return refuse(socket, code, [Err.GameIdAlreadyExists, 'Game already exists']);
    rooms.set(name, { name, lobby: lobbyOf(socket, params), creator, live: false, props: [], flags: 0, emptyTtl: 0,
      actors: [], last: 0, cache: [] });
    toGame(socket, code, name);
  }

  /** Master JoinGame: the room must exist (JoinMode 1 creates it), be open and have a slot. */
  function joinOnMaster(socket: Socket, params: Params) {
    const room = rooms.get(str(params.get(Param.RoomName)) ?? ''), mode = num(params.get(Param.JoinMode)) ?? 0;
    if (mode > JoinMode.CreateIfNotExists) return unimplemented(socket, Op.JoinGame, `JoinMode ${mode} (rejoin)`);
    if (!room) {
      return mode ? reserve(socket, Op.JoinGame, params)
        : refuse(socket, Op.JoinGame, [Err.GameDoesNotExist, 'Game does not exist']);
    }
    const error = refusal(room, socket.data.userId!, strings(params.get(Param.Add)));
    if (error) return refuse(socket, Op.JoinGame, error);
    toGame(socket, Op.JoinGame, room.name);
  }

  /**
   * Master JoinRandomGame (FillRoom): the first open, visible room of the lobby that matches, passes the SQL lobby
   * filter (245) and has the slots.
   */
  function joinRandom(socket: Socket, params: Params) {
    const filter = str(params.get(Param.Data)), sql = filter === undefined ? () => true : sqlFilter(filter);
    if (!sql) return unimplemented(socket, Op.JoinRandomGame, `SQL lobby filter ${filter}`);
    if (num(params.get(Param.MatchMakingType))) return unimplemented(socket, Op.JoinRandomGame, 'MatchmakingMode');
    const lobby = lobbyOf(socket, params), wanted = table(params.get(Param.GameProperties)) ?? [];
    const userId = socket.data.userId!, expected = strings(params.get(Param.Add));
    // The expected MaxPlayers is a byte (f38253), the room's an int (f38249).
    const matches = (room: Room) => wanted.every(([key, value]) => same(key, byteKey(Key.MaxPlayers))
      ? num(value) === maxPlayers(room) : same(get(room.props, key), value));
    const room = [...rooms.values()].find(room => room.live && room.lobby === lobby && visible(room)
      && !refusal(room, userId, expected) && matches(room) && sql(room.props));
    if (room) return toGame(socket, Op.JoinRandomGame, room.name);
    if (num(params.get(Param.JoinMode)) === JoinMode.CreateIfNotExists) {
      return reserve(socket, Op.JoinRandomGame, params);
    }
    refuse(socket, Op.JoinRandomGame, [Err.NoRandomMatchFound, 'No match found']);
  }

  /** FindFriends: online state (a Master or Game socket) and room of each user, '' outside rooms or filtered out. */
  function findFriends(socket: Socket, params: Params) {
    const users = strings(params.get(Param.FindFriendsRequestList));
    const options = num(params.get(Param.FindFriendsOptions)) ?? 0;
    const online = (userId: string) => [...sockets].some(other => other.data.role !== 'ns'
      && other.data.userId === userId);
    const roomOf = (userId: string) => {
      const room = [...rooms.values()].find(room => room.actors.some(actor => actor.socket.data.userId === userId));
      return room && (!(options & Friends.Visible) || visible(room)) && (!(options & Friends.Open) || open(room))
        ? room.name : '';
    };
    respond(socket, Op.FindFriends, new Map<number, Value>([
      [Param.FindFriendsResponseOnlineList, { bools: users.map(online) }],
      [Param.FindFriendsResponseRoomIdList, { strings: users.map(roomOf) }]]));
  }

  /** Game server CreateGame/JoinGame: the actual join, its Join event and the room cache for the joiner. */
  function enter(socket: Socket, code: number, params: Params) {
    const userId = socket.data.userId!, name = str(params.get(Param.RoomName)) ?? '', existing = rooms.get(name);
    const mode = num(params.get(Param.JoinMode)) ?? JoinMode.Default;
    const flags = num(params.get(Param.RoomOptionFlags)) ?? 0, expected = strings(params.get(Param.Add));
    if (socket.data.actor) return refuse(socket, code, [Err.JoinFailedPeerAlreadyJoined, 'Already in a game']);
    if (mode > JoinMode.CreateIfNotExists) return unimplemented(socket, code, `JoinMode ${mode} (rejoin)`);
    let room: Room;
    if (code === Op.CreateGame || mode === JoinMode.CreateIfNotExists && !existing?.live) {
      // A name reserved on the Master stays its creator's for CreateGame; with JoinOrCreate, as on Photon's Game
      // server, whoever arrives first creates the room (players returning to their party room at once).
      if (existing?.live || existing && existing.creator !== userId && code === Op.CreateGame) {
        return refuse(socket, code, [Err.GameIdAlreadyExists, 'Game already exists']);
      }
      if (params.has(Param.PlayerTTL) || flags & Flag.SuppressPlayerInfo) {
        return unimplemented(socket, code, 'PlayerTtl and SuppressPlayerInfo');
      }
      const props = [...table(params.get(Param.GameProperties)) ?? []];
      if (expected.length) put(props, byteKey(Key.ExpectedUsers), { strings: expected });
      room = { name, lobby: existing?.lobby ?? '', creator: userId, live: true, props, flags,
        emptyTtl: num(params.get(Param.EmptyRoomTTL)) ?? 0, actors: [], last: 0, cache: [] };
      rooms.set(name, room);
    } else {
      if (!existing?.live) return refuse(socket, code, [Err.GameDoesNotExist, 'Game does not exist']);
      const error = refusal(existing, userId, expected);
      if (error) return refuse(socket, code, error);
      room = existing;
      const known = expectedUsers(room), missing = expected.filter(user => !known.includes(user));
      if (missing.length) put(room.props, byteKey(Key.ExpectedUsers), { strings: [...known, ...missing] });
    }
    clearTimeout(room.expiry);
    const actor: Actor = { nr: ++room.last, socket, props: [...table(params.get(Param.PlayerProperties)) ?? []],
      groups: new Set(), room };
    if (room.flags & Flag.PublishUserId) put(actor.props, byteKey(Key.UserId), userId);
    room.actors.push(actor);
    socket.data.actor = actor;
    if (!masterOf(room)) put(room.props, byteKey(Key.MasterClientId), { int: actor.nr });
    const actors = Int32Array.from(room.actors, other => other.nr);
    const others = room.actors.filter(other => other !== actor)
      .map((other): [Value, Value] => [{ int: other.nr }, { hashtable: other.props }]);
    respond(socket, code, new Map<number, Value>([[Param.ActorNr, { int: actor.nr }], [Param.ActorList, actors],
      [Param.PlayerProperties, { hashtable: others }], [Param.GameProperties, { hashtable: room.props }],
      [Param.RoomOptionFlags, { int: room.flags }]]));
    if (!(room.flags & Flag.SuppressRoomEvents)) {
      emit(room.actors, Ev.Join, new Map<number, Value>([[Param.ActorNr, { int: actor.nr }],
        [Param.PlayerProperties, { hashtable: actor.props }], [Param.ActorList, actors]]));
      record('photon-event', { room: name, code: Ev.Join, actor: actor.nr, to: [...actors] });
    }
    for (const event of room.cache) relay([actor], event.code, event.actor, event.data);
    if (room.cache.length) record('photon-cache', { room: name, actor: actor.nr, codes: room.cache.map(e => e.code) });
  }

  /** An actor leaves (Leave operation or closed socket): cache cleanup, Leave event with the new master client. */
  function leave(actor: Actor) {
    const { room } = actor, wasMaster = masterOf(room) === actor.nr;
    room.actors = room.actors.filter(other => other !== actor);
    actor.socket.data.actor = undefined;
    if (room.flags & Flag.DeleteCacheOnLeave) room.cache = room.cache.filter(event => event.actor !== actor.nr);
    const master = room.actors[0]?.nr ?? 0;
    if (wasMaster) put(room.props, byteKey(Key.MasterClientId), { int: master });
    if (!room.actors.length) return expire(room);
    if (room.flags & Flag.SuppressRoomEvents) return;
    const params = new Map<number, Value>([[Param.ActorNr, { int: actor.nr }]]);
    // OnEvent f38225 switches the master client whenever 203 is present and not 0.
    if (wasMaster) params.set(Param.MasterClientId, { int: master });
    emit(room.actors, Ev.Leave, params);
    const to = room.actors.map(other => other.nr);
    record('photon-event', { room: room.name, code: Ev.Leave, actor: actor.nr, master, to });
  }

  /** An empty room goes after its EmptyRoomTtl (236, milliseconds), at once when 0. */
  function expire(room: Room) {
    const remove = () => { if (!room.actors.length && rooms.get(room.name) === room) rooms.delete(room.name); };
    if (room.emptyTtl > 0) (room.expiry = setTimeout(remove, room.emptyTtl)).unref();
    else remove();
  }

  /** RaiseEvent: cache option, then target actors, an interest group (0 = none) or the receiver group. */
  function raise(actor: Actor, params: Params) {
    const { room } = actor, code = num(params.get(Param.Code)) ?? 0, caching = num(params.get(Param.Cache)) ?? 0;
    const data = params.get(Param.Data), list = params.get(Param.ActorList);
    const targets = list instanceof Int32Array ? [...list] : undefined;
    switch (caching) {
      case Caching.RemoveFromRoomCache:
        // Code 0 matches any event, the actor list matches senders, a Hashtable matches data holding its entries.
        room.cache = room.cache.filter(event => !((!code || event.code === code)
          && (!targets || targets.includes(event.actor)) && (data === undefined || contains(event.data, data))));
        return;
      case Caching.RemoveFromRoomCacheForActorsLeft:
        room.cache = room.cache.filter(event => !event.actor || room.actors.some(other => other.nr === event.actor));
        return;
      case Caching.AddToRoomCache: case Caching.AddToRoomCacheGlobal:
        room.cache.push({ actor: caching === Caching.AddToRoomCache ? actor.nr : 0, code, data });
        break;
      case Caching.DoNotCache: break;
      default: return unimplemented(actor.socket, Op.RaiseEvent, `EventCaching ${caching}`);
    }
    const group = num(params.get(Param.Group)) ?? 0;
    const receivers = num(params.get(Param.ReceiverGroup)) ?? Receivers.Others;
    const to = targets ? room.actors.filter(other => targets.includes(other.nr))
      : group ? room.actors.filter(other => other.groups.has(group))
      : receivers === Receivers.All ? room.actors
      : receivers === Receivers.MasterClient ? room.actors.filter(other => other.nr === masterOf(room))
      : room.actors.filter(other => other !== actor);
    relay(to, code, actor.nr, data);
  }

  /** SetProperties of the room or of actor 254, with expected values 231 as compare-and-swap. */
  function setProperties(actor: Actor, params: Params) {
    const { room } = actor, changes = table(params.get(Param.Properties)) ?? [];
    const target = num(params.get(Param.ActorNr)) ?? 0, expected = table(params.get(Param.ExpectedValues)) ?? [];
    const owner = target ? room.actors.find(other => other.nr === target) : undefined;
    const fail = (message: string) => refuse(actor.socket, Op.SetProperties, [Err.InvalidOperation, message]);
    if (!changes.length || target && !owner) return fail('No properties or no such actor');
    const props = owner?.props ?? room.props;
    if (expected.some(([key, value]) => !same(get(props, key) ?? null, value))) return fail('CAS update failed');
    const master = owner ? undefined : num(get(changes, byteKey(Key.MasterClientId)));
    if (master !== undefined && !room.actors.some(other => other.nr === master)) return fail('No such master client');
    for (const [key, value] of changes) {
      if (value === null && room.flags & Flag.DeleteNullProps) drop(props, key);
      else put(props, key, value);
    }
    respond(actor.socket, Op.SetProperties);
    if (params.get(Param.Broadcast) !== true) return;
    const all = room.flags & Flag.BroadcastPropsChangeToAll || expected.length;
    emit(all ? room.actors : room.actors.filter(other => other !== actor), Ev.PropertiesChanged,
      new Map<number, Value>([[Param.TargetActorNr, { int: target }], [Param.Properties, { hashtable: changes }],
        [Param.ActorNr, { int: actor.nr }]]));
  }

  /** ChangeGroups: removes first, then adds; an empty array means all groups (for adding, all current ones). */
  function changeGroups(actor: Actor, params: Params) {
    const remove = params.get(Param.Remove), add = params.get(Param.Add);
    if (remove instanceof Uint8Array) {
      if (remove.length) for (const group of remove) actor.groups.delete(group);
      else actor.groups.clear();
    }
    if (!(add instanceof Uint8Array)) return;
    for (const group of add.length ? add : actor.room.actors.flatMap(other => [...other.groups])) {
      actor.groups.add(group);
    }
  }

  /** One request from an authenticated Master or Game server socket. */
  function handle(socket: Socket, code: number, params: Params) {
    const { role, actor } = socket.data;
    if (role === 'master') {
      switch (code) {
        case Op.JoinLobby: return joinLobby(socket, params);
        case Op.LeaveLobby:
          socket.data.lobby = undefined;
          return respond(socket, code);
        case Op.CreateGame: return reserve(socket, code, params);
        case Op.JoinGame: return joinOnMaster(socket, params);
        case Op.JoinRandomGame: return joinRandom(socket, params);
        case Op.FindFriends: return findFriends(socket, params);
      }
    } else if (role === 'game') {
      const inRoom = (run: (actor: Actor) => void) => actor ? run(actor)
        : respond(socket, code, new Map(), Err.OperationNotAllowedInCurrentState, 'Not in a game');
      switch (code) {
        case Op.CreateGame: case Op.JoinGame: return enter(socket, code, params);
        case Op.Leave: return inRoom(actor => {
          respond(socket, code);
          leave(actor);
        });
        case Op.RaiseEvent: return inRoom(actor => raise(actor, params));
        case Op.SetProperties: return inRoom(actor => setProperties(actor, params));
        case Op.ChangeGroups: return inRoom(actor => changeGroups(actor, params));
      }
    }
    unimplemented(socket, code, `operation ${code} on ${role}`);
  }

  /** A closed socket leaves its room like a Leave operation. */
  const close = (socket: Socket) => { if (socket.data.actor) leave(socket.data.actor); };
  /**
   * AppStats, as Photon's Master sends it to an authenticated client: players in rooms, players on Master and games.
   * OnEvent f38225 (226) stores them as PlayersInRoomsCount, PlayersOnMasterCount and RoomsCount; PUN's
   * CountOfPlayers (f114085) sums the two player counts and ModeInfo.GetRatingRangeIncrement (f49907) divides by it,
   * so without them a searching room's rating range (C1, C2) steps by int.MinValue.
   */
  const appStats = (socket: Socket) => {
    const live = [...rooms.values()].filter(room => room.live);
    const onMaster = [...sockets].filter(other => other.data.role === 'master' && other.data.userId).length;
    send(socket, { kind: 'event', code: Ev.AppStats, params: new Map<number, Value>([
      [Param.PeerCount, { int: live.reduce((sum, room) => sum + room.actors.length, 0) }],
      [Param.MasterPeerCount, { int: onMaster }], [Param.GameCount, { int: live.length }]]) });
  };
  return { handle, close, appStats };
}

const byteKey = (key: number): Value => ({ byte: key });
const same = (a: Value | undefined, b: Value | undefined) => Bun.deepEquals(a, b, true);
const get = (entries: Entries, key: Value) => entries.find(([other]) => same(other, key))?.[1];
function put(entries: Entries, key: Value, value: Value): void {
  const at = entries.findIndex(([other]) => same(other, key));
  if (at < 0) entries.push([key, value]);
  else entries[at] = [key, value];
}
function drop(entries: Entries, key: Value): void {
  const at = entries.findIndex(([other]) => same(other, key));
  if (at >= 0) entries.splice(at, 1);
}

/** An integer of any width, as Convert.ToInt32 reads it. */
export function num(value: Value | undefined): number | undefined {
  const item = tagged(value);
  if (!item) return undefined;
  if ('byte' in item) return item.byte;
  if ('short' in item) return item.short;
  if ('int' in item) return item.int;
  return 'long' in item ? Number(item.long) : undefined;
}
function tagged(value: Value | undefined) {
  return value && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value) ? value : undefined;
}
const str = (value: Value | undefined) => typeof value === 'string' ? value : undefined;
function table(value: Value | undefined): Entries | undefined {
  const item = tagged(value);
  return item && 'hashtable' in item ? item.hashtable : undefined;
}
function strings(value: Value | undefined): string[] {
  const item = tagged(value);
  return item && 'strings' in item ? item.strings : [];
}

/** A cache filter: a Hashtable matches data holding each of its entries; anything else matches equal data. */
function contains(data: Value | undefined, filter: Value): boolean {
  const wanted = table(filter), held = table(data);
  return wanted && held ? wanted.every(([key, value]) => same(get(held, key), value)) : same(data, filter);
}

/**
 * A SQL lobby filter over the room's columns C0–C9, in the grammar of the two filters the client builds:
 * ConnectionProperties.GetSqlFilter (f49617, "C0 = '" + mode + "'") and GetRankedSqlFilter (f49616, "{0} >= {1} AND
 * {2} <= {3} AND {4} = '{5}'" as "<rating> >= C1 AND <rating> <= C2 AND C0 = '<mode>'"): comparisons of columns,
 * integers and quoted strings joined by AND. A missing column or a type mismatch fails the comparison, as SQL NULL
 * does. Null outside that grammar.
 */
function sqlFilter(filter: string): ((props: Entries) => boolean) | null {
  const operand = String.raw`(C\d|-?\d+|'[^']*')`;
  const term = new RegExp(String.raw`^\s*${operand}\s*(=|<>|!=|<=|>=|<|>)\s*${operand}\s*$`);
  const terms = filter.split(/\s+AND\s+/).map(text => term.exec(text));
  if (!filter.trim() || terms.some(match => !match)) return null;
  const value = (props: Entries, token: string) => token.startsWith('C') ? column(get(props, token))
    : token.startsWith("'") ? token.slice(1, -1) : Number(token);
  return props => terms.every(match => {
    const [, left, op, right] = match!, a = value(props, left!), b = value(props, right!);
    if (a === undefined || b === undefined || typeof a !== typeof b) return false;
    return op === '=' ? a === b : op === '<>' || op === '!=' ? a !== b : op === '<' ? a < b : op === '>' ? a > b
      : op === '<=' ? a <= b : a >= b;
  });
}
const column = (value: Value | undefined) => typeof value === 'string' ? value : num(value);

const open = (room: Room) => get(room.props, byteKey(Key.IsOpen)) !== false;
const visible = (room: Room) => get(room.props, byteKey(Key.IsVisible)) !== false;
const maxPlayers = (room: Room) => num(get(room.props, byteKey(Key.MaxPlayers))) ?? 0;
const masterOf = (room: Room) => num(get(room.props, byteKey(Key.MasterClientId))) ?? 0;
const expectedUsers = (room: Room) => strings(get(room.props, byteKey(Key.ExpectedUsers)));

/**
 * Why a user (reserving slots for `expected` users too) cannot join: the room is closed, the user is already in it
 * (CheckUserOnJoin, always set by RoomOptionsToOpParameters f38249), or its MaxPlayers slots, counting the expected
 * users not yet in the room, are taken.
 */
function refusal(room: Room, userId: string, expected: string[]): [number, string] | undefined {
  const present = new Set(room.actors.map(actor => actor.socket.data.userId));
  if (!open(room)) return [Err.GameClosed, 'Game closed'];
  if (present.has(userId)) return [Err.JoinFailedFoundActiveJoiner, 'User already in the game'];
  const reserved = new Set([...expectedUsers(room), ...expected].filter(user => user !== userId && !present.has(user)));
  const max = maxPlayers(room);
  if (max && room.actors.length + 1 + reserved.size > max) return [Err.GameFull, 'Game full'];
}
