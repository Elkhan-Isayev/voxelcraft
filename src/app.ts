import { getBlock } from './core/blocks';
import { isWater } from './core/fluid';
import { hashSeed } from './core/rng';
import { Sounds } from './audio/sounds';
import { i18n, detectLocale } from './i18n';
import { InputState, type InputAction } from './input/input-state';
import { GameRenderer } from './render/renderer';
import { SaveManager, browserStorage, type GameMode, type KeyValueStorage } from './game/save';
import { GameSession, type SessionEvent } from './game/session';
import { loadSettings, saveSettings, type Settings } from './game/settings';
import { Hud, toast } from './ui/hud';
import { initIcons } from './ui/icons';
import { InventoryScreen } from './ui/inventory-screen';
import { Menus } from './ui/menus';
import { deathMessage } from './ui/hud-logic';

type State = 'title' | 'loading' | 'clickToPlay' | 'playing' | 'paused' | 'inventory' | 'dead';

const AUTOSAVE_SECONDS = 60;
const MOUSE_FACTOR = 0.0022;

export class App {
  private readonly storage: KeyValueStorage = browserStorage();
  private readonly saves = new SaveManager(this.storage);
  private settings: Settings;
  private readonly renderer: GameRenderer;
  private readonly sounds = new Sounds();
  private readonly hud: Hud;
  private readonly menus: Menus;
  private readonly input = new InputState();
  private session: GameSession | null = null;
  private panorama = false;
  private state: State = 'title';
  private inventory: InventoryScreen | null = null;
  private attackHeld = false;
  private useHeld = false;
  private useRepeat = 0;
  private lastFrame = performance.now();
  private fps = 60;
  private autosave = 0;
  private suppressPause = false;
  private deathText: { key: string; params: Record<string, string> } | null = null;
  private loadingTotal = 1;

  constructor() {
    this.settings = loadSettings(this.storage, detectLocale(navigator.languages ?? [navigator.language]));
    i18n.setLocale(this.settings.locale);
    document.documentElement.lang = this.settings.locale;
    this.sounds.volume = this.settings.volume / 100;

    this.renderer = new GameRenderer(document.getElementById('game')!);
    initIcons(this.renderer.atlas.pixels, this.renderer.atlas.size);
    this.hud = new Hud(document.getElementById('hud')!, i18n);
    this.menus = new Menus(document.getElementById('overlay')!, i18n, {
      listWorlds: () => this.saves.list(),
      playWorld: (id) => this.playWorld(id),
      createWorld: (name, seed, mode) => this.createWorld(name, seed, mode),
      deleteWorld: (id) => this.saves.delete(id),
      settings: () => this.settings,
      updateSettings: (patch) => this.updateSettings(patch),
      resume: () => this.resume(),
      saveAndQuit: () => this.quitToTitle(true),
      respawn: () => this.respawn(),
      quitToTitle: () => this.quitToTitle(true),
      click: () => {
        this.sounds.unlock();
        this.sounds.play('click');
      },
    });
    i18n.onChange((code) => {
      document.documentElement.lang = code;
      this.hud.invalidate();
    });

    this.bindInput();
    this.startPanorama();
    this.menus.showTitle();
    requestAnimationFrame(this.loop);
  }

  private readonly loop = (t: number): void => {
    requestAnimationFrame(this.loop);
    this.frame(t);
  };

  // ---- settings ------------------------------------------------------------------

