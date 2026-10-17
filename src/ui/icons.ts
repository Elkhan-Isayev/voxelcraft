import { getBlock } from '../core/blocks';
import { getItem, isBlockItem } from '../core/items';
import { ATLAS_COLS, TILE_SIZE, tileIndex } from '../render/atlas';

let atlasPixels: Uint8ClampedArray | null = null;
let atlasSize = 0;
const tileCanvases = new Map<string, HTMLCanvasElement>();
const iconCache = new Map<number, string>();

export function initIcons(pixels: Uint8ClampedArray, size: number): void {
  atlasPixels = pixels;
  atlasSize = size;
  tileCanvases.clear();
  iconCache.clear();
}

function tileCanvas(name: string, shade = 1): HTMLCanvasElement {
  const key = `${name}@${shade}`;
  const cached = tileCanvases.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = TILE_SIZE;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);
  const idx = tileIndex(name);
  const ox = (idx % ATLAS_COLS) * TILE_SIZE;
  const oy = Math.floor(idx / ATLAS_COLS) * TILE_SIZE;
  for (let y = 0; y < TILE_SIZE; y++)
    for (let x = 0; x < TILE_SIZE; x++) {
      const src = ((oy + y) * atlasSize + ox + x) * 4;
      const dst = (y * TILE_SIZE + x) * 4;
      img.data[dst] = atlasPixels![src] * shade;
      img.data[dst + 1] = atlasPixels![src + 1] * shade;
      img.data[dst + 2] = atlasPixels![src + 2] * shade;
      // Icons are drawn opaque-ish even for translucent tiles (water, ice).
      img.data[dst + 3] = atlasPixels![src + 3] > 0 ? Math.max(atlasPixels![src + 3], 200) : 0;
    }
  ctx.putImageData(img, 0, 0);
  tileCanvases.set(key, c);
  return c;
}

/** Returns a data URL for an item icon (isometric cube for blocks). */
export function itemIcon(id: number): string {
  const cached = iconCache.get(id);
  if (cached) return cached;
  if (!atlasPixels) return '';
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  if (isBlockItem(id) && getBlock(id).render !== 'cross') {
    const t = getBlock(id).textures;
    const front = t.front ?? t.side;
    // Top face
    ctx.setTransform(1, -0.5, 1, 0.5, 0, 8);
    ctx.drawImage(tileCanvas(t.top, 1), 0, 0);
    // Left face
    ctx.setTransform(1, 0.5, 0, 1, 0, 8);
    ctx.drawImage(tileCanvas(front, 0.8), 0, 0);
    // Right face
    ctx.setTransform(1, -0.5, 0, 1, 16, 16);
    ctx.drawImage(tileCanvas(t.side, 0.62), 0, 0);
  } else {
    const name = isBlockItem(id) ? getBlock(id).textures.side : getItem(id).texture;
    ctx.drawImage(tileCanvas(name), 0, 0, 32, 32);
  }
  const url = c.toDataURL();
  iconCache.set(id, url);
  return url;
}

// ---- HUD pixel icons --------------------------------------------------------------

const PALETTE: Record<string, string> = {
  X: '#1b1b1b',
  R: '#e3262b',
  r: '#9c1418',
  W: '#ffffff',
  D: '#3a1414',
  M: '#c27a3c',
  m: '#8a4f22',
  B: '#efe6d2',
  d: '#3b2a1c',
  C: '#59a8ff',
  c: '#2b6ad4',
};

function pixelIcon(rows: string[]): string {
  const c = document.createElement('canvas');
  c.width = c.height = 9;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = PALETTE[ch];
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return c.toDataURL();
}

const HEART = ['.XX...XX.', 'XRRX.XRRX', 'XRWRXRRRX', 'XRRRRRRRX', 'XRRRRRRrX', '.XRRRRrX.', '..XRRrX..', '...XrX...', '....X....'];
const HEART_HALF = HEART.map((r) => [...r].map((ch, x) => (x > 4 && ch !== 'X' && ch !== '.' ? 'D' : ch)).join(''));
const HEART_EMPTY = HEART.map((r) => r.replace(/[RWr]/g, 'D'));
const FOOD = ['.....XX..', '....XBBX.', '...XBBBX.', '..XMMXBX.', '.XMMMMX..', 'XMMMMmX..', 'XMMMmX...', '.XmmX....', '..XX.....'];
const FOOD_HALF = FOOD.map((r) => [...r].map((ch, x) => (x < 4 && (ch === 'M' || ch === 'm') ? 'd' : ch)).join(''));
const FOOD_EMPTY = FOOD.map((r) => r.replace(/[MmB]/g, 'd'));
const BUBBLE = ['.........', '...ccc...', '..cCCWc..', '.cCCCWCc.', '.cCCCCCc.', '.cCCCCCc.', '..cCCCc..', '...ccc...', '.........'];

let hudIcons: Record<string, string> | null = null;
export function hudIcon(name: 'heart' | 'heartHalf' | 'heartEmpty' | 'food' | 'foodHalf' | 'foodEmpty' | 'bubble'): string {
  if (!hudIcons) {
    hudIcons = {
      heart: pixelIcon(HEART),
      heartHalf: pixelIcon(HEART_HALF),
      heartEmpty: pixelIcon(HEART_EMPTY),
      food: pixelIcon(FOOD),
      foodHalf: pixelIcon(FOOD_HALF),
      foodEmpty: pixelIcon(FOOD_EMPTY),
      bubble: pixelIcon(BUBBLE),
    };
  }
  return hudIcons[name];
}
