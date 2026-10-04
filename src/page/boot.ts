import { activeScene, loadoutRoots, modeName } from './game';
import type { Native } from './native';
import { field, methodInfo, slot, staticField, typeInfo } from './symbols';

export interface BootCheckpoint {
  phase: 'scene-requested' | 'scene-loaded' | 'loadout-requested' | 'screen-active' | 'blocked';
  message: string;
}

const PRACTICE_SCENE = 5, MAIN_MENU_SCENE = 1;

/**
 * The LoadingScreenManager subscribed to AppInitializer.OnInitRemoteConfig once its job list exists, else 0.
 * This is the readiness signal of the initial scene; the manager also owns the overlay hidden on entry.
 */
function loadingManager(n: Native) {
  try {
    const loadingClass = n.resolvedClass(typeInfo.LoadingScreenManager);
    if (!loadingClass) return 0;
    const onInitRemoteConfig = n.check(n.u32(methodInfo.loadingOnInitRemoteConfig));
    const targets = new Set<number>(), visited = new Set<number>();
    const walk = (delegate: number, depth: number) => {
      if (!delegate) return;
      if (depth > 4 || visited.size >= 32 || visited.has(delegate)) throw new Error('Delegate traversal limit.');
      visited.add(delegate);
      const children = n.u32(delegate, field.MulticastDelegate.delegates);
      if (children) {
        for (const child of n.array(children)) walk(child, depth + 1);
        return;
      }
      const target = n.u32(delegate, field.Delegate.m_target);
      if (target && n.u32(target) === loadingClass && n.u32(delegate, field.Delegate.method) === onInitRemoteConfig) {
        targets.add(target);
      }
    };
    walk(n.u32(n.staticFields(typeInfo.AppInitializer), staticField.AppInitializer.OnInitRemoteConfig), 0);
    if (targets.size !== 1) return 0;
    const manager = [...targets][0]!;
    const jobs = n.list(n.u32(manager, field.LoadingScreenManager._loadingJobs)).length;
    return jobs && n.u32(manager, field.LoadingScreenManager._completedLoadingJobsCount) <= jobs ? manager : 0;
  } catch { return 0; }
}

/** SetActive(false) on the old loading overlay; no loading job is marked complete. */
function hideLoadingOverlay(n: Native, manager: number) {
  n.instance(manager, n.resolvedClass(typeInfo.LoadingScreenManager));
  if (!n.u32(manager, field.UnityObject.m_CachedPtr)) return false;
  n.call(slot.gameObjectSetActive, n.check(n.call(slot.componentGameObject, manager, 0)), 0, 0);
  return true;
}

function enterScene(n: Native, entry: 'practice' | 'menu') {
  const scene = activeScene(n), room = n.call(slot.currentRoom, 0), connected = n.call(slot.isConnected, 0) !== 0;
  if (entry === 'practice') {
    const mode = modeName(n);
    if (scene.buildIndex !== 0 || room !== 0 || connected || (mode !== null && mode !== 'Practice')) {
      throw new Error('Practice entry requires the initial scene, disconnected Photon, no room and no other mode.');
    }
    n.call(slot.loadSceneAsync, PRACTICE_SCENE, 0, 0);
    return;
  }
  // The original startup connects Photon before MainMenu (AppInitializer.ConnectToPhoton), as the lan profile does.
  if (scene.buildIndex !== 0 || room !== 0) throw new Error('Menu entry requires the initial scene and no room.');
  if (!n.call(slot.loadSceneAsync, MAIN_MENU_SCENE, 0, 0)) throw new Error('MainMenu load returned no operation.');
}

/** Original scene entry: Practice (scene 5) or MainMenu (scene 1) + original ShowLoadoutScreen(Weapons). */
export function startBoot(n: Native, entry: 'practice' | 'menu', report: (checkpoint: BootCheckpoint) => void) {
  let requested = false, opened = false, overlayHidden = false, ticks = 0;
  const timer = setInterval(() => {
    const finish = (checkpoint: BootCheckpoint) => { clearInterval(timer); report(checkpoint); };
    if (++ticks > 600) return finish({ phase: 'blocked',
      message: 'The local entry did not finish in time; see the console.' });
    try {
      const loading = loadingManager(n);
      if (!requested) {
        if (!loading) return;
        enterScene(n, entry);
        requested = true;
        return report({ phase: 'scene-requested',
          message: entry === 'practice' ? 'Opening the original practice scene…' : 'Opening the original MainMenu…' });
      }
      if (entry === 'practice') {
        if (!loading || activeScene(n).buildIndex !== PRACTICE_SCENE) return;
        if (!overlayHidden) overlayHidden = hideLoadingOverlay(n, loading);
        return finish({ phase: 'scene-loaded', message: 'Practice scene loaded.' });
      }
      if (activeScene(n).buildIndex !== MAIN_MENU_SCENE) return;
      const roots = loadoutRoots(n);
      if (!roots) return;
      if (!opened) {
        if (loading && !overlayHidden) overlayHidden = hideLoadingOverlay(n, loading);
        n.call(slot.showLoadoutScreen, roots.ui, 0, 0); // Category 0 = Weapons.
        opened = true;
        return report({ phase: 'loadout-requested', message: 'Opening the original Loadout…' });
      }
      if (n.call(slot.behaviourActiveAndEnabled, roots.screen, 0) !== 0) {
        finish({ phase: 'screen-active', message: 'Original Loadout active.' });
      }
    } catch (error) {
      finish({ phase: 'blocked', message: `The local entry failed: ${String(error)}` });
    }
  }, 100);
}