  private updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.storage, this.settings);
    if (patch.locale) i18n.setLocale(patch.locale);
    if (patch.volume !== undefined) this.sounds.volume = patch.volume / 100;
    if (patch.renderDistance !== undefined && this.session && !this.panorama) this.session.renderDistance = patch.renderDistance;
  }

  // ---- world lifecycle --------------------------------------------------------

  private startPanorama(): void {
    const s = new GameSession({ seed: hashSeed('VoxelCraft'), gameMode: 'creative', name: 'panorama', renderDistance: 4 });
    s.time = 5000;
    s.player.body.y += 6;
    this.session = s;
    this.panorama = true;
    this.renderer.attach(s);
  }

  private createWorld(name: string, seedText: string, mode: GameMode): void {
    const seed = seedText.trim() ? hashSeed(seedText) : Math.floor(Math.random() * 2 ** 31);
    this.menus.showLoading(0);
    // Let the loading screen paint before the (synchronous) spawn search.
    setTimeout(() => {
      const session = new GameSession({ seed, gameMode: mode, name, id: this.saves.newId(), renderDistance: this.settings.renderDistance });
      this.enterWorld(session);
      this.saves.save(session.toSave());
    }, 30);
  }

  private playWorld(id: string): void {
    const data = this.saves.load(id);
    if (!data) {
      toast('⚠');
      return;
    }
    this.menus.showLoading(0);
    setTimeout(() => this.enterWorld(GameSession.fromSave(data, { renderDistance: this.settings.renderDistance })), 30);
  }

  private enterWorld(session: GameSession): void {
    this.session = session;
    this.panorama = false;
    this.renderer.attach(session);
    this.state = 'loading';
    const r = session.renderDistance;
    this.loadingTotal = Math.min(9 * 9, (2 * r + 1) ** 2);
    this.autosave = 0;
    this.hud.show(false);
  }

  private save(showToast = false): void {
    if (!this.session || this.panorama) return;
    const ok = this.saves.save(this.session.toSave());
    if (showToast) toast(ok ? i18n.t('ui.saved') : '⚠ Storage full');
  }

  private quitToTitle(save: boolean): void {
    if (save) this.save();
    this.closeInventory(false);
    document.exitPointerLock?.();
    this.renderer.detach();
    this.session = null;
    this.state = 'title';
    this.hud.show(false);
    this.startPanorama();
    this.menus.showTitle();
  }

  private respawn(): void {
    this.session?.respawn();
    this.deathText = null;
    this.resume();
  }

  // ---- state transitions ---------------------------------------------------------

  private lockPointer(): void {
    const canvas = this.renderer.canvas;
    try {
      const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => this.showClickToPlay());
    } catch {
      this.showClickToPlay();
    }
  }

  private showClickToPlay(): void {
    if (this.state === 'dead') return;
    this.state = 'clickToPlay';
    this.menus.showClickToPlay(() => this.resume());
  }

  private resume(): void {
    this.sounds.unlock();
    this.menus.hide();
    this.state = 'playing';
    this.hud.show(true);
    this.lockPointer();
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.attackHeld = this.useHeld = false;
    this.input.clear();
    this.save();
    this.menus.showPause();
  }

  private openInventory(): void {
    if (!this.session) return;
    this.state = 'inventory';
    this.attackHeld = this.useHeld = false;
    this.input.clear();
    this.inventory = new InventoryScreen(document.getElementById('overlay')!, i18n, this.session);
    this.inventory.onChange = () => this.sounds.play('click');
    this.inventory.open();
    this.suppressPause = true;
    document.exitPointerLock?.();
  }

  private closeInventory(relock = true): void {
    if (!this.inventory) return;
    this.inventory.close();
    this.inventory = null;
    if (relock && this.session?.alive) {
      this.state = 'playing';
      this.lockPointer();
    }
  }

  // ---- input -------------------------------------------------------------------

  private bindInput(): void {
    const canvas = this.renderer.canvas;
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (locked) {
        this.menus.hide();
        if (this.state === 'clickToPlay' || this.state === 'paused') this.state = 'playing';
        return;
      }
      if (this.suppressPause) {
        this.suppressPause = false;
        return;
      }
      if (this.state === 'playing') this.pause();
    });
    document.addEventListener('pointerlockerror', () => this.showClickToPlay());

    document.addEventListener('mousemove', (e) => {
      if (this.state !== 'playing' || document.pointerLockElement !== canvas || !this.session) return;
      const k = MOUSE_FACTOR * (this.settings.sensitivity / 100);
      const s = this.session;
      s.setLook(s.player.yaw - e.movementX * k, s.player.pitch - e.movementY * k * (this.settings.invertY ? -1 : 1));
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing' || document.pointerLockElement !== canvas || !this.session) return;
      const s = this.session;
      if (e.button === 0) {
        if (s.attack()) this.renderer.swing();
        else this.renderer.swing();
        this.attackHeld = true;
      } else if (e.button === 2) {
        this.useHeld = true;
        this.useRepeat = 0.25;
        this.use();
      } else if (e.button === 1) {
        e.preventDefault();
        s.pickBlock();
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.attackHeld = false;
      if (e.button === 2) this.useHeld = false;
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (this.state !== 'playing' || !this.session) return;
        this.session.inventory.scroll(e.deltaY > 0 ? 1 : -1);
      },
      { passive: true },
    );

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Tab' || e.code === 'F3' || e.code.startsWith('Arrow')) e.preventDefault();
      if (this.state === 'inventory') {
        if (e.code === 'KeyE' || e.code === 'Escape') this.closeInventory();
        return;
      }
      if (this.state !== 'playing') return;
      for (const a of this.input.keyDown(e.code, performance.now())) this.action(a);
    });
    window.addEventListener('keyup', (e) => this.input.keyUp(e.code));
    window.addEventListener('blur', () => {
      this.input.clear();
      this.attackHeld = this.useHeld = false;
    });
    window.addEventListener('beforeunload', () => this.save());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save();
    });
  }

  private use(): void {
    const s = this.session;
    if (!s) return;
    const result = s.useItem(this.input.moveInput().sneak);
    if (result === 'opened') this.openInventory();
    else if (result === 'placed' || result === 'filled' || result === 'ate') this.renderer.swing();
    else if (result === 'ignited') this.sounds.play('hiss');
  }

  private action(a: InputAction): void {
    const s = this.session;
    if (!s) return;
    if (a.startsWith('hotbar')) {
      s.inventory.select(Number(a.slice(6)));
      return;
    }
    switch (a) {
      case 'inventory':
        this.openInventory();
        break;
      case 'drop':
        s.dropSelected(false);
        break;
      case 'dropAll':
        s.dropSelected(true);
        break;
      case 'debug':
        this.hud.showDebug = !this.hud.showDebug;
        break;
      case 'toggleFly':
        s.toggleFlying();
        break;
      case 'toggleMode':
        s.toggleGameMode();
        toast(i18n.t('ui.gameModeChanged', { mode: i18n.t(s.gameMode === 'creative' ? 'ui.creative' : 'ui.survival') }));
        break;
      case 'pause':
        break;
    }
  }

  // ---- frame loop ----------------------------------------------------------------

  private frame(now: number): void {
    // rAF timestamps can precede the previous performance.now() reading; never step backwards.
    const dt = Math.max(0, Math.min(0.1, (now - this.lastFrame) / 1000));
    this.lastFrame = Math.max(now, this.lastFrame);
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    const s = this.session;
    if (!s) return;

    if (this.panorama) {
      s.updateChunks(2);
      s.setLook(s.player.yaw + dt * 0.04, -0.12);
      this.renderer.render(dt, { fov: 75, renderDistance: 4 }, false, false, 4, false);
      return;
    }

    if (this.state === 'loading') {
      s.updateChunks(3);
      this.renderer.render(dt, { fov: this.settings.fov, renderDistance: this.settings.renderDistance }, false, false, 12, false);
      const loaded = [...s.world.loadedChunks()].length;
      this.menus.showLoading(Math.min(1, loaded / this.loadingTotal));
      if (s.isReady() && this.renderer.isReady() && loaded >= Math.min(this.loadingTotal, 25)) {
        this.hud.show(true);
        toast(i18n.t('ui.welcome', { world: s.meta.name }));
        this.showClickToPlay();
      }
      return;
    }

    const simulate = this.state === 'playing' || this.state === 'inventory' || this.state === 'dead' || this.state === 'clickToPlay';
    const move = this.state === 'playing' ? this.input.moveInput() : { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
    if (simulate) {
      if (this.state === 'playing' && this.useHeld) {
        this.useRepeat -= dt;
        if (this.useRepeat <= 0) {
          this.useRepeat = 0.25;
          this.use();
        }
      }
      s.update(dt, move, { attackHeld: this.attackHeld && this.state === 'playing' });
      s.updateChunks(2);
      for (const e of s.drainEvents()) this.onEvent(e);
      this.autosave += dt;
      if (this.autosave > AUTOSAVE_SECONDS) {
        this.autosave = 0;
        this.save();
      }
    }

    const walking = this.state === 'playing' && (move.forward !== 0 || move.strafe !== 0);
    const sprinting = walking && move.sprint && move.forward > 0;
    this.renderer.render(dt, { fov: this.settings.fov, renderDistance: this.settings.renderDistance }, walking, sprinting);
    const eye = s.eyePosition();
    const underwater = isWater(s.world.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z)));
    this.hud.update(s, dt, this.fps, this.settings.showFps, underwater);
    this.inventory?.tick();
  }

  private onEvent(e: SessionEvent): void {
    const s = this.session!;
    switch (e.type) {
      case 'break':
        this.sounds.play('break', e.block);
        this.renderer.onBlockBroken(e.block, e.x, e.y, e.z);
        break;
      case 'place':
        this.sounds.play('place', e.block);
        break;
      case 'step': {
        const b = s.player.body;
        const under = s.world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.1), Math.floor(b.z));
        if (getBlock(under).solid) this.sounds.play('step', under);
        break;
      }
      case 'hurt':
        this.sounds.play('hurt');
        this.hud.damageFlash();
        break;
      case 'pickup':
        this.sounds.play('pickup');
        break;
      case 'explosion':
        this.sounds.play('explosion');
        break;
      case 'eat':
        this.sounds.play('eat');
        this.renderer.eat();
        break;
      case 'mobHurt':
        this.sounds.play('hit');
        break;
      case 'toolBroke':
        this.sounds.play('toolBroke');
        break;
      case 'bucket':
        this.sounds.play('bucket');
        break;
      case 'death':
        this.state = 'dead';
        this.closeInventory(false);
        this.deathText = { key: e.messageKey, params: e.params };
        this.suppressPause = document.pointerLockElement === this.renderer.canvas;
        document.exitPointerLock?.();
        this.menus.showDeath(() => (this.deathText ? deathMessage(i18n, this.deathText.key, this.deathText.params) : ''));
        break;
    }
  }
}
