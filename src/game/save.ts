import type { WorldEdits } from '../core/world';
import type { FurnaceData } from './furnace';
import type { Slot } from './inventory';
import type { Stats } from './survival';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory storage with an optional size quota (in characters), used in tests and as a fallback. */
export class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, string>();
  constructor(private readonly quota = Infinity) {}

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    let total = value.length;
    for (const [k, v] of this.data) if (k !== key) total += v.length;
    if (total > this.quota) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  size(): number {
    return this.data.size;
  }
}

export type GameMode = 'survival' | 'creative';

export interface WorldMeta {
  id: string;
  name: string;
  seed: number;
  gameMode: GameMode;
  created: number;
  lastPlayed: number;
}

export type ContainerData = { type: 'chest'; slots: Slot[] } | { type: 'furnace'; furnace: FurnaceData };

export interface SaveData {
  version: 1;
  meta: WorldMeta;
  time: number;
  player: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    flying: boolean;
    stats: Stats;
    inventory: { slots: Slot[]; selected: number };
    spawn: { x: number; y: number; z: number };
  };
  edits: WorldEdits;
  /** Block entities keyed by "x,y,z". */
  containers: Record<string, ContainerData>;
}

const INDEX_KEY = 'voxelcraft.worlds';
const worldKey = (id: string) => `voxelcraft.world.${id}`;

export class SaveManager {
  constructor(private readonly storage: KeyValueStorage) {}

  list(): WorldMeta[] {
    return this.readIndex().sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  /** Returns false if the data could not be written (e.g. storage quota exceeded). */
  save(data: SaveData): boolean {
    try {
      this.storage.setItem(worldKey(data.meta.id), JSON.stringify(data));
      const index = this.readIndex().filter((m) => m.id !== data.meta.id);
      index.push(data.meta);
      this.storage.setItem(INDEX_KEY, JSON.stringify(index));
      return true;
    } catch {
      return false;
    }
  }

  load(id: string): SaveData | null {
    const raw = this.storage.getItem(worldKey(id));
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as SaveData;
      return data?.version === 1 && data.meta && data.player ? data : null;
    } catch {
      return null;
    }
  }

  delete(id: string): void {
    this.storage.removeItem(worldKey(id));
    this.storage.setItem(INDEX_KEY, JSON.stringify(this.readIndex().filter((m) => m.id !== id)));
  }

  newId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private readIndex(): WorldMeta[] {
    const raw = this.storage.getItem(INDEX_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

/** Uses localStorage when available, otherwise an in-memory store. */
export function browserStorage(): KeyValueStorage {
  try {
    const ls = globalThis.localStorage;
    const probe = '__voxelcraft_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return new MemoryStorage();
  }
}
