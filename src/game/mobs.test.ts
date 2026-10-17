import { B } from '../core/blocks';
import { Chunk } from '../core/chunk';
import { CHUNK_SIZE } from '../core/constants';
import { I } from '../core/items';
import { createRng } from '../core/rng';
import { World, type ChunkGenerator } from '../core/world';
import { LightEngine } from '../world/light';
import {
  createMob,
  updateMob,
  damageMob,
  mobDrops,
  explode,
  explosionDamage,
  trySpawn,
  MOB_DEFS,
  type Mob,
  type MobContext,
  type MobEvent,
} from './mobs';

/** Flat grass world: surface at y=5. */
const flat: ChunkGenerator = {
  generate(cx, cz) {
    const c = new Chunk(cx, cz);
    for (let x = 0; x < CHUNK_SIZE; x++)
      for (let z = 0; z < CHUNK_SIZE; z++) {
        c.set(x, 0, z, B.BEDROCK);
        for (let y = 1; y < 4; y++) c.set(x, y, z, B.DIRT);
        c.set(x, 4, z, B.GRASS_BLOCK);
      }
    return c;
  },
};

function makeWorld(r = 4): World {
  const w = new World(flat);
  new LightEngine(w);
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) w.ensureChunk(x, z);
  return w;
}

function ctx(world: World, overrides: Partial<MobContext> = {}): MobContext {
  return {
    world,
    player: { x: 0.5, y: 5, z: 0.5, alive: true, creative: false },
    daylight: 0.18,
    rng: createRng(1),
    ...overrides,
  };
}

function run(mob: Mob, c: MobContext, seconds: number): MobEvent[] {
  const events: MobEvent[] = [];
  for (let t = 0; t < seconds; t += 0.05) events.push(...updateMob(mob, c, 0.05));
  return events;
}

const dist = (m: Mob, c: MobContext) => Math.hypot(m.body.x - c.player.x, m.body.z - c.player.z);

describe('mob definitions', () => {
  test('mobs have Minecraft-like health', () => {
    expect(createMob('pig', 0, 5, 0, 1).health).toBe(10);
    expect(createMob('sheep', 0, 5, 0, 1).health).toBe(8);
    expect(createMob('zombie', 0, 5, 0, 1).health).toBe(20);
    expect(MOB_DEFS.zombie.hostile).toBe(true);
    expect(MOB_DEFS.cow.hostile).toBe(false);
  });
});

describe('mob AI', () => {
  test('passive mobs wander around', () => {
    const w = makeWorld();
    const pig = createMob('pig', 8.5, 5, 8.5, 1);
    run(pig, ctx(w, { daylight: 1 }), 30);
    expect(Math.hypot(pig.body.x - 8.5, pig.body.z - 8.5)).toBeGreaterThan(1);
    expect(pig.body.y).toBeCloseTo(5, 3);
  });

  test('zombies chase the player', () => {
    const w = makeWorld();
    const c = ctx(w);
    const z = createMob('zombie', 10.5, 5, 0.5, 1);
    run(z, c, 4);
    expect(dist(z, c)).toBeLessThan(3);
  });

  test('zombies attack when close, with a cooldown', () => {
    const w = makeWorld();
    const c = ctx(w);
    const z = createMob('zombie', 1.5, 5, 0.5, 1);
    const events = run(z, c, 0.5).filter((e) => e.type === 'attack');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'attack', damage: 3, mob: 'zombie' });
    const later = run(z, c, 2).filter((e) => e.type === 'attack');
    expect(later.length).toBeGreaterThanOrEqual(1);
    expect(later.length).toBeLessThanOrEqual(2);
  });

  test('hostile mobs ignore creative players', () => {
    const w = makeWorld();
    const c = ctx(w, { player: { x: 0.5, y: 5, z: 0.5, alive: true, creative: true } });
    const z = createMob('zombie', 1.5, 5, 0.5, 1);
    expect(run(z, c, 3).filter((e) => e.type === 'attack')).toEqual([]);
  });

  test('creepers hiss and explode next to the player', () => {
    const w = makeWorld();
    const c = ctx(w);
    const cr = createMob('creeper', 2.5, 5, 0.5, 1);
    const early = run(cr, c, 1);
    expect(early.some((e) => e.type === 'explode')).toBe(false);
    expect(cr.fuse).toBeGreaterThan(0);
    const later = run(cr, c, 1);
    expect(later.find((e) => e.type === 'explode')).toMatchObject({ type: 'explode', power: 3 });
    expect(cr.dead).toBe(true);
  });

  test('a creeper calms down when the player runs away', () => {
    const w = makeWorld();
    const c = ctx(w);
    const cr = createMob('creeper', 2.5, 5, 0.5, 1);
    run(cr, c, 0.6);
    c.player.x = 40;
    run(cr, c, 2);
    expect(cr.fuse).toBe(0);
  });

  test('zombies burn in sunlight but not at night', () => {
    const w = makeWorld();
    const day = createMob('zombie', 30.5, 5, 30.5, 1);
    run(day, ctx(w, { daylight: 1, player: { x: 200, y: 5, z: 200, alive: true, creative: false } }), 5);
    expect(day.health).toBeLessThan(20);
    const night = createMob('zombie', 30.5, 5, 30.5, 2);
    run(night, ctx(w, { daylight: 0.18, player: { x: 200, y: 5, z: 200, alive: true, creative: false } }), 5);
    expect(night.health).toBe(20);
  });
});

