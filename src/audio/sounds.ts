import { getBlock } from '../core/blocks';
import type { MobType } from '../game/mobs';

export type SoundName = 'break' | 'place' | 'step' | 'hurt' | 'pickup' | 'explosion' | 'eat' | 'click' | 'hit' | 'toolBroke' | 'hiss' | 'bucket';

type Material = 'stone' | 'wood' | 'soil' | 'sand' | 'plant' | 'glass';

function materialOf(blockId: number): Material {
  const b = getBlock(blockId);
  if (b.render === 'cross' || b.key.includes('leaves')) return 'plant';
  if (b.key.includes('glass') || b.key === 'ice') return 'glass';
  if (b.key === 'sand' || b.key === 'gravel' || b.key === 'snow_block') return 'sand';
  if (b.tool === 'axe') return 'wood';
  if (b.tool === 'shovel') return 'soil';
  return 'stone';
}

const MATERIAL_TONE: Record<Material, { freq: number; q: number; decay: number }> = {
  stone: { freq: 900, q: 1.2, decay: 0.12 },
  wood: { freq: 450, q: 3, decay: 0.14 },
  soil: { freq: 350, q: 0.8, decay: 0.12 },
  sand: { freq: 2400, q: 0.6, decay: 0.16 },
  plant: { freq: 3200, q: 0.7, decay: 0.1 },
  glass: { freq: 4200, q: 8, decay: 0.25 },
};

/** Tiny synthesizer for game sound effects — no audio files needed. */
export class Sounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  volume = 0.6;

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  private ready(): AudioContext | null {
    if (!this.ctx || !this.master || this.volume <= 0) return null;
    this.master.gain.value = this.volume;
    return this.ctx;
  }

  private noise(freq: number, q: number, duration: number, gain: number, delay = 0, type: BiquadFilterType = 'bandpass'): void {
    const ctx = this.ready();
    if (!ctx || !this.noiseBuffer) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq * (0.9 + Math.random() * 0.2);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5, duration + 0.05);
  }

  private tone(freq: number, endFreq: number, duration: number, gain: number, type: OscillatorType = 'sine', delay = 0): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  /** The shared audio context and output, once unlocked (the music player plays through it too). */
  output(): { ctx: AudioContext; destination: AudioNode } | null {
    return this.ctx ? { ctx: this.ctx, destination: this.ctx.destination } : null;
  }

  /** A voice-like sound: a buzzy source swept from f0 to f1, shaped by formant filters. */
  private voice(
    f0: number,
    f1: number,
    duration: number,
    gain: number,
    formants: number[],
    opts: { delay?: number; vibrato?: [number, number]; noise?: number } = {},
  ): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + duration);
    if (opts.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = opts.vibrato[0];
      depth.gain.value = opts.vibrato[1];
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + duration + 0.05);
    }
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.03);
    env.gain.setValueAtTime(gain, t + duration * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    for (const f of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = 5;
      osc.connect(bp).connect(env);
    }
    env.connect(this.master!);
    osc.start(t);
    osc.stop(t + duration + 0.05);
    if (opts.noise) this.noise(formants[0], 1, duration, opts.noise * gain, opts.delay ?? 0, 'lowpass');
  }

  /** Mob noises: pigs oink, cows moo, sheep baa, zombies groan. */
  mobVoice(type: MobType, kind: 'ambient' | 'hurt', volume = 1): void {
    const v = Math.max(0, Math.min(1, volume));
    if (v === 0) return;
    const hurt = kind === 'hurt';
    switch (type) {
      case 'pig':
        this.voice(hurt ? 420 : 190, hurt ? 260 : 140, 0.14, 0.9 * v, [700, 1400]);
        if (!hurt) this.voice(200, 150, 0.12, 0.7 * v, [700, 1400], { delay: 0.2 });
        break;
      case 'cow':
        this.voice(hurt ? 150 : 115, hurt ? 100 : 92, hurt ? 0.35 : 1.1, 0.9 * v, [500, 1100], { vibrato: [5, 3] });
        break;
      case 'sheep':
        this.voice(hurt ? 340 : 270, hurt ? 300 : 250, hurt ? 0.25 : 0.65, 0.8 * v, [800, 1700], { vibrato: [9, 14] });
        break;
      case 'zombie':
        this.voice(hurt ? 115 : 85, hurt ? 70 : 62, hurt ? 0.35 : 1.3, 0.9 * v, [380, 900], { vibrato: [3, 4], noise: 0.4 });
        break;
      case 'creeper':
        if (hurt) this.noise(300, 0.7, 0.15, 0.6 * v, 0, 'lowpass');
        break;
    }
  }

  play(name: SoundName, blockId = 1): void {
    const m = MATERIAL_TONE[materialOf(blockId)];
    switch (name) {
      case 'break':
        this.noise(m.freq, m.q, m.decay * 1.8, 0.5);
        this.noise(m.freq * 0.7, m.q, m.decay * 1.5, 0.35, 0.04);
        if (materialOf(blockId) === 'glass') this.tone(2400, 1800, 0.3, 0.08, 'triangle');
        break;
      case 'place':
        this.noise(m.freq * 0.8, m.q, m.decay, 0.45);
        break;
      case 'step':
        this.noise(m.freq, m.q, m.decay * 0.6, 0.12);
        break;
      case 'hit':
        this.noise(600, 1, 0.08, 0.4);
        break;
      case 'hurt':
        this.tone(320, 180, 0.18, 0.25, 'square');
        break;
      case 'pickup':
        this.tone(900 + Math.random() * 300, 1600, 0.08, 0.12, 'sine');
        break;
      case 'eat':
        for (let i = 0; i < 3; i++) this.noise(1400, 1.5, 0.08, 0.3, i * 0.12);
        break;
      case 'explosion':
        this.noise(120, 0.5, 1.4, 1.2, 0, 'lowpass');
        this.tone(90, 30, 1.0, 0.6, 'sine');
        break;
      case 'click':
        this.tone(1200, 900, 0.04, 0.1, 'triangle');
        break;
      case 'toolBroke':
        this.tone(1800, 600, 0.25, 0.15, 'sawtooth');
        break;
      case 'hiss':
        this.noise(5000, 0.5, 1.2, 0.25, 0, 'highpass');
        break;
      case 'bucket':
        // A short slosh: two quick low-passed noise bursts.
        this.noise(700, 1.5, 0.18, 0.35, 0, 'lowpass');
        this.noise(500, 1.5, 0.22, 0.3, 0.08, 'lowpass');
        break;
    }
  }
}
