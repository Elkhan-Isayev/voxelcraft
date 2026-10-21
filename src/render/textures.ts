import { createRng, hashSeed, type Rng } from '../core/rng';
import { decodeTile } from '../tools/texture-pipeline';
import { GENERATED_TILES } from './tiles.generated';

/** Procedural 16x16 pixel-art textures. Everything is drawn in code; no external assets. */

const S = 16;
type Color = [number, number, number, number];

function hex(h: string, a = 255): Color {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
}

class Img {
  readonly px = new Uint8ClampedArray(S * S * 4);
  set(x: number, y: number, c: Color): void {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
    this.px[i + 3] = c[3];
  }
  get(x: number, y: number): Color {
    const i = (y * S + x) * 4;
    return [this.px[i], this.px[i + 1], this.px[i + 2], this.px[i + 3]];
  }
  alpha(x: number, y: number): number {
    return this.px[(y * S + x) * 4 + 3];
  }
  fill(c: Color): this {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) this.set(x, y, c);
    return this;
  }
  /** Multiply brightness of a pixel. */
  shade(x: number, y: number, f: number): void {
    const [r, g, b, a] = this.get(x, y);
    this.set(x, y, [r * f, g * f, b * f, a]);
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: Color): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }
}

const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

function noise(img: Img, rng: Rng, palette: string[], alpha = 255): Img {
  const cols = palette.map((p) => hex(p, alpha));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) img.set(x, y, pick(rng, cols));
  return img;
}

/** Voronoi cells with darkened borders — cobblestone, gravel. */
function cells(img: Img, rng: Rng, palette: string[], count: number, edge = 0.7): Img {
  const seeds = Array.from({ length: count }, () => ({ x: rng() * S, y: rng() * S, c: hex(pick(rng, palette)) }));
  const owner = new Int32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let best = 0;
      let bd = Infinity;
      seeds.forEach((s, i) => {
        const dx = Math.min(Math.abs(x - s.x), S - Math.abs(x - s.x));
        const dy = Math.min(Math.abs(y - s.y), S - Math.abs(y - s.y));
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      owner[y * S + x] = best;
      const c = seeds[best].c;
      const j = 0.9 + rng() * 0.2;
      img.set(x, y, [c[0] * j, c[1] * j, c[2] * j, 255]);
    }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const o = owner[y * S + x];
      if (owner[y * S + ((x + 1) % S)] !== o || owner[((y + 1) % S) * S + x] !== o) img.shade(x, y, edge);
    }
  return img;
}

function specks(img: Img, rng: Rng, colors: string[], clusters: number, size = 3): Img {
  for (let i = 0; i < clusters; i++) {
    let x = 1 + Math.floor(rng() * 14);
    let y = 1 + Math.floor(rng() * 14);
    for (let j = 0; j < size; j++) {
      img.set(x, y, hex(pick(rng, colors)));
      if (rng() < 0.5) x += rng() < 0.5 ? 1 : -1;
      else y += rng() < 0.5 ? 1 : -1;
    }
  }
  return img;
}

function planks(img: Img, rng: Rng, base: string[], dark: string): Img {
  noise(img, rng, base);
  const d = hex(dark);
  for (let y = 0; y < S; y++) {
    if (y % 4 === 3) for (let x = 0; x < S; x++) img.set(x, y, d);
  }
  for (let row = 0; row < 4; row++) {
    const seam = (row * 7 + 3) % S;
    for (let y = row * 4; y < row * 4 + 3; y++) img.set(seam, y, d);
  }
  // wood grain
  for (let i = 0; i < 10; i++) {
    const y = Math.floor(rng() * 16);
    if (y % 4 === 3) continue;
    const x = Math.floor(rng() * 12);
    for (let k = 0; k < 4; k++) img.shade(x + k, y, 0.88);
  }
  return img;
}

function bark(img: Img, rng: Rng, palette: string[], stripe: string): Img {
  noise(img, rng, palette);
  const s = hex(stripe);
  for (let x = 0; x < S; x++) {
    if (rng() < 0.35) {
      const start = Math.floor(rng() * 16);
      const len = 3 + Math.floor(rng() * 8);
      for (let y = start; y < start + len; y++) img.set(x, y % S, s);
    }
  }
  return img;
}

function logTop(img: Img, rng: Rng, inner: string[], ring: string, barkCol: string): Img {
  noise(img, rng, inner);
  const r = hex(ring);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 6.5) img.set(x, y, hex(barkCol));
      else if (Math.round(d) % 2 === 0 && d > 1) img.set(x, y, r);
    }
  return img;
}

