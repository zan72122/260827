import * as THREE from 'three';

/**
 * Zone lighting: every quantity is keyframed over journeyProgress and lerped,
 * so scrubbing the finger continuously drives the light — terminal daylight,
 * dim sort hall, harsh noon apron, dim warm cargo hold.
 */

interface Key {
  p: number;
  bg: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  sunColor: number;
  sunI: number;
  sunDir: [number, number, number];
}

const KEYS: Key[] = [
  { p: 0.0, bg: 0xc7d2da, fogNear: 16, fogFar: 46, hemiSky: 0xe8eef2, hemiGround: 0x9a9c98, hemiI: 0.95, sunColor: 0xfff1dc, sunI: 1.7, sunDir: [-0.35, 1, 0.5] },
  { p: 0.155, bg: 0xc7d2da, fogNear: 16, fogFar: 46, hemiSky: 0xe8eef2, hemiGround: 0x9a9c98, hemiI: 0.95, sunColor: 0xfff1dc, sunI: 1.7, sunDir: [-0.35, 1, 0.5] },
  { p: 0.24, bg: 0x1c2024, fogNear: 7, fogFar: 24, hemiSky: 0x787f84, hemiGround: 0x2c3034, hemiI: 0.6, sunColor: 0xeae6d2, sunI: 0.8, sunDir: [-0.15, 1, 0.35] },
  { p: 0.47, bg: 0x1a1e22, fogNear: 7, fogFar: 26, hemiSky: 0x767d84, hemiGround: 0x2a2e32, hemiI: 0.55, sunColor: 0xeae6d2, sunI: 0.75, sunDir: [0.1, 1, 0.3] },
  { p: 0.63, bg: 0x1c2024, fogNear: 8, fogFar: 28, hemiSky: 0x787f84, hemiGround: 0x2c3034, hemiI: 0.6, sunColor: 0xeae6d2, sunI: 0.8, sunDir: [0.15, 1, 0.35] },
  { p: 0.745, bg: 0x2e3236, fogNear: 9, fogFar: 30, hemiSky: 0x8a9094, hemiGround: 0x34383c, hemiI: 0.7, sunColor: 0xf0ead6, sunI: 0.9, sunDir: [0.2, 1, 0.3] },
  { p: 0.78, bg: 0x5c707e, fogNear: 14, fogFar: 70, hemiSky: 0xa4bcd2, hemiGround: 0x6e7670, hemiI: 0.85, sunColor: 0xfff3dd, sunI: 1.6, sunDir: [-0.3, 1, -0.5] },
  { p: 0.82, bg: 0xaecbe4, fogNear: 45, fogFar: 190, hemiSky: 0xbcd7ee, hemiGround: 0x8f978c, hemiI: 1.05, sunColor: 0xfff3dd, sunI: 2.7, sunDir: [-0.35, 1, -0.55] },
  { p: 0.95, bg: 0xaecbe4, fogNear: 45, fogFar: 190, hemiSky: 0xbcd7ee, hemiGround: 0x8f978c, hemiI: 1.0, sunColor: 0xfff3dd, sunI: 2.4, sunDir: [-0.35, 1, -0.55] },
  { p: 0.972, bg: 0x6e747a, fogNear: 18, fogFar: 90, hemiSky: 0x9aa4ac, hemiGround: 0x585e5a, hemiI: 0.75, sunColor: 0xf2e4c8, sunI: 1.1, sunDir: [-0.35, 1, -0.55] },
  { p: 0.99, bg: 0x171310, fogNear: 3.5, fogFar: 12, hemiSky: 0x7a6f60, hemiGround: 0x2f2822, hemiI: 0.8, sunColor: 0xe8d0a0, sunI: 0.15, sunDir: [0, 1, -0.3] },
  { p: 1.0, bg: 0x171310, fogNear: 3.5, fogFar: 12, hemiSky: 0x7a6f60, hemiGround: 0x2f2822, hemiI: 0.8, sunColor: 0xe8d0a0, sunI: 0.15, sunDir: [0, 1, -0.3] },
];

const _cA = new THREE.Color();
const _cB = new THREE.Color();
const _dirA = new THREE.Vector3();
const _dirB = new THREE.Vector3();

export class Lighting {
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  private fog: THREE.Fog;
  private bg: THREE.Color;

  constructor(scene: THREE.Scene) {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -5;
    sc.right = 5;
    sc.top = 5;
    sc.bottom = -5;
    sc.near = 1;
    sc.far = 40;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.bg = new THREE.Color(KEYS[0].bg);
    scene.background = this.bg;
    this.fog = new THREE.Fog(KEYS[0].bg, KEYS[0].fogNear, KEYS[0].fogFar);
    scene.fog = this.fog;
  }

  update(p: number, bagPos: THREE.Vector3): void {
    let i = 0;
    while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = THREE.MathUtils.clamp((p - a.p) / (b.p - a.p), 0, 1);
    this.bg.copy(_cA.setHex(a.bg)).lerp(_cB.setHex(b.bg), t);
    this.fog.color.copy(this.bg);
    this.fog.near = THREE.MathUtils.lerp(a.fogNear, b.fogNear, t);
    this.fog.far = THREE.MathUtils.lerp(a.fogFar, b.fogFar, t);
    this.hemi.color.copy(_cA.setHex(a.hemiSky)).lerp(_cB.setHex(b.hemiSky), t);
    this.hemi.groundColor.copy(_cA.setHex(a.hemiGround)).lerp(_cB.setHex(b.hemiGround), t);
    this.hemi.intensity = THREE.MathUtils.lerp(a.hemiI, b.hemiI, t);
    this.sun.color.copy(_cA.setHex(a.sunColor)).lerp(_cB.setHex(b.sunColor), t);
    this.sun.intensity = THREE.MathUtils.lerp(a.sunI, b.sunI, t);
    _dirA.fromArray(a.sunDir).lerp(_dirB.fromArray(b.sunDir), t).normalize();
    // sun follows the bag so the small shadow frustum always covers it
    this.sun.position.copy(bagPos).addScaledVector(_dirA, 16);
    this.sun.target.position.copy(bagPos);
  }
}
