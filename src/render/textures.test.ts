import { allBlocks } from '../core/blocks';
import { allItems } from '../core/items';
import { TILE_NAMES, tileIndex, tileUV, ATLAS_COLS, buildAtlasPixels, TILE_SIZE, DESTROY_STAGES } from './atlas';
import { paintTile, hasPainter } from './textures';

function alphaStats(px: Uint8ClampedArray) {
  let transparent = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 128) transparent++;
  return transparent / (px.length / 4);
}

function average(px: Uint8ClampedArray): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
  }
  return [r / n, g / n, b / n];
}

describe('texture atlas', () => {
  test('has a tile for every block face and every item', () => {
    const names = new Set(TILE_NAMES);
    for (const b of allBlocks()) {
      if (b.render === 'none') continue;
      for (const t of [b.textures.top, b.textures.bottom, b.textures.side, b.textures.front]) if (t) expect(names, t).toContain(t);
    }
    for (const i of allItems()) expect(names, i.texture).toContain(i.texture);
    for (let s = 0; s < DESTROY_STAGES; s++) expect(names).toContain(`destroy_${s}`);
  });

  test('tile names are unique and fit in the atlas', () => {
    expect(new Set(TILE_NAMES).size).toBe(TILE_NAMES.length);
    expect(TILE_NAMES.length).toBeLessThanOrEqual(ATLAS_COLS * ATLAS_COLS);
  });

  test('tile UVs are inside the atlas and distinct', () => {
    const a = tileUV(tileIndex('stone'));
    const b = tileUV(tileIndex('dirt'));
    for (const v of [...a, ...b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(a).not.toEqual(b);
    expect(a[2]).toBeGreaterThan(a[0]);
  });

  test('unknown tile names fall back to a placeholder instead of crashing', () => {
    expect(tileIndex('definitely_not_a_tile')).toBe(tileIndex('missing'));
  });

  test('builds a square power-of-two RGBA atlas', () => {
    const { size, pixels } = buildAtlasPixels();
    expect(size).toBe(ATLAS_COLS * TILE_SIZE);
    expect(Math.log2(size) % 1).toBe(0);
    expect(pixels.length).toBe(size * size * 4);
  });
});

describe('procedural textures', () => {
  test('are deterministic', () => {
    expect(paintTile('stone')).toEqual(paintTile('stone'));
    expect(paintTile('oak_leaves')).toEqual(paintTile('oak_leaves'));
  });

  test('every atlas tile has a real painter (no magenta placeholders)', () => {
    const missing = TILE_NAMES.filter((n) => !hasPainter(n));
    expect(missing).toEqual([]);
  });

  test('are 16x16 RGBA', () => {
    expect(paintTile('dirt').length).toBe(16 * 16 * 4);
  });

  test('solid blocks are fully opaque', () => {
    for (const name of ['stone', 'dirt', 'oak_planks', 'cobblestone', 'grass_block_top']) expect(alphaStats(paintTile(name))).toBe(0);
  });

  test('leaves have holes and glass is mostly see-through', () => {
    expect(alphaStats(paintTile('oak_leaves'))).toBeGreaterThan(0.1);
    expect(alphaStats(paintTile('glass'))).toBeGreaterThan(0.5);
    expect(alphaStats(paintTile('torch'))).toBeGreaterThan(0.7);
  });

  test('colors match the material', () => {
    const [r, g, b] = average(paintTile('grass_block_top'));
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    const [sr, sg, sb] = average(paintTile('sand'));
    expect(sr).toBeGreaterThan(sb);
    expect(sg).toBeGreaterThan(sb);
    const [cr, , cb] = average(paintTile('cherry_leaves'));
    expect(cr).toBeGreaterThan(cb * 0.9);
    const [wr, wg, wb] = average(paintTile('water'));
    expect(wb).toBeGreaterThan(wr);
    expect(wb).toBeGreaterThan(wg);
  });

  test('ores show specks of their mineral', () => {
    const stone = average(paintTile('stone'));
    const diamond = average(paintTile('diamond_ore'));
    expect(diamond[2] - diamond[0]).toBeGreaterThan(stone[2] - stone[0]);
  });

  test('crack stages get progressively more cracked', () => {
    const early = 1 - alphaStats(paintTile('destroy_0'));
    const late = 1 - alphaStats(paintTile('destroy_9'));
    expect(late).toBeGreaterThan(early);
  });
});
