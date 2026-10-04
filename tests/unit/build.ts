import { test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from '../../src/host/build/inputs';

/**
 * The original build (artifacts/, from `bun run setup` or the user's own copy) and its IL2CPP tables are never
 * tracked. On a clone without them, the tests that read them are skipped, and this says so once.
 */
export const hasBuild = ['artifacts/original/WebGL.loader.js', 'artifacts/extracted/WebGL.wasm',
  're/data/il2cpp/methods.tsv'].every(path => existsSync(resolve(PROJECT_ROOT, path)));
if (!hasBuild) console.warn('No original build or re/data/il2cpp tables: the tests that read them are skipped.');

/** A test that needs the original build. */
export const withBuild = test.skipIf(!hasBuild);
