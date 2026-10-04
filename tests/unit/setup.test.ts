import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { sha256 } from '../../src/host/build/inputs';
import { derive, joined, partsOf, split, writePinned } from '../../src/host/build/setup';

// bun run setup on small fixtures: playtika/'s parts join back to the original, and artifacts/extracted/ derives from
// the .unityweb files byte for byte.
const dir = mkdtempSync(resolve(tmpdir(), 'setup-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const bytes = (length: number, seed: number) => Uint8Array.from({ length }, (_, i) => (i * 31 + seed) % 251);
const pin = (data: Uint8Array) => ({ sha256: sha256(data), size: data.byteLength });
const read = (path: string) => Bun.file(resolve(dir, path)).bytes();

test('A file over the limit splits into numbered parts that join back byte for byte', async () => {
  const data = bytes(25, 1);
  await Bun.write(resolve(dir, 'in.bin'), data);
  expect(await split(resolve(dir, 'in.bin'), resolve(dir, 'packed'), 'a/big.bin', 10))
    .toEqual(['a/big.bin.part-00', 'a/big.bin.part-01', 'a/big.bin.part-02']);
  expect(await split(resolve(dir, 'in.bin'), resolve(dir, 'packed'), 'small.bin', 25)).toEqual(['small.bin']);
  const parts = await partsOf(resolve(dir, 'packed'), 'a/big.bin');
  expect(parts.map(path => Bun.file(path).size)).toEqual([10, 10, 5]);
  expect(await partsOf(resolve(dir, 'packed'), 'small.bin')).toEqual([resolve(dir, 'packed/small.bin')]);
  expect(await partsOf(resolve(dir, 'packed'), 'absent.bin')).toEqual([]);
  await writePinned(resolve(dir, 'joined.bin'), joined(parts), pin(data));
  expect(await read('joined.bin')).toEqual(data);
});

test('A write that differs from its pin leaves no file behind', async () => {
  const data = bytes(12, 2), wrong = { ...pin(data), sha256: sha256('other') };
  await Bun.write(resolve(dir, 'source.bin'), data);
  await expect(writePinned(resolve(dir, 'out/x.bin'), joined([resolve(dir, 'source.bin')]), wrong))
    .rejects.toThrow('pin');
  expect(readdirSync(resolve(dir, 'out'))).toEqual([]);
});

test('derive gunzips the .unityweb files and cuts WebGL.data at the recorded offsets', async () => {
  const header = bytes(16, 3), first = bytes(9, 4), second = bytes(30, 5);
  const data = new Uint8Array([...header, ...first, ...second]), framework = bytes(40, 6), wasm = bytes(70, 7);
  for (const [name, body] of [['WebGL.data', data], ['WebGL.framework.js', framework], ['WebGL.wasm', wasm]] as const) {
    await Bun.write(resolve(dir, 'original', `${name}.unityweb`), Bun.gzipSync(body));
  }
  const expected = { 'WebGL.data': data, 'WebGL.framework.js': framework, 'WebGL.wasm': wasm,
    'data/first.bin': first, 'data/x/second.bin': second };
  const pins = new Map(Object.entries(expected).map(([name, body]) => [name, pin(body)]));
  await derive(resolve(dir, 'original'), resolve(dir, 'extracted'), pins,
    [{ path: 'first.bin', offset: 16, size: 9 }, { path: 'x/second.bin', offset: 25, size: 30 }]);
  for (const [name, body] of Object.entries(expected)) expect(await read(`extracted/${name}`)).toEqual(body);
  await expect(derive(resolve(dir, 'original'), resolve(dir, 'extracted'), new Map([['data/first.bin', pin(first)]]),
    [{ path: 'first.bin', offset: 17, size: 9 }])).rejects.toThrow('pin');
  expect(await read('extracted/data/first.bin')).toEqual(first);
});
