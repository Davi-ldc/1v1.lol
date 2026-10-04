import { waitFor, type Native } from '../native';
import { field, slot } from '../symbols';

/**
 * The original required Addressables download that the offline entry skips: AppInitializer.InitializeAddressables
 * (f47077, slot 9566; its state machine is f47104) runs AddressablesHandler.Init, then DownloadAllRequiredData once
 * DidInit is set (docs/reference/assets.md). Init's only remote step, RefreshCatalogs (catalog update check on the
 * CDN), has no newer catalog to find offline: it completes at once with Task.CompletedTask. No path reachable offline
 * sets DidInit (only its setter stores +17), so the original setter records Init's successful end. The original
 * download then runs on the local catalog, where every bundle is held, within a bound.
 */
export async function installRequiredData(n: Native) {
  const installRefresh = await n.prepareHook(slot.refreshCatalogs, 2, () => () => n.call(slot.completedTask, 0));
  installRefresh();
  const handler = n.check(n.call(slot.addressablesInstance, 0));
  const flag = (offset: number) => n.bool(handler, offset);
  if (!flag(field.AddressablesHandler.DidInit)) {
    const init = n.check(n.call(slot.addressablesInit, handler, 0)), handle = n.gcAlloc(init);
    try {
      if (await waitFor(() => n.call(slot.taskSucceeded, init, 0) === 1, 100)) n.call(slot.setDidInit, handler, 1, 0);
    } finally { n.gcFree(handle); }
  }
  if (!flag(field.AddressablesHandler.DidDownloadRequiredData)) n.call(slot.downloadRequiredData, handler, 0);
  return { requiredData: await waitFor(() => flag(field.AddressablesHandler.DidDownloadRequiredData), 300) };
}
