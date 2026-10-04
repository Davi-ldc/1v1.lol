import type { Native } from '../../../src/page/native';
import { roster, type Hero } from '../ids';
import { field, slot } from '../symbols';

/** The beam's directory's optional file with the SHA-256 of his password: `{ "sha256": "<hex>" }`. */
export const PASSWORD_FILE = 'lock.json';
/**
 * The localStorage key under which this browser keeps the password it gave for `champion` (its hash), named by the
 * champion ID's last part; scenarios set it before equipping the beam.
 */
export const passwordKey = (champion: string) => `local.${champion.split('.').pop()}.unlocked`;

/** SHA-256 of `text` (UTF-8) in hex, in plain JS: crypto.subtle is missing on http LAN addresses. */
function sha256(text: string) {
  const k = Array.from({ length: 64 }, (_, i) => {
    let n = 2, c = 0;
    for (;; n++) {
      let prime = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
      if (prime && c++ === i) break;
    }
    return Math.floor((Math.cbrt(n) % 1) * 2 ** 32) >>> 0;
  });
  const h = [2, 3, 5, 7, 11, 13, 17, 19].map(p => Math.floor((Math.sqrt(p) % 1) * 2 ** 32) >>> 0);
  const bytes = [...new TextEncoder().encode(text), 0x80];
  while (bytes.length % 64 !== 56) bytes.push(0);
  const bits = text.length ? new TextEncoder().encode(text).length * 8 : 0;
  for (let i = 7; i >= 0; i--) bytes.push(i < 4 ? (bits >>> (8 * i)) & 255 : 0);
  const rotr = (x: number, r: number) => (x >>> r) | (x << (32 - r));
  for (let o = 0; o < bytes.length; o += 64) {
    const w = Array.from({ length: 16 }, (_, i) => (bytes[o + 4 * i]! << 24 | bytes[o + 4 * i + 1]! << 16
      | bytes[o + 4 * i + 2]! << 8 | bytes[o + 4 * i + 3]!) >>> 0);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + k[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = (h[i]! + v) >>> 0; });
  }
  return h.map(v => v.toString(16).padStart(8, '0')).join('');
}

/**
 * Adaptation: the beam hero needs a password. ChampionOverviewScreen.SelectChampion (slot 120126, CHAMPIONS' SELECT)
 * for him runs only after the password, asked with names.json's `password` prompt as often as the user wants; once
 * right, this browser keeps it. `hash` comes from his directory (PASSWORD_FILE); without it he has no password.
 */
export async function installBeamPassword(n: Native, hash?: string) {
  if (!hash) return { required: false };
  const { champion, password } = roster.beam as Hero, key = passwordKey(champion);
  const given = () => {
    try { return localStorage.getItem(key) === hash; } catch { return false; }
  };
  const install = await n.prepareHook(slot.championOverviewSelect, 2, original => (screen, m) => {
    try {
      const product = n.u32(screen, field.ChampionOverviewScreen._selectedChampion);
      const id = product ? n.textOrNull(n.u32(product, field.ProductData.Id)) : null;
      if (id === champion && !given()) {
        const answer = prompt(password ?? 'Password:');
        if (answer === null || sha256(answer) !== hash) {
          if (answer !== null) alert('Wrong password.');
          return 0;
        }
        try { localStorage.setItem(key, hash); } catch { /* asked again next time */ }
      }
    } catch (error) { console.error('LOCAL_BEAM_PASSWORD', String(error)); }
    original(screen, m);
    return 0;
  }, 0);
  install();
  return { required: true, given: given() };
}
