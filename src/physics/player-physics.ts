import { IS_SOLID } from '../core/blocks';
import { isLava, isWater } from '../core/fluid';
import type { BlockQuery } from './raycast';

export const PLAYER = {
  width: 0.6,
  height: 1.8,
  eyeHeight: 1.62,
  sneakEyeHeight: 1.27,
  walkSpeed: 4.317,
  sprintSpeed: 5.612,
  sneakSpeed: 1.295,
  swimSpeed: 2.2,
  flySpeed: 10.92,
  flySprintSpeed: 21.78,
  flyVerticalSpeed: 7.5,
  gravity: 32,
  jumpVelocity: 9,
  terminalVelocity: 78,
};

export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  width: number;
  height: number;
  onGround: boolean;
  inWater: boolean;
  inLava: boolean;
  headInWater: boolean;
  horizontalCollision: boolean;
  flying: boolean;
  fallDistance: number;
}

export interface MoveInput {
  /** -1..1, positive = forward */
  forward: number;
  /** -1..1, positive = right */
  strafe: number;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
}

export interface StepEvents {
  landed: boolean;
  fallDistance: number;
}

export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export function createPlayerBody(x: number, y: number, z: number, width = PLAYER.width, height = PLAYER.height): Body {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    width,
    height,
    onGround: false,
    inWater: false,
    inLava: false,
    headInWater: false,
    horizontalCollision: false,
    flying: false,
    fallDistance: 0,
  };
}

export function bodyBox(b: Pick<Body, 'x' | 'y' | 'z' | 'width' | 'height'>): Box {
  const hw = b.width / 2;
  return { minX: b.x - hw, minY: b.y, minZ: b.z - hw, maxX: b.x + hw, maxY: b.y + b.height, maxZ: b.z + hw };
}

const EPS = 1e-7;
/** No body moves further than this in one step; keeps collision sweeps bounded. */
const MAX_STEP = 16;
/** Velocities are clamped to this magnitude (blocks per second). */
const MAX_SPEED = 100;

const clampSpeed = (v: number) => (Number.isFinite(v) ? Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v)) : 0);

/** Clips movement `d` along one axis so the box does not enter solid blocks. */
function sweepAxis(world: BlockQuery, box: Box, axis: 0 | 1 | 2, d: number): number {
  if (d === 0 || !Number.isFinite(d)) return 0;
  d = Math.max(-MAX_STEP, Math.min(MAX_STEP, d));
  const min = [box.minX, box.minY, box.minZ];
  const max = [box.maxX, box.maxY, box.maxZ];
  const lo = [Math.floor(min[0] + EPS), Math.floor(min[1] + EPS), Math.floor(min[2] + EPS)];
  const hi = [Math.floor(max[0] - EPS), Math.floor(max[1] - EPS), Math.floor(max[2] - EPS)];
  if (d > 0) hi[axis] = Math.floor(max[axis] + d - EPS);
  else lo[axis] = Math.floor(min[axis] + d + EPS);

  for (let x = lo[0]; x <= hi[0]; x++)
    for (let y = lo[1]; y <= hi[1]; y++)
      for (let z = lo[2]; z <= hi[2]; z++) {
        if (IS_SOLID[world.getBlock(x, y, z)] !== 1) continue;
        const bMin = [x, y, z][axis];
        if (d > 0 && max[axis] <= bMin + EPS) d = Math.min(d, bMin - max[axis]);
        else if (d < 0 && min[axis] >= bMin + 1 - EPS) d = Math.max(d, bMin + 1 - min[axis]);
      }
  return d;
}

function offsetBox(box: Box, dx: number, dy: number, dz: number): Box {
  return {
    minX: box.minX + dx,
    minY: box.minY + dy,
    minZ: box.minZ + dz,
    maxX: box.maxX + dx,
    maxY: box.maxY + dy,
    maxZ: box.maxZ + dz,
  };
}

export function boxIntersectsSolid(world: BlockQuery, box: Box): boolean {
  for (let x = Math.floor(box.minX + EPS); x <= Math.floor(box.maxX - EPS); x++)
    for (let y = Math.floor(box.minY + EPS); y <= Math.floor(box.maxY - EPS); y++)
      for (let z = Math.floor(box.minZ + EPS); z <= Math.floor(box.maxZ - EPS); z++)
        if (IS_SOLID[world.getBlock(x, y, z)] === 1) return true;
  return false;
}

function boxTouchesBlock(world: BlockQuery, box: Box, test: (id: number) => boolean): boolean {
  for (let x = Math.floor(box.minX + EPS); x <= Math.floor(box.maxX - EPS); x++)
    for (let y = Math.floor(box.minY + EPS); y <= Math.floor(box.maxY - EPS); y++)
      for (let z = Math.floor(box.minZ + EPS); z <= Math.floor(box.maxZ - EPS); z++)
        if (test(world.getBlock(x, y, z))) return true;
  return false;
}

