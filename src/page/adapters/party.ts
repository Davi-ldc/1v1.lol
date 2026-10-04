import type { Native } from '../native';
import { field, slot, stringLiteral } from '../symbols';

/**
 * The party UI of the lan profile (docs/reference/network.md):
 * - Share link: PartyShare.ShareLink (f48357) shares ApiUrls.GetFullUrl(BaseWebUrl, "party") + "?code=" + the code,
 *   and get_BaseWebUrl (f98031) returns the literal "https://1v1.lol/", a site that no longer serves this game. That
 *   literal's metadata cell, once initialized, points at this host (with the access key in public mode), so the link
 *   opens here; the original DeepLinkManager (Awake f47451 → OnDeepLinkActivated f47452) reads /party?code= from the
 *   page address and Connector.OnPartyDeepLink (f114328) enters the party.
 * - Adaptation: no friendly match. UiManager.UpdatePartyState (f52109) shows PartyFriendlyBattleUI's toggle and
 *   options through direct calls (f48129), so a zero scale does not keep them hidden. On each UiManager.Start (every
 *   MainMenu load) both containers leave their Canvas (Transform.SetParent(null)): activated, they draw nothing and
 *   take no clicks, and IsFriendlyBattle keeps its default (off).
 */
export async function installParty(n: Native, base: string) {
  const url = n.newString(base);
  n.gcAlloc(url); // Held for the page's lifetime: the literal cell refers to it.
  n.metadata(stringLiteral.baseWebUrl);
  n.setU32(stringLiteral.baseWebUrl, 0, url);
  const F = field.PartyFriendlyBattleUI;
  const installStart = await n.prepareHook(slot.uiManagerStart, 2, original => (manager, method) => {
    original(manager, method);
    const ui = n.u32(manager, field.UiManager._friendlyBattleUI);
    for (const offset of ui ? [F._friendlyBattleToggleContainer, F._friendlyBattleOptionsContainer] : []) {
      const container = n.u32(ui, offset);
      if (!container || !n.alive(container)) continue;
      n.call(slot.transformSetParent, n.check(n.call(slot.gameObjectTransform, container, 0)), 0, 0);
    }
    return 0;
  }, 0);
  installStart();
  return { baseWebUrl: n.text(n.u32(stringLiteral.baseWebUrl)) };
}
