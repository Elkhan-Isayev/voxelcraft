import { B } from '../core/blocks';
import { Chunk } from '../core/chunk';
import { CHUNK_SIZE } from '../core/constants';
import { I } from '../core/items';
import { createRng } from '../core/rng';
import type { ChunkGenerator } from '../core/world';
import { createMob } from './mobs';
import { GameSession, type SessionEvent } from './session';
import type { MoveInput } from '../physics/player-physics';

/** Flat world: bedrock, dirt, grass on top at y=4 → players stand at y=5. */
const flat: ChunkGenerator = {
  generate(cx, cz) {
    const c = new Chunk(cx, cz);
    for (let x = 0; x < CHUNK_SIZE; x++)
      for (let z = 0; z < CHUNK_SIZE; z++) {
        c.set(x, 0, z, B.BEDROCK);
        for (let y = 1; y < 4; y++) c.set(x, y, z, B.DIRT);
        c.set(x, 4, z, B.GRASS_BLOCK);
      }
    return c;
  },
};

const idle: MoveInput = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };

function newSession(mode: 'survival' | 'creative' = 'survival'): GameSession {
  const s = new GameSession({ seed: 1, gameMode: mode, name: 'Test', generator: flat, rng: createRng(5), renderDistance: 2 });
  s.loadAllChunksNow();
  s.player.body.x = 0.5;
  s.player.body.z = 0.5;
  s.player.body.y = 5;
  s.player.body.onGround = true;
  s.time = 6000; // noon: no hostile spawns
  return s;
}

function run(s: GameSession, seconds: number, opts: { move?: Partial<MoveInput>; attack?: boolean } = {}): SessionEvent[] {
  const events: SessionEvent[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    s.update(1 / 60, { ...idle, ...opts.move }, { attackHeld: opts.attack ?? false });
    events.push(...s.drainEvents());
  }
  return events;
}

/** Look straight down at the block under the player's feet. */
function lookDown(s: GameSession) {
  s.setLook(0, -Math.PI / 2 + 0.001);
}

describe('GameSession basics', () => {
  test('spawns the player standing on the ground', () => {
    const s = new GameSession({ seed: 1, gameMode: 'survival', generator: flat, rng: createRng(1), renderDistance: 2 });
    s.loadAllChunksNow();
    run(s, 1);
    expect(s.player.body.y).toBeCloseTo(5, 3);
    expect(s.player.body.onGround).toBe(true);
  });

  test('ignores non-positive or NaN frame times', () => {
    const s = newSession();
    const before = { x: s.player.body.x, time: s.time };
    s.update(-1, { ...idle, forward: 1 }, { attackHeld: false });
    s.update(NaN, { ...idle, forward: 1 }, { attackHeld: false });
    expect(s.player.body.x).toBe(before.x);
    expect(s.time).toBe(before.time);
  });

  test('time advances 20 ticks per second and counts days', () => {
    const s = newSession();
    s.time = 0;
    run(s, 1);
    expect(s.time).toBeGreaterThanOrEqual(19);
    expect(s.time).toBeLessThanOrEqual(21);
    s.time = 24000 * 2 + 5;
    expect(s.day()).toBe(3);
  });

  test('loads chunks around the player and unloads far ones', () => {
    const s = newSession();
    expect(s.world.isLoaded(0, 0)).toBe(true);
    expect(s.world.isLoaded(2, 2)).toBe(true);
    s.player.body.x = 16 * 20;
    s.loadAllChunksNow();
    expect(s.world.isLoaded(20, 0)).toBe(true);
    expect(s.world.isLoaded(0, 0)).toBe(false);
  });
});

describe('mining and drops', () => {
  test('holding attack on dirt breaks it and the drop is picked up', () => {
    const s = newSession();
    lookDown(s);
    const events = run(s, 1.5, { attack: true });
    expect(events.some((e) => e.type === 'break' && e.block === B.GRASS_BLOCK)).toBe(true);
    expect(s.world.getBlock(0, 4, 0)).not.toBe(B.GRASS_BLOCK);
    run(s, 1.5);
    expect(s.inventory.count(B.DIRT)).toBeGreaterThanOrEqual(1);
  });

  test('mining progress is exposed for the crack overlay and resets when released', () => {
    const s = newSession();
    lookDown(s);
    run(s, 0.3, { attack: true });
    expect(s.mining?.progress).toBeGreaterThan(0.2);
    expect(s.mining?.progress).toBeLessThan(1);
    run(s, 0.1);
    expect(s.mining).toBeNull();
  });

  test('stone needs a pickaxe to drop, and tools wear down', () => {
    const s = newSession();
    s.world.setBlock(0, 4, 0, B.STONE);
    lookDown(s);
    run(s, 8, { attack: true });
    run(s, 1);
    expect(s.inventory.count(B.COBBLESTONE)).toBe(0);

    s.world.setBlock(0, 4, 0, B.STONE);
    s.player.body.y = 5;
    s.inventory.slots[0] = { id: I.WOODEN_PICKAXE, count: 1 };
    s.inventory.select(0);
    run(s, 2, { attack: true });
    run(s, 1);
    expect(s.inventory.count(B.COBBLESTONE)).toBe(1);
    expect(s.inventory.slots[0]?.damage).toBe(1);
  });

  test('creative mode breaks blocks instantly without drops', () => {
    const s = newSession('creative');
    lookDown(s);
    run(s, 0.05, { attack: true });
    expect(s.world.getBlock(0, 4, 0)).toBe(B.AIR);
    run(s, 1);
    expect(s.inventory.count(B.DIRT)).toBe(0);
  });

  test('bedrock is unbreakable even in creative', () => {
    const s = newSession('creative');
    s.world.setBlock(0, 4, 0, B.BEDROCK);
    lookDown(s);
    run(s, 0.5, { attack: true });
    expect(s.world.getBlock(0, 4, 0)).toBe(B.BEDROCK);
  });
});

