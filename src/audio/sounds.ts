import { getBlock } from '../core/blocks';

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
