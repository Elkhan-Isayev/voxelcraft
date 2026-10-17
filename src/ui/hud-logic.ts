import { getItem } from '../core/items';
import type { I18n } from '../i18n';
import type { ItemStack } from '../game/inventory';
import { MAX_AIR } from '../game/survival';

export type IconState = 'full' | 'half' | 'empty';

/** Splits a 0..20 value into 10 icons, Minecraft style. */
export function statusIcons(value: number, max = 20): IconState[] {
  const out: IconState[] = [];
  const v = Math.max(0, Math.ceil(value));
  for (let i = 0; i < max / 2; i++) {
    const left = v - i * 2;
    out.push(left >= 2 ? 'full' : left === 1 ? 'half' : 'empty');
  }
  return out;
}

export function bubbleCount(air: number): number {
  if (air >= MAX_AIR) return 0;
  return Math.max(0, Math.ceil((air / MAX_AIR) * 10));
}

export type Facing = 'north' | 'south' | 'east' | 'west';

/** Yaw 0 looks toward -Z (north); positive yaw turns left (toward -X, west). */
export function facing(yaw: number): Facing {
  const a = ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const sector = Math.round(a / (Math.PI / 2)) % 4;
  return (['north', 'west', 'south', 'east'] as const)[sector];
}

export function itemTooltip(i18n: I18n, stack: ItemStack): string[] {
  const def = getItem(stack.id);
  const lines = [i18n.itemName(stack.id)];
  if (def.durability) lines.push(i18n.t('ui.durability', { current: def.durability - (stack.damage ?? 0), max: def.durability }));
  if (def.food) lines.push(i18n.t('ui.restoresHunger', { value: def.food.hunger }));
  return lines;
}

/** Resolves a death message; parameter values that are translation keys are translated too. */
export function deathMessage(i18n: I18n, key: string, params: Record<string, string>): string {
  const resolved: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) resolved[k] = i18n.t(v);
  return i18n.t(key, resolved);
}
