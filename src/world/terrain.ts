import { B } from '../core/blocks';
import { Chunk } from '../core/chunk';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../core/constants';
import { createNoise2D, createNoise3D, fbm2D, type Noise2D, type Noise3D } from '../core/noise';
import { createRng, hashCoords, randomAt, type Rng } from '../core/rng';
import type { ChunkGenerator } from '../core/world';

export const BIOMES = [
  'ocean',
  'beach',
  'plains',
  'forest',
  'birch_forest',
  'desert',
  'taiga',
  'snowy_plains',
  'snowy_peaks',
  'windswept_hills',
  'cherry_grove',
  'swamp',
] as const;
export type BiomeId = (typeof BIOMES)[number];

const MAX_SURFACE = WORLD_HEIGHT - 14;
const DEEPSLATE_TOP = 8;

interface Column {
  height: number;
  biome: BiomeId;
  temp: number;
  humidity: number;
}

export class TerrainGenerator implements ChunkGenerator {
  private readonly nCont: Noise2D;
  private readonly nMount: Noise2D;
  private readonly nDetail: Noise2D;
  private readonly nTemp: Noise2D;
  private readonly nHum: Noise2D;
  private readonly nSurface: Noise2D;
  private readonly nCaveA: Noise3D;
  private readonly nCaveB: Noise3D;
  private readonly nCavern: Noise3D;
  private readonly nTuff: Noise3D;

  constructor(readonly seed: number) {
    this.nCont = createNoise2D(seed);
    this.nMount = createNoise2D(seed + 1);
    this.nDetail = createNoise2D(seed + 2);
    this.nTemp = createNoise2D(seed + 3);
    this.nHum = createNoise2D(seed + 4);
    this.nSurface = createNoise2D(seed + 5);
    this.nCaveA = createNoise3D(seed + 6);
    this.nCaveB = createNoise3D(seed + 7);
    this.nCavern = createNoise3D(seed + 8);
    this.nTuff = createNoise3D(seed + 9);
  }

  // ---- column-level queries ---------------------------------------------

  private column(x: number, z: number): Column {
    const cont = fbm2D(this.nCont, x / 900, z / 900, 4);
    const detail = fbm2D(this.nDetail, x / 60, z / 60, 4);
    let h: number;
    if (cont < -0.12) {
      const d = Math.min(1, (-0.12 - cont) / 0.3);
      h = SEA_LEVEL + 1 - d * 30 + detail * (1 + d * 2);
    } else {
      const land = Math.min(1, (cont + 0.12) / 0.5);
      h = SEA_LEVEL + 1 + land * 14 + detail * (1 + land * 5);
      const m = Math.max(0, fbm2D(this.nMount, x / 350, z / 350, 3) - 0.1);
      h += Math.pow(m, 1.5) * 130 * Math.min(1, land * 2);
    }
    const height = Math.max(8, Math.min(MAX_SURFACE, Math.round(h)));
    const temp = fbm2D(this.nTemp, x / 700, z / 700, 3);
    const humidity = fbm2D(this.nHum, x / 600, z / 600, 3);
    return { height, temp, humidity, biome: pickBiome(height, temp, humidity) };
  }

  getHeight(x: number, z: number): number {
    return this.column(x, z).height;
  }

  getBiome(x: number, z: number): BiomeId {
    return this.column(x, z).biome;
  }

  /** Finds a dry, open spot near the origin to spawn the player. */
  findSpawn(): { x: number; y: number; z: number } {
    for (let r = 0; r < 200; r++) {
      for (let i = -r; i <= r; i++) {
        for (const [x, z] of [[i * 16, -r * 16], [i * 16, r * 16], [-r * 16, i * 16], [r * 16, i * 16]]) {
          const col = this.column(x, z);
          if (col.height <= SEA_LEVEL || col.biome === 'ocean') continue;
          const chunk = this.generate(Math.floor(x / 16), Math.floor(z / 16));
          const lx = ((x % 16) + 16) % 16;
          const lz = ((z % 16) + 16) % 16;
          let top = -1;
          for (let y = WORLD_HEIGHT - 1; y > 0; y--) {
            const id = chunk.get(lx, y, lz);
            if (id !== B.AIR && id !== B.SHORT_GRASS && id !== B.DANDELION && id !== B.POPPY && id !== B.PINK_PETALS) {
              top = y;
              break;
            }
          }
          const ground = chunk.get(lx, top, lz);
          if (ground === B.WATER || ground === B.ICE || ground === B.CACTUS) continue;
          if (ground === B.OAK_LEAVES || ground === B.BIRCH_LEAVES || ground === B.SPRUCE_LEAVES || ground === B.CHERRY_LEAVES)
            continue;
          return { x, y: top + 1, z };
        }
      }
    }
    return { x: 0, y: this.getHeight(0, 0) + 1, z: 0 };
  }

