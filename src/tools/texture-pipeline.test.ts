import { deflateSync, inflateSync } from 'node:zlib';
import { decodePng, sampleCell, encodeTile, decodeTile, type RgbaImage } from './texture-pipeline';

/** Builds a PNG (8-bit RGB) using the given row filter for every row. */
function makePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number], filter = 0): Uint8Array {
  const bpp = 3;
  const stride = width * bpp;
  const raw: number[] = [];
  let prev = new Array(stride).fill(0);
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) row.push(...pixel(x, y));
    raw.push(filter);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw.push((row[i] - pred) & 255);
    }
    prev = row;
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set([...type].map((ch) => ch.charCodeAt(0)), 4);
    out.set(data, 8);
    return out; // CRC left as zero: the decoder does not verify it
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(Buffer.from(raw)))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return png;
}

const inflate = (d: Uint8Array) => new Uint8Array(inflateSync(d));
const at = (img: RgbaImage | Uint8ClampedArray, x: number, y: number, w = 16) => {
  const data = img instanceof Uint8ClampedArray ? img : img.data;
  const width = img instanceof Uint8ClampedArray ? w : img.width;
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};

describe('decodePng', () => {
  test.each([0, 1, 2, 3, 4])('decodes RGB rows with filter type %i', (filter) => {
    const png = makePng(5, 4, (x, y) => [x * 50, y * 60, (x * y * 13) % 256], filter);
    const img = decodePng(png, inflate);
    expect(img.width).toBe(5);
    expect(img.height).toBe(4);
    expect(at(img, 3, 2)).toEqual([150, 120, 78, 255]);
    expect(at(img, 4, 3)).toEqual([200, 180, (12 * 13) % 256, 255]);
  });

  test('rejects data that is not a PNG', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), inflate)).toThrow();
  });
});

/** A 2x2 sheet where each cell holds 16x16 pixel art drawn at 10 screen pixels per art pixel. */
function sheet(art: (cell: number, x: number, y: number) => [number, number, number]): RgbaImage {
  const width = 320;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      const cell = Math.floor(y / 160) * 2 + Math.floor(x / 160);
      const [r, g, b] = art(cell, Math.floor((x % 160) / 10), Math.floor((y % 160) / 10));
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  return { width, height: width, data };
}

const MAGENTA: [number, number, number] = [255, 0, 255];

describe('sampleCell', () => {
  test('recovers the original 16x16 pixel art from a scaled-up cell', () => {
    const img = sheet((cell, x, y) => [cell * 60, x * 16, y * 16]);
    const tile = sampleCell(img, 2, 1, 0, { fit: 'cell' });
    expect(at(tile, 0, 0)).toEqual([60, 0, 0, 255]);
    expect(at(tile, 7, 9)).toEqual([60, 112, 144, 255]);
    expect(at(tile, 15, 15)).toEqual([60, 240, 240, 255]);
  });

  test('keys out the magenta background as transparent', () => {
    const img = sheet((_c, x, y) => (x >= 4 && x < 12 && y >= 4 && y < 12 ? [200, 30, 30] : MAGENTA));
    const tile = sampleCell(img, 2, 0, 0, { fit: 'cell', key: true });
    expect(at(tile, 0, 0)[3]).toBe(0);
    expect(at(tile, 8, 8)).toEqual([200, 30, 30, 255]);
  });

  test('"crop" stretches the drawn content to fill the whole tile (leaves, glass)', () => {
    const img = sheet((_c, x, y) => (x >= 2 && x < 14 && y >= 2 && y < 14 ? [30, 120, 30] : MAGENTA));
    const tile = sampleCell(img, 2, 0, 0, { fit: 'crop', key: true });
    expect(at(tile, 0, 0)).toEqual([30, 120, 30, 255]);
    expect(at(tile, 15, 15)).toEqual([30, 120, 30, 255]);
  });

  test('"contain" keeps the aspect ratio and can sit the object on the bottom edge (plants)', () => {
    // A thin 2x8 stem in the middle of the cell.
    const img = sheet((_c, x, y) => (x >= 7 && x < 9 && y >= 2 && y < 10 ? [40, 140, 40] : MAGENTA));
    const tile = sampleCell(img, 2, 0, 0, { fit: 'contain', key: true, align: 'bottom' });
    expect(at(tile, 7, 15)[3]).toBe(255);
    expect(at(tile, 0, 15)[3]).toBe(0);
    expect(at(tile, 7, 0)[3]).toBe(255);
  });

  test('ignores thin grid lines drawn between cells', () => {
    const img = sheet((cell) => [cell * 50, 100, 100]);
    for (let y = 0; y < 320; y++) img.data.set([0, 0, 0, 255], (y * 320 + 160) * 4);
    const tile = sampleCell(img, 2, 1, 0, { fit: 'cell' });
    expect(at(tile, 0, 5)).toEqual([50, 100, 100, 255]);
  });

  test('can force a fixed alpha (water, ice)', () => {
    const img = sheet(() => [40, 60, 200]);
    const tile = sampleCell(img, 2, 0, 0, { fit: 'cell', alpha: 170 });
    expect(at(tile, 3, 3)[3]).toBe(170);
  });
});

describe('tile encoding', () => {
  test('round-trips RGBA tiles through base64', () => {
    const tile = new Uint8ClampedArray(16 * 16 * 4).map((_, i) => (i * 7) % 256);
    expect(decodeTile(encodeTile(tile))).toEqual(tile);
  });
});
