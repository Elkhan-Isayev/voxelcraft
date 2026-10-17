import * as THREE from 'three';
import { createRng } from '../core/rng';
import { createNoise2D } from '../core/noise';
import { celestialAngle, daylight, skyColor } from '../game/daycycle';

function pixelTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** Sun, moon, stars and drifting clouds. Everything follows the camera. */
export class Sky {
  readonly group = new THREE.Group();
  private readonly sun: THREE.Mesh;
  private readonly moon: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly clouds: THREE.Mesh;
  private readonly cloudTexture: THREE.Texture;
  private cloudOffset = 0;
  readonly color = new THREE.Color();

  constructor() {
    const sunTex = pixelTexture(16, (ctx) => {
      ctx.fillStyle = '#fff7b0';
      ctx.fillRect(2, 2, 12, 12);
      ctx.fillStyle = '#ffe14a';
      ctx.fillRect(4, 4, 8, 8);
    });
    const moonTex = pixelTexture(16, (ctx) => {
      ctx.fillStyle = '#e6e8f0';
      ctx.fillRect(3, 3, 10, 10);
      ctx.fillStyle = '#b8bccb';
      ctx.fillRect(5, 5, 3, 3);
      ctx.fillRect(9, 8, 2, 3);
    });
    const disc = (tex: THREE.Texture, size: number) =>
      new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }),
      );
    this.sun = disc(sunTex, 60);
    this.moon = disc(moonTex, 40);

    const rng = createRng(42);
    const starPos: number[] = [];
    for (let i = 0; i < 900; i++) {
      const u = rng() * 2 - 1;
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      starPos.push(Math.cos(a) * r * 400, u * 400, Math.sin(a) * r * 400);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }),
    );

    const noise = createNoise2D(7);
    this.cloudTexture = pixelTexture(64, (ctx) => {
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const v = noise(x / 6, y / 6) + noise(x / 3, y / 3) * 0.4;
          if (v > 0.25) {
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.fillRect(x, y, 1, 1);
          }
        }
    });
    this.cloudTexture.wrapS = this.cloudTexture.wrapT = THREE.RepeatWrapping;
    this.cloudTexture.repeat.set(4, 4);
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(1536, 1536),
      new THREE.MeshBasicMaterial({ map: this.cloudTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    this.clouds.rotation.x = -Math.PI / 2;

    for (const o of [this.stars, this.sun, this.moon, this.clouds]) o.renderOrder = -1;
    this.group.add(this.stars, this.sun, this.moon, this.clouds);
  }

  update(time: number, camera: THREE.Camera, dt: number, underwater: boolean): void {
    const angle = celestialAngle(time);
    const light = daylight(time);
    const [r, g, b] = skyColor(time);
    this.color.setRGB(r, g, b);
    if (underwater) this.color.setRGB(0.05 * light + 0.02, 0.12 * light + 0.05, 0.45 * light + 0.1);

    const cam = camera.position;
    this.group.position.set(cam.x, 0, cam.z);
    const dist = 300;
    // The sun rises in the east (+X) and sets in the west; the moon is opposite.
    this.sun.position.set(Math.cos(angle) * dist, cam.y + Math.sin(angle) * dist, 0);
    this.moon.position.set(-Math.cos(angle) * dist, cam.y - Math.sin(angle) * dist, 0);
    this.sun.lookAt(cam);
    this.moon.lookAt(cam);
    this.stars.position.y = cam.y;
    this.stars.rotation.z = angle;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - light * 1.6);

    // Clouds stay fixed in the world (one texture repeat spans 384 blocks) and drift slowly east.
    this.cloudOffset += dt * 0.0015;
    this.cloudTexture.offset.set(cam.x / 384 + this.cloudOffset, -cam.z / 384);
    this.clouds.position.y = 108;
    const cm = this.clouds.material as THREE.MeshBasicMaterial;
    cm.color.setScalar(0.08 + 0.92 * Math.max(0, (light - 0.18) / 0.82));
    cm.opacity = 0.8;
    this.group.visible = !underwater;
  }
}
