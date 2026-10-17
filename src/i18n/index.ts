import { itemTranslationKey } from '../core/items';
import en from './locales/en';
import de from './locales/de';
import az from './locales/az';
import ru from './locales/ru';

export type LocaleCode = 'en' | 'de' | 'az' | 'ru';
export type Dictionary = Record<string, string>;

export const LOCALES: { code: LocaleCode; nativeName: string }[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'az', nativeName: 'Azərbaycanca' },
  { code: 'ru', nativeName: 'Русский' },
];

const BUILTIN: Record<LocaleCode, Dictionary> = { en, de, az, ru };

export function isLocale(code: string): code is LocaleCode {
  return LOCALES.some((l) => l.code === code);
}

export function detectLocale(languages: readonly string[]): LocaleCode {
  for (const lang of languages) {
    const base = lang.toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

export class I18n {
  private current: LocaleCode;
  private readonly dicts: Record<LocaleCode, Dictionary>;
  private readonly listeners: ((code: LocaleCode) => void)[] = [];

  constructor(locale: LocaleCode = 'en', overrides: Partial<Record<LocaleCode, Dictionary>> = {}) {
    this.dicts = { ...BUILTIN, ...overrides };
    this.current = isLocale(locale) ? locale : 'en';
  }

  get locale(): LocaleCode {
    return this.current;
  }

  setLocale(code: LocaleCode): void {
    if (!isLocale(code) || code === this.current) return;
    this.current = code;
    for (const l of this.listeners) l(code);
  }

  onChange(listener: (code: LocaleCode) => void): void {
    this.listeners.push(listener);
  }

  t(key: string, params?: Record<string, string | number>): string {
    let s = this.dicts[this.current]?.[key] ?? this.dicts.en[key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
    return s;
  }

  itemName(id: number): string {
    return this.t(itemTranslationKey(id));
  }
}

/** Shared app-wide instance. */
export const i18n = new I18n();
export const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);
