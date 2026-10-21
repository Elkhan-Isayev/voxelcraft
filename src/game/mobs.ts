import { B, getBlock } from '../core/blocks';
import { I } from '../core/items';
import type { Rng } from '../core/rng';
import type { World } from '../core/world';
import { createPlayerBody, stepPlayer, type Body } from '../physics/player-physics';
import type { ItemStack } from './inventory';

export type MobType = 'pig' | 'cow' | 'sheep' | 'zombie' | 'creeper';

export interface MobDef {
  maxHealth: number;
  width: number;
  height: number;
  speed: number;
  hostile: boolean;
  attackDamage: number;
  burnsInDaylight: boolean;
  drops: { id: number; min: number; max: number }[];
}

export const MOB_DEFS: Record<MobType, MobDef> = {
  pig: { maxHealth: 10, width: 0.9, height: 0.9, speed: 1.6, hostile: false, attackDamage: 0, burnsInDaylight: false, drops: [{ id: I.PORKCHOP, min: 1, max: 3 }] },
  cow: {
    maxHealth: 10, width: 0.9, height: 1.4, speed: 1.4, hostile: false, attackDamage: 0, burnsInDaylight: false,
    drops: [{ id: I.BEEF, min: 1, max: 3 }, { id: I.LEATHER, min: 0, max: 2 }],
  },
  sheep: {
    maxHealth: 8, width: 0.9, height: 1.3, speed: 1.5, hostile: false, attackDamage: 0, burnsInDaylight: false,
    drops: [{ id: B.WHITE_WOOL, min: 1, max: 1 }, { id: I.MUTTON, min: 1, max: 2 }],
  },
  zombie: { maxHealth: 20, width: 0.6, height: 1.95, speed: 2.3, hostile: true, attackDamage: 3, burnsInDaylight: true, drops: [{ id: I.ROTTEN_FLESH, min: 0, max: 2 }] },
  creeper: { maxHealth: 20, width: 0.6, height: 1.7, speed: 2.5, hostile: true, attackDamage: 0, burnsInDaylight: false, drops: [{ id: I.GUNPOWDER, min: 0, max: 2 }] },
};

export const MOB_TYPES = Object.keys(MOB_DEFS) as MobType[];

export interface Mob {
  id: number;
  type: MobType;
  body: Body;
  yaw: number;
  health: number;
  dead: boolean;
  /** Seconds left of the red "hurt" flash. */
  hurtTime: number;
  /** Seconds a creeper has been hissing. */
  fuse: number;
  attackCooldown: number;
  wanderTimer: number;
  wandering: boolean;
  panicTime: number;
  burnTimer: number;
  /** Accumulated walk distance, used to animate legs. */
  walkAnim: number;
}

export type MobEvent =
  | { type: 'attack'; mob: MobType; damage: number }
  | { type: 'explode'; mob: MobType; x: number; y: number; z: number; power: number };

export interface MobContext {
  world: World;
  player: { x: number; y: number; z: number; alive: boolean; creative: boolean };
  /** 0..1 sky brightness from the day cycle. */
  daylight: number;
  rng: Rng;
}

const CHASE_RANGE = 16;
const ATTACK_RANGE = 1.4;
const CREEPER_TRIGGER = 3;
const CREEPER_FUSE = 1.5;

export function createMob(type: MobType, x: number, y: number, z: number, id: number): Mob {
  const def = MOB_DEFS[type];
  return {
    id,
    type,
    body: createPlayerBody(x, y, z, def.width, def.height),
    yaw: 0,
    health: def.maxHealth,
    dead: false,
    hurtTime: 0,
    fuse: 0,
    attackCooldown: 0,
    wanderTimer: 0,
    wandering: false,
    panicTime: 0,
    burnTimer: 0,
    walkAnim: 0,
  };
}

/** Yaw (our convention: 0 looks toward -Z) that faces from (x,z) toward (tx,tz). */
export function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

export function updateMob(mob: Mob, ctx: MobContext, dt: number): MobEvent[] {
  if (mob.dead) return [];
  const events: MobEvent[] = [];
  const def = MOB_DEFS[mob.type];
  const { player } = ctx;
  mob.hurtTime = Math.max(0, mob.hurtTime - dt);
  mob.attackCooldown = Math.max(0, mob.attackCooldown - dt);

  const dx = player.x - mob.body.x;
  const dz = player.z - mob.body.z;
  const dy = player.y - mob.body.y;
  const distance = Math.hypot(dx, dz);
  const canTarget = def.hostile && player.alive && !player.creative && distance < CHASE_RANGE && Math.abs(dy) < 8;

  let moving = false;
  let speed = def.speed;

  if (canTarget) {
    mob.yaw = yawToward(mob.body.x, mob.body.z, player.x, player.z);
    if (mob.type === 'creeper') {
      if (distance < CREEPER_TRIGGER) {
        mob.fuse += dt;
        if (mob.fuse >= CREEPER_FUSE) {
          mob.dead = true;
          events.push({ type: 'explode', mob: mob.type, x: mob.body.x, y: mob.body.y + 0.5, z: mob.body.z, power: 3 });
          return events;
        }
      } else {
        mob.fuse = Math.max(0, mob.fuse - dt);
        moving = true;
      }
    } else {
      moving = distance > 0.9;
      if (distance < ATTACK_RANGE && Math.abs(dy) < 1.8 && mob.attackCooldown <= 0) {
        mob.attackCooldown = 1;
        events.push({ type: 'attack', mob: mob.type, damage: def.attackDamage });
      }
    }
  } else {
    mob.fuse = Math.max(0, mob.fuse - dt);
    if (mob.panicTime > 0) {
      mob.panicTime -= dt;
      moving = true;
      speed = def.speed * 1.8;
    } else {
      mob.wanderTimer -= dt;
      if (mob.wanderTimer <= 0) {
        mob.wandering = ctx.rng() < 0.6;
        mob.wanderTimer = 1.5 + ctx.rng() * 4;
        if (mob.wandering) mob.yaw = ctx.rng() * Math.PI * 2;
      }
      moving = mob.wandering;
    }
  }

  const body = mob.body;
  const jump = (moving && body.horizontalCollision && body.onGround) || body.inWater;
  const beforeX = body.x;
  const beforeZ = body.z;
  stepPlayer(ctx.world, body, { forward: moving ? 1 : 0, strafe: 0, jump, sneak: false, sprint: false }, mob.yaw, dt, speed);
  mob.walkAnim += Math.hypot(body.x - beforeX, body.z - beforeZ);

  // Undead burn under the open sky during the day.
  if (def.burnsInDaylight && ctx.daylight > 0.6) {
    const bx = Math.floor(body.x);
    const bz = Math.floor(body.z);
    const by = Math.floor(body.y + body.height - 0.1);
    if (ctx.world.getSkyLight(bx, by, bz) >= 15) {
      mob.burnTimer += dt;
      if (mob.burnTimer >= 1) {
        mob.burnTimer -= 1;
        damageMob(mob, 1, 0, 0);
      }
    }
  }

  if (body.y < -32) mob.dead = true;
  return events;
}