  // ---- chunk generation --------------------------------------------------

  generate(cx: number, cz: number): Chunk {
    const c = new Chunk(cx, cz);
    const heights = new Int16Array(256);
    const biomes: BiomeId[] = new Array(256);
    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const x = ox + lx;
        const z = oz + lz;
        const col = this.column(x, z);
        const ci = lx + lz * CHUNK_SIZE;
        heights[ci] = col.height;
        biomes[ci] = col.biome;
        c.biomes[ci] = BIOMES.indexOf(col.biome);
        this.fillColumn(c, lx, lz, x, z, col);
      }
    }

    this.carveCaves(c, ox, oz, heights);
    const rng = createRng(hashCoords(this.seed, cx, cz, 7));
    this.placeOres(c, rng);
    this.placeVegetation(c, rng, heights, biomes, ox, oz);
    return c;
  }

  private fillColumn(c: Chunk, lx: number, lz: number, x: number, z: number, col: Column): void {
    const { height: h, biome } = col;
    const surface = this.nSurface(x / 12, z / 12);
    const fillerDepth = 3 + Math.floor((surface + 1) * 1.5);

    for (let y = 0; y <= h; y++) {
      let id: number;
      if (y === 0 || (y < 4 && randomAt(this.seed, x, y, z) < 0.6 - y * 0.18)) id = B.BEDROCK;
      else if (y < DEEPSLATE_TOP || (y < DEEPSLATE_TOP + 8 && randomAt(this.seed + 1, x, y, z) < (DEEPSLATE_TOP + 8 - y) / 8))
        id = B.DEEPSLATE;
      else id = B.STONE;

      const depth = h - y;
      if (id === B.STONE && depth < fillerDepth) id = surfaceBlock(biome, depth, h, surface);
      if (id === B.STONE && y < 24 && this.nTuff(x / 16, y / 10, z / 16) > 0.72) id = B.TUFF;
      c.set(lx, y, lz, id);
    }

    const frozen = biome === 'snowy_plains' || biome === 'snowy_peaks' || col.temp < -0.45;
    for (let y = h + 1; y <= SEA_LEVEL; y++) c.set(lx, y, lz, frozen && y === SEA_LEVEL ? B.ICE : B.WATER);
  }

  private carveCaves(c: Chunk, ox: number, oz: number, heights: Int16Array): void {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const x = ox + lx;
        const z = oz + lz;
        const h = heights[lx + lz * CHUNK_SIZE];
        const maxY = h - 5;
        for (let y = 5; y < maxY; y++) {
          const a = this.nCaveA(x / 42, y / 22, z / 42);
          const b = this.nCaveB(x / 42, y / 22, z / 42);
          let carve = a * a + b * b < 0.011;
          if (!carve && y < 42) carve = this.nCavern(x / 64, y / 28, z / 64) > 0.62 - (42 - y) * 0.003;
          if (carve && c.get(lx, y, lz) !== B.BEDROCK) c.set(lx, y, lz, B.AIR);
        }
      }
    }
  }

  private placeOres(c: Chunk, rng: Rng): void {
    vein(c, rng, B.COAL_ORE, B.COAL_ORE, 18, 6, 100, 9);
    vein(c, rng, B.IRON_ORE, B.DEEPSLATE_IRON_ORE, 12, 4, 64, 7);
    vein(c, rng, B.COPPER_ORE, B.COPPER_ORE, 8, 28, 80, 8);
    vein(c, rng, B.GOLD_ORE, B.GOLD_ORE, 3, 4, 32, 6);
    vein(c, rng, B.DIAMOND_ORE, B.DEEPSLATE_DIAMOND_ORE, 1.6, 2, 16, 5);
    vein(c, rng, B.GRAVEL, B.GRAVEL, 4, 10, 90, 14);
    vein(c, rng, B.GLOWSTONE, B.GLOWSTONE, 0.08, 4, 20, 3);
  }

  private placeVegetation(c: Chunk, rng: Rng, heights: Int16Array, biomes: BiomeId[], ox: number, oz: number): void {
    // Trees are kept 2 blocks from the chunk edge so they never cross chunk borders,
    // which keeps generation independent of chunk order.
    const center = biomes[8 + 8 * CHUNK_SIZE];
    const attempts = treeAttempts(center, rng);
    for (let i = 0; i < attempts; i++) {
      const lx = 2 + Math.floor(rng() * 12);
      const lz = 2 + Math.floor(rng() * 12);
      const h = heights[lx + lz * CHUNK_SIZE];
      if (h <= SEA_LEVEL) continue;
      const ground = c.get(lx, h, lz);
      if (ground !== B.GRASS_BLOCK && ground !== B.SNOWY_GRASS_BLOCK && ground !== B.DIRT) continue;
      if (c.get(lx, h + 1, lz) !== B.AIR) continue;
      growTree(c, rng, lx, h + 1, lz, biomes[lx + lz * CHUNK_SIZE]);
    }

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const ci = lx + lz * CHUNK_SIZE;
        const h = heights[ci];
        if (h >= WORLD_HEIGHT - 2 || c.get(lx, h + 1, lz) !== B.AIR) continue;
        const ground = c.get(lx, h, lz);
        const r = randomAt(this.seed + 11, ox + lx, h, oz + lz);
        const biome = biomes[ci];
        let plant: number = B.AIR;
        if (ground === B.GRASS_BLOCK) {
          if (biome === 'cherry_grove') plant = r < 0.12 ? B.PINK_PETALS : r < 0.3 ? B.SHORT_GRASS : B.AIR;
          else if (biome === 'plains') plant = r < 0.02 ? B.DANDELION : r < 0.035 ? B.POPPY : r < 0.045 ? B.CORNFLOWER : r < 0.3 ? B.SHORT_GRASS : B.AIR;
          else if (biome === 'forest' || biome === 'birch_forest') plant = r < 0.015 ? B.POPPY : r < 0.025 ? B.DANDELION : r < 0.15 ? B.SHORT_GRASS : B.AIR;
          else plant = r < 0.1 ? B.SHORT_GRASS : B.AIR;
        } else if (ground === B.SAND && biome === 'desert') {
          if (r < 0.006 && lx > 0 && lx < 15 && lz > 0 && lz < 15) {
            const tall = 1 + Math.floor(randomAt(this.seed + 12, ox + lx, 0, oz + lz) * 3);
            for (let y = 1; y <= tall; y++) c.set(lx, h + y, lz, B.CACTUS);
          } else if (r < 0.015) plant = B.DEAD_BUSH;
        }
        if (plant !== B.AIR) c.set(lx, h + 1, lz, plant);
      }
    }
  }
}