describe('placing blocks', () => {
  test('places the held block against the targeted face and consumes it', () => {
    const s = newSession();
    s.inventory.slots[0] = { id: B.OAK_PLANKS, count: 2 };
    s.player.body.x = 2.5;
    s.setLook(Math.PI / 2, -Math.PI / 4); // looking toward -X and down
    const hit = s.target();
    expect(hit).not.toBeNull();
    const res = s.useItem();
    expect(res).toBe('placed');
    expect(s.world.getBlock(hit!.x + hit!.nx, hit!.y + hit!.ny, hit!.z + hit!.nz)).toBe(B.OAK_PLANKS);
    expect(s.inventory.slots[0]!.count).toBe(1);
  });

  test('cannot place a block inside the player', () => {
    const s = newSession();
    s.inventory.slots[0] = { id: B.DIRT, count: 1 };
    lookDown(s);
    expect(s.useItem()).toBe('none');
    expect(s.inventory.slots[0]!.count).toBe(1);
  });

  test('creative placement does not consume items', () => {
    const s = newSession('creative');
    s.inventory.slots[0] = { id: B.STONE, count: 1 };
    s.player.body.x = 2.5;
    s.setLook(Math.PI / 2, -Math.PI / 4);
    s.useItem();
    expect(s.inventory.slots[0]!.count).toBe(1);
  });

  test('torches need solid ground, flowers need soil', () => {
    const s = newSession();
    s.world.setBlock(-2, 4, 0, B.SAND);
    s.player.body.x = 0.5;
    expect(s.canPlace(B.TORCH, -2, 5, 0)).toBe(true);
    expect(s.canPlace(B.POPPY, -2, 5, 0)).toBe(false);
    expect(s.canPlace(B.POPPY, -3, 5, 0)).toBe(true);
    expect(s.canPlace(B.TORCH, -3, 7, 0)).toBe(false);
  });

  test('sand falls when its support is removed', () => {
    const s = newSession();
    s.world.setBlock(5, 5, 5, B.STONE);
    s.world.setBlock(5, 6, 5, B.SAND);
    s.world.setBlock(5, 5, 5, B.AIR);
    expect(s.world.getBlock(5, 6, 5)).toBe(B.AIR);
    expect(s.world.getBlock(5, 5, 5)).toBe(B.SAND);
  });

  test('flowers pop off when the ground below is removed', () => {
    const s = newSession();
    s.world.setBlock(6, 5, 6, B.POPPY);
    s.world.setBlock(6, 4, 6, B.AIR);
    expect(s.world.getBlock(6, 5, 6)).toBe(B.AIR);
  });
});

describe('containers and items', () => {
  test('right-clicking a crafting table opens a 3x3 crafting grid', () => {
    const s = newSession();
    s.world.setBlock(0, 4, -2, B.CRAFTING_TABLE);
    s.setLook(0, -Math.PI / 5);
    expect(s.useItem()).toBe('opened');
    expect(s.openContainer?.type).toBe('crafting_table');
  });

  test('chests keep their contents and drop them when broken', () => {
    const s = newSession();
    s.world.setBlock(0, 4, -2, B.CHEST);
    s.setLook(0, -Math.PI / 5);
    s.useItem();
    const chest = s.openContainer;
    expect(chest?.type).toBe('chest');
    if (chest?.type !== 'chest') return;
    chest.slots[0] = { id: I.DIAMOND, count: 5 };
    s.closeContainer();
    s.useItem();
    expect(s.openContainer?.type === 'chest' && s.openContainer.slots[0]).toEqual({ id: I.DIAMOND, count: 5 });
    s.closeContainer();
    s.breakBlockAt(0, 4, -2, true);
    run(s, 3, { move: { forward: 1 } });
    expect(s.inventory.count(I.DIAMOND)).toBe(5);
  });

  test('furnaces placed in the world keep smelting', () => {
    const s = newSession();
    s.world.setBlock(3, 5, 3, B.FURNACE);
    const f = s.furnaceAt(3, 5, 3)!;
    f.input = { id: B.SAND, count: 1 };
    f.fuel = { id: I.COAL, count: 1 };
    run(s, 10.5);
    expect(f.output).toEqual({ id: B.GLASS, count: 1 });
  });

  test('eating food restores hunger', () => {
    const s = newSession();
    s.stats.food = 10;
    s.inventory.slots[0] = { id: I.BREAD, count: 1 };
    s.setLook(0, Math.PI / 2 - 0.01); // looking at the sky
    expect(s.useItem()).toBe('ate');
    expect(s.stats.food).toBe(15);
    expect(s.inventory.slots[0]).toBeNull();
  });

  test('dropped items cannot be picked up straight away', () => {
    const s = newSession();
    s.inventory.slots[0] = { id: B.DIRT, count: 3 };
    s.dropSelected();
    expect(s.inventory.slots[0]!.count).toBe(2);
    expect(s.items).toHaveLength(1);
    run(s, 0.5);
    expect(s.inventory.count(B.DIRT)).toBe(2);
  });
});

