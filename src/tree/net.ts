/**
 * The netting. A real diamond lattice of strands that grips the folded crown,
 * not a transparent bag: near the camera you can see the cells, the knots at
 * every crossing and the way the mesh stretches over each rank of branches.
 */
import * as THREE from 'three';
import { clamp, lerp, mulberry32 } from '../core/rand';
import type { QualityBudget } from '../core/quality';

interface NetOpts {
  rows: number;
  strands: number;
  knots: boolean;
}

function optsFor(b: QualityBudget): NetOpts {
  if (b.tier === 'high') return { rows: 46, strands: 22, knots: true };
  if (b.tier === 'mid') return { rows: 34, strands: 18, knots: true };
  return { rows: 30, strands: 16, knots: false };
}

export class NetSleeve {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private knots: THREE.InstancedMesh | null = null;
  private opts: NetOpts;
  private posAttr: THREE.BufferAttribute;
  private norAttr: THREE.BufferAttribute;
  private height: number;
  private rowY: Float32Array;
  private m = new THREE.Matrix4();
  private tmp = new THREE.Vector3();
  private jitter: Float32Array;
  /**
   * Radius per row, sampled the moment the sleeve closed over the whole tree.
   * Once the netting is on, it no longer follows the crown: branches that have
   * been let go are out from under it, and a live profile would make the slack
   * mesh balloon out with them.
   */
  private locked: Float32Array | null = null;
  private lockPending = false;

  /** how far up the trunk the net has been stripped, metres */
  front = 0;
  /** how far up the trunk the sleeve currently reaches (baling fills it in) */
  coverTop = 0;
  /** length of the loose tail hanging below the butt, metres */
  tail = 0.3;
  /** 0..1 fade used when the netting is finally pulled away */
  fade = 1;
  /**
   * Local y of the floor, when the tree is stood up somewhere. Slack netting
   * cannot sink through it: it drops to the floor and then runs out sideways.
   */
  floorY = -Infinity;
  private wobble = 0;

  constructor(height: number, budget: QualityBudget, material: THREE.Material, knotMaterial: THREE.Material) {
    this.height = height;
    this.opts = optsFor(budget);
    const { rows, strands } = this.opts;
    const verts = 2 * strands * (rows + 1) * 2;
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.norAttr = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.norAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('normal', this.norAttr);

    const colors = new Float32Array(verts * 3);
    const rng = mulberry32(9091);
    for (let d = 0; d < 2; d++) {
      for (let s = 0; s < strands; s++) {
        // a few strands of the bale are the pale marker cord
        const pale = rng() < 0.18;
        for (let r = 0; r <= rows; r++) {
          for (let k = 0; k < 2; k++) {
            const i = ((d * strands + s) * (rows + 1) + r) * 2 + k;
            const shade = 0.85 + rng() * 0.3;
            if (pale) {
              colors[i * 3] = 0.78 * shade;
              colors[i * 3 + 1] = 0.74 * shade;
              colors[i * 3 + 2] = 0.66 * shade;
            } else {
              colors[i * 3] = 0.92 * shade;
              colors[i * 3 + 1] = 0.38 * shade;
              colors[i * 3 + 2] = 0.11 * shade;
            }
          }
        }
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const idx: number[] = [];
    for (let d = 0; d < 2; d++) {
      for (let s = 0; s < strands; s++) {
        for (let r = 0; r < rows; r++) {
          const a = (((d * strands + s) * (rows + 1) + r) * 2) | 0;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
    }
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height * 0.5, 0), height);

    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.group.add(this.mesh);

    if (this.opts.knots) {
      const kg = new THREE.OctahedronGeometry(0.014, 0);
      this.knots = new THREE.InstancedMesh(kg, knotMaterial, strands * (rows + 1));
      this.knots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.knots.frustumCulled = false;
      this.group.add(this.knots);
    }

    this.rowY = new Float32Array(rows + 1);
    this.jitter = new Float32Array((rows + 1) * strands);
    const jr = mulberry32(313);
    for (let i = 0; i < this.jitter.length; i++) this.jitter[i] = jr() - 0.5;
  }

  /** Local-space point the finger grabs: the twisted tail below the butt. */
  tailPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, -this.tail * 0.85, 0);
  }

  setPullWobble(v: number): void {
    this.wobble = v;
  }

  /** Freeze the sleeve's shape: the tree is fully netted and leaves the line. */
  lock(): void {
    this.lockPending = true;
  }

  unlock(): void {
    this.locked = null;
    this.lockPending = false;
  }

