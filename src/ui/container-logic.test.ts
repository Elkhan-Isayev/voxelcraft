import { B } from '../core/blocks';
import { I } from '../core/items';
import { Furnace } from '../game/furnace';
import { Inventory, type Slot } from '../game/inventory';
import { I18n } from '../i18n';
import { shiftClickInventory, takeCraftResult, paletteItems } from './container-logic';

describe('shift-click routing', () => {
  test('hotbar items go to the main inventory and back', () => {
    const inv = new Inventory();
    inv.slots[0] = { id: B.DIRT, count: 5 };
    shiftClickInventory(inv.slots, 0, null);
    expect(inv.slots[0]).toBeNull();
    expect(inv.slots[9]).toEqual({ id: B.DIRT, count: 5 });
    shiftClickInventory(inv.slots, 9, null);
    expect(inv.slots[0]).toEqual({ id: B.DIRT, count: 5 });
  });

  test('with a chest open, items move into the chest', () => {
    const inv = new Inventory();
    inv.slots[3] = { id: B.STONE, count: 10 };
    const chest: Slot[] = new Array(27).fill(null);
    shiftClickInventory(inv.slots, 3, { type: 'chest', slots: chest, key: '0,0,0' });
    expect(chest[0]).toEqual({ id: B.STONE, count: 10 });
    expect(inv.slots[3]).toBeNull();
  });

  test('with a furnace open, ores go to the input and coal to the fuel slot', () => {
    const inv = new Inventory();
    inv.slots[0] = { id: I.RAW_IRON, count: 3 };
    inv.slots[1] = { id: I.COAL, count: 2 };
    const furnace = new Furnace();
    const open = { type: 'furnace' as const, furnace, key: '0,0,0' };
    shiftClickInventory(inv.slots, 0, open);
    shiftClickInventory(inv.slots, 1, open);
    expect(furnace.input).toEqual({ id: I.RAW_IRON, count: 3 });
    expect(furnace.fuel).toEqual({ id: I.COAL, count: 2 });
  });
});

describe('taking crafting results', () => {
  test('click takes one result into the cursor and consumes ingredients', () => {
    const inv = new Inventory();
    const grid: Slot[] = [{ id: B.OAK_LOG, count: 2 }, null, null, null];
    const cursor = takeCraftResult(grid, 2, null, false, inv);
    expect(cursor).toEqual({ id: B.OAK_PLANKS, count: 4 });
    expect(grid[0]!.count).toBe(1);
  });

  test('clicking again stacks onto the cursor', () => {
    const inv = new Inventory();
    const grid: Slot[] = [{ id: B.OAK_LOG, count: 2 }, null, null, null];
    let cursor = takeCraftResult(grid, 2, null, false, inv);
    cursor = takeCraftResult(grid, 2, cursor, false, inv);
    expect(cursor).toEqual({ id: B.OAK_PLANKS, count: 8 });
    expect(grid[0]).toBeNull();
  });

  test('shift-click crafts as many as possible straight into the inventory', () => {
    const inv = new Inventory();
    const grid: Slot[] = [{ id: B.OAK_LOG, count: 5 }, null, null, null];
    const cursor = takeCraftResult(grid, 2, null, true, inv);
    expect(cursor).toBeNull();
    expect(inv.count(B.OAK_PLANKS)).toBe(20);
    expect(grid[0]).toBeNull();
  });

  test('nothing happens when the cursor holds something else', () => {
    const inv = new Inventory();
    const grid: Slot[] = [{ id: B.OAK_LOG, count: 1 }, null, null, null];
    const cursor = takeCraftResult(grid, 2, { id: B.DIRT, count: 1 }, false, inv);
    expect(cursor).toEqual({ id: B.DIRT, count: 1 });
    expect(grid[0]!.count).toBe(1);
  });
});

describe('creative palette search', () => {
  test('lists every obtainable item when the query is empty', () => {
    const all = paletteItems(new I18n('en'), '');
    expect(all).toContain(B.STONE);
    expect(all).toContain(I.DIAMOND_SWORD);
    expect(all).not.toContain(B.WATER);
  });

  test('searches localized names', () => {
    expect(paletteItems(new I18n('de'), 'stein')).toEqual(expect.arrayContaining([B.STONE, B.COBBLESTONE, B.SANDSTONE]));
    expect(paletteItems(new I18n('ru'), 'алмаз')).toEqual(expect.arrayContaining([I.DIAMOND, B.DIAMOND_ORE]));
    expect(paletteItems(new I18n('az'), 'qılınc')).toContain(I.IRON_SWORD);
    expect(paletteItems(new I18n('en'), 'zzzz')).toEqual([]);
  });
});
