import { readlink } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import type { RecordEvent } from './events';

const parentNamespaceKey = 'ORIGINAL_CLIENT_PARENT_NETNS';

export async function enterNetworkNamespace(script: string, args: string[]) {
  if (process.env[parentNamespaceKey]) return;
  if (process.platform !== 'linux') throw new Error('A Linux network namespace is required; no unisolated fallback.');
  const unshare = Bun.which('unshare');
  const ip = Bun.which('ip');
  if (!unshare || !ip) throw new Error('Missing unshare/ip; refusing to launch the original client.');
  const parent = await readlink('/proc/self/ns/net');
  const child = Bun.spawn([
    unshare, '--user', '--map-root-user', '--net', '--',
    'sh', '-c', '"$1" link set lo up && shift && exec "$@"', 'offline-probe',
    ip, process.execPath, script, ...args,
  ], { env: { ...process.env, [parentNamespaceKey]: parent }, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
  const terminate = () => child.kill('SIGTERM');
  process.once('SIGINT', terminate);
  process.once('SIGTERM', terminate);
  process.exit(await child.exited);
}

export async function verifyNetworkNamespace() {
  const parent = process.env[parentNamespaceKey];
  const current = await readlink('/proc/self/ns/net');
  if (!parent || current === parent) throw new Error('Network namespace not isolated from launcher.');
  const ip = Bun.which('ip');
  if (!ip) throw new Error('Cannot verify network interfaces without ip.');
  const inspect = async (args: string[]) => {
    const process = Bun.spawn([ip, '-j', ...args], { stdout: 'pipe', stderr: 'pipe' });
    const [text, error, code] = await Promise.all([
      new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
    ]);
    if (code !== 0) throw new Error(`Network inspection failed: ${error}`);
    return JSON.parse(text) as Array<Record<string, unknown>>;
  };
  const links = await inspect(['link', 'show']);
  const routes = [...await inspect(['route', 'show', 'table', 'all']),
    ...await inspect(['-6', 'route', 'show', 'table', 'all'])];
  if (links.length !== 1 || links[0].ifname !== 'lo' ||
      !(links[0].flags as string[]).includes('UP') ||
      routes.some(route => route.dev !== 'lo' || route.gateway || route.dst === 'default')) {
    throw new Error('Namespace has a non-loopback interface/route or loopback is down.');
  }
  return { kind: 'linux-user-and-network-namespace', parent, current, interfaces: ['lo'], routes };
}

export type RendererMode = 'software' | 'auto';

export async function launchGuardedBrowser(origin: string, record: RecordEvent,
  options: { headless?: boolean; renderer?: RendererMode } = {}) {
  await verifyNetworkNamespace();
  if (options.headless === false && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error('A visible browser requires a Linux graphical display; no unisolated fallback.');
  }
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(),
    headless: options.headless ?? true,
    args: ['--no-sandbox', '--disable-dev-shm-usage',
      ...options.renderer === 'auto' ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      '--disable-background-networking', '--disable-component-update', '--disable-domain-reliability',
      '--disable-sync', '--no-pings', '--safebrowsing-disable-auto-update',
      '--disable-client-side-phishing-detection', '--proxy-server=http://127.0.0.1:9',
      '--proxy-bypass-list=localhost;127.0.0.1',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 760 },
      serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', async route => {
      const request = route.request();
      const allowed = new URL(request.url()).origin === origin;
      record(allowed ? 'request-allowed' : 'request-blocked', {
        url: request.url(), method: request.method(), resourceType: request.resourceType(),
      });
      if (allowed) await route.continue();
      else await route.abort('blockedbyclient');
    });
    // The only WebSocket allowed is the host's own Photon endpoint (lan profile); every other one is closed.
    const host = new URL(origin).host;
    await context.routeWebSocket(url => url.host !== host || url.pathname !== '/photon', socket => {
      record('websocket-blocked', { url: socket.url() });
      socket.close({ code: 1008, reason: 'Offline probe forbids WebSocket connections' });
    });
    await context.addInitScript(() => {
      window.addEventListener('securitypolicyviolation', event =>
        console.warn('PROBE_CSP_BLOCKED', event.blockedURI, event.effectiveDirective));
      window.open = (...args) => { console.warn('PROBE_POPUP_BLOCKED', ...args); return null; };
      for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) {
        if (name in globalThis) Object.defineProperty(globalThis, name, {
          configurable: false, writable: false,
          value: class { constructor() { throw new Error(`Offline probe: ${name} disabled`); } },
        });
      }
    });
    return { browser, context };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/** Canaries: a guarded browser must fail to reach a loopback server outside its origin by every channel. */
export async function checkIsolation(renderer: RendererMode = 'software') {
  let canaryRequests = 0;
  const canary = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    canaryRequests++;
    return new Response('CANARY: request should never reach this server');
  } });
  const fixture = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    if (new URL(request.url).pathname === '/worker.js') {
      return new Response(`onmessage = async event => {
        try { await fetch(event.data, {mode:'no-cors'}); postMessage('unexpected-success'); }
        catch { postMessage('blocked'); }
      };`, { headers: { 'Content-Type': 'application/javascript' } });
    }
    return new Response('<!doctype html><title>Local isolation canary</title>',
      { headers: { 'Content-Type': 'text/html' } });
  } });
  let guarded: Awaited<ReturnType<typeof launchGuardedBrowser>> | undefined;
  try {
    const origin = `http://localhost:${fixture.port}`;
    const target = `http://127.0.0.1:${canary.port}/blocked`;
    guarded = await launchGuardedBrowser(origin, () => {}, { renderer });
    const page = await guarded.context.newPage();
    await page.goto(origin);
    const attempts = await page.evaluate(async target => {
      const result: Record<string, boolean> = {};
      try { await fetch(target, { mode: 'no-cors' }); result.fetchBlocked = false; }
      catch { result.fetchBlocked = true; }
      result.workerFetchBlocked = await new Promise<boolean>(resolve => {
        const worker = new Worker('/worker.js');
        const timer = setTimeout(() => { worker.terminate(); resolve(false); }, 4000);
        worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data === 'blocked'); };
        worker.onerror = () => { clearTimeout(timer); worker.terminate(); resolve(false); };
        worker.postMessage(target);
      });
      result.webSocketBlocked = await new Promise<boolean>(resolve => {
        const ws = new WebSocket(target.replace('http:', 'ws:'));
        const timer = setTimeout(() => { ws.close(); resolve(false); }, 4000);
        ws.onopen = () => { clearTimeout(timer); ws.close(); resolve(false); };
        ws.onerror = ws.onclose = () => { clearTimeout(timer); resolve(true); };
      });
      for (const name of ['RTCPeerConnection', 'WebTransport']) {
        const ctor = (globalThis as unknown as Record<string, new (...args: unknown[]) => unknown>)[name];
        try { if (ctor) new ctor('https://127.0.0.1:9'); result[`${name}Blocked`] = !ctor; }
        catch (error) { result[`${name}Blocked`] = String(error).includes('Offline probe:'); }
      }
      result.popupBlocked = window.open(target) === null;
      return result;
    }, target);
    let navigationBlocked = false;
    try { await page.goto(target, { timeout: 5000 }); } catch { navigationBlocked = true; }
    const result = { ...attempts, navigationBlocked, canaryRequests,
      ok: Object.values(attempts).every(Boolean) && navigationBlocked && canaryRequests === 0 };
    if (!result.ok) throw new Error(`Isolation canary failed: ${JSON.stringify(result)}`);
    return result;
  } finally {
    await guarded?.browser.close();
    fixture.stop(true);
    canary.stop(true);
  }
}
