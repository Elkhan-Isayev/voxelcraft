import { B, IS_OPAQUE, allBlocks } from '../core/blocks';
import { fluidHeight, isLava, isWater } from '../core/fluid';
import { CHUNK_SIZE, SECTION_SIZE, WORLD_HEIGHT } from '../core/constants';
import { localIndex, type Chunk } from '../core/chunk';
import { tileIndex, tileUV } from './atlas';

export interface MeshSource {
  getBlock(x: number, y: number, z: number): number;
  getSkyLight(x: number, y: number, z: number): number;
  getBlockLight(x: number, y: number, z: number): number;
  /** Optional fast path: direct chunk access lets the mesher copy whole rows of data. */
  getChunk?(cx: number, cz: number): Chunk | undefined;
}

export interface MeshData {
  positions: Float32Array;
  uvs: Float32Array;
  /** Per vertex: sky light (0-15), block light (0-15), shade (face direction × ambient occlusion). */
  light: Float32Array;
  indices: Uint32Array;
}

export interface SectionMesh {
  solid: MeshData | null;
  water: MeshData | null;
}

// Face order: +X, -X, +Y, -Y, +Z, -Z
const FACES = [
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.6 },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.6 },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.8 },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.8 },
] as const;
const FACE_UV = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const AO_LEVELS = [0.45, 0.65, 0.82, 1];

// Per-block, per-face tile UVs precomputed once.
const RENDER = new Uint8Array(256); // 0 none, 1 cube, 2 cutout, 3 translucent, 4 cross
const FACE_TILES = new Int32Array(256 * 6);
for (const b of allBlocks()) {
  RENDER[b.id] = { none: 0, cube: 1, cutout: 2, translucent: 3, cross: 4 }[b.render];
  const t = b.textures;
  const front = t.front ?? t.side;
  const names = [t.side, t.side, t.top, t.bottom, front, front];
  names.forEach((n, f) => (FACE_TILES[b.id * 6 + f] = tileIndex(n)));
}
// Fluid kind per block id (0 none, 1 water, 2 lava) and surface height inside the block.
const FLUID_KIND = new Uint8Array(256);
const FLUID_HEIGHT = new Float32Array(256);
for (const b of allBlocks()) {
  FLUID_KIND[b.id] = isWater(b.id) ? 1 : isLava(b.id) ? 2 : 0;
  FLUID_HEIGHT[b.id] = fluidHeight(b.id);
}
const UV_CACHE = new Map<number, [number, number, number, number]>();
function uvOf(tile: number) {
  let uv = UV_CACHE.get(tile);
  if (!uv) UV_CACHE.set(tile, (uv = tileUV(tile)));
  return uv;
}

class Builder {
  positions: number[] = [];
  uvs: number[] = [];
  light: number[] = [];
  indices: number[] = [];
  private vertexCount = 0;

  quad(
    corners: number[][],
    uv: [number, number, number, number],
    sky: number,
    block: number,
    shades: number[],
    flip = false,
  ): void {
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      this.positions.push(c[0], c[1], c[2]);
      this.uvs.push(FACE_UV[i][0] ? uv[2] : uv[0], FACE_UV[i][1] ? uv[3] : uv[1]);
      this.light.push(sky, block, shades[i]);
    }
    const v = this.vertexCount;
    if (flip) this.indices.push(v + 1, v + 2, v + 3, v + 1, v + 3, v);
    else this.indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
    this.vertexCount += 4;
  }

  build(): MeshData | null {
    if (this.vertexCount === 0) return null;
    return {
      positions: new Float32Array(this.positions),
      uvs: new Float32Array(this.uvs),
      light: new Float32Array(this.light),
      indices: new Uint32Array(this.indices),
    };
  }
}

function faceVisible(id: number, neighbor: number, render: number): boolean {
  if (IS_OPAQUE[neighbor]) return false;
  if (render === 3) return FLUID_KIND[id] ? FLUID_KIND[neighbor] !== FLUID_KIND[id] : neighbor !== id; // hide faces inside one fluid
  if (neighbor === id && render === 2 && !IS_LEAVES[id]) return false; // glass-to-glass
  return true;
}

const IS_LEAVES = new Uint8Array(256);
for (const id of [B.OAK_LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES, B.CHERRY_LEAVES]) IS_LEAVES[id] = 1;

