import { allItems, getItem } from '../core/items';
import { findRecipe, craftOnce } from '../game/crafting';
import { fuelTicks, smeltingResult } from '../game/furnace';
import { addToSlots, quickMove, type Inventory, type ItemStack, type Slot } from '../game/inventory';
import type { OpenContainer } from '../game/session';
import type { I18n } from '../i18n';

/** Shift-click on a player inventory slot: routes the stack to the most sensible place. */
export function shiftClickInventory(inv: Slot[], i: number, open: OpenContainer | null): void {
  const s = inv[i];
  if (!s) return;
  if (open?.type === 'chest') {
    quickMove(inv, i, open.slots);
    return;
  }
  if (open?.type === 'furnace') {
    const f = open.furnace;
    const slots = f.slots;
    const target = smeltingResult(s.id) !== undefined ? 0 : fuelTicks(s.id) > 0 ? 1 : -1;
    if (target >= 0) {
      const left = addToSlots(slots, s, target, target + 1);
      f.slots = slots;
      inv[i] = left > 0 ? { ...s, count: left } : null;
      return;
    }
  }
  if (i < 9) quickMove(inv, i, inv, 9, 36);
  else quickMove(inv, i, inv, 0, 9);
}

/** Moves a container slot's stack into the player inventory. */
export function shiftClickContainer(from: Slot[], i: number, inv: Slot[]): void {
  quickMove(from, i, inv);
}

/**
 * Takes the crafting result. Normal click puts one craft on the cursor (stacking if possible);
 * shift-click crafts repeatedly straight into the inventory.
 */
export function takeCraftResult(grid: Slot[], width: number, cursor: Slot, shift: boolean, inv: Inventory): Slot {
  if (shift) {
    for (let n = 0; n < 64; n++) {
      const r = findRecipe(grid, width);
      if (!r) break;
      const probe = inv.slots.map((s) => (s ? { ...s } : null));
      if (addToSlots(probe, r.result) > 0) break;
      const out = craftOnce(grid, width)!;
      inv.add(out);
    }
    return cursor;
  }
  const r = findRecipe(grid, width);
  if (!r) return cursor;
  const result = r.result;
  if (!cursor) return craftOnce(grid, width);
  if (cursor.id === result.id && cursor.count + result.count <= getItem(result.id).maxStack) {
    craftOnce(grid, width);
    return { ...cursor, count: cursor.count + result.count };
  }
  return cursor;
}

export function craftPreview(grid: Slot[], width: number): ItemStack | null {
  const r = findRecipe(grid, width);
  return r ? { ...r.result } : null;
}

/** Items shown in the creative inventory, filtered by the localized name or internal key. */
export function paletteItems(i18n: I18n, query: string): number[] {
  const q = query.trim().toLocaleLowerCase(i18n.locale);
  return allItems()
    .filter((it) => {
      if (!q) return true;
      return i18n.itemName(it.id).toLocaleLowerCase(i18n.locale).includes(q) || it.key.includes(q.replace(/\s+/g, '_'));
    })
    .map((it) => it.id);
}
