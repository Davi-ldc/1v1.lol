import type { Native } from '../../../src/page/native';
import { runtime, slot } from '../symbols';

/** `UnityEngine.<type>, UnityEngine.CoreModule`, as System.Type.GetType takes it. */
export const core = (type: string) => `UnityEngine.${type}, UnityEngine.CoreModule`;
export const floats = (values: number[]) => new Uint8Array(new Float32Array(values).buffer);
export const words = (values: number[]) => new Uint8Array(new Uint32Array(values).buffer);

/** A managed `element`[] of `count` elements holding `bytes` (packed, little-endian), by Array.CreateInstance. */
export function array(n: Native, element: string, count: number, bytes: Uint8Array) {
  const created = n.check(n.call(slot.arrayCreateInstance, n.call(slot.typeGetType, n.newString(element), 1, 0),
    count, 0));
  if (n.u32(created, runtime.arrayLength) !== count) throw new Error(`${element}[] has another length.`);
  n.write(created, runtime.arrayData, bytes);
  return created;
}

/** `size` floats that `call` writes to the scratch address it gets (an injected getter's out or sret pointer). */
export const readFloats = (n: Native, call: (at: number) => unknown, size = 3) => n.scratch(4 * size, at => {
  call(at);
  return Array.from({ length: size }, (_, k) => n.f32(at, 4 * k));
});

/** `values` as floats at a scratch address passed to `call` (a Vector3 or Quaternion argument by pointer). */
export const passFloats = <T>(n: Native, values: number[], call: (at: number) => T) =>
  n.scratch(4 * values.length, at => {
    values.forEach((value, k) => n.setF32(at, 4 * k, value));
    return call(at);
  });
