import { initSettings, settingsData, settingsHandler } from '../game';
import { waitFor, type Native } from '../native';
import { field, slot, staticField, typeInfo } from '../symbols';

/** Milliseconds without an answer before Photon gives up (the SDK default is 10 000). */
const DISCONNECT_TIMEOUT = 30000;

/**
 * Starts the original Photon connection in the lan profile. The skipped startup (AppInitializer.Initialize) fetches
 * remote config, region info and a Firebase login, then runs AppInitializer.ConnectToPhoton, whose
 * PhotonConnector.InitConnection needs FirebaseCheaterSettingsData. That data comes here through its own handler with
 * EnablePhotonAuth off (no Firebase token), and the original ConnectToPhoton step runs. Version data stays absent as
 * offline: the serialized AppVersion 0.306 is kept, and VersionManager/PCVersionExpiredManager never start.
 * Photon's sockets reach the local server through the page's WebSocket (browser.ts). The original Initialize still
 * starts, sets AppInitializer.IsInitializing and stays on its remote-config await ("GetRemoteConfig Start", no End);
 * once ConnectToPhoton has run its connection step, that flag is cleared: <AttemptReconnect>d__30 (f47923 +0x17f)
 * returns before PhotonConnector.Connect while it is set, so a dropped client would never reconnect, neither on the
 * drop nor from CONNECT (docs/reference/network.md).
 *
 * Adaptation: PhotonPeer.DisconnectTimeout goes from 10 to 30 s, because loading the MainMenu (at start, after a
 * match) blocks the page for 10–14 s on a loaded machine and the client would time out (ClientTimeout).
 */
export async function installPhotonConnect(n: Native) {
  let handler = 0;
  if (!await waitFor(() => handler = settingsHandler(n, 'FirebaseCheaterSettingsHandler'), 200)) {
    throw new Error('FirebaseCheaterSettingsHandler is not registered.');
  }
  // Empty sub-configs: their constructors leave the detectors' thresholds at the code default 0 (the remote values
  // are lost; offline the detectors read zeros too). Detections stay local in custom games. JSON names: the fields'
  // JsonProperty names, in field order at global-metadata.dat 18207711.
  initSettings(n, handler, ['CheaterSettingsID', 'CheaterSettings'], { fast_landing_config: {}, flying_config: {},
    excessive_fire_rate: {}, excessive_ability_usage: {}, weapon_mismatch_config: {}, enable_photon_auth: false });
  const data = settingsData(n, typeInfo.CheaterSettingsHandler);
  if (!data || !n.u32(data, field.FirebaseCheaterSettingsData.FlyingConfig)) {
    throw new Error('CheaterSettings was not parsed.');
  }
  n.check(n.call(slot.connectToPhoton, 0));
  n.write(n.staticFields(typeInfo.AppInitializer), staticField.AppInitializer.IsInitializing, new Uint8Array([0]));
  const client = n.u32(n.staticFields(typeInfo.PhotonNetwork), staticField.PhotonNetwork.NetworkingClient);
  const peer = n.check(n.u32(n.check(client), field.LoadBalancingClient.LoadBalancingPeer));
  n.call(slot.setDisconnectTimeout, peer, DISCONNECT_TIMEOUT, 0);
  return { connectRequested: true, disconnectTimeout: n.i32(peer, field.PhotonPeer.disconnectTimeout),
    initializing: n.bool(n.staticFields(typeInfo.AppInitializer), staticField.AppInitializer.IsInitializing) };
}
