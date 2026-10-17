import { allBlocks } from '../core/blocks';
import { allItems, itemTranslationKey } from '../core/items';
import { BIOMES } from '../world/terrain';
import { I18n, LOCALES, detectLocale, type LocaleCode } from './index';
import en from './locales/en';
import de from './locales/de';
import az from './locales/az';
import ru from './locales/ru';

const dictionaries: Record<LocaleCode, Record<string, string>> = { en, de, az, ru };

describe('translations', () => {
  test('supports English, German, Azerbaijani and Russian', () => {
    expect(LOCALES.map((l) => l.code).sort()).toEqual(['az', 'de', 'en', 'ru']);
    expect(LOCALES.find((l) => l.code === 'az')?.nativeName).toBe('Azərbaycanca');
    expect(LOCALES.find((l) => l.code === 'ru')?.nativeName).toBe('Русский');
    expect(LOCALES.find((l) => l.code === 'de')?.nativeName).toBe('Deutsch');
  });

  test.each(['de', 'az', 'ru'] as const)('%s has exactly the same keys as English', (code) => {
    const missing = Object.keys(en).filter((k) => !(k in dictionaries[code]));
    const extra = Object.keys(dictionaries[code]).filter((k) => !(k in en));
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  test.each(['en', 'de', 'az', 'ru'] as const)('%s has no empty strings', (code) => {
    for (const [k, v] of Object.entries(dictionaries[code])) expect(v.trim(), k).not.toBe('');
  });

  test.each(['de', 'az', 'ru'] as const)('%s keeps the same {placeholders} as English', (code) => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(en)) expect(ph(dictionaries[code][k]), k).toEqual(ph(en[k]));
  });

  test('every block, item and biome has a name', () => {
    for (const b of allBlocks()) if (!b.noItem) expect(en[`block.${b.key}`], b.key).toBeTruthy();
    for (const i of allItems()) expect(en[itemTranslationKey(i.id)], i.key).toBeTruthy();
    for (const b of BIOMES) expect(en[`biome.${b}`], b).toBeTruthy();
  });

  test('items are actually translated, not copied from English', () => {
    expect(ru['block.stone']).toBe('Камень');
    expect(de['block.stone']).toBe('Stein');
    expect(az['block.stone']).toBe('Daş');
  });
});

describe('I18n', () => {
  test('translates and interpolates', () => {
    const i18n = new I18n('en');
    expect(i18n.t('block.dirt')).toBe('Dirt');
    expect(i18n.t('ui.day', { day: 3 })).toBe('Day 3');
    i18n.setLocale('ru');
    expect(i18n.t('ui.day', { day: 3 })).toBe('День 3');
  });

  test('falls back to English, then to the key itself', () => {
    const i18n = new I18n('de', { de: {} as Record<string, string> });
    expect(i18n.t('block.dirt')).toBe('Dirt');
    expect(i18n.t('no.such.key')).toBe('no.such.key');
  });

  test('notifies listeners when the language changes', () => {
    const i18n = new I18n('en');
    const seen: string[] = [];
    i18n.onChange((code) => seen.push(code));
    i18n.setLocale('az');
    expect(seen).toEqual(['az']);
    expect(i18n.locale).toBe('az');
  });

  test('ignores unknown locales', () => {
    const i18n = new I18n('en');
    i18n.setLocale('xx' as LocaleCode);
    expect(i18n.locale).toBe('en');
  });

  test('names any item id', () => {
    const i18n = new I18n('de');
    expect(i18n.itemName(1)).toBe('Stein');
  });
});

describe('detectLocale', () => {
  test('picks the first supported browser language', () => {
    expect(detectLocale(['de-DE', 'en'])).toBe('de');
    expect(detectLocale(['az-Latn-AZ'])).toBe('az');
    expect(detectLocale(['fr-FR', 'ru-RU'])).toBe('ru');
    expect(detectLocale(['fr-FR'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });
});
