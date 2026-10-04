import type { Native } from './native';
import { field, methodInfo, runtime, slot, staticField, typeInfo, vslot } from './symbols';

// Read accessors for the original client's singletons, shared by the entry, adapters and observers.

/** Active scene handle, build index and, optionally, name. */
export function activeScene(n: Native, withName = false) {
  const handle = n.call(slot.getActiveScene, 0); // Scene is a scalar handle.
  return n.scratch(4, scene => {
    n.setI32(scene, 0, handle);
    return { handle, buildIndex: n.call(slot.sceneBuildIndex, scene, 0),
      name: withName ? n.text(n.call(slot.sceneName, scene, 0)) : undefined };
  });
}

/** Name of GameModeManager's current ModeInfo, or null when no mode is set. */
export function modeName(n: Native) {
  const mode = n.call(slot.modeInfo, 0);
  return mode ? n.text(n.u32(mode, field.ModeInfo.ModeName)) : null;
}

/** FirebaseManager.Instance once its class is initialized and Awake has run, else 0. */
export function firebaseManager(n: Native) {
  return n.resolvedClass(typeInfo.FirebaseManager)
    ? n.u32(n.staticFields(typeInfo.FirebaseManager), staticField.FirebaseManager.Instance) : 0;
}

/** The installed ServerUser (FirebaseManager.Instance._serverUser), else 0. */
export function serverUser(n: Native) {
  const manager = firebaseManager(n);
  return manager ? n.u32(manager, field.FirebaseManager._serverUser) : 0;
}

/** UiManager and its LoadoutScreen once both are live, else null. */
export function loadoutRoots(n: Native) {
  const ui = n.call(slot.uiManagerInstance, 0);
  if (!ui) return null;
  n.instance(ui, n.resolvedClass(typeInfo.UiManager));
  if (!n.alive(ui)) return null;
  const handler = n.u32(ui, field.UiManager._switchHandler), screen = n.u32(ui, field.UiManager._loadoutScreen);
  return handler && screen && n.alive(screen) ? { ui, handler, screen } : null;
}

/** Every object of a type (1v1.dll by default) in the loaded scenes, inactive ones included. */
export function objectsOfType(n: Native, type: string, assembly = '1v1', max = 512) {
  const system = n.call(slot.typeGetType, n.newString(`${type}, ${assembly}`), 1, 0);
  return n.array(n.call(slot.findObjectsOfType, system, 1, 0), max);
}

/** A remote-config handler registered in FirebaseConfigHandler._firebaseSettingsHandlers, by class name, else 0. */
export function settingsHandler(n: Native, className: string) {
  if (!n.resolvedClass(typeInfo.FirebaseConfigHandler)) return 0;
  const handlers = n.u32(n.staticFields(typeInfo.FirebaseConfigHandler),
    staticField.FirebaseConfigHandler._firebaseSettingsHandlers);
  return n.list(handlers, 64).find(item => n.className(item) === className) ?? 0;
}

/**
 * A local remote-config document through the handler's own Init (AFirebaseSettingsHandler, vslot 4), shaped as the
 * original fetch: `{ <idKey>: 'offline', <configKey>: '{"Configs":{"offline":<config>}}' }`, parsed by Newtonsoft.
 */
export function initSettings(n: Native, handler: number, [idKey, configKey]: [string, string], config: object) {
  const json = JSON.stringify({ [idKey]: 'offline', [configKey]: JSON.stringify({ Configs: { offline: config } }) });
  const dictionary = n.check(n.call(slot.jsonDeserialize, n.newString(json), n.metadata(methodInfo.jsonDictionary)));
  n.callVirtual(handler, vslot.settingsHandlerInit, dictionary);
}

/** The Data an AFirebaseSettingsHandler<T> parsed (`cell`: that generic class's TypeInfo), or 0 before any. */
export function settingsData(n: Native, cell: number) {
  const statics = n.staticFields(n.metadata(cell) && cell);
  return n.bool(statics, runtime.settingsAvailable) ? n.u32(statics, runtime.settingsData) : 0;
}

/** LocalProductsData, the original local product catalogue (ScriptableObject singleton). */
export const localProducts = (n: Native) =>
  n.check(n.call(slot.soInstance, n.metadata(methodInfo.localProductsInstance)));

/** FactoryManagedInstance<T>.Instance, for the MethodInfo cell of its get_Instance. */
export const factory = (n: Native, cell: number) => n.check(n.call(slot.productFactoryInstance, n.metadata(cell)));
