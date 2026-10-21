import { createRng } from '../core/rng';
import { composePiece, MusicDirector, scaleOf } from './music';

describe('composePiece', () => {
  test('is deterministic for a seed', () => {
    expect(composePiece(42, 'day')).toEqual(composePiece(42, 'day'));
    expect(composePiece(42, 'day')).not.toEqual(composePiece(43, 'day'));
  });

  test.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i stays inside its key', (seed) => {
    const piece = composePiece(seed, 'day');
    const scale = scaleOf(piece.key, piece.mode);
    for (const n of piece.notes) expect(scale).toContain(n.midi % 12);
  });

  test('day pieces are major, night pieces minor', () => {
    for (let seed = 1; seed < 6; seed++) {
      const day = composePiece(seed, 'day');
      const night = composePiece(seed, 'night');
      expect(scaleOf(day.key, day.mode)).toContain((day.key + 4) % 12);
      expect(scaleOf(night.key, night.mode)).toContain((night.key + 3) % 12);
      expect(scaleOf(night.key, night.mode)).not.toContain((night.key + 4) % 12);
    }
  });

  test('a piece lasts about a minute or two and is calm and sparse', () => {
    for (let seed = 1; seed < 10; seed++) {
      const p = composePiece(seed, 'day');
      expect(p.duration).toBeGreaterThanOrEqual(45);
      expect(p.duration).toBeLessThanOrEqual(130);
      const rate = p.notes.length / p.duration;
      expect(rate).toBeGreaterThan(0.3);
      expect(rate).toBeLessThan(3);
      for (const n of p.notes) {
        expect(n.time).toBeGreaterThanOrEqual(0);
        expect(n.time + n.duration).toBeLessThanOrEqual(p.duration + 6);
        expect(n.velocity).toBeGreaterThan(0);
        expect(n.velocity).toBeLessThanOrEqual(0.7);
      }
    }
  });

  test('stays in a comfortable piano range and never piles up more than four notes at once', () => {
    const p = composePiece(7, 'night');
    for (const n of p.notes) {
      expect(n.midi).toBeGreaterThanOrEqual(36);
      expect(n.midi).toBeLessThanOrEqual(86);
    }
    const sorted = [...p.notes].sort((a, b) => a.time - b.time);
    for (let i = 0; i < sorted.length; i++) {
      const together = sorted.filter((n) => Math.abs(n.time - sorted[i].time) < 0.03);
      expect(together.length).toBeLessThanOrEqual(4);
    }
  });

  test('has both a bass line and a melody', () => {
    const p = composePiece(3, 'day');
    expect(p.notes.some((n) => n.midi < 60)).toBe(true);
    expect(p.notes.some((n) => n.midi >= 64)).toBe(true);
  });
});

describe('MusicDirector', () => {
  test('starts the first piece after a short delay', () => {
    const d = new MusicDirector(createRng(1));
    let started = 0;
    let at = -1;
    for (let t = 0; t < 30; t += 0.5) {
      if (d.update(0.5, 'day')) {
        started++;
        if (at < 0) at = t;
      }
    }
    expect(started).toBe(1);
    expect(at).toBeGreaterThanOrEqual(3);
    expect(at).toBeLessThanOrEqual(20);
  });

  test('leaves long silences between pieces, like Minecraft', () => {
    const d = new MusicDirector(createRng(2));
    const starts: number[] = [];
    const ends: number[] = [];
    for (let t = 0; t < 1800; t += 0.5) {
      const piece = d.update(0.5, 'day');
      if (piece) {
        starts.push(t);
        ends.push(t + piece.duration);
      }
    }
    expect(starts.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - ends[i - 1]).toBeGreaterThanOrEqual(60);
  });

  test('picks the mood from the time of day', () => {
    const d = new MusicDirector(createRng(3));
    let piece = null;
    for (let t = 0; t < 30 && !piece; t += 0.5) piece = d.update(0.5, 'night');
    expect(piece?.mode).toBe('minor');
  });

  test('stopping resets the schedule', () => {
    const d = new MusicDirector(createRng(4));
    for (let t = 0; t < 30; t += 0.5) d.update(0.5, 'day');
    d.reset();
    expect(d.update(0.5, 'day')).toBeNull();
  });
});
