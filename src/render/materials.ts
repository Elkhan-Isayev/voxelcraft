import * as THREE from 'three';
import { buildAtlasPixels } from './atlas';

export interface Atlas {
  texture: THREE.Texture;
  canvas: HTMLCanvasElement;
  pixels: Uint8ClampedArray;
  size: number;
}

export function createAtlas(): Atlas {
  const { size, pixels } = buildAtlasPixels();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), size, size), 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  return { texture, canvas, pixels, size };
}

/** Converts a 0..15 light level to brightness, using Minecraft's curve plus a small ambient floor. */
export function lightBrightness(level: number): number {
  const f = level / 15;
  return 0.06 + 0.94 * (f / (4 - 3 * f));
}

const vertex = /* glsl */ `
  attribute vec3 aLight;
  uniform float uDaylight;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vDist;

  float curve(float level) {
    float f = level / 15.0;
    return f / (4.0 - 3.0 * f);
  }

  void main() {
    vUv = uv;
    float sky = curve(aLight.x) * uDaylight;
    float blk = curve(aLight.y);
    vec3 torch = vec3(blk, blk * 0.88, blk * 0.7);
    vec3 light = max(vec3(sky), torch);
    vColor = (0.06 + 0.94 * light) * aLight.z;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uAlphaCut;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vDist;

  void main() {
    vec4 tex = texture2D(uTexture, vUv);
    if (tex.a < uAlphaCut) discard;
    vec3 color = tex.rgb * vColor;
    float fog = smoothstep(uFogNear, uFogFar, vDist);
    gl_FragColor = vec4(mix(color, uFogColor, fog), tex.a * uOpacity);
  }
`;

export interface WorldUniforms {
  uTexture: { value: THREE.Texture };
  uDaylight: { value: number };
  uFogColor: { value: THREE.Color };
  uFogNear: { value: number };
  uFogFar: { value: number };
}

export function createWorldUniforms(texture: THREE.Texture): WorldUniforms {
  return {
    uTexture: { value: texture },
    uDaylight: { value: 1 },
    uFogColor: { value: new THREE.Color(0.6, 0.75, 1) },
    uFogNear: { value: 40 },
    uFogFar: { value: 90 },
  };
}

export function createSolidMaterial(u: WorldUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...u, uAlphaCut: { value: 0.5 }, uOpacity: { value: 1 } },
    vertexShader: vertex,
    fragmentShader: fragment,
  });
}

export function createWaterMaterial(u: WorldUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...u, uAlphaCut: { value: 0.01 }, uOpacity: { value: 1 } },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
