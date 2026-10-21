import * as THREE from 'three';
import { isLava, isWater } from '../core/fluid';
import { PLAYER } from '../physics/player-physics';
import type { GameSession } from '../game/session';
import { ChunkRenderer } from './chunk-renderer';
import { EntityRenderer } from './entities';
import { HandRenderer } from './hand';
import { createAtlas, createSolidMaterial, createWaterMaterial, createWorldUniforms, lightBrightness, type Atlas, type WorldUniforms } from './materials';
import { Sky } from './sky';

export interface RenderOptions {
  fov: number;
  renderDistance: number;
}

/** Owns the WebGL renderer and draws a GameSession. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly atlas: Atlas;
  private readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1000);
  private readonly uniforms: WorldUniforms;
  private readonly solidMaterial: THREE.ShaderMaterial;
  private readonly waterMaterial: THREE.ShaderMaterial;
  private readonly sky = new Sky();
  private chunks: ChunkRenderer | null = null;
  private entities: EntityRenderer;
  private readonly hand: HandRenderer;
  private session: GameSession | null = null;
  private fovCurrent = 75;
  private bobPhase = 0;
  private elapsed = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    this.atlas = createAtlas();
    this.uniforms = createWorldUniforms(this.atlas.texture);
    this.solidMaterial = createSolidMaterial(this.uniforms);
    this.waterMaterial = createWaterMaterial(this.uniforms);
    this.entities = new EntityRenderer(this.atlas.texture);
    this.hand = new HandRenderer(this.atlas.texture);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.sky.group, this.entities.group);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  attach(session: GameSession): void {
    this.detach();
    this.session = session;
    this.chunks = new ChunkRenderer(session.world, this.solidMaterial, this.waterMaterial);
    this.scene.add(this.chunks.group);
  }

  detach(): void {
    if (this.chunks) {
      this.scene.remove(this.chunks.group);
      this.chunks.dispose();
      this.chunks = null;
    }
    this.entities.dispose();
    this.scene.remove(this.entities.group);
    this.entities = new EntityRenderer(this.atlas.texture);
    this.scene.add(this.entities.group);
    this.session = null;
  }

  /** Whether the terrain around the player has been meshed (used for the loading screen). */
  isReady(): boolean {
    const s = this.session;
    if (!s || !this.chunks) return false;
    return this.chunks.isAreaReady(Math.floor(s.player.body.x / 16), Math.floor(s.player.body.z / 16));
  }

  pendingSections(): number {
    return this.chunks?.pendingCount() ?? 0;
  }

  onBlockBroken(id: number, x: number, y: number, z: number): void {
    this.entities.burst(id, x, y, z);
    this.hand.swingArm();
  }

  swing(): void {
    this.hand.swingArm();
  }

  render(dt: number, opts: RenderOptions, walking: boolean, sprinting: boolean, meshBudgetMs = 6, showHand = true): void {
    const s = this.session;
    if (!s || !this.chunks) return;
    this.elapsed += dt;
    const body = s.player.body;
    const eye = s.eyePosition();

    // Camera with gentle view bobbing.
    if (walking && body.onGround) this.bobPhase += dt * 10;
    const bob = walking && body.onGround ? Math.sin(this.bobPhase) * 0.04 : 0;
    this.camera.position.set(eye.x, eye.y + Math.abs(bob), eye.z);
    this.camera.rotation.set(s.player.pitch, s.player.yaw, bob * 0.15);
    const targetFov = opts.fov * (sprinting ? 1.12 : 1) * (body.flying && sprinting ? 1.05 : 1);
    this.fovCurrent += (targetFov - this.fovCurrent) * Math.min(1, dt * 10);
    this.camera.fov = this.fovCurrent;
    this.camera.updateProjectionMatrix();

    const camBlock = s.world.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
    const underwater = isWater(camBlock);
    const inLava = isLava(camBlock);
    const daylight = s.daylight();
    this.sky.update(s.time, this.camera, dt, underwater || inLava);
    if (inLava) this.sky.color.setRGB(0.75, 0.22, 0.02);
    this.uniforms.uDaylight.value = daylight;
    this.uniforms.uFogColor.value.copy(this.sky.color);
    const far = opts.renderDistance * 16;
    this.uniforms.uFogNear.value = inLava ? 0.1 : underwater ? 2 : far * 0.55;
    this.uniforms.uFogFar.value = inLava ? 2.5 : underwater ? 18 : far * 0.95;
    this.camera.far = far * 1.5 + 400;

    this.chunks.update(this.camera.position, meshBudgetMs);

    const target = s.alive && showHand ? s.target() : null;
    this.entities.setTarget(target, s.mining && target && s.mining.x === target.x && s.mining.y === target.y && s.mining.z === target.z ? s.mining.progress : null);
    this.entities.update(s.world, s.mobs, s.items, s.tnt, daylight, this.camera, dt, this.elapsed);

    this.renderer.setClearColor(this.sky.color);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    if (s.alive && showHand) {
      const held = s.inventory.selectedStack();
      const bx = Math.floor(body.x);
      const by = Math.floor(body.y + PLAYER.eyeHeight * 0.5);
      const bz = Math.floor(body.z);
      const brightness = Math.max(lightBrightness(s.world.getSkyLight(bx, by, bz)) * daylight, lightBrightness(s.world.getBlockLight(bx, by, bz)));
      this.hand.update(held?.id ?? null, brightness, this.camera.aspect, dt, walking && body.onGround, !!s.mining);
      this.renderer.clearDepth();
      this.renderer.render(this.hand.scene, this.hand.camera);
    }
  }

  /** Renders just the sky (for menus behind a paused game). */
  renderIdle(): void {
    if (this.session) {
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
    } else {
      this.renderer.setClearColor(0x1d2733);
      this.renderer.clear();
    }
  }
}
