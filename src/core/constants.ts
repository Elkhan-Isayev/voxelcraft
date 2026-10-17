export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 128;
export const SECTION_SIZE = 16;
export const SECTION_COUNT = WORLD_HEIGHT / SECTION_SIZE;
export const SEA_LEVEL = 62;
export const MAX_LIGHT = 15;
export const TICKS_PER_SECOND = 20;
export const DAY_LENGTH_TICKS = 24000;

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function sectionKey(cx: number, sy: number, cz: number): string {
  return `${cx},${sy},${cz}`;
}

export function toChunkCoord(v: number): number {
  return Math.floor(v / CHUNK_SIZE);
}

export function toLocalCoord(v: number): number {
  return ((v % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
}
