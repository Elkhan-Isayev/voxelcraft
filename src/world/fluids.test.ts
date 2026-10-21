import { B, getBlock, LIGHT_EMISSION } from '../core/blocks';
import { Chunk } from '../core/chunk';
import { CHUNK_SIZE } from '../core/constants';
import { World, type ChunkGenerator } from '../core/world';
import {
  FLUID_TICK_DELAY,
  FluidSimulator,
  fluidHeight,
  fluidId,
  fluidState,
  isLava,
  isWater,
  sameFluid,
} from './fluids';

/** Stone floor up to y=3, air above: fluids sit on y=4. */
const floor: ChunkGenerator = {
  generate(cx, cz) {
    const c = new Chunk(cx, cz);
    for (let x = 0; x < CHUNK_SIZE; x++) for (let z = 0; z < CHUNK_SIZE; z++) for (let y = 0; y < 4; y++) c.set(x, y, z, B.STONE);
    return c;
  },
};

function setup(radius = 2) {
  const world = new World(floor);
  for (let cx = -radius; cx <= radius; cx++) for (let cz = -radius; cz <= radius; cz++) world.ensureChunk(cx, cz);
  const washed: { x: number; y: number; z: number; id: number }[] = [];
  const sim = new FluidSimulator(world, { onWashAway: (x, y, z, id) => washed.push({ x, y, z, id }) });
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) sim.tick();
  };
  return { world, sim, run, washed };
}

const level = (world: World, x: number, y: number, z: number) => fluidState(world.getBlock(x, y, z))?.level ?? null;

describe('fluid block encoding', () => {
  test('water and lava sources are the level-0 ids', () => {
    expect(fluidId('water', 0)).toBe(B.WATER);
    expect(fluidId('lava', 0)).toBe(B.LAVA);
    expect(fluidState(B.WATER)).toEqual({ kind: 'water', level: 0, falling: false });
    expect(fluidState(B.LAVA)).toEqual({ kind: 'lava', level: 0, falling: false });
  });

  test('every flowing level and the falling state round-trip through a distinct block id', () => {
    const ids = new Set<number>();
    for (const kind of ['water', 'lava'] as const) {
      for (let l = 0; l <= 7; l++) {
        const id = fluidId(kind, l);
        ids.add(id);
        expect(fluidState(id)).toEqual({ kind, level: l, falling: false });
      }
      const falling = fluidId(kind, 0, true);
      ids.add(falling);
      expect(fluidState(falling)).toEqual({ kind, level: 0, falling: true });
    }
    expect(ids.size).toBe(18);
    for (const id of ids) expect(id).toBeLessThan(256);
  });

  test('non-fluids have no fluid state', () => {
    expect(fluidState(B.AIR)).toBeNull();
    expect(fluidState(B.STONE)).toBeNull();
  });

  test('isWater / isLava / sameFluid cover all levels', () => {
    expect(isWater(fluidId('water', 5))).toBe(true);
    expect(isWater(fluidId('water', 0, true))).toBe(true);
    expect(isWater(B.LAVA)).toBe(false);
    expect(isLava(fluidId('lava', 3))).toBe(true);
    expect(sameFluid(B.WATER, fluidId('water', 4))).toBe(true);
    expect(sameFluid(B.WATER, B.LAVA)).toBe(false);
    expect(sameFluid(B.STONE, B.STONE)).toBe(false);
  });

  test('flowing blocks are fluids that cannot be picked up or mined', () => {
    for (const id of [fluidId('water', 3), fluidId('lava', 2), fluidId('lava', 0, true)]) {
      const def = getBlock(id);
      expect(def.fluid).toBe(true);
      expect(def.noItem).toBe(true);
      expect(def.selectable).toBe(false);
      expect(def.solid).toBe(false);
      expect(def.replaceable).toBe(true);
    }
  });

  test('lava glows at full brightness at every level', () => {
    expect(LIGHT_EMISSION[B.LAVA]).toBe(15);
    expect(LIGHT_EMISSION[fluidId('lava', 6)]).toBe(15);
  });

  test('surface height drops with the flow level; falling fluid fills the block', () => {
    expect(fluidHeight(B.WATER)).toBeCloseTo(0.875);
    expect(fluidHeight(fluidId('water', 1))).toBeLessThan(fluidHeight(B.WATER));
    expect(fluidHeight(fluidId('water', 7))).toBeLessThan(fluidHeight(fluidId('water', 1)));
    expect(fluidHeight(fluidId('water', 7))).toBeGreaterThan(0);
    expect(fluidHeight(fluidId('water', 0, true))).toBe(1);
    expect(fluidHeight(B.STONE)).toBe(0);
  });
});