// Padded copy of a section plus a one-block border, so meshing is pure array indexing.
const P = SECTION_SIZE + 2;
const PP = P * P;
const padBlocks = new Uint8Array(P * PP);
const padSky = new Uint8Array(P * PP);
const padBlk = new Uint8Array(P * PP);
const pidx = (x: number, y: number, z: number) => x + 1 + (z + 1) * P + (y + 1) * PP;

/** Index offsets for AO samples: [face][vertex] -> [side1, side2, corner], relative to the neighbour cell. */
const AO_OFFSETS: number[][][] = FACES.map((face) => {
  const n = face.n;
  const axes = n[0] !== 0 ? [1, 2] : n[1] !== 0 ? [0, 2] : [0, 1];
  return face.v.map((corner) => {
    const d1 = [0, 0, 0];
    const d2 = [0, 0, 0];
    d1[axes[0]] = corner[axes[0]] === 1 ? 1 : -1;
    d2[axes[1]] = corner[axes[1]] === 1 ? 1 : -1;
    const off = (d: number[]) => d[0] + d[2] * P + d[1] * PP;
    return [off(d1), off(d2), off([d1[0] + d2[0], d1[1] + d2[1], d1[2] + d2[2]])];
  });
});
const FACE_OFFSETS = FACES.map((f) => f.n[0] + f.n[2] * P + f.n[1] * PP);

/**
 * Surface height at one top corner of a fluid block: the average of the same fluid in the four cells
 * sharing that corner, or a full block if any of them has the same fluid above it.
 * `cx`/`cz` are the corner's 0/1 offsets inside the block.
 */
function fluidCornerHeight(i: number, kind: number, cx: number, cz: number): number {
  let sum = 0;
  let n = 0;
  for (let dz = cz - 1; dz <= cz; dz++)
    for (let dx = cx - 1; dx <= cx; dx++) {
      const j = i + dx + dz * P;
      if (FLUID_KIND[padBlocks[j]] !== kind) continue;
      if (FLUID_KIND[padBlocks[j + PP]] === kind) return 1;
      sum += FLUID_HEIGHT[padBlocks[j]];
      n++;
    }
  return sum / n;
}

function fillPadded(src: MeshSource, ox: number, oy: number, oz: number): void {
  if (src.getChunk) {
    fillFromChunks(src as Required<MeshSource>, ox, oy, oz);
    return;
  }
  for (let y = -1; y <= SECTION_SIZE; y++)
    for (let z = -1; z <= SECTION_SIZE; z++)
      for (let x = -1; x <= SECTION_SIZE; x++) {
        const i = pidx(x, y, z);
        const id = src.getBlock(ox + x, oy + y, oz + z);
        padBlocks[i] = id;
        if (IS_OPAQUE[id]) {
          padSky[i] = 0;
          padBlk[i] = 0;
        } else {
          padSky[i] = src.getSkyLight(ox + x, oy + y, oz + z);
          padBlk[i] = src.getBlockLight(ox + x, oy + y, oz + z);
        }
      }
}

/** Copies blocks and light from up to 3x3 chunks straight out of their arrays. */
function fillFromChunks(src: Required<MeshSource>, ox: number, oy: number, oz: number): void {
  const cx = Math.floor(ox / CHUNK_SIZE);
  const cz = Math.floor(oz / CHUNK_SIZE);
  for (let dcz = -1; dcz <= 1; dcz++)
    for (let dcx = -1; dcx <= 1; dcx++) {
      const chunk = src.getChunk(cx + dcx, cz + dcz);
      // Local x/z ranges (in the padded section's -1..16 space) covered by this chunk.
      const x0 = dcx === -1 ? -1 : dcx === 0 ? 0 : SECTION_SIZE;
      const x1 = dcx === -1 ? -1 : dcx === 0 ? SECTION_SIZE - 1 : SECTION_SIZE;
      const z0 = dcz === -1 ? -1 : dcz === 0 ? 0 : SECTION_SIZE;
      const z1 = dcz === -1 ? -1 : dcz === 0 ? SECTION_SIZE - 1 : SECTION_SIZE;
      for (let y = -1; y <= SECTION_SIZE; y++) {
        const wy = oy + y;
        for (let z = z0; z <= z1; z++) {
          const lz = (z + CHUNK_SIZE) % CHUNK_SIZE;
          for (let x = x0; x <= x1; x++) {
            const i = pidx(x, y, z);
            if (!chunk || wy < 0 || wy >= WORLD_HEIGHT) {
              padBlocks[i] = 0;
              padSky[i] = wy < 0 ? 0 : 15;
              padBlk[i] = 0;
              continue;
            }
            const ci = localIndex((x + CHUNK_SIZE) % CHUNK_SIZE, wy, lz);
            const id = chunk.blocks[ci];
            padBlocks[i] = id;
            const l = chunk.light[ci];
            padSky[i] = l >> 4;
            padBlk[i] = l & 15;
          }
        }
      }
    }
}

