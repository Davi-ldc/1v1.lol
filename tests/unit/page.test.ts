import { expect, test } from 'bun:test';
import { bridge, native, type UnityModule } from '../../src/page/native';

test('native calls restore the stack on failure, null bases never read, hooks install only over the original',
  async () => {
  const table = new WebAssembly.Table({ element: 'anyfunc', initial: 3 });
  let stack = 1000;
  const original = await bridge(2, (a, b) => a + b);
  const failing = await bridge(1, () => { stack -= 16; throw new Error('native failure'); });
  table.set(1, original);
  table.set(2, failing);
  const module = { HEAPU8: new Uint8Array(65536), asm: { __indirect_function_table: table, malloc: () => 1024,
    free() {}, stackSave: () => stack, stackRestore: (value: number) => { stack = value; } } } satisfies UnityModule;
  const n = native(module);

  expect(() => n.call(2, 0)).toThrow('native failure');
  expect(stack).toBe(1000);
  expect(() => n.call(1, 1)).toThrow('Unexpected native ABI');
  expect(() => n.u32(0, 8)).toThrow('Invalid native range');

  const install = await n.prepareHook(1, 2, forward => (a, b) => a === 0 ? 42 : forward(a, b));
  expect(n.call(1, 0, 9)).toBe(9);
  install();
  expect([n.call(1, 0, 9), n.call(1, 2, 3)]).toEqual([42, 5]);

  const stale = await n.prepareHook(1, 2, forward => forward);
  table.set(1, failing);
  expect(stale).toThrow('changed during setup');
});
