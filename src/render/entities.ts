import * as THREE from 'three';
import { B, getBlock } from '../core/blocks';
import { getItem, isBlockItem } from '../core/items';
import type { World } from '../core/world';
import type { Mob, MobType } from '../game/mobs';
import type { ItemEntity, PrimedTnt } from '../game/session';
import { DESTROY_STAGES, tileIndex, tileUV } from './atlas';
import { lightBrightness } from './materials';

const FACE_SHADE = [0.6, 0.6, 1, 0.5, 0.8, 0.8];

/** Box with per-face shading baked into vertex colors. */
function coloredBox(w: number, h: number, d: number, color: string, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  const base = new THREE.Color(color);
  const colors: number[] = [];
  const count = g.getAttribute('position').count;
  for (let i = 0; i < count; i++) {
    const s = FACE_SHADE[Math.floor(i / 6)];
    colors.push(base.r * s, base.g * s, base.b * s);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

/** Box whose 6 faces show atlas tiles (order: +X, -X, +Y, -Y, +Z, -Z). */
export function tiledBox(size: number, tiles: number[]): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size, size, size);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    const [u0, v0, u1, v1] = tileUV(tiles[f]);
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, u0 + uv.getX(idx) * (u1 - u0), v0 + uv.getY(idx) * (v1 - v0));
    }
  }
  const colors: number[] = [];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) colors.push(FACE_SHADE[f], FACE_SHADE[f], FACE_SHADE[f]);
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

export function blockTiles(id: number): number[] {
  const t = getBlock(id).textures;
  const front = t.front ?? t.side;
  return [t.side, t.side, t.top, t.bottom, front, front].map(tileIndex);
}

