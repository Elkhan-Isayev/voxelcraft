/** Deterministic PRNG (mulberry32). Returns a function producing floats in [0, 1). */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Converts a user-entered seed into an integer. Numeric strings are used verbatim. */
export function hashSeed(text: string): number {
  const trimmed = text.trim();
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed) | 0;
  let h = 0;
  for (let i = 0; i < trimmed.length; i++) h = (Math.imul(31, h) + trimmed.charCodeAt(i)) | 0;
  return h;
}

/** Stable integer hash of coordinates and a seed, useful for per-position randomness. */
export function hashCoords(seed: number, x: number, y: number, z = 0): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Random float in [0,1) derived from coordinates. */
export function randomAt(seed: number, x: number, y: number, z = 0): number {
  return hashCoords(seed, x, y, z) / 4294967296;
}
