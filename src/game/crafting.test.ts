import { B } from '../core/blocks';
import { I, getItem } from '../core/items';
import { findRecipe, craftOnce, RECIPES } from './crafting';
import type { Slot } from './inventory';

const s = (id: number, count = 1): Slot => ({ id, count });
const _ = null;

describe('crafting', () => {
  test('a log anywhere in the grid makes 4 planks of the matching wood', () => {
    expect(findRecipe([_, _, _, s(B.OAK_LOG)], 2)?.result).toEqual({ id: B.OAK_PLANKS, count: 4 });
    expect(findRecipe([s(B.BIRCH_LOG), _, _, _], 2)?.result).toEqual({ id: B.BIRCH_PLANKS, count: 4 });
    expect(findRecipe([_, _, _, _, s(B.CHERRY_LOG), _, _, _, _], 3)?.result).toEqual({ id: B.CHERRY_PLANKS, count: 4 });
  });

  test('two planks stacked vertically make 4 sticks, any wood type', () => {
    expect(findRecipe([s(B.OAK_PLANKS), _, s(B.SPRUCE_PLANKS), _], 2)?.result).toEqual({ id: I.STICK, count: 4 });
    expect(findRecipe([s(B.OAK_PLANKS), s(B.OAK_PLANKS), _, _], 2)).toBeNull();
  });

  test('four planks make a crafting table', () => {
    const p = s(B.OAK_PLANKS);
    expect(findRecipe([p, p, p, p], 2)?.result.id).toBe(B.CRAFTING_TABLE);
  });

  test('a pickaxe needs the 3x3 crafting table grid', () => {
    const grid: Slot[] = [s(B.OAK_PLANKS), s(B.OAK_PLANKS), s(B.OAK_PLANKS), _, s(I.STICK), _, _, s(I.STICK), _];
    expect(findRecipe(grid, 3)?.result.id).toBe(I.WOODEN_PICKAXE);
  });

  test('stone tools accept cobblestone or cobbled deepslate', () => {
    const c = s(B.COBBLESTONE);
    const d = s(B.COBBLED_DEEPSLATE);
    expect(findRecipe([c, d, c, _, s(I.STICK), _, _, s(I.STICK), _], 3)?.result.id).toBe(I.STONE_PICKAXE);
  });

  test('mirrored shapes are accepted (axe facing either way)', () => {
    const i = s(I.IRON_INGOT);
    const st = s(I.STICK);
    expect(findRecipe([i, i, _, i, st, _, _, st, _], 3)?.result.id).toBe(I.IRON_AXE);
    expect(findRecipe([_, i, i, _, st, i, _, st, _], 3)?.result.id).toBe(I.IRON_AXE);
  });

  test('torches can be made with coal or charcoal', () => {
    expect(findRecipe([s(I.COAL), _, s(I.STICK), _], 2)?.result).toEqual({ id: B.TORCH, count: 4 });
    expect(findRecipe([s(I.CHARCOAL), _, s(I.STICK), _], 2)?.result).toEqual({ id: B.TORCH, count: 4 });
  });

  test('a ring of cobblestone makes a furnace, a ring of planks makes a chest', () => {
    const c = s(B.COBBLESTONE);
    expect(findRecipe([c, c, c, c, _, c, c, c, c], 3)?.result.id).toBe(B.FURNACE);
    const p = s(B.BIRCH_PLANKS);
    expect(findRecipe([p, p, p, p, _, p, p, p, p], 3)?.result.id).toBe(B.CHEST);
  });

  test('storage blocks pack and unpack', () => {
    const d = s(I.DIAMOND);
    expect(findRecipe([d, d, d, d, d, d, d, d, d], 3)?.result).toEqual({ id: B.DIAMOND_BLOCK, count: 1 });
    expect(findRecipe([s(B.IRON_BLOCK), _, _, _], 2)?.result).toEqual({ id: I.IRON_INGOT, count: 9 });
  });

  test('unknown arrangements do not match', () => {
    expect(findRecipe([s(B.DIRT), s(B.DIRT), _, _], 2)).toBeNull();
    expect(findRecipe([_, _, _, _], 2)).toBeNull();
  });

  test('crafting consumes one item from each filled slot', () => {
    const grid: Slot[] = [s(B.OAK_LOG, 3), _, _, _];
    const out = craftOnce(grid, 2);
    expect(out).toEqual({ id: B.OAK_PLANKS, count: 4 });
    expect(grid[0]!.count).toBe(2);
    craftOnce(grid, 2);
    craftOnce(grid, 2);
    expect(grid[0]).toBeNull();
    expect(craftOnce(grid, 2)).toBeNull();
  });

  test('every recipe produces a registered item', () => {
    for (const r of RECIPES) expect(() => getItem(r.result.id)).not.toThrow();
  });

  test('every tool tier can be crafted', () => {
    const results = new Set(RECIPES.map((r) => r.result.id));
    for (const id of [I.WOODEN_SWORD, I.STONE_SHOVEL, I.IRON_PICKAXE, I.GOLDEN_AXE, I.DIAMOND_SWORD]) expect(results).toContain(id);
  });

  test('three iron ingots in a V make a bucket; filled buckets do not stack', () => {
    const i = s(I.IRON_INGOT);
    expect(findRecipe([i, _, i, _, i, _, _, _, _], 3)?.result).toEqual({ id: I.BUCKET, count: 1 });
    expect(getItem(I.BUCKET).maxStack).toBe(16);
    expect(getItem(I.WATER_BUCKET).maxStack).toBe(1);
    expect(getItem(I.LAVA_BUCKET).maxStack).toBe(1);
  });
});
