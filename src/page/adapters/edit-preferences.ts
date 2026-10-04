import type { Native } from '../native';
import { slot, staticField, typeInfo } from '../symbols';

/**
 * Turns on SettingsPanel.EditOnRelease, ResetEditWithoutConfirm and ScrollWheelReset for this session through
 * the original UI toggle callbacks (their bodies ignore `this`/MethodInfo). Not persisted.
 */
export function enableEditPreferences(n: Native) {
  const S = staticField.SettingsPanel;
  const read = () => {
    if (!n.resolvedClass(typeInfo.SettingsPanel)) return null;
    const statics = n.staticFields(typeInfo.SettingsPanel);
    return { editOnRelease: n.bool(statics, S.EditOnRelease),
      resetEditWithoutConfirm: n.bool(statics, S.ResetEditWithoutConfirm),
      scrollWheelReset: n.bool(statics, S.ScrollWheelReset) };
  };
  try {
    const before = read();
    for (const callback of [slot.editOnRelease, slot.resetEditWithoutConfirm, slot.scrollWheelReset]) {
      n.call(callback, 0, 1, 0);
    }
    const after = read();
    if (!after || !Object.values(after).every(Boolean)) throw new Error('Editing preferences did not apply.');
    return { status: 'configured' as const, before, after };
  } catch (error) { return { status: 'error' as const, reason: String(error) }; }
}
