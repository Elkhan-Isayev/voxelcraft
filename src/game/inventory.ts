import { getItem, hasItem } from '../core/items';

export interface ItemStack {
  id: number;
  count: number;
  /** Durability used up (tools only). */
  damage?: number;
}

export type Slot = ItemStack | null;

export const INVENTORY_SIZE = 36;
export const HOTBAR_SIZE = 9;

export function maxStackOf(id: number): number {
  return getItem(id).maxStack;
}

function sameItem(a: ItemStack, b: ItemStack): boolean {
  return a.id === b.id && (a.damage ?? 0) === (b.damage ?? 0) && maxStackOf(a.id) > 1;
}

/** Adds a stack into a slot range (topping up first, then empty slots). Returns leftover count. */
export function addToSlots(slots: Slot[], stack: ItemStack, from = 0, to = slots.length): number {
  let remaining = stack.count;
  const max = maxStackOf(stack.id);
  for (let i = from; i < to && remaining > 0; i++) {
    const s = slots[i];
    if (s && sameItem(s, stack) && s.count < max) {
      const n = Math.min(max - s.count, remaining);
      s.count += n;
      remaining -= n;
    }
  }
  for (let i = from; i < to && remaining > 0; i++) {
    if (slots[i]) continue;
    const n = Math.min(max, remaining);
    slots[i] = { id: stack.id, count: n, ...(stack.damage ? { damage: stack.damage } : {}) };
    remaining -= n;
  }
  return remaining;
}

export class Inventory {
  readonly slots: Slot[] = new Array(INVENTORY_SIZE).fill(null);
  selected = 0;

  hotbar(): Slot[] {
    return this.slots.slice(0, HOTBAR_SIZE);
  }

  add(stack: ItemStack): number {
    return addToSlots(this.slots, stack);
  }

  count(id: number): number {
    let n = 0;
    for (const s of this.slots) if (s?.id === id) n += s.count;
    return n;
  }

  remove(id: number, count: number): boolean {
    if (this.count(id) < count) return false;
    let left = count;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s?.id !== id) continue;
      const n = Math.min(s.count, left);
      s.count -= n;
      left -= n;
      if (s.count === 0) this.slots[i] = null;
    }
    return true;
  }

  select(i: number): void {
    this.selected = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
  }

  scroll(delta: number): void {
    this.select(this.selected + Math.sign(delta));
  }

  selectedStack(): Slot {
    return this.slots[this.selected];
  }

  consumeSelected(n = 1): void {
    const s = this.slots[this.selected];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
  }

  /** Wears the held tool. Returns true if it broke. */
  damageSelected(amount: number): boolean {
    const s = this.slots[this.selected];
    if (!s) return false;
    const durability = getItem(s.id).durability;
    if (!durability) return false;
    s.damage = (s.damage ?? 0) + amount;
    if (s.damage >= durability) {
      this.slots[this.selected] = null;
      return true;
    }
    return false;
  }

  clear(): void {
    this.slots.fill(null);
  }

  toJSON(): { slots: Slot[]; selected: number } {
    return { slots: this.slots.map((s) => (s ? { ...s } : null)), selected: this.selected };
  }

  static fromJSON(data: { slots: Slot[]; selected: number }): Inventory {
    const inv = new Inventory();
    data.slots.forEach((s, i) => {
      if (i < INVENTORY_SIZE) inv.slots[i] = s && hasItem(s.id) ? { ...s } : null;
    });
    inv.select(data.selected ?? 0);
    return inv;
  }
}

/**
 * Minecraft-style slot click. Mutates `slots` and returns the new cursor stack.
 * Left: pick up / place / merge / swap. Right: pick up half / place one.
 */
export function clickSlot(
  slots: Slot[],
  i: number,
  cursor: Slot,
  button: 'left' | 'right',
  opts: { takeOnly?: boolean } = {},
): Slot {
  const slot = slots[i];
  if (opts.takeOnly) {
    if (!slot) return cursor;
    if (!cursor) {
      slots[i] = null;
      return slot;
    }
    if (sameItem(cursor, slot) && cursor.count + slot.count <= maxStackOf(slot.id)) {
      slots[i] = null;
      return { ...cursor, count: cursor.count + slot.count };
    }
    return cursor;
  }

  if (!cursor) {
    if (!slot) return null;
    if (button === 'left') {
      slots[i] = null;
      return slot;
    }
    const take = Math.ceil(slot.count / 2);
    const rest = slot.count - take;
    slots[i] = rest > 0 ? { ...slot, count: rest } : null;
    return { ...slot, count: take };
  }

  if (!slot) {
    if (button === 'left') {
      slots[i] = cursor;
      return null;
    }
    slots[i] = { ...cursor, count: 1 };
    return cursor.count > 1 ? { ...cursor, count: cursor.count - 1 } : null;
  }

  if (sameItem(slot, cursor)) {
    const max = maxStackOf(slot.id);
    const n = Math.min(button === 'left' ? cursor.count : 1, max - slot.count);
    slot.count += n;
    const left = cursor.count - n;
    return left > 0 ? { ...cursor, count: left } : null;
  }

  slots[i] = cursor;
  return slot;
}

/** Shift-click: moves the whole stack from one slot list into another. */
export function quickMove(from: Slot[], i: number, to: Slot[], toStart = 0, toEnd = to.length): void {
  const s = from[i];
  if (!s) return;
  const left = addToSlots(to, s, toStart, toEnd);
  from[i] = left > 0 ? { ...s, count: left } : null;
}
