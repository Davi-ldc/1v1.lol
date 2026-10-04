import type { Subprocess } from 'bun';
import { chmod, mkdir, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PROJECT_ROOT, sha256 } from './build/inputs';

/**
 * ./start, after `bun run setup`: the lan host (`play --public`) behind a Cloudflare quick tunnel, which prints one
 * link to share. `--local` serves this machine only, with no tunnel; `--open` lets the tunnel's bare address in;
 * `--port` (8080). Ctrl+C, or either process exiting, stops both.
 */
const { values } = parseArgs({ args: Bun.argv.slice(2), strict: true, options: {
  port: { type: 'string', default: '8080' },
  open: { type: 'boolean', default: false },
  local: { type: 'boolean', default: false },
} });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be 1–65535.');
if (values.open && values.local) throw new Error('--open is for the tunnel; drop --local.');

/** The cloudflared release, and the SHA-256 of its asset for each platform (darwin's are .tgz archives). */
const CLOUDFLARED = '2026.9.3';
const ASSETS: Record<string, [name: string, sha256: string]> = {
  'linux-x64': ['cloudflared-linux-amd64', '77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2'],
  'linux-arm64': ['cloudflared-linux-arm64', 'aaeb2d7d0da3614634c7e03ab13487a1522c2e79165ed2929cfe23d5e95b326d'],
  'darwin-x64': ['cloudflared-darwin-amd64.tgz', 'd1155d0837487f261183b15c1eab6c4ebcad9dc49b94675f1524c3564cea3977'],
  'darwin-arm64': ['cloudflared-darwin-arm64.tgz', '587c2cfb1c230fe36c7fa7727da78be459dae028cabe8c001291999350f07095'],
};
const CACHE = resolve(PROJECT_ROOT, '.cache/cloudflared'), LOG = resolve(CACHE, 'tunnel.log');

/** cloudflared from PATH, or else the pinned release in .cache/cloudflared/<version>/, downloaded once and checked. */
async function cloudflared() {
  const found = Bun.which('cloudflared'), dir = resolve(CACHE, CLOUDFLARED), binary = resolve(dir, 'cloudflared');
  if (found) return found;
  if (await Bun.file(binary).exists()) return binary;
  const asset = ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error(`no pinned cloudflared for ${process.platform}-${process.arch}; put one on PATH.`);
  const [name, pinned] = asset;
  console.log(`Downloading cloudflared ${CLOUDFLARED} (${name})…`);
  const response = await fetch(`https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED}/${name}`);
  const bytes = new Uint8Array(await response.arrayBuffer()), hash = sha256(bytes);
  if (hash !== pinned) throw new Error(`${name}: HTTP ${response.status}, SHA-256 ${hash}; expected ${pinned}.`);
  const download = resolve(dir, 'download');
  await rm(download, { recursive: true, force: true });
  await mkdir(download, { recursive: true });
  await Bun.write(resolve(download, name.endsWith('.tgz') ? name : 'cloudflared'), bytes);
  if (name.endsWith('.tgz') && Bun.spawnSync(['tar', '-xzf', name, 'cloudflared'], { cwd: download }).exitCode) {
    throw new Error(`${name}: tar could not extract cloudflared.`);
  }
  await chmod(resolve(download, 'cloudflared'), 0o755);
  await rename(resolve(download, 'cloudflared'), binary);
  await rm(download, { recursive: true });
  return binary;
}

/** A quick tunnel to the host; `name` resolves to its trycloudflare.com name once its first connection is up. */
async function tunnel(binary: string) {
  await mkdir(CACHE, { recursive: true });
  const child = Bun.spawn([binary, 'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`],
    { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' });
  const name = Promise.withResolvers<string>(), log = Bun.file(LOG).writer();
  setTimeout(() => name.reject(new Error(`no tunnel after 60 s; see ${LOG}.`)), 60_000).unref();
  (async () => {
    const decoder = new TextDecoder();
    let text: string | undefined = '';
    for await (const chunk of child.stderr) {
      log.write(chunk);
      log.flush();
      if (text === undefined) continue;
      text += decoder.decode(chunk, { stream: true });
      const found = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/.exec(text)?.[1];
      if (found && text.includes('Registered tunnel connection')) {
        name.resolve(found);
        text = undefined;
      }
    }
    await log.end();
    name.reject(new Error(`cloudflared stopped; see ${LOG}.`));
  })();
  return { child, name: name.promise };
}

const children = new Map<string, Subprocess>();
let stopping = false;
const stop = () => {
  stopping = true;
  if (!children.size) process.exit();
  for (const child of children.values()) child.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

try {
  let name: string | undefined;
  if (!values.local) {
    const quick = await tunnel(await cloudflared());
    children.set('cloudflared', quick.child);
    name = await quick.name;
  }
  if (!stopping) {
    children.set('the host', Bun.spawn([process.execPath, 'src/host/play.ts', '--profile', 'lan', '--port', `${port}`,
      ...name ? ['--public', '--host', name] : [], ...values.open ? ['--open'] : []],
    { cwd: PROJECT_ROOT, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' }));
    const ended = await Promise.race([...children].map(([label, child]) => child.exited.then(() => label)));
    if (!stopping) throw new Error(`${ended} exited.`);
  }
} catch (error) {
  if (!stopping) {
    console.error(`start: ${error instanceof Error ? error.message : String(error)} Stopping.`);
    process.exitCode = 1;
  }
}
stop();
const exited = Promise.all([...children.values()].map(child => child.exited));
if (!await Promise.race([exited.then(() => true), Bun.sleep(15_000).then(() => false)])) {
  for (const child of children.values()) child.kill('SIGKILL');
}
process.exit();
