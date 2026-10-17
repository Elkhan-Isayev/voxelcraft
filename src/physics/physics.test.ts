import { B } from '../core/blocks';
import { Chunk } from '../core/chunk';
import { CHUNK_SIZE } from '../core/constants';
import { World, type ChunkGenerator } from '../core/world';
import { createPlayerBody, stepPlayer, type MoveInput, PLAYER } from './player-physics';
import { raycast } from './raycast';

/** Flat world: solid stone up to y=4, so the walkable surface is y=5. */
const flat: ChunkGenerator = {
  generate(cx, cz) {
    const c = new Chunk(cx, cz);
    for (let x = 0; x < CHUNK_SIZE; x++)
      for (let z = 0; z < CHUNK_SIZE; z++) for (let y = 0; y <= 4; y++) c.set(x, y, z, B.STONE);
    return c;
  },
};

function makeWorld(): World {
  const w = new World(flat);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) w.ensureChunk(x, z);
  return w;
}

const idle: MoveInput = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };

function simulate(w: World, p: ReturnType<typeof createPlayerBody>, input: Partial<MoveInput>, seconds: number, yaw = 0) {
  const events = [];
  for (let t = 0; t < seconds; t += 1 / 60) events.push(stepPlayer(w, p, { ...idle, ...input }, yaw, 1 / 60));
  return events;
}

describe('player physics', () => {
  test('falls under gravity and lands on the ground', () => {
    const w = makeWorld();
    const p = createPlayerBody(0.5, 12, 0.5);
    simulate(w, p, {}, 2);
    expect(p.y).toBeCloseTo(5, 5);
    expect(p.onGround).toBe(true);
    expect(p.vy).toBe(0);
  });

  test('reports the fall distance when landing (for fall damage)', () => {
    const w = makeWorld();
    const p = createPlayerBody(0.5, 15, 0.5);
    const events = simulate(w, p, {}, 3);
    const landing = events.find((e) => e.landed);
    expect(landing?.fallDistance).toBeCloseTo(10, 0);
  });

  test('walking forward (yaw 0) moves toward -Z at walking speed', () => {
    const w = makeWorld();
    const p = createPlayerBody(0.5, 5, 0.5);
    simulate(w, p, {}, 0.2);
    const z0 = p.z;
    simulate(w, p, { forward: 1 }, 1);
    const moved = z0 - p.z;
    expect(moved).toBeGreaterThan(PLAYER.walkSpeed * 0.8);
    expect(moved).toBeLessThan(PLAYER.walkSpeed * 1.05);
    expect(Math.abs(p.x - 0.5)).toBeLessThan(1e-6);
  });

  test('sprinting is faster than walking and sneaking is slower', () => {
    const run = (input: Partial<MoveInput>) => {
      const w = makeWorld();
      const p = createPlayerBody(0.5, 5, 0.5);
      simulate(w, p, { forward: 1, ...input }, 1);
      return 0.5 - p.z;
    };
    expect(run({ sprint: true })).toBeGreaterThan(run({}));
    expect(run({ sneak: true })).toBeLessThan(run({}) / 2);
  });

  test('jumping clears about 1.25 blocks', () => {
    const w = makeWorld();
    const p = createPlayerBody(0.5, 5, 0.5);
    simulate(w, p, {}, 0.1);
    let maxY = p.y;
    stepPlayer(w, p, { ...idle, jump: true }, 0, 1 / 60);
    for (let i = 0; i < 60; i++) {
      stepPlayer(w, p, idle, 0, 1 / 60);
      maxY = Math.max(maxY, p.y);
    }
    expect(maxY - 5).toBeGreaterThan(1.1);
    expect(maxY - 5).toBeLessThan(1.4);
  });

  test('cannot jump in mid-air', () => {
    const w = makeWorld();
    const p = createPlayerBody(0.5, 20, 0.5);
    stepPlayer(w, p, { ...idle, jump: true }, 0, 1 / 60);
    expect(p.vy).toBeLessThanOrEqual(0);
  });

  test('walls stop movement and the player slides along them', () => {
    const w = makeWorld();
    for (let z = -10; z < 10; z++) for (let y = 5; y < 8; y++) w.setBlock(3, y, z, B.STONE);
    const p = createPlayerBody(0.5, 5, 0.5);
    // yaw = -45°: forward points toward +X and -Z.
    simulate(w, p, { forward: 1 }, 2, -Math.PI / 4);
    expect(p.x).toBeCloseTo(3 - PLAYER.width / 2, 5);
    expect(p.z).toBeLessThan(-2);
  });

  test('fast movement does not tunnel through thin walls', () => {
    const w = makeWorld();
    for (let y = 5; y < 8; y++) w.setBlock(0, y, -3, B.STONE);
    const p = createPlayerBody(0.5, 5, 0.5);
    p.vz = -200;
    stepPlayer(w, p, idle, 0, 1 / 20);
    expect(p.z).toBeGreaterThanOrEqual(-2 + PLAYER.width / 2 - 1e-6);
  });

  test('hitting a ceiling stops upward motion', () => {
    const w = makeWorld();
    w.setBlock(0, 7, 0, B.STONE);
    const p = createPlayerBody(0.5, 5, 0.5);
    simulate(w, p, {}, 0.1);
    stepPlayer(w, p, { ...idle, jump: true }, 0, 1 / 60);
    for (let i = 0; i < 30; i++) stepPlayer(w, p, idle, 0, 1 / 60);
    expect(p.y + PLAYER.height).toBeLessThanOrEqual(7 + 1e-6);
  });

  test('flowers and water do not block movement', () => {
    const w = makeWorld();
    w.setBlock(0, 5, -1, B.POPPY);
    w.setBlock(0, 5, -2, B.WATER);
    const p = createPlayerBody(0.5, 5, 0.5);
    simulate(w, p, { forward: 1 }, 1);
    expect(p.z).toBeLessThan(-2);
  });

  test('sneaking stops you from walking off an edge', () => {
    const w = makeWorld();
    // Build a 1-wide pillar platform at y=10.
    w.setBlock(0, 9, 0, B.STONE);
    const p = createPlayerBody(0.5, 10, 0.5);
    simulate(w, p, { forward: 1, sneak: true }, 2);
    expect(p.y).toBeCloseTo(10, 5);
    expect(p.onGround).toBe(true);
  });

  test('in water the player sinks slowly and can swim up', () => {
    const w = makeWorld();
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = 5; y <= 9; y++) w.setBlock(x, y, z, B.WATER);
    const p = createPlayerBody(0.5, 9, 0.5);
    stepPlayer(w, p, idle, 0, 1 / 60);
    expect(p.inWater).toBe(true);
    simulate(w, p, {}, 0.5);
    expect(p.y).toBeGreaterThan(9 - 1.5);
    const before = p.y;
    simulate(w, p, { jump: true }, 0.5);
    expect(p.y).toBeGreaterThan(before);
  });

  test('flying ignores gravity and moves up and down', () => {
    const w = makeWorld();
    const p = createPlayerBody(0.5, 20, 0.5);
    p.flying = true;
    simulate(w, p, {}, 1);
    expect(p.y).toBeCloseTo(20, 1);
    simulate(w, p, { jump: true }, 0.5);
    expect(p.y).toBeGreaterThan(21);
    const y = p.y;
    simulate(w, p, { sneak: true }, 0.5);
    expect(p.y).toBeLessThan(y - 1);
  });

  test('absurd velocities are clamped instead of freezing the game', () => {
    const w = makeWorld();
    const p = createPlayerBody(0.5, 5, 0.5);
    p.vx = 1e12;
    p.vy = -1e12;
    const start = performance.now();
    stepPlayer(w, p, idle, 0, 1 / 60);
    expect(performance.now() - start).toBeLessThan(200);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(p.y).toBeGreaterThanOrEqual(5 - 1e-6);
  });

  test('a negative or NaN time step does nothing', () => {
    const w = makeWorld();
    const p = createPlayerBody(0.5, 5, 0.5);
    p.vx = 3;
    stepPlayer(w, p, { ...idle, forward: 1 }, 0, -1);
    stepPlayer(w, p, { ...idle, forward: 1 }, 0, NaN);
    expect(p.x).toBe(0.5);
    expect(p.vx).toBe(3);
  });

  test('landing while flying ends flight', () => {
    const w = makeWorld();
    const p = createPlayerBody(0.5, 6, 0.5);
    p.flying = true;
    simulate(w, p, { sneak: true }, 1);
    expect(p.flying).toBe(false);
  });
});

