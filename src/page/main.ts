import type { Entry, Feature } from '../host/profiles';
import { installCatalogs } from './adapters/catalogs';
import { installGameModes } from './adapters/game-modes';
import { installParty } from './adapters/party';
import { enableEditPreferences } from './adapters/edit-preferences';
import { installPhotonConnect } from './adapters/photon-connect';
import { installRailgunScope } from './adapters/railgun-scope';
import { installRename } from './adapters/rename';
import { installRequiredData } from './adapters/required-data';
import { installScreens } from './adapters/screens';
import { installServerUser } from './adapters/server-user';
import { startBoot, type BootCheckpoint } from './boot';
import { installBrowser, type PointerLockState } from './browser';
import { isUnityModule, native, type Native, type UnityModule } from './native';
import { observeCosmetics, observeItems, observeMenu, observeModes, observeParty, observePopups,
  observePresentation, observeSwitchers } from './observe/menu';
import { observeEdit, observeEmotes, observeMatch, observeWeapons } from './observe/match';

type UnityInstance = { Module: UnityModule; SendMessage(object: string, method: string, payload: string): void };
/**
 * Injected by src/host/server.ts as JSON in #local-config. `heroes`, by slot: the hero files it serves and the
 * slot's entry in names.json (heroes/README.md).
 */
export interface Config { profile: string; entry: Entry; features: Feature[]; key?: string;
  heroes?: Record<string, { files: string[]; name: string; champion: string; skin: string; password?: string }> }
/**
 * A page extension: a separate script the host serves before this bundle, installed as the adapter of its feature
 * (`hero`: heroes/page, with --heroes) and adding its observers.
 */
export interface Extension {
  name: Feature;
  install(n: Native, config: Config): Promise<object>;
  observers?(unity: () => Native): Record<string, (...args: number[]) => unknown>;
}
declare global {
  interface Window {
    local: typeof local;
    localExtensions?: Extension[];
    unityInstance?: UnityInstance;
    createUnityInstance(canvas: HTMLCanvasElement, config: Record<string, unknown>,
      onProgress: (progress: number) => void): Promise<UnityInstance>;
  }
}

/** lan profile: this browser's original install ID and the player's four-digit ID from the host. */
const lan = { device: '', id: '' };
async function identity(device: string) {
  lan.device = device;
  const response = await fetch(`/local/id?device=${encodeURIComponent(device)}`);
  return lan.id = (await response.json() as { id: string }).id;
}

const extensions = window.localExtensions ?? [];
/**
 * Native adapters in install order, before the scene entry; the first failure stops the entry. Extensions go first, so
 * the adapters see what they add.
 */
const adapters: [Feature, (n: Native) => Promise<object>][] = [
  ...extensions.map(({ name, install }): [Feature, (n: Native) => Promise<object>] => [name, n => install(n, config)]),
  ['serverUser', n => installServerUser(n, has('photon') ? identity : undefined)],
  ['catalogs', installCatalogs],
  ['screens', installScreens], ['requiredData', installRequiredData], ['gameModes', installGameModes],
  ['party', n => installParty(n, `${location.origin}/${config.key ? `k/${config.key}/` : ''}`)],
  ['rename', installRename], ['railgunScope', installRailgunScope], ['photon', installPhotonConnect],
];

const config = JSON.parse(document.getElementById('local-config')!.textContent!) as Config;
const has = (feature: Feature) => config.features.includes(feature);
const canvas = document.querySelector<HTMLCanvasElement>('#unity')!;
const status = document.querySelector<HTMLElement>('#local-status');
const unity = () => {
  const module = window.unityInstance?.Module;
  if (!isUnityModule(module)) throw new Error('Unity module unavailable.');
  return native(module);
};

/** Page state and read-only observers used by the probe (tests/e2e/index.ts). */
const local = {
  config,
  state: 'starting',
  progress: 0,
  error: undefined as string | undefined,
  adapters: {} as Record<string, object>,
  boot: null as BootCheckpoint | null,
  pointerLock: null as PointerLockState | null,
  observe: {
    match: () => observeMatch(unity()),
    weapons: (building = 0) => observeWeapons(unity(), building),
    edit: (building = 0) => observeEdit(unity(), building),
    emotes: () => observeEmotes(unity()),
    menu: () => observeMenu(unity()),
    presentation: (all = 0) => observePresentation(unity(), all),
    switchers: () => observeSwitchers(unity()),
    cosmetics: () => observeCosmetics(unity()),
    party: () => observeParty(unity()),
    modes: () => observeModes(unity()),
    items: () => observeItems(unity()),
    popups: () => observePopups(unity()),
    ...Object.assign({}, ...extensions.filter(({ name }) => has(name)).map(({ observers }) => observers?.(unity))),
  },
};
window.local = local;

// Before the loader runs: network guards (Photon to the local server in the lan profile), raw pointer capture and the
// local auth reply.
const flushAuth = has('browser') ? installBrowser(canvas, state => {
  local.pointerLock = state;
  console.info('LOCAL_POINTER_CAPTURE', JSON.stringify(state));
}, has('photon') ? lan : undefined) : undefined;

async function start() {
  try {
    window.unityInstance = await window.createUnityInstance(canvas, {
      dataUrl: '/WebGL.data', frameworkUrl: '/WebGL.framework.js', codeUrl: '/WebGL.wasm',
      // Not the loader's IndexedDB cache (its default for data and bundles): storing there blocks the page ~10 s, long
      // enough for Photon to drop the clients (ClientTimeout), and MainMenu loads 3× slower. The browser's HTTP cache,
      // revalidated by the host's ETag, keeps the files instead.
      streamingAssetsUrl: '/StreamingAssets', cacheControl: () => 'no-store',
      showBanner: (message: string, type: string) => console.error('UNITY_BANNER', type, message),
    }, progress => { local.progress = progress; });
    const n = unity();
    for (const [feature, install] of adapters) {
      if (!has(feature)) continue;
      try { local.adapters[feature] = { status: 'installed', ...await install(n) }; }
      catch (error) {
        local.adapters[feature] = { status: 'error', reason: String(error) };
        throw new Error(`Local ${feature} adapter failed: ${String(error)}`);
      }
    }
    flushAuth?.();
    local.state = 'unity-instance-resolved';
    if (config.entry === 'none') return;
    startBoot(n, config.entry, checkpoint => {
      local.boot = checkpoint;
      if (status) {
        status.textContent = checkpoint.message;
        status.hidden = checkpoint.phase === 'scene-loaded' || checkpoint.phase === 'screen-active';
      }
      console[checkpoint.phase === 'blocked' ? 'error' : 'info']('LOCAL_BOOT', JSON.stringify(checkpoint));
      if (checkpoint.phase === 'scene-loaded' && has('editPreferences')) {
        const preferences = local.adapters.editPreferences = enableEditPreferences(n);
        if (preferences.status !== 'configured') console.error('LOCAL_EDIT_PREFERENCES', JSON.stringify(preferences));
      }
    });
  } catch (error) {
    local.state = 'failed';
    local.error = String(error);
    if (status) status.textContent = `The client failed to open: ${String(error)}`;
    console.error('LOCAL_BOOT_FAILED', String(error));
  }
}

// Classic scripts run in order, so the loader's createUnityInstance exists by DOMContentLoaded.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void start());
else void start();
