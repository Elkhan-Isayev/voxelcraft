import { B, getBlock } from '../core/blocks';
import type { Chunk } from '../core/chunk';
import { CHUNK_SIZE, WORLD_HEIGHT, toChunkCoord } from '../core/constants';
import {
  MAX_FLUID_LEVEL,
  fluidId,
  fluidState,
  isWater,
  sameFluid,
  type FluidKind,
  type FluidState,
} from '../core/fluid';
import type { World } from '../core/world';

export * from '../core/fluid';

/** Game ticks between updates of one fluid block (Minecraft: water 5, lava 30 in the overworld). */
export const FLUID_TICK_DELAY: Record<FluidKind, number> = { water: 5, lava: 30 };
/** Level increase per block of horizontal spread: water reaches 7 blocks, lava 3. */
const DROPOFF: Record<FluidKind, number> = { water: 1, lava: 2 };
/** How far flowing fluid looks for a drop to head towards. */
const SLOPE_DISTANCE: Record<FluidKind, number> = { water: 4, lava: 2 };
/** Updates processed per tick at most; the rest waits for the next tick. */
const MAX_UPDATES_PER_TICK = 4096;

const SIDES: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Stand-in for cells the simulation must not touch (unloaded chunks, below the world). */
const BARRIER = B.BEDROCK;

export interface FluidOptions {
  /** Called before a fluid replaces a non-fluid block it washes away (plants, torches). */
  onWashAway?: (x: number, y: number, z: number, id: number) => void;
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/**
 * Tick-based Minecraft-style fluid flow. Listens to world changes, schedules updates for fluid blocks
 * next to them, and spreads, drains and mixes water and lava when `tick()` is called (20× a second).
 */
export class FluidSimulator {
  private now = 0;
  /** Position key -> tick it is due. Only the earliest schedule per position counts. */
  private readonly due = new Map<string, number>();
  private readonly buckets = new Map<number, [number, number, number][]>();

  constructor(
    private readonly world: World,
    private readonly opts: FluidOptions = {},
  ) {
    world.onBlockChange((x, y, z) => this.scheduleAround(x, y, z));
    world.onChunkLoad((c) => this.scheduleChunk(c));
  }

  /** Number of updates waiting to run. */
  pending(): number {
    return this.due.size;
  }

