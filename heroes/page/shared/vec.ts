/** Vectors as number arrays and quaternions as (x, y, z, w), as Unity stores them. */
export type V = number[];
export type Q = number[];

/** `a` + `s`·`b`. */
export const add = (a: V, b: V, s = 1) => a.map((v, k) => v + s * b[k]!);
export const sub = (a: V, b: V) => a.map((v, k) => v - b[k]!);
export const scale = (a: V, s: number) => a.map(v => v * s);
export const dot = (a: V, b: V) => a.reduce((sum, v, k) => sum + v * b[k]!, 0);
export const cross = (a: V, b: V) =>
  [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
export const length = (a: V) => Math.hypot(...a);
export const unit = (a: V) => scale(a, 1 / (length(a) || 1));
export const lerp = (a: V, b: V, t: number) => add(a, sub(b, a), t);

/** Hamilton product, as Unity composes rotations. */
export const mul = ([ax, ay, az, aw]: Q, [bx, by, bz, bw]: Q) => [
  aw! * bx! + ax! * bw! + ay! * bz! - az! * by!, aw! * by! - ax! * bz! + ay! * bw! + az! * bx!,
  aw! * bz! + ax! * by! - ay! * bx! + az! * bw!, aw! * bw! - ax! * bx! - ay! * by! - az! * bz!];
export const conj = ([x, y, z, w]: Q) => [-x!, -y!, -z!, w!];
/** `v` turned by the unit quaternion `q`. */
export const rotate = (q: Q, v: V) => {
  const u = q.slice(0, 3), t = scale(cross(u, v), 2);
  return add(add(v, t, q[3]!), cross(u, t));
};
export const axisAngle = (axis: V, degrees: number) => {
  const half = degrees * Math.PI / 360, s = Math.sin(half);
  return [axis[0]! * s, axis[1]! * s, axis[2]! * s, Math.cos(half)];
};
/** The shortest rotation taking unit `u` to unit `v`. */
export function fromTo(u: V, v: V): Q {
  const d = dot(u, v);
  if (d < -0.999999) return [...unit(Math.abs(u[0]!) < 0.9 ? cross(u, [1, 0, 0]) : cross(u, [0, 1, 0])), 0];
  const c = cross(u, v);
  return unit([c[0]!, c[1]!, c[2]!, 1 + d]);
}
/** Quaternion `a` turned toward `b` by `t` (normalized lerp along the shorter way). */
export const nlerp = (a: Q, b: Q, t: number) => {
  const sign = dot(a, b) < 0 ? -1 : 1;
  return unit(a.map((x, k) => x + (sign * b[k]! - x) * t));
};

/** Unity's Quaternion.LookRotation(forward, up) as (x, y, z, w): +Z on `f`, +Y toward `u`. */
export function lookRotation(f: V, u: V = [0, 1, 0]) {
  const r = unit(cross(u, f)), y = cross(f, r);
  const [m00, m10, m20, m01, m11, m21, m02, m12, m22] = [r[0]!, r[1]!, r[2]!, y[0]!, y[1]!, y[2]!, f[0]!, f[1]!, f[2]!];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}
/** Rotation matrix (row-major) of a Unity quaternion (x, y, z, w). */
export const rotationMatrix = ([x, y, z, w]: number[]) => [
  1 - 2 * (y! * y! + z! * z!), 2 * (x! * y! - z! * w!), 2 * (x! * z! + y! * w!),
  2 * (x! * y! + z! * w!), 1 - 2 * (x! * x! + z! * z!), 2 * (y! * z! - x! * w!),
  2 * (x! * z! - y! * w!), 2 * (y! * z! + x! * w!), 1 - 2 * (x! * x! + y! * y!)];
/** A world rotation taking local `a1` to `b1` exactly and local `a2` as close to `b2` as that allows. */
export function twoAxis(a1: V, b1: V, a2: V, b2: V): Q {
  const q1 = fromTo(unit(a1), unit(b1)), a2r = rotate(q1, a2), n = unit(b1);
  const p = unit(add(a2r, n, -dot(a2r, n))), t = unit(add(b2, n, -dot(b2, n)));
  return mul(fromTo(p, t), q1);
}
