import { sha256 } from './build/inputs';

export const ORIGINAL_WASM_SHA256 = '52b3dc8a49d4a08dc9d2fafe78a35de193df42570dc1088ff5d6e06653390a8f';

/** Byte patch on the original WASM: `offset` is a file offset inside function `f`. */
export interface Patch { f: number; offset: number; before: number[]; after: number[]; why: string }

const hex = (value: string) => [...Buffer.from(value, 'hex')];

/** Replaces an instruction window, padding the rest with `nop` (0x01). */
function windowPatch(f: number, offset: number, before: number[], body: number[], why: string): Patch {
  if (body.length > before.length) throw new Error(`Patch 0x${offset.toString(16)} exceeds its window.`);
  return { f, offset, before, after: [...body, ...Array(before.length - body.length).fill(0x01)], why };
}

/** `call <function index>` with LEB128 immediate. */
function call(index: number) {
  const bytes = [0x10];
  do { const byte = index & 0x7f; index >>>= 7; bytes.push(byte | (index ? 0x80 : 0)); } while (index);
  return bytes;
}

export const awakeGate: Patch[] = [
  { f: 45922, offset: 0x00fced57, before: [0x10, 0xa6, 0x95, 0x03], after: [0x1a, 0x41, 0x01, 0x01],
    why: 'GameManager.Awake: this editor check drops its MethodInfo and yields true, enabling the debug bootstrap. ' +
      'Global IsEditor untouched.' },
];

export const noAds: Patch[] = [
  { f: 49756, offset: 0x010eb8d2, before: [0x41, 0xed, 0x8f, 0x92, 0x06], after: [0x41, 0x00, 0x0f, 0x01, 0x01],
    why: 'ShouldUserViewAds returns false.' },
  { f: 49757, offset: 0x010eb979, before: [0x23, 0x00], after: [0x0f, 0x01],
    why: 'Interstitial preparation returns before stack allocation (web target is already a no-op).' },
  { f: 49760, offset: 0x010ebc34, before: [0x41, 0xf1, 0x8f, 0x92, 0x06], after: [0x0f, 0x01, 0x01, 0x01, 0x01],
    why: 'Banner removal returns; no embedded ad exists.' },
  { f: 49764, offset: 0x010ec13f, before: [0x41, 0xed, 0x8f, 0x92, 0x06], after: [0x0f, 0x01, 0x01, 0x01, 0x01],
    why: 'Embedded-ad visibility update returns.' },
  { f: 49765, offset: 0x010ec319, before: [0x41, 0xed, 0x8f, 0x92, 0x06], after: [0x0f, 0x01, 0x01, 0x01, 0x01],
    why: 'Banner visibility update returns.' },
  { f: 49767, offset: 0x010ec59a, before: [0x41, 0xf7, 0x8f, 0x92, 0x06], after: [0x41, 0x00, 0x0f, 0x01, 0x01],
    why: 'IsRewardedVideoReady returns false: the ad provider is only created after remote ads config, ' +
      'so none exists offline. Zombies CanShowRv then continues to CheckForGameOver.' },
  { f: 49777, offset: 0x010ecc30, before: [0x41, 0x81, 0x90, 0x92, 0x06], after: [0x0f, 0x01, 0x01, 0x01, 0x01],
    why: 'Rewarded-info registration returns; no reward is granted.' },
];

export const menuAccess: Patch[] = [
  { f: 43611, offset: 0x00f0525e, before: [0x45, 0x0d, 0x00, 0x20, 0x00, 0x2d, 0x00, 0x08, 0x45, 0x0d, 0x00],
    after: [0x1a, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01],
    why: 'Lobby loadout button: drop the remote-config gate pointer instead of dereferencing absent config.' },
];

export const loadouts: Patch[] = [
  { f: 49905, offset: 0x010f64ac, before: [0x41, 0xb8, 0xd2, 0xae, 0x05], after: [0x41, 0x01, 0x0c, 0x00, 0x01],
    why: 'ModeInfo.UsesLoadout: a mode with native _usesLoadout uses the loadout; ' +
      'EquipmentV2 are_loadouts_enabled, absent offline, counts as true.' },
];

/** `this.<field>.gameObject.SetActiveEfficient(false)` for a component field of `this` (local 0). */
const hideComponent = (field: number) =>
  [0x20, 0, 0x28, 2, field, 0x41, 0, ...call(170492), 0x41, 0, 0x41, 0, ...call(50251)];

