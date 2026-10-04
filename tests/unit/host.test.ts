import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { CATALOG, LOCAL_PREFIX, PROJECT_ROOT, SETTINGS, sha256 } from '../../src/host/build/inputs';
import { profiles } from '../../src/host/profiles';
import { buildPage, startHost } from '../../src/host/server';
import { deriveWasm, ORIGINAL_WASM_SHA256 } from '../../src/host/wasm';
import { hasBuild, withBuild } from './build';

/** Whether this checkout has the custom heroes (heroes/README.md, a removable unit). */
const hasHeroes = existsSync(resolve(PROJECT_ROOT, 'heroes/page/ids.ts'));
/** Test names.json entries (heroes/README.md). */
const NAMES = {
  beam: { name: 'Alpha', champion: 'lol.1v1.champions.alpha', skin: 'lol.1v1.playerskins.pack.alpha.default',
    password: 'Alpha password:' },
  elastic: { name: 'Bravo', champion: 'lol.1v1.champions.bravo', skin: 'lol.1v1.playerskins.pack.bravo.default' },
};
/**
 * A temporary --heroes directory: a subdirectory per entry of `heroes`, its files (name → text) and manifest.json,
 * and `names` as names.json unless it is null.
 */
async function heroesDir(heroes: Record<string, Record<string, string>>, names: unknown = NAMES) {
  const dir = await mkdtemp(resolve(tmpdir(), 'heroes-'));
  if (names !== null) await Bun.write(resolve(dir, 'names.json'), JSON.stringify(names));
  for (const [id, files] of Object.entries(heroes)) {
    await mkdir(resolve(dir, id));
    const manifest: Record<string, { sha256: string; bytes: number }> = {};
    for (const [name, text] of Object.entries(files)) {
      await Bun.write(resolve(dir, id, name), text);
      manifest[name] = { sha256: sha256(text), bytes: Buffer.byteLength(text) };
    }
    await Bun.write(resolve(dir, id, 'manifest.json'), JSON.stringify({ files: manifest }));
  }
  return dir;
}
const MESH = { 'hero.mesh.json': '{"bones":[]}' };

test.skipIf(!hasBuild || !hasHeroes)('--heroes: each present hero is served under its slot with its names',
  async () => {
    const dir = await heroesDir({ beam: MESH });
    const host = await startHost({ profile: 'menu', heroes: dir });
    try {
      const page = await (await fetch(`${host.origin}/`)).text();
      const config = JSON.parse(/id="local-config">(.*?)<\/script>/.exec(page)![1]!);
      expect([config.features.includes('hero'), config.heroes])
        .toEqual([true, { beam: { files: ['hero.mesh.json'], ...NAMES.beam } }]);
      expect(page).toContain('<script src="/local/heroes.js"></script>');
      expect((await fetch(`${host.origin}/local/heroes.js`)).status).toBe(200);
      const get = (path: string) => fetch(`${host.origin}/local/heroes/${path}`);
      expect(await (await get('beam/hero.mesh.json')).text()).toBe(MESH['hero.mesh.json']);
      expect((await get('beam/manifest.json')).status).toBe(404);
      expect((await get('elastic/hero.mesh.json')).status).toBe(404);
      expect(host.heroes).toEqual({ beam: sha256(await Bun.file(resolve(dir, 'beam/manifest.json')).bytes()) });
      expect(host.heroNamesSha256).toBe(sha256(await Bun.file(resolve(dir, 'names.json')).bytes()));
    } finally {
      host.stop();
      await rm(dir, { recursive: true });
    }
  }, 30_000);

test.skipIf(!hasHeroes)('--heroes refuses unknown subdirectories, no hero, a manifest mismatch and practice',
  async () => {
    const unknown = await heroesDir({ beam: MESH, beam2: MESH });
    const none = await heroesDir({});
    const changed = await heroesDir({ elastic: MESH });
    await Bun.write(resolve(changed, 'elastic/hero.mesh.json'), '{"bones":[1]}');
    try {
      await expect(startHost({ profile: 'menu', heroes: unknown }))
        .rejects.toThrow(': beam2; the slots are beam, elastic.');
      await expect(startHost({ profile: 'menu', heroes: none })).rejects.toThrow('has no hero directory');
      await expect(startHost({ profile: 'lan', heroes: changed }))
        .rejects.toThrow('Hero file elastic/hero.mesh.json differs from its manifest.');
      await expect(startHost({ profile: 'practice', heroes: changed })).rejects.toThrow('the menu or lan profile');
    } finally {
      for (const dir of [unknown, none, changed]) await rm(dir, { recursive: true });
    }
  });

