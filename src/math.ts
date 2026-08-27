import * as THREE from 'three';

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent exponential smoothing factor. */
export const damp = (lambda: number, dt: number): number =>
  1 - Math.exp(-lambda * dt);

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function randRange(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

/** Deterministic-ish hash noise in [0,1). */
export function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();

/** Rotate unit vector v around axis(unnormalized ok) by angle = |axisTimesAngle|. */
export function rotateByAngularVelocity(
  v: THREE.Vector3,
  omega: THREE.Vector3,
  dt: number
): void {
  const w = omega.length();
  if (w * dt < 1e-9) return;
  _axis.copy(omega).multiplyScalar(1 / w);
  _q.setFromAxisAngle(_axis, w * dt);
  v.applyQuaternion(_q);
}
