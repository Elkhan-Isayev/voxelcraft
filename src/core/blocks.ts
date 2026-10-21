export type RenderType = 'none' | 'cube' | 'cutout' | 'translucent' | 'cross';
export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'sword';

export interface BlockTextures {
  top: string;
  bottom: string;
  side: string;
  /** Optional distinct front face (furnace, crafting table). */
  front?: string;
}

export interface BlockDef {
  id: number;
  key: string;
  solid: boolean;
  /** Fully occludes neighbouring faces and blocks light. */
  opaque: boolean;
  render: RenderType;
  fluid: boolean;
  replaceable: boolean;
  selectable: boolean;
  gravity: boolean;
  /** 0 = light passes freely, 15 = fully blocks light. */
  lightOpacity: number;
  lightEmission: number;
  /** Seconds-ish scale used by the mining formula. Negative = unbreakable. */
  hardness: number;
  tool: ToolType | null;
  requiresTool: boolean;
  /** Minimum tool tier needed for drops: 0 wood, 1 stone, 2 iron, 3 diamond. */
  minTier: number;
  /** Item key dropped when mined. undefined = the block itself, null = nothing. */
  drop?: string | null;
  dropCount?: [number, number];
  extraDrops?: { key: string; chance: number }[];
  /** Block cannot be obtained as an item. */
  noItem: boolean;
  textures: BlockTextures;
}

type BlockOpts = Partial<Omit<BlockDef, 'id' | 'key' | 'textures'>> & {
  textures?: Partial<BlockTextures> | string;
};

const registry: BlockDef[] = [];
const byKey = new Map<string, BlockDef>();

function def(key: string, opts: BlockOpts = {}): number {
  const id = registry.length;
  const tex = opts.textures;
  const textures: BlockTextures =
    typeof tex === 'string'
      ? { top: tex, bottom: tex, side: tex }
      : {
          top: tex?.top ?? tex?.side ?? key,
          bottom: tex?.bottom ?? tex?.top ?? tex?.side ?? key,
          side: tex?.side ?? key,
          front: tex?.front,
        };
  const render = opts.render ?? 'cube';
  const opaque = opts.opaque ?? render === 'cube';
  const block: BlockDef = {
    id,
    key,
    solid: opts.solid ?? (render === 'cube' || render === 'cutout'),
    opaque,
    render,
    fluid: opts.fluid ?? false,
    replaceable: opts.replaceable ?? false,
    selectable: opts.selectable ?? true,
    gravity: opts.gravity ?? false,
    lightOpacity: opts.lightOpacity ?? (opaque ? 15 : 0),
    lightEmission: opts.lightEmission ?? 0,
    hardness: opts.hardness ?? 1,
    tool: opts.tool ?? null,
    requiresTool: opts.requiresTool ?? false,
    minTier: opts.minTier ?? 0,
    drop: opts.drop,
    dropCount: opts.dropCount,
    extraDrops: opts.extraDrops,
    noItem: opts.noItem ?? false,
    textures,
  };
  registry.push(block);
  byKey.set(key, block);
  return id;
}

const stoneLike = (hardness: number, extra: BlockOpts = {}): BlockOpts => ({
  hardness,
  tool: 'pickaxe',
  requiresTool: true,
  ...extra,
});
const wood = (hardness = 2, extra: BlockOpts = {}): BlockOpts => ({ hardness, tool: 'axe', ...extra });
const soil = (hardness: number, extra: BlockOpts = {}): BlockOpts => ({ hardness, tool: 'shovel', ...extra });
const leaves = (extra: BlockOpts = {}): BlockOpts => ({
  render: 'cutout',
  hardness: 0.2,
  lightOpacity: 1,
  drop: null,
  extraDrops: [{ key: 'stick', chance: 0.03 }],
  ...extra,
});
const log = (name: string): BlockOpts =>
  wood(2, { textures: { side: `${name}_log`, top: `${name}_log_top` } });
