import { poll, verdict, type Scenario } from '../index';
import { goToLobby, ready, until } from '../shared/menu';

/** The lobby's top-left CONNECT button (1280×720). */
const CONNECT = [172, 47] as const;

// A lobby client whose Photon socket drops (OnDisconnected, Cause Exception) reconnects through the original
// PhotonConnector.AttemptReconnect (on the drop, and from the CONNECT button: OnReconnectPressed).
export const photonreconnect: Scenario = {
  entry: 'menu',
  async run(context) {
    const { page, observe, wait, sample, screenshot } = context;
    const checks: Record<string, boolean> = {};
    checks.ready = (await until(context, 'start', menu => ready(menu), 20000)).matched;
    checks.lobby = await goToLobby(context);
    const party = () => observe('party');
    checks.connected = (await poll(context, 'connected', party, view => !!view.ready, 30000)).matched;
    sample('before', await party());
    const log: string[] = [];
    const dropped = performance.now();
    page.on('console', message => {
      const text = message.text();
      if (/PhotonConnector:|AppInitializer|OnConnectedToMaster/.test(text)) {
        log.push(`${Math.round(performance.now() - dropped)} ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    });
    await page.evaluate(() => {
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (this: WebSocket) { WebSocket.prototype.send = send; this.close(); };
    });
    checks.disconnected = (await poll(context, 'disconnected', party, view => !view.ready, 30000)).matched;
    sample('dropped', await party());
    await wait(5000);
    await screenshot('disconnected');
    await page.mouse.click(...CONNECT);
    checks.reconnected = (await poll(context, 'reconnected', party, view => !!view.ready, 45000)).matched;
    sample('after', await party());
    sample('photon-log', log);
    await screenshot('lobby');
    return verdict(checks);
  },
};