function leaves(img: Img, rng: Rng, palette: string[], holeChance = 0.22): Img {
  noise(img, rng, palette);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (rng() < holeChance) img.set(x, y, [0, 0, 0, 0]);
      else if (rng() < 0.15) img.shade(x, y, 0.75);
    }
  return img;
}

function ore(img: Img, rng: Rng, base: 'stone' | 'deepslate', colors: string[]): Img {
  if (base === 'stone') paintStone(img, rng);
  else paintDeepslate(img, rng);
  return specks(img, rng, colors, 5, 4);
}

function paintStone(img: Img, rng: Rng): Img {
  noise(img, rng, ['#7f7f7f', '#7a7a7a', '#858585', '#747474', '#8a8a8a', '#6e6e6e']);
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(rng() * 14);
    const y = Math.floor(rng() * 16);
    const len = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < len; k++) img.shade(x + k, y, 0.85);
  }
  return img;
}

function paintDeepslate(img: Img, rng: Rng): Img {
  noise(img, rng, ['#4d4d55', '#464650', '#55555d', '#3f3f48', '#5b5b63']);
  for (let y = 0; y < S; y += 3 + Math.floor(rng() * 2)) for (let x = 0; x < S; x++) if (rng() < 0.6) img.shade(x, y, 0.8);
  return img;
}

function bricks(img: Img, rng: Rng, brick: string[], mortar: string, h = 4, w = 8): Img {
  noise(img, rng, brick);
  const m = hex(mortar);
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / h);
    if (y % h === h - 1) {
      for (let x = 0; x < S; x++) img.set(x, y, m);
      continue;
    }
    const offset = row % 2 === 0 ? 0 : w / 2;
    for (let x = 0; x < S; x++) if ((x + offset) % w === 0) img.set(x, y, m);
  }
  return img;
}

function metalBlock(img: Img, rng: Rng, palette: string[], light: string, dark: string): Img {
  noise(img, rng, palette);
  const l = hex(light);
  const d = hex(dark);
  for (let i = 0; i < S; i++) {
    img.set(i, 0, l);
    img.set(0, i, l);
    img.set(i, S - 1, d);
    img.set(S - 1, i, d);
  }
  return img;
}

function cross(img: Img, draw: (img: Img) => void): Img {
  img.fill([0, 0, 0, 0]);
  draw(img);
  return img;
}

function stem(img: Img, x: number, top: number, color = '#3f7d2a'): void {
  for (let y = top; y < S; y++) img.set(x, y, hex(color));
}

function flower(img: Img, petal: string, center: string, rng: Rng): Img {
  return cross(img, (im) => {
    stem(im, 7, 7);
    im.set(6, 11, hex('#3f7d2a'));
    im.set(5, 10, hex('#4f9a35'));
    im.set(8, 12, hex('#4f9a35'));
    im.set(9, 11, hex('#4f9a35'));
    const p = hex(petal);
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (rng() < 0.9) im.set(7 + dx, 5 + dy, p);
    }
    im.set(7, 3, p);
    im.set(5, 5, p);
    im.set(9, 5, p);
    im.set(7, 5, hex(center));
  });
}

/** Draws a simple item silhouette from a list of [x, y] pixels with a dark outline. */
function sprite(img: Img, pixels: [number, number][], color: (x: number, y: number) => Color): Img {
  img.fill([0, 0, 0, 0]);
  const set = new Set(pixels.map(([x, y]) => y * S + x));
  for (const [x, y] of pixels) img.set(x, y, color(x, y));
  for (const [x, y] of pixels) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < S && ny < S && !set.has(ny * S + nx) && img.alpha(nx, ny) === 0) img.set(nx, ny, [30, 25, 20, 255]);
    }
  }
  return img;
}

function blob(cx: number, cy: number, rx: number, ry: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) out.push([x, y]);
  return out;
}

function shaded(base: string, rng: Rng, highlight = 1.25, cx = 6, cy = 6): (x: number, y: number) => Color {
  const b = hex(base);
  return (x, y) => {
    const f = 1 + (highlight - 1) * Math.max(0, 1 - Math.hypot(x - cx, y - cy) / 6) - rng() * 0.12;
    return [b[0] * f, b[1] * f, b[2] * f, 255];
  };
}

const TOOL_COLORS: Record<string, [string, string]> = {
  wooden: ['#a2834f', '#6b5132'],
  stone: ['#9a9a9a', '#5f5f5f'],
  iron: ['#e6e6e6', '#9c9c9c'],
  golden: ['#fbe24a', '#c79a1e'],
  diamond: ['#5ff2e6', '#1aa39a'],
  netherite: ['#5a4d55', '#2e2629'],
};

