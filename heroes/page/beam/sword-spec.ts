/**
 * Adaptation: the beam hero's pickaxe becomes a sword (`sword.mesh.json` in his directory), equipped with no pickup
 * time. Holding the right mouse button with it charges (its jewels glow); each tier, reached after `from` seconds,
 * multiplies the pickaxe's original damage and reach, and `knock` multiplies the base push (beam/sword.ts KNOCK:
 * the distances thrown grow as 1, 3, 9).
 */
export const SWORD_TIERS = [
  { from: 0, damage: 3, range: 1.5, knock: 1 },
  { from: 0.6, damage: 4, range: 2, knock: 3 },
  { from: 1.2, damage: 5, range: 3, knock: 9 },
] as const;

/** The tier a charge held for `seconds` reaches. */
export const swordTier = (seconds: number) => [...SWORD_TIERS].reverse().find(tier => seconds >= tier.from)!;
