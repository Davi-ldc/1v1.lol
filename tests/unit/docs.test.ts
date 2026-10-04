import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { bundles, CATALOG, PROJECT_ROOT, SETTINGS } from '../../src/host/build/inputs';
import { inventory } from '../../src/host/build/pins';
import { profiles } from '../../src/host/profiles';
import { ORIGINAL_WASM_SHA256 } from '../../src/host/wasm';

// CLAUDE.md, Docs: everything is in English, and every Markdown file is under 40 KB with links that resolve.
const LIMIT = 40 * 1024;
const IGNORED = /^(node_modules|\.git|artifacts|runs|heroes\/files|re\/data|\.claude\/worktrees)\//;
const LINK = /\]\(([^)\s]*)\)/g;
const HEROES_REMOVED = !existsSync(resolve(PROJECT_ROOT, 'heroes/page/ids.ts'));
// Tool-call markup that a file write can leave at the end of a document.
const MARKUP = /<\/?(?:invoke|parameter|content|function_calls)\b/;
// Common Portuguese words and noun endings, written as escapes so this file does not match itself. `\b` only knows
// ASCII letters, so the word edges are letter lookarounds.
const PORTUGUESE = new RegExp('(?<!\\p{L})(?:n\u00e3o|voc\u00ea|tamb\u00e9m|ent\u00e3o|est\u00e1|j\u00e1|s\u00e3o|' +
  'usu\u00e1rio|decis\u00e3o)(?!\\p{L})|\u00e7(?:\u00e3o|\u00f5es)(?!\\p{L})', 'iu');

/** GitHub's anchor for a heading: lowercase, punctuation dropped, spaces to hyphens. */
const slug = (heading: string) => heading.replace(/`/g, '').trim().toLowerCase()
  .replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');
const anchors = (text: string) => new Set(text.replace(/^```[\s\S]*?^```/gm, '').split('\n')
  .filter(line => /^#{1,6} /.test(line)).map(line => slug(line.replace(/^#+ /, ''))));

async function markdownFiles() {
  const entries = await readdir(PROJECT_ROOT, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile() && /\.mdx?$/i.test(entry.name))
    .map(entry => relative(PROJECT_ROOT, resolve(entry.parentPath, entry.name))).filter(path => !IGNORED.test(path));
}

test('Markdown files are under 40 KB, free of tool markup, with links and anchors that resolve', async () => {
  const markdown = await markdownFiles();
  expect(markdown).toEqual(expect.arrayContaining(['docs/SKILL.md', 're/README.md']));
  for (const path of markdown) {
    const text = await Bun.file(resolve(PROJECT_ROOT, path)).text();
    expect({ path, bytes: Buffer.byteLength(text) <= LIMIT }).toEqual({ path, bytes: true });
    expect({ path, markup: MARKUP.exec(text)?.[0] ?? null }).toEqual({ path, markup: null });
    const broken: string[] = [];
    for (const [, link] of text.matchAll(LINK)) {
      if (/^[a-z]+:/i.test(link!)) continue;
      const [target = '', anchor] = link!.split('#');
      const file = target ? resolve(PROJECT_ROOT, dirname(path), target) : resolve(PROJECT_ROOT, path);
      // The heroes unit is removable (heroes/README.md): a link into it counts only while it is there.
      if (!existsSync(file) && !(HEROES_REMOVED && relative(PROJECT_ROOT, file).startsWith('heroes/'))) {
        broken.push(link!);
      }
      else if (anchor && /\.md$/.test(file) && !anchors(await Bun.file(file).text()).has(anchor)) broken.push(link!);
    }
    expect({ path, broken }).toEqual({ path, broken: [] });
  }
});

test('Every tracked text file is in English', async () => {
  const listed = Bun.spawnSync(['git', 'ls-files', '-z'], { cwd: PROJECT_ROOT });
  // A tracked file deleted in the working tree (not yet committed) has nothing to read.
  const paths = listed.stdout.toString().split('\0').filter(path => path && existsSync(resolve(PROJECT_ROOT, path)));
  expect(paths).toContain('CLAUDE.md');
  const found: { path: string; word: string }[] = [];
  for (const path of paths) {
    const bytes = await Bun.file(resolve(PROJECT_ROOT, path)).bytes();
    if (bytes.includes(0)) continue; // binary
    const word = new TextDecoder().decode(bytes).match(PORTUGUESE)?.[0];
    if (word) found.push({ path, word });
  }
  expect(found).toEqual([]);
});

const git = (...args: string[]) => Bun.spawnSync(['git', ...args], { cwd: PROJECT_ROOT }).stdout.toString().trim();
// The hero directories (heroes/README.md) are tracked only in the private repository.
test.skipIf(git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main')('main ignores heroes/files/', () => {
  expect(git('ls-files', '--', 'heroes/files')).toBe('');
  expect(git('check-ignore', '--no-index', 'heroes/files/x')).toBe('heroes/files/x');
});
// The custom heroes' names are private (heroes/README.md): tracked files on `main` name them only by slot. The one
// match allowed is the owner's GitHub handle (LICENSE, the clone URL). The brackets keep these patterns from matching
// themselves.
test.skipIf(git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main')('main names the custom heroes only by slot', () => {
  const found = git('grep', '-niE', 'd[a]vi|p[a]lmit').split('\n').filter(Boolean);
  expect(found.filter(line => /d[a]vi|p[a]lmit/i.test(line.replace(/[D]avi-ldc/g, '')))).toEqual([]);
});

test('The pins in docs/SKILL.md match the served profiles and the preserved inputs', async () => {
  const text = await Bun.file(resolve(PROJECT_ROOT, 'docs/SKILL.md')).text();
  const pin = (sha256: string, patches: number) => `\`${sha256.slice(0, 8)}…\` (${patches} patches)`;
  const { practice, menu, lan } = profiles;
  expect(lan.wasmSha256).toBe(menu.wasmSha256);
  const files = new Set([...inventory.map(entry => entry.path), SETTINGS.path, CATALOG.path,
    ...bundles.map(bundle => bundle.path)]).size;
  expect({
    original: text.includes(`\`${ORIGINAL_WASM_SHA256.slice(0, 8)}…\``),
    practice: text.includes(`practice ${pin(practice.wasmSha256, practice.patches.length)}`),
    menu: text.includes(`menu and lan ${pin(menu.wasmSha256, menu.patches.length)}`),
    inputs: text.includes(`| Preserved inputs | ${files} files`),
  }).toEqual({ original: true, practice: true, menu: true, inputs: true });
});
