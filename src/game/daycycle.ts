import { DAY_LENGTH_TICKS } from '../core/constants';

export type RGB = [number, number, number];

const DUSK_START = 11500;
const DUSK_END = 13500;
const DAWN_START = 22500;
const NIGHT_LEVEL = 0.18;

export function timeOfDay(ticks: number): number {
  return ((ticks % DAY_LENGTH_TICKS) + DAY_LENGTH_TICKS) % DAY_LENGTH_TICKS;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Sky-light multiplier: 1 during the day, ~0.18 at night, smooth transitions. */
export function daylight(ticks: number): number {
  const t = timeOfDay(ticks);
  if (t < DUSK_START) return 1;
  if (t < DUSK_END) return 1 - (1 - NIGHT_LEVEL) * smooth((t - DUSK_START) / (DUSK_END - DUSK_START));
  if (t < DAWN_START) return NIGHT_LEVEL;
  return NIGHT_LEVEL + (1 - NIGHT_LEVEL) * smooth((t - DAWN_START) / (DAY_LENGTH_TICKS - DAWN_START));
}

export function isNight(ticks: number): boolean {
  return daylight(ticks) < 0.5;
}

const DAY_SKY: RGB = [0.47, 0.65, 1.0];
const NIGHT_SKY: RGB = [0.01, 0.015, 0.05];
const SUNSET: RGB = [0.98, 0.5, 0.25];

export function skyColor(ticks: number): RGB {
  const d = (daylight(ticks) - NIGHT_LEVEL) / (1 - NIGHT_LEVEL);
  const base: RGB = [0, 1, 2].map((i) => NIGHT_SKY[i] + (DAY_SKY[i] - NIGHT_SKY[i]) * d) as RGB;
  // Orange glow strongest halfway through dusk/dawn.
  const glow = Math.max(0, 1 - Math.abs(d - 0.5) * 2) * (d < 1 ? 0.6 : 0);
  return [0, 1, 2].map((i) => base[i] + (SUNSET[i] - base[i]) * glow) as RGB;
}

/** Sun angle above the horizon in radians: 0 at sunrise, PI/2 at noon, PI at sunset. */
export function celestialAngle(ticks: number): number {
  return (timeOfDay(ticks) / DAY_LENGTH_TICKS) * Math.PI * 2;
}

export function formatClock(ticks: number): string {
  const minutesTotal = Math.floor(((timeOfDay(ticks) / DAY_LENGTH_TICKS) * 24 * 60 + 6 * 60) % (24 * 60));
  const h = Math.floor(minutesTotal / 60);
  const m = minutesTotal % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
