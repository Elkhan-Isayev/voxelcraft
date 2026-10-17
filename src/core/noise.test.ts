import { createRng, hashSeed } from './rng';
import { createNoise2D, createNoise3D, fbm2D } from './noise';

describe('seeded RNG', () => {
  test('same seed produces the same sequence', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  test('different seeds diverge', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a()).not.toBe(b());
  });

  test('values are in [0, 1)', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('hashSeed turns text seeds into stable integers', () => {
    expect(hashSeed('minecraft')).toBe(hashSeed('minecraft'));
    expect(hashSeed('minecraft')).not.toBe(hashSeed('Minecraft'));
    expect(Number.isInteger(hashSeed('abc'))).toBe(true);
  });

  test('numeric text seeds are used as numbers', () => {
    expect(hashSeed('12345')).toBe(12345);
  });
});

describe('noise', () => {
  test('2D noise is deterministic per seed', () => {
    const n1 = createNoise2D(99);
    const n2 = createNoise2D(99);
    expect(n1(10.5, -3.25)).toBe(n2(10.5, -3.25));
  });

  test('2D noise differs between seeds', () => {
    const n1 = createNoise2D(1);
    const n2 = createNoise2D(2);
    let differences = 0;
    for (let i = 0; i < 20; i++) if (n1(i * 0.37, i * 0.11) !== n2(i * 0.37, i * 0.11)) differences++;
    expect(differences).toBeGreaterThan(15);
  });

  test('2D noise stays in [-1, 1] and actually varies', () => {
    const n = createNoise2D(5);
    let min = Infinity;
    let max = -Infinity;
    for (let x = 0; x < 100; x++) {
      for (let y = 0; y < 100; y++) {
        const v = n(x * 0.13, y * 0.17);
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(1);
  });

  test('2D noise is continuous (small steps -> small changes)', () => {
    const n = createNoise2D(3);
    for (let i = 0; i < 100; i++) {
      const x = i * 0.71;
      expect(Math.abs(n(x, 1) - n(x + 0.001, 1))).toBeLessThan(0.05);
    }
  });

  test('3D noise is deterministic and bounded', () => {
    const a = createNoise3D(11);
    const b = createNoise3D(11);
    for (let i = 0; i < 50; i++) {
      const v = a(i * 0.3, i * 0.2, i * 0.1);
      expect(v).toBe(b(i * 0.3, i * 0.2, i * 0.1));
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });

  test('fbm combines octaves and stays bounded', () => {
    const n = createNoise2D(8);
    for (let i = 0; i < 100; i++) {
      const v = fbm2D(n, i * 0.05, i * 0.03, 4);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });
});