function tool(img: Img, type: string, material: string): Img {
  const [light, dark] = TOOL_COLORS[material];
  img.fill([0, 0, 0, 0]);
  const handle = hex('#6b4f2a');
  const handleDark = hex('#4a3519');
  const l = hex(light);
  const d = hex(dark);
  const handleTop = type === 'sword' ? 10 : 4;
  // Diagonal handle from bottom-left upward.
  for (let i = 0; i < 16 - handleTop; i++) {
    const x = 2 + i;
    const y = 13 - i;
    if (y < handleTop - (type === 'sword' ? 0 : 1)) break;
    img.set(x, y, i % 2 ? handle : handleDark);
    img.set(x + 1, y, handleDark);
  }
  if (type === 'pickaxe') {
    const head: [number, number][] = [[4, 3], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 3], [11, 3], [12, 4], [12, 5], [13, 6], [13, 7], [3, 4], [5, 3], [6, 3], [9, 3], [10, 4], [11, 4], [12, 6]];
    for (const [x, y] of head) img.set(x, y, y <= 2 || x >= 12 ? l : d);
  } else if (type === 'axe') {
    for (let y = 2; y <= 7; y++) for (let x = 8; x <= 12; x++) if (!(x === 12 && (y === 2 || y === 7))) img.set(x, y, x === 12 || y === 2 ? l : d);
  } else if (type === 'shovel') {
    for (let y = 1; y <= 6; y++) for (let x = 10; x <= 14; x++) if (Math.hypot(x - 12, y - 3.5) < 2.8) img.set(x, y, y < 3 ? l : d);
  } else if (type === 'sword') {
    for (let i = 0; i < 9; i++) {
      img.set(6 + i, 9 - i, l);
      img.set(7 + i, 9 - i, d);
      img.set(6 + i, 10 - i, d);
    }
    for (const [x, y] of [[3, 9], [4, 10], [5, 11], [7, 13], [8, 12]]) img.set(x, y, hex('#3a3a3a'));
  }
  return img;
}

/** Crack overlay: thin lines radiating from the centre, longer and more numerous each stage. */
function cracks(img: Img, stage: number): Img {
  img.fill([0, 0, 0, 0]);
  const rng = createRng(1337);
  const c: Color = [24, 24, 24, 170];
  const lines = 3 + stage;
  for (let l = 0; l < lines; l++) {
    let angle = rng() * Math.PI * 2;
    const length = 2 + stage * 0.8 + rng() * 2;
    let x = 7.5 + (rng() - 0.5) * 3;
    let y = 7.5 + (rng() - 0.5) * 3;
    for (let i = 0; i < length; i++) {
      img.set(Math.round(x), Math.round(y), c);
      x += Math.cos(angle);
      y += Math.sin(angle);
      angle += (rng() - 0.5) * 0.9;
    }
  }
  return img;
}

type Painter = (img: Img, rng: Rng) => Img;

