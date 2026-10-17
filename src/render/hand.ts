import * as THREE from 'three';
import { getBlock } from '../core/blocks';
import { getItem, isBlockItem } from '../core/items';
import { tileIndex, tileUV } from './atlas';
import { blockTiles, tiledBox } from './entities';

/** First-person held item (or bare arm), drawn in its own pass on top of the world. */
export class HandRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
  private readonly pivot = new THREE.Group();
  private readonly material: THREE.MeshBasicMaterial;
  private readonly armMaterial = new THREE.MeshBasicMaterial({ color: 0xc8956b });
  private current: THREE.Mesh | null = null;
  private currentId: number | null | undefined = undefined;
  private swing = 0;
  private bobPhase = 0;

  constructor(atlas: THREE.Texture) {
    this.material = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true });
    this.scene.add(this.pivot);
  }

  /** Starts a swing animation (attack, place, mining). */
  swingArm(): void {
    if (this.swing <= 0) this.swing = 1;
  }

  private build(id: number | null): THREE.Mesh {
    if (id === null) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.7), this.armMaterial);
      arm.position.set(0.62, -0.5, -0.82);
      arm.rotation.set(0.35, -0.25, 0.05);
      return arm;
    }
    if (isBlockItem(id) && getBlock(id).render !== 'cross') {
      const m = new THREE.Mesh(tiledBox(0.34, blockTiles(id)), this.material);
      m.position.set(0.72, -0.62, -1.25);
      m.rotation.set(0.05, Math.PI / 4 + 0.15, 0);
      return m;
    }
    const g = new THREE.PlaneGeometry(0.55, 0.55);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const [u0, v0, u1, v1] = tileUV(tileIndex(isBlockItem(id) ? getBlock(id).textures.side : getItem(id).texture));
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(uv.count * 3).fill(1), 3));
    const m = new THREE.Mesh(g, this.material);
    m.position.set(0.7, -0.5, -1.15);
    m.rotation.set(0, -Math.PI / 2.6, Math.PI / 10);
    return m;
  }

  update(heldId: number | null, brightness: number, aspect: number, dt: number, walking: boolean, mining: boolean): void {
    if (heldId !== this.currentId) {
      if (this.current) {
        this.pivot.remove(this.current);
        if (this.current.geometry) this.current.geometry.dispose();
      }
      this.current = this.build(heldId);
      this.pivot.add(this.current);
      this.currentId = heldId;
    }
    if (mining) this.swingArm();
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.material.color.setScalar(brightness);
    this.armMaterial.color.setRGB(0.78 * brightness, 0.58 * brightness, 0.42 * brightness);

    if (walking) this.bobPhase += dt * 9;
    const bob = walking ? Math.sin(this.bobPhase) * 0.02 : 0;
    const bobY = walking ? Math.abs(Math.cos(this.bobPhase)) * 0.02 : 0;

    let swingRot = 0;
    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - dt * 4);
      swingRot = Math.sin((1 - this.swing) * Math.PI);
    }
    this.pivot.position.set(bob - swingRot * 0.15, bobY - swingRot * 0.12, swingRot * -0.1);
    this.pivot.rotation.set(-swingRot * 0.6, swingRot * 0.3, 0);
  }
}
