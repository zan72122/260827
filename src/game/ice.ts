// Ice field: one displaced plane whose shader turns carved areas into dark
// sea water, driven by a persistent canvas mask (R = open water, G = cracks).
// Cracks are painted slightly ahead of the bow, water behind it, so the
// cause->effect order (load -> crack -> break -> open lane) reads on screen.

import * as THREE from 'three';
import {
  FIELD_MIN_X, FIELD_MIN_Z, FIELD_W, FIELD_L, mulberry32,
} from './const';

const MASK_SIZE = 1024;
const PX_PER_M_X = MASK_SIZE / FIELD_W;
const PX_PER_M_Z = MASK_SIZE / FIELD_L;

const VERT = /* glsl */ `
uniform sampler2D uMask;
uniform float uSeed;
varying vec3 vWorld;
varying vec2 vMuv;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float iceHeight(vec2 xz, float water) {
  float n = vnoise(xz * 0.06 + uSeed) * 0.6 + vnoise(xz * 0.21 + uSeed * 2.7) * 0.4;
  float r = abs(vnoise(xz * 0.033 + uSeed * 5.1) - 0.5) * 2.0;
  r = pow(1.0 - r, 7.0);
  float h = n * 0.34 + r * 0.85;
  return h * (1.0 - water) - 0.72 * water;
}
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec2 muv = vec2((wp.x - (${FIELD_MIN_X.toFixed(1)})) / ${FIELD_W.toFixed(1)},
                  (wp.z - (${FIELD_MIN_Z.toFixed(1)})) / ${FIELD_L.toFixed(1)});
  vec4 m = texture2D(uMask, muv);
  float water = smoothstep(0.32, 0.62, m.r);
  wp.y += iceHeight(wp.xz, water);
  vWorld = wp;
  vMuv = muv;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMask;
uniform float uSeed;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec3 vWorld;
varying vec2 vMuv;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float iceHeight(vec2 xz, float water) {
  float n = vnoise(xz * 0.06 + uSeed) * 0.6 + vnoise(xz * 0.21 + uSeed * 2.7) * 0.4;
  float r = abs(vnoise(xz * 0.033 + uSeed * 5.1) - 0.5) * 2.0;
  r = pow(1.0 - r, 7.0);
  float h = n * 0.34 + r * 0.85;
  return h * (1.0 - water) - 0.72 * water;
}
float waterAt(vec2 xz) {
  vec2 muv = vec2((xz.x - (${FIELD_MIN_X.toFixed(1)})) / ${FIELD_W.toFixed(1)},
                  (xz.y - (${FIELD_MIN_Z.toFixed(1)})) / ${FIELD_L.toFixed(1)});
  return smoothstep(0.32, 0.62, texture2D(uMask, muv).r);
}

void main() {
  vec4 m = texture2D(uMask, vMuv);
  float water = smoothstep(0.32, 0.62, m.r);
  float deepWater = smoothstep(0.55, 0.95, m.r);

  // --- geometric normal from the height field --------------------------------
  float e = 0.9;
  float h0 = iceHeight(vWorld.xz, water);
  float hx = iceHeight(vWorld.xz + vec2(e, 0.0), waterAt(vWorld.xz + vec2(e, 0.0)));
  float hz = iceHeight(vWorld.xz + vec2(0.0, e), waterAt(vWorld.xz + vec2(0.0, e)));
  vec3 N = normalize(vec3(h0 - hx, e, h0 - hz));

  // --- ice surface -----------------------------------------------------------
  float snowCover = smoothstep(0.25, 0.75, vnoise(vWorld.xz * 0.045 + uSeed * 9.0));
  float grain = vnoise(vWorld.xz * 1.7 + uSeed * 3.0);
  vec3 blueIce = vec3(0.58, 0.70, 0.79);      // compressed, bubbled sea ice
  vec3 snow = vec3(0.90, 0.93, 0.955);
  vec3 iceCol = mix(blueIce, snow, snowCover);
  iceCol += (grain - 0.5) * 0.055;
  // faint old pressure cracks
  float pc = abs(vnoise(vWorld.xz * 0.045 + uSeed * 13.0) - 0.5) * 2.0;
  pc = smoothstep(0.045, 0.0, pc);
  iceCol = mix(iceCol, vec3(0.55, 0.64, 0.72), pc * 0.22);
  // painted cracks from the bow (G channel): dark seams into wet ice
  float crack = smoothstep(0.12, 0.55, m.g);
  iceCol = mix(iceCol, vec3(0.38, 0.48, 0.57), crack * 0.6);
  // wet, soaked band right at the channel edge
  float wet = smoothstep(0.10, 0.34, m.r) * (1.0 - water);
  iceCol = mix(iceCol, vec3(0.52, 0.62, 0.70), wet * 0.75);

  // --- open water in the lane ------------------------------------------------
  vec3 deep = vec3(0.035, 0.075, 0.105);
  vec3 shallow = vec3(0.10, 0.16, 0.20);
  vec2 rp = vWorld.xz * 0.55 + vec2(uTime * 0.16, uTime * 0.07);
  float ripA = vnoise(rp);
  float ripB = vnoise(vWorld.xz * 1.15 - vec2(uTime * 0.11, uTime * 0.19));
  vec3 wN = normalize(vec3((ripA - 0.5) * 0.35, 1.0, (ripB - 0.5) * 0.35));
  vec3 waterCol = mix(shallow, deep, deepWater);
  // brash: small drifting white ice bits, denser near the lane edges
  float edgeBand = water * (1.0 - deepWater);
  vec2 bp = vWorld.xz * 1.9 + vec2(uTime * 0.05, -uTime * 0.03);
  float bits = smoothstep(0.68, 0.80, vnoise(bp)) * (0.35 + 0.65 * edgeBand);
  waterCol = mix(waterCol, vec3(0.72, 0.79, 0.84), bits * water * 0.85);

  // --- lighting --------------------------------------------------------------
  vec3 L = normalize(uSunDir);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 nrm = normalize(mix(N, wN, water));
  float dif = max(dot(nrm, L), 0.0);
  vec3 hemi = mix(uGroundColor, uSkyColor, nrm.y * 0.5 + 0.5);
  vec3 lit;
  vec3 base = mix(iceCol, waterCol, water);
  lit = base * (hemi * 0.55 + uSunColor * dif * 0.75);
  // sun glints on the lane
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(nrm, H), 0.0), 90.0) * water * (1.0 - bits);
  lit += uSunColor * spec * 0.55;
  // sparkle on fresh snow
  float sp = step(0.985, vnoise(vWorld.xz * 6.0 + uSeed)) * snowCover * (1.0 - water);
  lit += uSunColor * sp * dif * 0.35;

  // --- aerial perspective ----------------------------------------------------
  float dist = length(cameraPosition - vWorld);
  float fogF = smoothstep(uFogNear, uFogFar, dist);
  float desat = fogF * 0.5;
  float lum = dot(lit, vec3(0.299, 0.587, 0.114));
  lit = mix(lit, vec3(lum), desat * 0.6);
  lit = mix(lit, uFogColor, fogF);

  gl_FragColor = vec4(lit, 1.0);
}
`;

