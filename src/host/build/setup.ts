import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { INVENTORY, type Pinned, pinnedInputs, PROJECT_ROOT, verifyInputs } from './inputs';
import { webdata } from './pins';
import { report } from './verify';

/**
 * bun run setup: builds artifacts/ from playtika/, the tracked copy of the original build (Playtika's files), wherever artifacts/ is missing or differs from its pins, then checks the 48 pins as `bun run verify` does.
 * It reads local files only, and a second run changes nothing. `--pack` writes playtika/ from a verified artifacts/.
 */

/** A file larger than this is kept in playtika/ as <name>.part-00, .part-01, … of at most this many bytes each. */
export const PART_BYTES = 45_000_000;
const PLAYTIKA = 'playtika', ORIGINAL = 'artifacts/original', EXTRACTED = 'artifacts/extracted';
/** The gzip .unityweb originals; each decompresses byte for byte to its extracted file (docs/reference/build.md). */
const GZIPPED = ['WebGL.data', 'WebGL.framework.js', 'WebGL.wasm'];

type Pin = Omit<Pinned, 'path'>;
const part = (name: string, i: number) => `${name}.part-${String(i).padStart(2, '0')}`;

/** One entry of the WebGL.data container, as `webdata.entries` in pins.ts records it. */
export interface Entry { path: string; offset: number; size: number }

/** Writes `dest` through a temporary file that becomes `dest` only when its size and SHA-256 match `pin`. */
export async function writePinned(dest: string, chunks: AsyncIterable<Uint8Array>, pin: Pin) {
  await mkdir(dirname(dest), { recursive: true });
  const temporary = `${dest}.tmp`, hash = createHash('sha256');
  let size = 0;
  try {
    const file = await open(temporary, 'w');
    try {
      for await (const chunk of chunks) {
        await file.write(chunk);
        hash.update(chunk);
        size += chunk.byteLength;
      }
    } finally {
      await file.close();
    }
    const digest = hash.digest('hex');
    if (digest !== pin.sha256 || (pin.size !== undefined && size !== pin.size)) {
      throw new Error(`${dest}: ${size} bytes, SHA-256 ${digest}; the pin is ${pin.size} bytes, ${pin.sha256}.`);
    }
    await rename(temporary, dest);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Bytes `start` to `end` of a file. Read through node:fs because Bun 1.4.0 ignores the end of a sliced Bun.file in
 * both `stream()` and `Bun.write`.
 */
const range = (path: string, start: number, end: number) => createReadStream(path, { start, end: end - 1 });

/** Writes `src` into `dir` as `name` or, when it is larger than `limit`, as `name.part-00`, …; returns the names. */
export async function split(src: string, dir: string, name: string, limit = PART_BYTES) {
  const { size } = await stat(src), count = Math.ceil(size / limit);
  await mkdir(dirname(resolve(dir, name)), { recursive: true });
  if (count <= 1) {
    await copyFile(src, resolve(dir, name));
    return [name];
  }
  const names = Array.from({ length: count }, (_, i) => part(name, i));
  for (const [i, path] of names.entries()) {
    await pipeline(range(src, i * limit, Math.min(size, (i + 1) * limit)), createWriteStream(resolve(dir, path)));
  }
  return names;
}

/** The paths that hold `name` in `dir`: the file itself, or its parts in order; none when neither is there. */
export async function partsOf(dir: string, name: string) {
  const path = resolve(dir, name), base = basename(path);
  if (await Bun.file(path).exists()) return [path];
  const parts = (await readdir(dirname(path)).catch(() => [])).filter(entry => entry.startsWith(`${base}.part-`));
  parts.sort().forEach((found, i) => {
    if (found !== part(base, i)) throw new Error(`${found}: a part is missing before it.`);
  });
  return parts.map(found => resolve(dirname(path), found));
}

/** The bytes of `paths`, one after another. */
export async function* joined(paths: string[]) {
  for (const path of paths) yield* createReadStream(path);
}

/**
 * Writes the files of `extracted` that `pins` names (by path under it) from the originals: the three .unityweb files
 * gunzipped, and the `data/` entries cut from the extracted WebGL.data at their recorded offsets.
 */
export async function derive(original: string, extracted: string, pins: Map<string, Pin>, entries: Entry[]) {
  for (const name of GZIPPED) {
    const pin = pins.get(name);
    if (!pin) continue;
    const gzip = Bun.file(resolve(original, `${name}.unityweb`)).stream();
    await writePinned(resolve(extracted, name), gzip.pipeThrough(new DecompressionStream('gzip')), pin);
  }
  const data = resolve(extracted, 'WebGL.data');
  for (const { path, offset, size } of entries) {
    const pin = pins.get(`data/${path}`);
    if (pin) await writePinned(resolve(extracted, 'data', path), range(data, offset, offset + size), pin);
  }
}

/** The pins of `paths` under `dir`, by path relative to it (the first pin of a path listed twice). */
function under(pins: Pinned[], dir: string, paths: Set<string>) {
  const found = new Map<string, Pin>();
  for (const { path, ...pin } of pins) {
    const name = path.slice(dir.length + 1);
    if (path.startsWith(`${dir}/`) && paths.has(path) && !found.has(name)) found.set(name, pin);
  }
  return found;
}

/** Rebuilds every pinned file that failed the first check, then checks all of them again. */
async function setup() {
  const first = await verifyInputs();
  const failed = new Set(first.issues.map(issue => issue.path));
  if (first.ok || failed.has(INVENTORY)) return first;
  const pins = pinnedInputs(), originals = under(pins, ORIGINAL, failed), sources = new Map<string, string[]>();
  for (const name of originals.keys()) sources.set(name, await partsOf(resolve(PROJECT_ROOT, PLAYTIKA), name));
  const missing = [...sources].filter(([, parts]) => !parts.length).map(([name]) => name);
  if (missing.length) {
    throw new Error(`the original game files are missing (${missing.length} of them, e.g. ${missing[0]}): neither ` +
      `${PLAYTIKA}/ (in the repository) nor ${ORIGINAL}/ (your own copy) has them.`);
  }
  for (const [name, pin] of originals) {
    await writePinned(resolve(PROJECT_ROOT, ORIGINAL, name), joined(sources.get(name)!), pin);
  }
  if (originals.size) console.log(`setup: ${ORIGINAL}/: ${originals.size} assembled from ${PLAYTIKA}/`);
  const extracted = under(pins, EXTRACTED, failed);
  await derive(resolve(PROJECT_ROOT, ORIGINAL), resolve(PROJECT_ROOT, EXTRACTED), extracted, webdata.entries);
  if (extracted.size) console.log(`setup: ${EXTRACTED}/: ${extracted.size} derived from ${ORIGINAL}/`);
  return verifyInputs();
}

/** Writes playtika/ from artifacts/original/, once every pin matches. */
async function pack() {
  if (!report(await verifyInputs())) throw new Error('--pack needs every pinned input to match first.');
  const pins = pinnedInputs();
  for (const name of under(pins, ORIGINAL, new Set(pins.map(pin => pin.path))).keys()) {
    const parts = await split(resolve(PROJECT_ROOT, ORIGINAL, name), resolve(PROJECT_ROOT, PLAYTIKA), name);
    for (const path of parts) console.log(`${PLAYTIKA}/${path}`);
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ args: Bun.argv.slice(2), strict: true,
    options: { pack: { type: 'boolean', default: false } } });
  try {
    if (values.pack) await pack();
    else process.exitCode = report(await setup()) ? 0 : 1;
  } catch (error) {
    console.error(`setup: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
