import * as THREE from 'three';

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t: number) => t * t * (3 - 2 * t);
export const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
export const easeIn = (t: number) => t * t;
// overshooting pop, for the "spon" moments
export const easeOutBack = (t: number, s = 1.7) => {
  const u = t - 1;
  return 1 + u * u * ((s + 1) * u + s);
};

// deterministic pseudo random
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// cheap value noise (2d), smooth enough for cloth wrinkles
const nrand = mulberry32(1234);
const PERM = new Uint8Array(512);
for (let i = 0; i < 512; i++) PERM[i] = Math.floor(nrand() * 256);
function hash2(x: number, y: number) {
  return PERM[(PERM[x & 255] + y) & 255] / 255;
}
export function vnoise2(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm2(x: number, y: number, oct = 4) {
  let f = 0, amp = 0.5, sum = 0;
  for (let i = 0; i < oct; i++) {
    f += vnoise2(x, y) * amp;
    sum += amp; amp *= 0.5; x *= 2.03; y *= 2.11;
  }
  return f / sum;
}

// critically-damped-ish spring for sway
export class Spring {
  v = 0; x = 0; target = 0;
  constructor(public stiffness = 40, public damping = 8) {}
  update(dt: number) {
    const f = (this.target - this.x) * this.stiffness - this.v * this.damping;
    this.v += f * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
    else if (mat) mat.dispose();
  });
}
