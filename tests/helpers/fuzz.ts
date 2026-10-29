/** A small seeded generator, so a failing fuzz case reproduces from its seed and index alone. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

/** Between `min` and `max` pieces drawn from `pieces`, joined with `separator`. */
export function pieces(
  random: () => number,
  source: readonly string[],
  min: number,
  max: number,
  separator = "",
): string {
  const count = min + Math.floor(random() * (max - min + 1));
  return Array.from({ length: count }, () => pick(random, source)).join(separator);
}
