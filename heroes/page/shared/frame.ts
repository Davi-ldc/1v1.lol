import type { Native } from '../../../src/page/native';
import { slot } from '../symbols';

export type HeroFrame = Awaited<ReturnType<typeof installHeroFrame>>;

/**
 * The heroes' per-frame work after every Animator, in one hook: Rewired's InputManager_Base.LateUpdate (f35174, a
 * Unity message, through the table; menu and match), when the humanoid Animator has already written the bones.
 * Handlers run in the order they were added, each with its own errors.
 */
export async function installHeroFrame(n: Native) {
  const handlers: [string, () => void][] = [];
  const install = await n.prepareHook(slot.rewiredLateUpdate, 2, original => (input, m) => {
    original(input, m);
    for (const [name, handler] of handlers) {
      try { handler(); } catch (error) { console.error(name, String(error)); }
    }
    return 0;
  }, 0);
  install();
  return { on(name: string, handler: () => void) { handlers.push([name, handler]); } };
}
