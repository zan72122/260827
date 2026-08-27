import * as THREE from 'three';
import type { Quality } from '../core/quality';

// Suspended particulate ("marine snow") that wraps around the camera while it
// is underwater. Density fades in with depth so the near-surface water stays
// clear and the mid-water reads as a different layer.
export class Motes {
  readonly points: THREE.Points;
  private box = new THREE.Vector3(46, 30, 46);
  private mat: THREE.PointsMaterial;

  constructor(quality: Quality) {
    const n = quality.motes;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * this.box.x;
      pos[i * 3 + 1] = (Math.random() - 0.5) * this.box.y;
      pos[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mat = new THREE.PointsMaterial({
      color: 0xbfd6cf, size: 0.14, transparent: true, opacity: 0,
      depthWrite: false, sizeAttenuation: true
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  update(cam: THREE.Vector3, t: number): void {
    // Density: none above water, light in mid-water, a bit more near bottom.
    const depth = -cam.y;
    const target = depth < 1 ? 0 : THREE.MathUtils.clamp((depth - 1) / 14, 0, 1) * 0.5;
    this.mat.opacity += (target - this.mat.opacity) * 0.08;
    this.points.visible = this.mat.opacity > 0.01;
    if (!this.points.visible) return;
    // Wrap the fixed pool around the camera; slow drift.
    this.points.position.set(
      cam.x - ((cam.x % 7) + 7) % 7,
      cam.y - ((cam.y % 7) + 7) % 7,
      cam.z - ((cam.z % 7) + 7) % 7
    );
    this.points.rotation.y = Math.sin(t * 0.02) * 0.02;
  }
}

// Splash / bubble burst where the cable enters the water at the stern.
export class EntrySplash {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private n: number;
  private active = false;

  constructor() {
    this.n = 90;
    this.pos = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n * 3);
    this.life = new Float32Array(this.n).fill(-1);
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(this.pos, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mat = new THREE.PointsMaterial({
      color: 0xeef7fa, size: 0.3, transparent: true, opacity: 0.75,
      depthWrite: false, sizeAttenuation: true
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  setActive(v: boolean): void {
    this.active = v;
    if (v) this.points.visible = true;
  }

  update(origin: THREE.Vector3, dt: number): void {
    if (!this.active && !this.points.visible) return;
    let budget = this.active ? Math.max(1, Math.round(dt * 60)) : 0;
    let anyAlive = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] < 0) {
        if (budget > 0) {
          budget--;
          this.life[i] = 0.5 + Math.random() * 0.5;
          this.pos[i * 3] = origin.x + (Math.random() - 0.5) * 0.6;
          this.pos[i * 3 + 1] = origin.y;
          this.pos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.6;
          this.vel[i * 3] = (Math.random() - 0.5) * 1.4;
          this.vel[i * 3 + 1] = 1.2 + Math.random() * 1.6;
          this.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.4;
        } else {
          this.pos[i * 3 + 1] = -999;
        }
        continue;
      }
      this.life[i] -= dt;
      anyAlive = true;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] -= 6 * dt;
    }
    if (!this.active && !anyAlive) this.points.visible = false;
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}

// Scratch objects for the per-frame fish update (no allocation in the loop).
const _fm = new THREE.Matrix4();
const _fp = new THREE.Vector3();
const _fq = new THREE.Quaternion();
const _fe = new THREE.Euler();
const _fone = new THREE.Vector3(1, 1, 1);

// A few small fish groups mid-water - deliberately sparse.
export class Fish {
  readonly mesh: THREE.InstancedMesh;
  private centers: THREE.Vector3[] = [];
  private phases: number[] = [];
  private n: number;

  constructor(quality: Quality) {
    this.n = quality.fish;
    const geo = new THREE.ConeGeometry(0.22, 1.0, 5);
    geo.rotateZ(-Math.PI / 2); // point along +x
    const mat = new THREE.MeshStandardMaterial({ color: 0x7d8f99, roughness: 0.6, metalness: 0.3 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.n);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < this.n; i++) {
      const g = i < this.n / 2 ? 0 : 1;
      this.centers.push(new THREE.Vector3(g === 0 ? -30 : 34, -12 - g * 6, g === 0 ? 14 : -18));
      this.phases.push(Math.random() * Math.PI * 2 + i);
    }
  }

  update(t: number): void {
    const m = _fm;
    const p = _fp;
    const q = _fq;
    const e = _fe;
    for (let i = 0; i < this.n; i++) {
      const c = this.centers[i];
      const ph = this.phases[i];
      const r = 4 + (i % 3);
      const a = t * 0.35 + ph;
      p.set(c.x + Math.cos(a) * r, c.y + Math.sin(t * 0.8 + ph) * 0.6, c.z + Math.sin(a) * r);
      e.set(0, -a - Math.PI / 2 + Math.PI, 0);
      q.setFromEuler(e);
      m.compose(p, q, _fone);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