  update(radiusAt: (y: number) => number, dt: number): void {
    const { rows, strands } = this.opts;
    const pos = this.posAttr.array as Float32Array;
    const nor = this.norAttr.array as Float32Array;
    const top = Math.min(this.height * 1.005, this.coverTop);
    const bottom = -this.tail;
    const front = clamp(this.front, 0, this.height);
    const hangLen = Math.min(0.75, 0.2 + front * 0.14) + this.tail;
    const twistPerRow = (Math.PI * 2) / strands;
    const width = 0.008;
    this.wobble *= Math.exp(-6 * dt);

    for (let r = 0; r <= rows; r++) this.rowY[r] = lerp(bottom, Math.max(bottom + 0.01, top), r / rows);

    if (this.lockPending) {
      this.lockPending = false;
      const held = new Float32Array(rows + 1);
      for (let r = 0; r <= rows; r++) held[r] = radiusAt(Math.max(0, this.rowY[r]));
      this.locked = held;
    }
    const heldRadius = (r: number, y: number): number =>
      this.locked ? Math.min(this.locked[r], radiusAt(Math.max(0, y))) : radiusAt(y);

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const t = new THREE.Vector3();
    const n = new THREE.Vector3();
    const side = new THREE.Vector3();

    const point = (r: number, s: number, d: number, out: THREE.Vector3): void => {
      const y = this.rowY[r];
      const theta = (s + (d === 0 ? r : -r)) * twistPerRow;
      let yy = y;
      let rad: number;
      if (y <= front && front > 0.001) {
        // stripped: the sleeve has slumped into a loose bunch under the butt
        const u = clamp((front - y) / Math.max(0.001, front - bottom), 0, 1);
        yy = front - 0.02 - u * hangLen;
        const crumple = this.jitter[r * strands + s] * 0.05;
        rad = 0.075 + Math.sin(u * 11 + r) * 0.022 + crumple;
      } else if (y < 0) {
        // the tail: the mesh gathered and twisted into a rope
        const u = clamp(-y / Math.max(0.001, this.tail), 0, 1);
        rad = lerp(heldRadius(0, 0) + 0.02, 0.048, u ** 0.28);
      } else {
        const stretch = 1 + this.wobble * 0.06 * Math.sin(y * 6.5);
        rad = (heldRadius(r, y) + 0.022) * stretch;
      }
      let px = Math.cos(theta) * rad;
      if (yy < this.floorY) {
        // slack netting cannot sink into the floor: it lies out toward the
        // viewer, which is also where the finger has to find the end
        px -= (this.floorY - yy) * 1.7;
        yy = this.floorY + Math.abs(this.jitter[r * strands + s]) * 0.02;
      }
      out.set(px, yy, Math.sin(theta) * rad);
    };

    for (let d = 0; d < 2; d++) {
      for (let s = 0; s < strands; s++) {
        for (let r = 0; r <= rows; r++) {
          point(r, s, d, a);
          point(Math.min(rows, r + 1), s, d, b);
          if (r === rows) {
            point(rows - 1, s, d, b);
            t.subVectors(a, b);
          } else {
            t.subVectors(b, a);
          }
          n.set(a.x, 0, a.z);
          if (n.lengthSq() < 1e-8) n.set(1, 0, 0);
          n.normalize();
          side.crossVectors(t, n).normalize().multiplyScalar(width);
          const i = ((d * strands + s) * (rows + 1) + r) * 2;
          pos[i * 3] = a.x + side.x;
          pos[i * 3 + 1] = a.y + side.y;
          pos[i * 3 + 2] = a.z + side.z;
          pos[i * 3 + 3] = a.x - side.x;
          pos[i * 3 + 4] = a.y - side.y;
          pos[i * 3 + 5] = a.z - side.z;
          nor[i * 3] = nor[i * 3 + 3] = n.x;
          nor[i * 3 + 1] = nor[i * 3 + 4] = n.y;
          nor[i * 3 + 2] = nor[i * 3 + 5] = n.z;
        }
      }
    }
    this.posAttr.needsUpdate = true;
    this.norAttr.needsUpdate = true;

    if (this.knots) {
      let i = 0;
      for (let s = 0; s < strands; s++) {
        for (let r = 0; r <= rows; r++) {
          point(r, s, 0, this.tmp);
          const scale = this.rowY[r] > 0 && this.rowY[r] > this.front ? 1 : 0.6;
          this.m.makeScale(scale, scale, scale);
          this.m.setPosition(this.tmp);
          this.knots.setMatrixAt(i++, this.m);
        }
      }
      this.knots.instanceMatrix.needsUpdate = true;
    }

    // when the last strand lets go the bundle is simply carried out of shot
    const f = clamp(this.fade, 0.001, 1);
    this.group.visible = this.fade > 0.02 && this.coverTop > 0.02;
    this.group.scale.setScalar(f);
    this.group.position.y = -(1 - f) * 0.9;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.knots?.geometry.dispose();
    this.knots?.dispose();
  }
}
