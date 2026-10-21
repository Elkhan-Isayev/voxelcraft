import * as THREE from 'three';
import { getBlock } from '../core/blocks';
import { getItem, isBlockItem } from '../core/items';

/**
 * First-person hand: where the held item sits and how it moves.
 * Swing and equip curves follow Minecraft's first-person renderer.
 */

export type HeldKind = 'empty' | 'block' | 'item' | 'tool';

export interface HandState {
  /** 0 = not swinging, otherwise swing progress in (0, 1]. */
  swing: number;
  /** 0 = raised, 1 = fully lowered (switching items). */
  equip: number;
  /** 0..1 eating animation strength. */
  eat: number;
  /** View-bob phase (radians) and strength 0..1. */
  bob: number;
  walk: number;
}

export const REST: HandState = { swing: 0, equip: 0, eat: 0, bob: 0, walk: 0 };
export const SWING_SECONDS = 0.3;
const LOWER_SECONDS = 0.1;
const RAISE_SECONDS = 0.15;
const EAT_SECONDS = 0.8;

export function heldKind(id: number | null): HeldKind {
  if (id === null) return 'empty';
  if (isBlockItem(id)) return getBlock(id).render === 'cross' ? 'item' : 'block';
  return getItem(id).tool ? 'tool' : 'item';
}

const deg = THREE.MathUtils.degToRad;
const GRIP = new THREE.Vector3(0.56, -0.52, -0.72);

/** Rotation that maps local axis `from` onto `to`, and the local normal (0,0,1) onto `normal`. */
function orient(from: THREE.Vector3, to: THREE.Vector3, normal: THREE.Vector3): THREE.Matrix4 {
  const w = new THREE.Vector3(0, 0, 1);
  const local = new THREE.Matrix4().makeBasis(from.clone().normalize(), w, from.clone().normalize().cross(w));
  const d = to.clone().normalize();
  const n = normal.clone().sub(d.clone().multiplyScalar(normal.dot(d))).normalize();
  const world = new THREE.Matrix4().makeBasis(d, n, d.clone().cross(n));
  return world.multiply(local.transpose());
}

/** Resting orientation, scale and grip offset of each kind of held thing (in its own model space). */
const REST_POSE: Record<HeldKind, THREE.Matrix4> = {
  // Sprite square [-0.5, 0.5]²: hold it by the handle at the bottom-left, head pointing up, left and away.
  tool: orient(new THREE.Vector3(1, 1, 0), new THREE.Vector3(-0.35, 0.55, -0.75), new THREE.Vector3(-0.6, 0.1, 0.8))
    .multiply(new THREE.Matrix4().makeScale(0.5, 0.5, 0.5))
    .multiply(new THREE.Matrix4().makeTranslation(0.42, 0.42, 0)),
  // Ordinary items face the player, slightly turned, held a little lower.
  item: new THREE.Matrix4()
    .makeTranslation(0, 0.06, 0)
    .multiply(orient(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-0.25, 1, -0.1), new THREE.Vector3(-0.45, 0.1, 0.9)))
    .multiply(new THREE.Matrix4().makeScale(0.5, 0.5, 0.5)),
  // Blocks: a small cube turned 45° like an item in Minecraft's hand.
  block: new THREE.Matrix4()
    .makeTranslation(-0.02, 0.12, -0.14)
    .multiply(new THREE.Matrix4().makeRotationX(deg(12)))
    .multiply(new THREE.Matrix4().makeRotationY(deg(45)))
    .multiply(new THREE.Matrix4().makeScale(0.32, 0.32, 0.32)),
  // Bare arm: a box along -Z coming in from the lower right.
  empty: new THREE.Matrix4()
    .makeTranslation(0.05, -0.1, 0.2)
    .multiply(new THREE.Matrix4().makeRotationY(deg(20)))
    .multiply(new THREE.Matrix4().makeRotationX(deg(8))),
};

