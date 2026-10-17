import { B, getBlock } from '../core/blocks';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../core/constants';
import { TerrainGenerator, BIOMES, type BiomeId } from './terrain';

function countBlocks(gen: TerrainGenerator, chunks: [number, number][], ids: number[]): Map<number, number> {
  const counts = new Map<number, number>(ids.map((id) => [id, 0]));
  for (const [cx, cz] of chunks) {
    const c = gen.generate(cx, cz);
    for (let i = 0; i < c.blocks.length; i++) {
      const id = c.blocks[i];
      if (counts.has(id)) counts.set(id, counts.get(id)! + 1);
    }
  }
  return counts;
}

function grid(n: number, step = 1, offset = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) out.push([x * step + offset, z * step + offset]);
  return out;
}

describe('TerrainGenerator', () => {
  const gen = new TerrainGenerator(12345);

  test('same seed generates identical chunks', () => {
    const a = new TerrainGenerator(777).generate(3, -2);
    const b = new TerrainGenerator(777).generate(3, -2);
    expect(a.blocks).toEqual(b.blocks);
  });

  test('different seeds generate different terrain', () => {
    const a = new TerrainGenerator(1).generate(0, 0);
    const b = new TerrainGenerator(2).generate(0, 0);
    expect(a.blocks).not.toEqual(b.blocks);
  });

  test('chunk generation does not depend on generation order', () => {
    const g1 = new TerrainGenerator(5);
    g1.generate(1, 0);
    const first = g1.generate(0, 0);
    const second = new TerrainGenerator(5).generate(0, 0);
    expect(first.blocks).toEqual(second.blocks);
  });

  test('the bottom layer is always bedrock', () => {
    const c = gen.generate(0, 0);
    for (let x = 0; x < CHUNK_SIZE; x++) for (let z = 0; z < CHUNK_SIZE; z++) expect(c.get(x, 0, z)).toBe(B.BEDROCK);
  });

  test('every column has a surface within the world height', () => {
    for (const [cx, cz] of [[0, 0], [10, -7], [-30, 22]] as const) {
      const c = gen.generate(cx, cz);
      for (let x = 0; x < CHUNK_SIZE; x++)
        for (let z = 0; z < CHUNK_SIZE; z++) {
          let top = -1;
          for (let y = WORLD_HEIGHT - 1; y >= 0; y--)
            if (getBlock(c.get(x, y, z)).solid) {
              top = y;
              break;
            }
          expect(top).toBeGreaterThan(10);
          expect(top).toBeLessThan(WORLD_HEIGHT - 1);
        }
    }
  });

  test('low terrain is flooded up to sea level with water (or ice)', () => {
    let checked = 0;
    for (let x = -2000; x <= 2000 && checked < 50; x += 37) {
      for (let z = -2000; z <= 2000 && checked < 50; z += 41) {
        const h = gen.getHeight(x, z);
        if (h >= SEA_LEVEL - 3) continue;
        const c = gen.generate(Math.floor(x / 16), Math.floor(z / 16));
        const lx = ((x % 16) + 16) % 16;
        const lz = ((z % 16) + 16) % 16;
        expect([B.WATER, B.ICE]).toContain(c.get(lx, SEA_LEVEL, lz));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  test('the world contains a variety of biomes, including the cherry grove', () => {
    const seen = new Set<BiomeId>();
    for (let x = -6000; x <= 6000; x += 64) for (let z = -6000; z <= 6000; z += 64) seen.add(gen.getBiome(x, z));
    for (const b of ['plains', 'forest', 'desert', 'ocean', 'taiga', 'snowy_plains', 'cherry_grove'] as BiomeId[]) {
      expect(seen).toContain(b);
    }
    for (const b of seen) expect(BIOMES).toContain(b);
  });

  test('deserts are covered in sand', () => {
    let found = false;
    for (let x = -6000; x <= 6000 && !found; x += 50) {
      for (let z = -6000; z <= 6000 && !found; z += 50) {
        if (gen.getBiome(x, z) !== 'desert' || gen.getHeight(x, z) <= SEA_LEVEL + 2) continue;
        const c = gen.generate(Math.floor(x / 16), Math.floor(z / 16));
        const lx = ((x % 16) + 16) % 16;
        const lz = ((z % 16) + 16) % 16;
        expect(c.get(lx, gen.getHeight(x, z), lz)).toBe(B.SAND);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  test('generates ores underground, with diamonds only deep down', () => {
    const chunks = grid(6);
    const counts = countBlocks(gen, chunks, [B.COAL_ORE, B.IRON_ORE, B.COPPER_ORE, B.DIAMOND_ORE, B.DEEPSLATE_DIAMOND_ORE]);
    expect(counts.get(B.COAL_ORE)).toBeGreaterThan(50);
    expect(counts.get(B.IRON_ORE)).toBeGreaterThan(20);
    expect(counts.get(B.COPPER_ORE)).toBeGreaterThan(10);
    expect(counts.get(B.DIAMOND_ORE)! + counts.get(B.DEEPSLATE_DIAMOND_ORE)!).toBeGreaterThan(0);
    for (const [cx, cz] of chunks) {
      const c = gen.generate(cx, cz);
      for (let i = 0; i < c.blocks.length; i++) {
        if (c.blocks[i] === B.DIAMOND_ORE || c.blocks[i] === B.DEEPSLATE_DIAMOND_ORE) {
          expect(Math.floor(i / 256)).toBeLessThan(20);
        }
      }
    }
  });

  test('deepslate forms the lowest layer', () => {
    const c = gen.generate(4, 4);
    let deep = 0;
    let shallow = 0;
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) {
        if (c.get(x, 4, z) === B.DEEPSLATE) deep++;
        if (c.get(x, 40, z) === B.DEEPSLATE) shallow++;
      }
    expect(deep).toBeGreaterThan(100);
    expect(shallow).toBe(0);
  });

  test('carves caves below the surface', () => {
    let caveAir = 0;
    for (const [cx, cz] of grid(4)) {
      const c = gen.generate(cx, cz);
      for (let x = 0; x < 16; x++)
        for (let z = 0; z < 16; z++)
          for (let y = 5; y < 40; y++) if (c.get(x, y, z) === B.AIR) caveAir++;
    }
    expect(caveAir).toBeGreaterThan(100);
  });

  test('grows trees with logs and leaves', () => {
    const counts = countBlocks(gen, grid(8, 3), [
      B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.CHERRY_LOG, B.OAK_LEAVES, B.SPRUCE_LEAVES, B.BIRCH_LEAVES, B.CHERRY_LEAVES,
    ]);
    const logs = counts.get(B.OAK_LOG)! + counts.get(B.BIRCH_LOG)! + counts.get(B.SPRUCE_LOG)! + counts.get(B.CHERRY_LOG)!;
    const leaves =
      counts.get(B.OAK_LEAVES)! + counts.get(B.SPRUCE_LEAVES)! + counts.get(B.BIRCH_LEAVES)! + counts.get(B.CHERRY_LEAVES)!;
    expect(logs).toBeGreaterThan(20);
    expect(leaves).toBeGreaterThan(logs);
  });

  test('finds a dry spawn point on land', () => {
    const spawn = gen.findSpawn();
    expect(spawn.y).toBeGreaterThan(SEA_LEVEL);
    const c = gen.generate(Math.floor(spawn.x / 16), Math.floor(spawn.z / 16));
    const below = c.get(((spawn.x % 16) + 16) % 16, spawn.y - 1, ((spawn.z % 16) + 16) % 16);
    expect(getBlock(below).solid).toBe(true);
    expect(below).not.toBe(B.WATER);
  });
});
