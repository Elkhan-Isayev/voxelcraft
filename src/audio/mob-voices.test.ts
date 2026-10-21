import { createRng } from '../core/rng';
import { MobVoiceScheduler, type VoiceMob } from './mob-voices';

const mob = (id: number, x: number, extra: Partial<VoiceMob> = {}): VoiceMob => ({ id, type: 'pig', x, y: 0, z: 0, dead: false, ...extra });
const listener = { x: 0, y: 0, z: 0 };

function run(s: MobVoiceScheduler, mobs: VoiceMob[], seconds: number) {
  const out: ReturnType<MobVoiceScheduler['update']> = [];
  for (let t = 0; t < seconds; t += 0.1) out.push(...s.update(0.1, mobs, listener));
  return out;
}

describe('MobVoiceScheduler', () => {
  test('a nearby mob makes its sound every few seconds', () => {
    const events = run(new MobVoiceScheduler(createRng(1)), [mob(1, 3)], 40);
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.length).toBeLessThanOrEqual(10);
    expect(events[0]).toMatchObject({ type: 'pig', kind: 'ambient' });
  });

  test('distant mobs stay silent', () => {
    expect(run(new MobVoiceScheduler(createRng(2)), [mob(1, 40)], 40)).toEqual([]);
  });

  test('closer mobs are louder', () => {
    const near = run(new MobVoiceScheduler(createRng(3)), [mob(1, 2)], 30)[0].volume;
    const far = run(new MobVoiceScheduler(createRng(3)), [mob(1, 13)], 30)[0].volume;
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(1);
    expect(far).toBeGreaterThan(0);
  });

  test('never repeats a mob within four seconds', () => {
    const s = new MobVoiceScheduler(createRng(4));
    const times: number[] = [];
    for (let t = 0; t < 120; t += 0.1) if (s.update(0.1, [mob(1, 2)], listener).length) times.push(t);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(4 - 1e-6);
  });

  test('dead mobs are silent', () => {
    expect(run(new MobVoiceScheduler(createRng(5)), [mob(1, 2, { dead: true })], 30)).toEqual([]);
  });

  test('every kind of mob has a voice', () => {
    const s = new MobVoiceScheduler(createRng(6));
    const types = ['pig', 'cow', 'sheep', 'zombie', 'creeper'] as const;
    const mobs = types.map((type, i) => mob(i, 2, { type }));
    const heard = new Set(run(s, mobs, 60).map((e) => e.type));
    // Creepers are silent until they hiss, just like in Minecraft.
    expect([...heard].sort()).toEqual(['cow', 'pig', 'sheep', 'zombie']);
  });
});