function fluid(kind: 'water' | 'lava'): BlockOpts {
  return {
    render: 'translucent',
    solid: false,
    fluid: true,
    replaceable: true,
    selectable: false,
    lightOpacity: kind === 'water' ? 2 : 1,
    lightEmission: kind === 'lava' ? 15 : 0,
    hardness: -1,
    noItem: true,
    textures: kind,
  };
}
const plant = (extra: BlockOpts = {}): BlockOpts => ({
  render: 'cross',
  solid: false,
  hardness: 0,
  ...extra,
});

export const B = {
  AIR: def('air', { render: 'none', solid: false, replaceable: true, selectable: false, noItem: true, hardness: 0, textures: 'air' }),
  STONE: def('stone', stoneLike(1.5, { drop: 'cobblestone' })),
  GRASS_BLOCK: def('grass_block', soil(0.6, { drop: 'dirt', textures: { top: 'grass_block_top', side: 'grass_block_side', bottom: 'dirt' } })),
  DIRT: def('dirt', soil(0.5)),
  COBBLESTONE: def('cobblestone', stoneLike(2)),
  OAK_PLANKS: def('oak_planks', wood()),
  BEDROCK: def('bedrock', { hardness: -1 }),
  WATER: def('water', fluid('water')),
  SAND: def('sand', soil(0.5, { gravity: true })),
  GRAVEL: def('gravel', soil(0.6, { gravity: true })),
  OAK_LOG: def('oak_log', log('oak')),
  OAK_LEAVES: def('oak_leaves', leaves({ extraDrops: [{ key: 'apple', chance: 0.05 }, { key: 'stick', chance: 0.03 }] })),
  GLASS: def('glass', { render: 'cutout', hardness: 0.3, drop: null }),
  COAL_ORE: def('coal_ore', stoneLike(3, { drop: 'coal' })),
  IRON_ORE: def('iron_ore', stoneLike(3, { drop: 'raw_iron', minTier: 1 })),
  GOLD_ORE: def('gold_ore', stoneLike(3, { drop: 'raw_gold', minTier: 2 })),
  DIAMOND_ORE: def('diamond_ore', stoneLike(3, { drop: 'diamond', minTier: 2 })),
  COPPER_ORE: def('copper_ore', stoneLike(3, { drop: 'raw_copper', minTier: 1, dropCount: [2, 3] })),
  DEEPSLATE: def('deepslate', stoneLike(3, { drop: 'cobbled_deepslate', textures: { side: 'deepslate', top: 'deepslate_top' } })),
  COBBLED_DEEPSLATE: def('cobbled_deepslate', stoneLike(3.5)),
  TUFF: def('tuff', stoneLike(1.5)),
  SNOW_BLOCK: def('snow_block', soil(0.2)),
  ICE: def('ice', { render: 'cutout', hardness: 0.5, tool: 'pickaxe', drop: null, lightOpacity: 1, solid: true }),
  CACTUS: def('cactus', { hardness: 0.4, textures: { side: 'cactus_side', top: 'cactus_top' }, render: 'cutout', lightOpacity: 0 }),
  SANDSTONE: def('sandstone', stoneLike(0.8, { textures: { side: 'sandstone', top: 'sandstone_top', bottom: 'sandstone_top' } })),
  BIRCH_LOG: def('birch_log', log('birch')),
  BIRCH_LEAVES: def('birch_leaves', leaves()),
  BIRCH_PLANKS: def('birch_planks', wood()),
  SPRUCE_LOG: def('spruce_log', log('spruce')),
  SPRUCE_LEAVES: def('spruce_leaves', leaves()),
  SPRUCE_PLANKS: def('spruce_planks', wood()),
  CHERRY_LOG: def('cherry_log', log('cherry')),
  CHERRY_LEAVES: def('cherry_leaves', leaves()),
  CHERRY_PLANKS: def('cherry_planks', wood()),
  CRAFTING_TABLE: def('crafting_table', wood(2.5, {
    textures: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' },
  })),
  FURNACE: def('furnace', stoneLike(3.5, {
    textures: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' },
  })),
  CHEST: def('chest', wood(2.5, { textures: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' } })),
  TORCH: def('torch', plant({ lightEmission: 14 })),
  BRICKS: def('bricks', stoneLike(2)),
  STONE_BRICKS: def('stone_bricks', stoneLike(1.5)),
  OBSIDIAN: def('obsidian', stoneLike(50, { minTier: 3 })),
  SHORT_GRASS: def('short_grass', plant({ replaceable: true, drop: null, extraDrops: [{ key: 'wheat', chance: 0.125 }] })),
  DANDELION: def('dandelion', plant()),
  POPPY: def('poppy', plant()),
  DEAD_BUSH: def('dead_bush', plant({ replaceable: true, drop: 'stick' })),
  WHITE_WOOL: def('white_wool', { hardness: 0.8 }),
  BOOKSHELF: def('bookshelf', wood(1.5, { textures: { side: 'bookshelf', top: 'oak_planks' } })),
  MUD: def('mud', soil(0.5)),
  COPPER_BLOCK: def('copper_block', stoneLike(3, { minTier: 1 })),
  AMETHYST_BLOCK: def('amethyst_block', stoneLike(1.5)),
  GLOWSTONE: def('glowstone', { hardness: 0.3, lightEmission: 15 }),
  IRON_BLOCK: def('iron_block', stoneLike(5, { minTier: 1 })),
  GOLD_BLOCK: def('gold_block', stoneLike(3, { minTier: 2 })),
  DIAMOND_BLOCK: def('diamond_block', stoneLike(5, { minTier: 2 })),
  COAL_BLOCK: def('coal_block', stoneLike(5)),
  MOSS_BLOCK: def('moss_block', { hardness: 0.1, tool: 'axe' }),
  SNOWY_GRASS_BLOCK: def('snowy_grass_block', soil(0.6, {
    drop: 'dirt',
    noItem: true,
    textures: { top: 'snow_block', side: 'grass_block_snow', bottom: 'dirt' },
  })),
  DEEPSLATE_IRON_ORE: def('deepslate_iron_ore', stoneLike(4.5, { drop: 'raw_iron', minTier: 1 })),
  DEEPSLATE_DIAMOND_ORE: def('deepslate_diamond_ore', stoneLike(4.5, { drop: 'diamond', minTier: 2 })),
  PINK_PETALS: def('pink_petals', plant({ replaceable: true })),
  CORNFLOWER: def('cornflower', plant()),
  CLAY: def('clay', soil(0.6)),
  TNT: def('tnt', { hardness: 0, textures: { side: 'tnt_side', top: 'tnt_top', bottom: 'tnt_bottom' } }),
  LAVA: def('lava', fluid('lava')),
} as const;

// Flowing fluids store their level in the block id (no per-block metadata): index 1-7 = flow level,
// index 8 = falling. Index 0 is the source block itself. Appended after B so existing ids stay stable.
const flowIds = (kind: 'water' | 'lava', source: number): readonly number[] => [
  source,
  ...[1, 2, 3, 4, 5, 6, 7].map((l) => def(`flowing_${kind}_${l}`, fluid(kind))),
  def(`falling_${kind}`, fluid(kind)),
];
export const WATER_IDS = flowIds('water', B.WATER);
export const LAVA_IDS = flowIds('lava', B.LAVA);

export type BlockId = number;

export function getBlock(id: number): BlockDef {
  return registry[id] ?? registry[0];
}

export function blockByKey(key: string): BlockDef | undefined {
  return byKey.get(key);
}

export function allBlocks(): readonly BlockDef[] {
  return registry;
}

export const BLOCK_COUNT = registry.length;

// Fast lookup tables used by hot paths (meshing, lighting, physics).
export const IS_OPAQUE = new Uint8Array(256);
export const IS_SOLID = new Uint8Array(256);
export const LIGHT_OPACITY = new Uint8Array(256);
export const LIGHT_EMISSION = new Uint8Array(256);
for (const b of registry) {
  IS_OPAQUE[b.id] = b.opaque ? 1 : 0;
  IS_SOLID[b.id] = b.solid ? 1 : 0;
  LIGHT_OPACITY[b.id] = b.lightOpacity;
  LIGHT_EMISSION[b.id] = b.lightEmission;
}
