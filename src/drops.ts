import * as THREE from 'three';
import { applyUnderwaterFade } from './water';

export type DropKind = 'line' | 'fish' | 'free';

interface Drop {
  kind: DropKind;
  alive: boolean;
  /** metres measured up the rig from the sinker, so a bead rises as line comes in */
  fromSinker: number;
  host: number; // fish index for 'fish' drops
  local: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  shape: THREE.Vector3;
  age: number;
  life: number;
  detachAt: number;
  spin: number;
}

const GRAVITY = -9.81;

export class DropSystem {
  readonly mesh: THREE.InstancedMesh;
  private drops: Drop[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly capacity: number;

  constructor(capacity: number, env: THREE.Texture, transmission: boolean, deep: THREE.Color) {
    this.capacity = capacity;
    const geo = new THREE.SphereGeometry(1, 10, 8);
    const mat = transmission
      ? new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          metalness: 0,
          roughness: 0.03,
          transmission: 0.95,
          thickness: 0.0022,
          ior: 1.333,
          clearcoat: 1,
          clearcoatRoughness: 0.02,
          envMap: env,
          envMapIntensity: 1.1,
        })
      : new THREE.MeshPhysicalMaterial({
          color: 0xc9d6de,
          metalness: 0,
          roughness: 0.06,
          clearcoat: 1,
          clearcoatRoughness: 0.03,
          transparent: true,
          opacity: 0.52,
          envMap: env,
          envMapIntensity: 1.35,
          depthWrite: false,
        });
    applyUnderwaterFade(mat, deep, 4.5);
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.renderOrder = 6;
    for (let i = 0; i < capacity; i++) {
      this.drops.push({
        kind: 'free',
        alive: false,
        fromSinker: 0,
        host: -1,
        local: new THREE.Vector3(),
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        radius: 0.001,
        shape: new THREE.Vector3(1, 1, 1),
        age: 0,
        life: 1,
        detachAt: 1,
        spin: 0,
      });
    }
  }

  setCapacity(n: number): void {
    const c = Math.min(n, this.drops.length);
    for (let i = c; i < this.drops.length; i++) this.drops[i].alive = false;
    this.softCap = c;
  }
  private softCap = Number.MAX_SAFE_INTEGER;

  private take(): Drop | null {
    const limit = Math.min(this.capacity, this.softCap);
    for (let i = 0; i < limit; i++) if (!this.drops[i].alive) return this.drops[i];
    return null;
  }

  /** A bead clinging to the line, at a fixed material point of the rig. */
  spawnOnLine(fromSinker: number, radius: number, hangTime: number): void {
    const d = this.take();
    if (!d) return;
    d.kind = 'line';
    d.alive = true;
    d.fromSinker = fromSinker;
    d.radius = radius;
    // beads on a line are pulled long, never a row of identical spheres
    d.shape.set(0.68 + Math.random() * 0.34, 1.15 + Math.random() * 0.7, 0.68 + Math.random() * 0.34);
    d.age = 0;
    d.life = 40;
    d.detachAt = hangTime;
    d.vel.set(0, 0, 0);
    d.spin = Math.random() * 6.28;
  }

  spawnOnFish(host: number, local: THREE.Vector3, radius: number, hangTime: number): void {
    const d = this.take();
    if (!d) return;
    d.kind = 'fish';
    d.alive = true;
    d.host = host;
    d.local.copy(local);
    d.radius = radius;
    d.shape.set(0.85 + Math.random() * 0.4, 0.8 + Math.random() * 0.55, 0.85 + Math.random() * 0.4);
    d.age = 0;
    d.life = 40;
    d.detachAt = hangTime;
    d.vel.set(0, 0, 0);
    d.spin = Math.random() * 6.28;
  }

  update(
    dt: number,
    linePoint: (fromSinker: number) => THREE.Vector3 | null,
    fishMatrix: (host: number) => THREE.Matrix4 | null,
    onSplash: (x: number, z: number, strength: number) => void,
  ): void {
    const tmp = new THREE.Vector3();
    let n = 0;
    for (const d of this.drops) {
      if (!d.alive) continue;
      d.age += dt;
      if (d.kind === 'line') {
        const p = linePoint(d.fromSinker);
        if (!p) {
          d.alive = false;
          continue;
        }
        d.pos.copy(p);
        d.pos.y -= d.radius * 0.6;
        if (d.age > d.detachAt) {
          d.kind = 'free';
          d.vel.set(0, -0.05, 0);
        }
      } else if (d.kind === 'fish') {
        const m = fishMatrix(d.host);
        if (!m) {
          d.alive = false;
          continue;
        }
        d.pos.copy(tmp.copy(d.local).applyMatrix4(m));
        if (d.age > d.detachAt) {
          d.kind = 'free';
          d.vel.set(0, -0.05, 0);
        }
      } else {
        d.vel.y += GRAVITY * dt;
        d.pos.addScaledVector(d.vel, dt);
        // stretch along travel, so falling drops read as drops and not pellets
        const sp = Math.min(1, Math.abs(d.vel.y) / 3.2);
        d.shape.y = 1 + sp * 1.5;
        d.shape.x = 1 - sp * 0.28;
        d.shape.z = d.shape.x;
        if (d.pos.y <= 0.0) {
          onSplash(d.pos.x, d.pos.z, 0.35 + d.radius * 220);
          d.alive = false;
          continue;
        }
      }
      if (d.age > d.life) {
        d.alive = false;
        continue;
      }
      if (n < this.capacity) {
        this.dummy.position.copy(d.pos);
        this.dummy.rotation.set(0, d.spin, 0);
        this.dummy.scale.set(
          d.radius * d.shape.x,
          d.radius * d.shape.y,
          d.radius * d.shape.z,
        );
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(n, this.dummy.matrix);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (const d of this.drops) d.alive = false;
    this.mesh.count = 0;
  }
}