function pickBiome(h: number, temp: number, hum: number): BiomeId {
  if (h < SEA_LEVEL - 1) return 'ocean';
  if (h > 98) return 'snowy_peaks';
  if (h <= SEA_LEVEL + 1) {
    if (hum > 0.35 && temp > 0) return 'swamp';
    return temp > 0.3 ? 'desert' : 'beach';
  }
  if (temp > 0.28 && hum < 0.1) return 'desert';
  if (temp < -0.3) return 'snowy_plains';
  if (temp < -0.1) return 'taiga';
  if (h > 74 && temp > -0.05 && temp < 0.3 && hum > -0.2) return 'cherry_grove';
  if (h > 86) return 'windswept_hills';
  if (hum > 0.35 && h < SEA_LEVEL + 5 && temp > 0) return 'swamp';
  if (hum > 0.35) return 'birch_forest';
  if (hum > 0.12) return 'forest';
  return 'plains';
}

function surfaceBlock(biome: BiomeId, depth: number, h: number, noise: number): number {
  const top = depth === 0;
  switch (biome) {
    case 'desert':
      return depth < 3 ? B.SAND : B.SANDSTONE;
    case 'beach':
      return B.SAND;
    case 'ocean':
      return h < SEA_LEVEL - 12 && noise > 0 ? B.GRAVEL : noise < -0.6 ? B.CLAY : B.SAND;
    case 'snowy_peaks':
      return top ? B.SNOW_BLOCK : B.STONE;
    case 'snowy_plains':
      return top ? B.SNOWY_GRASS_BLOCK : B.DIRT;
    case 'windswept_hills':
      if (noise > 0.4) return top ? B.GRAVEL : B.STONE;
      return top ? B.GRASS_BLOCK : B.DIRT;
    case 'swamp':
      if (noise > 0.3) return B.MUD;
      return top ? B.GRASS_BLOCK : B.DIRT;
    case 'taiga':
      if (noise > 0.65) return top ? B.MOSS_BLOCK : B.DIRT;
      return top ? B.GRASS_BLOCK : B.DIRT;
    default:
      return top ? (h <= SEA_LEVEL ? B.DIRT : B.GRASS_BLOCK) : B.DIRT;
  }
}

