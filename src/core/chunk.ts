import { B } from './blocks';
import { CHUNK_SIZE, SECTION_COUNT, SECTION_SIZE, WORLD_HEIGHT } from './constants';

export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

export function localIndex(x: number, y: number, z: number): number {
  return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
}

/** A 16 x WORLD_HEIGHT x 16 column of blocks plus packed light (sky in high nibble, block in low). */
export class Chunk {
  readonly blocks = new Uint8Array(CHUNK_VOLUME);
  readonly light = new Uint8Array(CHUNK_VOLUME);
  /** Biome index per column (x + z * 16), filled in by the terrain generator. */
  readonly biomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  private readonly sectionCounts = new Uint16Array(SECTION_COUNT);

  constructor(
    readonly cx: number,
    readonly cz: number,
  ) {}

  static inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && y >= 0 && y < WORLD_HEIGHT;
  }

  get(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return B.AIR;
    return this.blocks[localIndex(x, y, z)];
  }

  set(x: number, y: number, z: number, id: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const i = localIndex(x, y, z);
    const old = this.blocks[i];
    if (old === id) return;
    const s = (y / SECTION_SIZE) | 0;
    if (old === B.AIR) this.sectionCounts[s]++;
    else if (id === B.AIR) this.sectionCounts[s]--;
    this.blocks[i] = id;
  }

  isSectionEmpty(sy: number): boolean {
    return this.sectionCounts[sy] === 0;
  }

  getSkyLight(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return 15;
    if (y < 0) return 0;
    return this.light[localIndex(x, y, z)] >> 4;
  }

  setSkyLight(x: number, y: number, z: number, v: number): void {
    const i = localIndex(x, y, z);
    this.light[i] = (this.light[i] & 0x0f) | (v << 4);
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.light[localIndex(x, y, z)] & 0x0f;
  }

  setBlockLight(x: number, y: number, z: number, v: number): void {
    const i = localIndex(x, y, z);
    this.light[i] = (this.light[i] & 0xf0) | v;
  }
}
