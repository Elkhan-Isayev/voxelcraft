import * as THREE from 'three';
import { CHUNK_SIZE, SECTION_COUNT, sectionKey } from '../core/constants';
import type { World } from '../core/world';
import { buildSectionMesh, type MeshData } from './mesher';

interface SectionMeshes {
  solid?: THREE.Mesh;
  water?: THREE.Mesh;
}

function toGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
  g.setAttribute('aLight', new THREE.BufferAttribute(m.light, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

export class ChunkRenderer {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<string, SectionMeshes>();
  /** Sections waiting to be (re)meshed, with their parsed coordinates. */
  private readonly pending = new Map<string, [number, number, number]>();

  constructor(
    private readonly world: World,
    private readonly solidMaterial: THREE.Material,
    private readonly waterMaterial: THREE.Material,
  ) {
    world.onChunkUnload((c) => this.disposeChunk(c.cx, c.cz));
  }

  /** Number of sections still waiting to be meshed. */
  pendingCount(): number {
    return this.pending.size;
  }

  meshCount(): number {
    return this.meshes.size;
  }

  private neighborsLoaded(cx: number, cz: number): boolean {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (!this.world.isLoaded(cx + dx, cz + dz)) return false;
    return true;
  }

  /** Rebuilds dirty sections, nearest to the camera first, within a time budget (ms). */
  update(cameraPos: THREE.Vector3, budgetMs: number): void {
    for (const key of this.world.consumeDirtySections()) {
      if (!this.pending.has(key)) this.pending.set(key, key.split(',').map(Number) as [number, number, number]);
    }
    if (this.pending.size === 0) return;

    const camCx = cameraPos.x / CHUNK_SIZE;
    const camCz = cameraPos.z / CHUNK_SIZE;
    const camSy = cameraPos.y / 16;
    const candidates: [number, string, number, number, number][] = [];
    for (const [key, [cx, sy, cz]] of this.pending) {
      if (!this.world.isLoaded(cx, cz)) {
        this.pending.delete(key);
        continue;
      }
      if (!this.neighborsLoaded(cx, cz)) continue;
      const d = (cx + 0.5 - camCx) ** 2 + (cz + 0.5 - camCz) ** 2 + ((sy + 0.5 - camSy) * 0.5) ** 2;
      candidates.push([d, key, cx, sy, cz]);
    }
    candidates.sort((a, b) => a[0] - b[0]);

    const start = performance.now();
    for (const [, key, cx, sy, cz] of candidates) {
      this.pending.delete(key);
      this.buildSection(cx, sy, cz);
      if (performance.now() - start > budgetMs) break;
    }
  }

  private buildSection(cx: number, sy: number, cz: number): void {
    const key = sectionKey(cx, sy, cz);
    this.disposeSection(key);
    const chunk = this.world.getChunk(cx, cz);
    if (!chunk || chunk.isSectionEmpty(sy)) return;
    const data = buildSectionMesh(this.world, cx, sy, cz);
    const entry: SectionMeshes = {};
    if (data.solid) {
      entry.solid = new THREE.Mesh(toGeometry(data.solid), this.solidMaterial);
      entry.solid.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
      entry.solid.matrixAutoUpdate = false;
      entry.solid.updateMatrix();
      this.group.add(entry.solid);
    }
    if (data.water) {
      entry.water = new THREE.Mesh(toGeometry(data.water), this.waterMaterial);
      entry.water.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
      entry.water.renderOrder = 1;
      entry.water.matrixAutoUpdate = false;
      entry.water.updateMatrix();
      this.group.add(entry.water);
    }
    if (entry.solid || entry.water) this.meshes.set(key, entry);
  }

  private disposeSection(key: string): void {
    const e = this.meshes.get(key);
    if (!e) return;
    for (const m of [e.solid, e.water]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.meshes.delete(key);
  }

  private disposeChunk(cx: number, cz: number): void {
    for (let sy = 0; sy < SECTION_COUNT; sy++) {
      const key = sectionKey(cx, sy, cz);
      this.disposeSection(key);
      this.pending.delete(key);
    }
  }

  /** True when the chunk at the given position and its neighbours have been meshed. */
  isAreaReady(cx: number, cz: number): boolean {
    if (!this.neighborsLoaded(cx, cz)) return false;
    for (const [kx, , kz] of this.pending.values()) {
      if (Math.abs(kx - cx) <= 1 && Math.abs(kz - cz) <= 1) return false;
    }
    return true;
  }

  dispose(): void {
    for (const key of [...this.meshes.keys()]) this.disposeSection(key);
    this.pending.clear();
  }
}

