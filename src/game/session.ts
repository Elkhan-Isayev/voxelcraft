import { B, getBlock } from '../core/blocks';
import { DAY_LENGTH_TICKS, TICKS_PER_SECOND, toChunkCoord } from '../core/constants';
import { isFluidSource, isLava, type FluidKind } from '../core/fluid';
import { I, getItem, isBlockItem } from '../core/items';
import { createRng, type Rng } from '../core/rng';
import { World, type ChunkGenerator } from '../core/world';
import {
  bodyBox,
  createPlayerBody,
  PLAYER,
  stepPlayer,
  type Body,
  type MoveInput,
} from '../physics/player-physics';
import { raycast, rayIntersectsBox, type RayHit, type Vec3 } from '../physics/raycast';
import { FluidSimulator } from '../world/fluids';
import { LightEngine } from '../world/light';
import { TerrainGenerator } from '../world/terrain';
import { daylight } from './daycycle';
import { Furnace } from './furnace';
import { Inventory, addToSlots, type ItemStack, type Slot } from './inventory';
import { breakTime, getDrops } from './mining';
import {
  damageMob,
  explode,
  explosionDamage,
  mobDrops,
  trySpawn,
  updateMob,
  type Mob,
  type MobType,
} from './mobs';
import type { ContainerData, GameMode, SaveData } from './save';
import { MAX_HEALTH, addExhaustion, createStats, damage, eat, fallDamage, tickStats, type Stats } from './survival';

export interface ItemEntity {
  id: number;
  stack: ItemStack;
  body: Body;
  age: number;
  pickupDelay: number;
}

export interface PrimedTnt {
  x: number;
  y: number;
  z: number;
  fuse: number;
}

export type SessionEvent =
  | { type: 'break'; block: number; x: number; y: number; z: number }
  | { type: 'place'; block: number; x: number; y: number; z: number }
  | { type: 'hurt'; amount: number }
  | { type: 'death'; messageKey: string; params: Record<string, string> }
  | { type: 'pickup'; id: number }
  | { type: 'explosion'; x: number; y: number; z: number }
  | { type: 'eat' }
  | { type: 'mobHurt'; mob: MobType }
  | { type: 'toolBroke' }
  | { type: 'bucket'; fluid: FluidKind; filled: boolean }
  | { type: 'step' };

export type ContainerState = { type: 'chest'; slots: Slot[] } | { type: 'furnace'; furnace: Furnace };

export type OpenContainer =
  | { type: 'crafting_table'; grid: Slot[] }
  | { type: 'chest'; slots: Slot[]; key: string }
  | { type: 'furnace'; furnace: Furnace; key: string };

export interface PlayerState {
  body: Body;
  yaw: number;
  pitch: number;
  sneaking: boolean;
  spawn: Vec3;
}

export interface SessionOptions {
  seed: number;
  gameMode: GameMode;
  name?: string;
  id?: string;
  generator?: ChunkGenerator & { findSpawn?: () => Vec3 };
  save?: SaveData;
  rng?: Rng;
  renderDistance?: number;
}

export type UseResult = 'placed' | 'filled' | 'opened' | 'ate' | 'ignited' | 'none';

const CHEST_SIZE = 27;
const SURVIVAL_REACH = 4.5;
const CREATIVE_REACH = 5;
const ENTITY_REACH = 3;
const DESPAWN_DISTANCE = 96;
/** Minecraft: lava deals 4 damage every half second. */
const LAVA_DAMAGE = 4;
const LAVA_DAMAGE_INTERVAL_TICKS = 10;
const BUCKETS = new Set<number>([I.BUCKET, I.WATER_BUCKET, I.LAVA_BUCKET]);

const posKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

export class GameSession {
  readonly world: World;
  readonly fluids: FluidSimulator;
  readonly player: PlayerState;
  inventory = new Inventory();
  stats: Stats = createStats();
  gameMode: GameMode;
  time = 0;
  alive = true;
  mobs: Mob[] = [];
  items: ItemEntity[] = [];
  tnt: PrimedTnt[] = [];
  readonly containers = new Map<string, ContainerState>();
  /** 2x2 crafting grid of the player's own inventory screen. */
  readonly inventoryGrid: Slot[] = [null, null, null, null];
  openContainer: OpenContainer | null = null;
  mining: { x: number; y: number; z: number; progress: number } | null = null;
  readonly meta: { id: string; name: string; seed: number; created: number };
  renderDistance: number;

