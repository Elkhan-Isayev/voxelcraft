import { B } from '../core/blocks';
import { I } from '../core/items';
import { breakTime, getDrops, canHarvest } from './mining';
import { Furnace, smeltingResult, fuelTicks } from './furnace';

const never = () => 0.99;
const always = () => 0;

describe('mining speed', () => {
  test('dirt by hand takes 0.75s', () => {
    expect(breakTime(B.DIRT, null)).toBeCloseTo(0.75);
  });

  test('stone by hand is slow, a wooden pickaxe is much faster', () => {
    expect(breakTime(B.STONE, null)).toBeCloseTo(7.5);
    expect(breakTime(B.STONE, I.WOODEN_PICKAXE)).toBeCloseTo(1.15);
    expect(breakTime(B.STONE, I.DIAMOND_PICKAXE)).toBeLessThan(0.4);
  });

  test('the wrong tool gives no speed bonus', () => {
    expect(breakTime(B.OAK_LOG, I.DIAMOND_PICKAXE)).toBeCloseTo(breakTime(B.OAK_LOG, null));
    expect(breakTime(B.OAK_LOG, I.STONE_AXE)).toBeLessThan(breakTime(B.OAK_LOG, null));
  });

  test('instant-break blocks and unbreakable blocks', () => {
    expect(breakTime(B.POPPY, null)).toBe(0);
    expect(breakTime(B.TORCH, null)).toBe(0);
    expect(breakTime(B.BEDROCK, I.NETHERITE_PICKAXE)).toBe(Infinity);
  });
});

describe('harvesting and drops', () => {
  test('stone needs a pickaxe to drop cobblestone', () => {
    expect(getDrops(B.STONE, null, never)).toEqual([]);
    expect(getDrops(B.STONE, I.WOODEN_PICKAXE, never)).toEqual([{ id: B.COBBLESTONE, count: 1 }]);
  });

  test('grass blocks drop dirt', () => {
    expect(getDrops(B.GRASS_BLOCK, null, never)).toEqual([{ id: B.DIRT, count: 1 }]);
  });

  test('ores need the right tier', () => {
    expect(canHarvest(B.IRON_ORE, I.WOODEN_PICKAXE)).toBe(false);
    expect(canHarvest(B.IRON_ORE, I.STONE_PICKAXE)).toBe(true);
    expect(getDrops(B.DIAMOND_ORE, I.STONE_PICKAXE, never)).toEqual([]);
    expect(getDrops(B.DIAMOND_ORE, I.IRON_PICKAXE, never)).toEqual([{ id: I.DIAMOND, count: 1 }]);
    expect(getDrops(B.IRON_ORE, I.STONE_PICKAXE, never)).toEqual([{ id: I.RAW_IRON, count: 1 }]);
    expect(getDrops(B.OBSIDIAN, I.IRON_PICKAXE, never)).toEqual([]);
    expect(getDrops(B.OBSIDIAN, I.DIAMOND_PICKAXE, never)).toEqual([{ id: B.OBSIDIAN, count: 1 }]);
  });

  test('copper ore drops several raw copper', () => {
    const drops = getDrops(B.COPPER_ORE, I.STONE_PICKAXE, never);
    expect(drops[0].id).toBe(I.RAW_COPPER);
    expect(drops[0].count).toBeGreaterThanOrEqual(2);
  });

  test('glass shatters, leaves sometimes drop apples', () => {
    expect(getDrops(B.GLASS, null, always)).toEqual([]);
    expect(getDrops(B.OAK_LEAVES, null, never)).toEqual([]);
    expect(getDrops(B.OAK_LEAVES, null, always)).toContainEqual({ id: I.APPLE, count: 1 });
  });

  test('logs drop themselves by hand', () => {
    expect(getDrops(B.OAK_LOG, null, never)).toEqual([{ id: B.OAK_LOG, count: 1 }]);
  });
});

describe('furnace', () => {
  test('knows smelting recipes and fuels', () => {
    expect(smeltingResult(I.RAW_IRON)).toBe(I.IRON_INGOT);
    expect(smeltingResult(B.SAND)).toBe(B.GLASS);
    expect(smeltingResult(B.COBBLESTONE)).toBe(B.STONE);
    expect(smeltingResult(I.PORKCHOP)).toBe(I.COOKED_PORKCHOP);
    expect(smeltingResult(B.DIRT)).toBeUndefined();
    expect(fuelTicks(I.COAL)).toBe(1600);
    expect(fuelTicks(B.OAK_PLANKS)).toBe(300);
    expect(fuelTicks(B.STONE)).toBe(0);
  });

  test('smelts one item every 10 seconds (200 ticks) while burning fuel', () => {
    const f = new Furnace();
    f.input = { id: I.RAW_IRON, count: 2 };
    f.fuel = { id: I.COAL, count: 1 };
    f.tick(199);
    expect(f.output).toBeNull();
    expect(f.isBurning()).toBe(true);
    f.tick(1);
    expect(f.output).toEqual({ id: I.IRON_INGOT, count: 1 });
    expect(f.input).toEqual({ id: I.RAW_IRON, count: 1 });
    expect(f.fuel).toBeNull();
    f.tick(200);
    expect(f.output).toEqual({ id: I.IRON_INGOT, count: 2 });
    expect(f.input).toBeNull();
  });

  test('one coal smelts eight items', () => {
    const f = new Furnace();
    f.input = { id: B.SAND, count: 10 };
    f.fuel = { id: I.COAL, count: 1 };
    f.tick(2000);
    expect(f.output).toEqual({ id: B.GLASS, count: 8 });
    expect(f.input).toEqual({ id: B.SAND, count: 2 });
  });

  test('does nothing without fuel or with unsmeltable input', () => {
    const f = new Furnace();
    f.input = { id: B.SAND, count: 1 };
    f.tick(400);
    expect(f.output).toBeNull();
    f.input = { id: B.DIRT, count: 1 };
    f.fuel = { id: I.COAL, count: 1 };
    f.tick(400);
    expect(f.output).toBeNull();
    expect(f.fuel).toEqual({ id: I.COAL, count: 1 });
  });

  test('stops when the output slot is full of something else', () => {
    const f = new Furnace();
    f.input = { id: B.SAND, count: 1 };
    f.fuel = { id: I.COAL, count: 1 };
    f.output = { id: I.IRON_INGOT, count: 1 };
    f.tick(400);
    expect(f.output).toEqual({ id: I.IRON_INGOT, count: 1 });
  });

  test('reports progress for the UI and round-trips through JSON', () => {
    const f = new Furnace();
    f.input = { id: B.SAND, count: 1 };
    f.fuel = { id: B.OAK_PLANKS, count: 1 };
    f.tick(100);
    expect(f.cookProgress()).toBeCloseTo(0.5);
    expect(f.burnProgress()).toBeCloseTo(200 / 300);
    const g = Furnace.fromJSON(JSON.parse(JSON.stringify(f.toJSON())));
    expect(g.cookProgress()).toBeCloseTo(0.5);
  });
});
