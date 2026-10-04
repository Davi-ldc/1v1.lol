import { expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { playerIds } from '../../src/host/photon/ids';
import { decodeMessage, encodeMessage, type Message, type Value } from '../../src/host/photon/protocol';
import { photonSockets, type PhotonSocket } from '../../src/host/photon/server';

type Param = [number, Value];
type Response = Extract<Message, { kind: 'response' }>;
type Event = Extract<Message, { kind: 'event' }>;
const APP_ID = '748df142-c087-424c-b6ca-b57f4b0db24d', GAME = 'wss://game.photon.lan:19091';
const key = (n: number): Value => ({ byte: n }), int = (n: number): Value => ({ int: n });
const table = (...entries: [Value, Value][]): Value => ({ hashtable: entries });
const fields = (message: Message) => 'params' in message ? Object.fromEntries(message.params) : {};
const ok = (code: number): Response =>
  ({ kind: 'response', internal: false, code, returnCode: 0, debugMessage: null, params: new Map() });
const event = (code: number, ...params: Param[]): Event => ({ kind: 'event', code, params: new Map(params) });

/** The room options and player properties the client sends to the Game server (f38249, f38252). */
function roomOptions(nick: string, { max = 0, flags = 1 | 2 | 8 | 32, visible = false, custom = [] as [Value, Value][] }
  = {}): Param[] {
  const props: [Value, Value][] = [[key(253), true], [key(254), visible], [key(250), { strings: [] }], ...custom];
  if (max) props.push([key(255), int(max)]);
  return [[249, table([key(255), nick])], [250, true], [248, { hashtable: props }], [241, true], [232, true],
    [191, int(flags)]];
}

/** A local server whose clients are fake sockets; frames sent to them are decoded. */
async function lan() {
  const log: { kind: string; data: unknown }[] = [];
  const { handlers, next } = photonSockets((kind, data) => log.push({ kind, data }), await playerIds());
  function connect(server: string, device: string) {
    let frames: Message[] = [];
    const socket = { data: next(new URLSearchParams({ server, device })),
      sendBinary: (bytes: Uint8Array) => frames.push(decodeMessage(bytes)) };
    const ws = socket as unknown as ServerWebSocket<PhotonSocket>;
    handlers.open!(ws);
    function take<K extends Message['kind']>(kind: K) {
      const taken = frames.filter(frame => frame.kind === kind);
      frames = frames.filter(frame => frame.kind !== kind);
      return taken as Extract<Message, { kind: K }>[];
    }
    /** Every response to one request (RaiseEvent and ChangeGroups get none). */
    const request = (code: number, ...params: Param[]) => {
      handlers.message!(ws, Buffer.from(encodeMessage({ kind: 'request', internal: false, code,
        params: new Map(params) })));
      return take('response');
    };
    const op = (code: number, ...params: Param[]) => request(code, ...params)[0]!;
    return { take, request, op, events: () => take('event'), close: () => handlers.close!(ws, 1000, '') };
  }
  /** A browser: Name Server token, then Master; `enter` goes through Master to the Game server. */
  function player(device: string) {
    const ns = connect('ns.photonengine.io', device);
    const auth = ns.op(230, [220, '0.306_2.42'], [224, APP_ID], [210, 'eu']);
    const token = auth.params.get(221)!, master = connect('master.photon.lan:19090', device);
    expect(master.op(230, [221, token]).returnCode).toBe(0);
    const enter = (code: number, name: string | undefined, game: Param[], onMaster: Param[] = []) => {
      const found = master.op(code, ...name ? [[255, name] as Param] : [], ...onMaster);
      const room = found.params.get(255) as string, client = connect('game.photon.lan:19091', device);
      expect(fields(found)).toEqual({ 230: GAME, 255: name ?? room });
      expect(client.op(230, [221, token]).returnCode).toBe(0);
      return { room, game: client, response: client.op(code, [255, room], ...game) };
    };
    return { ns, auth, master, enter };
  }
  /** Players in one room created by the first; their events so far are drained. */
  function party(devices: string[], options: Parameters<typeof roomOptions>[1] = {}) {
    const players = devices.map(player);
    const { room, game } = players[0].enter(227, undefined, roomOptions(devices[0], options));
    const games = [game, ...players.slice(1).map((p, i) => p.enter(226, room, roomOptions(devices[i + 1])).game)];
    for (const client of games) client.events();
    return { room, players, games };
  }
  return { log, connect, player, party };
}

test('two clients go Name Server, Master and Game server into one room', async () => {
  const { player } = await lan();
  const ana = player('device-a'), bia = player('device-b');
  expect(ana.ns.take('init')).toEqual([{ kind: 'init' }]);
  expect(ana.master.take('init')).toEqual([{ kind: 'init' }]);
  expect(fields(ana.auth)).toEqual({ 230: 'wss://master.photon.lan:19090', 225: '0001', 221: 'lan:0001' });
  expect(fields(bia.auth)[225]).toBe('0002');
  // AppStats after the Master's Authenticate: players in rooms, on Master and games (OnEvent f38225).
  expect(bia.master.events()).toEqual([event(226, [229, int(0)], [227, int(2)], [228, int(0)])]);

  const { room, game: a, response: created } = ana.enter(227, undefined, roomOptions('Ana', { max: 2 }));
  const anaProps = table([key(255), 'Ana'], [key(253), '0001']);
  expect(fields(created)).toEqual({ 254: int(1), 252: Int32Array.of(1), 249: table(), 191: int(43),
    248: table([key(253), true], [key(254), false], [key(250), { strings: [] }], [key(255), int(2)],
      [key(248), int(1)]) });
  expect(a.events()).toEqual([event(255, [254, int(1)], [249, anaProps], [252, Int32Array.of(1)])]);

  const { game: b, response: joined } = bia.enter(226, room, roomOptions('Bia'));
  expect(fields(joined)).toEqual({ 254: int(2), 252: Int32Array.of(1, 2), 249: table([int(1), anaProps]),
    191: int(43), 248: fields(created)[248] });
  const join = event(255, [254, int(2)], [249, table([key(255), 'Bia'], [key(253), '0002'])],
    [252, Int32Array.of(1, 2)]);
  expect(a.events()).toEqual([join]);
  expect(b.events()).toEqual([join]);
});

test('RaiseEvent reaches others, all, the master client, target actors and interest groups', async () => {
  const { party } = await lan();
  const { games: [a, b, c] } = party(['a', 'b', 'c']);
  const raise = (from: typeof a, code: number, ...params: Param[]) => {
    expect(from.request(253, [244, key(code)], [245, 'data'], ...params)).toEqual([]);
    return [a, b, c].map(client => client.events().map(event => event.code));
  };
  expect(raise(a, 1)).toEqual([[], [1], [1]]);
  expect(raise(b, 2, [246, key(1)])).toEqual([[2], [2], [2]]);
  expect(raise(c, 3, [246, key(2)])).toEqual([[3], [], []]);
  expect(raise(a, 4, [252, Int32Array.of(3)])).toEqual([[], [], [4]]);
  expect(raise(a, 5, [240, key(0)])).toEqual([[], [5], [5]]);
  expect(b.request(248, [238, Uint8Array.of(7)])).toEqual([]);
  expect(raise(a, 6, [240, key(7)])).toEqual([[], [6], []]);
  c.request(248, [238, new Uint8Array()]);
  expect(raise(a, 8, [240, key(7)])).toEqual([[], [8], [8]]);
  a.request(253, [244, key(9)], [245, 'hi']);
  expect(b.events()).toEqual([event(9, [254, int(1)], [245, 'hi'])]);
});

test('PUN instantiations stay in the room cache for late joiners until removed', async () => {
  const { party, player } = await lan();
  const { room, games: [a, b] } = party(['a', 'b']);
  const spawn = (id: number, prefab: string) => table([key(0), prefab], [key(6), int(500)], [key(7), int(id)]);
  const reload = table([key(0), int(1001)], [key(3), 'Reload']);
  const raise = (from: typeof a, code: number, cache: number, data: Value) =>
    from.request(253, [244, key(code)], [245, data], [247, key(cache)]);
  const late = (device: string) => player(device).enter(226, room, roomOptions(device)).game.events()
    .map(event => [event.code, event.params.get(254), event.params.get(245)]);
  // SendInstantiate f114149: AddToRoomCache, or AddToRoomCacheGlobal for room objects; an AllBuffered RPC (200).
  raise(a, 202, 4, spawn(1001, 'Player'));
  raise(a, 202, 5, spawn(2001, 'Crate'));
  raise(b, 200, 4, reload);
  expect(b.events().map(event => event.code)).toEqual([202, 202]);
  expect(late('c')).toEqual([[255, int(3), undefined], [202, int(1), spawn(1001, 'Player')],
    [202, int(0), spawn(2001, 'Crate')], [200, int(2), reload]]);
  // ServerCleanInstantiateAndDestroy f114154 and OpCleanRpcBuffer f114156 remove by a filter and send nothing.
  b.events();
  raise(a, 202, 6, table([key(7), int(1001)]));
  raise(a, 200, 6, table([key(0), int(1001)]));
  expect(b.events()).toEqual([]);
  expect(late('d')).toEqual([[255, int(4), undefined], [202, int(0), spawn(2001, 'Crate')]]);
  // DeleteCacheOnLeave drops the leaver's events, not global ones; code 0 with actors drops all of theirs (f114198).
  raise(a, 202, 4, spawn(1002, 'Player'));
  raise(b, 202, 4, spawn(1003, 'Player'));
  a.close();
  b.request(253, [244, key(0)], [247, key(6)], [252, Int32Array.of(2)]);
  expect(late('e')).toEqual([[255, int(5), undefined], [202, int(0), spawn(2001, 'Crate')]]);
});

test('SetProperties broadcasts PropertiesChanged; CAS goes to everyone and can switch the master client', async () => {
  const { party } = await lan();
  const { games: [a, b] } = party(['a', 'b'], { flags: 1 | 2 });
  const changed = (target: number, props: Value, sender: number) =>
    event(253, [253, int(target)], [251, props], [254, int(sender)]);
  expect(a.request(252, [251, table(['map', 'dust'])], [250, true])).toEqual([ok(252)]);
  expect(a.events()).toEqual([]);
  expect(b.events()).toEqual([changed(0, table(['map', 'dust']), 1)]);
  b.request(252, [251, table(['hp', int(90)])], [254, int(2)], [250, true]);
  expect(a.events()).toEqual([changed(2, table(['hp', int(90)]), 2)]);
  expect(b.events()).toEqual([]);
  // Room.SetMasterClient: the new 248 with the current one expected.
  const master: Param[] = [[251, table([key(248), int(2)])], [250, true], [231, table([key(248), int(1)])]];
  expect(a.request(252, ...master)).toEqual([ok(252)]);
  expect(a.events()).toEqual([changed(0, table([key(248), int(2)]), 1)]);
  expect(b.events()).toEqual([changed(0, table([key(248), int(2)]), 1)]);
  expect(a.op(252, ...master).returnCode).toBe(-2);
  a.request(253, [244, key(1)], [246, key(2)]);
  expect(b.events().map(event => event.code)).toEqual([1]);

  // BroadcastPropsChangeToAll (flag 32): the sender gets its own change back.
  const { games: [c, d] } = party(['c', 'd']);
  c.request(252, [251, table(['map', 'nuke'])], [250, true]);
  expect(c.events()).toEqual([changed(0, table(['map', 'nuke']), 1)]);
  expect(d.events()).toEqual([changed(0, table(['map', 'nuke']), 1)]);
});

test('Leave hands the master client to the lowest remaining actor; the empty room goes', async () => {
  const { party } = await lan();
  const { room, players, games: [a, b, c] } = party(['a', 'b', 'c']);
  const left = (actor: number, master?: number) =>
    event(254, [254, int(actor)], ...master ? [[203, int(master)] as Param] : []);
  expect(a.request(254)).toEqual([ok(254)]);
  expect(b.events()).toEqual([left(1, 2)]);
  expect(c.events()).toEqual([left(1, 2)]);
  c.close();
  expect(b.events()).toEqual([left(3)]);
  b.close();
  expect(players[0].master.op(226, [255, room]).returnCode).toBe(32758);
});

test('JoinOrCreate: whoever reaches the Game server first creates the room, the other joins it', async () => {
  const { connect, player } = await lan();
  const [a, b] = ['a', 'b'].map(player), joinOrCreate: Param[] = [[255, '12345'], [215, key(1)]];
  for (const p of [a, b]) expect(fields(p.master.op(226, ...joinOrCreate))).toEqual({ 230: GAME, 255: '12345' });
  const game = (p: typeof a, device: string) => {
    const client = connect('game.photon.lan:19091', device);
    expect(client.op(230, [221, p.auth.params.get(221)!]).returnCode).toBe(0);
    return client;
  };
  const [first, second] = [game(b, 'b'), game(a, 'a')];
  expect(fields(first.op(226, ...joinOrCreate, ...roomOptions('b')))[254]).toEqual(int(1));
  expect(fields(second.op(226, ...joinOrCreate, ...roomOptions('a')))[254]).toEqual(int(2));
});

test('FindFriends reports who is online and in which room', async () => {
  const { party, player } = await lan();
  const { room } = party(['a']);
  player('b');
  const c = player('c');
  expect(fields(c.master.op(222, [1, { strings: ['0001', '0002', '0404'] }]))).toEqual({
    1: { bools: [true, true, false] }, 2: { strings: [room, '', ''] } });
  expect(fields(c.master.op(222, [1, { strings: ['0001'] }], [2, int(2)]))).toEqual({
    1: { bools: [true] }, 2: { strings: [''] } });
});

test('full, closed and missing rooms refuse joins; unimplemented requests are refused and recorded', async () => {
  const { player, log } = await lan();
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(player);
  const join = (p: typeof a, room: string) => p.master.op(226, [255, room]).returnCode;
  // The party leader's game room: two slots, one reserved for 0003 (ExpectedUsers, OpCreateRoom f38251).
  const reserved: Param[] = [[238, { strings: ['0003'] }]];
  const { room, game } = a.enter(227, undefined, [...reserved, ...roomOptions('a', { max: 2 })], reserved);
  expect(join(b, room)).toBe(32765);
  expect(c.enter(226, room, roomOptions('c')).response.returnCode).toBe(0);
  expect(join(d, room)).toBe(32765);
  game.request(252, [251, table([key(253), false])], [250, true]);
  expect(join(d, room)).toBe(32764);
  expect(join(d, 'missing')).toBe(32758);
  expect(b.master.op(227, [255, room]).returnCode).toBe(32766);
  expect(b.master.op(225).returnCode).toBe(32760);

  // JoinRandomGame in the client's SQL lobby (ConnectionProperties .cctor f49618: "1v1Lobby", SqlLobby).
  const lobby: Param[] = [[213, '1v1Lobby'], [212, key(2)]];
  expect(b.master.op(229, ...lobby)).toEqual(ok(229));
  expect(d.master.op(229, ...lobby)).toEqual(ok(229));
  const duel = b.enter(227, 'duel', roomOptions('b', { max: 2, visible: true, custom: [['C0', 'duel']] }));
  expect(duel.response.returnCode).toBe(0);
  expect(d.master.op(225, [248, table(['C0', 'ffa'])]).returnCode).toBe(32760);
  const expected = table(['C0', 'duel'], [key(255), key(2)]);
  expect(fields(d.master.op(225, [248, expected]))).toEqual({ 230: GAME, 255: 'duel' });

  // The SQL lobby filters of ConnectionProperties.GetSqlFilter f49617 and GetRankedSqlFilter f49616.
  expect(fields(d.master.op(225, [245, "C0 = 'duel'"]))).toEqual({ 230: GAME, 255: 'duel' });
  expect(d.master.op(225, [245, "C0 = 'ffa'"]).returnCode).toBe(32760);
  duel.game.request(252, [251, table(['C1', int(-10)], ['C2', int(10)])], [250, true]);
  const ranked = (rating: number) => d.master.op(225, [245, `${rating} >= C1 AND ${rating} <= C2 AND C0 = 'duel'`]);
  expect(fields(ranked(0))).toEqual({ 230: GAME, 255: 'duel' });
  expect(ranked(11).returnCode).toBe(32760);
  expect(d.master.op(225, [245, "C0 LIKE 'd%'"]).returnCode).toBe(-2);
  expect(d.master.op(229).returnCode).toBe(-2);
  expect(duel.game.op(251).returnCode).toBe(-2);
  expect(log.filter(entry => entry.kind === 'photon-unimplemented').map(entry => entry.data)).toMatchObject([
    { role: 'master', code: 225 }, { role: 'master', code: 229 }, { role: 'game', code: 251 }]);
});