function treeAttempts(biome: BiomeId, rng: Rng): number {
  switch (biome) {
    case 'forest':
    case 'birch_forest':
      return 6 + Math.floor(rng() * 4);
    case 'taiga':
      return 5 + Math.floor(rng() * 3);
    case 'cherry_grove':
      return 2 + Math.floor(rng() * 2);
    case 'swamp':
      return 1 + Math.floor(rng() * 2);
    case 'snowy_plains':
    case 'windswept_hills':
      return rng() < 0.4 ? 1 : 0;
    case 'plains':
      return rng() < 0.35 ? 1 : 0;
    default:
      return 0;
  }
}

function setIfAir(c: Chunk, x: number, y: number, z: number, id: number): void {
  if (!Chunk.inBounds(x, y, z)) return;
  const cur = c.get(x, y, z);
  if (cur === B.AIR || cur === B.SHORT_GRASS) c.set(x, y, z, id);
}

function growTree(c: Chunk, rng: Rng, x: number, y: number, z: number, biome: BiomeId): void {
  let kind: 'oak' | 'birch' | 'spruce' | 'cherry' = 'oak';
  if (biome === 'taiga' || biome === 'snowy_plains' || biome === 'windswept_hills') kind = 'spruce';
  else if (biome === 'birch_forest') kind = rng() < 0.8 ? 'birch' : 'oak';
  else if (biome === 'forest') kind = rng() < 0.25 ? 'birch' : 'oak';
  else if (biome === 'cherry_grove') kind = 'cherry';

  c.set(x, y - 1, z, B.DIRT);
  if (kind === 'spruce') {
    const t = 6 + Math.floor(rng() * 4);
    for (let i = 0; i < t; i++) c.set(x, y + i, z, B.SPRUCE_LOG);
    let radius = 1;
    for (let dy = t; dy >= 2; dy--) {
      for (let dx = -radius; dx <= radius; dx++)
        for (let dz = -radius; dz <= radius; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
          setIfAir(c, x + dx, y + dy, z + dz, B.SPRUCE_LEAVES);
        }
      radius = radius === 1 ? 2 : 1;
    }
    setIfAir(c, x, y + t, z, B.SPRUCE_LEAVES);
    setIfAir(c, x, y + t + 1, z, B.SPRUCE_LEAVES);
    return;
  }

  const log = kind === 'birch' ? B.BIRCH_LOG : kind === 'cherry' ? B.CHERRY_LOG : B.OAK_LOG;
  const leaves = kind === 'birch' ? B.BIRCH_LEAVES : kind === 'cherry' ? B.CHERRY_LEAVES : B.OAK_LEAVES;
  const t = kind === 'birch' ? 5 + Math.floor(rng() * 3) : 4 + Math.floor(rng() * 3);

  for (let dy = t - 3; dy <= t; dy++) {
    const radius = dy >= t - 1 ? 1 : 2;
    for (let dx = -radius; dx <= radius; dx++)
      for (let dz = -radius; dz <= radius; dz++) {
        const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
        if (corner && (dy === t || rng() < 0.5) && kind !== 'cherry') continue;
        setIfAir(c, x + dx, y + dy, z + dz, leaves);
      }
  }
  if (kind === 'cherry') {
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        setIfAir(c, x + dx, y + t + 1, z + dz, leaves);
      }
  }
  for (let i = 0; i < t; i++) c.set(x, y + i, z, log);
}

function vein(c: Chunk, rng: Rng, ore: number, deepOre: number, count: number, minY: number, maxY: number, size: number): void {
  let n = Math.floor(count);
  if (rng() < count - n) n++;
  for (let i = 0; i < n; i++) {
    let x = Math.floor(rng() * 16);
    let y = minY + Math.floor(rng() * (maxY - minY));
    let z = Math.floor(rng() * 16);
    for (let j = 0; j < size; j++) {
      if (Chunk.inBounds(x, y, z)) {
        const cur = c.get(x, y, z);
        if (cur === B.STONE || cur === B.TUFF) c.set(x, y, z, ore);
        else if (cur === B.DEEPSLATE) c.set(x, y, z, deepOre);
      }
      const dir = Math.floor(rng() * 6);
      if (dir === 0) x++;
      else if (dir === 1) x--;
      else if (dir === 2) y++;
      else if (dir === 3) y--;
      else if (dir === 4) z++;
      else z--;
    }
  }
}
