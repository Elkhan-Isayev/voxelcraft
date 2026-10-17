import { LIGHT_EMISSION, LIGHT_OPACITY } from '../core/blocks';
import { Chunk, localIndex } from '../core/chunk';
import { CHUNK_SIZE, WORLD_HEIGHT, toChunkCoord, toLocalCoord } from '../core/constants';
import type { World } from '../core/world';

const DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;
const DOWN = 3;

type Channel = 'sky' | 'block';

/**
 * Flood-fill lighting (sky + block light) in the style of Minecraft.
 * Subscribes to the world: lights chunks as they load and updates light incrementally on block changes.
 */
export class LightEngine {
  private cacheKeyX = NaN;
  private cacheKeyZ = NaN;
  private cacheChunk: Chunk | undefined;
  /** While lighting a fresh chunk, its own cells don't need dirty marks (the whole chunk is dirty anyway). */
  private quietChunk: Chunk | null = null;

  constructor(private readonly world: World) {
    world.onChunkLoad((c) => this.lightNewChunk(c));
    world.onBlockChange((x, y, z, oldId, newId) => this.onBlockChanged(x, y, z, oldId, newId));
  }

  // ---- low-level cell access --------------------------------------------

  private chunkAt(x: number, z: number): Chunk | undefined {
    const cx = toChunkCoord(x);
    const cz = toChunkCoord(z);
    if (cx !== this.cacheKeyX || cz !== this.cacheKeyZ) {
      this.cacheKeyX = cx;
      this.cacheKeyZ = cz;
      this.cacheChunk = this.world.getChunk(cx, cz);
    }
    return this.cacheChunk;
  }

  private invalidateCache(): void {
    this.cacheKeyX = NaN;
    this.cacheKeyZ = NaN;
  }

  /** Returns -1 for cells that are outside loaded space. */
  private get(ch: Channel, x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return -1;
    const c = this.chunkAt(x, z);
    if (!c) return -1;
    const v = c.light[localIndex(toLocalCoord(x), y, toLocalCoord(z))];
    return ch === 'sky' ? v >> 4 : v & 15;
  }

  private set(ch: Channel, x: number, y: number, z: number, level: number): void {
    const c = this.chunkAt(x, z)!;
    const i = localIndex(toLocalCoord(x), y, toLocalCoord(z));
    c.light[i] = ch === 'sky' ? (c.light[i] & 0x0f) | (level << 4) : (c.light[i] & 0xf0) | level;
    if (c !== this.quietChunk) this.world.markDirtyAt(x, y, z);
  }

  private blockAt(x: number, y: number, z: number): number {
    const c = this.chunkAt(x, z);
    if (!c || y < 0 || y >= WORLD_HEIGHT) return 0;
    return c.blocks[localIndex(toLocalCoord(x), y, toLocalCoord(z))];
  }

  // ---- propagation -------------------------------------------------------

  private propagate(ch: Channel, queue: number[]): void {
    for (let qi = 0; qi < queue.length; qi += 3) {
      const x = queue[qi];
      const y = queue[qi + 1];
      const z = queue[qi + 2];
      const level = this.get(ch, x, y, z);
      if (level <= 1) continue;
      for (let d = 0; d < 6; d++) {
        const nx = x + DIRS[d][0];
        const ny = y + DIRS[d][1];
        const nz = z + DIRS[d][2];
        const cur = this.get(ch, nx, ny, nz);
        if (cur < 0) continue;
        const op = LIGHT_OPACITY[this.blockAt(nx, ny, nz)];
        if (op >= 15) continue;
        const next = ch === 'sky' && d === DOWN && level === 15 && op === 0 ? 15 : level - 1 - op;
        if (next > cur) {
          this.set(ch, nx, ny, nz, next);
          queue.push(nx, ny, nz);
        }
      }
    }
  }

  /** Darkens everything that was lit by the removed cells; returns cells that must re-propagate. */
  private remove(ch: Channel, removal: number[], relight: number[]): void {
    for (let qi = 0; qi < removal.length; qi += 4) {
      const x = removal[qi];
      const y = removal[qi + 1];
      const z = removal[qi + 2];
      const level = removal[qi + 3];
      for (let d = 0; d < 6; d++) {
        const nx = x + DIRS[d][0];
        const ny = y + DIRS[d][1];
        const nz = z + DIRS[d][2];
        const nl = this.get(ch, nx, ny, nz);
        if (nl <= 0) continue;
        if (nl < level || (ch === 'sky' && d === DOWN && level === 15 && nl === 15)) {
          this.set(ch, nx, ny, nz, 0);
          removal.push(nx, ny, nz, nl);
          if (ch === 'block') {
            const emission = LIGHT_EMISSION[this.blockAt(nx, ny, nz)];
            if (emission > 0) {
              this.set(ch, nx, ny, nz, emission);
              relight.push(nx, ny, nz);
            }
          }
        } else {
          relight.push(nx, ny, nz);
        }
      }
    }
  }

