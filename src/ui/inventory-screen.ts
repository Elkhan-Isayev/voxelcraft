import { getItem } from '../core/items';
import { clickSlot, type Slot } from '../game/inventory';
import type { GameSession } from '../game/session';
import type { I18n } from '../i18n';
import { craftPreview, paletteItems, shiftClickContainer, shiftClickInventory, takeCraftResult } from './container-logic';
import { itemTooltip } from './hud-logic';
import { slotHTML } from './hud';

type SlotGroup = 'inv' | 'grid' | 'result' | 'container' | 'furnace' | 'palette';

/**
 * The inventory overlay. Works on the session's live data; re-renders the slots after each click.
 */
export class InventoryScreen {
  private cursor: Slot = null;
  private el: HTMLDivElement | null = null;
  private cursorEl: HTMLDivElement | null = null;
  private tooltipEl: HTMLDivElement | null = null;
  private search = '';
  private mouse = { x: 0, y: 0 };
  private readonly onMove = (e: MouseEvent) => this.trackMouse(e);
  onChange: () => void = () => {};

  constructor(
    private readonly root: HTMLElement,
    private readonly i18n: I18n,
    private readonly session: GameSession,
  ) {}

  get isOpen(): boolean {
    return this.el !== null;
  }

  open(): void {
    this.close();
    this.el = document.createElement('div');
    this.el.className = 'screen dim';
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.el.addEventListener('mousedown', (e) => {
      if (e.target === this.el && this.cursor) {
        // Clicking outside the panel throws the held stack away.
        if (this.session.gameMode === 'survival') this.session.dropStack(this.cursor);
        this.cursor = null;
        this.renderCursor();
      }
    });
    this.root.appendChild(this.el);
    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'slot cursor-stack';
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'tooltip hidden';
    document.body.append(this.cursorEl, this.tooltipEl);
    window.addEventListener('mousemove', this.onMove);
    this.render();
  }

  close(): void {
    if (!this.el) return;
    if (this.cursor) {
      const left = this.session.inventory.add(this.cursor);
      if (left > 0) this.session.dropStack({ ...this.cursor, count: left });
      this.cursor = null;
    }
    this.session.closeContainer();
    this.el.remove();
    this.cursorEl?.remove();
    this.tooltipEl?.remove();
    window.removeEventListener('mousemove', this.onMove);
    this.el = null;
  }

  private trackMouse(e: MouseEvent): void {
    this.mouse = { x: e.clientX, y: e.clientY };
    if (this.cursorEl) {
      this.cursorEl.style.left = `${e.clientX}px`;
      this.cursorEl.style.top = `${e.clientY}px`;
    }
    if (this.tooltipEl && !this.tooltipEl.classList.contains('hidden')) {
      this.tooltipEl.style.left = `${e.clientX + 14}px`;
      this.tooltipEl.style.top = `${e.clientY - 28}px`;
    }
  }

  private slot(group: SlotGroup, index: number, stack: Slot, extraClass = ''): string {
    return `<div class="slot ${extraClass}" data-group="${group}" data-index="${index}">${slotHTML(stack)}</div>`;
  }

  private grid(group: SlotGroup, slots: Slot[], cols: number, offset = 0, count = slots.length - offset): string {
    let html = `<div class="grid" style="grid-template-columns:repeat(${cols},auto)">`;
    for (let i = offset; i < offset + count; i++) html += this.slot(group, i, slots[i]);
    return html + '</div>';
  }

  private inventoryRows(): string {
    const inv = this.session.inventory.slots;
    return `<div class="title">${this.i18n.t('ui.inventory')}</div>${this.grid('inv', inv, 9, 9, 27)}<div class="inv-gap"></div>${this.grid('inv', inv, 9, 0, 9)}`;
  }

  private render(): void {
    if (!this.el) return;
    const s = this.session;
    const t = (k: string) => this.i18n.t(k);
    const open = s.openContainer;
    let top = '';

    if (open?.type === 'crafting_table') {
      top = `<div class="title">${t('ui.craftingTable')}</div>
        <div class="crafting-area">${this.grid('grid', open.grid, 3)}<div class="arrow"></div>${this.slot('result', 0, craftPreview(open.grid, 3), 'big')}</div>`;
    } else if (open?.type === 'chest') {
      top = `<div class="title">${t('ui.chest')}</div>${this.grid('container', open.slots, 9)}`;
    } else if (open?.type === 'furnace') {
      const f = open.furnace;
      top = `<div class="title">${t('ui.furnace')}</div>
        <div class="crafting-area">
          <div class="furnace-col">${this.slot('furnace', 0, f.input)}<div class="flame"><div class="fill" data-burn></div></div>${this.slot('furnace', 1, f.fuel)}</div>
          <div class="arrow"><div class="fill" data-cook></div></div>
          ${this.slot('furnace', 2, f.output, 'big')}
        </div>`;
    } else if (s.gameMode === 'creative') {
      const items = paletteItems(this.i18n, this.search);
      top = `<div class="title">${t('ui.creativeInventory')}</div>
        <input class="search" type="text" placeholder="${t('ui.search')}" value="${this.search.replace(/"/g, '&quot;')}">
        <div class="palette">${this.grid('palette', items.map((id) => ({ id, count: 1 })), 9)}</div>`;
    } else {
      top = `<div class="title">${t('ui.crafting')}</div>
        <div class="crafting-area">${this.grid('grid', s.inventoryGrid, 2)}<div class="arrow"></div>${this.slot('result', 0, craftPreview(s.inventoryGrid, 2), 'big')}</div>`;
    }

    this.el.innerHTML = `<div class="panel">${top}${this.inventoryRows()}</div>`;
    this.updateProgress();
    this.el.querySelectorAll<HTMLElement>('.slot').forEach((el) => {
      el.addEventListener('mousedown', (e) => this.onSlotClick(e, el));
      el.addEventListener('mouseenter', () => this.showTooltip(el));
      el.addEventListener('mouseleave', () => this.tooltipEl?.classList.add('hidden'));
    });
    const search = this.el.querySelector<HTMLInputElement>('.search');
    if (search) {
      search.addEventListener('input', () => {
        this.search = search.value;
        const pos = search.selectionStart;
        this.render();
        const again = this.el?.querySelector<HTMLInputElement>('.search');
        again?.focus();
        if (again && pos !== null) again.setSelectionRange(pos, pos);
      });
      search.addEventListener('keydown', (e) => e.stopPropagation());
    }
    this.renderCursor();
  }

