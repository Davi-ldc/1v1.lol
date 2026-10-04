import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { bundles, CATALOG, deriveCatalog, PROJECT_ROOT, readPinned, SETTINGS, sha256 } from './build/inputs';
import { profiles, type Profile } from './profiles';
import { playerIds } from './photon/ids';
import { photonSockets, type PhotonSocket } from './photon/server';
import { deriveWasm } from './wasm';

const csp = ["default-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:", "connect-src 'self'",
  "worker-src 'self' blob:", "img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline'", "media-src 'self' blob:",
  "frame-src 'none'", "object-src 'none'", "form-action 'none'", "base-uri 'none'"].join('; ');
const headers = { 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' };
const refuse = (status: number, reason: string) => new Response(reason, { status, headers });
const projectFile = (path: string) => Bun.file(resolve(PROJECT_ROOT, path));
type Body = string | Uint8Array<ArrayBuffer> | ReturnType<typeof Bun.file>;
/** A validator per served body: preserved files by size and time, derived bodies by content. */
const etag = (body: Body) => typeof body === 'string' || body instanceof Uint8Array
  ? `"${sha256(body).slice(0, 32)}"` : `"${body.size.toString(16)}-${body.lastModified.toString(16)}"`;
interface Variant { body: Body; etag: string }
const variant = (body: Body): Variant => ({ body, etag: etag(body) });
const compress = promisify(gzip);

/**
 * A body's gzip coding, the only one a tunnel's edge asks the origin for (Cloudflare sends `Accept-Encoding: gzip` and
 * decodes br/zstd itself): the original .unityweb holding those bytes, else the body compressed once, off the event
 * loop (startHost starts them all at once).
 */
function gzipOf(body: Body, original?: Body): (() => Promise<Variant>) | undefined {
  if (original) {
    const ready = Promise.resolve(variant(original));
    return () => ready;
  }
  if (typeof body !== 'string' && !(body instanceof Uint8Array)) return undefined;
  let made: Promise<Variant> | undefined;
  return () => made ??= compress(body, { level: 9 }).then(bytes => variant(new Uint8Array(bytes)));
}

/** A page bundle: `entry` (a project path) as a deterministic IIFE. */
async function bundle(entry: string) {
  const build = await Bun.build({ entrypoints: [resolve(PROJECT_ROOT, entry)], target: 'browser', format: 'iife',
    root: PROJECT_ROOT });
  if (!build.success) throw new AggregateError(build.logs, `Bundle ${entry} failed.`);
  const script = await build.outputs[0]!.text();
  return { script, sha256: sha256(script) };
}
/** The page bundle (src/page/main.ts), served at /local/page.js. */
export const buildPage = () => bundle('src/page/main.ts');

const style = 'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#101526}' +
  'canvas{display:block;width:100%;height:100%}#local-status{position:fixed;top:12px;left:12px;z-index:10;' +
  'color:white;background:#101526dd;padding:10px;font:14px sans-serif;max-width:70vw}';

/** The custom heroes' slots (HEROES in heroes/page/ids.ts); none when this checkout does not have the unit. */
export async function heroIds() {
  const ids = resolve(PROJECT_ROOT, 'heroes/page/ids.ts');
  return await Bun.file(ids).exists() ? (await import(ids) as { HEROES: readonly string[] }).HEROES : [];
}

/**
 * Adaptation: the custom heroes' directory, kept out of git (heroes/README.md). `dir` holds one subdirectory per
 * hero, named by its slot (heroIds); a slot without one is not offered. Returns each present hero's directory by slot.
 */
export async function heroDirectories(dir: string) {
  const known = await heroIds(), names: string[] = [];
  if (!known.length) throw new Error('--heroes needs heroes/page, which this checkout does not have.');
  for (const name of await readdir(dir)) if ((await stat(resolve(dir, name))).isDirectory()) names.push(name);
  const unknown = names.filter(name => !known.includes(name));
  if (unknown.length) throw new Error(`Unknown hero directory in ${dir}: ${unknown.join(', ')}; the slots are ` +
    `${known.join(', ')}.`);
  const present = known.filter(id => names.includes(id));
  if (!present.length) throw new Error(`${dir} has no hero directory (${known.join(', ')}).`);
  return Object.fromEntries(present.map(id => [id, resolve(dir, id)]));
}

/** A slot's entry in names.json (heroes/README.md): the display name, champion and skin IDs, the password prompt. */
interface HeroNames { name: string; champion: string; skin: string; password?: string }
const NAME_FIELDS = ['name', 'champion', 'skin', 'password'];

/**
 * The heroes directory's names.json (heroes/README.md), private like the hero files: every key a known slot, each
 * present slot with an entry, each entry with `name`, `champion` and `skin` and at most a `password` prompt, all
 * strings. The champion is `lol.1v1.champions.<x>` and its skin `lol.1v1.playerskins.pack.<x>.default`, the shape by
 * which the catalogs adapter gives a champion its default skin (src/page/adapters/catalogs.ts).
 */
async function heroNames(dir: string, present: string[]) {
  const file = Bun.file(resolve(dir, 'names.json'));
  if (!await file.exists()) throw new Error(`${dir} has hero directories but no names.json (heroes/README.md).`);
  const bytes = await file.bytes(), known = await heroIds();
  const names = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, Record<string, unknown>>;
  if (typeof names !== 'object' || names === null || Array.isArray(names)) {
    throw new Error(`${dir}/names.json is not an object by slot.`);
  }
  const unknown = Object.keys(names).filter(slot => !known.includes(slot));
  if (unknown.length) throw new Error(`Unknown slot in ${dir}/names.json: ${unknown.join(', ')}; the slots are ` +
    `${known.join(', ')}.`);
  const missing = present.filter(slot => !names[slot]);
  if (missing.length) throw new Error(`${dir}/names.json has no entry for ${missing.join(', ')}.`);
  for (const [slot, entry] of Object.entries(names)) {
    const bad = (reason: string) => new Error(`${dir}/names.json ${slot}: ${reason}`);
    if (typeof entry !== 'object' || entry === null) throw bad('not an object.');
    const extra = Object.keys(entry).filter(field => !NAME_FIELDS.includes(field));
    if (extra.length) throw bad(`unknown ${extra.join(', ')}.`);
    for (const field of ['name', 'champion', 'skin']) {
      if (typeof entry[field] !== 'string' || !entry[field]) throw bad(`${field} must be a non-empty string.`);
    }
    if ('password' in entry && typeof entry.password !== 'string') throw bad('password must be a string.');
    const own = /^lol\.1v1\.champions\.([a-z0-9]+)$/.exec(entry.champion as string)?.[1];
    if (!own || entry.skin !== `lol.1v1.playerskins.pack.${own}.default`) {
      throw bad('the champion must be lol.1v1.champions.<x> and the skin lol.1v1.playerskins.pack.<x>.default.');
    }
  }
  return { sha256: sha256(bytes), names: names as unknown as Record<string, HeroNames> };
}

/**
 * A hero's directory: its manifest.json lists its files with SHA-256 and size, each checked before it is served at
 * /local/heroes/<id>/<name>.
 */
async function heroFiles(id: string, dir: string) {
  const manifest = await Bun.file(resolve(dir, 'manifest.json')).bytes();
  const { files } = JSON.parse(new TextDecoder().decode(manifest)) as
    { files: Record<string, { sha256: string; bytes: number }> };
  const types: Record<string, string> = { json: 'application/json', jpg: 'image/jpeg', png: 'image/png' };
  return { sha256: sha256(manifest), files: await Promise.all(Object.entries(files).map(async ([name, expected]) => {
    const type = types[name.split('.').pop()!];
    if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(name) || !type) throw new Error(`Invalid hero file name: ${id}/${name}`);
    const body = await Bun.file(resolve(dir, name)).bytes();
    if (body.length !== expected.bytes || sha256(body) !== expected.sha256) {
      throw new Error(`Hero file ${id}/${name} differs from its manifest.`);
    }
    return { name, type, body };
  })) };
}

