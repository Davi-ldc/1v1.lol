import type { Native } from '../../../src/page/native';
import { observeElastic } from './elastic';
import { observeChampionCards, observeHeroes } from './heroes';
import { observeSwordAnim } from './sword-anim';
import { observeSword } from './sword';

/** The heroes' read-only observers, added to `window.local.observe` by the extension (src/page/main.ts). */
export const heroObservers = (unity: () => Native) => ({
  championCards: () => observeChampionCards(unity()),
  heroes: () => observeHeroes(unity()),
  elastic: () => observeElastic(unity()),
  swordAnim: () => observeSwordAnim(unity()),
  sword: () => observeSword(unity()),
});