  /** Refreshes furnace progress bars (called every frame while open). */
  updateProgress(): void {
    const open = this.session.openContainer;
    if (!this.el || open?.type !== 'furnace') return;
    const cook = this.el.querySelector<HTMLElement>('[data-cook]');
    const burn = this.el.querySelector<HTMLElement>('[data-burn]');
    if (cook) cook.style.width = `${Math.round(open.furnace.cookProgress() * 30)}px`;
    if (burn) burn.style.height = `${Math.round(open.furnace.burnProgress() * 100)}%`;
  }

  private furnaceSignature = '';
  /** Re-renders when the furnace contents change on their own (smelting). */
  tick(): void {
    const open = this.session.openContainer;
    if (!this.el) return;
    this.updateProgress();
    if (open?.type === 'furnace') {
      const sig = JSON.stringify(open.furnace.slots);
      if (sig !== this.furnaceSignature) {
        this.furnaceSignature = sig;
        this.render();
      }
    }
  }

  private renderCursor(): void {
    if (this.cursorEl) this.cursorEl.innerHTML = slotHTML(this.cursor);
  }

  private showTooltip(el: HTMLElement): void {
    const stack = this.stackFor(el.dataset.group as SlotGroup, Number(el.dataset.index));
    if (!stack || !this.tooltipEl || this.cursor) return;
    const [name, ...rest] = itemTooltip(this.i18n, stack);
    this.tooltipEl.innerHTML = `<div>${name}</div>${rest.map((l) => `<div class="sub">${l}</div>`).join('')}`;
    this.tooltipEl.classList.remove('hidden');
    this.tooltipEl.style.left = `${this.mouse.x + 14}px`;
    this.tooltipEl.style.top = `${this.mouse.y - 28}px`;
  }

  private stackFor(group: SlotGroup, i: number): Slot {
    const s = this.session;
    const open = s.openContainer;
    switch (group) {
      case 'inv':
        return s.inventory.slots[i];
      case 'grid':
        return (open?.type === 'crafting_table' ? open.grid : s.inventoryGrid)[i];
      case 'result':
        return open?.type === 'crafting_table' ? craftPreview(open.grid, 3) : craftPreview(s.inventoryGrid, 2);
      case 'container':
        return open?.type === 'chest' ? open.slots[i] : null;
      case 'furnace':
        return open?.type === 'furnace' ? open.furnace.slots[i] : null;
      case 'palette': {
        const id = paletteItems(this.i18n, this.search)[i];
        return id === undefined ? null : { id, count: 1 };
      }
    }
  }

  private onSlotClick(e: MouseEvent, el: HTMLElement): void {
    e.preventDefault();
    e.stopPropagation();
    const group = el.dataset.group as SlotGroup;
    const i = Number(el.dataset.index);
    const button = e.button === 2 ? 'right' : 'left';
    const shift = e.shiftKey;
    const s = this.session;
    const open = s.openContainer;

    switch (group) {
      case 'inv':
        if (shift && !this.cursor) shiftClickInventory(s.inventory.slots, i, open);
        else this.cursor = clickSlot(s.inventory.slots, i, this.cursor, button);
        break;
      case 'grid': {
        const grid = open?.type === 'crafting_table' ? open.grid : s.inventoryGrid;
        if (shift && !this.cursor) shiftClickContainer(grid, i, s.inventory.slots);
        else this.cursor = clickSlot(grid, i, this.cursor, button);
        break;
      }
      case 'result': {
        const [grid, width] = open?.type === 'crafting_table' ? [open.grid, 3] : [s.inventoryGrid, 2];
        this.cursor = takeCraftResult(grid, width, this.cursor, shift, s.inventory);
        break;
      }
      case 'container':
        if (open?.type !== 'chest') break;
        if (shift && !this.cursor) shiftClickContainer(open.slots, i, s.inventory.slots);
        else this.cursor = clickSlot(open.slots, i, this.cursor, button);
        break;
      case 'furnace': {
        if (open?.type !== 'furnace') break;
        const slots = open.furnace.slots;
        if (shift && !this.cursor) shiftClickContainer(slots, i, s.inventory.slots);
        else this.cursor = clickSlot(slots, i, this.cursor, button, { takeOnly: i === 2 });
        open.furnace.slots = slots;
        break;
      }
      case 'palette': {
        const id = paletteItems(this.i18n, this.search)[i];
        if (id === undefined) break;
        const full = { id, count: getItem(id).maxStack };
        if (shift) s.inventory.add(full);
        else if (this.cursor) this.cursor = null;
        else this.cursor = button === 'right' ? { id, count: 1 } : full;
        break;
      }
    }
    this.tooltipEl?.classList.add('hidden');
    this.onChange();
    this.render();
  }
}
