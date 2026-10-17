import { getItem, hasItem } from '../core/items';

export const MAX_HEALTH = 20;
export const MAX_FOOD = 20;
export const MAX_AIR = 300;

export interface Stats {
  health: number;
  food: number;
  saturation: number;
  exhaustion: number;
  air: number;
  /** Ticks counted toward the next regeneration / starvation / drowning event. */
  foodTimer: number;
  drownTimer: number;
}

export interface StatsEnvironment {
  headInWater: boolean;
}

export function createStats(): Stats {
  return { health: MAX_HEALTH, food: MAX_FOOD, saturation: 5, exhaustion: 0, air: MAX_AIR, foodTimer: 0, drownTimer: 0 };
}

export function fallDamage(distance: number): number {
  return Math.max(0, Math.ceil(distance - 3 - 1e-6));
}

/** Applies damage. Returns true if the player died. */
export function damage(s: Stats, amount: number): boolean {
  s.health = Math.max(0, s.health - amount);
  return s.health <= 0;
}

export function heal(s: Stats, amount: number): void {
  s.health = Math.min(MAX_HEALTH, s.health + amount);
}

export function addExhaustion(s: Stats, amount: number): void {
  s.exhaustion = Math.min(40, s.exhaustion + amount);
}

/** Eats a food item. Returns false if the item is not edible. */
export function eat(s: Stats, itemId: number): boolean {
  if (!hasItem(itemId)) return false;
  const food = getItem(itemId).food;
  if (!food) return false;
  s.food = Math.min(MAX_FOOD, s.food + food.hunger);
  s.saturation = Math.min(s.food, s.saturation + food.saturation);
  return true;
}

/** Advances stats by game ticks (20 per second). Returns damage taken this call. */
export function tickStats(s: Stats, env: StatsEnvironment, ticks = 1): number {
  let taken = 0;
  for (let t = 0; t < ticks; t++) {
    // Hunger
    if (s.exhaustion >= 4) {
      s.exhaustion -= 4;
      if (s.saturation > 0) s.saturation = Math.max(0, s.saturation - 1);
      else s.food = Math.max(0, s.food - 1);
    }
    s.foodTimer++;
    if (s.food >= 18 && s.health < MAX_HEALTH) {
      if (s.foodTimer >= 80) {
        heal(s, 1);
        addExhaustion(s, 6);
        s.foodTimer = 0;
      }
    } else if (s.food <= 0) {
      if (s.foodTimer >= 80) {
        if (s.health > 1) {
          damage(s, 1);
          taken += 1;
        }
        s.foodTimer = 0;
      }
    } else {
      s.foodTimer = 0;
    }

    // Breathing
    if (env.headInWater) {
      if (s.air > 0) s.air--;
      else {
        s.drownTimer++;
        if (s.drownTimer >= 20) {
          s.drownTimer = 0;
          damage(s, 2);
          taken += 2;
        }
      }
    } else {
      s.drownTimer = 0;
      s.air = Math.min(MAX_AIR, s.air + 5);
    }
  }
  return taken;
}
