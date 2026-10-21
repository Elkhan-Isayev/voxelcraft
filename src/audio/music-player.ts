import type { Piece } from './music';

const LOOKAHEAD = 2.5;

/** Plays composed pieces on a small additive piano with reverb, scheduling notes just ahead of time. */
export class MusicPlayer {
  private bus: GainNode | null = null;
  private ctx: AudioContext | null = null;
  private piece: Piece | null = null;
  private start = 0;
  private next = 0;
  volume = 0.5;

  private setup(ctx: AudioContext, destination: AudioNode): void {
    if (this.ctx === ctx) return;
    this.ctx = ctx;
    this.bus = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    dry.gain.value = 0.75;
    wet.gain.value = 0.45;
    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(ctx, 3.2);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    this.bus.connect(tone);
    tone.connect(dry).connect(destination);
    tone.connect(reverb).connect(wet).connect(destination);
  }

  /** Decaying stereo noise as a hall impulse response. */
  private impulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }

  get playing(): boolean {
    return !!this.piece && !!this.ctx && this.ctx.currentTime < this.start + this.piece.duration + 4;
  }

  play(piece: Piece, out: { ctx: AudioContext; destination: AudioNode }): void {
    this.setup(out.ctx, out.destination);
    this.piece = piece;
    this.start = out.ctx.currentTime + 0.2;
    this.next = 0;
    this.bus!.gain.cancelScheduledValues(out.ctx.currentTime);
    this.bus!.gain.setValueAtTime(this.volume * 0.5, out.ctx.currentTime);
  }

  /** Fades out whatever is playing. */
  stop(): void {
    if (!this.ctx || !this.bus) return;
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setValueAtTime(this.bus.gain.value, now);
    this.bus.gain.linearRampToValueAtTime(0, now + 1.5);
    this.piece = null;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.bus && this.ctx && this.piece) this.bus.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.1);
  }

  /** Call every frame: schedules the notes that start within the lookahead window. */
  update(): void {
    const { ctx, piece, bus } = this;
    if (!ctx || !piece || !bus) return;
    const horizon = ctx.currentTime + LOOKAHEAD;
    while (this.next < piece.notes.length && this.start + piece.notes[this.next].time < horizon) {
      const n = piece.notes[this.next++];
      this.note(ctx, bus, this.start + n.time, n.midi, n.duration, n.velocity);
    }
  }

  private note(ctx: AudioContext, out: AudioNode, t: number, midi: number, duration: number, velocity: number): void {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const ring = Math.min(5, Math.max(1.2, duration * 1.6)) * (midi < 55 ? 1.4 : 1);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(velocity * 0.35, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    env.connect(out);
    const partials: [number, OscillatorType, number][] = [
      [1, 'sine', 1],
      [2, 'triangle', 0.22],
      [3, 'sine', 0.08],
    ];
    for (const [mult, type, gain] of partials) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * mult;
      // A hair of detune makes the piano sound less sterile.
      osc.detune.value = (Math.random() - 0.5) * 4;
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g).connect(env);
      osc.start(t);
      osc.stop(t + ring + 0.1);
    }
  }
}