describe('water flow', () => {
  test('a placed source spreads 7 blocks horizontally on flat ground and then stops', () => {
    const { world, run, sim } = setup();
    world.setBlock(0, 4, 0, B.WATER);
    run(FLUID_TICK_DELAY.water * 12);
    for (let d = 1; d <= 7; d++) expect(level(world, d, 4, 0), `+x ${d}`).toBe(d);
    expect(level(world, -7, 4, 0)).toBe(7);
    expect(level(world, 0, 4, 5)).toBe(5);
    expect(level(world, 3, 4, 4)).toBe(7); // manhattan distance
    expect(world.getBlock(8, 4, 0)).toBe(B.AIR);
    expect(world.getBlock(4, 4, 4)).toBe(B.AIR);
    expect(sim.pending()).toBe(0);
  });

  test('flow is tick-based: nothing happens before the water tick delay', () => {
    const { world, run } = setup();
    world.setBlock(0, 4, 0, B.WATER);
    run(FLUID_TICK_DELAY.water - 1);
    expect(world.getBlock(1, 4, 0)).toBe(B.AIR);
    run(1);
    expect(level(world, 1, 4, 0)).toBe(1);
    expect(world.getBlock(2, 4, 0)).toBe(B.AIR);
  });

  test('water falls down as a full-height column and spreads again when it lands', () => {
    const { world, run } = setup();
    world.setBlock(1, 7, 0, B.STONE); // floating ledge for the source
    world.setBlock(1, 8, 0, B.WATER);
    run(FLUID_TICK_DELAY.water * 30);
    // spreads off the ledge…
    expect(level(world, 2, 8, 0)).toBe(1);
    // …and falls next to it
    const falling = fluidState(world.getBlock(2, 7, 0));
    expect(falling?.falling).toBe(true);
    expect(fluidState(world.getBlock(2, 4, 0))?.falling).toBe(true);
    // landing water spreads like a source
    expect(level(world, 3, 4, 0)).toBe(1);
    expect(level(world, 9, 4, 0)).toBe(7);
  });

  test('a source in mid-air pours straight down first', () => {
    const { world, run } = setup();
    world.setBlock(0, 8, 0, B.WATER);
    run(FLUID_TICK_DELAY.water);
    expect(fluidState(world.getBlock(0, 7, 0))?.falling).toBe(true);
    expect(world.getBlock(1, 8, 0)).toBe(B.AIR);
  });

  test('flowing water over a drop only falls; it does not keep spreading sideways', () => {
    const { world, run } = setup();
    world.setBlock(0, 4, 0, B.WATER);
    world.setBlock(1, 3, 0, B.AIR);
    world.setBlock(1, 2, 0, B.AIR);
    run(FLUID_TICK_DELAY.water * 10);
    expect(level(world, 1, 4, 0)).toBe(1);
    expect(fluidState(world.getBlock(1, 3, 0))?.falling).toBe(true);
    expect(world.getBlock(2, 4, 0)).toBe(B.AIR);
  });

  test('flowing water heads for the nearest drop instead of spreading everywhere', () => {
    const { world, run } = setup();
    world.setBlock(0, 4, 0, B.WATER);
    world.setBlock(2, 3, 0, B.AIR); // a hole two blocks east
    run(FLUID_TICK_DELAY.water);
    expect(level(world, 1, 4, 0)).toBe(1);
    expect(world.getBlock(-1, 4, 0)).toBe(B.AIR);
    expect(world.getBlock(0, 4, 1)).toBe(B.AIR);
  });

  test('breaking a block next to a resting source lets the water flow in', () => {
    const { world, run } = setup();
    // A walled 1x1 pool: water stays put.
    world.setBlock(0, 4, 0, B.WATER);
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) world.setBlock(x, 4, z, B.STONE);
    run(FLUID_TICK_DELAY.water * 4);
    expect(world.getBlock(2, 4, 0)).toBe(B.AIR);
    world.setBlock(1, 4, 0, B.AIR); // player breaks the wall
    run(FLUID_TICK_DELAY.water * 3);
    expect(level(world, 1, 4, 0)).toBe(1);
    expect(level(world, 2, 4, 0)).toBe(2);
  });

  test('removing the source drains all the flowing water', () => {
    const { world, run, sim } = setup();
    world.setBlock(0, 4, 0, B.WATER);
    run(FLUID_TICK_DELAY.water * 12);
    expect(level(world, 5, 4, 0)).toBe(5);
    world.setBlock(0, 4, 0, B.AIR);
    run(FLUID_TICK_DELAY.water * 40);
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) expect(world.getBlock(x, 4, z), `${x},${z}`).toBe(B.AIR);
    expect(sim.pending()).toBe(0);
  });

  test('a waterfall drains from the top when its source is removed', () => {
    const { world, run } = setup();
    world.setBlock(0, 8, 0, B.WATER);
    run(FLUID_TICK_DELAY.water * 20);
    expect(isWater(world.getBlock(0, 4, 0))).toBe(true);
    world.setBlock(0, 8, 0, B.AIR);
    run(FLUID_TICK_DELAY.water * 40);
    for (let y = 4; y <= 8; y++) expect(world.getBlock(0, y, 0)).toBe(B.AIR);
    expect(world.getBlock(3, 4, 0)).toBe(B.AIR);
  });

  test('two sources with solid ground below make a new source (infinite water)', () => {
    const { world, run } = setup();
    world.setBlock(0, 4, 0, B.WATER);
    world.setBlock(2, 4, 0, B.WATER);
    run(FLUID_TICK_DELAY.water * 3);
    expect(world.getBlock(1, 4, 0)).toBe(B.WATER);
  });

  test('water washes away plants and torches and reports them for drops', () => {
    const { world, run, washed } = setup();
    world.setBlock(1, 4, 0, B.TORCH);
    world.setBlock(0, 4, 0, B.WATER);
    run(FLUID_TICK_DELAY.water);
    expect(level(world, 1, 4, 0)).toBe(1);
    expect(washed).toEqual([{ x: 1, y: 4, z: 0, id: B.TORCH }]);
  });

  test('water does not flow into unloaded chunks (and never generates them)', () => {
    const { world, run } = setup(0);
    world.setBlock(CHUNK_SIZE - 1, 4, 0, B.WATER);
    run(FLUID_TICK_DELAY.water * 10);
    expect(world.isLoaded(1, 0)).toBe(false);
    expect(level(world, CHUNK_SIZE - 2, 4, 0)).toBe(1);
  });

  test('flowing water already in a freshly loaded chunk (e.g. from a save) resumes updating', () => {
    const gen: ChunkGenerator = {
      generate(cx, cz) {
        const c = floor.generate(cx, cz);
        if (cx === 0 && cz === 0) c.set(3, 4, 3, fluidId('water', 6)); // orphaned flowing water, no source
        return c;
      },
    };
    const world = new World(gen);
    const sim = new FluidSimulator(world);
    world.ensureChunk(0, 0);
    expect(sim.pending()).toBe(1);
    for (let i = 0; i < FLUID_TICK_DELAY.water; i++) sim.tick();
    expect(world.getBlock(3, 4, 3)).toBe(B.AIR);
  });
});