export const localSelection: Patch[] = [
  windowPatch(48777, 0x0109b2ac, hex('41b4bef1054100360200'), [0x0c, 10],
    'EquipWeaponSkin: after the native local selection, skip the backend call and its await.'),
  windowPatch(48777, 0x0109b53d, hex('41b4bef1054100360200418723200341386a41e089b7052802001011210241b4bef105280200' +
    '210141b4bef10541003602000240024002402001410147044041b4bef105410036020020024180f1b60528020010eefd05'),
    hex('024002400240410104404101'),
    'Keep the control blocks, notify the original listeners and complete the local Task(true); ' +
      'do not read or fabricate a server response.'),
  windowPatch(48781, 0x0109bb63, hex('41b4bef1054100360200'), [0x0c, 7],
    'UnequipWeaponSkin: after the native local selection, skip the backend call and its await.'),
  windowPatch(48781, 0x0109bcf5, hex('41b4bef1054100360200418723200341086a41e089b7052802001011210241b4bef105280200' +
    '210141b4bef10541003602000240024002402001410147044041b4bef105410036020020024180f1b60528020010eefd05'),
    hex('024002400240410104404101'),
    'Keep the control blocks, notify the original listeners and complete the local Task(true); ' +
      'do not read or fabricate a server response.'),
  windowPatch(48777, 0x0109b73d, hex('2000101e'), hex('1a1a1a01'),
    'Do not queue cosmetic analytics after the local equip; notifications and Task completion remain original.'),
  windowPatch(48781, 0x0109bef5, hex('2000101e'), hex('1a1a1a01'),
    'Do not queue cosmetic analytics after the local unequip; notifications and Task completion remain original.'),
  windowPatch(50668, 0x0112d594, hex('200420063702342004'), [0x20, 4, 0x41, 0x90, 1, 0x6a, 0x24, 0, 0x0f],
    'Return after native equip/recalc/UI refresh: ' +
      'restore the 144-byte shadow stack before the server request and queue.'),
  windowPatch(43566, 0x00f0261a, hex('20002d008002'), [0x41, 1],
    'Take this method’s own branch that hides upgrade/maxed/blueprint controls.'),
  windowPatch(43564, 0x00f01f49, hex('200028023c210241c9e795062d000045044041f4cfb00510ac0f41c9e7950641013a00000b2003' +
    '41f4cfb00528020028025c28021428024028020828023836026c2002200341ec006a41001089db0a' +
    '200228020022042802d40520042802d005110100'),
    hideComponent(60), 'Hide the currency component instead of reading an absent balance.'),
];

export const grantAnalytics: Patch[] = [
  { f: 97472, offset: 0x02012735, before: [0x10, 0xc0, 0x89, 0x03], after: [0x1a, 0x1a, 0x01, 0x01],
    why: 'UserEquipment.AddItem keeps its BaseLevel/dictionary update and drops its final analytics call.' },
  { f: 97446, offset: 0x0201164a, before: [0x10, 0xc0, 0x89, 0x03], after: [0x1a, 0x1a, 0x01, 0x01],
    why: 'UserChampions.AddChampion keeps its Level=0 entry and drops the same analytics call.' },
];

export const scrollReset: Patch[] = [
  { f: 46257, offset: 0x00fe7127, before: [0x41, 0x00], after: [0x41, 0x01],
    why: 'Adaptation: SettingsPanel.InitSettingsInputs defaults the scroll-wheel edit reset toggle to on. A saved ' +
      'value still wins, and Start copies it into SettingsPanel.ScrollWheelReset, which ' +
      'EditingManager.CheckScrollWheelReset (f45008) reads.' },
];

export const ageLimitSilent: Patch[] = [
  { f: 47571, offset: 0x01040ca8, before: [0x10, 0x8d, 0xf5, 0x05], after: [0x1a, 0x1a, 0x1a, 0x01],
    why: 'LimitedFeaturesManager.ValidateFeature drops its MenuPopupHandler.ShowAgeLimit call (this, content, ' +
      'method) and still returns 4. Offline, AgeGateManager.IsFeatureAvailable (f51668) fails without the Firebase ' +
      'login, so every ad attempt (AdsManager.TryShowingVideoAd on PLAY, StartJoinMode, GameAdsShower) would open ' +
      'the "get full access" AgeLimitedFeaturePopup. The failed validation still skips the ad.' },
];

export const validNicknames: Patch[] = [
  { f: 51669, offset: 0x011782d3, before: [0x20, 0x01, 0x41, 0x03, 0x20, 0x01, 0x10, 0xd4, 0x93, 0x03],
    after: [0x41, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01],
    why: 'AgeGateManager.ToValidNickname keeps the nickname. Its IsFeatureAvailable(Names) (f51668) fails without ' +
      'the Firebase login, so the name tags (PartyRoomConnector.UpdatePartyMembersUI f48324, the PartyMemberInfo ' +
      'and InGamePlayerInfo constructors) would show a generated name instead of the typed one. A logged-in ' +
      'profile with the offline adult age gate (adapters/server-user.ts) passes that check.' },
];

