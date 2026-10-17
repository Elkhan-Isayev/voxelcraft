import { I } from '../core/items';
import { createStats, tickStats, damage, eat, fallDamage, addExhaustion, MAX_AIR, heal } from './survival';
import { daylight, skyColor, formatClock, isNight, celestialAngle } from './daycycle';

const dry = { headInWater: false };

describe('survival stats', () => {
  test('starts healthy and fed', () => {
    const s = createStats();
    expect(s.health).toBe(20);
    expect(s.food).toBe(20);
    expect(s.air).toBe(MAX_AIR);
  });

  test('fall damage starts after 3 blocks', () => {
    expect(fallDamage(3)).toBe(0);
    expect(fallDamage(4)).toBe(1);
    expect(fallDamage(10)).toBe(7);
  });

  test('damage reduces health and reports death', () => {
    const s = createStats();
    expect(damage(s, 5)).toBe(false);
    expect(s.health).toBe(15);
    expect(damage(s, 100)).toBe(true);
    expect(s.health).toBe(0);
  });

  test('exhaustion drains saturation first, then food', () => {
    const s = createStats();
    s.saturation = 1;
    addExhaustion(s, 4);
    tickStats(s, dry, 1);
    expect(s.saturation).toBe(0);
    expect(s.food).toBe(20);
    addExhaustion(s, 4);
    tickStats(s, dry, 1);
    expect(s.food).toBe(19);
  });

  test('a well-fed player regenerates health, a starving one takes damage', () => {
    const s = createStats();
    s.health = 10;
    tickStats(s, dry, 80);
    expect(s.health).toBe(11);

    const hungry = createStats();
    hungry.food = 0;
    hungry.saturation = 0;
    tickStats(hungry, dry, 80);
    expect(hungry.health).toBe(19);
  });

  test('starvation on normal difficulty does not kill below half a heart', () => {
    const s = createStats();
    s.food = 0;
    s.saturation = 0;
    s.health = 1;
    tickStats(s, dry, 800);
    expect(s.health).toBe(1);
  });

  test('eating restores food and saturation, capped at 20', () => {
    const s = createStats();
    s.food = 10;
    s.saturation = 0;
    expect(eat(s, I.COOKED_PORKCHOP)).toBe(true);
    expect(s.food).toBe(18);
    expect(s.saturation).toBeCloseTo(12.8);
    eat(s, I.COOKED_PORKCHOP);
    expect(s.food).toBe(20);
    expect(eat(s, I.STICK)).toBe(false);
  });

  test('underwater the air supply runs out and then the player drowns', () => {
    const s = createStats();
    tickStats(s, { headInWater: true }, MAX_AIR);
    expect(s.air).toBe(0);
    expect(s.health).toBe(20);
    tickStats(s, { headInWater: true }, 20);
    expect(s.health).toBe(18);
    tickStats(s, dry, 200);
    expect(s.air).toBe(MAX_AIR);
  });

  test('healing never exceeds max health', () => {
    const s = createStats();
    s.health = 19;
    heal(s, 5);
    expect(s.health).toBe(20);
  });
});

describe('day/night cycle', () => {
  test('noon is bright and midnight is dark', () => {
    expect(daylight(6000)).toBe(1);
    expect(daylight(18000)).toBeLessThan(0.3);
    expect(isNight(18000)).toBe(true);
    expect(isNight(6000)).toBe(false);
  });

  test('daylight changes smoothly at dusk and wraps around', () => {
    for (let t = 0; t < 24000; t += 50) {
      expect(Math.abs(daylight(t + 50) - daylight(t))).toBeLessThan(0.05);
    }
    expect(daylight(24000 + 6000)).toBe(daylight(6000));
  });

  test('sky is blue at noon and dark at night', () => {
    const noon = skyColor(6000);
    const night = skyColor(18000);
    expect(noon[2]).toBeGreaterThan(noon[0]);
    expect(night[0] + night[1] + night[2]).toBeLessThan(noon[0] + noon[1] + noon[2]);
  });

  test('clock shows Minecraft time (tick 0 = 06:00)', () => {
    expect(formatClock(0)).toBe('06:00');
    expect(formatClock(6000)).toBe('12:00');
    expect(formatClock(18000)).toBe('00:00');
    expect(formatClock(1000 + 24000)).toBe('07:00');
  });

  test('the sun is overhead at noon', () => {
    expect(celestialAngle(6000)).toBeCloseTo(Math.PI / 2);
    expect(celestialAngle(0)).toBeCloseTo(0);
  });
});
