import * as THREE from 'three';
import { clamp, randRange } from './math';
import type { WallKind } from './audio';

/**
 * Pooled debris rigid bodies with a deliberately narrow simulation:
 * gravity, tumbling, ground/pile contact and sleep. Pieces at rest deposit
 * their volume into a coarse heightfield so later pieces stack into a pile
 * instead of sinking into the ground. Sleeping pieces cost no simulation
 * time and stay visible until the wall is reset.
 */

export type DebrisShape = 'box' | 'plate' | 'chunk';

interface DebrisBody {
  active: boolean;
  asleep: boolean;
  shape: DebrisShape;
  kind: WallKind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  angVel: THREE.Vector3;
  size: THREE.Vector3; // full extents
  color: THREE.Color;
  born: number;
  bounces: number;
  deposited: boolean;
}

const GRAVITY = 9.81;
const SLEEP_SPEED = 0.24;
const SLEEP_SPIN = 0.9;

const HF_MIN_X = -6.5;
const HF_MAX_X = 6.5;
const HF_MIN_Z = -4.5;
const HF_MAX_Z = 2.5;
const HF_CELL = 0.42;
const HF_NX = Math.ceil((HF_MAX_X - HF_MIN_X) / HF_CELL);
const HF_NZ = Math.ceil((HF_MAX_Z - HF_MIN_Z) / HF_CELL);

export class DebrisSystem {
  private bodies: DebrisBody[] = [];
  private meshes: Record<DebrisShape, THREE.InstancedMesh>;
  private slots: Record<DebrisShape, (DebrisBody | null)[]>;
  private heightfield = new Float32Array(HF_NX * HF_NZ);
  private dummy = new THREE.Object3D();
  private time = 0;
  onLand: ((kind: WallKind, size01: number, pos: THREE.Vector3) => void) | null = null;

