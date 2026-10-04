import type { ServerWebSocket, WebSocketHandler } from 'bun';
import type { PlayerIds } from './ids';
import { decodeMessage, encodeMessage, type Message, type Params, type Value } from './protocol';
import { Err, num, Op, Param, photonRooms, type Actor } from './rooms';

/**
 * One Photon socket the page rewrote to /photon: its original host tells the role, `device` the browser. `userId` is
 * set once the socket authenticates; `lobby` (Master) and `actor` (Game server) belong to the rooms (rooms.ts).
 */
export interface PhotonSocket {
  id: number; role: 'ns' | 'master' | 'game'; device: string; userId?: string; lobby?: string; actor?: Actor;
}

/** PhotonServerSettings DevRegion; the only region this server offers. */
const REGION = 'eu';
/** Addresses handed to the client; the page's WebSocket sends any *.photon.lan host back to /photon. */
const MASTER_HOST = 'master.photon.lan', GAME_HOST = 'game.photon.lan';
const MASTER = `wss://${MASTER_HOST}:19090`, GAME = `wss://${GAME_HOST}:19091`;
/** RaiseEvents recorded per event code; the rest would flood the host's event log. */
const RAISES_RECORDED = 3;

/**
 * The local Photon server behind /photon: Name Server, Master and Game server, as the client reaches them. The Name
 * Server's UserId is the device's player ID (`ids`); rooms.ts serves the Master and Game server operations.
 */
export function photonSockets(record: (kind: string, data: unknown) => void, ids?: PlayerIds) {
  let count = 0;
  const started = performance.now(), sockets = new Set<ServerWebSocket<PhotonSocket>>();
  const raised = new Map<number, number>();
  const serverTime = () => Math.round(performance.now() - started) | 0;
  const send = (socket: ServerWebSocket<PhotonSocket>, message: Message) => {
    socket.sendBinary(encodeMessage(message));
    if (message.kind === 'response' && message.internal) return;
    record('photon-out', { id: socket.data.id, ...summary(message) });
  };
  const respond = (socket: ServerWebSocket<PhotonSocket>, code: number, params: Params, returnCode = 0,
    debugMessage: string | null = null) =>
    send(socket, { kind: 'response', internal: false, code, returnCode, debugMessage, params });
  const rooms = photonRooms({ send, record, sockets, gameServer: GAME });
  /** Whether to record a request: all but the RaiseEvents past the first few of their event code. */
  const recorded = ({ code, params }: { code: number; params: Params }) => {
    if (code !== Op.RaiseEvent) return true;
    const event = num(params.get(Param.Code)) ?? 0, seen = raised.get(event) ?? 0;
    raised.set(event, seen + 1);
    return seen < RAISES_RECORDED;
  };

  const handlers: WebSocketHandler<PhotonSocket> = {
    open(socket) {
      sockets.add(socket);
      const { id, role, device } = socket.data;
      record('photon-open', { id, role, device });
      // The client waits for the server's init (TPeer::OnConnect f149130): the Name Server has no token, and Master
      // and Game server sockets carry their init in the URL and send no init request. Without this answer, Master's
      // Authenticate arrives about 6 s after the socket opens.
      send(socket, { kind: 'init' });
    },
    message(socket, data) {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
      // An init request (type 0) is answered with the init response.
      if (bytes[0] === 0xf3 && (bytes[1]! & 0x7f) === 0) {
        record('photon-init', { id: socket.data.id, hex: Buffer.from(bytes).toString('hex') });
        return send(socket, { kind: 'init' });
      }
      let message: Message;
      try { message = decodeMessage(bytes); }
      catch (error) {
        const hex = Buffer.from(bytes).toString('hex');
        return record('photon-undecoded', { id: socket.data.id, error: String(error), hex });
      }
      if (message.kind !== 'request') return record('photon-unexpected', { id: socket.data.id, ...summary(message) });
      if (message.internal) {
        // Ping: echo the client's time (1) and add the server time (2); ReadPingResult reads both as int.
        if (message.code === 1) {
          send(socket, { kind: 'response', internal: true, code: 1, returnCode: 0, debugMessage: null,
            params: new Map([[1, message.params.get(1) ?? null], [2, { int: serverTime() }]]) });
        }
        return;
      }
      if (recorded(message)) record('photon-in', { id: socket.data.id, ...summary(message) });
      switch (message.code) {
        case Op.GetRegions:
          return respond(socket, Op.GetRegions, new Map<number, Value>([
            [Param.Region, { strings: [REGION] }], [Param.Address, { strings: [MASTER] }]]));
        case Op.Authenticate: {
          // Name Server: the Master address, the player's UserId and the token the client presents to Master/Game
          // ("Authenticate without Token is only allowed on Name Server", CallAuthenticate f38152).
          const { id, role, device } = socket.data;
          if (role === 'ns') {
            const userId = socket.data.userId = ids && device ? ids.assign(device) : device || `socket-${id}`;
            return respond(socket, Op.Authenticate, new Map<number, Value>([[Param.Address, MASTER],
              [Param.UserId, userId], [Param.Token, `lan:${userId}`]]));
          }
          const token = message.params.get(Param.Token);
          if (typeof token !== 'string' || !token.startsWith('lan:')) {
            return respond(socket, Op.Authenticate, new Map(), Err.InvalidAuthentication, 'Unknown token');
          }
          socket.data.userId = token.slice('lan:'.length);
          respond(socket, Op.Authenticate, new Map<number, Value>([[Param.UserId, socket.data.userId]]));
          return role === 'master' ? rooms.appStats(socket) : undefined;
        }
      }
      if (socket.data.role !== 'ns' && !socket.data.userId) {
        return respond(socket, message.code, new Map(), Err.OperationNotAllowedInCurrentState, 'Not authenticated');
      }
      rooms.handle(socket, message.code, message.params);
    },
    close(socket, code, reason) {
      sockets.delete(socket);
      rooms.close(socket);
      record('photon-close', { id: socket.data.id, code, reason });
    },
  };
  /** A new socket from the rewritten URL's query: `server` is the original host, `device` the browser (page). */
  const next = (query: URLSearchParams): PhotonSocket => {
    const host = (query.get('server') ?? '').split(':')[0]!;
    const role = host === MASTER_HOST ? 'master' : host === GAME_HOST ? 'game' : 'ns';
    return { id: ++count, role, device: query.get('device') ?? '' };
  };
  return { handlers, next };
}

/** A readable record of a message: kind, code and parameters (binary values as hex, bounded). */
function summary(message: Message) {
  const value = (item: Value): unknown => item instanceof Uint8Array ? Buffer.from(item).toString('hex').slice(0, 200)
    : ArrayBuffer.isView(item) ? Array.from(item as Int32Array) : typeof item === 'bigint' ? String(item)
    : Array.isArray(item) ? item.map(value) : item && typeof item === 'object' ? JSON.parse(JSON.stringify(item,
      (_, v) => typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v))
    : item;
  const params = 'params' in message ? Object.fromEntries([...message.params].map(([key, item]) => [key, value(item)]))
    : undefined;
  return { kind: message.kind, code: 'code' in message ? message.code : undefined,
    returnCode: 'returnCode' in message ? message.returnCode : undefined, params };
}
