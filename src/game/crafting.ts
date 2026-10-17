import { B } from '../core/blocks';
import { I } from '../core/items';
import type { ItemStack, Slot } from './inventory';

/** An ingredient is an item id or a tag name that matches several items. */
export type Ingredient = number | string;

export const TAGS: Record<string, number[]> = {
  planks: [B.OAK_PLANKS, B.BIRCH_PLANKS, B.SPRUCE_PLANKS, B.CHERRY_PLANKS],
  logs: [B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.CHERRY_LOG],
  coals: [I.COAL, I.CHARCOAL],
  stone_tool_materials: [B.COBBLESTONE, B.COBBLED_DEEPSLATE],
};

export interface Recipe {
  /** Shaped recipes: rows of characters, spaces are empty. */
  pattern?: string[];
  key?: Record<string, Ingredient>;
  /** Shapeless recipes: list of ingredients in any position. */
  ingredients?: Ingredient[];
  result: ItemStack;
}

function matches(ing: Ingredient, id: number): boolean {
  return typeof ing === 'number' ? ing === id : (TAGS[ing]?.includes(id) ?? false);
}

const recipes: Recipe[] = [];
const shaped = (pattern: string[], key: Record<string, Ingredient>, id: number, count = 1) =>
  recipes.push({ pattern, key, result: { id, count } });
const shapeless = (ingredients: Ingredient[], id: number, count = 1) => recipes.push({ ingredients, result: { id, count } });

// Wood
shapeless([B.OAK_LOG], B.OAK_PLANKS, 4);
shapeless([B.BIRCH_LOG], B.BIRCH_PLANKS, 4);
shapeless([B.SPRUCE_LOG], B.SPRUCE_PLANKS, 4);
shapeless([B.CHERRY_LOG], B.CHERRY_PLANKS, 4);
shaped(['#', '#'], { '#': 'planks' }, I.STICK, 4);
shaped(['##', '##'], { '#': 'planks' }, B.CRAFTING_TABLE);
shaped(['###', '# #', '###'], { '#': 'planks' }, B.CHEST);
shaped(['###', 'XXX', '###'], { '#': 'planks', X: I.STICK }, B.BOOKSHELF);

// Stone & misc blocks
shaped(['###', '# #', '###'], { '#': 'stone_tool_materials' }, B.FURNACE);
shaped(['C', 'S'], { C: 'coals', S: I.STICK }, B.TORCH, 4);
shaped(['##', '##'], { '#': B.SAND }, B.SANDSTONE);
shaped(['##', '##'], { '#': B.STONE }, B.STONE_BRICKS, 4);
shaped(['##', '##'], { '#': I.BRICK }, B.BRICKS);
shaped(['##', '##'], { '#': I.CLAY_BALL }, B.CLAY);
shaped(['##', '##'], { '#': B.SNOW_BLOCK }, B.ICE);
shaped(['GSG', 'SGS', 'GSG'], { G: I.GUNPOWDER, S: B.SAND }, B.TNT);

// Storage blocks
const storage: [number, number][] = [
  [I.IRON_INGOT, B.IRON_BLOCK],
  [I.GOLD_INGOT, B.GOLD_BLOCK],
  [I.DIAMOND, B.DIAMOND_BLOCK],
  [I.COAL, B.COAL_BLOCK],
  [I.COPPER_INGOT, B.COPPER_BLOCK],
];
for (const [ingot, block] of storage) {
  shaped(['###', '###', '###'], { '#': ingot }, block);
  shapeless([block], ingot, 9);
}

// Food
shaped(['###'], { '#': I.WHEAT }, I.BREAD);

// Tools
const toolMaterials: [string, Ingredient][] = [
  ['WOODEN', 'planks'],
  ['STONE', 'stone_tool_materials'],
  ['IRON', I.IRON_INGOT],
  ['GOLDEN', I.GOLD_INGOT],
  ['DIAMOND', I.DIAMOND],
];
const ids = I as unknown as Record<string, number>;
for (const [name, mat] of toolMaterials) {
  const key = { M: mat, S: I.STICK };
  shaped(['MMM', ' S ', ' S '], key, ids[`${name}_PICKAXE`]);
  shaped(['MM', 'MS', ' S'], key, ids[`${name}_AXE`]);
  shaped(['M', 'S', 'S'], key, ids[`${name}_SHOVEL`]);
  shaped(['M', 'M', 'S'], key, ids[`${name}_SWORD`]);
}
// Netherite upgrade (simplified: diamond tool + netherite ingot).
for (const t of ['PICKAXE', 'AXE', 'SHOVEL', 'SWORD']) shapeless([ids[`DIAMOND_${t}`], I.NETHERITE_INGOT], ids[`NETHERITE_${t}`]);
shapeless([I.GOLD_INGOT, I.GOLD_INGOT, I.GOLD_INGOT, I.GOLD_INGOT, I.DIAMOND, I.DIAMOND, I.DIAMOND, I.DIAMOND], I.NETHERITE_INGOT);

export const RECIPES: readonly Recipe[] = recipes;

/** Trims empty rows and columns. Returns the occupied sub-grid as rows of item ids (0 = empty). */
function trim(grid: Slot[], width: number): number[][] {
  const height = grid.length / width;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (grid[y * width + x]) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  if (maxX < 0) return [];
  const rows: number[][] = [];
  for (let y = minY; y <= maxY; y++) {
    const row: number[] = [];
    for (let x = minX; x <= maxX; x++) row.push(grid[y * width + x]?.id ?? -1);
    rows.push(row);
  }
  return rows;
}

function matchShaped(r: Recipe, rows: number[][], mirror: boolean): boolean {
  const pattern = r.pattern!;
  if (pattern.length !== rows.length) return false;
  const w = Math.max(...pattern.map((p) => p.length));
  if (rows[0].length !== w) return false;
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < w; x++) {
      const ch = pattern[y][mirror ? w - 1 - x : x] ?? ' ';
      const id = rows[y][x];
      if (ch === ' ') {
        if (id !== -1) return false;
      } else if (id === -1 || !matches(r.key![ch], id)) return false;
    }
  return true;
}

function matchShapeless(r: Recipe, grid: Slot[]): boolean {
  const items = grid.filter((s): s is ItemStack => !!s).map((s) => s.id);
  const ings = r.ingredients!;
  if (items.length !== ings.length) return false;
  const used = new Array(items.length).fill(false);
  for (const ing of ings) {
    const idx = items.findIndex((id, i) => !used[i] && matches(ing, id));
    if (idx < 0) return false;
    used[idx] = true;
  }
  return true;
}

export function findRecipe(grid: Slot[], width: number): Recipe | null {
  const rows = trim(grid, width);
  if (rows.length === 0) return null;
  for (const r of recipes) {
    if (r.pattern) {
      if (matchShaped(r, rows, false) || matchShaped(r, rows, true)) return r;
    } else if (matchShapeless(r, grid)) return r;
  }
  return null;
}

/** Crafts one result, consuming one item from every occupied slot. */
export function craftOnce(grid: Slot[], width: number): ItemStack | null {
  const r = findRecipe(grid, width);
  if (!r) return null;
  for (let i = 0; i < grid.length; i++) {
    const s = grid[i];
    if (!s) continue;
    s.count -= 1;
    if (s.count <= 0) grid[i] = null;
  }
  return { ...r.result };
}
