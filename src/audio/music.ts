import { createRng, type Rng } from '../core/rng';

/**
 * Original generative piano music in a calm, ambient style: slow tempo, soft seventh chords,
 * a gentle bass arpeggio and a sparse, breathing melody. Pure composition logic, unit-tested;
 * playback lives in music-player.ts.
 */

export type Mood = 'menu' | 'day' | 'night';
export type Mode = 'major' | 'minor';

export interface Note {
  /** Seconds from the start of the piece. */
  time: number;
  midi: number;
  duration: number;
  /** 0..1 loudness. */
  velocity: number;
}

export interface Piece {
  key: number;
  mode: Mode;
  tempo: number;
  duration: number;
  notes: Note[];
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const KEYS = [0, 2, 3, 5, 7, 9];

const PROGRESSIONS: Record<Mode, number[][]> = {
  major: [
    [0, 5, 3, 4],
    [0, 2, 3, 3],
    [5, 3, 0, 4],
    [0, 3, 5, 4],
    [3, 4, 2, 5],
    [0, 4, 5, 3],
  ],
  minor: [
    [0, 5, 2, 6],
    [0, 3, 6, 2],
    [0, 6, 5, 4],
    [0, 3, 0, 5],
    [5, 6, 0, 0],
  ],
};

export function scaleOf(key: number, mode: Mode): number[] {
  return (mode === 'major' ? MAJOR : MINOR).map((s) => (key + s) % 12);
}

const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

/** All MIDI notes of the scale within [lo, hi]. */
function scaleNotes(key: number, mode: Mode, lo: number, hi: number): number[] {
  const pcs = new Set(scaleOf(key, mode));
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.has(m % 12)) out.push(m);
  return out;
}

/** Chord tones (root, third, fifth, seventh) of a scale degree as pitch classes. */
function chordPcs(key: number, mode: Mode, degree: number): number[] {
  const steps = mode === 'major' ? MAJOR : MINOR;
  return [0, 2, 4, 6].map((i) => (key + steps[(degree + i) % 7]) % 12);
}

export function composePiece(seed: number, mood: Mood): Piece {
  const rng = createRng(Math.imul(seed, 7919) + (mood === 'night' ? 1 : mood === 'menu' ? 2 : 0));
  const mode: Mode = mood === 'night' ? 'minor' : 'major';
  const key = pick(rng, KEYS);
  const tempo = (mood === 'menu' ? 52 : 56) + Math.floor(rng() * 14);
  const beat = 60 / tempo;
  const bars = pick(rng, [16, 20, 24]);
  const progression = pick(rng, PROGRESSIONS[mode]);
  const notes: Note[] = [];
  const human = () => (rng() - 0.5) * 0.03;
  const add = (beatPos: number, midi: number, beats: number, velocity: number) =>
    notes.push({ time: Math.max(0, beatPos * beat + human()), midi, duration: beats * beat, velocity: Math.min(0.7, velocity) });

  const bass = scaleNotes(key, mode, 40, 62);
  const melody = scaleNotes(key, mode, 64, 84);
  let melodyIdx = Math.floor(melody.length / 3);

  for (let bar = 0; bar < bars; bar += 2) {
    const chordIdx = (bar / 2) % progression.length;
    const isLast = bar + 2 >= bars;
    const degree = isLast ? 0 : progression[chordIdx];
    const chord = chordPcs(key, mode, degree);
    const start = bar * 4;

    // Bass: a slow broken chord across two bars.
    const tones = bass.filter((m) => chord.includes(m % 12));
    const root = tones.find((m) => m % 12 === chord[0]) ?? tones[0];
    const pattern = isLast ? [0] : [0, 1.5, 3, 4, 5.5];
    pattern.forEach((b, i) => {
      const candidates = tones.filter((m) => m >= root);
      const note = i === 0 ? root : candidates[Math.min(candidates.length - 1, i)] ?? root;
      add(start + b, note, isLast ? 8 : 2.5, 0.28 + rng() * 0.1);
    });

    // Melody: sparse, stepwise, leaning on chord tones; it rests at the end of every 4-bar phrase.
    if (bar < 2) continue; // let the bass introduce the piece
    for (let b = 0; b < 8; b++) {
      const phraseEnd = (bar + (b >= 4 ? 1 : 0)) % 4 === 3 && b % 4 >= 2;
      if (phraseEnd || isLast) continue;
      const strong = b % 2 === 0;
      if (rng() > (strong ? 0.55 : 0.3)) continue;
      melodyIdx = Math.max(0, Math.min(melody.length - 1, melodyIdx + Math.round((rng() - 0.5) * 4)));
      if (strong) {
        // Snap to the nearest chord tone on strong beats.
        const isChordTone = (i: number) => i >= 0 && i < melody.length && chord.includes(melody[i] % 12);
        for (let d = 0; d < 3; d++) {
          if (isChordTone(melodyIdx + d)) {
            melodyIdx += d;
            break;
          }
          if (isChordTone(melodyIdx - d)) {
            melodyIdx -= d;
            break;
          }
        }
      }
      const offbeat = !strong && rng() < 0.3 ? 0.5 : 0;
      add(start + b + offbeat, melody[melodyIdx], 1 + Math.floor(rng() * 3), 0.32 + rng() * 0.2);
    }
  }

  // Final tonic chord, held.
  const lastStart = bars * 4;
  const tonic = chordPcs(key, mode, 0).slice(0, 3);
  const top = melody.filter((m) => tonic.includes(m % 12)).slice(0, 2);
  for (const m of top) add(lastStart - 4, m, 6, 0.3);

  const duration = bars * 4 * beat;
  return { key, mode, tempo, duration, notes: notes.sort((a, b) => a.time - b.time) };
}

/** Decides when a new piece plays: a short wait at first, then long silences between pieces. */
export class MusicDirector {
  private remaining: number;

  constructor(private readonly rng: Rng) {
    this.remaining = this.firstDelay();
  }

  private firstDelay(): number {
    return 3 + this.rng() * 12;
  }

  /** Returns a piece to start now, or null. */
  update(dt: number, mood: Mood): Piece | null {
    this.remaining -= dt;
    if (this.remaining > 0) return null;
    const piece = composePiece(Math.floor(this.rng() * 1e9), mood);
    this.remaining = piece.duration + 60 + this.rng() * 120;
    return piece;
  }

  reset(): void {
    this.remaining = this.firstDelay();
  }
}
