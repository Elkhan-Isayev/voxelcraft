import { LAVA_IDS, WATER_IDS } from './blocks';

export type FluidKind = 'water' | 'lava';

export interface FluidState {
  kind: FluidKind;
  /** 0 = source, 1-7 = flowing (higher = further from the source). */
  level: number;
  /** Falling fluid has the same fluid above it and renders as a full block. */
  falling: boolean;
}

export const MAX_FLUID_LEVEL = 7;
const FALLING_INDEX = 8;

const IDS: Record<FluidKind, readonly number[]> = { water: WATER_IDS, lava: LAVA_IDS };

// id -> packed state: 0 = not a fluid, otherwise (kind 1 water / 2 lava) << 4 | index
const STATE = new Uint8Array(256);
WATER_IDS.forEach((id, i) => (STATE[id] = (1 << 4) | i));
LAVA_IDS.forEach((id, i) => (STATE[id] = (2 << 4) | i));

export function fluidState(id: number): FluidState | null {
  const s = STATE[id];
  if (s === 0) return null;
  const index = s & 15;
  return {
    kind: s >> 4 === 1 ? 'water' : 'lava',
    level: index === FALLING_INDEX ? 0 : index,
    falling: index === FALLING_INDEX,
  };
}

export function fluidId(kind: FluidKind, level: number, falling = false): number {
  return IDS[kind][falling ? FALLING_INDEX : level];
}

export function isWater(id: number): boolean {
  return STATE[id] >> 4 === 1;
}

export function isLava(id: number): boolean {
  return STATE[id] >> 4 === 2;
}

export function isFluidSource(id: number): boolean {
  return STATE[id] !== 0 && (STATE[id] & 15) === 0;
}

/** True when both ids are the same kind of fluid (any level). */
export function sameFluid(a: number, b: number): boolean {
  return STATE[a] !== 0 && STATE[a] >> 4 === STATE[b] >> 4;
}

/** Height of the fluid surface inside its block, 0..1 (0 for non-fluids). */
export function fluidHeight(id: number): number {
  const s = STATE[id];
  if (s === 0) return 0;
  const index = s & 15;
  if (index === FALLING_INDEX) return 1;
  return (0.875 * (8 - index)) / 8;
}