function quadForTile(size: number, tile: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(size, size);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const [u0, v0, u1, v1] = tileUV(tile);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

// ---- mob models ------------------------------------------------------------------

interface MobModel {
  root: THREE.Group;
  material: THREE.MeshBasicMaterial;
  legs: THREE.Object3D[];
  head?: THREE.Object3D;
}

function part(geo: THREE.BufferGeometry, mat: THREE.Material, pivot?: [number, number, number]): THREE.Object3D {
  const mesh = new THREE.Mesh(geo, mat);
  if (!pivot) return mesh;
  const g = new THREE.Group();
  g.position.set(...pivot);
  mesh.position.set(-pivot[0], -pivot[1], -pivot[2]);
  g.add(mesh);
  return g;
}

function buildMob(type: MobType): MobModel {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const root = new THREE.Group();
  const legs: THREE.Object3D[] = [];
  const add = (o: THREE.Object3D) => (root.add(o), o);
  const leg = (w: number, h: number, x: number, z: number, color: string) => {
    const l = part(coloredBox(w, h, w, color, x, h / 2, z), mat, [x, h, z]);
    legs.push(add(l));
  };
  const eyes = (y: number, z: number, spread: number, size = 0.08, color = '#1a1a1a') => {
    add(part(coloredBox(size, size, 0.02, color, -spread, y, z), mat));
    add(part(coloredBox(size, size, 0.02, color, spread, y, z), mat));
  };

  switch (type) {
    case 'pig':
      add(part(coloredBox(0.6, 0.5, 0.9, '#f0a5a2', 0, 0.55, 0), mat));
      add(part(coloredBox(0.5, 0.5, 0.45, '#f0a5a2', 0, 0.72, -0.62), mat));
      add(part(coloredBox(0.26, 0.18, 0.06, '#e07f80', 0, 0.64, -0.86), mat));
      eyes(0.8, -0.85, 0.15);
      for (const [x, z] of [[-0.18, -0.3], [0.18, -0.3], [-0.18, 0.3], [0.18, 0.3]]) leg(0.2, 0.3, x, z, '#e8958f');
      break;
    case 'cow':
      add(part(coloredBox(0.7, 0.6, 1.0, '#4b3a2a', 0, 0.85, 0), mat));
      add(part(coloredBox(0.72, 0.3, 0.4, '#e8e4dc', 0, 0.95, 0.15), mat));
      add(part(coloredBox(0.5, 0.45, 0.35, '#4b3a2a', 0, 1.1, -0.66), mat));
      add(part(coloredBox(0.36, 0.2, 0.06, '#d8c8b8', 0, 0.95, -0.85), mat));
      add(part(coloredBox(0.08, 0.15, 0.08, '#e8e0d0', -0.3, 1.35, -0.66), mat));
      add(part(coloredBox(0.08, 0.15, 0.08, '#e8e0d0', 0.3, 1.35, -0.66), mat));
      eyes(1.15, -0.84, 0.15);
      for (const [x, z] of [[-0.22, -0.35], [0.22, -0.35], [-0.22, 0.35], [0.22, 0.35]]) leg(0.2, 0.55, x, z, '#3a2c20');
      break;
    case 'sheep':
      add(part(coloredBox(0.65, 0.6, 0.95, '#ececec', 0, 0.85, 0), mat));
      add(part(coloredBox(0.38, 0.38, 0.42, '#d6c7b2', 0, 1.1, -0.6), mat));
      add(part(coloredBox(0.44, 0.2, 0.3, '#ececec', 0, 1.3, -0.55), mat));
      eyes(1.15, -0.82, 0.11);
      for (const [x, z] of [[-0.2, -0.32], [0.2, -0.32], [-0.2, 0.32], [0.2, 0.32]]) leg(0.18, 0.55, x, z, '#d6c7b2');
      break;
    case 'zombie': {
      for (const x of [-0.125, 0.125]) leg(0.25, 0.75, x, 0, '#3b3e8c');
      add(part(coloredBox(0.5, 0.75, 0.25, '#2f8a8a', 0, 1.125, 0), mat));
      for (const x of [-0.375, 0.375]) {
        const arm = part(coloredBox(0.25, 0.75, 0.25, '#4f8a3a', x, 1.125, 0), mat, [x, 1.4, 0]);
        arm.rotation.x = Math.PI / 2;
        add(arm);
      }
      const head = add(part(coloredBox(0.5, 0.5, 0.5, '#4f8a3a', 0, 1.75, 0), mat));
      eyes(1.78, -0.26, 0.11, 0.1, '#1a2a12');
      return { root, material: mat, legs, head };
    }
    case 'creeper':
      for (const [x, z] of [[-0.125, -0.2], [0.125, -0.2], [-0.125, 0.2], [0.125, 0.2]]) leg(0.25, 0.375, x, z, '#3f9a33');
      add(part(coloredBox(0.5, 0.75, 0.3, '#4caf3d', 0, 0.75, 0), mat));
      add(part(coloredBox(0.5, 0.5, 0.5, '#55b845', 0, 1.375, 0), mat));
      eyes(1.47, -0.26, 0.12, 0.12, '#101010');
      add(part(coloredBox(0.12, 0.2, 0.02, '#101010', 0, 1.3, -0.26), mat));
      break;
  }
  return { root, material: mat, legs };
}

// ---- entity renderer -----------------------------------------------------------

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

export class EntityRenderer {
  readonly group = new THREE.Group();
  private readonly mobModels = new Map<number, MobModel>();
  private readonly itemMeshes = new Map<number, THREE.Mesh>();
  private readonly itemGeos = new Map<number, THREE.BufferGeometry>();
  private readonly itemMaterial: THREE.MeshBasicMaterial;
  private readonly tntMeshes: THREE.Mesh[] = [];
  private readonly tntMaterial: THREE.MeshBasicMaterial;
  private readonly particles: Particle[] = [];
  private readonly particleMaterial: THREE.MeshBasicMaterial;
  readonly highlight: THREE.LineSegments;
  readonly cracks: THREE.Mesh;
  private crackStage = -1;

  constructor(atlas: THREE.Texture) {
    this.itemMaterial = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true });
    this.tntMaterial = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true });
    this.particleMaterial = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide });

    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }),
    );
    this.highlight.visible = false;
    this.cracks = new THREE.Mesh(
      new THREE.BoxGeometry(1.006, 1.006, 1.006),
      new THREE.MeshBasicMaterial({ map: atlas, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
    );
    this.cracks.visible = false;
    this.group.add(this.highlight, this.cracks);
  }

  private brightnessAt(world: World, x: number, y: number, z: number, daylight: number): number {
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    return Math.max(lightBrightness(world.getSkyLight(bx, by, bz)) * daylight, lightBrightness(world.getBlockLight(bx, by, bz)));
  }

  setTarget(target: { x: number; y: number; z: number } | null, progress: number | null): void {
    this.highlight.visible = !!target;
    if (target) this.highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    const stage = target && progress !== null ? Math.min(DESTROY_STAGES - 1, Math.floor(progress * DESTROY_STAGES)) : -1;
    this.cracks.visible = stage >= 0;
    if (stage < 0 || !target) return;
    this.cracks.position.copy(this.highlight.position);
    if (stage !== this.crackStage) {
      this.crackStage = stage;
      const g = this.cracks.geometry;
      const fresh = tiledBox(1.006, new Array(6).fill(tileIndex(`destroy_${stage}`)));
      g.setAttribute('uv', fresh.getAttribute('uv'));
      fresh.dispose();
    }
  }

  update(world: World, mobs: Mob[], items: ItemEntity[], tnt: PrimedTnt[], daylight: number, camera: THREE.Camera, dt: number, time: number): void {
    this.updateMobs(world, mobs, daylight);
    this.updateItems(world, items, daylight, time);
    this.updateTnt(tnt, time);
    this.updateParticles(world, camera, dt);
  }

  private updateMobs(world: World, mobs: Mob[], daylight: number): void {
    const alive = new Set<number>();
    for (const m of mobs) {
      alive.add(m.id);
      let model = this.mobModels.get(m.id);
      if (!model) {
        model = buildMob(m.type);
        this.mobModels.set(m.id, model);
        this.group.add(model.root);
      }
      model.root.position.set(m.body.x, m.body.y, m.body.z);
      model.root.rotation.y = m.yaw;
      const swing = Math.sin(m.walkAnim * 4) * 0.7;
      model.legs.forEach((leg, i) => (leg.rotation.x = (i % 2 === 0) !== (i >= 2) ? swing : -swing));
      const b = this.brightnessAt(world, m.body.x, m.body.y + m.body.height * 0.8, m.body.z, daylight);
      if (m.hurtTime > 0) model.material.color.setRGB(b * 1.4, b * 0.35, b * 0.35);
      else if (m.fuse > 0 && Math.floor(m.fuse * 8) % 2 === 0) model.material.color.setScalar(Math.min(2.2, b * 2.5));
      else model.material.color.setScalar(b);
      const swell = m.type === 'creeper' ? 1 + m.fuse * 0.12 : 1;
      model.root.scale.set(swell, 1 + (swell - 1) * 0.5, swell);
    }
    for (const [id, model] of this.mobModels) {
      if (alive.has(id)) continue;
      this.group.remove(model.root);
      model.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      model.material.dispose();
      this.mobModels.delete(id);
    }
  }

  private itemGeometry(id: number): THREE.BufferGeometry {
    let g = this.itemGeos.get(id);
    if (g) return g;
    if (isBlockItem(id) && getBlock(id).render !== 'cross') g = tiledBox(0.25, blockTiles(id));
    else {
      g = quadForTile(0.4, tileIndex(isBlockItem(id) ? getBlock(id).textures.side : getItem(id).texture));
      const colors = new Array(g.getAttribute('position').count * 3).fill(1);
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }
    this.itemGeos.set(id, g);
    return g;
  }

  private updateItems(world: World, items: ItemEntity[], daylight: number, time: number): void {
    const alive = new Set<number>();
    for (const it of items) {
      alive.add(it.id);
      let mesh = this.itemMeshes.get(it.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.itemGeometry(it.stack.id), this.itemMaterial.clone());
        this.itemMeshes.set(it.id, mesh);
        this.group.add(mesh);
      }
      const bob = Math.sin(time * 3 + it.id) * 0.06;
      mesh.position.set(it.body.x, it.body.y + 0.2 + bob, it.body.z);
      mesh.rotation.y = time * 1.5 + it.id;
      (mesh.material as THREE.MeshBasicMaterial).color.setScalar(this.brightnessAt(world, it.body.x, it.body.y + 0.2, it.body.z, daylight));
    }
    for (const [id, mesh] of this.itemMeshes) {
      if (alive.has(id)) continue;
      this.group.remove(mesh);
      (mesh.material as THREE.Material).dispose();
      this.itemMeshes.delete(id);
    }
  }

  private updateTnt(tnt: PrimedTnt[], time: number): void {
    while (this.tntMeshes.length < tnt.length) {
      const m = new THREE.Mesh(tiledBox(0.98, blockTiles(B.TNT)), this.tntMaterial);
      this.tntMeshes.push(m);
      this.group.add(m);
    }
    this.tntMeshes.forEach((m, i) => {
      const t = tnt[i];
      m.visible = !!t;
      if (!t) return;
      m.position.set(t.x, t.y + 0.5, t.z);
      const s = t.fuse < 1 ? 1 + (1 - t.fuse) * 0.15 : 1;
      m.scale.setScalar(s);
    });
    this.tntMaterial.color.setScalar(Math.floor(time * 4) % 2 === 0 ? 2 : 1);
  }

  /** Spawns little block fragments when a block breaks. */
  burst(blockId: number, x: number, y: number, z: number): void {
    const def = getBlock(blockId);
    const [u0, v0, u1, v1] = tileUV(tileIndex(def.textures.side));
    const du = (u1 - u0) / 4;
    const dv = (v1 - v0) / 4;
    for (let i = 0; i < 14; i++) {
      const g = new THREE.PlaneGeometry(0.12, 0.12);
      const pu = u0 + Math.floor(Math.random() * 3) * du;
      const pv = v0 + Math.floor(Math.random() * 3) * dv;
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, pu + uv.getX(k) * du, pv + uv.getY(k) * dv);
      const mesh = new THREE.Mesh(g, this.particleMaterial);
      mesh.position.set(x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, z + 0.2 + Math.random() * 0.6);
      this.group.add(mesh);
      this.particles.push({ mesh, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 3 + 1, vz: (Math.random() - 0.5) * 3, life: 0.5 + Math.random() * 0.5 });
    }
  }

  private updateParticles(world: World, camera: THREE.Camera, dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.group.remove(p.mesh);
        p.mesh.geometry.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= 16 * dt;
      const pos = p.mesh.position;
      const ny = pos.y + p.vy * dt;
      if (getBlock(world.getBlock(Math.floor(pos.x), Math.floor(ny), Math.floor(pos.z))).solid) {
        p.vy = 0;
        p.vx *= 0.5;
        p.vz *= 0.5;
      } else pos.y = ny;
      pos.x += p.vx * dt;
      pos.z += p.vz * dt;
      p.mesh.quaternion.copy(camera.quaternion);
    }
  }

  dispose(): void {
    for (const id of [...this.mobModels.keys()]) {
      const m = this.mobModels.get(id)!;
      this.group.remove(m.root);
    }
    this.mobModels.clear();
    for (const mesh of this.itemMeshes.values()) this.group.remove(mesh);
    this.itemMeshes.clear();
    for (const p of this.particles) this.group.remove(p.mesh);
    this.particles.length = 0;
  }
}
