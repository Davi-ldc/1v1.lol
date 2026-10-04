import { ageLimitSilent, awakeGate, dailySpins, grantAnalytics, loadouts, localSelection, menuAccess, noAds,
  ORIGINAL_WASM_SHA256, partyCodes, photonBudget, scrollReset, validNicknames, type Patch } from './wasm';

export type Profile = 'baseline' | 'practice' | 'menu' | 'lan';
export type Entry = 'none' | 'practice' | 'menu';
/**
 * What src/page/main.ts installs: the browser shims (guards, auth reply, raw pointer) and native adapters.
 * `photon` sends Photon's sockets to the local server at /photon (src/host/photon/) instead of blocking them; `party`
 * points the party share link at this host and hides the friendly-match toggle (src/page/adapters/party.ts); `hero`
 * installs the custom heroes' page extension (heroes/README.md), which no profile lists: the host adds it to `menu` and
 * `lan` only with --heroes (server.ts).
 */
export type Feature = 'browser' | 'photon' | 'serverUser' | 'catalogs' | 'screens' | 'requiredData' | 'gameModes' |
  'party' | 'rename' | 'railgunScope' | 'editPreferences' | 'hero';

export interface ProfileDefinition {
  entry: Entry;
  features: Feature[];
  /** Serve the original Addressables settings, the derived 4.701 catalog and local bundles (build/inputs.ts). */
  addressables: boolean;
  patches: readonly Patch[];
  wasmSha256: string;
}

const menuPatches = [...awakeGate, ...noAds, ...menuAccess, ...loadouts, ...localSelection, ...grantAnalytics,
  ...dailySpins, ...scrollReset, ...ageLimitSilent, ...partyCodes, ...validNicknames, ...photonBudget];
const MENU_WASM = 'b565b6a64428170c7a95da6d84b997c259e980b6ae9975e745b5150616b8ea89';

export const profiles: Record<Profile, ProfileDefinition> = {
  // Original binaries, nothing installed: control run.
  baseline: { entry: 'none', features: [], addressables: false, patches: [], wasmSha256: ORIGINAL_WASM_SHA256 },
  // Practice scene 5 through the GameManager.Awake debug route; original starting weapons via Addressables.
  practice: {
    entry: 'practice', features: ['browser', 'editPreferences'], addressables: true,
    patches: [...awakeGate, ...noAds],
    wasmSha256: 'fdb733fbdfa4eceefe8dfcdaa14201f9ec821f5a8126bbfabb220b0217e69d2e',
  },
  // MainMenu scene 1 and the original LoadoutScreen over the local native ServerUser; graphics via Addressables.
  menu: {
    entry: 'menu', features: ['browser', 'serverUser', 'catalogs', 'screens', 'requiredData', 'railgunScope'],
    addressables: true,
    patches: menuPatches, wasmSha256: MENU_WASM,
  },
  // The menu profile with Photon online against the local server (self-hosted multiplayer).
  lan: {
    entry: 'menu',
    features: ['browser', 'photon', 'serverUser', 'catalogs', 'screens', 'requiredData', 'gameModes', 'party',
      'rename', 'railgunScope'],
    addressables: true, patches: menuPatches, wasmSha256: MENU_WASM,
  },
};

export const isProfile = (name: string): name is Profile => Object.hasOwn(profiles, name);
