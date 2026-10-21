import type { Rng } from '../core/rng';
import type { MobType } from '../game/mobs';

export interface VoiceMob {
  id: number;
  type: MobType;
  x: number;
  y: number;
  z: number;
  dead: boolean;
}

export interface VoiceEvent {
  mobId: number;
  type: MobType;
  kind: 'ambient';
  /** 0..1 after distance falloff. */
  volume: number;
}

const HEARING = 16;
const MIN_GAP = 4;
const MAX_GAP = 12;
/** Creepers make no idle noise — you only hear them hiss. */
const SILENT = new Set<MobType>(['creeper']);

/** Decides when nearby mobs grunt, moo, baa or groan, and how loud it is. */
export class MobVoiceScheduler {
  private readonly timers = new Map<number, number>();

  constructor(private readonly rng: Rng) {}

  private nextGap(): number {
    return MIN_GAP + this.rng() * (MAX_GAP - MIN_GAP);
  }

  update(dt: number, mobs: readonly VoiceMob[], listener: { x: number; y: number; z: number }): VoiceEvent[] {
    const events: VoiceEvent[] = [];
    const alive = new Set<number>();
    for (const m of mobs) {
      alive.add(m.id);
      if (m.dead || SILENT.has(m.type)) continue;
      let timer = this.timers.get(m.id);
      if (timer === undefined) timer = MIN_GAP * this.rng() + 0.5;
      timer -= dt;
      if (timer <= 0) {
        timer = this.nextGap();
        const d = Math.hypot(m.x - listener.x, m.y - listener.y, m.z - listener.z);
        if (d < HEARING) events.push({ mobId: m.id, type: m.type, kind: 'ambient', volume: Math.max(0.05, 1 - d / HEARING) });
      }
      this.timers.set(m.id, timer);
    }
    for (const id of this.timers.keys()) if (!alive.has(id)) this.timers.delete(id);
    return events;
  }
}
