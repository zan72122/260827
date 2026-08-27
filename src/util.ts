import * as THREE from 'three';

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** frame-rate independent exponential approach */
export const damp = (cur: number, target: number, lambda: number, dt: number) =>
  lerp(cur, target, 1 - Math.exp(-lambda * dt));

export function dampV3(cur: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number): void {
  const t = 1 - Math.exp(-lambda * dt);
  cur.lerp(target, t);
}

/** deterministic PRNG */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  opts: { repeat?: [number, number]; srgb?: boolean } = {},
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  if (opts.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  tex.anisotropy = 4;
  return tex;
}

/** shared GLSL noise snippets for procedural shaders */
export const GLSL_NOISE = /* glsl */ `
float ffHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float ffNoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(ffHash(i), ffHash(i + vec2(1.0, 0.0)), f.x),
    mix(ffHash(i + vec2(0.0, 1.0)), ffHash(i + vec2(1.0, 1.0)), f.x),
    f.y);
}
float ffFbm(vec2 p){
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 3; i++){ v += a * ffNoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
`;

/** orient + scale a unit-height cylinder mesh so it connects two points (limb helper) */
const _limbDir = new THREE.Vector3();
const _limbMid = new THREE.Vector3();
const _limbUp = new THREE.Vector3(0, 1, 0);
const _limbQ = new THREE.Quaternion();
export function placeLimb(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
  _limbDir.subVectors(to, from);
  const len = Math.max(_limbDir.length(), 1e-5);
  _limbMid.addVectors(from, to).multiplyScalar(0.5);
  mesh.position.copy(_limbMid);
  _limbDir.normalize();
  _limbQ.setFromUnitVectors(_limbUp, _limbDir);
  mesh.quaternion.copy(_limbQ);
  mesh.scale.setY(len);
}
