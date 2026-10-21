import * as THREE from 'three';
import { B } from '../core/blocks';
import { I } from '../core/items';
import { handMatrix, heldKind, HandAnimator, extrudeSprite, SWING_SECONDS, REST, type HandState } from './hand-pose';

const rest: HandState = { ...REST };
const point = (m: THREE.Matrix4, x: number, y: number, z = 0) => new THREE.Vector3(x, y, z).applyMatrix4(m);

describe('held item kinds', () => {
  test('classifies what is in the hand', () => {
    expect(heldKind(null)).toBe('empty');
    expect(heldKind(B.STONE)).toBe('block');
    expect(heldKind(B.TORCH)).toBe('item');
    expect(heldKind(B.POPPY)).toBe('item');
    expect(heldKind(I.DIAMOND_SWORD)).toBe('tool');
    expect(heldKind(I.IRON_PICKAXE)).toBe('tool');
    expect(heldKind(I.APPLE)).toBe('item');
  });
});

describe('hand pose', () => {
  test('a tool rests in the lower right with the handle in the hand and the head up and away', () => {
    const m = handMatrix('tool', rest);
    const handle = point(m, -0.45, -0.45);
    const tip = point(m, 0.45, 0.45);
    expect(handle.x).toBeGreaterThan(0.2);
    expect(handle.y).toBeLessThan(-0.2);
    expect(handle.z).toBeLessThan(-0.3);
    expect(tip.y).toBeGreaterThan(handle.y + 0.2);
    expect(tip.x).toBeLessThan(handle.x);
    expect(tip.z).toBeLessThan(handle.z);
  });

  test('blocks and the bare arm also sit in the lower right of the view', () => {
    for (const kind of ['block', 'item', 'empty'] as const) {
      const c = point(handMatrix(kind, rest), 0, 0);
      expect(c.x, kind).toBeGreaterThan(0.15);
      expect(c.y, kind).toBeLessThan(-0.15);
      expect(c.z, kind).toBeLessThan(-0.3);
    }
  });

  test('swinging lunges toward the centre and chops downward, then returns', () => {
    const tipRest = point(handMatrix('tool', rest), 0.45, 0.45);
    const mid = point(handMatrix('tool', { ...rest, swing: 0.3 }), 0.45, 0.45);
    expect(mid.x).toBeLessThan(tipRest.x);
    expect(mid.y).toBeLessThan(tipRest.y);
    const end = point(handMatrix('tool', { ...rest, swing: 1 }), 0.45, 0.45);
    expect(end.distanceTo(tipRest)).toBeLessThan(1e-6);
  });

  test('switching items lowers the hand out of view', () => {
    const up = point(handMatrix('item', rest), 0, 0);
    const down = point(handMatrix('item', { ...rest, equip: 1 }), 0, 0);
    expect(up.y - down.y).toBeCloseTo(0.6, 5);
  });

  test('eating raises the food toward the mouth', () => {
    const up = point(handMatrix('item', rest), 0, 0);
    const eating = point(handMatrix('item', { ...rest, eat: 1 }), 0, 0);
    expect(eating.x).toBeLessThan(up.x);
    expect(eating.y).toBeGreaterThan(up.y);
  });
});

describe('HandAnimator', () => {
  test('a swing takes 0.3 seconds', () => {
    const a = new HandAnimator();
    a.update(0.01, 'pick', false);
    a.swing();
    expect(a.update(SWING_SECONDS / 2, 'pick', false).state.swing).toBeCloseTo(0.5, 1);
    expect(a.update(SWING_SECONDS, 'pick', false).state.swing).toBe(0);
  });

  test('holding the mouse while mining keeps swinging', () => {
    const a = new HandAnimator();
    a.update(0.01, 'pick', false);
    let swinging = 0;
    for (let i = 0; i < 60; i++) if (a.update(0.02, 'pick', true).state.swing > 0) swinging++;
    expect(swinging).toBeGreaterThan(50);
  });

  test('changing the held item lowers the old one, swaps at the bottom, then raises the new one', () => {
    const a = new HandAnimator();
    a.update(0.01, 'sword', false);
    let f = a.update(0.05, 'apple', false);
    expect(f.shown).toBe('sword');
    expect(f.state.equip).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) f = a.update(0.05, 'apple', false);
    expect(f.shown).toBe('apple');
    for (let i = 0; i < 10; i++) f = a.update(0.05, 'apple', false);
    expect(f.state.equip).toBe(0);
  });

  test('eating animates for a moment', () => {
    const a = new HandAnimator();
    a.update(0.01, 'apple', false);
    a.eat();
    expect(a.update(0.1, 'apple', false).state.eat).toBeGreaterThan(0.5);
    let s = a.update(0.1, 'apple', false).state;
    for (let i = 0; i < 20; i++) s = a.update(0.1, 'apple', false).state;
    expect(s.eat).toBe(0);
  });
});

describe('extrudeSprite', () => {
  const sprite = (pixels: [number, number][]) => {
    const set = new Set(pixels.map(([x, y]) => `${x},${y}`));
    return (x: number, y: number) => set.has(`${x},${y}`);
  };

  test('a single pixel gets four side walls', () => {
    expect(extrudeSprite(sprite([[5, 5]]))).toHaveLength(4);
  });

  test('walls only appear where an opaque pixel borders a transparent one', () => {
    const square: [number, number][] = [];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) square.push([x, y]);
    const walls = extrudeSprite(sprite(square));
    expect(walls).toHaveLength(12);
    expect(walls.some((w) => w.x === 1 && w.y === 1)).toBe(false);
  });

  test('pixels on the tile border get walls on the outside', () => {
    expect(extrudeSprite(sprite([[0, 0]])).map((w) => w.dir).sort()).toEqual(['down', 'left', 'right', 'up']);
  });
});