  /** Schedules every non-source fluid of a chunk, so flows that were saved mid-way keep going. */
  scheduleChunk(chunk: Chunk): void {
    const blocks = chunk.blocks;
    for (let i = 0; i < blocks.length; i++) {
      const s = fluidState(blocks[i]);
      if (!s || (s.level === 0 && !s.falling)) continue;
      const x = chunk.cx * CHUNK_SIZE + (i % CHUNK_SIZE);
      const z = chunk.cz * CHUNK_SIZE + (Math.floor(i / CHUNK_SIZE) % CHUNK_SIZE);
      const y = Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE));
      this.schedule(x, y, z, FLUID_TICK_DELAY[s.kind]);
    }
  }

  /** Schedules an update of the block at a position if it is a fluid. */
  scheduleFluid(x: number, y: number, z: number): void {
    const id = this.get(x, y, z);
    const s = fluidState(id);
    if (!s) return;
    // Lava reacts to touching water right away instead of after its slow flow delay.
    const delay = s.kind === 'lava' && this.touchingWater(x, y, z) ? 1 : FLUID_TICK_DELAY[s.kind];
    this.schedule(x, y, z, delay);
  }

  schedule(x: number, y: number, z: number, delay: number): void {
    const k = key(x, y, z);
    const at = this.now + delay;
    const existing = this.due.get(k);
    if (existing !== undefined && existing <= at) return;
    this.due.set(k, at);
    let bucket = this.buckets.get(at);
    if (!bucket) this.buckets.set(at, (bucket = []));
    bucket.push([x, y, z]);
  }

  private scheduleAround(x: number, y: number, z: number): void {
    this.scheduleFluid(x, y, z);
    this.scheduleFluid(x, y + 1, z);
    this.scheduleFluid(x, y - 1, z);
    for (const [dx, dz] of SIDES) this.scheduleFluid(x + dx, y, z + dz);
  }

  /** Advances one game tick and runs the updates that are due. */
  tick(): void {
    this.now++;
    const bucket = this.buckets.get(this.now);
    if (!bucket) return;
    this.buckets.delete(this.now);
    let budget = MAX_UPDATES_PER_TICK;
    for (let i = 0; i < bucket.length; i++) {
      const [x, y, z] = bucket[i];
      const k = key(x, y, z);
      if (this.due.get(k) !== this.now) continue; // rescheduled earlier or already handled
      if (budget-- <= 0) {
        // Out of budget: push the rest to the next tick.
        this.due.delete(k);
        this.schedule(x, y, z, 1);
        continue;
      }
      this.due.delete(k);
      this.update(x, y, z);
    }
  }

  // ---- world access ---------------------------------------------------------------

  private loaded(x: number, z: number): boolean {
    return this.world.isLoaded(toChunkCoord(x), toChunkCoord(z));
  }

  private get(x: number, y: number, z: number): number {
    if (y < 0) return BARRIER;
    if (y >= WORLD_HEIGHT) return B.AIR;
    if (!this.loaded(x, z)) return BARRIER;
    return this.world.getBlock(x, y, z);
  }

  private set(x: number, y: number, z: number, id: number): void {
    if (y < 0 || y >= WORLD_HEIGHT || !this.loaded(x, z)) return;
    const old = this.world.getBlock(x, y, z);
    if (old !== B.AIR && !getBlock(old).fluid && this.washable(old)) this.opts.onWashAway?.(x, y, z, old);
    this.world.setBlock(x, y, z, id);
  }

  private washable(id: number): boolean {
    return id === B.AIR || (getBlock(id).render === 'cross' && !getBlock(id).fluid);
  }

  private touchingWater(x: number, y: number, z: number): boolean {
    if (isWater(this.get(x, y + 1, z))) return true;
    for (const [dx, dz] of SIDES) if (isWater(this.get(x + dx, y, z + dz))) return true;
    return false;
  }

  // ---- simulation -----------------------------------------------------------------

  private update(x: number, y: number, z: number): void {
    const id = this.get(x, y, z);
    const state = fluidState(id);
    if (!state) return;

    // Lava touched by water (from above or the sides) hardens.
    if (state.kind === 'lava' && this.touchingWater(x, y, z)) {
      this.world.setBlock(x, y, z, state.level === 0 && !state.falling ? B.OBSIDIAN : B.COBBLESTONE);
      return;
    }

    if (state.level !== 0 || state.falling) {
      const next = this.computeFlowing(x, y, z, state.kind);
      if (next !== id) {
        // The change schedules this block again; it spreads on its next update.
        this.world.setBlock(x, y, z, next);
        return;
      }
    }
    this.spread(x, y, z, state);
  }

  /** What a non-source fluid block should be, given its neighbours. */
  private computeFlowing(x: number, y: number, z: number, kind: FluidKind): number {
    let best = Infinity;
    let sources = 0;
    for (const [dx, dz] of SIDES) {
      const n = fluidState(this.get(x + dx, y, z + dz));
      if (!n || n.kind !== kind) continue;
      if (n.level === 0 && !n.falling) sources++;
      best = Math.min(best, n.level === 0 ? 0 : n.level);
    }
    if (kind === 'water' && sources >= 2) {
      const below = this.get(x, y - 1, z);
      if (getBlock(below).solid || (isWater(below) && fluidState(below)!.level === 0 && !fluidState(below)!.falling))
        return fluidId(kind, 0);
    }
    if (sameFluid(this.get(x, y + 1, z), fluidId(kind, 0))) return fluidId(kind, 0, true);
    const level = best + DROPOFF[kind];
    return level > MAX_FLUID_LEVEL ? B.AIR : fluidId(kind, level);
  }

  private spread(x: number, y: number, z: number, state: FluidState): void {
    const { kind } = state;
    const below = this.get(x, y - 1, z);

    if (kind === 'lava' && isWater(below)) {
      this.world.setBlock(x, y - 1, z, B.STONE);
      return;
    }
    if (this.canFlowInto(below, kind, 0, true)) {
      this.set(x, y - 1, z, fluidId(kind, 0, true));
      return;
    }
    const isSource = state.level === 0 && !state.falling;
    if (!isSource && this.isHole(below, kind)) return;

    const level = (state.falling ? 0 : state.level) + DROPOFF[kind];
    if (level > MAX_FLUID_LEVEL) return;
    for (const [dx, dz] of this.spreadDirections(x, y, z, kind, level)) this.set(x + dx, y, z + dz, fluidId(kind, level));
  }

  /** Whether fluid of `kind` at `level` may replace the block `id`. */
  private canFlowInto(id: number, kind: FluidKind, level: number, falling = false): boolean {
    if (this.washable(id)) return true;
    const s = fluidState(id);
    if (!s || s.kind !== kind || (s.level === 0 && !s.falling)) return false;
    if (falling) return !s.falling;
    return !s.falling && s.level > level;
  }

  /** A drop: fluid could fall into the block below, or is already there. */
  private isHole(belowId: number, kind: FluidKind): boolean {
    const s = fluidState(belowId);
    if (s) return s.kind === kind;
    return this.washable(belowId);
  }

  /** Cells fluid can travel through while looking for a drop. */
  private passable(id: number, kind: FluidKind): boolean {
    if (this.washable(id)) return true;
    const s = fluidState(id);
    return !!s && s.kind === kind && !(s.level === 0 && !s.falling);
  }

  /**
   * Horizontal directions to spread in: those with the shortest path to a nearby drop,
   * or every open direction when there is no drop within reach.
   */
  private spreadDirections(x: number, y: number, z: number, kind: FluidKind, level: number): [number, number][] {
    // Cost is judged over every direction fluid could pass, even ones already filled, so a source
    // keeps feeding its waterfall instead of spilling sideways once the way down is full.
    const open: { dir: [number, number]; cost: number; accepts: boolean }[] = [];
    for (const dir of SIDES) {
      const nx = x + dir[0];
      const nz = z + dir[1];
      const id = this.get(nx, y, nz);
      if (!this.passable(id, kind)) continue;
      open.push({ dir, cost: this.distanceToDrop(nx, y, nz, x, z, kind), accepts: this.canFlowInto(id, kind, level) });
    }
    const min = Math.min(...open.map((o) => o.cost));
    return open.filter((o) => o.cost === min && o.accepts).map((o) => o.dir);
  }

  /** Breadth-first search for the nearest drop from a cell, not passing back through the origin. */
  private distanceToDrop(sx: number, y: number, sz: number, ox: number, oz: number, kind: FluidKind): number {
    const limit = SLOPE_DISTANCE[kind];
    if (this.isHole(this.get(sx, y - 1, sz), kind)) return 0;
    const seen = new Set<string>([`${ox},${oz}`, `${sx},${sz}`]);
    let frontier: [number, number][] = [[sx, sz]];
    for (let d = 1; d <= limit; d++) {
      const next: [number, number][] = [];
      for (const [cx, cz] of frontier)
        for (const [dx, dz] of SIDES) {
          const nx = cx + dx;
          const nz = cz + dz;
          const k = `${nx},${nz}`;
          if (seen.has(k)) continue;
          seen.add(k);
          if (!this.passable(this.get(nx, y, nz), kind)) continue;
          if (this.isHole(this.get(nx, y - 1, nz), kind)) return d;
          next.push([nx, nz]);
        }
      frontier = next;
    }
    return Infinity;
  }
}

