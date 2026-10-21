import { MemoryStorage, SaveManager, type SaveData } from './save';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './settings';

function sampleSave(id: string, name: string, lastPlayed: number): SaveData {
  return {
    version: 1,
    meta: { id, name, seed: 42, gameMode: 'survival', created: 1, lastPlayed },
    time: 1234,
    player: {
      x: 1, y: 70, z: 2, yaw: 0.5, pitch: -0.2, flying: false,
      stats: { health: 18, food: 17, saturation: 1, exhaustion: 0, air: 300, foodTimer: 0, drownTimer: 0 },
      inventory: { slots: [{ id: 3, count: 5 }, ...new Array(35).fill(null)], selected: 0 },
      spawn: { x: 0, y: 70, z: 0 },
    },
    edits: { '0,0': [10, 1, 11, 0] },
    containers: {},
  };
}

describe('SaveManager', () => {
  test('saves and loads a world', () => {
    const sm = new SaveManager(new MemoryStorage());
    const data = sampleSave('a', 'My World', 100);
    sm.save(data);
    expect(sm.load('a')).toEqual(data);
  });

  test('lists worlds, most recently played first', () => {
    const sm = new SaveManager(new MemoryStorage());
    sm.save(sampleSave('a', 'Old', 100));
    sm.save(sampleSave('b', 'New', 200));
    expect(sm.list().map((m) => m.name)).toEqual(['New', 'Old']);
  });

  test('re-saving a world updates it instead of duplicating', () => {
    const sm = new SaveManager(new MemoryStorage());
    sm.save(sampleSave('a', 'World', 100));
    sm.save(sampleSave('a', 'World', 300));
    expect(sm.list()).toHaveLength(1);
    expect(sm.list()[0].lastPlayed).toBe(300);
  });

  test('deletes worlds', () => {
    const storage = new MemoryStorage();
    const sm = new SaveManager(storage);
    sm.save(sampleSave('a', 'World', 100));
    sm.delete('a');
    expect(sm.list()).toEqual([]);
    expect(sm.load('a')).toBeNull();
    expect(storage.size()).toBe(1); // only the (empty) index remains
  });

  test('corrupt or missing data loads as null', () => {
    const storage = new MemoryStorage();
    storage.setItem('voxelcraft.world.x', '{not json');
    const sm = new SaveManager(storage);
    expect(sm.load('x')).toBeNull();
    expect(sm.load('missing')).toBeNull();
  });

  test('a corrupt index is treated as empty', () => {
    const storage = new MemoryStorage();
    storage.setItem('voxelcraft.worlds', 'garbage');
    expect(new SaveManager(storage).list()).toEqual([]);
  });

  test('reports failure when storage is full', () => {
    const storage = new MemoryStorage(50);
    const sm = new SaveManager(storage);
    expect(sm.save(sampleSave('a', 'World', 1))).toBe(false);
  });

  test('generates unique ids', () => {
    const sm = new SaveManager(new MemoryStorage());
    const ids = new Set(Array.from({ length: 50 }, () => sm.newId()));
    expect(ids.size).toBe(50);
  });
});

describe('settings', () => {
  test('defaults when nothing is stored', () => {
    expect(loadSettings(new MemoryStorage(), 'de')).toEqual({ ...DEFAULT_SETTINGS, locale: 'de' });
  });

  test('round-trips through storage', () => {
    const storage = new MemoryStorage();
    const s = { ...DEFAULT_SETTINGS, renderDistance: 10, locale: 'az' as const, invertY: true };
    saveSettings(storage, s);
    expect(loadSettings(storage, 'en')).toEqual(s);
  });

  test('clamps out-of-range values and rejects bad types', () => {
    const storage = new MemoryStorage();
    storage.setItem('voxelcraft.settings', JSON.stringify({ renderDistance: 99, fov: 5, sensitivity: 'fast', locale: 'xx' }));
    const s = loadSettings(storage, 'ru');
    expect(s.renderDistance).toBe(16);
    expect(s.fov).toBe(50);
    expect(s.sensitivity).toBe(DEFAULT_SETTINGS.sensitivity);
    expect(s.locale).toBe('ru');
  });

  test('has a separate music volume, clamped to 0-100', () => {
    expect(DEFAULT_SETTINGS.music).toBe(50);
    const storage = new MemoryStorage();
    storage.setItem('voxelcraft.settings', JSON.stringify({ music: 250 }));
    expect(loadSettings(storage, 'en').music).toBe(100);
  });

  test('survives corrupt settings', () => {
    const storage = new MemoryStorage();
    storage.setItem('voxelcraft.settings', '{{{');
    expect(loadSettings(storage, 'en').renderDistance).toBe(DEFAULT_SETTINGS.renderDistance);
  });
});
