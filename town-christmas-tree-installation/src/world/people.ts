import * as THREE from 'three';
import { Rng } from '../core/rng';
import { Materials } from './materials';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function box(mat: THREE.Material, sx: number, sy: number, sz: number, p: THREE.Vector3, parent: THREE.Object3D) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.copy(p);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export type Gesture =
  | 'idle'
  | 'watch'
  | 'signal-hold'
  | 'signal-up'
  | 'signal-down'
  | 'ok'
  | 'wave'
  | 'pull'
  | 'point';

/**
 * A simple hierarchically rigged adult. Bones are Groups; poses are driven by
 * damped targets so the crew reads as calm professionals, never twitchy.
 */
export class Person {
  readonly root = new THREE.Group();
  readonly height: number;
  private shoulderL = new THREE.Group();
  private shoulderR = new THREE.Group();
  private elbowL = new THREE.Group();
  private elbowR = new THREE.Group();
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private gesture: Gesture = 'idle';
  private phase: number;
  private cur = { lx: 0, lz: 0, rx: 0, rz: 0, el: 0, er: 0, ty: 0, hy: 0 };

  constructor(m: Materials, rng: Rng, worker: boolean, coatIndex = 0) {
    this.height = rng.range(1.68, 1.86);
    this.phase = rng.range(0, Math.PI * 2);
    const s = this.height / 1.78;
    this.root.scale.setScalar(s);

    const trouser = worker
      ? new THREE.MeshStandardMaterial({ color: 0x2b3a4a, roughness: 0.9 })
      : m.coat[(coatIndex + 3) % m.coat.length];
    const jacket = worker ? m.hiVis : m.coat[coatIndex % m.coat.length];

    // Legs.
    for (const [g, side] of [
      [this.hipL, -1],
      [this.hipR, 1],
    ] as [THREE.Group, number][]) {
      g.position.set(0, 0.88, side * 0.11);
      this.root.add(g);
      box(trouser, 0.17, 0.46, 0.19, V(0, -0.23, 0), g);
      box(trouser, 0.15, 0.44, 0.17, V(0, -0.66, 0), g);
      box(m.craneAccent, 0.24, 0.11, 0.19, V(0.03, -0.9, 0), g);
    }

    // Torso.
    this.torso.position.set(0, 0.88, 0);
    this.root.add(this.torso);
    box(trouser, 0.36, 0.24, 0.24, V(0, 0.1, 0), this.torso);
    box(jacket, 0.4, 0.44, 0.26, V(0, 0.42, 0), this.torso);
    if (worker) {
      // Retro-reflective bands.
      for (const y of [0.32, 0.5]) box(m.helmet, 0.42, 0.05, 0.28, V(0, y, 0), this.torso);
      box(m.craneAccent, 0.16, 0.12, 0.1, V(0.12, 0.2, 0.14), this.torso);
    }

    // Arms.
    for (const [sh, el, side] of [
      [this.shoulderL, this.elbowL, -1],
      [this.shoulderR, this.elbowR, 1],
    ] as [THREE.Group, THREE.Group, number][]) {
      sh.position.set(0, 0.62, side * 0.25);
      this.torso.add(sh);
      box(jacket, 0.14, 0.32, 0.15, V(0, -0.16, 0), sh);
      el.position.set(0, -0.32, 0);
      sh.add(el);
      box(jacket, 0.12, 0.3, 0.13, V(0, -0.15, 0), el);
      box(worker ? m.craneAccent : m.skin, 0.11, 0.13, 0.12, V(0, -0.35, 0), el);
    }

    // Head.
    this.head.position.set(0, 0.72, 0);
    this.torso.add(this.head);
    box(m.skin, 0.13, 0.1, 0.14, V(0, 0.03, 0), this.head);
    box(m.skin, 0.18, 0.2, 0.19, V(0, 0.16, 0), this.head);
    if (worker) {
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.helmet);
      helmet.position.set(0, 0.24, 0);
      helmet.castShadow = true;
      this.head.add(helmet);
      box(m.helmet, 0.19, 0.02, 0.09, V(0.07, 0.24, 0), this.head);
    } else {
      const hat = new THREE.Mesh(new THREE.SphereGeometry(0.135, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2), m.coat[(coatIndex + 1) % m.coat.length]);
      hat.position.set(0, 0.235, 0);
      hat.castShadow = true;
      this.head.add(hat);
      // Scarf.
      box(m.coat[(coatIndex + 2) % m.coat.length], 0.22, 0.09, 0.22, V(0, 0.06, 0), this.head);
    }
  }

  setGesture(g: Gesture): void {
    this.gesture = g;
  }

  update(dt: number, time: number): void {
    const t = time + this.phase;
    const target = { lx: 0.08, lz: 0.06, rx: 0.08, rz: -0.06, el: -0.3, er: -0.3, ty: 0, hy: 0 };
    switch (this.gesture) {
      case 'watch':
        target.hy = Math.sin(t * 0.4) * 0.25;
        break;
      case 'signal-hold':
        // Flat palm held out: the universal "stop / hold".
        target.rz = -1.55;
        target.er = -0.15;
        target.rx = 0.25;
        break;
      case 'signal-up':
        target.rz = -2.45 + Math.sin(t * 2.4) * 0.16;
        target.er = -1.5;
        break;
      case 'signal-down':
        target.rz = -0.9 + Math.sin(t * 2.2) * 0.2;
        target.er = -0.9;
        break;
      case 'ok':
        target.rz = -2.1;
        target.er = -1.9;
        target.hy = 0.12;
        break;
      case 'wave':
        target.rz = -2.5;
        target.er = -1.1 + Math.sin(t * 5.2) * 0.5;
        break;
      case 'pull':
        target.rz = -1.15;
        target.lz = 1.05;
        target.el = -0.75;
        target.er = -0.75;
        target.ty = 0.12;
        break;
      case 'point':
        target.rz = -1.35;
        target.er = -0.1;
        break;
      default:
        target.lz = 0.06 + Math.sin(t * 0.8) * 0.05;
        target.rz = -0.06 - Math.sin(t * 0.8) * 0.05;
        break;
    }
    const k = 1 - Math.exp(-7 * dt);
    for (const key of Object.keys(this.cur) as (keyof typeof this.cur)[]) {
      this.cur[key] += (target[key] - this.cur[key]) * k;
    }
    this.shoulderL.rotation.set(this.cur.lx, 0, this.cur.lz);
    this.shoulderR.rotation.set(this.cur.rx, 0, this.cur.rz);
    this.elbowL.rotation.x = this.cur.el;
    this.elbowR.rotation.x = this.cur.er;
    this.torso.rotation.x = this.cur.ty;
    this.head.rotation.y = this.cur.hy;
    // Weight shift, so nobody stands like a statue.
    this.root.position.y = Math.sin(t * 0.9) * 0.008;
    this.hipL.rotation.x = Math.sin(t * 0.9) * 0.02;
    this.hipR.rotation.x = -Math.sin(t * 0.9) * 0.02;
  }

  lookAt(p: THREE.Vector3): void {
    const d = p.clone().sub(this.root.position);
    this.root.rotation.y = Math.atan2(-d.z, d.x) - Math.PI / 2;
  }
}