function hasSupport(world: BlockQuery, box: Box): boolean {
  return boxIntersectsSolid(world, { ...box, minY: box.minY - 0.05, maxY: box.minY });
}

/**
 * Moves a body by (dx, dy, dz) with collision. Returns the movement actually applied.
 * Used for both players and mobs.
 */
export function moveWithCollision(world: BlockQuery, b: Body, dx: number, dy: number, dz: number, sneakEdge = false) {
  let box = bodyBox(b);
  const ay = sweepAxis(world, box, 1, dy);
  box = offsetBox(box, 0, ay, 0);
  let ax = sweepAxis(world, box, 0, dx);
  if (sneakEdge && ax !== 0 && !hasSupport(world, offsetBox(box, ax, 0, 0))) ax = 0;
  box = offsetBox(box, ax, 0, 0);
  let az = sweepAxis(world, box, 2, dz);
  if (sneakEdge && az !== 0 && !hasSupport(world, offsetBox(box, 0, 0, az))) az = 0;
  b.x += ax;
  b.y += ay;
  b.z += az;
  return { ax, ay, az };
}

/**
 * Advances a body one step. Yaw 0 looks toward -Z.
 * `walkSpeed` overrides the player's walking speed (used by mobs).
 */
export function stepPlayer(
  world: BlockQuery,
  p: Body,
  input: MoveInput,
  yaw: number,
  dt: number,
  walkSpeed?: number,
): StepEvents {
  if (!(dt > 0)) return { landed: false, fallDistance: 0 };
  p.vx = clampSpeed(p.vx);
  p.vy = clampSpeed(p.vy);
  p.vz = clampSpeed(p.vz);
  const waist = bodyBox(p);
  waist.maxY = p.y + Math.min(1, p.height * 0.55);
  p.inWater = boxTouchesBlock(world, waist, isWater);
  p.inLava = boxTouchesBlock(world, waist, isLava);
  p.headInWater = isWater(world.getBlock(Math.floor(p.x), Math.floor(p.y + PLAYER.eyeHeight), Math.floor(p.z)));
  const swimming = p.inWater || p.inLava;

  // ---- horizontal intent ----
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  let mx = input.forward * fx + input.strafe * rx;
  let mz = input.forward * fz + input.strafe * rz;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  let speed: number;
  if (p.flying) speed = input.sprint ? PLAYER.flySprintSpeed : PLAYER.flySpeed;
  else if (swimming) speed = Math.min(PLAYER.swimSpeed, walkSpeed ?? Infinity) * (p.inLava && !p.inWater ? 0.5 : 1);
  else if (walkSpeed !== undefined) speed = walkSpeed;
  else if (input.sneak) speed = PLAYER.sneakSpeed;
  else if (input.sprint && input.forward > 0) speed = PLAYER.sprintSpeed;
  else speed = PLAYER.walkSpeed;

  const hasInput = len > 0.01;
  let control: number;
  if (p.flying || p.onGround) control = 25;
  else if (swimming) control = 8;
  else control = hasInput ? 6 : 0.5;
  const k = 1 - Math.exp(-dt * control);
  p.vx += (mx * speed - p.vx) * k;
  p.vz += (mz * speed - p.vz) * k;

  // ---- vertical ----
  if (p.flying) {
    const target = input.jump ? PLAYER.flyVerticalSpeed : input.sneak ? -PLAYER.flyVerticalSpeed : 0;
    p.vy += (target - p.vy) * (1 - Math.exp(-dt * 15));
  } else if (swimming) {
    p.vy -= 8 * dt;
    if (input.jump) p.vy = Math.min(p.vy + 28 * dt, p.horizontalCollision ? 6 : 3);
    p.vy = Math.max(p.vy, -2);
  } else {
    if (input.jump && p.onGround) p.vy = PLAYER.jumpVelocity;
    p.vy = Math.max(p.vy - PLAYER.gravity * dt, -PLAYER.terminalVelocity);
  }

  // ---- move ----
  const wasOnGround = p.onGround;
  const dx = p.vx * dt;
  const dy = p.vy * dt;
  const dz = p.vz * dt;
  const sneakEdge = input.sneak && wasOnGround && !p.flying;
  const { ax, ay, az } = moveWithCollision(world, p, dx, dy, dz, sneakEdge);

  if (ay !== dy) {
    if (dy < 0) p.onGround = true;
    p.vy = 0;
  } else {
    p.onGround = false;
  }
  p.horizontalCollision = ax !== dx || az !== dz;
  if (ax !== dx) p.vx = 0;
  if (az !== dz) p.vz = 0;

  // ---- falling ----
  const events: StepEvents = { landed: false, fallDistance: 0 };
  if (swimming || p.flying) p.fallDistance = 0;
  else if (ay < 0) p.fallDistance -= ay;
  if (p.onGround && !wasOnGround) {
    events.landed = true;
    events.fallDistance = p.fallDistance;
    p.fallDistance = 0;
    if (p.flying) p.flying = false;
  }
  if (p.onGround && p.flying) p.flying = false;
  return events;
}
