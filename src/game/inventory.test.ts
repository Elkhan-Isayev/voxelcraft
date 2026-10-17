import { B } from '../core/blocks';
import { I } from '../core/items';
import { Inventory, clickSlot, quickMove, type Slot } from './inventory';

describe('Inventory', () => {
  test('has 36 slots, the first 9 being the hotbar', () => {
    const inv = new Inventory();
    expect(inv.slots.length).toBe(36);
    expect(inv.hotbar().length).toBe(9);
  });

  test('adding items fills the hotbar first and stacks up to 64', () => {
    const inv = new Inventory();
    expect(inv.add({ id: B.DIRT, count: 100 })).toBe(0);
    expect(inv.slots[0]).toEqual({ id: B.DIRT, count: 64 });
    expect(inv.slots[1]).toEqual({ id: B.DIRT, count: 36 });
    expect(inv.count(B.DIRT)).toBe(100);
  });

  test('adding tops up existing stacks before using new slots', () => {
    const inv = new Inventory();
    inv.slots[5] = { id: B.STONE, count: 60 };
    inv.add({ id: B.STONE, count: 10 });
    expect(inv.slots[5]!.count).toBe(64);
    expect(inv.slots[0]).toEqual({ id: B.STONE, count: 6 });
  });

  test('tools never stack', () => {
    const inv = new Inventory();
    inv.add({ id: I.WOODEN_PICKAXE, count: 2 });
    expect(inv.slots[0]!.count).toBe(1);
    expect(inv.slots[1]!.count).toBe(1);
  });

  test('returns what does not fit', () => {
    const inv = new Inventory();
    inv.add({ id: B.DIRT, count: 64 * 36 });
    expect(inv.add({ id: B.STONE, count: 5 })).toBe(5);
  });

  test('removes items across stacks', () => {
    const inv = new Inventory();
    inv.add({ id: B.DIRT, count: 70 });
    expect(inv.remove(B.DIRT, 66)).toBe(true);
    expect(inv.count(B.DIRT)).toBe(4);
    expect(inv.remove(B.DIRT, 5)).toBe(false);
    expect(inv.count(B.DIRT)).toBe(4);
  });

  test('selecting a hotbar slot and consuming the held item', () => {
    const inv = new Inventory();
    inv.slots[2] = { id: B.TORCH, count: 2 };
    inv.select(2);
    expect(inv.selectedStack()?.id).toBe(B.TORCH);
    inv.consumeSelected();
    inv.consumeSelected();
    expect(inv.selectedStack()).toBeNull();
  });

  test('selection wraps around when scrolling', () => {
    const inv = new Inventory();
    inv.scroll(-1);
    expect(inv.selected).toBe(8);
    inv.scroll(1);
    expect(inv.selected).toBe(0);
  });

  test('tools wear out and break', () => {
    const inv = new Inventory();
    inv.slots[0] = { id: I.WOODEN_PICKAXE, count: 1 };
    for (let i = 0; i < 58; i++) expect(inv.damageSelected(1)).toBe(false);
    expect(inv.slots[0]!.damage).toBe(58);
    expect(inv.damageSelected(1)).toBe(true);
    expect(inv.slots[0]).toBeNull();
  });

  test('serializes and restores', () => {
    const inv = new Inventory();
    inv.add({ id: B.DIRT, count: 3 });
    inv.slots[10] = { id: I.IRON_PICKAXE, count: 1, damage: 4 };
    inv.select(4);
    const copy = Inventory.fromJSON(JSON.parse(JSON.stringify(inv.toJSON())));
    expect(copy.slots).toEqual(inv.slots);
    expect(copy.selected).toBe(4);
  });
});

describe('slot clicking (inventory screen)', () => {
  test('left click picks up a stack, then puts it down elsewhere', () => {
    const slots: Slot[] = [{ id: B.DIRT, count: 10 }, null];
    let cursor = clickSlot(slots, 0, null, 'left');
    expect(cursor).toEqual({ id: B.DIRT, count: 10 });
    expect(slots[0]).toBeNull();
    cursor = clickSlot(slots, 1, cursor, 'left');
    expect(cursor).toBeNull();
    expect(slots[1]).toEqual({ id: B.DIRT, count: 10 });
  });

  test('left click merges matching items up to the stack limit', () => {
    const slots: Slot[] = [{ id: B.DIRT, count: 60 }];
    const cursor = clickSlot(slots, 0, { id: B.DIRT, count: 10 }, 'left');
    expect(slots[0]!.count).toBe(64);
    expect(cursor).toEqual({ id: B.DIRT, count: 6 });
  });

  test('left click swaps different items', () => {
    const slots: Slot[] = [{ id: B.DIRT, count: 1 }];
    const cursor = clickSlot(slots, 0, { id: B.STONE, count: 2 }, 'left');
    expect(slots[0]).toEqual({ id: B.STONE, count: 2 });
    expect(cursor).toEqual({ id: B.DIRT, count: 1 });
  });

  test('right click picks up half, or places one', () => {
    const slots: Slot[] = [{ id: B.DIRT, count: 9 }, null];
    let cursor = clickSlot(slots, 0, null, 'right');
    expect(cursor).toEqual({ id: B.DIRT, count: 5 });
    expect(slots[0]!.count).toBe(4);
    cursor = clickSlot(slots, 1, cursor, 'right');
    expect(slots[1]).toEqual({ id: B.DIRT, count: 1 });
    expect(cursor!.count).toBe(4);
  });

  test('output-only slots can only be taken from', () => {
    const slots: Slot[] = [null];
    const cursor = clickSlot(slots, 0, { id: B.DIRT, count: 3 }, 'left', { takeOnly: true });
    expect(slots[0]).toBeNull();
    expect(cursor).toEqual({ id: B.DIRT, count: 3 });
  });

  test('quick move (shift-click) transfers a stack into another container', () => {
    const from: Slot[] = [{ id: B.DIRT, count: 20 }];
    const to: Slot[] = [{ id: B.DIRT, count: 50 }, null];
    quickMove(from, 0, to);
    expect(from[0]).toBeNull();
    expect(to[0]!.count).toBe(64);
    expect(to[1]).toEqual({ id: B.DIRT, count: 6 });
  });
});
