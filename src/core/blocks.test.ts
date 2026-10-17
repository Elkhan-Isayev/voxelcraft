import { B, getBlock, allBlocks, blockByKey } from './blocks';
import { I, getItem, allItems, itemByKey, isBlockItem } from './items';

describe('block registry', () => {
  test('air is empty: not solid, not opaque, replaceable, not selectable', () => {
    const air = getBlock(B.AIR);
    expect(air.solid).toBe(false);
    expect(air.opaque).toBe(false);
    expect(air.replaceable).toBe(true);
    expect(air.selectable).toBe(false);
  });

  test('stone is a solid opaque cube mined with a pickaxe', () => {
    const stone = getBlock(B.STONE);
    expect(stone.solid).toBe(true);
    expect(stone.opaque).toBe(true);
    expect(stone.render).toBe('cube');
    expect(stone.tool).toBe('pickaxe');
    expect(stone.requiresTool).toBe(true);
  });

  test('water is a translucent fluid you can walk through and replace', () => {
    const water = getBlock(B.WATER);
    expect(water.solid).toBe(false);
    expect(water.fluid).toBe(true);
    expect(water.render).toBe('translucent');
    expect(water.replaceable).toBe(true);
    expect(water.selectable).toBe(false);
    expect(water.lightOpacity).toBeGreaterThan(0);
  });

  test('glass is solid but lets light through', () => {
    const glass = getBlock(B.GLASS);
    expect(glass.solid).toBe(true);
    expect(glass.opaque).toBe(false);
    expect(glass.lightOpacity).toBe(0);
    expect(glass.render).toBe('cutout');
  });

  test('leaves dim light slightly and are rendered with holes', () => {
    const leaves = getBlock(B.OAK_LEAVES);
    expect(leaves.lightOpacity).toBe(1);
    expect(leaves.render).toBe('cutout');
  });

  test('flowers and grass are non-solid crosses', () => {
    for (const id of [B.POPPY, B.DANDELION, B.SHORT_GRASS]) {
      const b = getBlock(id);
      expect(b.render).toBe('cross');
      expect(b.solid).toBe(false);
    }
    expect(getBlock(B.SHORT_GRASS).replaceable).toBe(true);
  });

  test('light sources emit light', () => {
    expect(getBlock(B.TORCH).lightEmission).toBe(14);
    expect(getBlock(B.GLOWSTONE).lightEmission).toBe(15);
    expect(getBlock(B.STONE).lightEmission).toBe(0);
  });

  test('bedrock cannot be broken', () => {
    expect(getBlock(B.BEDROCK).hardness).toBeLessThan(0);
  });

  test('sand and gravel are affected by gravity', () => {
    expect(getBlock(B.SAND).gravity).toBe(true);
    expect(getBlock(B.GRAVEL).gravity).toBe(true);
    expect(getBlock(B.DIRT).gravity).toBe(false);
  });

  test('includes blocks from recent versions (cherry, deepslate, copper, tuff)', () => {
    for (const key of ['cherry_log', 'cherry_leaves', 'deepslate', 'copper_ore', 'tuff', 'mud', 'amethyst_block']) {
      expect(blockByKey(key)).toBeDefined();
    }
  });

  test('keys are unique and ids are dense', () => {
    const blocks = allBlocks();
    expect(new Set(blocks.map((b) => b.key)).size).toBe(blocks.length);
    blocks.forEach((b, i) => expect(b.id).toBe(i));
  });

  test('every block declares textures for all faces (except air)', () => {
    for (const b of allBlocks()) {
      if (b.id === B.AIR) continue;
      expect(b.textures.top).toBeTruthy();
      expect(b.textures.bottom).toBeTruthy();
      expect(b.textures.side).toBeTruthy();
    }
  });
});

describe('item registry', () => {
  test('every placeable block has a matching item', () => {
    const stoneItem = getItem(B.STONE);
    expect(isBlockItem(stoneItem.id)).toBe(true);
    expect(stoneItem.blockId).toBe(B.STONE);
    expect(stoneItem.maxStack).toBe(64);
  });

  test('tools stack to one and have durability', () => {
    const pick = getItem(I.WOODEN_PICKAXE);
    expect(pick.maxStack).toBe(1);
    expect(pick.tool).toEqual({ type: 'pickaxe', tier: 0, speed: 2 });
    expect(pick.durability).toBe(59);
    expect(getItem(I.DIAMOND_PICKAXE).durability).toBe(1561);
    expect(getItem(I.NETHERITE_PICKAXE).tool?.tier).toBe(4);
  });

  test('swords deal more damage than fists', () => {
    expect(getItem(I.IRON_SWORD).attackDamage).toBeGreaterThan(getItem(I.STICK).attackDamage);
  });

  test('food restores hunger', () => {
    expect(getItem(I.APPLE).food?.hunger).toBe(4);
    expect(getItem(I.COOKED_PORKCHOP).food?.hunger).toBe(8);
    expect(getItem(I.STICK).food).toBeUndefined();
  });

  test('non-block items are not placeable', () => {
    expect(isBlockItem(I.STICK)).toBe(false);
    expect(getItem(I.STICK).blockId).toBeUndefined();
  });

  test('items can be found by key and keys are unique', () => {
    expect(itemByKey('diamond')?.id).toBe(I.DIAMOND);
    const items = allItems();
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });

  test('air has no item form in the item list', () => {
    expect(allItems().some((i) => i.key === 'air')).toBe(false);
  });
});