describe('survival', () => {
  test('falling hurts in survival but not in creative', () => {
    const s = newSession();
    s.player.body.y = 20;
    s.player.body.onGround = false;
    const events = run(s, 3);
    expect(s.stats.health).toBe(20 - 12);
    expect(events.some((e) => e.type === 'hurt')).toBe(true);

    const c = newSession('creative');
    c.player.body.y = 20;
    c.player.body.onGround = false;
    run(c, 3);
    expect(c.stats.health).toBe(20);
  });

  test('a deadly fall kills the player with a message, and respawning restores them', () => {
    const s = newSession();
    s.inventory.slots[0] = { id: B.DIRT, count: 10 };
    s.player.body.y = 60;
    s.player.body.onGround = false;
    const events = run(s, 4);
    expect(s.alive).toBe(false);
    expect(events.find((e) => e.type === 'death')).toMatchObject({ type: 'death', messageKey: 'death.fall' });
    expect(s.inventory.count(B.DIRT)).toBe(0);
    expect(s.items.length).toBeGreaterThan(0);
    s.respawn();
    expect(s.alive).toBe(true);
    expect(s.stats.health).toBe(20);
  });

  test('zombies hurt the player', () => {
    const s = newSession();
    s.time = 18000;
    s.mobs.push(createMob('zombie', 1.5, 5, 0.5, 99));
    run(s, 1.2);
    expect(s.stats.health).toBeLessThan(20);
  });

  test('attacking a mob damages it and killing it drops loot', () => {
    const s = newSession();
    const pig = createMob('pig', 0.5, 5, -1.5, 7);
    s.mobs.push(pig);
    s.inventory.slots[0] = { id: I.DIAMOND_SWORD, count: 1 };
    s.setLook(0, -0.3);
    expect(s.attack()).toBe(true);
    expect(pig.health).toBe(3);
    s.attack();
    expect(pig.dead).toBe(true);
    run(s, 0.1);
    expect(s.mobs).not.toContain(pig);
    expect(s.items.some((it) => it.stack.id === I.PORKCHOP)).toBe(true);
  });

  test('creeper explosions damage the player and the terrain', () => {
    const s = newSession();
    s.time = 18000;
    s.mobs.push(createMob('creeper', 2.5, 5, 0.5, 3));
    const events = run(s, 2.5);
    expect(events.some((e) => e.type === 'explosion')).toBe(true);
    expect(s.stats.health).toBeLessThan(20);
    expect(s.world.getBlock(2, 4, 0)).toBe(B.AIR);
  });

  test('switching game modes toggles flight ability', () => {
    const s = newSession();
    s.toggleGameMode();
    expect(s.gameMode).toBe('creative');
    s.toggleFlying();
    expect(s.player.body.flying).toBe(true);
    s.toggleGameMode();
    expect(s.player.body.flying).toBe(false);
  });
});

describe('saving', () => {
  test('a saved session restores world edits, player, inventory, time and containers', () => {
    const s = newSession();
    s.world.setBlock(1, 5, 1, B.DIAMOND_BLOCK);
    s.world.setBlock(2, 5, 2, B.FURNACE);
    s.furnaceAt(2, 5, 2)!.input = { id: B.SAND, count: 4 };
    s.inventory.slots[3] = { id: I.APPLE, count: 7 };
    s.player.body.x = 3.25;
    s.stats.food = 11;
    s.time = 777;
    const data = s.toSave();

    const restored = GameSession.fromSave(JSON.parse(JSON.stringify(data)), { generator: flat, renderDistance: 2 });
    restored.loadAllChunksNow();
    expect(restored.world.getBlock(1, 5, 1)).toBe(B.DIAMOND_BLOCK);
    expect(restored.furnaceAt(2, 5, 2)?.input).toEqual({ id: B.SAND, count: 4 });
    expect(restored.inventory.slots[3]).toEqual({ id: I.APPLE, count: 7 });
    expect(restored.player.body.x).toBe(3.25);
    expect(restored.stats.food).toBe(11);
    expect(restored.time).toBe(777);
    expect(restored.meta.name).toBe('Test');
  });
});