const PAINTERS: Record<string, Painter> = {
  missing: (img) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) img.set(x, y, (x < 8) !== (y < 8) ? hex('#f800f8') : hex('#000000'));
    return img;
  },
  stone: paintStone,
  deepslate: paintDeepslate,
  bedrock: (img, rng) => cells(img, rng, ['#565656', '#3a3a3a', '#6e6e6e', '#2a2a2a', '#7a7a7a'], 12, 0.5),
  deepslate_top: (img, rng) => noise(img, rng, ['#4d4d55', '#464650', '#55555d', '#3f3f48']),
  cobblestone: (img, rng) => cells(img, rng, ['#8a8a8a', '#7a7a7a', '#6a6a6a', '#9a9a9a', '#5e5e5e'], 9, 0.55),
  cobbled_deepslate: (img, rng) => cells(img, rng, ['#4f4f57', '#45454d', '#5a5a62', '#3c3c44'], 9, 0.55),
  tuff: (img, rng) => specks(noise(img, rng, ['#6c6d66', '#64655e', '#73746c', '#5d5e58']), rng, ['#888980', '#4e4f49'], 6, 2),
  dirt: (img, rng) => specks(noise(img, rng, ['#866043', '#79553a', '#8f6a4b', '#6d4c33', '#966c4a']), rng, ['#5d4026', '#a07650'], 5, 2),
  grass_block_top: (img, rng) => noise(img, rng, ['#5d9c3a', '#6aac44', '#5a9637', '#72b44c', '#64a33f', '#4f8a30']),
  grass_block_side: (img, rng) => {
    PAINTERS.dirt(img, rng);
    const greens = ['#5d9c3a', '#6aac44', '#5a9637', '#72b44c'];
    for (let x = 0; x < S; x++) {
      const depth = 2 + Math.floor(rng() * 3);
      for (let y = 0; y < depth; y++) img.set(x, y, hex(pick(rng, greens)));
    }
    return img;
  },
  grass_block_snow: (img, rng) => {
    PAINTERS.dirt(img, rng);
    for (let x = 0; x < S; x++) {
      const depth = 3 + Math.floor(rng() * 2);
      for (let y = 0; y < depth; y++) img.set(x, y, hex(pick(rng, ['#f4fbfb', '#e8f2f2', '#ffffff'])));
    }
    return img;
  },
  snow_block: (img, rng) => noise(img, rng, ['#f4fbfb', '#e8f2f2', '#ffffff', '#eef6f6', '#dfeaea']),
  ice: (img, rng) => {
    noise(img, rng, ['#9cc4fc', '#8db8f6', '#a8ccff', '#94befa'], 190);
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(rng() * 12);
      const y = Math.floor(rng() * 12);
      for (let k = 0; k < 4; k++) img.set(x + k, y + k, hex('#d8ecff', 210));
    }
    return img;
  },
  water: (img, rng) => {
    noise(img, rng, ['#2f5fd8', '#3366e0', '#2a56c8', '#3a6fe6'], 170);
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(rng() * 12);
      const y = Math.floor(rng() * 16);
      for (let k = 0; k < 4; k++) img.set(x + k, y, hex('#5a8cf0', 180));
    }
    return img;
  },
  lava: (img, rng) => {
    noise(img, rng, ['#d4500e', '#e0620f', '#c8420c', '#e8701a']);
    // Bright molten veins and a few dark crust specks.
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(rng() * 13);
      const y = Math.floor(rng() * 16);
      for (let k = 0; k < 3 + Math.floor(rng() * 3); k++) img.set(x + k, y, hex(rng() < 0.5 ? '#ffb02e' : '#ffd25a'));
    }
    return specks(img, rng, ['#8a2a06', '#a3360a'], 5, 1);
  },
  sand: (img, rng) => noise(img, rng, ['#dbd3a0', '#e3dbb0', '#d6cd97', '#cfc58c', '#e8e0b8']),
  gravel: (img, rng) => cells(img, rng, ['#837f7e', '#9a9391', '#6e6a69', '#a89f9a', '#5c5857'], 14, 0.75),
  clay: (img, rng) => noise(img, rng, ['#a2a6b6', '#9a9eae', '#a9adbd', '#9296a6']),
  mud: (img, rng) => specks(noise(img, rng, ['#3c3837', '#423d3b', '#363231', '#47423f']), rng, ['#2b2827'], 6, 3),
  sandstone: (img, rng) => {
    noise(img, rng, ['#d8cb94', '#ddd09b', '#d2c48b']);
    for (const y of [3, 4, 10, 11]) for (let x = 0; x < S; x++) img.shade(x, y, 0.92);
    for (let x = 0; x < S; x++) img.shade(x, 15, 0.85);
    return img;
  },
  sandstone_top: (img, rng) => noise(img, rng, ['#dfd3a0', '#d8cb94', '#e4d8a8']),
  oak_log: (img, rng) => bark(img, rng, ['#6b5132', '#5f472b', '#735838', '#665030'], '#4c3920'),
  oak_log_top: (img, rng) => logTop(img, rng, ['#b8945f', '#ad8a56', '#c29d66'], '#977345', '#6b5132'),
  birch_log: (img, rng) => {
    noise(img, rng, ['#e3e3dc', '#d8d8d0', '#ececE6', '#cfcfc6']);
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(rng() * 14);
      const y = Math.floor(rng() * 16);
      const len = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < len; k++) img.set(x + k, y, hex('#2d2d2a'));
    }
    return img;
  },
  birch_log_top: (img, rng) => logTop(img, rng, ['#d7c185', '#cdb77b', '#e0ca8e'], '#b39d63', '#e3e3dc'),
  spruce_log: (img, rng) => bark(img, rng, ['#3b2a17', '#432f1a', '#352512', '#4a3520'], '#2a1d0e'),
  spruce_log_top: (img, rng) => logTop(img, rng, ['#8a6a3c', '#7f6136', '#957343'], '#6c5130', '#3b2a17'),
  cherry_log: (img, rng) => bark(img, rng, ['#3b2229', '#45282f', '#331d23', '#4e2e36'], '#271418'),
  cherry_log_top: (img, rng) => logTop(img, rng, ['#d9a0a0', '#cf9494', '#e3aaa9'], '#b77b7c', '#3b2229'),
  oak_planks: (img, rng) => planks(img, rng, ['#a2834f', '#ae8c55', '#9b7c4a', '#b4925b'], '#7a6038'),
  birch_planks: (img, rng) => planks(img, rng, ['#c8b77a', '#d0bf82', '#c2b073', '#d6c68b'], '#9e8d55'),
  spruce_planks: (img, rng) => planks(img, rng, ['#735531', '#7a5a35', '#6b4f2d', '#80603a'], '#4f3a20'),
  cherry_planks: (img, rng) => planks(img, rng, ['#e3b4a8', '#e9bcb0', '#dcab9f', '#efc4b9'], '#b88579'),
  oak_leaves: (img, rng) => leaves(img, rng, ['#3e7d24', '#4a8c2c', '#356e1f', '#55962f']),
  birch_leaves: (img, rng) => leaves(img, rng, ['#6c9a46', '#78a64f', '#62903f', '#82b058']),
  spruce_leaves: (img, rng) => leaves(img, rng, ['#2f5133', '#38603b', '#29482c', '#3f6a42'], 0.18),
  cherry_leaves: (img, rng) => leaves(img, rng, ['#e9a6c6', '#f2bfd7', '#dd92b6', '#f6cde0', '#d784ab'], 0.18),
  glass: (img) => {
    img.fill([0, 0, 0, 0]);
    const edge = hex('#dcefff', 230);
    for (let i = 0; i < S; i++) {
      img.set(i, 0, edge);
      img.set(i, S - 1, edge);
      img.set(0, i, edge);
      img.set(S - 1, i, edge);
    }
    const shine = hex('#ffffff', 200);
    for (let i = 0; i < 4; i++) img.set(3 + i, 6 - i, shine);
    for (let i = 0; i < 3; i++) img.set(4 + i, 8 - i, shine);
    return img;
  },
  coal_ore: (img, rng) => ore(img, rng, 'stone', ['#2b2b2b', '#1c1c1c', '#3a3a3a']),
  iron_ore: (img, rng) => ore(img, rng, 'stone', ['#d8af93', '#c49a7c', '#e6c2a6']),
  gold_ore: (img, rng) => ore(img, rng, 'stone', ['#fcee4b', '#e8c829', '#fff58a']),
  diamond_ore: (img, rng) => ore(img, rng, 'stone', ['#5decf5', '#3ad1db', '#a6fbff']),
  copper_ore: (img, rng) => ore(img, rng, 'stone', ['#e0835a', '#c56d47', '#4fa58a']),
  deepslate_iron_ore: (img, rng) => ore(img, rng, 'deepslate', ['#d8af93', '#c49a7c', '#e6c2a6']),
  deepslate_diamond_ore: (img, rng) => ore(img, rng, 'deepslate', ['#5decf5', '#3ad1db', '#a6fbff']),
  cactus_side: (img, rng) => {
    noise(img, rng, ['#5a8a2c', '#558427', '#619332']);
    for (const x of [1, 5, 10, 14]) for (let y = 0; y < S; y++) img.shade(x, y, 0.75);
    for (let i = 0; i < 8; i++) img.set(Math.floor(rng() * 16), Math.floor(rng() * 16), hex('#e7e3b3'));
    return img;
  },
  cactus_top: (img, rng) => {
    noise(img, rng, ['#6e9e3a', '#679633', '#76a641']);
    for (let i = 0; i < S; i++) {
      img.shade(i, 0, 0.7);
      img.shade(i, 15, 0.7);
      img.shade(0, i, 0.7);
      img.shade(15, i, 0.7);
    }
    return img;
  },
  crafting_table_top: (img, rng) => {
    planks(img, rng, ['#a2834f', '#ae8c55', '#9b7c4a'], '#7a6038');
    const d = hex('#4a3a22');
    for (let i = 0; i < S; i++) {
      img.set(i, 0, d);
      img.set(i, 15, d);
      img.set(0, i, d);
      img.set(15, i, d);
      img.set(i, 7, d);
      img.set(7, i, d);
    }
    return img;
  },
  crafting_table_side: (img, rng) => {
    planks(img, rng, ['#a2834f', '#ae8c55', '#9b7c4a'], '#7a6038');
    img.rect(0, 0, 15, 2, hex('#6b5132'));
    // saw
    img.rect(3, 5, 9, 6, hex('#c8c8c8'));
    img.rect(10, 5, 11, 7, hex('#6b4f2a'));
    // hammer
    img.rect(4, 10, 6, 11, hex('#8a8a8a'));
    for (let y = 11; y < 15; y++) img.set(5, y, hex('#6b4f2a'));
    return img;
  },
  crafting_table_front: (img, rng) => {
    PAINTERS.crafting_table_side(img, rng);
    img.rect(11, 9, 13, 14, hex('#8a8a8a'));
    img.rect(12, 9, 12, 14, hex('#6b4f2a'));
    return img;
  },
  furnace_top: (img, rng) => noise(img, rng, ['#8c8c8c', '#858585', '#929292', '#7d7d7d']),
  furnace_side: (img, rng) => {
    noise(img, rng, ['#7a7a7a', '#737373', '#808080', '#6d6d6d']);
    img.rect(0, 0, 15, 1, hex('#8f8f8f'));
    return img;
  },
  furnace_front: (img, rng) => {
    PAINTERS.furnace_side(img, rng);
    img.rect(3, 8, 12, 13, hex('#1c1c1c'));
    for (let x = 3; x <= 12; x += 3) for (let y = 8; y <= 13; y++) img.set(x, y, hex('#4a4a4a'));
    img.rect(4, 3, 11, 4, hex('#555555'));
    return img;
  },
  chest_top: (img, rng) => {
    noise(img, rng, ['#a8762d', '#9c6c27', '#b07d32']);
    const d = hex('#3d2a12');
    for (let i = 0; i < S; i++) {
      img.set(i, 0, d);
      img.set(i, 15, d);
      img.set(0, i, d);
      img.set(15, i, d);
    }
    return img;
  },
  chest_side: (img, rng) => {
    PAINTERS.chest_top(img, rng);
    for (let x = 0; x < S; x++) img.set(x, 5, hex('#3d2a12'));
    return img;
  },
  chest_front: (img, rng) => {
    PAINTERS.chest_side(img, rng);
    img.rect(7, 4, 8, 7, hex('#c6c6c6'));
    img.set(7, 7, hex('#3a3a3a'));
    return img;
  },
  torch: (img) =>
    cross(img, (im) => {
      for (let y = 6; y < S; y++) {
        im.set(7, y, hex('#6b4f2a'));
        im.set(8, y, hex('#4a3519'));
      }
      im.rect(7, 4, 8, 5, hex('#ffd34a'));
      im.set(7, 3, hex('#ffef9a'));
      im.set(8, 4, hex('#ff9a2a'));
    }),
  bricks: (img, rng) => bricks(img, rng, ['#965a4a', '#8a5242', '#a2634f', '#7f4a3b'], '#b8aca4'),
  stone_bricks: (img, rng) => bricks(paintStone(img, rng), rng, ['#7d7d7d', '#777777', '#838383'], '#575757', 8, 16),
  obsidian: (img, rng) => specks(noise(img, rng, ['#14101e', '#1b1528', '#0f0c17', '#221a33']), rng, ['#3b2a5c', '#4a3570'], 5, 3),
  short_grass: (img, rng) =>
    cross(img, (im) => {
      for (let i = 0; i < 7; i++) {
        const x = 2 + Math.floor(rng() * 12);
        const h = 5 + Math.floor(rng() * 9);
        for (let y = S - h; y < S; y++) im.set(x + (y < 8 && rng() < 0.3 ? 1 : 0), y, hex(pick(rng, ['#5d9c3a', '#6aac44', '#4f8a30'])));
      }
    }),
  dandelion: (img, rng) => flower(img, '#f5e23a', '#e09a1e', rng),
  poppy: (img, rng) => flower(img, '#d8251e', '#2a1a10', rng),
  cornflower: (img, rng) => flower(img, '#4669d8', '#2e3f8a', rng),
  pink_petals: (img, rng) =>
    cross(img, (im) => {
      stem(im, 4, 11, '#4f8a30');
      stem(im, 11, 12, '#4f8a30');
      for (let i = 0; i < 18; i++) im.set(1 + Math.floor(rng() * 14), 6 + Math.floor(rng() * 8), hex(pick(rng, ['#f2bfd7', '#e9a6c6', '#f8d5e6'])));
    }),
  dead_bush: (img) =>
    cross(img, (im) => {
      const c = hex('#7a5a2c');
      for (let y = 8; y < S; y++) im.set(7, y, c);
      for (let i = 0; i < 5; i++) {
        im.set(7 - i, 9 - i, c);
        im.set(8 + i, 10 - i, c);
      }
      im.set(4, 11, c);
      im.set(10, 12, c);
    }),
  white_wool: (img, rng) => noise(img, rng, ['#e9ecec', '#f2f4f4', '#dfe3e3', '#e4e7e7']),
  bookshelf: (img, rng) => {
    planks(img, rng, ['#a2834f', '#ae8c55'], '#7a6038');
    for (const top of [1, 9]) {
      for (let x = 1; x < 15; x++) {
        const c = hex(pick(rng, ['#8a2a2a', '#2a4a8a', '#2a7a3a', '#c9a24a', '#5a2a6a', '#7a5a3a']));
        const h = 5 + Math.floor(rng() * 2);
        for (let y = top + (6 - h); y < top + 6; y++) img.set(x, y, c);
      }
    }
    return img;
  },
  copper_block: (img, rng) => metalBlock(img, rng, ['#c06c4f', '#b8644a', '#c97557', '#e08b62'], '#f0a07a', '#8c4a35'),
  amethyst_block: (img, rng) => metalBlock(img, rng, ['#8662bf', '#9a73d6', '#7652ad', '#b08ae8'], '#c9a8f5', '#5a3d8a'),
  glowstone: (img, rng) => cells(img, rng, ['#fbda74', '#f9cf5a', '#c8964a', '#ffe9a0', '#a8743a'], 10, 0.8),
  iron_block: (img, rng) => metalBlock(img, rng, ['#dcdcdc', '#e6e6e6', '#d2d2d2'], '#ffffff', '#a8a8a8'),
  gold_block: (img, rng) => metalBlock(img, rng, ['#f8d53e', '#fbe063', '#f1c92e'], '#fff3a0', '#c99a1a'),
  diamond_block: (img, rng) => metalBlock(img, rng, ['#62ede4', '#78f3eb', '#4fd9d0'], '#c8fffb', '#2aa8a0'),
  coal_block: (img, rng) => metalBlock(img, rng, ['#1a1a1a', '#222222', '#141414'], '#3a3a3a', '#0a0a0a'),
  moss_block: (img, rng) => noise(img, rng, ['#5a7a2a', '#64862f', '#4f6e24', '#6e9236']),
  tnt_side: (img, rng) => {
    noise(img, rng, ['#d23a24', '#c8331e', '#db4630']);
    img.rect(0, 5, 15, 10, hex('#e8e8e8'));
    const b = hex('#1a1a1a');
    // T N T letters (tiny)
    for (const [x, y] of [[2, 6], [3, 6], [4, 6], [3, 7], [3, 8], [3, 9], [6, 6], [6, 7], [6, 8], [6, 9], [7, 7], [8, 8], [9, 6], [9, 7], [9, 8], [9, 9], [11, 6], [12, 6], [13, 6], [12, 7], [12, 8], [12, 9]]) img.set(x, y, b);
    return img;
  },
  tnt_top: (img, rng) => {
    noise(img, rng, ['#d23a24', '#c8331e']);
    img.rect(6, 6, 9, 9, hex('#3a3a3a'));
    return img;
  },
  tnt_bottom: (img, rng) => noise(img, rng, ['#d23a24', '#c8331e', '#b52e1b']),

  // ---- items ----
  stick: (img) => {
    img.fill([0, 0, 0, 0]);
    for (let i = 0; i < 11; i++) {
      img.set(3 + i, 13 - i, hex('#6b4f2a'));
      img.set(4 + i, 13 - i, hex('#8a6a3a'));
    }
    return img;
  },
  coal: (img, rng) => sprite(img, blob(7.5, 8, 5, 4.5), shaded('#2a2a2a', rng, 1.8)),
  charcoal: (img, rng) => sprite(img, blob(7.5, 8, 5, 4.5), shaded('#3a2c22', rng, 1.6)),
  raw_iron: (img, rng) => sprite(img, blob(7.5, 8, 5.5, 4.5), shaded('#c9a68c', rng)),
  raw_gold: (img, rng) => sprite(img, blob(7.5, 8, 5.5, 4.5), shaded('#e8c13a', rng)),
  raw_copper: (img, rng) => sprite(img, blob(7.5, 8, 5.5, 4.5), shaded('#c4704d', rng)),
  iron_ingot: (img, rng) => sprite(img, ingot(), shaded('#d8d8d8', rng)),
  gold_ingot: (img, rng) => sprite(img, ingot(), shaded('#f5cf3a', rng)),
  copper_ingot: (img, rng) => sprite(img, ingot(), shaded('#d9794f', rng)),
  netherite_ingot: (img, rng) => sprite(img, ingot(), shaded('#4a3f45', rng, 1.5)),
  brick: (img, rng) => sprite(img, ingot(), shaded('#a5533c', rng)),
  diamond: (img, rng) => {
    const px: [number, number][] = [];
    for (let y = 3; y <= 13; y++) {
      const w = y <= 6 ? 3 + (y - 3) : 6 - Math.floor((y - 6) * 0.85);
      for (let x = 8 - w; x <= 7 + w; x++) px.push([x, y]);
    }
    return sprite(img, px, shaded('#4ee6dd', rng, 1.4, 6, 5));
  },
  wheat: (img) => {
    img.fill([0, 0, 0, 0]);
    for (const x of [5, 8, 11]) {
      for (let y = 6; y < 15; y++) img.set(x, y, hex('#b59a3a'));
      for (let y = 2; y < 7; y++) {
        img.set(x - 1, y, hex('#d9c25a'));
        img.set(x, y, hex('#e8d26a'));
      }
    }
    return img;
  },
  apple: (img, rng) => {
    sprite(img, blob(7.5, 9, 5, 4.5), shaded('#d8261e', rng, 1.4, 6, 7));
    img.set(8, 3, hex('#5a3a1a'));
    img.set(8, 4, hex('#5a3a1a'));
    img.set(9, 3, hex('#3f8a2a'));
    img.set(10, 3, hex('#3f8a2a'));
    return img;
  },
  bread: (img, rng) => sprite(img, blob(7.5, 8.5, 6.5, 3.5), shaded('#c08a3e', rng, 1.3, 7, 6)),
  porkchop: (img, rng) => sprite(img, blob(7.5, 8, 6, 4), shaded('#f0a0a0', rng)),
  cooked_porkchop: (img, rng) => sprite(img, blob(7.5, 8, 6, 4), shaded('#b9805a', rng)),
  beef: (img, rng) => sprite(img, blob(7.5, 8, 6, 4.5), shaded('#c93a35', rng)),
  cooked_beef: (img, rng) => sprite(img, blob(7.5, 8, 6, 4.5), shaded('#7a4a2a', rng)),
  mutton: (img, rng) => sprite(img, blob(7.5, 8, 5, 5), shaded('#d2504a', rng)),
  cooked_mutton: (img, rng) => sprite(img, blob(7.5, 8, 5, 5), shaded('#8f5a3a', rng)),
  rotten_flesh: (img, rng) => sprite(img, blob(7.5, 8, 6, 4), shaded('#7a6a3a', rng, 1.1)),
  leather: (img, rng) => sprite(img, blob(7.5, 8, 6, 6), shaded('#8a4f2a', rng, 1.2)),
  gunpowder: (img, rng) => sprite(img, blob(7.5, 10, 6, 3.5), shaded('#5a5a5a', rng, 1.3, 7, 9)),
  clay_ball: (img, rng) => sprite(img, blob(7.5, 8, 4.5, 4.5), shaded('#a2a6b6', rng)),
  bucket: (img, rng) => bucket(img, rng, null),
  water_bucket: (img, rng) => bucket(img, rng, ['#2f5fd8', '#3a6fe6', '#5a8cf0']),
  lava_bucket: (img, rng) => bucket(img, rng, ['#e0620f', '#ffb02e', '#d4500e']),
};

