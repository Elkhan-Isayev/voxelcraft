import { MOB_DEFS, MOB_TYPES } from '../game/mobs';
import { TILE_NAMES } from './atlas';
import { mobParts, FRONT } from './mob-models';

describe('mob models', () => {
  test.each(MOB_TYPES)('%s has exactly one head that wears its face texture on the front', (type) => {
    const heads = mobParts(type).filter((p) => p.kind === 'head');
    expect(heads).toHaveLength(1);
    expect(heads[0].faces[FRONT]).toBe(`${type}_face`);
  });

  test.each(MOB_TYPES)('%s only uses textures that exist in the atlas', (type) => {
    for (const part of mobParts(type)) for (const tile of part.faces) expect(TILE_NAMES, tile).toContain(tile);
  });

  test.each(MOB_TYPES)('%s model matches its hitbox size', (type) => {
    const parts = mobParts(type);
    const top = Math.max(...parts.map((p) => p.center[1] + p.size[1] / 2));
    // Arms may reach past the hitbox, as with Minecraft's humanoids.
    const width = Math.max(...parts.filter((p) => p.kind !== 'arm').map((p) => Math.abs(p.center[0]) + p.size[0] / 2)) * 2;
    expect(Math.abs(top - MOB_DEFS[type].height)).toBeLessThanOrEqual(0.15);
    expect(width).toBeLessThanOrEqual(MOB_DEFS[type].width + 0.15);
    expect(Math.min(...parts.map((p) => p.center[1] - p.size[1] / 2))).toBeCloseTo(0, 5);
  });

  test('four-legged mobs have four legs, zombies two, all swinging from the hip', () => {
    const legs = (t: (typeof MOB_TYPES)[number]) => mobParts(t).filter((p) => p.kind === 'leg');
    for (const t of ['pig', 'cow', 'sheep', 'creeper'] as const) expect(legs(t)).toHaveLength(4);
    expect(legs('zombie')).toHaveLength(2);
    for (const t of MOB_TYPES)
      for (const leg of legs(t)) expect(leg.pivot?.[1]).toBeCloseTo(leg.center[1] + leg.size[1] / 2, 5);
  });

  test('zombies hold their arms straight out in front', () => {
    const arms = mobParts('zombie').filter((p) => p.kind === 'arm');
    expect(arms).toHaveLength(2);
    for (const arm of arms) expect(arm.rotX).toBeCloseTo(Math.PI / 2, 5);
  });

  test('cows and sheep look like themselves', () => {
    expect(mobParts('cow').find((p) => p.kind === 'body')?.faces).toContain('cow_hide');
    expect(mobParts('sheep').find((p) => p.kind === 'body')?.faces).toContain('sheep_wool');
    expect(mobParts('zombie').find((p) => p.kind === 'head')?.faces[2]).toBe('zombie_hair');
  });
});
