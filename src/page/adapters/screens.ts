import { objectsOfType } from '../game';
import type { Native } from '../native';
import { field, slot } from '../symbols';

/** ScreenName values that open offline: Loadout, Friends, ChampionOverview, ChampionSelection. */
const OFFLINE_SCREENS = new Set([15, 24, 33, 34]);
/** Adaptation: ScreenName values the offline menu does not offer: Locker, Shop, BattlePass. */
const HIDDEN_SCREENS = new Set([3, 4, 10]);
/**
 * Adaptation: MainMenu buttons that lead there without a screen switcher, to the lost app stores or to an ad, by
 * GameObject name among the lobby's UI.Buttons: the SHOP variant, the pass ticket, the personal-offer star, the
 * "Download on the App Store"/"Get it on Google Play" badges and the battle pass's rewarded-video XP booster "×2 FREE"
 * beside the mode button, with its timer panel (XPBoostUIManager._containerGO) (docs/reference/menu.md).
 */
const HIDDEN_BUTTONS = new Set(['ShopButtonVariantChapter2', 'BattlePassButtonDisabled', 'PsfShowPersonalOfferPopup',
  'iOSDownload', 'AndroidDownload', 'RvBoosterLobbyButton']);

/**
 * ScreenSwitchHandler.ValidateCanMoveToScreen lets the offline screens through its internet/config/login gates
 * (Friends fails only on "RemoteConfigRequired"), and each UiManager.Start (every MainMenu load)
 * takes out of their Canvas, with the original Transform.SetParent(null), every OnClickScreenSwitcher (tab or button)
 * that leads to a hidden screen and every hidden button. Outside a Canvas they draw nothing and take no clicks, even
 * when the original code activates them again (the battle-pass button swaps variants by notification state).
 */
export async function installScreens(n: Native) {
  const installValidate = await n.prepareHook(slot.validateScreen, 3, original => (handler, screen, method) =>
    OFFLINE_SCREENS.has(screen) ? 1 : original(handler, screen, method));
  const detach = (gameObject: number) => {
    if (gameObject && n.alive(gameObject)) {
      n.call(slot.transformSetParent, n.check(n.call(slot.gameObjectTransform, gameObject, 0)), 0, 0);
    }
  };
  const installStart = await n.prepareHook(slot.uiManagerStart, 2, original => (manager, method) => {
    original(manager, method);
    try {
      for (const switcher of objectsOfType(n, 'OnClickScreenSwitcher')) {
        if (!HIDDEN_SCREENS.has(n.i32(switcher, field.OnClickScreenSwitcher._screenToSwitchTo))) continue;
        detach(n.check(n.call(slot.componentGameObject, switcher, 0)));
      }
      for (const boost of objectsOfType(n, 'XPBoostUIManager')) {
        detach(n.u32(boost, field.XPBoostUIManager._containerGO));
      }
      // The MainMenu holds ~4200 UI.Buttons, inactive ones included (~70 ms).
      for (const button of objectsOfType(n, 'UnityEngine.UI.Button', 'UnityEngine.UI', 8192)) {
        const gameObject = n.check(n.call(slot.componentGameObject, button, 0));
        if (HIDDEN_BUTTONS.has(n.text(n.call(slot.objectName, gameObject, 0)))) detach(gameObject);
      }
    } catch (error) { console.error('LOCAL_SCREENS', 'hiding failed', String(error)); } // Never breaks Start.
    return 0;
  }, 0);
  installValidate();
  installStart();
  return {};
}
