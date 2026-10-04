/** Probe instrumentation: appends `entry` to a list that keeps its last 16. */
export const record = <T>(list: T[], entry: T) => {
  list.push(entry);
  if (list.length > 16) list.shift();
};

/** Slow motion for visual review: probes set `globalThis.heroSlow`; the poses' clock runs that many times slower. */
export const slowMotion = () => Math.max(1, Number((globalThis as { heroSlow?: number }).heroSlow) || 1);
