# VoxelCraft

Клон Minecraft в браузере на TypeScript + Three.js, написанный через TDD.
A Minecraft-style voxel game for the browser, built test-first with TypeScript and Three.js.

> Это фанатский проект, он не связан с Mojang или Microsoft. Все текстуры и звуки генерируются кодом — внешних ассетов нет.
> Fan project, not affiliated with Mojang or Microsoft. All textures and sounds are generated in code.

---

## 🇷🇺 Как играть на MacBook

**Вариант 1 — двойной клик:** откройте папку в Finder и дважды кликните `Play VoxelCraft.command`
(при первом запуске macOS может спросить разрешение: *ПКМ → Открыть*). Игра откроется в браузере.

**Вариант 2 — терминал:**

```bash
npm install
npm run dev
```

Нужен [Node.js](https://nodejs.org) 18+ (LTS). Лучше всего работает в Safari или Chrome.

### Управление

| Клавиша | Действие |
| --- | --- |
| W A S D | ходьба |
| Пробел | прыжок / всплыть / лететь вверх |
| Shift | красться (не падаешь с края) / лететь вниз |
| Ctrl или двойное W | бег |
| ЛКМ (удерживать) | ломать блок / атаковать |
| ПКМ | поставить блок / открыть верстак, печь, сундук / съесть / поджечь TNT |
| СКМ | взять блок (творческий режим) |
| 1–9, колесо мыши | слот панели быстрого доступа |
| E | инвентарь |
| Q / Ctrl+Q | выбросить предмет / весь стек |
| Двойной пробел | полёт (творческий режим) |
| G | переключить выживание ↔ творческий |
| F3 (на Mac: fn+F3) | отладочная информация |
| Esc | пауза |

В инвентаре: ЛКМ — взять/положить, ПКМ — половина/один предмет, Shift+клик — быстро переместить или скрафтить всё.

### Что есть в игре
- Бесконечный процедурный мир с ключом генерации: равнины, леса, березняки, тайга, пустыни, снежные равнины, заснеженные пики, холмы, болота, океаны, пляжи и **вишнёвые рощи** (1.20).
- Пещеры, руды (уголь, железо, медь, золото, алмазы), слой глубинного сланца и туфа (1.17+), деревья четырёх видов, цветы, кактусы.
- Освещение как в Minecraft: солнечный свет и свет от факелов/светокамня, смена дня и ночи, звёзды, облака, закаты.
- Выживание: здоровье, голод и насыщение, урон от падения, утопление, смерть и возрождение.
- Добыча с правильными инструментами и временем разрушения, прочность инструментов, крафт 2×2 и 3×3 (50+ рецептов, 60+ блоков, 100+ предметов), печь с топливом, сундуки.
- Мобы: свиньи, коровы, овцы, зомби (горят днём), криперы (взрываются).
- Творческий режим с поиском по всем предметам и полётом.
- Сохранение миров в браузере, автосохранение каждую минуту.
- **4 языка:** English, Deutsch, Azərbaycanca, Русский (выбор на главном экране или в настройках).

---

## 🇬🇧 Running it

```bash
npm install
npm run dev        # dev server, opens the browser
npm test           # unit tests (Vitest)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

On macOS you can also double-click **`Play VoxelCraft.command`**.

## Tests

The game logic was written test-first. Every module below has a unit-test file next to it
(`*.test.ts`), ~270 tests in total, running in about 4 seconds:

| Area | What the tests pin down |
| --- | --- |
| `core/` | seeded RNG and simplex noise, block & item registry, chunk storage, world edits, dirty-section tracking |
| `world/terrain` | determinism, bedrock, sea level, biomes (incl. cherry grove), deserts, ores by depth, deepslate, caves, trees, spawn point |
| `world/light` | sky light, shadows, torch light falloff, removal, walls, cross-chunk propagation, water dimming |
| `physics/` | gravity, landing, fall distance, walking/sprinting/sneaking speeds, jump height, wall sliding, no tunnelling, ceilings, sneaking at edges, swimming, flying, raycasting, bad time steps |
| `game/` | inventory & slot clicking, crafting (shaped/shapeless/mirrored/tags), mining speed & drops, furnace, health/hunger/air, day cycle, mobs (AI, combat, drops, explosions, spawning), saving, settings, and a full `GameSession` integration suite |
| `render/` | texture atlas & procedural textures, chunk mesher (culling, AO, light, water, plants, fast path equivalence) |
| `i18n/` | all 4 languages have identical keys and placeholders, every block/item/biome is named, fallback, browser language detection |
| `ui/`, `input/` | HUD icons, tooltips, death messages, shift-click routing, crafting result taking, creative search, keyboard state machine |

## Architecture

```
src/
  core/       blocks, items, chunks, world, noise, RNG        (pure logic)
  world/      terrain generator, light engine                 (pure logic)
  physics/    AABB collision, player movement, raycasting     (pure logic)
  game/       session (the game rules), inventory, crafting,
              mining, furnace, survival, mobs, saves, settings (pure logic)
  i18n/       translations: en, de, az, ru
  render/     atlas + procedural textures, mesher (pure), Three.js renderer, sky, entities
  ui/         HUD, menus, inventory screens (DOM)
  audio/      WebAudio sound synthesizer
  app.ts      state machine, input, game loop
```

`GameSession` is the headless heart of the game — everything the player can do goes through it,
so the integration tests drive it exactly like the UI does.

## Known limitations

This is a compact re-imagining, not a 1:1 copy of Minecraft 1.21:
world height is 128 blocks; water does not flow; there are no redstone, villages, the Nether/End,
multiplayer, beds, doors or slabs; furnaces and crafting tables have no facing direction.
