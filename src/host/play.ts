import { statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PROJECT_ROOT } from './build/inputs';
import { isProfile, profiles } from './profiles';
import { heroIds } from './server';
import { withRun } from '../../tests/e2e/harness/run';

const { values } = parseArgs({ args: Bun.argv.slice(2), strict: true, options: {
  profile: { type: 'string', default: 'practice' },
  port: { type: 'string', default: '8080' },
  // A local reverse proxy's name to accept too, e.g. `tailscale serve`/`funnel`'s <machine>.<tailnet>.ts.net.
  host: { type: 'string', multiple: true, default: [] },
  // Reached from the internet through a tunnel: every request needs the access key of the printed link. The key and
  // the players' IDs persist in .lan/ (git-ignored), so the link and the IDs survive restarts.
  public: { type: 'boolean', default: false },
  // With --public: the tunnel's bare address works without the key.
  open: { type: 'boolean', default: false },
  // The custom heroes (heroes/README.md), menu and lan only: a directory with names.json and one subdirectory per
  // hero, named by its slot (beam, elastic), each checked against its manifest.json and served at
  // /local/heroes/<slot>/.
  heroes: { type: 'string' },
} });
if (!isProfile(values.profile) || profiles[values.profile].entry === 'none') {
  throw new Error('Use --profile practice, menu or lan.');
}
const profile = values.profile, port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be 1–65535.');
if (values.public && profile !== 'lan') throw new Error('--public needs --profile lan.');
if (values.open && !values.public) throw new Error('--open needs --public.');

// Without --heroes, menu and lan take the repository's own heroes/files/ (ignored on main) when it has a hero's
// directory.
const OWN_HEROES = resolve(PROJECT_ROOT, 'heroes/files');
const ownHeroes = profiles[profile].entry === 'menu' && (await heroIds())
  .some(id => statSync(resolve(OWN_HEROES, id), { throwIfNoEntry: false })?.isDirectory()) ? OWN_HEROES : undefined;
const heroes = values.heroes ? resolve(values.heroes) : ownHeroes;

const LAN = resolve(PROJECT_ROOT, '.lan');
async function accessKey() {
  await mkdir(LAN, { recursive: true });
  const file = Bun.file(resolve(LAN, 'key'));
  if (await file.exists()) return (await file.text()).trim();
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('base64url');
  await Bun.write(file, key);
  return key;
}
const key = values.public ? await accessKey() : undefined;

const { problems } = await withRun({
  kind: `play-${profile}`, profile, port, hosts: values.host, key, open: values.open,
  heroes, lanIds: values.public ? resolve(LAN, 'ids.json') : undefined, eventsFile: 'events.json',
  manifest: { port, hosts: values.host, public: values.public, open: values.open,
    browser: 'personal browser: CSP and page guards only, no network namespace' },
  async body({ host, signal }) {
    if (host.heroes) console.log(`\nCustom heroes from ${heroes}: ${Object.keys(host.heroes).join(', ')}.`);
    if (key) {
      // A tunnel's name given as --host (./start passes its quick tunnel's) makes the link ready to share.
      console.log('\nLink for you and your friends (the key is part of it):');
      const names = values.host.length ? values.host : ['<tunnel name>'];
      for (const name of names) console.log(`  https://${name}/?k=${key}`);
      console.log(`  ${host.origin}/?k=${key}  (this machine)\nCtrl+C stops the server.\n`);
    } else {
      console.log(`\nOpen ${host.origin} in Chrome or Edge (profile ${profile}; see the README). Ctrl+C stops it.\n`);
      for (const name of values.host) console.log(`Through the tailnet: https://${name}\n`);
    }
    if (!signal.aborted) await new Promise(stopped => signal.addEventListener('abort', stopped, { once: true }));
  },
  summary: (problems, events) =>
    ({ status: problems.length ? 'failed' : 'stopped', problems, summary: events.summary() }),
});
for (const problem of problems) console.error(problem);