  // ---- events ------------------------------------------------------------

  private lightNewChunk(chunk: Chunk): void {
    this.invalidateCache();
    this.quietChunk = chunk;
    const ox = chunk.cx * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;

    // 1. Sunlight falls straight down until it meets something that filters light.
    const skyTop = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        let y = WORLD_HEIGHT - 1;
        for (; y >= 0; y--) {
          if (LIGHT_OPACITY[chunk.blocks[localIndex(x, y, z)]] !== 0) break;
          chunk.setSkyLight(x, y, z, 15);
        }
        skyTop[x + z * CHUNK_SIZE] = y; // highest light-filtering block, -1 if none
      }

    // 2. Seed the flood fill from sunlit cells that border darker columns.
    const sky: number[] = [];
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const own = skyTop[x + z * CHUNK_SIZE];
        let maxNeighbor = own;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE) maxNeighbor = Math.max(maxNeighbor, skyTop[nx + nz * CHUNK_SIZE]);
        }
        const top = Math.min(WORLD_HEIGHT - 1, maxNeighbor + 1);
        for (let y = own + 1; y <= top; y++) sky.push(ox + x, y, oz + z);
      }

    // 3. Light sources inside the chunk.
    const block: number[] = [];
    for (let i = 0; i < chunk.blocks.length; i++) {
      const e = LIGHT_EMISSION[chunk.blocks[i]];
      if (e === 0) continue;
      const x = i % CHUNK_SIZE;
      const z = Math.floor(i / CHUNK_SIZE) % CHUNK_SIZE;
      const y = Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE));
      chunk.setBlockLight(x, y, z, e);
      block.push(ox + x, y, oz + z);
    }

    // 4. Pull light in from already-loaded neighbours, and push ours out along the border.
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (!this.world.isLoaded(chunk.cx + dx, chunk.cz + dz)) continue;
      for (let i = 0; i < CHUNK_SIZE; i++) {
        let outX: number, outZ: number, inX: number, inZ: number;
        if (dx !== 0) {
          outX = dx < 0 ? ox - 1 : ox + CHUNK_SIZE;
          inX = dx < 0 ? ox : ox + CHUNK_SIZE - 1;
          outZ = inZ = oz + i;
        } else {
          outZ = dz < 0 ? oz - 1 : oz + CHUNK_SIZE;
          inZ = dz < 0 ? oz : oz + CHUNK_SIZE - 1;
          outX = inX = ox + i;
        }
        // Only seed where light actually differs across the border.
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const so = this.get('sky', outX, y, outZ);
          const si = this.get('sky', inX, y, inZ);
          if (so > si + 1) sky.push(outX, y, outZ);
          else if (si > so + 1) sky.push(inX, y, inZ);
          const bo = this.get('block', outX, y, outZ);
          const bi = this.get('block', inX, y, inZ);
          if (bo > bi + 1) block.push(outX, y, outZ);
          else if (bi > bo + 1) block.push(inX, y, inZ);
        }
      }
    }

    this.propagate('sky', sky);
    this.propagate('block', block);
    this.quietChunk = null;
  }

  private onBlockChanged(x: number, y: number, z: number, oldId: number, newId: number): void {
    this.invalidateCache();
    const oldOp = LIGHT_OPACITY[oldId];
    const newOp = LIGHT_OPACITY[newId];
    const oldEm = LIGHT_EMISSION[oldId];
    const newEm = LIGHT_EMISSION[newId];

    if (newOp !== oldOp) this.updateChannel('sky', x, y, z, newOp > oldOp, 0);
    if (newOp !== oldOp || newEm !== oldEm) this.updateChannel('block', x, y, z, newOp > oldOp || newEm < oldEm, newEm);
  }

  private updateChannel(ch: Channel, x: number, y: number, z: number, darker: boolean, emission: number): void {
    const relight: number[] = [];
    if (darker) {
      const level = this.get(ch, x, y, z);
      if (level > 0) {
        this.set(ch, x, y, z, 0);
        this.remove(ch, [x, y, z, level], relight);
      }
    }
    if (emission > this.get(ch, x, y, z)) this.set(ch, x, y, z, emission);
    relight.push(x, y, z);
    for (const [dx, dy, dz] of DIRS) relight.push(x + dx, y + dy, z + dz);
    this.propagate(ch, relight);
  }
}
