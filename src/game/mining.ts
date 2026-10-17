import { getBlock } from '../core/blocks';
import { getItem, itemByKey } from '../core/items';
import type { ItemStack } from './inventory';

function toolFor(itemId: number | null) {
  if (itemId === null) return undefined;
  return getItem(itemId).tool;
}

/** Whether mining this block with this item yields drops. */
export function canHarvest(blockId: number, itemId: number | null): boolean {
  const block = getBlock(blockId);
  if (!block.requiresTool) return true;
  const tool = toolFor(itemId);
  return !!tool && tool.type === block.tool && tool.tier >= block.minTier;
}

/** Seconds needed to break a block, using Minecraft's per-tick damage formula. */
export function breakTime(blockId: number, itemId: number | null): number {
  const block = getBlock(blockId);
  if (block.hardness < 0) return Infinity;
  if (block.hardness === 0) return 0;
  const tool = toolFor(itemId);
  const speed = tool && tool.type === block.tool ? tool.speed : 1;
  const damagePerTick = speed / block.hardness / (canHarvest(blockId, itemId) ? 30 : 100);
  if (damagePerTick >= 1) return 0;
  return Math.ceil(1 / damagePerTick - 1e-9) / 20;
}

export function getDrops(blockId: number, itemId: number | null, rng: () => number): ItemStack[] {
  const block = getBlock(blockId);
  if (!canHarvest(blockId, itemId)) return [];
  const drops: ItemStack[] = [];
  if (block.drop !== null) {
    const key = block.drop ?? block.key;
    const item = itemByKey(key);
    if (item) {
      const [min, max] = block.dropCount ?? [1, 1];
      drops.push({ id: item.id, count: min + Math.floor(rng() * (max - min + 1)) });
    }
  }
  for (const extra of block.extraDrops ?? []) {
    if (rng() < extra.chance) {
      const item = itemByKey(extra.key);
      if (item) drops.push({ id: item.id, count: 1 });
    }
  }
  return drops;
}