/** An iron bucket seen from the front, optionally filled with a fluid. */
function bucket(img: Img, rng: Rng, fill: string[] | null): Img {
  const px: [number, number][] = [];
  for (let y = 4; y <= 13; y++) {
    const inset = Math.floor((y - 4) / 3);
    for (let x = 3 + inset; x <= 12 - inset; x++) px.push([x, y]);
  }
  sprite(img, px, shaded('#c8c8c8', rng, 1.3, 5, 6));
  // Dark inner rim, or the fluid surface.
  for (let x = 4; x <= 11; x++) img.set(x, 5, fill ? hex(pick(rng, fill)) : hex('#4a4a4a'));
  if (fill) for (let x = 5; x <= 10; x++) img.set(x, 6, hex(pick(rng, fill)));
  // Handle
  for (let x = 4; x <= 11; x++) img.set(x, 2, hex('#7a7a7a'));
  img.set(3, 3, hex('#7a7a7a'));
  img.set(12, 3, hex('#7a7a7a'));
  return img;
}

function ingot(): [number, number][] {
  const px: [number, number][] = [];
  for (let y = 5; y <= 11; y++) for (let x = 2 + Math.max(0, 7 - y); x <= 13 - Math.max(0, y - 9); x++) px.push([x, y]);
  return px;
}

/**
 * Returns a tile by name as 16*16 RGBA pixels (row 0 = top). Textures generated from the
 * Higgsfield sheets win; the procedural painters remain as a fallback (and for crack overlays).
 */
export function paintTile(name: string): Uint8ClampedArray {
  const generated = GENERATED_TILES[name];
  if (generated) return decodeTile(generated);
  const img = new Img();
  const rng = createRng(hashSeed(name));
  const toolMatch = /^(wooden|stone|iron|golden|diamond|netherite)_(pickaxe|axe|shovel|sword)$/.exec(name);
  const destroy = /^destroy_(\d)$/.exec(name);
  if (toolMatch) tool(img, toolMatch[2], toolMatch[1]);
  else if (destroy) cracks(img, Number(destroy[1]));
  else (PAINTERS[name] ?? PAINTERS.missing)(img, rng);
  return img.px;
}

export function hasPainter(name: string): boolean {
  return name in GENERATED_TILES || name in PAINTERS || /^(wooden|stone|iron|golden|diamond|netherite)_(pickaxe|axe|shovel|sword)$|^destroy_\d$/.test(name);
}
