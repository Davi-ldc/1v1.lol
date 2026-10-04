import { poll, verdict, type Scenario } from '../index';
import { goToLobby, ready, until } from '../shared/menu';

// Photon's connection budget (src/host/wasm.ts photonBudget): PhotonConnector.InitConnection (f47916) gives up after
// <WaitForConnection>d__24's wait and disconnects. The page reloads; as the client's boot connect logs
// InitConnection, its main thread stalls 12 s, as a slow client's does through a tunnel while MainMenu loads. The
// client must still reach the lobby ConnectedAndReady with no "Connection timed out"; with the original 10 s, the
// lobby stays Disconnected, without its party slot.
export const photonbudget: Scenario = {
  entry: 'menu',
  async run(context) {
    const { page, observe, sample, screenshot } = context;
    const checks: Record<string, boolean> = {};
    const log: string[] = [];
    let reloaded = 0, stalled = false;
    page.on('console', message => {
      const text = message.text();
      if (!reloaded || !/PhotonConnector:|OnConnectedToMaster/.test(text)) return;
      log.push(`${Math.round(performance.now() - reloaded)} ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
      if (!stalled && text.includes('PhotonConnector:InitConnection')) {
        stalled = true;
        void page.evaluate(() => { const end = performance.now() + 12000; while (performance.now() < end); })
          .catch(() => {});
      }
    });
    reloaded = performance.now();
    await page.reload();
    await page.waitForFunction(() => (window as any).local?.boot?.phase === 'screen-active', undefined,
      { timeout: 180000, polling: 1000 });
    checks.ready = (await until(context, 'start', menu => ready(menu), 20000)).matched;
    checks.stalled = stalled;
    checks.lobby = await goToLobby(context);
    checks.connected = (await poll(context, 'connected', async () => !!(await observe('party')).ready,
      value => value, 60000)).matched;
    sample('photon-log', log);
    checks.noTimeout = !log.some(line => line.includes('Connection timed out'));
    await screenshot('lobby');
    return verdict(checks);
  },
};
