import { serverUser } from '../game';
import type { Native } from '../native';
import { field, slot } from '../symbols';

/**
 * Adaptation: editing the name on the lobby's profile panel (docs/reference/menu.md).
 * - Its button runs ProfilePanelHandler.SwitchToProfileScreen (f53018), which opens the Profile screen only for a
 *   logged-in account, so for this guest profile it does nothing; the original name field (StartEditName, f53013) is
 *   reachable only while the name is empty ("Click to change name"). The panel's button opens that field instead.
 * - Confirming it (OnEndNameEdit, f53015: profanity check, Connector.OnPlayerNameChanged) caches the name ("nickname",
 *   PlayerPrefs) but publishes ServerUser.GeneralData.Nickname, which only the lost backend's answer updated, so the
 *   others would keep the old name. After the original confirmation, the cached name goes into GeneralData.Nickname
 *   and the original Connector.UpdatePhotonInfo (f114344) publishes it; in party mode it also calls
 *   PartyRoomConnector.OnPlayerDataChanged (f48314), whose "UpdateAllPartyUI" RPC redraws every name tag. The tags
 *   keep the typed name through the validNicknames patch (src/host/wasm.ts).
 */
export async function installRename(n: Native) {
  const installSwitch = await n.prepareHook(slot.switchToProfileScreen, 2, () => (panel, method) => {
    n.call(slot.startEditName, panel, method);
    return 0;
  }, 0);
  const installEnd = await n.prepareHook(slot.endNameEdit, 2, original => (panel, method) => {
    original(panel, method);
    const user = serverUser(n), general = user ? n.u32(user, field.ServerUser.GeneralData) : 0;
    const cached = n.call(slot.cachedNickname, 0), name = n.textOrNull(cached);
    if (!general || !name || name === n.textOrNull(n.u32(general, field.GeneralDataModel.Nickname))) return 0;
    n.call(slot.setNickname, general, cached, 0);
    const connector = n.call(slot.connectorInstance, 0);
    if (connector) n.call(slot.updatePhotonInfo, connector, 0);
    return 0;
  }, 0);
  installSwitch();
  installEnd();
  return {};
}