/** Applies damage with knockback direction (kx, kz). Returns true if the mob died. */
export function damageMob(mob: Mob, amount: number, kx: number, kz: number): boolean {
  if (mob.dead) return false;
  mob.health -= amount;
  mob.hurtTime = 0.4;
  const len = Math.hypot(kx, kz);
  if (len > 0) {
    mob.body.vx += (kx / len) * 7;
    mob.body.vz += (kz / len) * 7;
    mob.body.vy = Math.max(mob.body.vy, 5);
  }
  if (!MOB_DEFS[mob.type].hostile) mob.panicTime = 4;
  if (mob.health <= 0) {
    mob.health = 0;
    mob.dead = true;
    return true;
  }
  return false;
}

export function mobDrops(type: MobType, rng: Rng): ItemStack[] {
  const out: ItemStack[] = [];
  for (const d of MOB_DEFS[type].drops) {
    const count = d.min + Math.floor(rng() * (d.max - d.min + 1));
    if (count > 0) out.push({ id: d.id, count });
  }
  return out;
}

const EXPLOSION_PROOF = new Set<number>([B.BEDROCK, B.OBSIDIAN]);

/** Removes blocks within a sphere. Returns the positions and ids of removed blocks. */
export function explode(world: World, x: number, y: number, z: number, power: number): { x: number; y: number; z: number; id: number }[] {
  const removed: { x: number; y: number; z: number; id: number }[] = [];
  const r = Math.ceil(power);
  for (let bx = Math.floor(x) - r; bx <= Math.floor(x) + r; bx++)
    for (let by = Math.floor(y) - r; by <= Math.floor(y) + r; by++)
      for (let bz = Math.floor(z) - r; bz <= Math.floor(z) + r; bz++) {
        const d = Math.hypot(bx + 0.5 - x, by + 0.5 - y, bz + 0.5 - z);
        if (d > power) continue;
        const id = world.getBlock(bx, by, bz);
        if (id === B.AIR || EXPLOSION_PROOF.has(id) || getBlock(id).fluid) continue;
        world.setBlock(bx, by, bz, B.AIR);
        removed.push({ x: bx, y: by, z: bz, id });
      }
  return removed;
}

/** Damage dealt to an entity at a distance from an explosion. */
export function explosionDamage(distance: number, power: number): number {
  const reach = power * 2;
  if (distance >= reach) return 0;
  const impact = 1 - distance / reach;
  return Math.floor((impact * impact + impact) * 3.5 * power + 1);
}

const HOSTILE_CAP = 8;
const PASSIVE_CAP = 10;

/**
 * Attempts one spawn near the player. Passive animals spawn on grass in light;
 * hostile mobs spawn on any solid ground when it is dark.
 */
export function trySpawn(
  world: World,
  mobs: readonly Mob[],
  player: { x: number; y: number; z: number },
  daylight: number,
  rng: Rng,
  id: number,
): Mob | null {
  const angle = rng() * Math.PI * 2;
  const d = 24 + rng() * 20;
  const x = Math.floor(player.x + Math.cos(angle) * d);
  const z = Math.floor(player.z + Math.sin(angle) * d);
  if (!world.isLoaded(Math.floor(x / 16), Math.floor(z / 16))) return null;
  const top = world.getTopSolidY(x, z);
  if (top < 0) return null;
  const ground = world.getBlock(x, top, z);
  if (world.getBlock(x, top + 1, z) !== B.AIR || world.getBlock(x, top + 2, z) !== B.AIR) return null;

  const effectiveLight = Math.max(world.getSkyLight(x, top + 1, z) * daylight, world.getBlockLight(x, top + 1, z));
  const hostiles = mobs.filter((m) => MOB_DEFS[m.type].hostile).length;
  const passives = mobs.length - hostiles;

  let type: MobType | null = null;
  if (effectiveLight < 7) {
    if (hostiles < HOSTILE_CAP && rng() < 0.5) type = rng() < 0.6 ? 'zombie' : 'creeper';
  } else if (ground === B.GRASS_BLOCK && passives < PASSIVE_CAP && rng() < 0.15) {
    const r = rng();
    type = r < 0.35 ? 'pig' : r < 0.7 ? 'cow' : 'sheep';
  }
  if (!type) return null;
  return createMob(type, x + 0.5, top + 1, z + 0.5, id);
}