  private readonly rng: Rng;
  private events: SessionEvent[] = [];
  private tickAccumulator = 0;
  private nextEntityId = 1;
  private creativeBreakCooldown = 0;
  private stepDistance = 0;
  private lavaCooldown = 0;

  constructor(opts: SessionOptions) {
    const generator = opts.generator ?? new TerrainGenerator(opts.seed);
    this.world = new World(generator);
    new LightEngine(this.world);
    this.rng = opts.rng ?? createRng((opts.seed ^ Date.now()) >>> 0);
    this.gameMode = opts.gameMode;
    this.renderDistance = opts.renderDistance ?? 6;
    this.meta = {
      id: opts.id ?? `${Date.now().toString(36)}`,
      name: opts.name ?? 'World',
      seed: opts.seed,
      created: Date.now(),
    };

    this.fluids = new FluidSimulator(this.world, {
      onWashAway: (x, y, z, id) => {
        for (const d of getDrops(id, null, this.rng)) this.spawnItem(d, x + 0.5, y + 0.3, z + 0.5);
      },
    });
    this.world.onBlockChange((x, y, z, oldId, newId) => this.onBlockChanged(x, y, z, oldId, newId));
    this.world.onChunkUnload((c) => {
      this.mobs = this.mobs.filter((m) => toChunkCoord(m.body.x) !== c.cx || toChunkCoord(m.body.z) !== c.cz);
    });

    const save = opts.save;
    if (save) {
      this.world.importEdits(save.edits);
      this.meta.created = save.meta.created;
      this.time = save.time;
      const p = save.player;
      this.player = {
        body: createPlayerBody(p.x, p.y, p.z),
        yaw: p.yaw,
        pitch: p.pitch,
        sneaking: false,
        spawn: { ...p.spawn },
      };
      this.player.body.flying = p.flying && this.gameMode === 'creative';
      this.stats = { ...p.stats };
      this.inventory = Inventory.fromJSON(p.inventory);
      for (const [key, c] of Object.entries(save.containers)) this.containers.set(key, restoreContainer(c));
    } else {
      const spawn = generator.findSpawn ? generator.findSpawn() : this.fallbackSpawn();
      const sp = { x: spawn.x + 0.5, y: spawn.y, z: spawn.z + 0.5 };
      this.player = { body: createPlayerBody(sp.x, sp.y, sp.z), yaw: 0, pitch: 0, sneaking: false, spawn: sp };
      this.time = 0;
    }
  }

  static fromSave(save: SaveData, opts: { generator?: ChunkGenerator; renderDistance?: number; rng?: Rng } = {}): GameSession {
    return new GameSession({
      seed: save.meta.seed,
      gameMode: save.meta.gameMode,
      name: save.meta.name,
      id: save.meta.id,
      generator: opts.generator,
      save,
      rng: opts.rng,
      renderDistance: opts.renderDistance,
    });
  }

  private fallbackSpawn(): Vec3 {
    this.world.ensureChunk(0, 0);
    return { x: 0, y: this.world.getTopSolidY(0, 0) + 1, z: 0 };
  }

  // ---- chunk streaming ------------------------------------------------------

