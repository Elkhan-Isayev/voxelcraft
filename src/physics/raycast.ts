import { getBlock } from '../core/blocks';
import { isFluidSource } from '../core/fluid';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RayHit {
  x: number;
  y: number;
  z: number;
  /** Normal of the face that was hit (points back toward the ray origin). */
  nx: number;
  ny: number;
  nz: number;
  distance: number;
  block: number;
}

export interface BlockQuery {
  getBlock(x: number, y: number, z: number): number;
}

export interface RaycastOptions {
  /** Also stop at water/lava source blocks (bucket targeting). */
  fluidSources?: boolean;
}

/** Voxel traversal (Amanatides & Woo). Only hits blocks that are selectable. */
export function raycast(world: BlockQuery, origin: Vec3, dir: Vec3, maxDistance: number, opts: RaycastOptions = {}): RayHit | null {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x);
  const stepY = Math.sign(dir.y);
  const stepZ = Math.sign(dir.z);
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;
  const frac = (v: number, s: number) => (s > 0 ? Math.floor(v) + 1 - v : v - Math.floor(v));
  let tMaxX = stepX !== 0 ? frac(origin.x, stepX) * tDeltaX : Infinity;
  let tMaxY = stepY !== 0 ? frac(origin.y, stepY) * tDeltaY : Infinity;
  let tMaxZ = stepZ !== 0 ? frac(origin.z, stepZ) * tDeltaZ : Infinity;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;

  while (t <= maxDistance) {
    const id = world.getBlock(x, y, z);
    if (getBlock(id).selectable || (opts.fluidSources && isFluidSource(id))) return { x, y, z, nx, ny, nz, distance: t, block: id };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }
  }
  return null;
}

/** Ray vs axis-aligned box (slab method). Returns the entry distance or null. */
export function rayIntersectsBox(
  origin: Vec3,
  dir: Vec3,
  min: Vec3,
  max: Vec3,
  maxDistance: number,
): number | null {
  let tMin = 0;
  let tMax = maxDistance;
  for (const axis of ['x', 'y', 'z'] as const) {
    const o = origin[axis];
    const d = dir[axis];
    if (Math.abs(d) < 1e-12) {
      if (o < min[axis] || o > max[axis]) return null;
      continue;
    }
    let t1 = (min[axis] - o) / d;
    let t2 = (max[axis] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}