/** `--heroes <dir>`: each present hero's files by slot (heroDirectories, heroFiles) and the names (heroNames). */
async function heroesIn(dir: string) {
  const directories = await heroDirectories(dir);
  const { names, sha256: namesSha256 } = await heroNames(dir, Object.keys(directories));
  const files = Object.fromEntries(await Promise.all(Object.entries(directories)
    .map(async ([id, path]) => [id, await heroFiles(id, path)] as const)));
  return { files, names, namesSha256 };
}

/**
 * The page; `key` (public mode) goes into its config for the party share link, served only to key holders (never
 * with `open`, which serves the page to anyone, so the share link is then the bare address). `heroes` lists, by slot,
 * the hero files this host serves and the slot's names; with it the `hero` feature joins the profile's and the heroes'
 * bundle loads before the page's.
 */
function pageHtml(profile: Profile, key?: string, heroes?: Record<string, { files: string[] } & HeroNames>) {
  const { entry, features: own } = profiles[profile];
  const features = heroes ? [...own, 'hero'] : own;
  const config = JSON.stringify({ profile, entry, features, key, heroes }).replaceAll('<', '\\u003c');
  const status = entry === 'none' ? '' : '<div id="local-status" role="status">Loading the original client…</div>\n';
  const script = heroes ? '<script src="/local/heroes.js"></script>\n' : '';
  return `<!doctype html><meta charset="utf-8"><title>1v1.LOL — local</title>
<style>${style}</style>
${status}<canvas id="unity" width="1280" height="720" tabindex="0"></canvas>
<script type="application/json" id="local-config">${config}</script>
${script}<script src="/local/page.js"></script>
<script src="/WebGL.loader.js"></script>`;
}

