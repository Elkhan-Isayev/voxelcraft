import * as THREE from 'three';
import { getBlock } from '../core/blocks';
import { getItem, isBlockItem } from '../core/items';
import { tileIndex, tileUV } from './atlas';
import { blockTiles, tiledBox } from './entities';
import { HandAnimator, extrudeSprite, handMatrix, heldKind } from './hand-pose';
import { paintTile } from './textures';

const THICKNESS = 1 / 16;

/** Minecraft-style 3D item: the sprite on front and back, plus a 1-pixel wall around every opaque pixel. */
function extrudedGeometry(tile: string): THREE.BufferGeometry {
  const px = paintTile(tile);
  const opaque = (x: number, y: number) => px[(y * 16 + x) * 4 + 3] >= 128;
  const [u0, v0, u1, v1] = tileUV(tileIndex(tile));
  const t = THICKNESS / 2;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const quad = (corners: number[][], uv: number[][], shade: number) => {
    const base = positions.length / 3;
    corners.forEach((c, i) => {
      positions.push(c[0], c[1], c[2]);
      uvs.push(uv[i][0], uv[i][1]);
      colors.push(shade, shade, shade);
    });
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const full = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  quad([[-0.5, -0.5, t], [0.5, -0.5, t], [0.5, 0.5, t], [-0.5, 0.5, t]], full, 1);
  quad([[0.5, -0.5, -t], [-0.5, -0.5, -t], [-0.5, 0.5, -t], [0.5, 0.5, -t]], [full[1], full[0], full[3], full[2]], 0.8);

  for (const w of extrudeSprite(opaque)) {
    const x0 = -0.5 + w.x / 16;
    const x1 = x0 + 1 / 16;
    const yTop = 0.5 - w.y / 16;
    const yBot = yTop - 1 / 16;
    const u = u0 + ((w.x + 0.5) / 16) * (u1 - u0);
    const v = v1 - ((w.y + 0.5) / 16) * (v1 - v0);
    const uv = [[u, v], [u, v], [u, v], [u, v]];
    if (w.dir === 'left') quad([[x0, yBot, -t], [x0, yBot, t], [x0, yTop, t], [x0, yTop, -t]], uv, 0.6);
    else if (w.dir === 'right') quad([[x1, yBot, t], [x1, yBot, -t], [x1, yTop, -t], [x1, yTop, t]], uv, 0.6);
    else if (w.dir === 'up') quad([[x0, yTop, t], [x1, yTop, t], [x1, yTop, -t], [x0, yTop, -t]], uv, 1);
    else quad([[x0, yBot, -t], [x1, yBot, -t], [x1, yBot, t], [x0, yBot, t]], uv, 0.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  return g;
}

/** A bare forearm with a rolled-up sleeve, pointing along -Z. */
function armGroup(): THREE.Group {
  const shade = (g: THREE.BufferGeometry, color: THREE.Color) => {
    const faces = [0.6, 0.6, 1, 0.5, 0.8, 0.8];
    const c: number[] = [];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) c.push(color.r * faces[f], color.g * faces[f], color.b * faces[f]);
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    return g;
  };
  const group = new THREE.Group();
  const skin = new THREE.Mesh(shade(new THREE.BoxGeometry(0.2, 0.2, 0.75), new THREE.Color(0.84, 0.62, 0.47)));
  const sleeve = new THREE.Mesh(shade(new THREE.BoxGeometry(0.23, 0.23, 0.3), new THREE.Color(0.22, 0.42, 0.55)));
  sleeve.position.z = 0.26;
  group.add(skin, sleeve);
  return group;
}

/** First-person held item (or bare arm), drawn in its own pass on top of the world. */
export class HandRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
  private readonly holder = new THREE.Group();
  private readonly itemMaterial: THREE.MeshBasicMaterial;
  private readonly armMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
  private readonly animator = new HandAnimator();
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private current: THREE.Object3D | null = null;
  private currentKey: string | null = null;

  constructor(atlas: THREE.Texture) {
    this.itemMaterial = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true });
    this.holder.matrixAutoUpdate = false;
    this.scene.add(this.holder);
  }

  /** Starts a swing (attack, place, break). */
  swingArm(): void {
    this.animator.swing();
  }

  eat(): void {
    this.animator.eat();
  }

  private geometryFor(id: number): THREE.BufferGeometry {
    const key = String(id);
    let g = this.geometries.get(key);
    if (g) return g;
    if (heldKind(id) === 'block') g = tiledBox(1, blockTiles(id));
    else g = extrudedGeometry(isBlockItem(id) ? getBlock(id).textures.side : getItem(id).texture);
    this.geometries.set(key, g);
    return g;
  }

  private show(key: string): void {
    if (key === this.currentKey) return;
    if (this.current) this.holder.remove(this.current);
    if (key === 'empty') {
      this.current = armGroup();
      this.current.traverse((o) => ((o as THREE.Mesh).material = this.armMaterial));
    } else {
      this.current = new THREE.Mesh(this.geometryFor(Number(key)), this.itemMaterial);
    }
    this.holder.add(this.current);
    this.currentKey = key;
  }

  update(heldId: number | null, brightness: number, aspect: number, dt: number, walking: boolean, mining: boolean): void {
    const { state, shown } = this.animator.update(dt, heldId === null ? 'empty' : String(heldId), mining, walking);
    this.show(shown);
    const kind = shown === 'empty' ? 'empty' : heldKind(Number(shown));
    this.holder.matrix.copy(handMatrix(kind, state));
    this.holder.matrixWorldNeedsUpdate = true;

    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.itemMaterial.color.setScalar(brightness);
    this.armMaterial.color.setScalar(brightness);
  }
}
