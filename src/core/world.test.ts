import { B } from './blocks';
import { Chunk } from './chunk';
import { CHUNK_SIZE, WORLD_HEIGHT } from './constants';
import { World, type ChunkGenerator } from './world';

/** Flat test world: stone up to y=3, grass at y=4. */
const flat: ChunkGenerator = {
  generate(cx, cz) {
    const c = new Chunk(cx, cz);
    for (let x = 0; x < CHUNK_SIZE; x++)
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let y = 0; y < 4; y++) c.set(x, y, z, B.STONE);
        c.set(x, 4, z, B.GRASS_BLOCK);
      }
    return c;
  },
};

describe('Chunk', () => {
  test('starts as air and stores blocks per local coordinate', () => {
    const c = new Chunk(0, 0);
    expect(c.get(3, 10, 7)).toBe(B.AIR);
    c.set(3, 10, 7, B.DIRT);
    expect(c.get(3, 10, 7)).toBe(B.DIRT);
    expect(c.get(7, 10, 3)).toBe(B.AIR);
  });

  test('out-of-range heights read as air and writes are ignored', () => {
    const c = new Chunk(0, 0);
    c.set(0, WORLD_HEIGHT, 0, B.STONE);
    c.set(0, -1, 0, B.STONE);
    expect(c.get(0, WORLD_HEIGHT, 0)).toBe(B.AIR);
    expect(c.get(0, -1, 0)).toBe(B.AIR);
  });

  test('stores sky and block light independently', () => {
    const c = new Chunk(0, 0);
    c.setSkyLight(1, 2, 3, 15);
    c.setBlockLight(1, 2, 3, 7);
    expect(c.getSkyLight(1, 2, 3)).toBe(15);
    expect(c.getBlockLight(1, 2, 3)).toBe(7);
    c.setSkyLight(1, 2, 3, 4);
    expect(c.getBlockLight(1, 2, 3)).toBe(7);
  });

  test('knows which sections are empty', () => {
    const c = new Chunk(0, 0);
    expect(c.isSectionEmpty(2)).toBe(true);
    c.set(0, 35, 0, B.STONE);
    expect(c.isSectionEmpty(2)).toBe(false);
    c.set(0, 35, 0, B.AIR);
    expect(c.isSectionEmpty(2)).toBe(true);
  });
});

describe('World', () => {
  test('unloaded chunks read as air', () => {
    const w = new World(flat);
    expect(w.getBlock(0, 1, 0)).toBe(B.AIR);
    expect(w.isLoaded(0, 0)).toBe(false);
  });

  test('loads chunks from the generator', () => {
    const w = new World(flat);
    w.ensureChunk(0, 0);
    expect(w.getBlock(5, 4, 5)).toBe(B.GRASS_BLOCK);
    expect(w.getBlock(5, 5, 5)).toBe(B.AIR);
  });

  test('negative world coordinates map to the right chunk', () => {
    const w = new World(flat);
    w.ensureChunk(-1, -1);
    w.setBlock(-1, 10, -1, B.GLASS);
    expect(w.getChunk(-1, -1)!.get(15, 10, 15)).toBe(B.GLASS);
    expect(w.getBlock(-1, 10, -1)).toBe(B.GLASS);
  });

  test('setBlock marks the section dirty, including the neighbour across a border', () => {
    const w = new World(flat);
    w.ensureChunk(0, 0);
    w.ensureChunk(-1, 0);
    w.consumeDirtySections();
    w.setBlock(0, 20, 5, B.STONE);
    const dirty = w.consumeDirtySections();
    expect(dirty).toContain('0,1,0');
    expect(dirty).toContain('-1,1,0');
    expect(w.consumeDirtySections()).toEqual([]);
  });

  test('player edits survive unloading and reloading a chunk', () => {
    const w = new World(flat);
    w.ensureChunk(2, 3);
    w.setBlock(40, 4, 50, B.AIR);
    w.unloadChunk(2, 3);
    expect(w.isLoaded(2, 3)).toBe(false);
    w.ensureChunk(2, 3);
    expect(w.getBlock(40, 4, 50)).toBe(B.AIR);
    expect(w.getBlock(41, 4, 50)).toBe(B.GRASS_BLOCK);
  });

  test('exports and imports edits', () => {
    const w = new World(flat);
    w.ensureChunk(0, 0);
    w.setBlock(1, 4, 1, B.DIAMOND_BLOCK);
    const edits = w.exportEdits();
    const w2 = new World(flat);
    w2.importEdits(edits);
    w2.ensureChunk(0, 0);
    expect(w2.getBlock(1, 4, 1)).toBe(B.DIAMOND_BLOCK);
  });

  test('notifies listeners about block changes', () => {
    const w = new World(flat);
    w.ensureChunk(0, 0);
    const changes: number[][] = [];
    w.onBlockChange((x, y, z, oldId, newId) => changes.push([x, y, z, oldId, newId]));
    w.setBlock(2, 4, 2, B.STONE);
    expect(changes).toEqual([[2, 4, 2, B.GRASS_BLOCK, B.STONE]]);
  });

  test('setting the same block is a no-op', () => {
    const w = new World(flat);
    w.ensureChunk(0, 0);
    w.consumeDirtySections();
    w.setBlock(2, 4, 2, B.GRASS_BLOCK);
    expect(w.consumeDirtySections()).toEqual([]);
  });

  test('finds the highest solid block in a column', () => {
    const w = new World(flat);
    w.ensureChunk(0, 0);
    expect(w.getTopSolidY(3, 3)).toBe(4);
    w.setBlock(3, 30, 3, B.STONE);
    expect(w.getTopSolidY(3, 3)).toBe(30);
  });
});
