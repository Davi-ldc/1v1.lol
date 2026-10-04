export interface PointerLockState { event: string; mode: string; locked: boolean; reason?: string }

/**
 * Page shims installed before the loader: network guards for the personal browser (the isolated probe adds an OS
 * network namespace), raw pointer input, and the framework's auth calls answered with the recovered Error reply.
 * With `photon`, Photon's sockets go to the local server instead of failing. Returns the flush that delivers pending
 * auth replies once the native adapters are installed.
 */
export function installBrowser(canvas: HTMLCanvasElement, report: (state: PointerLockState) => void,
  photon?: { device: string }) {
  installGuards(photon);
  installRawPointerLock(canvas, report);
  return installAuth();
}

/** Photon's Name Server and the Master/Game addresses the local server hands out (src/host/photon/). */
const PHOTON_HOSTS = /(^|\.)(photonengine\.io|exitgames\.com|photon\.lan)$/;

function installGuards(photon?: { device: string }) {
  // Global the original page defines before the framework reads it.
  (window as unknown as { lockedOccured: boolean }).lockedOccured = false;
  window.open = () => { console.warn('LOCAL_WEB_BLOCKED', 'popup'); return null; };
  for (const name of ['WebSocket', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) {
    // The isolated probe already defines some of them as non-configurable.
    if (Object.getOwnPropertyDescriptor(window, name)?.configurable === false) continue;
    if (!(name in window)) continue;
    const value = name === 'WebSocket' && photon ? localPhotonSocket(photon)
      : class { constructor() { throw new Error(`Local offline client: ${name} unavailable`); } };
    Object.defineProperty(window, name, { configurable: false, writable: false, value });
  }
}

/**
 * The page's WebSocket for the lan profile: a Photon URL becomes ws(s)://<this origin>/photon with its original
 * query, its host (`server`) and this browser's install ID (`device`); any other socket (Nucleus, CDN) still fails.
 */
function localPhotonSocket(player: { device: string }) {
  const Original = window.WebSocket;
  return class extends Original {
    constructor(url: string | URL, protocols?: string | string[]) {
      const target = new URL(url);
      if (!PHOTON_HOSTS.test(target.hostname)) {
        throw new Error(`Local offline client: WebSocket ${target.host} unavailable`);
      }
      const local = new URL('/photon', location.href);
      local.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      local.search = target.search;
      local.searchParams.set('server', target.host);
      local.searchParams.set('device', player.device);
      console.info('LOCAL_PHOTON_SOCKET', target.host, target.search);
      super(local, protocols);
    }
  };
}

/**
 * Requests raw (unadjusted) mouse input for the canvas; the native deltas, sensitivity and camera code are
 * untouched. Only NotSupportedError falls back to adjusted input; permission/focus/Escape errors never retry.
 */
function installRawPointerLock(canvas: HTMLCanvasElement, report: (state: PointerLockState) => void) {
  const original = canvas.requestPointerLock.bind(canvas);
  let rawSupported = true, pending: Promise<void> | undefined, mode = 'not-requested';
  const emit = (event: string, reason?: string) =>
    report({ event, mode, locked: document.pointerLockElement === canvas, ...(reason ? { reason } : {}) });
  const rejected = (error: unknown) => emit('rejected', String(error));
  canvas.requestPointerLock = (options = {}) => {
    if (document.pointerLockElement === canvas) return Promise.resolve();
    if (pending) return pending;
    const raw = rawSupported && options.unadjustedMovement !== false;
    mode = raw ? 'raw-requested' : 'adjusted';
    emit('request');
    let result: Promise<void> | void;
    try { result = original(raw ? { ...options, unadjustedMovement: true } : options); }
    catch (error) { result = Promise.reject(error); }
    pending = Promise.resolve(result).catch(async (error: unknown) => {
      if (raw && typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotSupportedError') {
        rawSupported = false;
        mode = 'adjusted-fallback';
        emit('raw-unsupported', String(error));
        try { await original({ ...options, unadjustedMovement: false }); }
        catch (fallbackError) { rejected(fallbackError); }
      } else { rejected(error); }
    }).then(() => { emit('request-finished'); }).finally(() => { pending = undefined; });
    return pending;
  };
  document.addEventListener('pointerlockchange', () => emit('change'));
  document.addEventListener('pointerlockerror', () => emit('browser-error'));
}

/**
 * The page functions the framework calls instead of Firebase. Each checkIfConnected gets the recovered Error reply
 * (Result 2) on PersistentObjects.OnGotWebResponse; no account or token exists (docs/reference/boot.md). Native
 * DidInit may still become true; that is not a login.
 */
function installAuth() {
  let pending = 0;
  const flush = () => {
    const unity = window.unityInstance;
    if (!unity) return;
    while (pending > 0) {
      pending--;
      unity.SendMessage('PersistentObjects', 'OnGotWebResponse', JSON.stringify({ Result: 2,
        Response: 'LOCAL_OFFLINE_UNAVAILABLE: authentication service is not provided by this local adapter' }));
      console.warn('LOCAL_AUTH_ADAPTER', 'Error response dispatched');
    }
  };
  Object.assign(window, {
    onUnityReady: () => console.info('LOCAL_HOST_OBSERVER', 'onUnityReady'),
    initializeFireBase: () => console.warn('LOCAL_AUTH_ADAPTER', 'initializeFireBase: local failure provider'),
    checkIfConnected: () => {
      pending++;
      console.warn('LOCAL_AUTH_ADAPTER', 'checkIfConnected');
      setTimeout(flush, 0); // Reply outside the current managed call.
    },
  });
  return flush;
}