export class IceField {
  mesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private material: THREE.ShaderMaterial;
  private dirty = false;
  private crackRng = mulberry32(1234);

  constructor(scene: THREE.Scene, seed: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = MASK_SIZE;
    this.canvas.height = MASK_SIZE;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.clearMask();

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.flipY = false;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    const geo = new THREE.PlaneGeometry(FIELD_W, FIELD_L, 300, 340);
    geo.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uMask: { value: this.texture },
        uSeed: { value: seed * 0.137 },
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(-0.55, 0.5, -0.35).normalize() },
        uSunColor: { value: new THREE.Color(1.0, 0.93, 0.83) },
        uSkyColor: { value: new THREE.Color(0.72, 0.80, 0.89) },
        uGroundColor: { value: new THREE.Color(0.36, 0.41, 0.47) },
        uFogColor: { value: new THREE.Color(0.765, 0.80, 0.845) },
        uFogNear: { value: 190 },
        uFogFar: { value: 640 },
      },
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(FIELD_MIN_X + FIELD_W / 2, 0, FIELD_MIN_Z + FIELD_L / 2);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  private clearMask(): void {
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
  }

  private toPx(x: number, z: number): [number, number] {
    return [(x - FIELD_MIN_X) * PX_PER_M_X, (z - FIELD_MIN_Z) * PX_PER_M_Z];
  }

  /** Open water behind the bow. */
  carveCircle(x: number, z: number, radiusM: number): void {
    const [cx, cy] = this.toPx(x, z);
    const r = radiusM * PX_PER_M_X;
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,0,0,0.95)');
    g.addColorStop(0.62, 'rgba(255,0,0,0.85)');
    g.addColorStop(0.86, 'rgba(110,0,0,0.5)');
    g.addColorStop(1, 'rgba(30,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    this.dirty = true;
  }

  /** A faint soaked ring (no open water) — used right at the bow contact. */
  wetRing(x: number, z: number, radiusM: number): void {
    const [cx, cy] = this.toPx(x, z);
    const r = radiusM * PX_PER_M_X;
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(70,0,0,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    this.dirty = true;
  }

  /**
   * Radial/local crack pattern painted a little ahead of the bow.
   * Several asymmetric variants so the breakup never looks like tiling.
   */
  paintCracks(x: number, z: number, heading: number, spanM: number): void {
    const rng = this.crackRng;
    const ctx = this.ctx;
    const [cx, cy] = this.toPx(x, z);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(0,255,0,0.55)';
    ctx.lineCap = 'round';
    const variant = Math.floor(rng() * 3);
    const rays = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < rays; i++) {
      let ang: number;
      if (variant === 0) {
        // fan ahead of the bow
        ang = heading + (rng() - 0.5) * 2.4;
      } else if (variant === 1) {
        // side-splitting cracks
        ang = heading + (rng() < 0.5 ? 1 : -1) * (0.6 + rng() * 1.4);
      } else {
        ang = rng() * Math.PI * 2;
      }
      const len = (spanM * (0.45 + rng() * 0.85)) * PX_PER_M_X;
      let px = cx, py = cy;
      let a = ang;
      ctx.lineWidth = 0.9 + rng() * 1.0;
      ctx.beginPath();
      ctx.moveTo(px, py);
      const kinks = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < kinks; k++) {
        a += (rng() - 0.5) * 0.9;
        const seg = len / kinks;
        px += Math.sin(a) * seg;
        py += Math.cos(a) * seg;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // occasional cross-chord (plate splitting sideways)
    if (rng() < 0.55) {
      const a = heading + Math.PI / 2 + (rng() - 0.5) * 0.7;
      const l = spanM * (0.5 + rng() * 0.6) * PX_PER_M_X;
      const off = (rng() - 0.5) * spanM * 0.8 * PX_PER_M_X;
      ctx.lineWidth = 1.1 + rng();
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * off - Math.sin(a) * l * 0.5, cy + Math.cos(a) * off - Math.cos(a) * l * 0.5);
      ctx.lineTo(cx + Math.sin(a) * l * 0.5, cy + Math.cos(a) * l * 0.5);
      ctx.stroke();
    }
    this.dirty = true;
  }

  /** Read back whether a world point is already open water. */
  isCarvedAt(x: number, z: number): boolean {
    const [cx, cy] = this.toPx(x, z);
    const d = this.ctx.getImageData(Math.round(cx), Math.round(cy), 1, 1).data;
    return d[0] > 140;
  }

  maskValueAt(x: number, z: number): number {
    const [cx, cy] = this.toPx(x, z);
    const d = this.ctx.getImageData(Math.round(cx), Math.round(cy), 1, 1).data;
    return d[0] / 255;
  }

  update(time: number): void {
    this.material.uniforms.uTime.value = time;
    if (this.dirty) {
      this.texture.needsUpdate = true;
      this.dirty = false;
    }
  }

  reset(seed: number): void {
    this.clearMask();
    this.crackRng = mulberry32(seed * 7 + 5);
    this.material.uniforms.uSeed.value = seed * 0.137;
    this.dirty = true;
  }

  get sunDir(): THREE.Vector3 {
    return this.material.uniforms.uSunDir.value as THREE.Vector3;
  }
}
