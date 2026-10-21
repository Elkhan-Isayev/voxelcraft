/**
 * Turns AI-generated texture sheets (large images with a grid of cells) into crisp 16x16 tiles.
 * Pure functions: used by scripts/build-textures.ts at build time and covered by unit tests.
 */

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type Fit = 'cell' | 'crop' | 'contain';

export interface SampleOptions {
  /** cell: the whole cell; crop: stretch the drawn content to fill; contain: fit content keeping aspect ratio. */
  fit: Fit;
  /** Treat the magenta (#FF00FF) background as transparent. */
  key?: boolean;
  /** For "contain": put the object on the bottom edge (plants) instead of centering it. */
  align?: 'center' | 'bottom';
  /** Force this alpha on every opaque pixel (water, ice). */
  alpha?: number;
}

export const TILE = 16;

// ---- PNG decoding -------------------------------------------------------------

export function decodePng(bytes: Uint8Array, inflate: (data: Uint8Array) => Uint8Array): RgbaImage {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || sig.some((v, i) => bytes[i] !== v)) throw new Error('Not a PNG file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  for (let o = 8; o < bytes.length; ) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
    const data = bytes.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = dv.getUint32(o + 8);
      height = dv.getUint32(o + 12);
      const depth = bytes[o + 16];
      colorType = bytes[o + 17];
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || bytes[o + 20] !== 0)
        throw new Error('Only 8-bit, non-interlaced RGB/RGBA PNGs are supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const compressed = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of idat) {
    compressed.set(c, off);
    off += c.length;
  }
  const raw = inflate(compressed);
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? pixels[dst + i - bpp] : 0;
      const b = y > 0 ? pixels[dst - stride + i] : 0;
      const c = i >= bpp && y > 0 ? pixels[dst - stride + i - bpp] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[dst + i] = (raw[src + i] + pred) & 255;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += bpp) {
    data[i * 4] = pixels[j];
    data[i * 4 + 1] = pixels[j + 1];
    data[i * 4 + 2] = pixels[j + 2];
    data[i * 4 + 3] = bpp === 4 ? pixels[j + 3] : 255;
  }
  return { width, height, data };
}

// ---- cell sampling ------------------------------------------------------------

function isMagenta(r: number, g: number, b: number): boolean {
  return (255 - r) ** 2 + g ** 2 + (255 - b) ** 2 < 140 ** 2;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box of non-magenta pixels inside a rect. */
function contentBounds(img: RgbaImage, r: Rect): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = Math.floor(r.y); y < r.y + r.h; y++)
    for (let x = Math.floor(r.x); x < r.x + r.w; x++) {
      const i = (y * img.width + x) * 4;
      if (isMagenta(img.data[i], img.data[i + 1], img.data[i + 2])) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  if (maxX < minX) return r;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Averages the central half of a source region; returns null when it is mostly magenta. */
function sampleRegion(img: RgbaImage, x0: number, y0: number, w: number, h: number, key: boolean): [number, number, number] | null {
  const xs = Math.floor(x0 + w * 0.25);
  const xe = Math.max(xs + 1, Math.ceil(x0 + w * 0.75));
  const ys = Math.floor(y0 + h * 0.25);
  const ye = Math.max(ys + 1, Math.ceil(y0 + h * 0.75));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  let magenta = 0;
  for (let y = ys; y < ye; y++)
    for (let x = xs; x < xe; x++) {
      const i = (Math.min(img.height - 1, y) * img.width + Math.min(img.width - 1, x)) * 4;
      const pr = img.data[i];
      const pg = img.data[i + 1];
      const pb = img.data[i + 2];
      if (key && isMagenta(pr, pg, pb)) {
        magenta++;
        continue;
      }
      r += pr;
      g += pg;
      b += pb;
      n++;
    }
  if (n === 0 || magenta > n) return null;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/** Extracts one cell of a grid-of-cells sheet as a 16x16 RGBA tile. */
export function sampleCell(img: RgbaImage, grid: number, col: number, row: number, opts: SampleOptions): Uint8ClampedArray {
  const cw = img.width / grid;
  const ch = img.height / grid;
  const inset = Math.ceil(Math.min(cw, ch) * 0.02);
  const full: Rect = { x: col * cw, y: row * ch, w: cw, h: ch };
  // The inset only matters when searching for drawn content (grid lines must not count as content);
  // whole-cell sampling already skips edges because it averages the centre of each pixel.
  const inner: Rect = { x: full.x + inset, y: full.y + inset, w: cw - 2 * inset, h: ch - 2 * inset };
  const key = !!opts.key;
  const content = opts.fit === 'cell' || !key ? full : contentBounds(img, inner);

  // Where the content lands inside the 16x16 tile.
  let tx = 0;
  let ty = 0;
  let tw = TILE;
  let th = TILE;
  if (opts.fit === 'contain') {
    const scale = Math.max(content.w, content.h) / TILE;
    tw = Math.max(1, Math.round(content.w / scale));
    th = Math.max(1, Math.round(content.h / scale));
    tx = Math.floor((TILE - tw) / 2);
    ty = opts.align === 'bottom' ? TILE - th : Math.floor((TILE - th) / 2);
  }

  const out = new Uint8ClampedArray(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      if (x < tx || x >= tx + tw || y < ty || y >= ty + th) continue;
      const sw = content.w / tw;
      const sh = content.h / th;
      const c = sampleRegion(img, content.x + (x - tx) * sw, content.y + (y - ty) * sh, sw, sh, key);
      if (!c) continue;
      out.set([c[0], c[1], c[2], opts.alpha ?? 255], (y * TILE + x) * 4);
    }
  return out;
}

// ---- tile encoding --------------------------------------------------------------

export function encodeTile(tile: Uint8ClampedArray): string {
  let s = '';
  for (let i = 0; i < tile.length; i++) s += String.fromCharCode(tile[i]);
  return btoa(s);
}

export function decodeTile(b64: string): Uint8ClampedArray {
  const s = atob(b64);
  const out = new Uint8ClampedArray(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