/**
 * Loopback-only, read-only host: preserved originals, the profile's derived WASM and Addressables, and the page.
 * Every body is revalidated (no-cache + ETag, 304) and offered gzip-coded to clients that accept it: the original build
 * shipped data, framework and WASM as gzip .unityweb, and a public tunnel's bottleneck is this host's upload.
 * `hosts`: extra Host headers accepted as sent by a local reverse proxy, e.g. `tailscale serve`'s `<machine>.ts.net`.
 * `key` (play --public, reached through a tunnel under any name): every request must carry it, once as `?k=`
 * (answered with a cookie and a redirect) and then as that cookie; it replaces the Host check, and without it the host
 * answers 404. `heroes`: the custom heroes' directory (heroDirectories), which adds them to a menu-entry profile.
 * `open`: requests without the key or its cookie pass too, so the tunnel's bare address works for anyone; the key
 * links still set the cookie.
 */
export async function startHost({ profile, port = 0, record = () => {}, lanIds, hosts = [], key, open, heroes }: {
  profile: Profile; port?: number; record?: (kind: string, data: unknown) => void; lanIds?: string; hosts?: string[];
  key?: string; open?: boolean; heroes?: string }) {
  const definition = profiles[profile];
  if (heroes && definition.entry !== 'menu') throw new Error('--heroes needs the menu or lan profile.');
  // The present heroes' files and names by slot, and the heroes' bundle (heroes/page/index.ts, a page extension).
  const { files: roster, names, namesSha256 } = heroes ? await heroesIn(heroes) : {};
  const heroesJs = roster && await bundle('heroes/page/index.ts');
  const routes = new Map<string, { type: string; identity: Variant; gzip?: () => Promise<Variant> }>();
  const serve = (route: string, type: string, body: Body, original?: Body) =>
    routes.set(route, { type, identity: variant(body), gzip: gzipOf(body, original) });
  // The .unityweb originals decompress byte-identical to the extractions (docs/reference/build.md).
  for (const [route, type, path, original] of [
    ['/WebGL.loader.js', 'application/javascript', 'artifacts/original/WebGL.loader.js', undefined],
    ['/WebGL.framework.js', 'application/javascript', 'artifacts/extracted/WebGL.framework.js',
      'artifacts/original/WebGL.framework.js.unityweb'],
    ['/WebGL.data', 'application/octet-stream', 'artifacts/extracted/WebGL.data',
      'artifacts/original/WebGL.data.unityweb'],
  ] as const) {
    for (const file of [path, original]) {
      if (file && !await projectFile(file).exists()) throw new Error(`Missing preserved input: ${file}`);
    }
    serve(route, type, projectFile(path), original && projectFile(original));
  }
  const wasm = projectFile('artifacts/extracted/WebGL.wasm'), { patches, wasmSha256 } = definition;
  serve('/WebGL.wasm', 'application/wasm',
    patches.length ? deriveWasm(await wasm.bytes(), patches, wasmSha256).bytes : wasm);
  if (definition.addressables) {
    serve('/StreamingAssets/aa/settings.json', 'application/json', await readPinned(SETTINGS));
    serve('/StreamingAssets/aa/catalog.json', 'application/json',
      deriveCatalog(await projectFile(CATALOG.path).text()));
    for (const bundle of bundles) {
      serve(`/StreamingAssets/aa/WebGL/${bundle.name}`, 'application/octet-stream', await readPinned(bundle));
    }
  }
  const page = await buildPage(), present = roster && Object.fromEntries(Object.entries(roster)
    .map(([id, { files }]) => [id, { files: files.map(file => file.name), ...names![id]! }]));
  const pageKey = open ? undefined : key;
  serve('/', 'text/html; charset=utf-8', pageHtml(profile, pageKey, present));
  // The original party share link (…/party?code=, PartyShare.ShareLink): the same page; its DeepLinkManager reads it.
  if (definition.features.includes('party')) {
    serve('/party', 'text/html; charset=utf-8', pageHtml(profile, pageKey, present));
  }
  serve('/local/page.js', 'application/javascript', page.script);
  if (heroesJs) serve('/local/heroes.js', 'application/javascript', heroesJs.script);
  for (const [id, { files }] of Object.entries(roster ?? {})) {
    for (const file of files) serve(`/local/heroes/${id}/${file.name}`, file.type, file.body);
  }
  const lan = definition.features.includes('photon') ? await playerIds(lanIds) : null;
  const photon = lan ? photonSockets(record, lan) : null;
  // Every gzip body starts compressing at startup. The derived WASM takes over 10 s, Bun's default idle timeout, so a
  // request waiting for it, or for a slow tunnel, gets the longest idle wait Bun allows.
  for (const route of routes.values()) void route.gzip?.();

  const server = Bun.serve<PhotonSocket>({
    hostname: '127.0.0.1', port, maxRequestBodySize: 1024, idleTimeout: 255,
    async fetch(request, server) {
      const url = new URL(request.url);
      record('host-request', { path: url.pathname, method: request.method });
      const local = ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === String(server.port);
      if (!key && !local && !hosts.includes(url.host)) {
        return refuse(403, 'Invalid host');
      }
      if (key) {
        // The key as `?k=` or as a /k/<key>/ path prefix (the party share link's base).
        const prefixed = /^\/k\/([^/]+)(\/.*)?$/.exec(url.pathname);
        if (url.searchParams.get('k') === key || prefixed?.[1] === key) {
          url.searchParams.delete('k');
          const location = (prefixed?.[1] === key ? prefixed[2] ?? '/' : url.pathname) + url.search;
          return new Response(null, { status: 302, headers: { ...headers, Location: location,
            'Set-Cookie': `k=${key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` } });
        }
        const cookie = /(?:^|;\s*)k=([^;]*)/.exec(request.headers.get('cookie') ?? '')?.[1];
        if (cookie !== key && !open) return refuse(404, 'Not found');
      }
      let path: string;
      try { path = decodeURIComponent(url.pathname); } catch { return refuse(400, 'Invalid path'); }
      if (path.includes('..') || path.includes('\\') || path.includes('\0')) return refuse(400, 'Invalid path');
      if (request.method !== 'GET' && request.method !== 'HEAD') return refuse(405, 'Read-only host');
      if (lan && path === '/local/id') {
        // lan profile: the player's four-digit ID for this browser's original install ID (src/host/photon/ids.ts).
        const device = url.searchParams.get('device') ?? '';
        return /^[\x21-\x7e]{1,64}$/.test(device)
          ? Response.json({ id: lan.assign(device) }, { headers: { 'Cache-Control': 'no-store' } })
          : refuse(400, 'Invalid device');
      }
      if (photon && path === '/photon') {
        // Photon's client asks for the GpBinaryV18 subprotocol; the handshake must select it.
        const protocols = request.headers.get('sec-websocket-protocol') ?? '';
        const headers = protocols.split(',').map(item => item.trim()).includes('GpBinaryV18')
          ? { 'Sec-WebSocket-Protocol': 'GpBinaryV18' } : undefined;
        return server.upgrade(request, { headers, data: photon.next(url.searchParams) })
          ? undefined : refuse(400, 'WebSocket upgrade required');
      }
      const route = routes.get(path);
      if (!route) {
        record('missing-resource', { path });
        return refuse(404, 'Not supplied by this profile');
      }
      const coded = route.gzip && /\bgzip\b/.test(request.headers.get('accept-encoding') ?? '') ? 'gzip' : null;
      const { body, etag } = coded ? await route.gzip!() : route.identity;
      const cache: Record<string, string> = { ...headers, 'Cache-Control': 'no-cache', ETag: etag };
      if (route.gzip) cache.Vary = 'Accept-Encoding';
      // Weak comparison (RFC 9110): an edge that recodes a body hands its validator back as W/"…".
      if (request.headers.get('if-none-match')?.replace(/^W\//, '') === etag) {
        return new Response(null, { status: 304, headers: cache });
      }
      if (coded) cache['Content-Encoding'] = coded;
      cache['Content-Type'] = route.type;
      return new Response(request.method === 'HEAD' ? null : body, { headers: cache });
    },
    websocket: photon?.handlers ?? { message() {} },
  });
  return { origin: `http://localhost:${server.port}`, wasmSha256, pageSha256: page.sha256,
    heroesSha256: heroesJs?.sha256, heroNamesSha256: namesSha256,
    heroes: roster && Object.fromEntries(Object.entries(roster).map(([id, { sha256 }]) => [id, sha256])),
    stop: () => server.stop(true) };
}
