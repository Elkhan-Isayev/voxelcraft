import { isLocale, type LocaleCode } from '../i18n';
import type { KeyValueStorage } from './save';

export interface Settings {
  renderDistance: number;
  fov: number;
  sensitivity: number;
  volume: number;
  music: number;
  invertY: boolean;
  showFps: boolean;
  locale: LocaleCode;
}

export const DEFAULT_SETTINGS: Settings = {
  renderDistance: 6,
  fov: 75,
  sensitivity: 100,
  volume: 60,
  music: 50,
  invertY: false,
  showFps: false,
  locale: 'en',
};

const RANGES: Record<'renderDistance' | 'fov' | 'sensitivity' | 'volume' | 'music', [number, number]> = {
  renderDistance: [2, 16],
  fov: [50, 110],
  sensitivity: [10, 200],
  volume: [0, 100],
  music: [0, 100],
};

const KEY = 'voxelcraft.settings';

export function loadSettings(storage: KeyValueStorage, fallbackLocale: LocaleCode): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, locale: fallbackLocale };
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(storage.getItem(KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') raw = parsed;
  } catch {
    return s;
  }
  for (const [key, [min, max]] of Object.entries(RANGES) as [keyof typeof RANGES, [number, number]][]) {
    const v = raw[key];
    if (typeof v === 'number' && Number.isFinite(v)) s[key] = Math.min(max, Math.max(min, Math.round(v)));
  }
  if (typeof raw.invertY === 'boolean') s.invertY = raw.invertY;
  if (typeof raw.showFps === 'boolean') s.showFps = raw.showFps;
  if (typeof raw.locale === 'string' && isLocale(raw.locale)) s.locale = raw.locale;
  return s;
}

export function saveSettings(storage: KeyValueStorage, s: Settings): void {
  try {
    storage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Settings are a convenience; ignore storage failures.
  }
}
