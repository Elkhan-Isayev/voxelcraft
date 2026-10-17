import { getItem } from '../core/items';
import { toChunkCoord, toLocalCoord } from '../core/constants';
import type { GameSession } from '../game/session';
import { formatClock } from '../game/daycycle';
import type { I18n } from '../i18n';
import { BIOMES } from '../world/terrain';
import { hudIcon, itemIcon } from './icons';
import { bubbleCount, facing, statusIcons } from './hud-logic';
import type { Slot } from '../game/inventory';

export function slotHTML(slot: Slot): string {
  if (!slot) return '';
  const def = getItem(slot.id);
  let html = `<img src="${itemIcon(slot.id)}" alt="">`;
  if (slot.count > 1) html += `<span class="count">${slot.count}</span>`;
  if (def.durability && slot.damage) {
    const f = 1 - slot.damage / def.durability;
    const hue = Math.round(f * 120);
    html += `<span class="durability"><i style="width:${Math.max(4, f * 100)}%;background:hsl(${hue},90%,50%)"></i></span>`;
  }
  return html;
}

export class Hud {
  private readonly hotbar: HTMLDivElement;
  private readonly hearts: HTMLDivElement;
  private readonly food: HTMLDivElement;
  private readonly bubbles: HTMLDivElement;
  private readonly heldName: HTMLDivElement;
  private readonly debug: HTMLDivElement;
  private readonly fps: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly water: HTMLDivElement;
  private readonly statusRow: HTMLDivElement;
  private last = { hotbar: '', hearts: '', food: '', bubbles: '', selected: -1, heldId: -1 };
  private heldNameTimer = 0;
  showDebug = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly i18n: I18n,
  ) {
    root.innerHTML = `
      <div class="underwater hidden"></div>
      <div class="damage-flash"></div>
      <div class="crosshair"></div>
      <div class="debug hidden"></div>
      <div class="fps hidden"></div>
      <div class="hud-bottom">
        <div class="held-name"></div>
        <div class="status-row"><div class="icons bubbles-row"></div><div></div></div>
        <div class="status-row survival-row"><div class="icons hearts"></div><div class="icons right food"></div></div>
        <div class="hotbar"></div>
      </div>`;
    const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
    this.hotbar = q('.hotbar');
    this.hearts = q('.hearts');
    this.food = q('.food');
    this.bubbles = q('.bubbles-row');
    this.heldName = q('.held-name');
    this.debug = q('.debug');
    this.fps = q('.fps');
    this.flash = q('.damage-flash');
    this.water = q('.underwater');
    this.statusRow = q('.survival-row');
  }

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  /** Forces a full redraw (e.g. after a language change). */
  invalidate(): void {
    this.last = { hotbar: '', hearts: '', food: '', bubbles: '', selected: -1, heldId: -1 };
  }

  damageFlash(): void {
    this.flash.classList.add('on');
    this.hearts.classList.remove('shake');
    void this.hearts.offsetWidth;
    this.hearts.classList.add('shake');
    setTimeout(() => this.flash.classList.remove('on'), 60);
  }

  update(s: GameSession, dt: number, fps: number, showFps: boolean, underwater: boolean): void {
    const inv = s.inventory;
    const hotbarSig = JSON.stringify(inv.slots.slice(0, 9));
    if (hotbarSig !== this.last.hotbar || inv.selected !== this.last.selected) {
      this.hotbar.innerHTML = inv.slots
        .slice(0, 9)
        .map((slot, i) => `<div class="slot${i === inv.selected ? ' selected' : ''}">${slotHTML(slot)}</div>`)
        .join('');
      this.last.hotbar = hotbarSig;
    }

    const held = inv.selectedStack();
    const heldId = held?.id ?? -1;
    if (heldId !== this.last.heldId || inv.selected !== this.last.selected) {
      this.heldName.textContent = held ? this.i18n.itemName(held.id) : '';
      this.heldNameTimer = held ? 2.5 : 0;
      this.last.heldId = heldId;
      this.last.selected = inv.selected;
    }
    this.heldNameTimer = Math.max(0, this.heldNameTimer - dt);
    this.heldName.style.opacity = this.heldNameTimer > 0 ? '1' : '0';

    const survival = s.gameMode === 'survival';
    this.statusRow.style.visibility = survival ? 'visible' : 'hidden';
    if (survival) {
      const heartSig = String(s.stats.health);
      if (heartSig !== this.last.hearts) {
        this.hearts.innerHTML = statusIcons(s.stats.health)
          .map((st) => `<img src="${hudIcon(st === 'full' ? 'heart' : st === 'half' ? 'heartHalf' : 'heartEmpty')}" alt="">`)
          .join('');
        this.last.hearts = heartSig;
      }
      const foodSig = String(s.stats.food);
      if (foodSig !== this.last.food) {
        this.food.innerHTML = statusIcons(s.stats.food)
          .map((st) => `<img src="${hudIcon(st === 'full' ? 'food' : st === 'half' ? 'foodHalf' : 'foodEmpty')}" alt="">`)
          .join('');
        this.last.food = foodSig;
      }
    }
    const bubbles = survival ? bubbleCount(s.stats.air) : 0;
    const bubbleSig = String(bubbles);
    if (bubbleSig !== this.last.bubbles) {
      this.bubbles.innerHTML = new Array(bubbles).fill(`<img src="${hudIcon('bubble')}" alt="">`).join('');
      this.last.bubbles = bubbleSig;
    }
    this.water.classList.toggle('hidden', !underwater);

    this.fps.classList.toggle('hidden', !showFps || this.showDebug);
    if (showFps) this.fps.textContent = this.i18n.t('ui.debug.fps', { fps: Math.round(fps) });

    this.debug.classList.toggle('hidden', !this.showDebug);
    if (this.showDebug) this.debug.textContent = this.debugText(s, fps);
  }

  private debugText(s: GameSession, fps: number): string {
    const t = (k: string, p?: Record<string, string | number>) => this.i18n.t(k, p);
    const b = s.player.body;
    const bx = Math.floor(b.x);
    const by = Math.floor(b.y);
    const bz = Math.floor(b.z);
    const cx = toChunkCoord(bx);
    const cz = toChunkCoord(bz);
    const chunk = s.world.getChunk(cx, cz);
    const biome = chunk ? BIOMES[chunk.biomes[toLocalCoord(bx) + toLocalCoord(bz) * 16]] : undefined;
    const chunks = [...s.world.loadedChunks()].length;
    return [
      `VoxelCraft — ${t('ui.debug.fps', { fps: Math.round(fps) })}`,
      t('ui.debug.position', { x: b.x.toFixed(2), y: b.y.toFixed(2), z: b.z.toFixed(2) }),
      t('ui.debug.chunk', { cx, cz }),
      t('ui.debug.facing', { dir: t(`dir.${facing(s.player.yaw)}`) }),
      biome ? t('ui.debug.biome', { biome: t(`biome.${biome}`) }) : '',
      t('ui.debug.light', { sky: s.world.getSkyLight(bx, by, bz), block: s.world.getBlockLight(bx, by, bz) }),
      t('ui.debug.time', { time: `${formatClock(s.time)} — ${t('ui.day', { day: s.day() })}` }),
      t('ui.debug.seed', { seed: s.meta.seed }),
      t('ui.debug.mobs', { count: s.mobs.length }),
      t('ui.debug.chunks', { count: chunks }),
    ]
      .filter(Boolean)
      .join('\n');
  }
}

export function toast(text: string): void {
  const root = document.getElementById('toasts');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  root.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}