test.skipIf(!hasHeroes)('--heroes refuses a missing or invalid names.json', async () => {
  const { beam } = NAMES, cases: [unknown, string][] = [
    [null, 'has hero directories but no names.json'],
    [{ beam, other: beam }, 'Unknown slot in'],
    [{ elastic: NAMES.elastic }, 'has no entry for beam'],
    [{ beam: { ...beam, name: '' } }, 'beam: name must be a non-empty string'],
    [{ beam: { ...beam, skin: 'lol.1v1.playerskins.pack.other.default' } }, 'beam: the champion must be'],
  ];
  for (const [names, message] of cases) {
    const dir = await heroesDir({ beam: MESH }, names);
    try {
      await expect(startHost({ profile: 'menu', heroes: dir })).rejects.toThrow(message);
    } finally {
      await rm(dir, { recursive: true });
    }
  }
});

withBuild('host serves read-only loopback routes with CSP and refuses everything else', async () => {
  const host = await startHost({ profile: 'practice' });
  try {
    const page = await fetch(`${host.origin}/`);
    expect(page.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(await page.text()).toContain('"entry":"practice"');
    expect((await fetch(`${host.origin}/local/page.js`)).status).toBe(200);
    expect((await fetch(`${host.origin}/WebGL.wasm`, { method: 'HEAD' })).status).toBe(200);
    expect((await fetch(`${host.origin}/`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${host.origin}/%2e%2e%2fpackage.json`)).status).toBe(400);
    expect((await fetch(`${host.origin}/StreamingAssets/aa/catalog.hash`)).status).toBe(404);
    expect((await fetch(`${host.origin}/`, { headers: { Host: 'example.com' } })).status).toBe(403);
  } finally { host.stop(); }
}, 15_000); // The WASM HEAD waits for its gzip body (~4 s).

withBuild('Addressables: original settings, a catalog pointing only at local bundles, bundles by name', async () => {
  const host = await startHost({ profile: 'practice' });
  const aa = `${host.origin}/StreamingAssets/aa`;
  try {
    expect(sha256(new Uint8Array(await (await fetch(`${aa}/settings.json`)).arrayBuffer()))).toBe(SETTINGS.sha256);
    const catalog = await (await fetch(`${aa}/catalog.json`)).text();
    expect(sha256(catalog)).toBe(CATALOG.servedSha256);
    expect(catalog).not.toContain('https://');
    expect(catalog.split(LOCAL_PREFIX).length - 1).toBe(19);
    expect((await fetch(`${aa}/WebGL/localization-locales__5d9d488470af26fedd08abd30ff2a8c3.bundle`)).status).toBe(200);
    const encoded = encodeURIComponent('localization-assets-english(en)__e36a0657703ff4d70f5c7f6dc390be1e.bundle')
      .replace(/\(/g, '%28').replace(/\)/g, '%29');
    expect((await fetch(`${aa}/WebGL/${encoded}`)).status).toBe(200);
  } finally { host.stop(); }
});

test('the page bundle is deterministic', async () => {
  expect((await buildPage()).sha256).toBe((await buildPage()).sha256);
});

withBuild('each profile derives its pinned WASM and changes only the declared bytes', async () => {
  const source = new Uint8Array(await Bun.file('artifacts/extracted/WebGL.wasm').arrayBuffer());
  expect(sha256(source)).toBe(ORIGINAL_WASM_SHA256);
  for (const [name, profile] of Object.entries(profiles)) {
    if (!profile.patches.length) continue;
    const { bytes, servedSha256 } = deriveWasm(source, profile.patches, profile.wasmSha256);
    expect(servedSha256).toBe(profile.wasmSha256);
    const declared = new Set(profile.patches.flatMap(patch =>
      patch.before.flatMap((byte, index) => byte !== patch.after[index] ? [patch.offset + index] : [])));
    const changed: number[] = [];
    for (let index = 0; index < source.length; index++) if (source[index] !== bytes[index]) changed.push(index);
    expect({ name, undeclared: changed.filter(index => !declared.has(index)), count: changed.length })
      .toEqual({ name, undeclared: [], count: declared.size });
  }
  expect(sha256(source)).toBe(ORIGINAL_WASM_SHA256);
});

test('WASM derivation refuses any other build', () => {
  const { patches, wasmSha256 } = profiles.practice;
  expect(() => deriveWasm(new Uint8Array(16), patches, wasmSha256)).toThrow('unrecognized');
});

withBuild('bodies revalidate: ETag, no-cache and 304 for a matching If-None-Match', async () => {
  const host = await startHost({ profile: 'practice' });
  try {
    const first = await fetch(`${host.origin}/WebGL.loader.js`);
    const tag = first.headers.get('etag')!;
    expect([first.status, first.headers.get('cache-control'), /^"[\w-]+"$/.test(tag)]).toEqual([200, 'no-cache', true]);
    expect((await fetch(`${host.origin}/WebGL.loader.js`, { headers: { 'If-None-Match': tag } })).status).toBe(304);
    expect((await fetch(`${host.origin}/WebGL.loader.js`, { headers: { 'If-None-Match': '"x"' } })).status).toBe(200);
  } finally { host.stop(); }
});

withBuild('gzip coding: the original .unityweb or the compressed derived body, decoding to the identity', async () => {
  const host = await startHost({ profile: 'practice' });
  const get = (path: string, encoding: string, headers: Record<string, string> = {}) => fetch(`${host.origin}${path}`,
    { headers: { 'Accept-Encoding': encoding, ...headers }, decompress: false });
  const bytes = async (response: Response) => new Uint8Array(await response.arrayBuffer());
  try {
    const framework = await get('/WebGL.framework.js', 'gzip, deflate, br');
    expect([framework.headers.get('content-encoding'), framework.headers.get('vary')])
      .toEqual(['gzip', 'Accept-Encoding']);
    expect(sha256(await bytes(framework)))
      .toBe(sha256(await Bun.file('artifacts/original/WebGL.framework.js.unityweb').bytes()));
    const catalog = await get('/StreamingAssets/aa/catalog.json', 'gzip');
    expect(sha256(Bun.gunzipSync(await bytes(catalog)))).toBe(CATALOG.servedSha256);
    const tag = catalog.headers.get('etag')!;
    expect((await get('/StreamingAssets/aa/catalog.json', 'gzip', { 'If-None-Match': `W/${tag}` })).status).toBe(304);
    const plain = await get('/StreamingAssets/aa/catalog.json', 'identity', { 'If-None-Match': tag });
    expect([plain.status, plain.headers.get('content-encoding')]).toEqual([200, null]);
    expect(sha256(await bytes(plain))).toBe(CATALOG.servedSha256);
  } finally { host.stop(); }
});

withBuild('public: without the access key nothing is served; the link sets the key cookie', async () => {
  const host = await startHost({ profile: 'lan', key: 'right-key-1234' });
  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${host.origin}${path}`, { headers, redirect: 'manual' });
  try {
    expect((await get('/')).status).toBe(404);
    expect((await get('/photon')).status).toBe(404);
    expect((await get('/local/id?device=x')).status).toBe(404);
    expect((await get('/?k=wrong-key-1234')).status).toBe(404);
    const link = await get('/?party=12345&k=right-key-1234');
    expect([link.status, link.headers.get('location')]).toEqual([302, '/?party=12345']);
    expect(link.headers.get('set-cookie')).toStartWith('k=right-key-1234; Path=/; HttpOnly');
    const shared = await get('/k/right-key-1234/party?code=12345');
    expect([shared.status, shared.headers.get('location')]).toEqual([302, '/party?code=12345']);
    expect((await get('/k/wrong-key-1234/party?code=12345')).status).toBe(404);
    const party = await get('/party?code=12345', { Cookie: 'k=right-key-1234' });
    expect([party.status, (await party.text()).includes('"key":"right-key-1234"')]).toEqual([200, true]);
    // Any tunnel name, but only with the key.
    expect((await get('/local/page.js', { Cookie: 'k=right-key-1234', Host: 'x.trycloudflare.com' })).status).toBe(200);
    expect((await get('/local/page.js', { Cookie: 'k=wrong-key-1234', Host: 'x.trycloudflare.com' })).status).toBe(404);
  } finally { host.stop(); }
});

withBuild('public and open: anyone gets the page, which never carries the key', async () => {
  const host = await startHost({ profile: 'lan', key: 'right-key-1234', open: true });
  try {
    for (const path of ['/', '/party?code=1']) {
      const page = await fetch(`${host.origin}${path}`);
      expect([page.status, (await page.text()).includes('right-key-1234')]).toEqual([200, false]);
    }
  } finally { host.stop(); }
});

withBuild('lan: host IDs are fixed per install; every profile stays read-only', async () => {
  const host = await startHost({ profile: 'lan', hosts: ['box.tail.ts.net'] });
  const get = async (path: string) => (await fetch(`${host.origin}${path}`)).json();
  try {
    expect(await get('/local/id?device=install-a')).toEqual({ id: '0001' });
    expect(await get('/local/id?device=install-b')).toEqual({ id: '0002' });
    expect(await get('/local/id?device=install-a')).toEqual({ id: '0001' });
    expect((await fetch(`${host.origin}/local/id?device=`)).status).toBe(400);
    expect((await fetch(`${host.origin}/local/id`, { method: 'POST' })).status).toBe(405);
    // A configured reverse-proxy name (tailscale serve keeps the client's Host) is served; any other name is not.
    const as = (name: string) => fetch(`${host.origin}/local/page.js`, { headers: { Host: name } });
    expect((await as('box.tail.ts.net')).status).toBe(200);
    expect((await as('other.tail.ts.net')).status).toBe(403);
  } finally { host.stop(); }
  const menu = await startHost({ profile: 'menu' });
  try {
    expect((await fetch(`${menu.origin}/local/id?device=x`)).status).toBe(404);
  } finally { menu.stop(); }
});
