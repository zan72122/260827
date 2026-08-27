// The stocking: a ring-based tube whose radii/centres are deformable at
// runtime, so each dropped gift inflates it from the bottom with a bulge
// shaped like the gift — and the bulges stack in drop order.
import * as THREE from 'three';
import { clamp01, lerp } from './util';
import { knitTexture } from './textures';
import type { GiftKind } from './gifts';

const RINGS = 22;
const SEGS = 14;

interface Bulge {
  center: number;   // 0 (toe) .. 1 (cuff) along the leg
  width: number;    // gaussian sigma
  rx: number;       // radial growth x
  rz: number;
  squareness: number; // 0 round … 1 boxy cross-section
  grow: number;     // animation 0..1
}

export class Stocking {
  group = new THREE.Group();
  private mesh: THREE.Mesh;
  private geo: THREE.BufferGeometry;
  private baseRing: { cx: number; cy: number; cz: number; r: number }[] = [];
  private bulges: Bulge[] = [];
  private peek: THREE.Group | null = null;
  private time = 0;
  private wobbleAmt = 0;

  // stocking hangs from the top; leg points down with a toe curve at bottom
  constructor(seed: number, hue: number) {
    const tex = knitTexture(seed, hue);
    tex.repeat.set(2, 2);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide });
    this.geo = new THREE.BufferGeometry();

    const legLen = 0.62;
    for (let i = 0; i < RINGS; i++) {
      const t = i / (RINGS - 1);      // 0 top → 1 bottom
      let r = lerp(0.085, 0.105, t);  // widens slightly toward the foot
      let cz = 0, cy = -t * legLen;
      // toe curve: last third bends forward (+z)
      if (t > 0.68) {
        const c = (t - 0.68) / 0.32;
        cz = Math.sin(c * Math.PI * 0.5) * 0.16;
        cy = -(0.68 * legLen + Math.sin(c * Math.PI * 0.42) * 0.14);
        r = lerp(0.105, 0.075, c * c);
      }
      this.baseRing.push({ cx: 0, cy, cz, r });
    }

    const posArr = new Float32Array(RINGS * (SEGS + 1) * 3);
    const uvArr = new Float32Array(RINGS * (SEGS + 1) * 2);
    const idx: number[] = [];
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j <= SEGS; j++) {
        uvArr[(i * (SEGS + 1) + j) * 2] = j / SEGS;
        uvArr[(i * (SEGS + 1) + j) * 2 + 1] = i / (RINGS - 1);
        if (i < RINGS - 1 && j < SEGS) {
          const a = i * (SEGS + 1) + j;
          const b = a + SEGS + 1;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.castShadow = true;
    this.group.add(this.mesh);

    // white cuff
    const cuff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.095, 0.09, 14),
      new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.95 })
    );
    cuff.position.y = -0.02;
    cuff.castShadow = true;
    this.group.add(cuff);
    // hanging loop
    const loop = new THREE.Mesh(
      new THREE.TorusGeometry(0.03, 0.008, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0xc8b088, roughness: 0.8 })
    );
    loop.position.y = 0.045;
    this.group.add(loop);

    this.rebuild();
  }

  // gift arrives: add a bulge whose height stacks above previous ones
  addGift(kind: GiftKind, order: number): void {
    const center = 0.9 - order * 0.21; // first gift settles at the toe
    let b: Bulge;
    if (kind === 'box') {
      b = { center, width: 0.1, rx: 0.055, rz: 0.045, squareness: 0.85, grow: 0 };
    } else if (kind === 'ball') {
      b = { center, width: 0.085, rx: 0.05, rz: 0.05, squareness: 0, grow: 0 };
    } else {
      b = { center: center - 0.02, width: 0.16, rx: 0.028, rz: 0.024, squareness: 0.2, grow: 0 };
    }
    this.bulges.push(b);
    this.wobbleAmt = 1;
  }

  // small version of the last gift peeking from the cuff
  showPeek(kind: GiftKind): void {
    if (this.peek) this.group.remove(this.peek);
    const p = new THREE.Group();
    if (kind === 'box') {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.07, 0.07),
        new THREE.MeshStandardMaterial({ color: 0x3a72b0, roughness: 0.6 })
      );
      m.rotation.set(0.4, 0.5, 0.2);
      p.add(m);
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(0.074, 0.018, 0.074),
        new THREE.MeshStandardMaterial({ color: 0xd8c25a, roughness: 0.5 })
      );
      rib.rotation.copy(m.rotation);
      p.add(rib);
    } else if (kind === 'ball') {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xc04848, roughness: 0.4 })
      );
      p.add(m);
    } else {
      // candy cane hook
      const hookMat = new THREE.MeshStandardMaterial({ color: 0xe8e2da, roughness: 0.5 });
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 8), hookMat);
      p.add(stick);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.014, 8, 12, Math.PI), hookMat);
      hook.position.y = 0.06;
      p.add(hook);
      const stripeMat = new THREE.MeshStandardMaterial({ color: 0xb02828, roughness: 0.5 });
      for (let i = 0; i < 3; i++) {
        const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.0148, 0.006, 6, 10), stripeMat);
        stripe.rotation.x = Math.PI / 2;
        stripe.position.y = -0.045 + i * 0.035;
        p.add(stripe);
      }
    }
    p.position.set(0, 0.05, 0.01);
    p.scale.setScalar(0.01);
    this.peek = p;
    this.group.add(p);
  }

  private ringDeform(t: number): { rx: number; rz: number; sq: number; drop: number } {
    let rx = 0, rz = 0, sq = 0, drop = 0;
    for (const b of this.bulges) {
      const d = (t - b.center) / b.width;
      const gauss = Math.exp(-d * d);
      rx += b.rx * gauss * b.grow;
      rz += b.rz * gauss * b.grow;
      sq = Math.max(sq, b.squareness * gauss * b.grow);
      drop += 0.012 * gauss * b.grow; // weight stretches the sock downward
    }
    return { rx, rz, sq, drop };
  }

  private rebuild(): void {
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const wob = Math.sin(this.time * 7) * 0.06 * this.wobbleAmt;
    let dropAcc = 0;
    for (let i = 0; i < RINGS; i++) {
      const t = i / (RINGS - 1);
      const base = this.baseRing[i];
      const d = this.ringDeform(t);
      dropAcc += d.drop / RINGS * 8;
      for (let j = 0; j <= SEGS; j++) {
        const a = (j / SEGS) * Math.PI * 2;
        let ca = Math.cos(a), sa = Math.sin(a);
        // squareness: push circle toward rounded square
        if (d.sq > 0) {
          const k = 1 + d.sq * 0.35 * (Math.abs(Math.cos(2 * a)));
          ca *= k; sa *= k;
        }
        const rx = base.r + d.rx;
        const rz = base.r + d.rz;
        const x = base.cx + ca * rx + wob * Math.sin(t * 6);
        const y = base.cy - dropAcc;
        const z = base.cz + sa * rz;
        pos.setXYZ(i * (SEGS + 1) + j, x, y, z);
      }
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  update(dt: number): void {
    this.time += dt;
    let dirty = this.wobbleAmt > 0.01;
    for (const b of this.bulges) {
      if (b.grow < 1) {
        b.grow = Math.min(1, b.grow + dt * 2.2);
        dirty = true;
      }
    }
    if (this.wobbleAmt > 0.01) this.wobbleAmt *= Math.exp(-dt * 2.4);
    if (dirty) this.rebuild();
    if (this.peek && this.peek.scale.x < 1) {
      const s = Math.min(1, this.peek.scale.x + dt * 2.5);
      this.peek.scale.setScalar(s);
    }
  }

  reset(): void {
    this.bulges.length = 0;
    this.wobbleAmt = 0;
    if (this.peek) {
      this.group.remove(this.peek);
      this.peek = null;
    }
    this.rebuild();
  }

  get filled(): number {
    return this.bulges.length;
  }
}
