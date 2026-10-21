import { B } from '../core/blocks';
import { fluidId } from '../core/fluid';
import { World } from '../core/world';
import { TerrainGenerator } from '../world/terrain';
import { LightEngine } from '../world/light';
import { buildSectionMesh, type MeshSource, type MeshData } from './mesher';
import { tileIndex, tileUV } from './atlas';

/** Sparse fake world for meshing tests. Everything not set is air with full sky light. */
class FakeWorld implements MeshSource {
  private blocks = new Map<string, number>();
  sky = 15;
  set(x: number, y: number, z: number, id: number): this {
    this.blocks.set(`${x},${y},${z}`, id);
    return this;
  }
  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(`${x},${y},${z}`) ?? B.AIR;
  }
  getSkyLight(): number {
    return this.sky;
  }
  getBlockLight(): number {
    return 0;
  }
}

const quads = (m: MeshData | null) => (m ? m.indices.length / 6 : 0);

describe('mesher', () => {
  test('an empty section produces no geometry', () => {
    const mesh = buildSectionMesh(new FakeWorld(), 0, 0, 0);
    expect(mesh.solid).toBeNull();
    expect(mesh.water).toBeNull();
  });

  test('a lone block has 6 faces', () => {
    const w = new FakeWorld().set(3, 3, 3, B.STONE);
    const mesh = buildSectionMesh(w, 0, 0, 0);
    expect(quads(mesh.solid)).toBe(6);
    expect(mesh.solid!.positions.length).toBe(6 * 4 * 3);
  });

  test('faces between two solid blocks are culled', () => {
    const w = new FakeWorld().set(3, 3, 3, B.STONE).set(4, 3, 3, B.DIRT);
    expect(quads(buildSectionMesh(w, 0, 0, 0).solid)).toBe(10);
  });

  test('faces next to glass are kept, but glass-to-glass faces are culled', () => {
    const w = new FakeWorld().set(3, 3, 3, B.STONE).set(4, 3, 3, B.GLASS).set(5, 3, 3, B.GLASS);
    // stone: 6, glass pair: 10 minus the face touching stone? No — glass is not opaque, so stone keeps its face,
    // while the glass face toward the opaque stone is culled.
    expect(quads(buildSectionMesh(w, 0, 0, 0).solid)).toBe(6 + 10 - 1);
  });

  test('leaves keep faces between each other (fancy leaves)', () => {
    const w = new FakeWorld().set(3, 3, 3, B.OAK_LEAVES).set(4, 3, 3, B.OAK_LEAVES);
    expect(quads(buildSectionMesh(w, 0, 0, 0).solid)).toBe(12);
  });

  test('neighbouring sections and chunks are consulted for culling', () => {
    const w = new FakeWorld().set(0, 15, 0, B.STONE).set(0, 16, 0, B.STONE).set(-1, 15, 0, B.STONE);
    expect(quads(buildSectionMesh(w, 0, 0, 0).solid)).toBe(4);
  });

  test('water goes into its own translucent mesh with a lowered surface', () => {
    const w = new FakeWorld().set(3, 3, 3, B.WATER).set(4, 3, 3, B.WATER).set(3, 2, 3, B.STONE);
    const mesh = buildSectionMesh(w, 0, 0, 0);
    // two water blocks: share one face; bottom of (3,3,3) touches stone → culled
    expect(quads(mesh.water)).toBe(6 + 6 - 2 - 1);
    const ys = new Set<number>();
    for (let i = 1; i < mesh.water!.positions.length; i += 3) ys.add(Math.round(mesh.water!.positions[i] * 1000) / 1000);
    expect(ys).toContain(3.875);
    expect(ys).not.toContain(4);
  });

  test('water directly under water fills the whole block', () => {
    const w = new FakeWorld().set(3, 3, 3, B.WATER).set(3, 4, 3, B.WATER);
    const mesh = buildSectionMesh(w, 0, 0, 0);
    let maxLower = 0;
    for (let i = 1; i < mesh.water!.positions.length; i += 3) {
      const y = mesh.water!.positions[i];
      if (y < 4.5) maxLower = Math.max(maxLower, y);
    }
    expect(maxLower).toBe(4);
  });

  test('flowing water slopes down away from its source', () => {
    const w = new FakeWorld().set(3, 3, 3, B.WATER).set(4, 3, 3, fluidId('water', 1)).set(5, 3, 3, fluidId('water', 2));
    for (let x = 3; x <= 5; x++) w.set(x, 2, 3, B.STONE);
    const mesh = buildSectionMesh(w, 0, 0, 0).water!;
    const topByX = new Map<number, number>();
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const [x, y] = [mesh.positions[i], mesh.positions[i + 1]];
      if (y > 3) topByX.set(x, Math.max(topByX.get(x) ?? 0, y));
    }
    expect(topByX.get(3)).toBeCloseTo(3.875);
    expect(topByX.get(4)!).toBeLessThan(topByX.get(3)!);
    expect(topByX.get(5)!).toBeLessThan(topByX.get(4)!);
    expect(topByX.get(6)!).toBeLessThan(topByX.get(5)!);
    expect(topByX.get(6)!).toBeGreaterThan(3);
  });

  test('faces between a source and its flowing water are culled', () => {
    const w = new FakeWorld().set(3, 3, 3, B.WATER).set(4, 3, 3, fluidId('water', 1));
    w.set(3, 2, 3, B.STONE).set(4, 2, 3, B.STONE);
    expect(quads(buildSectionMesh(w, 0, 0, 0).water)).toBe(4 + 4);
  });

  test('lava is meshed as a fluid, and water next to lava keeps the faces between them', () => {
    const w = new FakeWorld().set(3, 3, 3, B.LAVA).set(4, 3, 3, B.WATER);
    w.set(3, 2, 3, B.STONE).set(4, 2, 3, B.STONE);
    const mesh = buildSectionMesh(w, 0, 0, 0);
    expect(quads(mesh.water)).toBe(5 + 5);
  });

  test('falling water is drawn at full height', () => {
    const w = new FakeWorld().set(3, 3, 3, fluidId('water', 0, true)).set(3, 2, 3, B.STONE);
    const mesh = buildSectionMesh(w, 0, 0, 0).water!;
    let top = 0;
    for (let i = 1; i < mesh.positions.length; i += 3) top = Math.max(top, mesh.positions[i]);
    expect(top).toBe(4);
  });

  test('plants are drawn as double-sided crosses', () => {
    const w = new FakeWorld().set(3, 3, 3, B.POPPY);
    expect(quads(buildSectionMesh(w, 0, 0, 0).solid)).toBe(4);
  });

  test('positions are relative to the chunk origin', () => {
    const w = new FakeWorld().set(17, 3, -14, B.STONE);
    const mesh = buildSectionMesh(w, 1, 0, -1);
    const xs = new Set<number>();
    const zs = new Set<number>();
    for (let i = 0; i < mesh.solid!.positions.length; i += 3) {
      xs.add(mesh.solid!.positions[i]);
      zs.add(mesh.solid!.positions[i + 2]);
    }
    expect([...xs].sort()).toEqual([1, 2]);
    expect([...zs].sort()).toEqual([2, 3]);
  });

  test('uses the right texture per face (grass top vs. side)', () => {
    const w = new FakeWorld().set(3, 3, 3, B.GRASS_BLOCK);
    const mesh = buildSectionMesh(w, 0, 0, 0).solid!;
    const top = tileUV(tileIndex('grass_block_top'));
    const side = tileUV(tileIndex('grass_block_side'));
    const us = new Set<number>();
    for (let i = 0; i < mesh.uvs.length; i += 2) us.add(mesh.uvs[i]);
    expect(us).toContain(top[0]);
    expect(us).toContain(side[0]);
  });

  test('stores sky light, block light and shading per vertex', () => {
    const w = new FakeWorld().set(3, 3, 3, B.STONE);
    w.sky = 12;
    const mesh = buildSectionMesh(w, 0, 0, 0).solid!;
    expect(mesh.light.length).toBe((mesh.positions.length / 3) * 3);
    expect(mesh.light[0]).toBe(12);
    expect(mesh.light[1]).toBe(0);
    // top faces are brightest, bottom faces darkest
    const shades = new Set<number>();
    for (let i = 2; i < mesh.light.length; i += 3) shades.add(mesh.light[i]);
    expect(Math.max(...shades)).toBe(1);
    expect(Math.min(...shades)).toBeLessThan(0.6);
  });

  test('ambient occlusion darkens corners next to other blocks', () => {
    // Block A with a block diagonally above its +X edge.
    const w = new FakeWorld().set(3, 3, 3, B.STONE).set(4, 4, 3, B.STONE);
    const mesh = buildSectionMesh(w, 0, 0, 0).solid!;
    const topShades: { x: number; s: number }[] = [];
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      const y = mesh.positions[v * 3 + 1];
      const x = mesh.positions[v * 3];
      if (y === 4 && x <= 4 && mesh.light[v * 3 + 2] > 0 && mesh.positions[v * 3 + 2] >= 3 && mesh.positions[v * 3 + 2] <= 4) {
        // only vertices of A's top face: x in [3,4]
        if (x === 3 || x === 4) topShades.push({ x, s: mesh.light[v * 3 + 2] });
      }
    }
    const edge = topShades.filter((t) => t.x === 4).map((t) => t.s);
    const open = topShades.filter((t) => t.x === 3).map((t) => t.s);
    expect(Math.min(...edge)).toBeLessThan(Math.max(...open));
  });

  test('the fast chunk-copy path produces exactly the same mesh as the generic path', () => {
    const world = new World(new TerrainGenerator(99));
    new LightEngine(world);
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.ensureChunk(x, z);
    world.setBlock(3, 70, 3, B.TORCH);
    world.setBlock(15, 64, 15, B.GLASS);
    const generic: MeshSource = {
      getBlock: (x, y, z) => world.getBlock(x, y, z),
      getSkyLight: (x, y, z) => world.getSkyLight(x, y, z),
      getBlockLight: (x, y, z) => world.getBlockLight(x, y, z),
    };
    for (let sy = 0; sy < 8; sy++) {
      const fast = buildSectionMesh(world, 0, sy, 0);
      const slow = buildSectionMesh(generic, 0, sy, 0);
      expect(fast).toEqual(slow);
    }
  });
});
