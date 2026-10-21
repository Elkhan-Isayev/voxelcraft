import { LOCALES, type I18n, type LocaleCode } from '../i18n';
import type { GameMode, WorldMeta } from '../game/save';
import type { Settings } from '../game/settings';

export interface MenuActions {
  listWorlds(): WorldMeta[];
  playWorld(id: string): void;
  createWorld(name: string, seed: string, mode: GameMode): void;
  deleteWorld(id: string): void;
  settings(): Settings;
  updateSettings(patch: Partial<Settings>): void;
  resume(): void;
  saveAndQuit(): void;
  respawn(): void;
  quitToTitle(): void;
  click(): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class Menus {
  private rerender: (() => void) | null = null;
  private selectedWorld: string | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly i18n: I18n,
    private readonly actions: MenuActions,
  ) {
    i18n.onChange(() => this.rerender?.());
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return esc(this.i18n.t(key, params));
  }

  private mount(html: string, cls: string, bind: (el: HTMLElement) => void, rerender: () => void): void {
    this.root.innerHTML = `<div class="screen ${cls}">${html}</div>`;
    const el = this.root.firstElementChild as HTMLElement;
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.actions.click()));
    bind(el);
    this.rerender = rerender;
  }

  hide(): void {
    this.root.innerHTML = '';
    this.rerender = null;
  }

  get visible(): boolean {
    return this.root.childElementCount > 0;
  }

  private languageButtons(): string {
    return `<div class="row lang-row">${LOCALES.map(
      (l) => `<button class="btn tiny${l.code === this.i18n.locale ? ' active' : ''}" data-lang="${l.code}">${esc(l.nativeName)}</button>`,
    ).join('')}</div>`;
  }

  private bindLanguage(el: HTMLElement): void {
    el.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => this.actions.updateSettings({ locale: b.dataset.lang as LocaleCode })),
    );
  }

  showTitle(): void {
    const html = `
      <div class="logo">${this.t('ui.title')}</div>
      <div class="splash">${this.t('ui.subtitle')}</div>
      <button class="btn" data-a="play">${this.t('ui.singleplayer')}</button>
      <button class="btn" data-a="settings">${this.t('ui.settings')}</button>
      ${this.languageButtons()}
      <div class="footer"><span>VoxelCraft 1.0 — TypeScript · Three.js</span><span>Not affiliated with Mojang or Microsoft</span></div>`;
    this.mount(
      html,
      '',
      (el) => {
        el.querySelector('[data-a="play"]')!.addEventListener('click', () => this.showWorlds());
        el.querySelector('[data-a="settings"]')!.addEventListener('click', () => this.showSettings(() => this.showTitle()));
        this.bindLanguage(el);
      },
      () => this.showTitle(),
    );
  }

  showWorlds(): void {
    const worlds = this.actions.listWorlds();
    if (!worlds.some((w) => w.id === this.selectedWorld)) this.selectedWorld = worlds[0]?.id ?? null;
    const items = worlds.length
      ? worlds
          .map(
            (w) => `<div class="world-item${w.id === this.selectedWorld ? ' selected' : ''}" data-id="${esc(w.id)}">
              <div><div class="name">${esc(w.name)}</div>
              <div class="meta">${this.t('ui.lastPlayed', { date: new Date(w.lastPlayed).toLocaleString(this.i18n.locale) })}</div>
              <div class="meta">${this.t(w.gameMode === 'creative' ? 'ui.creative' : 'ui.survival')} · ${this.t('ui.seed')}: ${w.seed}</div></div>
            </div>`,
          )
          .join('')
      : `<div class="hint" style="padding:12px;text-align:center">${this.t('ui.noWorlds')}</div>`;
    const html = `
      <h2>${this.t('ui.singleplayer')}</h2>
      <div class="world-list">${items}</div>
      <div class="row">
        <button class="btn small" data-a="play" ${this.selectedWorld ? '' : 'disabled'}>${this.t('ui.play')}</button>
        <button class="btn small" data-a="create">${this.t('ui.newWorld')}</button>
      </div>
      <div class="row">
        <button class="btn small danger" data-a="delete" ${this.selectedWorld ? '' : 'disabled'}>${this.t('ui.delete')}</button>
        <button class="btn small" data-a="back">${this.t('ui.back')}</button>
      </div>`;
    this.mount(
      html,
      'dirt',
      (el) => {
        el.querySelectorAll<HTMLElement>('.world-item').forEach((item) => {
          item.addEventListener('click', () => {
            this.selectedWorld = item.dataset.id!;
            this.showWorlds();
          });
          item.addEventListener('dblclick', () => this.actions.playWorld(item.dataset.id!));
        });
        el.querySelector('[data-a="play"]')!.addEventListener('click', () => this.selectedWorld && this.actions.playWorld(this.selectedWorld));
        el.querySelector('[data-a="create"]')!.addEventListener('click', () => this.showCreate());
        el.querySelector('[data-a="delete"]')!.addEventListener('click', () => {
          const w = worlds.find((x) => x.id === this.selectedWorld);
          if (w && confirm(this.i18n.t('ui.confirmDelete', { name: w.name }))) {
            this.actions.deleteWorld(w.id);
            this.selectedWorld = null;
            this.showWorlds();
          }
        });
        el.querySelector('[data-a="back"]')!.addEventListener('click', () => this.showTitle());
      },
      () => this.showWorlds(),
    );
  }

  showCreate(state = { name: '', seed: '', mode: 'survival' as GameMode }): void {
    const html = `
      <h2>${this.t('ui.newWorld')}</h2>
      <div class="field"><label>${this.t('ui.worldName')}</label><input type="text" data-f="name" maxlength="32" value="${esc(state.name || this.i18n.t('ui.defaultWorldName'))}"></div>
      <div class="field"><label>${this.t('ui.seed')}</label><input type="text" data-f="seed" maxlength="40" value="${esc(state.seed)}"><span class="hint">${this.t('ui.seedHint')}</span></div>
      <div class="field"><button class="btn" data-a="mode">${this.t('ui.gameMode')}: ${this.t(state.mode === 'creative' ? 'ui.creative' : 'ui.survival')}</button>
        <span class="hint">${this.t(state.mode === 'creative' ? 'ui.creativeHint' : 'ui.survivalHint')}</span></div>
      <div class="row">
        <button class="btn small" data-a="create">${this.t('ui.createWorld')}</button>
        <button class="btn small" data-a="cancel">${this.t('ui.cancel')}</button>
      </div>`;
    const read = (el: HTMLElement) => ({
      name: (el.querySelector('[data-f="name"]') as HTMLInputElement).value,
      seed: (el.querySelector('[data-f="seed"]') as HTMLInputElement).value,
      mode: state.mode,
    });
    this.mount(
      html,
      'dirt',
      (el) => {
        el.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
        el.querySelector('[data-a="mode"]')!.addEventListener('click', () => {
          const s = read(el);
          this.showCreate({ ...s, mode: s.mode === 'survival' ? 'creative' : 'survival' });
        });
        el.querySelector('[data-a="create"]')!.addEventListener('click', () => {
          const s = read(el);
          this.actions.createWorld(s.name.trim() || this.i18n.t('ui.defaultWorldName'), s.seed, s.mode);
        });
        el.querySelector('[data-a="cancel"]')!.addEventListener('click', () => this.showWorlds());
        (el.querySelector('[data-f="name"]') as HTMLInputElement).select();
      },
      () => this.showCreate(),
    );
  }

  private slider(key: string, labelKey: string, value: number, min: number, max: number, step = 1): string {
    const pct = ((value - min) / (max - min)) * 100;
    return `<div class="slider"><input type="range" data-s="${key}" min="${min}" max="${max}" step="${step}" value="${value}">
      <div class="track">${this.t(labelKey, { value })}</div>
      <div class="thumb" style="left:calc(${pct}% - ${pct * 0.14}px)"></div></div>`;
  }

  showSettings(back: () => void): void {
    const s = this.actions.settings();
    const toggle = (key: 'invertY' | 'showFps', label: string) =>
      `<button class="btn" data-t="${key}">${this.t(label)}: ${this.t(s[key] ? 'ui.on' : 'ui.off')}</button>`;
    const help = ['move', 'jump', 'sneak', 'sprint', 'break', 'place', 'inventory', 'hotbar', 'pick', 'drop', 'fly', 'mode', 'debug', 'pause']
      .map((k) => `<div>${this.t(`ui.help.${k}`)}</div>`)
      .join('');
    const html = `
      <h2>${this.t('ui.settings')}</h2>
      ${this.slider('renderDistance', 'ui.renderDistance', s.renderDistance, 2, 16)}
      ${this.slider('fov', 'ui.fov', s.fov, 50, 110)}
      ${this.slider('sensitivity', 'ui.sensitivity', s.sensitivity, 10, 200, 5)}
      ${this.slider('volume', 'ui.volume', s.volume, 0, 100, 5)}
      ${this.slider('music', 'ui.music', s.music, 0, 100, 5)}
      ${toggle('invertY', 'ui.invertY')}
      ${toggle('showFps', 'ui.showFps')}
      <div class="hint">${this.t('ui.language')}</div>
      ${this.languageButtons()}
      <h2 style="margin-top:8px">${this.t('ui.controls')}</h2>
      <div class="controls-help">${help}</div>
      <button class="btn" data-a="done">${this.t('ui.done')}</button>`;
    this.mount(
      html,
      'dirt',
      (el) => {
        el.querySelectorAll<HTMLInputElement>('[data-s]').forEach((input) => {
          input.addEventListener('input', () => {
            this.actions.updateSettings({ [input.dataset.s!]: Number(input.value) } as Partial<Settings>);
            const label = input.parentElement!.querySelector('.track')!;
            const key = { renderDistance: 'ui.renderDistance', fov: 'ui.fov', sensitivity: 'ui.sensitivity', volume: 'ui.volume', music: 'ui.music' }[input.dataset.s!]!;
            label.textContent = this.i18n.t(key, { value: input.value });
            const min = Number(input.min);
            const max = Number(input.max);
            const pct = ((Number(input.value) - min) / (max - min)) * 100;
            (input.parentElement!.querySelector('.thumb') as HTMLElement).style.left = `calc(${pct}% - ${pct * 0.14}px)`;
          });
        });
        el.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) =>
          b.addEventListener('click', () => {
            const key = b.dataset.t as 'invertY' | 'showFps';
            this.actions.updateSettings({ [key]: !this.actions.settings()[key] });
            this.showSettings(back);
          }),
        );
        this.bindLanguage(el);
        el.querySelector('[data-a="done"]')!.addEventListener('click', back);
      },
      () => this.showSettings(back),
    );
  }

  showPause(): void {
    const html = `
      <h2>${this.t('ui.paused')}</h2>
      <button class="btn" data-a="resume">${this.t('ui.resume')}</button>
      <button class="btn" data-a="settings">${this.t('ui.settings')}</button>
      <button class="btn" data-a="quit">${this.t('ui.saveAndQuit')}</button>`;
    this.mount(
      html,
      'dim',
      (el) => {
        el.querySelector('[data-a="resume"]')!.addEventListener('click', () => this.actions.resume());
        el.querySelector('[data-a="settings"]')!.addEventListener('click', () => this.showSettings(() => this.showPause()));
        el.querySelector('[data-a="quit"]')!.addEventListener('click', () => this.actions.saveAndQuit());
      },
      () => this.showPause(),
    );
  }

  showDeath(message: () => string): void {
    const html = `
      <div class="logo" style="font-size:44px;color:#fff">${this.t('ui.youDied')}</div>
      <div class="shadow">${esc(message())}</div>
      <button class="btn" data-a="respawn">${this.t('ui.respawn')}</button>
      <button class="btn" data-a="title">${this.t('ui.titleScreen')}</button>`;
    this.mount(
      html,
      'red',
      (el) => {
        el.querySelector('[data-a="respawn"]')!.addEventListener('click', () => this.actions.respawn());
        el.querySelector('[data-a="title"]')!.addEventListener('click', () => this.actions.quitToTitle());
      },
      () => this.showDeath(message),
    );
  }

  showLoading(progress: number): void {
    const bar = this.root.querySelector<HTMLElement>('[data-loading] ~ .progress > i');
    if (bar) {
      bar.style.width = `${Math.round(progress * 100)}%`;
      return;
    }
    this.mount(
      `<div data-loading class="shadow">${this.t('ui.loading')}</div><div class="progress"><i style="width:${Math.round(progress * 100)}%"></i></div>`,
      'dirt',
      () => {},
      () => {
        this.root.innerHTML = '';
        this.showLoading(progress);
      },
    );
  }

  showClickToPlay(onClick: () => void): void {
    this.mount(
      `<div class="click-to-play">${this.t('ui.clickToPlay')}</div>`,
      'dim',
      (el) => el.addEventListener('click', onClick),
      () => this.showClickToPlay(onClick),
    );
  }
}