  /** Loads up to `maxNew` missing chunks near the player (closest first) and unloads distant ones. */
  updateChunks(maxNew = 2): number {
    const pcx = toChunkCoord(this.player.body.x);
    const pcz = toChunkCoord(this.player.body.z);
    const r = this.renderDistance;
    const missing: [number, number, number][] = [];
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++)
        if (!this.world.isLoaded(pcx + dx, pcz + dz)) missing.push([dx * dx + dz * dz, pcx + dx, pcz + dz]);
    missing.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(maxNew, missing.length); i++) this.world.ensureChunk(missing[i][1], missing[i][2]);

    const far: [number, number][] = [];
    for (const c of this.world.loadedChunks())
      if (Math.abs(c.cx - pcx) > r + 2 || Math.abs(c.cz - pcz) > r + 2) far.push([c.cx, c.cz]);
    for (const [cx, cz] of far) this.world.unloadChunk(cx, cz);
    return missing.length - Math.min(maxNew, missing.length);
  }

  loadAllChunksNow(): void {
    while (this.updateChunks(64) > 0);
  }

  /** True when the chunk under the player is loaded, so physics can run safely. */
  isReady(): boolean {
    return this.world.isLoaded(toChunkCoord(this.player.body.x), toChunkCoord(this.player.body.z));
  }

  // ---- events -----------------------------------------------------------------

  drainEvents(): SessionEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private emit(e: SessionEvent): void {
    this.events.push(e);
  }

  // ---- looking and targeting -------------------------------------------------

  setLook(yaw: number, pitch: number): void {
    this.player.yaw = yaw;
    this.player.pitch = Math.max(-Math.PI / 2 + 0.0001, Math.min(Math.PI / 2 - 0.0001, pitch));
  }

  eyePosition(): Vec3 {
    const b = this.player.body;
    return { x: b.x, y: b.y + (this.player.sneaking ? PLAYER.sneakEyeHeight : PLAYER.eyeHeight), z: b.z };
  }

  lookDirection(): Vec3 {
    const { yaw, pitch } = this.player;
    return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  }

  reach(): number {
    return this.gameMode === 'creative' ? CREATIVE_REACH : SURVIVAL_REACH;
  }

  target(): RayHit | null {
    return raycast(this.world, this.eyePosition(), this.lookDirection(), this.reach());
  }

  /** The mob under the crosshair, if it is closer than any block. */
  targetMob(): Mob | null {
    const eye = this.eyePosition();
    const dir = this.lookDirection();
    const block = this.target();
    let best: Mob | null = null;
    let bestT = Math.min(this.gameMode === 'creative' ? CREATIVE_REACH : ENTITY_REACH, block?.distance ?? Infinity);
    for (const m of this.mobs) {
      if (m.dead) continue;
      const box = bodyBox(m.body);
      const t = rayIntersectsBox(eye, dir, { x: box.minX, y: box.minY, z: box.minZ }, { x: box.maxX, y: box.maxY, z: box.maxZ }, bestT);
      if (t !== null && t <= bestT) {
        bestT = t;
        best = m;
      }
    }
    return best;
  }

  // ---- actions ------------------------------------------------------------------

  /** Left click. Returns true if a mob was hit. */
  attack(): boolean {
    if (!this.alive) return false;
    const mob = this.targetMob();
    if (!mob) return false;
    const held = this.inventory.selectedStack();
    const dmg = held ? getItem(held.id).attackDamage : 1;
    const dir = this.lookDirection();
    const killed = damageMob(mob, dmg, dir.x, dir.z);
    this.emit({ type: 'mobHurt', mob: mob.type });
    if (this.gameMode === 'survival') {
      addExhaustion(this.stats, 0.1);
      if (held && getItem(held.id).durability) {
        const isWeapon = getItem(held.id).tool?.type === 'sword';
        if (this.inventory.damageSelected(isWeapon ? 1 : 2)) this.emit({ type: 'toolBroke' });
      }
    }
    if (killed) this.killMob(mob);
    return true;
  }

  private killMob(mob: Mob): void {
    for (const d of mobDrops(mob.type, this.rng)) this.spawnItem(d, mob.body.x, mob.body.y + 0.5, mob.body.z, 0.5);
  }

  /** Right click. */
  useItem(sneaking = false): UseResult {
    if (!this.alive) return 'none';
    const hit = this.target();
    const held = this.inventory.selectedStack();

    if (hit && !sneaking) {
      const opened = this.interact(hit.x, hit.y, hit.z, hit.block);
      if (opened !== 'none') return opened;
    }

    if (held && BUCKETS.has(held.id)) return this.useBucket(held.id);

    if (held) {
      const def = getItem(held.id);
      if (def.food && (this.stats.food < 20 || this.gameMode === 'creative')) {
        if (this.gameMode === 'creative' && this.stats.food >= 20) return 'none';
        eat(this.stats, held.id);
        if (this.gameMode === 'survival') this.inventory.consumeSelected();
        this.emit({ type: 'eat' });
        return 'ate';
      }
      if (hit && isBlockItem(held.id)) {
        const target = getBlock(hit.block).replaceable ? hit : { x: hit.x + hit.nx, y: hit.y + hit.ny, z: hit.z + hit.nz };
        if (this.canPlace(held.id, target.x, target.y, target.z)) {
          this.world.setBlock(target.x, target.y, target.z, held.id);
          this.emit({ type: 'place', block: held.id, x: target.x, y: target.y, z: target.z });
          if (this.gameMode === 'survival') this.inventory.consumeSelected();
          return 'placed';
        }
      }
    }
    return 'none';
  }

  /** Empty buckets scoop up a fluid source; full buckets pour one out. */
  private useBucket(held: number): UseResult {
    const survival = this.gameMode === 'survival';
    if (held === I.BUCKET) {
      const hit = raycast(this.world, this.eyePosition(), this.lookDirection(), this.reach(), { fluidSources: true });
      if (!hit || !isFluidSource(hit.block)) return 'none';
      const fluid: FluidKind = isLava(hit.block) ? 'lava' : 'water';
      const filled = fluid === 'lava' ? I.LAVA_BUCKET : I.WATER_BUCKET;
      this.world.setBlock(hit.x, hit.y, hit.z, B.AIR);
      this.emit({ type: 'bucket', fluid, filled: true });
      const slot = this.inventory.selected;
      if (survival && this.inventory.slots[slot]!.count === 1) {
        this.inventory.slots[slot] = { id: filled, count: 1 };
      } else {
        if (survival) this.inventory.consumeSelected();
        if (survival || this.inventory.count(filled) === 0) {
          const left = this.inventory.add({ id: filled, count: 1 });
          if (left > 0) this.dropStack({ id: filled, count: left });
        }
      }
      return 'filled';
    }

    const hit = this.target();
    if (!hit) return 'none';
    const target = getBlock(hit.block).replaceable ? hit : { x: hit.x + hit.nx, y: hit.y + hit.ny, z: hit.z + hit.nz };
    const current = this.world.getBlock(target.x, target.y, target.z);
    if (!getBlock(current).replaceable || isFluidSource(current)) return 'none';
    const fluid: FluidKind = held === I.LAVA_BUCKET ? 'lava' : 'water';
    this.world.setBlock(target.x, target.y, target.z, fluid === 'lava' ? B.LAVA : B.WATER);
    this.emit({ type: 'bucket', fluid, filled: false });
    if (survival) this.inventory.slots[this.inventory.selected] = { id: I.BUCKET, count: 1 };
    return 'placed';
  }

  private interact(x: number, y: number, z: number, block: number): UseResult {
    if (block === B.CRAFTING_TABLE) {
      this.openContainer = { type: 'crafting_table', grid: new Array(9).fill(null) };
      return 'opened';
    }
    if (block === B.CHEST) {
      const c = this.containerAt(x, y, z);
      if (c?.type === 'chest') this.openContainer = { type: 'chest', slots: c.slots, key: posKey(x, y, z) };
      return 'opened';
    }
    if (block === B.FURNACE) {
      const f = this.furnaceAt(x, y, z);
      if (f) this.openContainer = { type: 'furnace', furnace: f, key: posKey(x, y, z) };
      return 'opened';
    }
    if (block === B.TNT) {
      this.world.setBlock(x, y, z, B.AIR);
      this.tnt.push({ x: x + 0.5, y, z: z + 0.5, fuse: 4 });
      return 'ignited';
    }
    return 'none';
  }

  closeContainer(): void {
    const c = this.openContainer;
    if (c?.type === 'crafting_table') this.returnToInventory(c.grid);
    this.returnToInventory(this.inventoryGrid);
    this.openContainer = null;
  }

  /** Moves stacks back into the inventory (dropping what does not fit) and clears the slots. */
  returnToInventory(slots: Slot[]): void {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s) continue;
      const left = this.inventory.add(s);
      if (left > 0) this.dropStack({ ...s, count: left });
      slots[i] = null;
    }
  }

  canPlace(id: number, x: number, y: number, z: number): boolean {
    const current = this.world.getBlock(x, y, z);
    if (!getBlock(current).replaceable || current === id) return false;
    const def = getBlock(id);
    const below = this.world.getBlock(x, y - 1, z);
    if (def.render === 'cross') {
      if (id === B.TORCH) return getBlock(below).solid;
      if (id === B.DEAD_BUSH) return below === B.SAND || below === B.DIRT || below === B.GRASS_BLOCK;
      return below === B.GRASS_BLOCK || below === B.DIRT || below === B.MOSS_BLOCK || below === B.SNOWY_GRASS_BLOCK;
    }
    if (id === B.CACTUS && below !== B.SAND && below !== B.CACTUS) return false;
    if (def.solid) {
      const box = bodyBox(this.player.body);
      if (box.maxX > x && box.minX < x + 1 && box.maxY > y && box.minY < y + 1 && box.maxZ > z && box.minZ < z + 1) return false;
      for (const m of this.mobs) {
        const mb = bodyBox(m.body);
        if (mb.maxX > x && mb.minX < x + 1 && mb.maxY > y && mb.minY < y + 1 && mb.maxZ > z && mb.minZ < z + 1) return false;
      }
    }
    return true;
  }

  /** Middle click in creative: put the targeted block in the hotbar. */
  pickBlock(): void {
    const hit = this.target();
    if (!hit || getBlock(hit.block).noItem) return;
    const slot = this.inventory.slots.findIndex((s, i) => i < 9 && s?.id === hit.block);
    if (slot >= 0) {
      this.inventory.select(slot);
      return;
    }
    if (this.gameMode === 'creative') this.inventory.slots[this.inventory.selected] = { id: hit.block, count: 64 };
  }

  dropSelected(all = false): void {
    const s = this.inventory.selectedStack();
    if (!s || !this.alive) return;
    const count = all ? s.count : 1;
    this.dropStack({ ...s, count });
    this.inventory.consumeSelected(count);
  }

  /** Throws a stack forward from the player's eyes. */
  dropStack(stack: ItemStack): void {
    const eye = this.eyePosition();
    const dir = this.lookDirection();
    const it = this.spawnItem(stack, eye.x, eye.y - 0.3, eye.z, 0);
    it.body.vx = dir.x * 5;
    it.body.vy = dir.y * 5 + 2;
    it.body.vz = dir.z * 5;
    it.pickupDelay = 2;
  }

  spawnItem(stack: ItemStack, x: number, y: number, z: number, spread = 1.5): ItemEntity {
    const body = createPlayerBody(x, y, z, 0.25, 0.25);
    body.vx = (this.rng() - 0.5) * spread * 2;
    body.vz = (this.rng() - 0.5) * spread * 2;
    body.vy = 3 + this.rng() * 2;
    const it: ItemEntity = { id: this.nextEntityId++, stack: { ...stack }, body, age: 0, pickupDelay: 0.5 };
    this.items.push(it);
    return it;
  }

  /** Breaks a block as if mined by the player. */
  breakBlockAt(x: number, y: number, z: number, withDrops: boolean): void {
    const id = this.world.getBlock(x, y, z);
    if (id === B.AIR || getBlock(id).hardness < 0) return;
    const held = this.inventory.selectedStack();
    this.world.setBlock(x, y, z, B.AIR);
    this.emit({ type: 'break', block: id, x, y, z });
    if (withDrops) for (const d of getDrops(id, held?.id ?? null, this.rng)) this.spawnItem(d, x + 0.5, y + 0.3, z + 0.5);
  }

  toggleGameMode(): void {
    this.gameMode = this.gameMode === 'survival' ? 'creative' : 'survival';
    if (this.gameMode === 'survival') this.player.body.flying = false;
    this.mining = null;
  }

  toggleFlying(): void {
    if (this.gameMode !== 'creative') return;
    this.player.body.flying = !this.player.body.flying;
  }

  respawn(): void {
    const b = createPlayerBody(this.player.spawn.x, this.player.spawn.y, this.player.spawn.z);
    Object.assign(this.player.body, b);
    this.stats = createStats();
    this.alive = true;
    this.mining = null;
  }

  day(): number {
    return Math.floor(this.time / DAY_LENGTH_TICKS) + 1;
  }

  daylight(): number {
    return daylight(this.time);
  }

  // ---- containers ------------------------------------------------------------

  private containerAt(x: number, y: number, z: number): ContainerState | undefined {
    const key = posKey(x, y, z);
    let c = this.containers.get(key);
    if (c) return c;
    const block = this.world.getBlock(x, y, z);
    if (block === B.CHEST) c = { type: 'chest', slots: new Array(CHEST_SIZE).fill(null) };
    else if (block === B.FURNACE) c = { type: 'furnace', furnace: new Furnace() };
    if (c) this.containers.set(key, c);
    return c;
  }

  furnaceAt(x: number, y: number, z: number): Furnace | undefined {
    const c = this.containerAt(x, y, z);
    return c?.type === 'furnace' ? c.furnace : undefined;
  }

  // ---- world reactions -------------------------------------------------------

  private onBlockChanged(x: number, y: number, z: number, oldId: number, newId: number): void {
    // Containers spill their contents when destroyed.
    if (oldId === B.CHEST || oldId === B.FURNACE) {
      const key = posKey(x, y, z);
      const c = this.containers.get(key);
      if (c) {
        const stacks = c.type === 'chest' ? c.slots : c.furnace.slots;
        for (const s of stacks) if (s) this.spawnItem(s, x + 0.5, y + 0.5, z + 0.5);
        this.containers.delete(key);
        if (this.openContainer && 'key' in this.openContainer && this.openContainer.key === key) this.openContainer = null;
      }
    }

    const newDef = getBlock(newId);
    // Gravity blocks fall straight down.
    if (newDef.gravity) this.settleGravity(x, y, z);
    if (!newDef.solid) {
      const above = this.world.getBlock(x, y + 1, z);
      if (getBlock(above).gravity) this.settleGravity(x, y + 1, z);
      else if (getBlock(above).render === 'cross') {
        this.world.setBlock(x, y + 1, z, B.AIR);
        for (const d of getDrops(above, null, this.rng)) this.spawnItem(d, x + 0.5, y + 1.3, z + 0.5);
      }
    }
  }

  private settleGravity(x: number, y: number, z: number): void {
    const id = this.world.getBlock(x, y, z);
    let target = y;
    while (target > 0) {
      const below = this.world.getBlock(x, target - 1, z);
      if (below !== B.AIR && !getBlock(below).fluid && !(getBlock(below).replaceable && getBlock(below).render === 'cross')) break;
      target--;
    }
    if (target === y) return;
    this.world.setBlock(x, target, z, id);
    this.world.setBlock(x, y, z, B.AIR);
  }

  // ---- damage -----------------------------------------------------------------

  /** Damages the player. Void damage applies in creative too. */
  hurtPlayer(amount: number, causeKey: string, params: Record<string, string> = {}, bypassCreative = false): void {
    if (!this.alive || amount <= 0) return;
    if (this.gameMode === 'creative' && !bypassCreative) return;
    this.emit({ type: 'hurt', amount });
    if (damage(this.stats, amount)) this.die(causeKey, params);
  }

  private die(messageKey: string, params: Record<string, string>): void {
    this.alive = false;
    this.mining = null;
    this.closeContainer();
    const b = this.player.body;
    for (let i = 0; i < this.inventory.slots.length; i++) {
      const s = this.inventory.slots[i];
      if (s) this.spawnItem(s, b.x, b.y + 1, b.z, 2.5).pickupDelay = 2;
    }
    this.inventory.clear();
    this.emit({ type: 'death', messageKey, params });
  }

  private explodeAt(x: number, y: number, z: number, power: number, sourceMob?: MobType): void {
    explode(this.world, x, y, z, power);
    this.emit({ type: 'explosion', x, y, z });
    const b = this.player.body;
    const d = Math.hypot(b.x - x, b.y + 0.9 - y, b.z - z);
    const dmg = explosionDamage(d, power);
    if (dmg > 0) {
      this.hurtPlayer(dmg, 'death.explosion', { mob: sourceMob ? `mob.${sourceMob}` : 'block.tnt' });
      const len = Math.max(0.5, d);
      b.vx += ((b.x - x) / len) * 8;
      b.vz += ((b.z - z) / len) * 8;
      b.vy = Math.max(b.vy, 6);
    }
    for (const m of this.mobs) {
      const md = Math.hypot(m.body.x - x, m.body.y + 0.5 - y, m.body.z - z);
      const mdmg = explosionDamage(md, power);
      if (mdmg > 0 && !m.dead && damageMob(m, mdmg, m.body.x - x, m.body.z - z)) this.killMob(m);
    }
  }

  // ---- simulation -------------------------------------------------------------

  update(dt: number, move: MoveInput, controls: { attackHeld: boolean }): void {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    if (!this.isReady()) return;
    if (this.alive) this.updatePlayer(dt, move, controls);
    this.updateMobs(dt);
    this.updateItems(dt);
    this.updateTnt(dt);

    this.tickAccumulator += dt * TICKS_PER_SECOND;
    while (this.tickAccumulator >= 1) {
      this.tickAccumulator -= 1;
      this.tick();
    }
  }

  private updatePlayer(dt: number, move: MoveInput, controls: { attackHeld: boolean }): void {
    const b = this.player.body;
    const survival = this.gameMode === 'survival';
    const input = { ...move };
    if (survival && this.stats.food <= 6) input.sprint = false;
    this.player.sneaking = input.sneak && !b.flying;

    const wasOnGround = b.onGround;
    const x0 = b.x;
    const z0 = b.z;
    const ev = stepPlayer(this.world, b, input, this.player.yaw, dt);
    const moved = Math.hypot(b.x - x0, b.z - z0);

    if (survival) {
      if (input.jump && wasOnGround && !b.onGround && b.vy > 0) addExhaustion(this.stats, input.sprint ? 0.2 : 0.05);
      if (input.sprint && moved > 0) addExhaustion(this.stats, moved * 0.1);
    }
    if (b.onGround && moved > 0) {
      this.stepDistance += moved;
      if (this.stepDistance > 1.8) {
        this.stepDistance = 0;
        this.emit({ type: 'step' });
      }
    }
    if (ev.landed && survival) {
      const dmg = fallDamage(ev.fallDistance);
      if (dmg > 0) this.hurtPlayer(dmg, 'death.fall');
    }
    if (b.y < -40) this.hurtPlayer(1000, 'death.void', {}, true);

    this.updateMining(dt, controls.attackHeld);
  }

  private updateMining(dt: number, attackHeld: boolean): void {
    this.creativeBreakCooldown = Math.max(0, this.creativeBreakCooldown - dt);
    if (!attackHeld || this.openContainer) {
      this.mining = null;
      return;
    }
    if (this.targetMob()) {
      this.mining = null;
      return;
    }
    const hit = this.target();
    if (!hit) {
      this.mining = null;
      return;
    }
    const def = getBlock(hit.block);
    if (def.hardness < 0) {
      this.mining = null;
      return;
    }
    if (this.gameMode === 'creative') {
      if (this.creativeBreakCooldown > 0) return;
      this.breakBlockAt(hit.x, hit.y, hit.z, false);
      this.creativeBreakCooldown = 0.25;
      return;
    }

    if (!this.mining || this.mining.x !== hit.x || this.mining.y !== hit.y || this.mining.z !== hit.z) {
      this.mining = { x: hit.x, y: hit.y, z: hit.z, progress: 0 };
    }
    const held = this.inventory.selectedStack();
    let total = breakTime(hit.block, held?.id ?? null);
    if (this.player.body.inWater && !this.player.body.onGround) total *= 5;
    else if (!this.player.body.onGround && !this.player.body.flying) total *= 5;
    this.mining.progress += total === 0 ? 1 : dt / total;
    if (this.mining.progress >= 1) {
      this.breakBlockAt(hit.x, hit.y, hit.z, true);
      addExhaustion(this.stats, 0.005);
      if (held && getItem(held.id).durability && def.hardness > 0) {
        const isSword = getItem(held.id).tool?.type === 'sword';
        if (this.inventory.damageSelected(isSword ? 2 : 1)) this.emit({ type: 'toolBroke' });
      }
      this.mining = null;
    }
  }

  private updateMobs(dt: number): void {
    const b = this.player.body;
    const ctx = {
      world: this.world,
      player: { x: b.x, y: b.y, z: b.z, alive: this.alive, creative: this.gameMode === 'creative' },
      daylight: this.daylight(),
      rng: this.rng,
    };
    for (const m of this.mobs) {
      if (!this.world.isLoaded(toChunkCoord(m.body.x), toChunkCoord(m.body.z))) continue;
      for (const e of updateMob(m, ctx, dt)) {
        if (e.type === 'attack') {
          this.hurtPlayer(e.damage, 'death.mob', { mob: `mob.${e.mob}` });
          const dx = b.x - m.body.x;
          const dz = b.z - m.body.z;
          const len = Math.hypot(dx, dz) || 1;
          if (this.gameMode === 'survival') {
            b.vx += (dx / len) * 6;
            b.vz += (dz / len) * 6;
            b.vy = Math.max(b.vy, 4);
          }
        } else if (e.type === 'explode') {
          this.explodeAt(e.x, e.y, e.z, e.power, e.mob);
        }
      }
    }
    this.mobs = this.mobs.filter((m) => {
      if (m.dead) return false;
      return Math.hypot(m.body.x - b.x, m.body.z - b.z) < DESPAWN_DISTANCE;
    });
  }

  private updateItems(dt: number): void {
    const b = this.player.body;
    const idle: MoveInput = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
    for (const it of this.items) {
      it.age += dt;
      if (this.world.isLoaded(toChunkCoord(it.body.x), toChunkCoord(it.body.z))) stepPlayer(this.world, it.body, idle, 0, dt);
      if (!this.alive || it.age < it.pickupDelay) continue;
      const d = Math.hypot(it.body.x - b.x, it.body.y - (b.y + 0.9), it.body.z - b.z);
      if (d < 1.8) {
        const left = this.inventory.add(it.stack);
        if (left < it.stack.count) this.emit({ type: 'pickup', id: it.stack.id });
        it.stack.count = left;
      }
    }
    this.items = this.items.filter((it) => it.stack.count > 0 && it.age < 300 && it.body.y > -64);
  }

  private updateTnt(dt: number): void {
    for (const t of this.tnt) t.fuse -= dt;
    const exploding = this.tnt.filter((t) => t.fuse <= 0);
    this.tnt = this.tnt.filter((t) => t.fuse > 0);
    for (const t of exploding) this.explodeAt(t.x, t.y + 0.5, t.z, 4);
  }

  private tick(): void {
    this.time++;
    this.fluids.tick();
    this.lavaCooldown = Math.max(0, this.lavaCooldown - 1);
    if (this.alive && this.player.body.inLava && this.lavaCooldown === 0 && this.gameMode === 'survival') {
      this.lavaCooldown = LAVA_DAMAGE_INTERVAL_TICKS;
      this.hurtPlayer(LAVA_DAMAGE, 'death.lava');
    }
    if (this.alive && this.gameMode === 'survival') {
      const before = this.stats.health;
      tickStats(this.stats, { headInWater: this.player.body.headInWater }, 1);
      const lost = before - this.stats.health;
      if (lost > 0) {
        this.emit({ type: 'hurt', amount: lost });
        if (this.stats.health <= 0) this.die(this.stats.food <= 0 ? 'death.starve' : 'death.drown', {});
      }
    } else if (this.alive) {
      this.stats.air = 300;
    }

    for (const [key, c] of this.containers) {
      if (c.type !== 'furnace') continue;
      const [x, , z] = key.split(',').map(Number);
      if (this.world.isLoaded(toChunkCoord(x), toChunkCoord(z))) c.furnace.tick(1);
    }

    if (this.time % 10 === 0) {
      for (let i = 0; i < 2; i++) {
        const m = trySpawn(this.world, this.mobs, this.player.body, this.daylight(), this.rng, this.nextEntityId);
        if (m) {
          this.nextEntityId++;
          this.mobs.push(m);
        }
      }
    }
  }

  // ---- persistence ------------------------------------------------------------

  toSave(): SaveData {
    const b = this.player.body;
    const containers: Record<string, ContainerData> = {};
    for (const [key, c] of this.containers) {
      containers[key] = c.type === 'chest' ? { type: 'chest', slots: c.slots.map((s) => (s ? { ...s } : null)) } : { type: 'furnace', furnace: c.furnace.toJSON() };
    }
    // Items left in an open crafting grid go back to the inventory before saving.
    const inv = Inventory.fromJSON(this.inventory.toJSON());
    for (const grid of [this.inventoryGrid, this.openContainer?.type === 'crafting_table' ? this.openContainer.grid : []])
      for (const s of grid) if (s) addToSlots(inv.slots, s);
    return {
      version: 1,
      meta: {
        id: this.meta.id,
        name: this.meta.name,
        seed: this.meta.seed,
        gameMode: this.gameMode,
        created: this.meta.created,
        lastPlayed: Date.now(),
      },
      time: this.time,
      player: {
        x: b.x,
        y: this.alive ? b.y : this.player.spawn.y,
        z: b.z,
        yaw: this.player.yaw,
        pitch: this.player.pitch,
        flying: b.flying,
        stats: this.alive ? { ...this.stats } : { ...createStats(), health: MAX_HEALTH },
        inventory: inv.toJSON(),
        spawn: { ...this.player.spawn },
      },
      edits: this.world.exportEdits(),
      containers,
    };
  }
}

function restoreContainer(c: ContainerData): ContainerState {
  if (c.type === 'chest') return { type: 'chest', slots: c.slots.map((s) => (s ? { ...s } : null)) };
  return { type: 'furnace', furnace: Furnace.fromJSON(c.furnace) };
}