  constructor(
    parent: THREE.Object3D,
    capacityPerShape: number,
    materials: { side: THREE.Material }
  ) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    // plate: thin slab with slightly beveled look via scaled box
    const plate = new THREE.BoxGeometry(1, 1, 1);
    // chunk: irregular low-poly lump
    const chunkGeo = new THREE.IcosahedronGeometry(0.62, 0);
    const posAttr = chunkGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      const f = 0.75 + Math.random() * 0.55;
      posAttr.setXYZ(i, posAttr.getX(i) * f, posAttr.getY(i) * f * 0.85, posAttr.getZ(i) * f);
    }
    chunkGeo.computeVertexNormals();

    this.meshes = {
      box: new THREE.InstancedMesh(box, materials.side, capacityPerShape),
      plate: new THREE.InstancedMesh(plate, materials.side, capacityPerShape),
      chunk: new THREE.InstancedMesh(chunkGeo, materials.side, capacityPerShape),
    };
    this.slots = { box: [], plate: [], chunk: [] };
    for (const shape of ['box', 'plate', 'chunk'] as DebrisShape[]) {
      const m = this.meshes[shape];
      m.castShadow = false;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.dummy.position.set(0, -100, 0);
      this.dummy.scale.setScalar(0.0001);
      this.dummy.updateMatrix();
      for (let i = 0; i < capacityPerShape; i++) {
        m.setMatrixAt(i, this.dummy.matrix);
        m.setColorAt(i, new THREE.Color(1, 1, 1));
        this.slots[shape].push(null);
      }
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      parent.add(m);
    }
  }

  groundHeightAt(x: number, z: number): number {
    if (x < HF_MIN_X || x >= HF_MAX_X || z < HF_MIN_Z || z >= HF_MAX_Z) return 0;
    const ix = Math.floor((x - HF_MIN_X) / HF_CELL);
    const iz = Math.floor((z - HF_MIN_Z) / HF_CELL);
    return this.heightfield[iz * HF_NX + ix];
  }

  private deposit(b: DebrisBody): void {
    if (b.deposited) return;
    b.deposited = true;
    const x = b.pos.x;
    const z = b.pos.z;
    if (x < HF_MIN_X || x >= HF_MAX_X || z < HF_MIN_Z || z >= HF_MAX_Z) return;
    const ix = Math.floor((x - HF_MIN_X) / HF_CELL);
    const iz = Math.floor((z - HF_MIN_Z) / HF_CELL);
    const vol = b.size.x * b.size.y * b.size.z;
    const add = clamp((vol / (HF_CELL * HF_CELL)) * 0.55, 0.01, 0.3);
    const i = iz * HF_NX + ix;
    this.heightfield[i] = Math.min(this.heightfield[i] + add, 1.6);
  }

  spawn(
    kind: WallKind,
    shape: DebrisShape,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    size: THREE.Vector3,
    color: THREE.Color
  ): void {
    const slotArr = this.slots[shape];
    let idx = slotArr.indexOf(null);
    if (idx === -1) {
      // pool full: retire the oldest sleeping piece (its volume is already in the pile)
      let oldest = -1;
      let oldestT = Infinity;
      for (let i = 0; i < slotArr.length; i++) {
        const s = slotArr[i];
        if (s && s.asleep && s.born < oldestT) {
          oldestT = s.born;
          oldest = i;
        }
      }
      if (oldest === -1) return; // everything airborne — drop this spawn
      const victim = slotArr[oldest]!;
      this.deposit(victim);
      victim.active = false;
      slotArr[oldest] = null;
      idx = oldest;
    }
    const b: DebrisBody = {
      active: true,
      asleep: false,
      shape,
      kind,
      pos: pos.clone(),
      vel: vel.clone(),
      quat: new THREE.Quaternion().setFromEuler(
        new THREE.Euler(randRange(0, Math.PI), randRange(0, Math.PI), randRange(0, Math.PI))
      ),
      angVel: new THREE.Vector3(randRange(-5, 5), randRange(-4, 4), randRange(-5, 5)),
      size: size.clone(),
      color: color.clone(),
      born: this.time,
      bounces: 0,
      deposited: false,
    };
    this.bodies.push(b);
    slotArr[idx] = b;
    this.writeInstance(shape, idx, b);
  }

  private writeInstance(shape: DebrisShape, idx: number, b: DebrisBody): void {
    const m = this.meshes[shape];
    this.dummy.position.copy(b.pos);
    this.dummy.quaternion.copy(b.quat);
    this.dummy.scale.copy(b.size);
    this.dummy.updateMatrix();
    m.setMatrixAt(idx, this.dummy.matrix);
    m.setColorAt(idx, b.color);
  }

  clear(): void {
    this.heightfield.fill(0);
    this.bodies.length = 0;
    for (const shape of ['box', 'plate', 'chunk'] as DebrisShape[]) {
      const arr = this.slots[shape];
      const m = this.meshes[shape];
      this.dummy.position.set(0, -100, 0);
      this.dummy.scale.setScalar(0.0001);
      this.dummy.updateMatrix();
      for (let i = 0; i < arr.length; i++) {
        arr[i] = null;
        m.setMatrixAt(i, this.dummy.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    }
  }

  activeCount(): number {
    let n = 0;
    for (const b of this.bodies) if (b.active && !b.asleep) n++;
    return n;
  }

  step(dt: number): void {
    this.time += dt;
    const _spin = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    for (const shape of ['box', 'plate', 'chunk'] as DebrisShape[]) {
      const arr = this.slots[shape];
      const m = this.meshes[shape];
      let dirty = false;
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
        if (!b || !b.active || b.asleep) continue;
        b.vel.y -= GRAVITY * dt;
        b.pos.addScaledVector(b.vel, dt);
        // tumble
        _spin.copy(b.angVel).multiplyScalar(dt * 0.5);
        _q.set(_spin.x, _spin.y, _spin.z, 0).multiply(b.quat);
        b.quat.x += _q.x;
        b.quat.y += _q.y;
        b.quat.z += _q.z;
        b.quat.w += _q.w;
        b.quat.normalize();

        const restH = Math.min(b.size.x, b.size.y, b.size.z) * 0.5 + this.groundHeightAt(b.pos.x, b.pos.z);
        if (b.pos.y < restH) {
          b.pos.y = restH;
          if (b.vel.y < 0) {
            const impactSpeed = -b.vel.y;
            b.vel.y = impactSpeed * 0.26;
            b.vel.x *= 0.62;
            b.vel.z *= 0.62;
            b.angVel.multiplyScalar(0.55);
            b.bounces++;
            if (impactSpeed > 1.2 && this.onLand) {
              const size01 = clamp((b.size.x + b.size.y + b.size.z) / 1.6, 0, 1);
              this.onLand(b.kind, size01, b.pos);
            }
          }
          if (
            (b.vel.lengthSq() < SLEEP_SPEED * SLEEP_SPEED && b.angVel.lengthSq() < SLEEP_SPIN * SLEEP_SPIN) ||
            b.bounces > 7
          ) {
            b.asleep = true;
            b.vel.set(0, 0, 0);
            b.angVel.set(0, 0, 0);
            this.deposit(b);
          }
        }
        this.writeInstance(shape, i, b);
        dirty = true;
      }
      if (dirty) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }
}
