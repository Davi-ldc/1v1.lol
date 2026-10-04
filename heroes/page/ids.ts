import type { Config } from '../../src/page/main';

/**
 * The hero slots, named by mechanic (heroes/README.md). `--heroes <dir>` holds one subdirectory per slot; the host
 * serves it at /local/heroes/<slot>/ (src/host/server.ts), and a slot without one is not offered.
 */
export const HEROES = ['beam', 'elastic'] as const;
export type HeroId = typeof HEROES[number];
/** A hero file's address on the host. */
export const heroFile = (hero: HeroId, name: string) => `/local/heroes/${hero}/${name}`;

/**
 * A present hero as the page config carries it: its directory's file names and its names.json entry, which the host
 * checked (src/host/server.ts): the display name, its champion and skin IDs, and the beam's password prompt.
 */
export type Hero = NonNullable<Config['heroes']>[string];
/** The present heroes by slot, from the page config; installHeroes fills it before any hero adapter installs. */
export const roster: Partial<Record<HeroId, Hero>> = {};
/** The slot whose champion is `champion`, if one is present. */
export const heroOf = (champion: string | null) => HEROES.find(hero => roster[hero]?.champion === champion);

/** The original champions the heroes copy: Poseidon (both), Quick (the elastic's Q), Sentinel (the beam's shields). */
export const POSEIDON = 'lol.1v1.champions.poseidon', POSEIDON_SKIN = 'lol.1v1.playerskins.pack.poseidon.default';
export const QUICK = 'lol.1v1.champions.quick', SENTINEL = 'lol.1v1.champions.sentinel';