/** Distant onlookers: one instanced draw, per-person colour and gentle motion. */
export class Crowd {
  readonly mesh: THREE.InstancedMesh;
  private base: { p: THREE.Vector3; ry: number; phase: number; scale: number }[] = [];
  private mtx = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private sv = new THREE.Vector3();
  private tmpP = new THREE.Vector3();

  constructor(
    m: Materials,
    rng: Rng,
    count: number,
    radiusInner: number,
    radiusOuter: number,
    /** Angles (radians) kept clear so vehicles have a route in and out. */
    gaps: { at: number; half: number }[] = [],
  ) {
    const parts: THREE.BufferGeometry[] = [];
    const body = new THREE.CapsuleGeometry(0.19, 0.72, 4, 8);
    body.translate(0, 1.06, 0);
    parts.push(body);
    const legs = new THREE.BoxGeometry(0.3, 0.72, 0.24);
    legs.translate(0, 0.36, 0);
    parts.push(legs);
    const head = new THREE.SphereGeometry(0.15, 8, 6);
    head.translate(0, 1.68, 0);
    parts.push(head);
    const merged = mergeGeoms(parts);

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(merged, mat, Math.max(1, count));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;

    const palette = m.coat.map((c) => c.color);
    const blocked = (angle: number) =>
      gaps.some((g) => {
        let d = Math.abs(angle - g.at);
        if (d > Math.PI) d = Math.PI * 2 - d;
        return d < g.half;
      });
    for (let i = 0; i < count; i++) {
      let a = rng.range(0, Math.PI * 2);
      for (let guard = 0; guard < 12 && blocked(a); guard++) a = rng.range(0, Math.PI * 2);
      const r = rng.range(radiusInner, radiusOuter);
      const p = new THREE.Vector3(Math.cos(a) * r + rng.jitter(0.5), 0, Math.sin(a) * r * 0.92 + rng.jitter(0.5));
      this.base.push({ p, ry: Math.atan2(-p.z, -p.x) + rng.jitter(0.4), phase: rng.range(0, 6.3), scale: rng.range(0.62, 1.04) });
      const c = palette[rng.int(0, palette.length - 1)].clone().offsetHSL(rng.jitter(0.03), rng.jitter(0.1), rng.jitter(0.08));
      this.mesh.setColorAt(i, c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.update(0);
  }

  private gathered = 1;

  /** Onlookers press up to the barrier once the working zone is clear. */
  gather(t: number): void {
    this.gathered = 1 - 0.14 * THREE.MathUtils.clamp(t, 0, 1);
  }

  update(time: number): void {
    for (let i = 0; i < this.base.length; i++) {
      const b = this.base[i];
      this.q.setFromEuler(new THREE.Euler(0, b.ry + Math.sin(time * 0.5 + b.phase) * 0.08, 0));
      this.sv.set(b.scale, b.scale * (1 + Math.sin(time * 1.1 + b.phase) * 0.006), b.scale);
      this.tmpP.copy(b.p).multiplyScalar(this.gathered);
      this.tmpP.y = b.p.y;
      this.mtx.compose(this.tmpP, this.q, this.sv);
      this.mesh.setMatrixAt(i, this.mtx);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function mergeGeoms(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let off = 0;
  for (const g of list) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    const u = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
    }
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off);
    off += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}
