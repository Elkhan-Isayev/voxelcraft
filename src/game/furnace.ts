import { B } from '../core/blocks';
import { I, getItem } from '../core/items';
import type { ItemStack, Slot } from './inventory';

export const COOK_TICKS = 200;

const SMELTING = new Map<number, number>([
  [I.RAW_IRON, I.IRON_INGOT],
  [I.RAW_GOLD, I.GOLD_INGOT],
  [I.RAW_COPPER, I.COPPER_INGOT],
  [B.IRON_ORE, I.IRON_INGOT],
  [B.DEEPSLATE_IRON_ORE, I.IRON_INGOT],
  [B.GOLD_ORE, I.GOLD_INGOT],
  [B.COPPER_ORE, I.COPPER_INGOT],
  [B.SAND, B.GLASS],
  [B.COBBLESTONE, B.STONE],
  [B.COBBLED_DEEPSLATE, B.DEEPSLATE],
  [B.CLAY, B.BRICKS],
  [I.CLAY_BALL, I.BRICK],
  [B.OAK_LOG, I.CHARCOAL],
  [B.BIRCH_LOG, I.CHARCOAL],
  [B.SPRUCE_LOG, I.CHARCOAL],
  [B.CHERRY_LOG, I.CHARCOAL],
  [I.PORKCHOP, I.COOKED_PORKCHOP],
  [I.BEEF, I.COOKED_BEEF],
  [I.MUTTON, I.COOKED_MUTTON],
]);

const FUEL = new Map<number, number>([
  [I.COAL, 1600],
  [I.CHARCOAL, 1600],
  [B.COAL_BLOCK, 16000],
  [B.OAK_PLANKS, 300],
  [B.BIRCH_PLANKS, 300],
  [B.SPRUCE_PLANKS, 300],
  [B.CHERRY_PLANKS, 300],
  [B.OAK_LOG, 300],
  [B.BIRCH_LOG, 300],
  [B.SPRUCE_LOG, 300],
  [B.CHERRY_LOG, 300],
  [B.CRAFTING_TABLE, 300],
  [B.CHEST, 300],
  [B.BOOKSHELF, 300],
  [I.STICK, 100],
  [I.WOODEN_PICKAXE, 200],
  [I.WOODEN_AXE, 200],
  [I.WOODEN_SHOVEL, 200],
  [I.WOODEN_SWORD, 200],
]);

export function smeltingResult(id: number): number | undefined {
  return SMELTING.get(id);
}

export function fuelTicks(id: number): number {
  return FUEL.get(id) ?? 0;
}

export interface FurnaceData {
  input: Slot;
  fuel: Slot;
  output: Slot;
  burnTime: number;
  burnTotal: number;
  cookTime: number;
}

export class Furnace {
  input: Slot = null;
  fuel: Slot = null;
  output: Slot = null;
  burnTime = 0;
  burnTotal = 0;
  cookTime = 0;

  /** Slots in UI order: input, fuel, output. */
  get slots(): Slot[] {
    return [this.input, this.fuel, this.output];
  }

  set slots(s: Slot[]) {
    [this.input, this.fuel, this.output] = s;
  }

  isBurning(): boolean {
    return this.burnTime > 0;
  }

  private canSmelt(): boolean {
    if (!this.input) return false;
    const result = smeltingResult(this.input.id);
    if (result === undefined) return false;
    if (!this.output) return true;
    return this.output.id === result && this.output.count < getItem(result).maxStack;
  }

  tick(ticks = 1): void {
    for (let t = 0; t < ticks; t++) this.tickOnce();
  }

  private tickOnce(): void {
    const smeltable = this.canSmelt();
    if (this.burnTime <= 0 && smeltable && this.fuel) {
      const ft = fuelTicks(this.fuel.id);
      if (ft > 0) {
        this.burnTime = this.burnTotal = ft;
        this.fuel = take(this.fuel);
      }
    }
    if (this.burnTime > 0) {
      this.burnTime--;
      if (smeltable) {
        this.cookTime++;
        if (this.cookTime >= COOK_TICKS) {
          this.cookTime = 0;
          this.finishItem();
        }
      } else {
        this.cookTime = 0;
      }
    } else if (this.cookTime > 0) {
      this.cookTime = Math.max(0, this.cookTime - 2);
    }
  }

  private finishItem(): void {
    const result = smeltingResult(this.input!.id)!;
    this.input = take(this.input!);
    if (this.output) this.output.count++;
    else this.output = { id: result, count: 1 };
  }

  cookProgress(): number {
    return this.cookTime / COOK_TICKS;
  }

  burnProgress(): number {
    return this.burnTotal > 0 ? this.burnTime / this.burnTotal : 0;
  }

  toJSON(): FurnaceData {
    return {
      input: this.input,
      fuel: this.fuel,
      output: this.output,
      burnTime: this.burnTime,
      burnTotal: this.burnTotal,
      cookTime: this.cookTime,
    };
  }

  static fromJSON(d: FurnaceData): Furnace {
    const f = new Furnace();
    Object.assign(f, d);
    return f;
  }
}

function take(s: ItemStack): Slot {
  return s.count > 1 ? { ...s, count: s.count - 1 } : null;
}