describe('combat and drops', () => {
  test('damage kills a mob and knocks it back', () => {
    const pig = createMob('pig', 0.5, 5, 0.5, 1);
    expect(damageMob(pig, 4, 1, 0)).toBe(false);
    expect(pig.body.vx).toBeGreaterThan(0);
    expect(pig.hurtTime).toBeGreaterThan(0);
    expect(damageMob(pig, 10, 1, 0)).toBe(true);
    expect(pig.dead).toBe(true);
  });

  test('mobs drop their loot', () => {
    const rng = createRng(3);
    expect(mobDrops('pig', rng).map((d) => d.id)).toContain(I.PORKCHOP);
    expect(mobDrops('cow', () => 0.99).map((d) => d.id)).toEqual(expect.arrayContaining([I.BEEF, I.LEATHER]));
    expect(mobDrops('sheep', rng).map((d) => d.id)).toContain(B.WHITE_WOOL);
    expect(mobDrops('zombie', () => 0.99).map((d) => d.id)).toContain(I.ROTTEN_FLESH);
    expect(mobDrops('creeper', () => 0.99).map((d) => d.id)).toContain(I.GUNPOWDER);
  });
});

describe('explosions', () => {
  test('destroy nearby blocks but not bedrock', () => {
    const w = makeWorld();
    const removed = explode(w, 0.5, 4.5, 0.5, 3);
    expect(removed.length).toBeGreaterThan(20);
    expect(w.getBlock(0, 4, 0)).toBe(B.AIR);
    expect(w.getBlock(0, 0, 0)).toBe(B.BEDROCK);
    expect(w.getBlock(10, 4, 10)).toBe(B.GRASS_BLOCK);
  });

  test('hurt less with distance', () => {
    expect(explosionDamage(1, 3)).toBeGreaterThan(explosionDamage(4, 3));
    expect(explosionDamage(7, 3)).toBe(0);
  });
});

describe('spawning', () => {
  test('passive mobs spawn on grass during the day, hostile ones only at night', () => {
    const w = makeWorld(4);
    const rng = createRng(9);
    const player = { x: 0.5, y: 5, z: 0.5 };
    const daySpawns: Mob[] = [];
    for (let i = 0; i < 200; i++) {
      const m = trySpawn(w, daySpawns, player, 1, rng, i);
      if (m) daySpawns.push(m);
    }
    expect(daySpawns.length).toBeGreaterThan(0);
    expect(daySpawns.every((m) => !MOB_DEFS[m.type].hostile)).toBe(true);

    const nightSpawns: Mob[] = [];
    for (let i = 0; i < 400; i++) {
      const m = trySpawn(w, nightSpawns, player, 0.18, rng, i);
      if (m) nightSpawns.push(m);
    }
    expect(nightSpawns.some((m) => MOB_DEFS[m.type].hostile)).toBe(true);
  });

  test('respects population caps', () => {
    const w = makeWorld(4);
    const rng = createRng(4);
    const mobs: Mob[] = [];
    for (let i = 0; i < 2000; i++) {
      const m = trySpawn(w, mobs, { x: 0.5, y: 5, z: 0.5 }, 0.18, rng, i);
      if (m) mobs.push(m);
    }
    expect(mobs.filter((m) => MOB_DEFS[m.type].hostile).length).toBeLessThanOrEqual(8);
    expect(mobs.filter((m) => !MOB_DEFS[m.type].hostile).length).toBeLessThanOrEqual(10);
  });

  test('spawns away from the player, on the surface', () => {
    const w = makeWorld(4);
    const rng = createRng(2);
    for (let i = 0; i < 50; i++) {
      const m = trySpawn(w, [], { x: 0.5, y: 5, z: 0.5 }, 1, rng, i);
      if (!m) continue;
      expect(Math.hypot(m.body.x - 0.5, m.body.z - 0.5)).toBeGreaterThanOrEqual(20);
      expect(m.body.y).toBe(5);
    }
  });
});
