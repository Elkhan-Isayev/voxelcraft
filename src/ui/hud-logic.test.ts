import { I } from '../core/items';
import { B } from '../core/blocks';
import { I18n } from '../i18n';
import { statusIcons, bubbleCount, facing, itemTooltip, deathMessage } from './hud-logic';

describe('HUD logic', () => {
  test('health/hunger as 10 full/half/empty icons', () => {
    expect(statusIcons(20)).toEqual(new Array(10).fill('full'));
    expect(statusIcons(7)).toEqual(['full', 'full', 'full', 'half', ...new Array(6).fill('empty')]);
    expect(statusIcons(0)).toEqual(new Array(10).fill('empty'));
  });

  test('air bubbles are only shown while under water', () => {
    expect(bubbleCount(300)).toBe(0);
    expect(bubbleCount(299)).toBe(10);
    expect(bubbleCount(150)).toBe(5);
    expect(bubbleCount(0)).toBe(0);
  });

  test('facing direction from yaw (yaw 0 looks north, toward -Z)', () => {
    expect(facing(0)).toBe('north');
    expect(facing(Math.PI)).toBe('south');
    expect(facing(Math.PI / 2)).toBe('west');
    expect(facing(-Math.PI / 2)).toBe('east');
    expect(facing(2 * Math.PI + 0.1)).toBe('north');
  });

  test('tooltips show the localized name, durability and food value', () => {
    const i18n = new I18n('de');
    expect(itemTooltip(i18n, { id: B.STONE, count: 1 })).toEqual(['Stein']);
    expect(itemTooltip(i18n, { id: I.IRON_PICKAXE, count: 1, damage: 50 })).toEqual(['Eisenspitzhacke', 'Haltbarkeit: 200 / 250']);
    expect(itemTooltip(i18n, { id: I.APPLE, count: 1 })).toEqual(['Apfel', 'Stellt 4 Hunger wieder her']);
  });

  test('death messages translate the mob name too', () => {
    const i18n = new I18n('ru');
    expect(deathMessage(i18n, 'death.mob', { mob: 'mob.zombie' })).toBe('Вас убил моб: Зомби');
    expect(deathMessage(new I18n('en'), 'death.fall', {})).toBe('You hit the ground too hard');
  });
});