/** Model-space → camera-space transform for the held thing. */
export function handMatrix(kind: HeldKind, s: HandState): THREE.Matrix4 {
  const p = s.swing;
  const f = Math.sin(p * p * Math.PI);
  const f1 = Math.sin(Math.sqrt(p) * Math.PI);
  const pos = GRIP.clone();
  pos.y -= 0.6 * s.equip;
  // Swing: lunge left and forward with a little hop.
  pos.x += -0.4 * f1;
  pos.y += 0.2 * Math.sin(Math.sqrt(p) * Math.PI * 2);
  pos.z += -0.2 * Math.sin(p * Math.PI);
  // Walking sway.
  pos.x += Math.sin(s.bob) * 0.03 * s.walk;
  pos.y -= Math.abs(Math.cos(s.bob)) * 0.03 * s.walk;
  // Eating: bring it toward the mouth and nibble.
  pos.x -= 0.3 * s.eat;
  pos.y += (0.25 + 0.04 * Math.sin(s.eat * 60)) * s.eat;
  pos.z += 0.1 * s.eat;

  const swing = new THREE.Matrix4()
    .makeRotationY(deg(45 - 20 * f))
    .multiply(new THREE.Matrix4().makeRotationZ(deg(-20 * f1)))
    .multiply(new THREE.Matrix4().makeRotationX(deg(-80 * f1)))
    .multiply(new THREE.Matrix4().makeRotationY(deg(-45)));
  return new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z).multiply(swing).multiply(REST_POSE[kind]);
}

/** Drives swing, equip, eat and walk-bob timelines. `key` identifies what is held (e.g. the item id). */
export class HandAnimator {
  private swingP = 0;
  private equip = 0;
  private phase: 'idle' | 'lowering' | 'raising' = 'idle';
  private shown: string | undefined;
  private eatLeft = 0;
  private bob = 0;
  private walk = 0;

  swing(): void {
    if (this.swingP === 0 || this.swingP > 0.5) this.swingP = 1e-6;
  }

  eat(): void {
    this.eatLeft = EAT_SECONDS;
  }

  update(dt: number, key: string, mining: boolean, walking = false): { state: HandState; shown: string } {
    if (this.swingP > 0) {
      this.swingP += dt / SWING_SECONDS;
      if (this.swingP >= 1) this.swingP = 0;
    }
    if (mining && this.swingP === 0) this.swingP = 1e-6;

    if (this.shown === undefined) this.shown = key;
    if (key !== this.shown && this.phase !== 'lowering') this.phase = 'lowering';
    if (this.phase === 'lowering') {
      this.equip += dt / LOWER_SECONDS;
      if (this.equip >= 1) {
        this.equip = 1;
        this.shown = key;
        this.phase = 'raising';
      }
    } else if (this.phase === 'raising') {
      this.equip -= dt / RAISE_SECONDS;
      if (this.equip <= 0) {
        this.equip = 0;
        this.phase = 'idle';
      }
    }

    this.eatLeft = Math.max(0, this.eatLeft - dt);
    if (walking) this.bob += dt * 9;
    this.walk += ((walking ? 1 : 0) - this.walk) * Math.min(1, dt * 8);

    return {
      state: { swing: this.swingP, equip: this.equip, eat: this.eatLeft / EAT_SECONDS, bob: this.bob, walk: this.walk },
      shown: this.shown,
    };
  }
}

export interface SpriteWall {
  x: number;
  y: number;
  dir: 'left' | 'right' | 'up' | 'down';
}

/**
 * Minecraft-style item extrusion: every opaque pixel gets a thin wall on each side
 * that borders a transparent pixel (or the tile edge). y = 0 is the top row.
 */
export function extrudeSprite(opaque: (x: number, y: number) => boolean, size = 16): SpriteWall[] {
  const walls: SpriteWall[] = [];
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && opaque(x, y);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (!opaque(x, y)) continue;
      if (!solid(x - 1, y)) walls.push({ x, y, dir: 'left' });
      if (!solid(x + 1, y)) walls.push({ x, y, dir: 'right' });
      if (!solid(x, y - 1)) walls.push({ x, y, dir: 'up' });
      if (!solid(x, y + 1)) walls.push({ x, y, dir: 'down' });
    }
  return walls;
}
