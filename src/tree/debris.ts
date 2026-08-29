/**
 * What the shaker actually removes: last year's dry needles, a little dust and
 * the odd dead twig. Healthy green foliage never enters this system.
 */
import * as THREE from 'three';
import { lerp } from '../core/rand';

const GRAVITY = -6.4;

export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private count: number;
  private live: boolean[] = [];
  private pos: Float32Array;
  private vel: Float32Array;
  private spin: Float32Array;
  private rot: Float32Array;
  private size: Float32Array;
  private age: Float32Array;
  private landed: boolean[] = [];
  private cursor = 0;
  private groundY = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private color = new THREE.Color();

  constructor(max: number, material: THREE.Material) {
    this.count = max;
    // a dry needle: a thin, slightly bent blade
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array([
      0, 0, 0, 0.006, 0, 0.0015, 0.03, 0.004, 0.0015, 0.03, 0.004, -0.0005,
    ]);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    );
    g.setIndex([0, 2, 1, 0, 3, 2]);

    this.mesh = new THREE.InstancedMesh(g, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;

    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.spin = new Float32Array(max * 3);
    this.rot = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.age = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      this.live.push(false);
      this.landed.push(false);
      this.size[i] = 1;
      this.hide(i);
    }
  }

  setGround(y: number): void {
    this.groundY = y;
  }

  private hide(i: number): void {
    this.m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(i, this.m);
  }

  /** Kind 0 = dry needle, 1 = dust mote, 2 = twig. */
  spawn(p: THREE.Vector3, energy: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    const r = Math.random();
    const kind = r < 0.7 ? 0 : r < 0.93 ? 1 : 2;
    this.live[i] = true;
    this.landed[i] = false;
    this.age[i] = 0;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    const kick = 0.35 + energy * 1.5;
    this.vel[i * 3] = (Math.random() - 0.5) * kick;
    this.vel[i * 3 + 1] = -0.15 - Math.random() * 0.4;
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * kick;
    this.spin[i * 3] = (Math.random() - 0.5) * 12;
    this.spin[i * 3 + 1] = (Math.random() - 0.5) * 8;
    this.spin[i * 3 + 2] = (Math.random() - 0.5) * 12;
    this.rot[i * 3] = Math.random() * 6.28;
    this.rot[i * 3 + 1] = Math.random() * 6.28;
    this.rot[i * 3 + 2] = Math.random() * 6.28;
    this.size[i] = kind === 0 ? 1.5 + Math.random() * 1.1 : kind === 1 ? 0.7 : 2.6 + Math.random() * 1.2;

    // dry tan / rust for needles, pale grey for dust, dark for twigs
    if (kind === 0) this.color.setRGB(lerp(0.44, 0.66, Math.random()), lerp(0.26, 0.4, Math.random()), 0.12);
    else if (kind === 1) this.color.setRGB(0.56, 0.53, 0.48);
    else this.color.setRGB(0.24, 0.18, 0.12);
    this.mesh.setColorAt(i, this.color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Returns how many pieces reached the ground this frame. */
  update(dt: number): number {
    let landedNow = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this.live[i]) continue;
      const b = i * 3;
      this.age[i] += dt;
      if (!this.landed[i]) {
        this.vel[b + 1] += GRAVITY * dt;
        // flutter: dry needles do not fall straight
        const t = this.age[i] * 9 + i;
        this.vel[b] += Math.sin(t) * 0.5 * dt;
        this.vel[b + 2] += Math.cos(t * 0.8) * 0.5 * dt;
        const drag = Math.exp(-2.4 * dt);
        this.vel[b] *= drag;
        this.vel[b + 1] *= Math.exp(-1.5 * dt);
        this.vel[b + 2] *= drag;
        this.pos[b] += this.vel[b] * dt;
        this.pos[b + 1] += this.vel[b + 1] * dt;
        this.pos[b + 2] += this.vel[b + 2] * dt;
        this.rot[b] += this.spin[b] * dt;
        this.rot[b + 1] += this.spin[b + 1] * dt;
        this.rot[b + 2] += this.spin[b + 2] * dt;
        if (this.pos[b + 1] <= this.groundY + 0.006) {
          this.pos[b + 1] = this.groundY + 0.006;
          this.landed[i] = true;
          this.rot[b] = Math.PI / 2;
          this.rot[b + 2] = Math.random() * 6.28;
          this.age[i] = 0;
          landedNow++;
        }
      } else if (this.age[i] > 5.5) {
        this.live[i] = false;
        this.hide(i);
        continue;
      }

      const fade = this.landed[i] ? Math.max(0, 1 - Math.max(0, this.age[i] - 4) / 1.5) : 1;
      const sc = this.size[i] * fade;
      this.e.set(this.rot[b], this.rot[b + 1], this.rot[b + 2]);
      this.q.setFromEuler(this.e);
      this.v.set(this.pos[b], this.pos[b + 1], this.pos[b + 2]);
      this.s.set(sc, sc, sc);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    return landedNow;
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) {
      this.live[i] = false;
      this.hide(i);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