/**
 * Builds geometry for one 16x16x16 section. Positions are relative to the chunk origin
 * (cx*16, 0, cz*16) so the mesh can be placed with a simple translation.
 */
export function buildSectionMesh(src: MeshSource, cx: number, sy: number, cz: number): SectionMesh {
  const solid = new Builder();
  const water = new Builder();
  const oy = sy * SECTION_SIZE;
  fillPadded(src, cx * CHUNK_SIZE, oy, cz * CHUNK_SIZE);

  const corners: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const shades = [0, 0, 0, 0];
  const ao = [0, 0, 0, 0];
  // Top corner heights indexed by cornerX * 2 + cornerZ (all 1 for regular blocks).
  const tops = [1, 1, 1, 1];

  for (let ly = 0; ly < SECTION_SIZE; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const i = pidx(lx, ly, lz);
        const id = padBlocks[i];
        const render = RENDER[id];
        if (render === 0) continue;

        if (render === 4) {
          addCross(solid, padSky[i], padBlk[i], id, lx, ly + oy, lz);
          continue;
        }

        const target = render === 3 ? water : solid;
        const kind = FLUID_KIND[id];
        if (kind) for (let c = 0; c < 4; c++) tops[c] = fluidCornerHeight(i, kind, c >> 1, c & 1);
        else tops[0] = tops[1] = tops[2] = tops[3] = 1;

        for (let f = 0; f < 6; f++) {
          const n = i + FACE_OFFSETS[f];
          if (!faceVisible(id, padBlocks[n], render)) continue;
          const face = FACES[f];
          for (let v = 0; v < 4; v++) {
            const c = face.v[v];
            const corner = corners[v];
            corner[0] = lx + c[0];
            corner[1] = ly + oy + (c[1] === 1 ? tops[c[0] * 2 + c[2]] : 0);
            corner[2] = lz + c[2];
            let level = 3;
            if (render !== 3) {
              const [o1, o2, oc] = AO_OFFSETS[f][v];
              const s1 = IS_OPAQUE[padBlocks[n + o1]];
              const s2 = IS_OPAQUE[padBlocks[n + o2]];
              level = s1 && s2 ? 0 : 3 - (s1 + s2 + IS_OPAQUE[padBlocks[n + oc]]);
            }
            ao[v] = level;
            shades[v] = face.shade * AO_LEVELS[level];
          }
          const flip = ao[0] + ao[2] < ao[1] + ao[3];
          target.quad(corners, uvOf(FACE_TILES[id * 6 + f]), padSky[n], padBlk[n], shades, flip);
        }
      }
    }
  }
  return { solid: solid.build(), water: water.build() };
}

function addCross(b: Builder, sky: number, blk: number, id: number, lx: number, y: number, lz: number): void {
  const uv = uvOf(FACE_TILES[id * 6 + 0]);
  const shades = [0.9, 0.9, 0.9, 0.9];
  const i = 0.15;
  const o = 0.85;
  const a = [
    [lx + i, y, lz + i],
    [lx + o, y, lz + o],
    [lx + o, y + 1, lz + o],
    [lx + i, y + 1, lz + i],
  ];
  const c = [
    [lx + o, y, lz + i],
    [lx + i, y, lz + o],
    [lx + i, y + 1, lz + o],
    [lx + o, y + 1, lz + i],
  ];
  for (const q of [a, c]) {
    b.quad(q, uv, sky, blk, shades);
    // Back side: same corners, reversed horizontal order.
    b.quad([q[1], q[0], q[3], q[2]], uv, sky, blk, shades);
  }
}
