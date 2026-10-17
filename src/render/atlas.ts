import { allBlocks } from '../core/blocks';
import { allItems } from '../core/items';
import { paintTile } from './textures';

export const TILE_SIZE = 16;
export const ATLAS_COLS = 16;
export const DESTROY_STAGES = 10;

function collectNames(): string[] {
  const names = new Set<string>(['missing']);
  for (const b of allBlocks()) {
    if (b.render === 'none') continue;
    for (const t of [b.textures.top, b.textures.bottom, b.textures.side, b.textures.front]) if (t) names.add(t);
  }
  for (const i of allItems()) names.add(i.texture);
  for (let s = 0; s < DESTROY_STAGES; s++) names.add(`destroy_${s}`);
  return [...names];
}

export const TILE_NAMES: readonly string[] = collectNames();
const INDEX = new Map(TILE_NAMES.map((n, i) => [n, i]));

export function tileIndex(name: string): number {
  return INDEX.get(name) ?? 0;
}

const INSET = 1 / (ATLAS_COLS * TILE_SIZE * 64);

/** [u0, v0, u1, v1] with v measured from the bottom (WebGL convention, flipY textures). */
export function tileUV(index: number): [number, number, number, number] {
  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);
  const u0 = col / ATLAS_COLS + INSET;
  const u1 = (col + 1) / ATLAS_COLS - INSET;
  const v1 = 1 - row / ATLAS_COLS - INSET;
  const v0 = 1 - (row + 1) / ATLAS_COLS + INSET;
  return [u0, v0, u1, v1];
}

/** Paints every tile into one RGBA image (row 0 at the top). */
export function buildAtlasPixels(): { size: number; pixels: Uint8ClampedArray } {
  const size = ATLAS_COLS * TILE_SIZE;
  const pixels = new Uint8ClampedArray(size * size * 4);
  TILE_NAMES.forEach((name, i) => {
    const tile = paintTile(name);
    const ox = (i % ATLAS_COLS) * TILE_SIZE;
    const oy = Math.floor(i / ATLAS_COLS) * TILE_SIZE;
    for (let y = 0; y < TILE_SIZE; y++) {
      const src = y * TILE_SIZE * 4;
      pixels.set(tile.subarray(src, src + TILE_SIZE * 4), ((oy + y) * size + ox) * 4);
    }
  });
  return { size, pixels };
}