/**
 * Adaptation: one-digit party codes. GenerateRandomRoomName (f116291) formats Random.Range(i·s, i·s + s) with
 * "00000", where s = 10^PartyRoomNameLength / regions, and JoinParty (f48307) refuses shorter codes
 * (docs/reference/network.md). Its callers are direct calls, so only a byte patch reaches them.
 */
export const partyCodes: Patch[] = [
  { f: 118201, offset: 0x0269f6ac, before: [0x28, 0x02, 0x38], after: [0x1a, 0x41, 0x01],
    why: 'GameProperties.get_PartyRoomNameLength drops the asset instance and returns 1: s = 10 / regions (the local ' +
      'Photon server offers one), and JoinParty accepts one-digit codes.' },
  { f: 116291, offset: 0x0260928e, before: [0x41, 0xa8, 0x95, 0xbe, 0x05], after: [0x41, 0xec, 0x94, 0xbe, 0x05],
    why: 'GenerateRandomRoomName initializes the "0" literal cell (StringLiteral[1914], 0xaf8a6c) instead of ' +
      '"00000" (StringLiteral[1929], 0xaf8aa8; also read by DateTimeFormat..cctor, left untouched).' },
  { f: 116291, offset: 0x0260931d, before: [0x41, 0xa8, 0x95, 0xbe, 0x05], after: [0x41, 0xec, 0x94, 0xbe, 0x05],
    why: 'GenerateRandomRoomName formats the room number with "0": codes 0–9; a taken one (GameIdAlreadyExists) ' +
      'makes OnCreateRoomFailed (f48326) call CreateParty again, which draws another.' },
];

/**
 * Adaptation: a 60 s Photon connection budget. PhotonConnector.InitConnection (f47916, reached from Connect and
 * AttemptReconnect) starts <WaitForConnection>d__24 (f47934), which waits _connectionTimeout (PhotonConnector +20,
 * 10 s) and then disconnects unless PhotonNetwork.IsConnectedAndReady (docs/reference/network.md). Through a public
 * tunnel, the NameServer, Master and auth hops can take longer than that while MainMenu loads, and the lobby would
 * stay Disconnected.
 */
export const photonBudget: Patch[] = [
  windowPatch(47934, 0x01058b37, [0x20, 0x00, 0x28, 0x02, 0x10, 0x2a, 0x02, 0x14], [0x43, ...hex('00007042')],
    '<WaitForConnection>d__24 waits a constant 60 s (f32 0x42700000) instead of this._connectionTimeout (10 s).'),
];

export const dailySpins: Patch[] = [
  { f: 115944, offset: 0x025ef1e0, before: [0x23, 0x00], after: [0x0f, 0x01],
    why: 'DailySpins promotional Start returns before registering listeners or preloading popups.' },
  { f: 115945, offset: 0x025ef268, before: [0x41, 0xb4, 0xcc, 0x94, 0x06], after: [0x0f, 0x01, 0x01, 0x01, 0x01],
    why: 'Paired DailySpins cleanup returns; its Start never registered anything.' },
];

/** Applies non-overlapping patches to a copy of the original WASM and pins the result hash. */
export function deriveWasm(source: Uint8Array, patches: readonly Patch[], expectedSha256: string) {
  if (sha256(source) !== ORIGINAL_WASM_SHA256) throw new Error('Refusing an unrecognized WASM build.');
  const bytes = source.slice(), touched = new Set<number>();
  for (const patch of patches) {
    const label = `f${patch.f}@0x${patch.offset.toString(16)}`;
    if (patch.after.length !== patch.before.length) throw new Error(`Patch ${label} changes the window size.`);
    patch.before.forEach((byte, index) => {
      if (source[patch.offset + index] !== byte) throw new Error(`Patch ${label} differs from the original bytes.`);
      if (touched.has(patch.offset + index)) throw new Error(`Patch ${label} overlaps another patch.`);
      touched.add(patch.offset + index);
    });
    bytes.set(patch.after, patch.offset);
  }
  if (!WebAssembly.validate(bytes)) throw new Error('Derived WASM failed validation.');
  const servedSha256 = sha256(bytes);
  if (servedSha256 !== expectedSha256) throw new Error(`Derived WASM hash ${servedSha256} differs from the profile.`);
  return { bytes, servedSha256 };
}
