import { poll, verdict, type Scenario } from '../index';
import { at, cardAt, goToLobby, press, preview, previewAlive, ready, until } from '../shared/menu';

const PUMP = 'lol.1v1.weapons.pump_shotgun';
const SKIN_PREFIX = 'lol.1v1.weaponskins.pump_shotgun.';

// Original catalogue: 33 skins and 100 emotes (LocalProductsData 8788). The wheel's first eight dances are a local
// preset.
export const cosmetics: Scenario = {
  entry: 'menu',
  async run(context) {
    const { page, observe, sample, screenshot, wait } = context;
    if (!(await until(context, 'start', menu => ready(menu), 10000)).matched) return verdict({}, 'Loadout not ready.');
    const profile = await observe('cosmetics');
    sample('profile', profile);
    const checks: Record<string, boolean> = {
      weaponSkinsOwned: profile.weaponSkins?.length === 33,
      emotesOwned: profile.emotes?.length === 100,
      wheelPreset: JSON.stringify(profile.equippedEmotes) === JSON.stringify(
        Array.from({ length: 8 }, (_, i) => `lol.1v1.playeremotes.pack.${i + 1}`)),
    };
    const watch = (label: string, observer: 'presentation' | 'cosmetics' | 'match' | 'weapons' | 'emotes',
      matches: (value: any) => boolean, budget = 10000) =>
      poll(context, label, () => observe(observer), matches, budget);
    const view = await observe('presentation');
    const weapon = view.cards?.entries.find((entry: any) => entry.id === PUMP && entry.index < 9);
    if (!weapon) return verdict(checks, 'Pump card not visible.');
    const open = async () => {
      await page.mouse.click(...cardAt(weapon.index), { delay: 100 });
      const opened = await watch('pump-popup', 'presentation', v => v.preview?.popupActive && v.preview?.id === PUMP);
      await wait(400);
      return opened.matched;
    };
    const select = async (skin: readonly [number, number], selected: (id: string | null) => boolean) => {
      await page.mouse.click(...at.skinBrush, { delay: 100 });
      if (!(await watch('skin-list', 'presentation', v =>
        v.preview?.skinOptions?.some((s: any) => s.active))).matched) return false;
      await page.mouse.click(...skin, { delay: 100 });
      return (await watch('skin-selection', 'presentation', v => selected(v.preview?.skin))).matched;
    };
    const close = async () => {
      await page.mouse.click(...at.popupClose, { delay: 100 });
      return (await watch('popup-closed', 'presentation', v => v.preview?.popupActive === false)).matched;
    };
    if (!await open()) return verdict(checks, 'Pump popup did not open.');
    await preview(context, 'pump-default');
    checks.skinSelected = await select(at.firstSkin, skin => typeof skin === 'string' && skin.startsWith(SKIN_PREFIX));
    if (!checks.skinSelected) return verdict(checks);
    const chosen = (await observe('presentation')).preview.skin as string;
    const loaded = await preview(context, 'skin-preview');
    checks.skinPreviewAlive = previewAlive(loaded) &&
      loaded.preview?.graphics?.some((g: any) => g.id === chosen && g.mesh?.alive);
    await screenshot('skin-preview');
    if (!await close()) return verdict(checks, 'Popup did not close.');
    checks.skinEquipped = (await watch('skin-equipped', 'cosmetics', v =>
      v.equippedWeaponSkins?.includes(chosen))).matched;
    await wait(1000);
    checks.noRollback = (await observe('cosmetics')).equippedWeaponSkins?.includes(chosen) === true;

    if (!await open()) return verdict(checks, 'Cannot reopen the skin popup.');
    checks.selectionRetained = (await observe('presentation')).preview?.skin === chosen;
    if (!await select(at.defaultSkin, skin => skin === null)) return verdict(checks,
      'Default skin card was not selected.');
    await close();
    checks.skinUnequipped = (await watch('skin-unequipped', 'cosmetics', v =>
      !v.equippedWeaponSkins?.includes(chosen))).matched;
    if (!await open()) return verdict(checks, 'Cannot reopen for the match selection.');
    if (!await select(at.firstSkin, skin => skin === chosen)) return verdict(checks, 'Skin card was not reselected.');
    await close();
    checks.reequipped = (await watch('skin-reequipped', 'cosmetics', v =>
      v.equippedWeaponSkins?.includes(chosen))).matched;

    if (!await goToLobby(context)) return verdict(checks, 'Lobby did not open.');
    await press(context, at.play);
    checks.matchStarted = (await watch('match', 'match', v =>
      v.scene?.buildIndex !== 1 && v.player?.initialized === true && v.game?.hasStarted === true, 60000)).matched;
    if (!checks.matchStarted) return verdict(checks);
    await page.mouse.click(...at.center, { delay: 100 });
    await page.keyboard.press('2', { delay: 150 });
    checks.skinAppliedInMatch = (await watch('match-weapons', 'weapons', v =>
      v.equipped?.id === PUMP && v.equipped.skin?.requestedId === chosen && v.equipped.skin?.appliedId === chosen &&
      v.equipped.skin?.alive && v.equipped.skin?.active, 30000)).matched;
    sample('match-cosmetics', await observe('cosmetics'));
    await screenshot('match-skin');

    // Rewired Default keyboard map, action OpenWheel=32: B, timed press 0.1 s (level0_381 at 0x2148).
    await page.keyboard.down('b');
    let wheel: any;
    try {
      const shown = await watch('emote-wheel', 'emotes', v => v.wheel?.showing === true);
      wheel = shown.value.wheel;
      checks.wheelShown = shown.matched;
      checks.wheelEntries = JSON.stringify(wheel?.ids) === JSON.stringify(profile.equippedEmotes);
      await screenshot('emote-wheel');
    } finally { await page.keyboard.up('b'); }
    checks.emotePlayed = !!wheel?.selected && (await watch('emote-playing', 'emotes', v =>
      v.emote?.playing === true && v.emote?.id === wheel.selected)).matched;
    await screenshot('emote-playing');
    return verdict(checks);
  },
};