describe('raycast', () => {
  test('looking straight down hits the top face of the ground', () => {
    const w = makeWorld();
    const hit = raycast(w, { x: 0.5, y: 7, z: 0.5 }, { x: 0, y: -1, z: 0 }, 5);
    expect(hit).toMatchObject({ x: 0, y: 4, z: 0, nx: 0, ny: 1, nz: 0 });
    expect(hit!.distance).toBeCloseTo(2, 5);
  });

  test('returns null when nothing is within reach', () => {
    const w = makeWorld();
    expect(raycast(w, { x: 0.5, y: 20, z: 0.5 }, { x: 0, y: -1, z: 0 }, 5)).toBeNull();
  });

  test('hits the side face facing the viewer', () => {
    const w = makeWorld();
    w.setBlock(3, 5, 0, B.DIRT);
    const hit = raycast(w, { x: 0.5, y: 5.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 5);
    expect(hit).toMatchObject({ x: 3, y: 5, z: 0, nx: -1, ny: 0, nz: 0 });
  });

  test('passes through water to the block beneath', () => {
    const w = makeWorld();
    w.setBlock(0, 5, 0, B.WATER);
    const hit = raycast(w, { x: 0.5, y: 7.5, z: 0.5 }, { x: 0, y: -1, z: 0 }, 5);
    expect(hit?.y).toBe(4);
  });

  test('works with negative coordinates and diagonal rays', () => {
    const w = makeWorld();
    w.setBlock(-3, 6, -3, B.DIRT);
    const d = Math.SQRT1_2;
    const hit = raycast(w, { x: -0.5, y: 6.5, z: -0.5 }, { x: -d, y: 0, z: -d }, 6);
    expect(hit).toMatchObject({ x: -3, y: 6, z: -3 });
  });
});
