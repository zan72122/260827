// Broken ice plates. A pool of InstancedMeshes (a few asymmetric plate
// shapes + one small shard shape). Plates near the bow get a short physical
// life — tipped, pushed aside, bobbing — then freeze in place along the lane.
// Far/old pieces cost nothing: their matrices simply stop updating.

import * as THREE from 'three';
import { WATER_Y, mulberry32 } from './const';

const PLATE_VARIANTS = 4;
const PER_VARIANT = 260;
const SHARD_COUNT = 700;
const ACTIVE_LIFE = 3.2;

interface FloeState {
  variant: number;
  index: number;
  active: boolean;
  used: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; yawVel: number;
  tilt: number; tiltAxis: number; // tilt around horizontal axis (radians)
  bobPhase: number;
  age: number;
  scale: number;
}

function makePlateGeometry(rng: () => number, radius: number, thickness: number): THREE.BufferGeometry {
  // irregular convex-ish polygon, extruded — every variant is asymmetric
  const n = 5 + Math.floor(rng() * 4);
  const shape = new THREE.Shape();
  const angles: number[] = [];
  let a = rng() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    a += (Math.PI * 2 / n) * (0.55 + rng() * 0.9);
    angles.push(a);
  }
  angles.sort((p, q) => p - q);
  for (let i = 0; i < n; i++) {
    const r = radius * (0.55 + rng() * 0.75);
    const x = Math.cos(angles[i]) * r;
    const y = Math.sin(angles[i]) * r * (0.7 + rng() * 0.5);
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // lie flat, top at y=thickness
  geo.translate(0, -thickness * 0.45, 0); // mostly submerged like real ice
  geo.computeVertexNormals();

  // vertex colours: snowy top, pale-blue sides, dark wet bottom
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const ny = nrm.getY(i);
    let r: number, g: number, b: number;
    if (ny > 0.5) { r = 0.90; g = 0.93; b = 0.95; }
    else if (ny < -0.5) { r = 0.16; g = 0.24; b = 0.30; }
    else { r = 0.62; g = 0.74; b = 0.82; }
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export class Floes {
  private meshes: THREE.InstancedMesh[] = [];
  private states: FloeState[][] = [];
  private cursor: number[] = [];
  private shardMesh!: THREE.InstancedMesh;
  private shardCursor = 0;
  private rng = mulberry32(99);
  private dummy = new THREE.Object3D();
  private activeList: FloeState[] = [];

  constructor(scene: THREE.Scene, seed: number) {
    const grng = mulberry32(seed * 31 + 7);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (let v = 0; v < PLATE_VARIANTS; v++) {
      const geo = makePlateGeometry(grng, 1.6 + grng() * 1.6, 0.5 + grng() * 0.2);
      const mesh = new THREE.InstancedMesh(geo, mat, PER_VARIANT);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes.push(mesh);
      this.cursor.push(0);
      const arr: FloeState[] = [];
      for (let i = 0; i < PER_VARIANT; i++) {
        arr.push({
          variant: v, index: i, active: false, used: false,
          x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
          yaw: 0, yawVel: 0, tilt: 0, tiltAxis: 0,
          bobPhase: 0, age: 0, scale: 1,
        });
      }
      this.states.push(arr);
    }
    // small shards sprinkled into the lane behind the ship (static)
    const shardGeo = makePlateGeometry(mulberry32(seed * 13 + 3), 0.55, 0.3);
    this.shardMesh = new THREE.InstancedMesh(shardGeo, mat, SHARD_COUNT);
    this.shardMesh.count = 0;
    this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh.frustumCulled = false;
    scene.add(this.shardMesh);
  }

  /** Plates tipped and shoved aside at the bow. side: -1 port, +1 starboard */
  spawnAtBow(x: number, z: number, heading: number, side: number): void {
    const rng = this.rng;
    const v = Math.floor(rng() * PLATE_VARIANTS);
    const idx = this.cursor[v] % PER_VARIANT;
    this.cursor[v]++;
    const st = this.states[v][idx];
    if (st.active) {
      const li = this.activeList.indexOf(st);
      if (li >= 0) this.activeList.splice(li, 1);
    }
    const fwdX = Math.sin(heading), fwdZ = Math.cos(heading);
    const sideX = fwdZ * side, sideZ = -fwdX * side;
    const lat = 2.0 + rng() * 2.6;
    st.x = x + sideX * lat + fwdX * (rng() - 0.3) * 4;
    st.z = z + sideZ * lat + fwdZ * (rng() - 0.3) * 4;
    st.y = WATER_Y + 0.15 + rng() * 0.25;
    const shove = 1.5 + rng() * 1.7;
    st.vx = sideX * shove + fwdX * (0.8 + rng());
    st.vz = sideZ * shove + fwdZ * (0.8 + rng());
    st.vy = 0.4 + rng() * 0.5;
    st.yaw = rng() * Math.PI * 2;
    st.yawVel = (rng() - 0.5) * 2.4;
    st.tilt = (0.25 + rng() * 0.45) * (rng() < 0.5 ? 1 : -1);
    st.tiltAxis = heading + (rng() - 0.5) * 0.8;
    st.bobPhase = rng() * Math.PI * 2;
    st.age = 0;
    st.scale = 0.75 + rng() * 0.65;
    st.active = true;
    st.used = true;
    this.activeList.push(st);
    this.meshes[v].count = Math.max(this.meshes[v].count, idx + 1);
    this.writeMatrix(st);
  }

  /** Static small brash bits left floating in the lane behind the stern. */
  scatterBrash(x: number, z: number, halfWidth: number): void {
    const rng = this.rng;
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const idx = this.shardCursor % SHARD_COUNT;
      this.shardCursor++;
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * halfWidth * 0.9;
      this.dummy.position.set(x + Math.cos(a) * r, WATER_Y + 0.02 + rng() * 0.05, z + Math.sin(a) * r);
      this.dummy.rotation.set((rng() - 0.5) * 0.25, rng() * Math.PI * 2, (rng() - 0.5) * 0.25);
      const s = 0.5 + rng() * 1.1;
      this.dummy.scale.set(s, 0.7 + rng() * 0.5, s);
      this.dummy.updateMatrix();
      this.shardMesh.setMatrixAt(idx, this.dummy.matrix);
      this.shardMesh.count = Math.max(this.shardMesh.count, idx + 1);
    }
    this.shardMesh.instanceMatrix.needsUpdate = true;
  }

  private writeMatrix(st: FloeState): void {
    const d = this.dummy;
    d.position.set(st.x, st.y, st.z);
    d.rotation.set(0, 0, 0);
    d.rotateY(st.yaw);
    // tilt around a horizontal axis given by tiltAxis
    const axis = new THREE.Vector3(Math.sin(st.tiltAxis), 0, Math.cos(st.tiltAxis));
    d.rotateOnWorldAxis(axis, st.tilt);
    d.scale.setScalar(st.scale);
    d.updateMatrix();
    this.meshes[st.variant].setMatrixAt(st.index, d.matrix);
  }

  update(dt: number, time: number): void {
    if (this.activeList.length === 0) return;
    const drag = Math.exp(-1.7 * dt);
    for (let i = this.activeList.length - 1; i >= 0; i--) {
      const st = this.activeList[i];
      st.age += dt;
      st.x += st.vx * dt; st.z += st.vz * dt;
      st.y += st.vy * dt;
      st.vx *= drag; st.vz *= drag;
      // buoyancy: settle toward floating level
      const floatY = WATER_Y + 0.05;
      st.vy += (floatY - st.y) * 6.0 * dt;
      st.vy *= Math.exp(-2.4 * dt);
      st.yaw += st.yawVel * dt;
      st.yawVel *= drag;
      // tilt relaxes to a small resting list; bob decays
      const rest = st.tilt > 0 ? 0.05 : -0.05;
      st.tilt += (rest - st.tilt) * 2.0 * dt;
      st.y += Math.sin(time * 2.1 + st.bobPhase) * 0.02 * Math.max(0, 1 - st.age / ACTIVE_LIFE) * dt * 6;
      this.writeMatrix(st);
      if (st.age > ACTIVE_LIFE) {
        st.active = false;
        this.activeList.splice(i, 1);
      }
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }

  reset(seed: number): void {
    this.rng = mulberry32(seed * 17 + 1);
    this.activeList.length = 0;
    for (let v = 0; v < PLATE_VARIANTS; v++) {
      this.cursor[v] = 0;
      this.meshes[v].count = 0;
      for (const st of this.states[v]) { st.active = false; st.used = false; }
      this.meshes[v].instanceMatrix.needsUpdate = true;
    }
    this.shardCursor = 0;
    this.shardMesh.count = 0;
    this.shardMesh.instanceMatrix.needsUpdate = true;
  }
}
