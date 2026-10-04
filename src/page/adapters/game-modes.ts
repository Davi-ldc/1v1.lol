import { initSettings, settingsData, settingsHandler } from '../game';
import { waitFor, type Native } from '../native';
import { field, methodInfo, slot, staticField, typeInfo } from '../symbols';

/** Scenes of local custom modes that are neither among the 34 build scenes (catalog 4.701 "Scenes/…") nor bundled. */
const MISSING_SCENES = new Set(['Gulag', 'Deathrun', 'Vikings']);

/**
 * lan profile: the ChooseMode screen's categories come from the remote GameModesV5 document (FirebaseGameModesData),
 * lost with its service; without it ModeMenuManager.OnEnable (f46135) shows only Practice. The local document keeps
 * every other consumer on its absent-data behaviour (docs/reference/menu.md): no Competitive/Casual modes ([[]],
 * since an empty outer list divides by zero in DailyModesRotationManager.CalculateIndexBasedOnModeType f46450),
 * Practice = the original offline list in order, waits of 10 s (the fallbacks of GameManager.SetGameStartTime f45926
 * and CheckPlayersReady f45930; the constructor would give 30/15), no late-join kick (f45947), no overrides, featured
 * modes, trophies or reveal XP, and DefaultMode unset (f50558 keeps DefaultLocalGameMode).
 * Adaptation: the original custom list is lost; Custom lists every local mode with IsCustomGame and a menu entry
 * whose scenes exist, in ModesMenuSettings order (21 fit the category's 4/10/22 buttons).
 */
export async function installGameModes(n: Native) {
  let handler = 0;
  if (!await waitFor(() => handler = settingsHandler(n, 'FirebaseGameModesHandler'), 200)) {
    throw new Error('FirebaseGameModesHandler is not registered.');
  }
  const name = (ui: number) => n.text(n.u32(ui, field.ModeUI.ModeName));
  const practice = n.list(n.check(n.call(slot.offlineModes, 0)), 64).map(name);
  const properties = n.check(n.call(slot.soInstance, n.metadata(methodInfo.modesPropertiesInstance)));
  const M = field.ModeInfo, modes = new Map(n.list(n.u32(properties, field.ModesProperties._modesInfo), 256)
    .map(mode => [n.text(n.u32(mode, M.ModeName)), mode]));
  const menu = n.u32(n.staticFields(typeInfo.ModesMenuSettings), staticField.ModesMenuSettings._modeDictionary);
  const custom = n.dictionary(menu, 256).map(([, ui]) => name(ui)).filter(mode => {
    const info = modes.get(mode), pool = info && n.u32(info, M._scenePool);
    return info && n.bool(info, M.IsCustomGame) && pool &&
      n.dictionary(pool).every(([scene]) => !MISSING_SCENES.has(n.text(scene)));
  });
  if (!practice.length || !custom.length) throw new Error('No local practice or custom modes.');
  // JSON names: the fields' JsonProperty names, in field order at global-metadata.dat 18149556.
  initSettings(n, handler, ['GameModesID', 'GameModesV5'], { default_mode: null, competitive_modes: [[]],
    casual_modes: [[]], practice_modes: practice, custom_modes: [custom], featured_modes: [], modes_rotation_hour: 0,
    max_wait_time_for_players: 10, min_wait_time_for_players: 10, late_join_kick_delay: 1e6, modes_info: {},
    daily_first_win_trophies: 0, daily_mode_reveal_xp: 0 });
  const data = settingsData(n, typeInfo.GameModesHandler);
  const parsed = data ? n.list(n.u32(data, field.FirebaseGameModesData.CustomModes)) : [];
  if (parsed.length !== 1 || n.list(parsed[0]!, 64).length !== custom.length) {
    throw new Error('GameModesV5 was not parsed.');
  }
  return { practice, custom };
}