describe('lava', () => {
  test('lava flows slower and only 3 blocks on the overworld', () => {
    const { world, run } = setup();
    world.setBlock(0, 4, 0, B.LAVA);
    run(FLUID_TICK_DELAY.water * 2);
    expect(world.getBlock(1, 4, 0)).toBe(B.AIR);
    run(FLUID_TICK_DELAY.lava * 6);
    expect(isLava(world.getBlock(3, 4, 0))).toBe(true);
    expect(world.getBlock(4, 4, 0)).toBe(B.AIR);
  });

  test('water touching a lava source turns it into obsidian', () => {
    const { world, run } = setup();
    world.setBlock(0, 4, 0, B.LAVA);
    for (const [x, z] of [[-1, 0], [0, 1], [0, -1]]) world.setBlock(x, 4, z, B.STONE);
    world.setBlock(2, 4, 0, B.WATER);
    run(FLUID_TICK_DELAY.water * 3);
    expect(world.getBlock(0, 4, 0)).toBe(B.OBSIDIAN);
  });

  test('water touching flowing lava turns it into cobblestone', () => {
    const { world, run } = setup();
    world.setBlock(0, 4, 0, B.LAVA);
    run(FLUID_TICK_DELAY.lava * 2);
    expect(isLava(world.getBlock(1, 4, 0))).toBe(true);
    world.setBlock(3, 4, 0, B.WATER);
    run(FLUID_TICK_DELAY.lava * 2);
    expect(world.getBlock(2, 4, 0)).toBe(B.COBBLESTONE);
  });

  test('lava flowing down onto water makes stone', () => {
    const { world, run } = setup();
    world.setBlock(0, 4, 0, B.WATER);
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) world.setBlock(x, 4, z, B.STONE);
    world.setBlock(0, 6, 0, B.LAVA);
    run(FLUID_TICK_DELAY.lava * 4);
    expect(world.getBlock(0, 4, 0)).toBe(B.STONE);
  });
});
