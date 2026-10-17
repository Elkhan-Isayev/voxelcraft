import { B, IS_SOLID } from './blocks';
import { Chunk, localIndex } from './chunk';
import {
  CHUNK_SIZE,
  SECTION_COUNT,
  SECTION_SIZE,
  WORLD_HEIGHT,
  chunkKey,
  sectionKey,
  toChunkCoord,
  toLocalCoord,
} from './constants';

export interface ChunkGenerator {
  generate(cx: number, cz: number): Chunk;
}

export type BlockChangeListener = (x: number, y: number, z: number, oldId: number, newId: number) => void;
export type ChunkListener = (chunk: Chunk) => void;

/** Serialized player edits: chunk key -> flat [index, id, index, id, ...]. */
export type WorldEdits = Record<string, number[]>;

export class World {
  private readonly chunks = new Map<string, Chunk>();
  private readonly edits = new Map<string, Map<number, number>>();
  private readonly dirty = new Set<string>();
  private readonly blockListeners: BlockChangeListener[] = [];
  private readonly loadListeners: ChunkListener[] = [];
  private readonly unloadListeners: ChunkListener[] = [];

  constructor(private readonly generator: ChunkGenerator) {}

  // ---- chunk management -------------------------------------------------

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  isLoaded(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  loadedChunks(): IterableIterator<Chunk> {
    return this.chunks.values();
  }

  ensureChunk(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (chunk) return chunk;
    chunk = this.generator.generate(cx, cz);
    const edits = this.edits.get(key);
    if (edits) for (const [i, id] of edits) applyIndex(chunk, i, id);
    this.chunks.set(key, chunk);
    for (const l of this.loadListeners) l(chunk);
    for (let sy = 0; sy < SECTION_COUNT; sy++) {
      this.dirty.add(sectionKey(cx, sy, cz));
      for (const [dx, dz] of NEIGHBORS_4) {
        if (this.isLoaded(cx + dx, cz + dz)) this.dirty.add(sectionKey(cx + dx, sy, cz + dz));
      }
    }
    return chunk;
  }

  unloadChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    this.chunks.delete(key);
    for (const l of this.unloadListeners) l(chunk);
  }

  onChunkLoad(listener: ChunkListener): void {
    this.loadListeners.push(listener);
  }

  onChunkUnload(listener: ChunkListener): void {
    this.unloadListeners.push(listener);
  }

  // ---- block access -----------------------------------------------------

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return B.AIR;
    const chunk = this.chunks.get(chunkKey(toChunkCoord(x), toChunkCoord(z)));
    if (!chunk) return B.AIR;
    return chunk.blocks[localIndex(toLocalCoord(x), y, toLocalCoord(z))];
  }

  setBlock(x: number, y: number, z: number, id: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cx = toChunkCoord(x);
    const cz = toChunkCoord(z);
    const chunk = this.ensureChunk(cx, cz);
    const lx = toLocalCoord(x);
    const lz = toLocalCoord(z);
    const oldId = chunk.get(lx, y, lz);
    if (oldId === id) return;
    chunk.set(lx, y, lz, id);

    const key = chunkKey(cx, cz);
    let chunkEdits = this.edits.get(key);
    if (!chunkEdits) this.edits.set(key, (chunkEdits = new Map()));
    chunkEdits.set(localIndex(lx, y, lz), id);

    this.markDirtyAt(x, y, z);
    for (const l of this.blockListeners) l(x, y, z, oldId, id);
  }

  onBlockChange(listener: BlockChangeListener): void {
    this.blockListeners.push(listener);
  }

  isSolid(x: number, y: number, z: number): boolean {
    return IS_SOLID[this.getBlock(x, y, z)] === 1;
  }

  getTopSolidY(x: number, z: number): number {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) if (this.isSolid(x, y, z)) return y;
    return -1;
  }

  // ---- light access (used by the light engine and mesher) ---------------

  getSkyLight(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return 15;
    if (y < 0) return 0;
    const chunk = this.chunks.get(chunkKey(toChunkCoord(x), toChunkCoord(z)));
    if (!chunk) return 15;
    return chunk.light[localIndex(toLocalCoord(x), y, toLocalCoord(z))] >> 4;
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const chunk = this.chunks.get(chunkKey(toChunkCoord(x), toChunkCoord(z)));
    if (!chunk) return 0;
    return chunk.light[localIndex(toLocalCoord(x), y, toLocalCoord(z))] & 0x0f;
  }

  // ---- dirty tracking for the renderer ----------------------------------

  /** Marks the section containing a position dirty, plus neighbours that share its faces. */
  markDirtyAt(x: number, y: number, z: number): void {
    const cx = toChunkCoord(x);
    const cz = toChunkCoord(z);
    const sy = Math.floor(y / SECTION_SIZE);
    const lx = toLocalCoord(x);
    const lz = toLocalCoord(z);
    const ly = y - sy * SECTION_SIZE;
    this.markSection(cx, sy, cz);
    if (lx === 0) this.markSection(cx - 1, sy, cz);
    if (lx === CHUNK_SIZE - 1) this.markSection(cx + 1, sy, cz);
    if (lz === 0) this.markSection(cx, sy, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markSection(cx, sy, cz + 1);
    if (ly === 0) this.markSection(cx, sy - 1, cz);
    if (ly === SECTION_SIZE - 1) this.markSection(cx, sy + 1, cz);
  }

  private markSection(cx: number, sy: number, cz: number): void {
    if (sy < 0 || sy >= SECTION_COUNT || !this.isLoaded(cx, cz)) return;
    this.dirty.add(sectionKey(cx, sy, cz));
  }

  consumeDirtySections(): string[] {
    const out = [...this.dirty];
    this.dirty.clear();
    return out;
  }

  // ---- persistence -------------------------------------------------------

  exportEdits(): WorldEdits {
    const out: WorldEdits = {};
    for (const [key, map] of this.edits) {
      const flat: number[] = [];
      for (const [i, id] of map) flat.push(i, id);
      out[key] = flat;
    }
    return out;
  }

  importEdits(edits: WorldEdits): void {
    for (const [key, flat] of Object.entries(edits)) {
      const map = new Map<number, number>();
      for (let i = 0; i < flat.length; i += 2) map.set(flat[i], flat[i + 1]);
      this.edits.set(key, map);
    }
  }
}

const NEIGHBORS_4: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function applyIndex(chunk: Chunk, index: number, id: number): void {
  const x = index % CHUNK_SIZE;
  const z = Math.floor(index / CHUNK_SIZE) % CHUNK_SIZE;
  const y = Math.floor(index / (CHUNK_SIZE * CHUNK_SIZE));
  chunk.set(x, y, z, id);
}
