import { B } from '../core/blocks';
import { Chunk } from '../core/chunk';
import { CHUNK_SIZE } from '../core/constants';
import { World, type ChunkGenerator } from '../core/world';
import { LightEngine } from './light';

/** Flat stone world with the ground surface at y=4. */
const flat: ChunkGenerator = {
  generate(cx, cz) {
    const c = new Chunk(cx, cz);
    for (let x = 0; x < CHUNK_SIZE; x++)
      for (let z = 0; z < CHUNK_SIZE; z++) for (let y = 0; y <= 4; y++) c.set(x, y, z, B.STONE);
    return c;
  },
};

function makeWorld(): World {
  const w = new World(flat);
  new LightEngine(w);
  return w;
}

function loadAround(w: World, r = 1): void {
  for (let cx = -r; cx <= r; cx++) for (let cz = -r; cz <= r; cz++) w.ensureChunk(cx, cz);
}

describe('LightEngine', () => {
  test('open sky is fully lit and solid ground is dark', () => {
    const w = makeWorld();
    loadAround(w);
    expect(w.getSkyLight(3, 5, 3)).toBe(15);
    expect(w.getSkyLight(3, 60, 3)).toBe(15);
    expect(w.getSkyLight(3, 4, 3)).toBe(0);
  });

  test('a block placed overhead casts a shadow that is lit from the sides', () => {
    const w = makeWorld();
    loadAround(w);
    w.setBlock(8, 10, 8, B.STONE);
    expect(w.getSkyLight(8, 9, 8)).toBe(14);
    expect(w.getSkyLight(8, 5, 8)).toBe(14);
    expect(w.getSkyLight(8, 11, 8)).toBe(15);
  });

  test('light under a wide roof falls off with distance to the edge', () => {
    const w = makeWorld();
    loadAround(w);
    for (let x = 4; x <= 12; x++) for (let z = 4; z <= 12; z++) w.setBlock(x, 6, z, B.STONE);
    // Center (8,5,8) is 5 blocks from open sky at x=3 → 15 - 5 = 10.
    expect(w.getSkyLight(8, 5, 8)).toBe(10);
    expect(w.getSkyLight(4, 5, 8)).toBe(14);
  });

  test('removing a roof restores full sunlight', () => {
    const w = makeWorld();
    loadAround(w);
    w.setBlock(8, 10, 8, B.STONE);
    w.setBlock(8, 10, 8, B.AIR);
    expect(w.getSkyLight(8, 9, 8)).toBe(15);
    expect(w.getSkyLight(8, 5, 8)).toBe(15);
  });

  test('a torch lights its surroundings, dimming by one per block', () => {
    const w = makeWorld();
    loadAround(w);
    w.setBlock(5, 5, 5, B.TORCH);
    expect(w.getBlockLight(5, 5, 5)).toBe(14);
    expect(w.getBlockLight(6, 5, 5)).toBe(13);
    expect(w.getBlockLight(5, 8, 5)).toBe(11);
    expect(w.getBlockLight(5, 5, 20)).toBe(0);
  });

  test('breaking a torch removes its light', () => {
    const w = makeWorld();
    loadAround(w);
    w.setBlock(5, 5, 5, B.TORCH);
    w.setBlock(5, 5, 5, B.AIR);
    expect(w.getBlockLight(5, 5, 5)).toBe(0);
    expect(w.getBlockLight(7, 5, 5)).toBe(0);
  });

  test('removing one of two torches keeps the other one shining', () => {
    const w = makeWorld();
    loadAround(w);
    w.setBlock(2, 5, 2, B.TORCH);
    w.setBlock(6, 5, 2, B.TORCH);
    w.setBlock(2, 5, 2, B.AIR);
    expect(w.getBlockLight(6, 5, 2)).toBe(14);
    expect(w.getBlockLight(4, 5, 2)).toBe(12);
    expect(w.getBlockLight(2, 5, 2)).toBe(10);
  });

  test('walls block block-light', () => {
    const w = makeWorld();
    loadAround(w);
    for (let y = 5; y < 30; y++) for (let z = -16; z < 32; z++) w.setBlock(8, y, z, B.STONE);
    w.setBlock(6, 5, 5, B.TORCH);
    expect(w.getBlockLight(7, 5, 5)).toBe(13);
    expect(w.getBlockLight(8, 5, 5)).toBe(0);
    expect(w.getBlockLight(9, 5, 5)).toBe(0);
  });

  test('light crosses chunk borders', () => {
    const w = makeWorld();
    loadAround(w);
    w.setBlock(15, 5, 5, B.TORCH);
    expect(w.getBlockLight(16, 5, 5)).toBe(13);
    expect(w.getBlockLight(-1, 5, 5)).toBe(0);
  });

  test('a chunk loaded next to a lit chunk receives its light', () => {
    const w = makeWorld();
    w.ensureChunk(0, 0);
    w.setBlock(15, 5, 5, B.TORCH);
    w.ensureChunk(1, 0);
    expect(w.getBlockLight(16, 5, 5)).toBe(13);
    expect(w.getBlockLight(17, 5, 5)).toBe(12);
  });

  test('glowstone emits full light even though it is opaque', () => {
    const w = makeWorld();
    loadAround(w);
    w.setBlock(5, 5, 5, B.GLOWSTONE);
    expect(w.getBlockLight(5, 6, 5)).toBe(14);
  });

  test('light changes mark neighbouring sections dirty for re-meshing', () => {
    const w = makeWorld();
    loadAround(w);
    w.consumeDirtySections();
    w.setBlock(15, 5, 5, B.TORCH);
    const dirty = w.consumeDirtySections();
    expect(dirty).toContain('0,0,0');
    expect(dirty).toContain('1,0,0');
  });

  test('water dims sunlight with depth', () => {
    const w = makeWorld();
    loadAround(w);
    for (let x = -10; x < 26; x++) for (let z = -10; z < 26; z++) for (let y = 5; y <= 12; y++) w.setBlock(x, y, z, B.WATER);
    const shallow = w.getSkyLight(8, 12, 8);
    const deep = w.getSkyLight(8, 6, 8);
    expect(shallow).toBeGreaterThan(deep);
    expect(deep).toBeLessThan(10);
  });
});
