import { allBlocks, getBlock, type ToolType } from './blocks';

export interface ToolInfo {
  type: ToolType;
  /** 0 wood/gold, 1 stone, 2 iron, 3 diamond, 4 netherite */
  tier: number;
  speed: number;
}

export interface FoodInfo {
  hunger: number;
  saturation: number;
}

export interface ItemDef {
  id: number;
  key: string;
  maxStack: number;
  blockId?: number;
  tool?: ToolInfo;
  durability?: number;
  attackDamage: number;
  food?: FoodInfo;
  /** Texture tile used for the icon of non-block items. */
  texture: string;
}

/** Non-block items live above the block id range. */
export const ITEM_ID_OFFSET = 256;

const items = new Map<number, ItemDef>();
const byKey = new Map<string, ItemDef>();

for (const b of allBlocks()) {
  if (b.noItem) continue;
  const item: ItemDef = { id: b.id, key: b.key, maxStack: 64, blockId: b.id, attackDamage: 1, texture: b.textures.side };
  items.set(b.id, item);
  byKey.set(b.key, item);
}

let nextId = ITEM_ID_OFFSET;
function item(key: string, opts: Partial<Omit<ItemDef, 'id' | 'key'>> = {}): number {
  const id = nextId++;
  const def: ItemDef = { id, key, maxStack: 64, attackDamage: 1, texture: key, ...opts };
  items.set(id, def);
  byKey.set(key, def);
  return id;
}

const food = (hunger: number, saturation: number) => ({ food: { hunger, saturation } });

interface Material {
  name: string;
  tier: number;
  speed: number;
  durability: number;
  /** Attack damage for pickaxe, axe, shovel, sword (Java edition values). */
  damage: [number, number, number, number];
}

const MATERIALS: Material[] = [
  { name: 'wooden', tier: 0, speed: 2, durability: 59, damage: [2, 7, 2.5, 4] },
  { name: 'stone', tier: 1, speed: 4, durability: 131, damage: [3, 9, 3.5, 5] },
  { name: 'iron', tier: 2, speed: 6, durability: 250, damage: [4, 9, 4.5, 6] },
  { name: 'golden', tier: 0, speed: 12, durability: 32, damage: [2, 7, 2.5, 4] },
  { name: 'diamond', tier: 3, speed: 8, durability: 1561, damage: [5, 9, 5.5, 7] },
  { name: 'netherite', tier: 4, speed: 9, durability: 2031, damage: [6, 10, 6.5, 8] },
];
const TOOL_TYPES: ToolType[] = ['pickaxe', 'axe', 'shovel', 'sword'];

const simple = {
  STICK: item('stick'),
  COAL: item('coal'),
  CHARCOAL: item('charcoal'),
  RAW_IRON: item('raw_iron'),
  RAW_GOLD: item('raw_gold'),
  RAW_COPPER: item('raw_copper'),
  IRON_INGOT: item('iron_ingot'),
  GOLD_INGOT: item('gold_ingot'),
  COPPER_INGOT: item('copper_ingot'),
  DIAMOND: item('diamond'),
  NETHERITE_INGOT: item('netherite_ingot'),
  WHEAT: item('wheat'),
  APPLE: item('apple', food(4, 2.4)),
  BREAD: item('bread', food(5, 6)),
  PORKCHOP: item('porkchop', food(3, 1.8)),
  COOKED_PORKCHOP: item('cooked_porkchop', food(8, 12.8)),
  BEEF: item('beef', food(3, 1.8)),
  COOKED_BEEF: item('cooked_beef', food(8, 12.8)),
  MUTTON: item('mutton', food(2, 1.2)),
  COOKED_MUTTON: item('cooked_mutton', food(6, 9.6)),
  ROTTEN_FLESH: item('rotten_flesh', food(4, 0.8)),
  LEATHER: item('leather'),
  GUNPOWDER: item('gunpowder'),
  BRICK: item('brick'),
  CLAY_BALL: item('clay_ball'),
};

const tools: Record<string, number> = {};
for (const m of MATERIALS) {
  TOOL_TYPES.forEach((type, i) => {
    const key = `${m.name}_${type}`;
    tools[key.toUpperCase()] = item(key, {
      maxStack: 1,
      tool: { type, tier: m.tier, speed: m.speed },
      durability: m.durability,
      attackDamage: m.damage[i],
    });
  });
}

// Added after the tools so earlier item ids (stored in saves) do not shift.
const fluidItems = {
  BUCKET: item('bucket', { maxStack: 16 }),
  WATER_BUCKET: item('water_bucket', { maxStack: 1 }),
  LAVA_BUCKET: item('lava_bucket', { maxStack: 1 }),
};

export const I = {
  ...simple,
  ...fluidItems,
  WOODEN_PICKAXE: tools.WOODEN_PICKAXE,
  WOODEN_AXE: tools.WOODEN_AXE,
  WOODEN_SHOVEL: tools.WOODEN_SHOVEL,
  WOODEN_SWORD: tools.WOODEN_SWORD,
  STONE_PICKAXE: tools.STONE_PICKAXE,
  STONE_AXE: tools.STONE_AXE,
  STONE_SHOVEL: tools.STONE_SHOVEL,
  STONE_SWORD: tools.STONE_SWORD,
  IRON_PICKAXE: tools.IRON_PICKAXE,
  IRON_AXE: tools.IRON_AXE,
  IRON_SHOVEL: tools.IRON_SHOVEL,
  IRON_SWORD: tools.IRON_SWORD,
  GOLDEN_PICKAXE: tools.GOLDEN_PICKAXE,
  GOLDEN_AXE: tools.GOLDEN_AXE,
  GOLDEN_SHOVEL: tools.GOLDEN_SHOVEL,
  GOLDEN_SWORD: tools.GOLDEN_SWORD,
  DIAMOND_PICKAXE: tools.DIAMOND_PICKAXE,
  DIAMOND_AXE: tools.DIAMOND_AXE,
  DIAMOND_SHOVEL: tools.DIAMOND_SHOVEL,
  DIAMOND_SWORD: tools.DIAMOND_SWORD,
  NETHERITE_PICKAXE: tools.NETHERITE_PICKAXE,
  NETHERITE_AXE: tools.NETHERITE_AXE,
  NETHERITE_SHOVEL: tools.NETHERITE_SHOVEL,
  NETHERITE_SWORD: tools.NETHERITE_SWORD,
} as const;

export const TOOL_MATERIALS = MATERIALS.map((m) => m.name);

export function getItem(id: number): ItemDef {
  const def = items.get(id);
  if (!def) throw new Error(`Unknown item id ${id}`);
  return def;
}

export function hasItem(id: number): boolean {
  return items.has(id);
}

export function itemByKey(key: string): ItemDef | undefined {
  return byKey.get(key);
}

export function allItems(): ItemDef[] {
  return [...items.values()];
}

export function isBlockItem(id: number): boolean {
  return id < ITEM_ID_OFFSET && items.get(id)?.blockId !== undefined;
}

/** Translation key for any item or block id. */
export function itemTranslationKey(id: number): string {
  if (id < ITEM_ID_OFFSET) return `block.${getBlock(id).key}`;
  return `item.${getItem(id).key}`;
}
