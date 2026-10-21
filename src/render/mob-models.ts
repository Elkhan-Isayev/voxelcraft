import type { MobType } from '../game/mobs';

/** Face order matches THREE.BoxGeometry: +X, -X, +Y, -Y, +Z, -Z. Models look toward -Z. */
export const FRONT = 5;
export const TOP = 2;

export type Faces = [string, string, string, string, string, string];

export interface MobPart {
  kind: 'head' | 'body' | 'leg' | 'arm' | 'detail';
  /** Width, height, depth in blocks. */
  size: [number, number, number];
  center: [number, number, number];
  /** Rotation pivot for animated limbs (legs swing from the hip, arms from the shoulder). */
  pivot?: [number, number, number];
  /** Resting rotation around X at the pivot. */
  rotX?: number;
  faces: Faces;
}

const all = (t: string): Faces => [t, t, t, t, t, t];
const withFront = (skin: string, front: string, top = skin): Faces => [skin, skin, top, skin, skin, front];

function leg(x: number, z: number, w: number, h: number, skin: string): MobPart {
  return { kind: 'leg', size: [w, h, w], center: [x, h / 2, z], pivot: [x, h, z], faces: all(skin) };
}

/** Box-model description of each mob, Minecraft-style proportions. */
export function mobParts(type: MobType): MobPart[] {
  switch (type) {
    case 'pig':
      return [
        { kind: 'body', size: [0.6, 0.5, 0.9], center: [0, 0.55, 0], faces: all('pig_skin') },
        { kind: 'head', size: [0.5, 0.5, 0.5], center: [0, 0.7, -0.65], faces: withFront('pig_skin', 'pig_face') },
        { kind: 'detail', size: [0.25, 0.19, 0.07], center: [0, 0.62, -0.935], faces: all('pig_snout') },
        ...[[-0.17, -0.3], [0.17, -0.3], [-0.17, 0.3], [0.17, 0.3]].map(([x, z]) => leg(x, z, 0.24, 0.3, 'pig_skin')),
      ];
    case 'cow':
      return [
        { kind: 'body', size: [0.7, 0.6, 1.05], center: [0, 0.9, 0], faces: all('cow_hide') },
        { kind: 'head', size: [0.5, 0.45, 0.35], center: [0, 1.15, -0.68], faces: withFront('cow_hide', 'cow_face') },
        { kind: 'detail', size: [0.08, 0.15, 0.08], center: [-0.29, 1.42, -0.7], faces: all('sheep_skin') },
        { kind: 'detail', size: [0.08, 0.15, 0.08], center: [0.29, 1.42, -0.7], faces: all('sheep_skin') },
        ...[[-0.22, -0.35], [0.22, -0.35], [-0.22, 0.35], [0.22, 0.35]].map(([x, z]) => leg(x, z, 0.22, 0.6, 'cow_leg')),
      ];
    case 'sheep':
      return [
        { kind: 'body', size: [0.7, 0.65, 1.0], center: [0, 0.875, 0], faces: all('sheep_wool') },
        { kind: 'head', size: [0.4, 0.4, 0.45], center: [0, 1.12, -0.62], faces: withFront('sheep_skin', 'sheep_face') },
        { kind: 'detail', size: [0.46, 0.16, 0.36], center: [0, 1.32, -0.58], faces: all('sheep_wool') },
        ...[[-0.2, -0.32], [0.2, -0.32], [-0.2, 0.32], [0.2, 0.32]].map(([x, z]) => leg(x, z, 0.2, 0.55, 'sheep_skin')),
      ];
    case 'zombie':
      return [
        ...[-0.125, 0.125].map((x) => leg(x, 0, 0.25, 0.75, 'zombie_pants')),
        { kind: 'body', size: [0.5, 0.75, 0.25], center: [0, 1.125, 0], faces: all('zombie_shirt') },
        ...[-0.375, 0.375].map(
          (x): MobPart => ({
            kind: 'arm',
            size: [0.25, 0.75, 0.25],
            center: [x, 1.125, 0],
            pivot: [x, 1.45, 0],
            rotX: Math.PI / 2,
            faces: ['zombie_skin', 'zombie_skin', 'zombie_shirt', 'zombie_skin', 'zombie_skin', 'zombie_skin'],
          }),
        ),
        { kind: 'head', size: [0.5, 0.5, 0.5], center: [0, 1.75, 0], faces: withFront('zombie_skin', 'zombie_face', 'zombie_hair') },
      ];
    case 'creeper':
      return [
        ...[[-0.125, -0.19], [0.125, -0.19], [-0.125, 0.19], [0.125, 0.19]].map(([x, z]) => leg(x, z, 0.25, 0.375, 'creeper_skin')),
        { kind: 'body', size: [0.5, 0.75, 0.25], center: [0, 0.75, 0], faces: all('creeper_skin') },
        { kind: 'head', size: [0.5, 0.5, 0.5], center: [0, 1.375, 0], faces: withFront('creeper_skin', 'creeper_face') },
      ];
  }
}
