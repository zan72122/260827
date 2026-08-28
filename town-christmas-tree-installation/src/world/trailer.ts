import * as THREE from 'three';
import { Materials } from './materials';
import { Inertial } from '../game/geom';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function box(mat: THREE.Material, sx: number, sy: number, sz: number, p: THREE.Vector3, parent: THREE.Object3D) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.copy(p);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function wheel(mat: THREE.Material, hub: THREE.Material, r: number, w: number, p: THREE.Vector3, parent: THREE.Object3D) {
  const g = new THREE.Group();
  g.position.copy(p);
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 16), mat);
  t.rotation.x = Math.PI / 2;
  t.castShadow = true;
  g.add(t);
  const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.42, r * 0.42, w + 0.02, 10), hub);
  h.rotation.x = Math.PI / 2;
  g.add(h);
  parent.add(g);
  return g;
}

/**
 * Tractor unit plus low-bed semi-trailer with timber bolsters. It drives the
 * tree onto the square, then pulls clear once the load is airborne.
 */
export class TreeTransport {
  readonly root = new THREE.Group();
  readonly deckTop = 1.16;
  readonly bunkPositions: number[] = [-4.2, 1.4, 6.0];
  private wheels: THREE.Group[] = [];
  private travel = new Inertial(0.58, 0.55, 3.4);
  private path: THREE.Vector3[];
  private stopIndex: number;

  constructor(m: Materials, path: THREE.Vector3[], stopAt: number) {
    this.path = path;
    this.stopIndex = stopAt;

    // ---- tractor ---------------------------------------------------------
    const tractor = new THREE.Group();
    tractor.position.set(9.6, 0, 0);
    this.root.add(tractor);
    box(m.craneAccent, 6.2, 0.38, 2.3, V(0, 0.95, 0), tractor);
    const cab = box(m.craneBody, 2.9, 2.35, 2.44, V(1.5, 2.32, 0), tractor);
    cab.castShadow = true;
    box(m.windowGlass, 0.12, 1.05, 2.16, V(2.98, 2.85, 0), tractor);
    for (const s of [-1, 1]) box(m.windowGlass, 1.9, 0.9, 0.1, V(1.2, 2.8, s * 1.24), tractor);
    box(m.craneAccent, 3.0, 0.2, 2.5, V(1.5, 3.52, 0), tractor);
    // Chrome stacks and mirrors — a working lorry, not a toy.
    for (const s of [-1, 1]) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.7, 10), m.chrome);
      stack.position.set(0.1, 2.6, s * 1.28);
      stack.castShadow = true;
      tractor.add(stack);
      box(m.craneAccent, 0.1, 0.62, 0.22, V(2.9, 3.05, s * 1.4), tractor);
    }
    box(m.chrome, 0.35, 0.7, 2.5, V(3.15, 1.15, 0), tractor);
    for (const s of [-1, 1]) box(m.paintYellow, 0.16, 0.24, 0.34, V(3.2, 1.5, s * 0.9), tractor);
    // Fifth wheel.
    const fifth = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 14), m.steelDark);
    fifth.position.set(-1.7, 1.22, 0);
    tractor.add(fifth);
    for (const x of [1.9, -1.3, -2.5]) {
      for (const s of [-1, 1]) this.wheels.push(wheel(m.rubber, m.steel, 0.62, 0.4, V(x, 0.62, s * 1.15), tractor));
    }

    // ---- low-bed trailer -------------------------------------------------
    const trailer = new THREE.Group();
    this.root.add(trailer);
    // Gooseneck up to the tractor, then the low deck.
    box(m.craneAccent, 3.2, 0.5, 2.2, V(7.6, 1.32, 0), trailer);
    box(m.craneAccent, 1.4, 0.9, 2.2, V(6.0, 1.0, 0), trailer);
    for (const s of [-1, 1]) {
      box(m.craneAccent, 15.4, 0.42, 0.28, V(-1.0, 0.92, s * 1.08), trailer);
    }
    const deck = box(m.timber, 15.4, 0.16, 2.5, V(-1.0, this.deckTop, 0), trailer);
    deck.receiveShadow = true;
    // Rear axles and mudguards.
    for (const x of [-6.6, -7.9, -9.2]) {
      for (const s of [-1, 1]) this.wheels.push(wheel(m.rubber, m.steel, 0.56, 0.36, V(x, 0.56, s * 1.14), trailer));
      box(m.craneAccent, 1.3, 0.1, 2.6, V(x, 1.24, 0), trailer);
    }
    box(m.paintYellow, 0.3, 0.5, 2.5, V(-9.9, 1.0, 0), trailer);
    for (const s of [-1, 1]) box(m.steelDark, 0.16, 0.9, 0.16, V(-4.6, 0.55, s * 1.3), trailer);

    // Timber bolsters with steel stakes that actually cradle the trunk.
    for (const bx of this.bunkPositions) {
      box(m.timber, 0.6, 0.34, 2.4, V(bx, this.deckTop + 0.17, 0), trailer);
      for (const s of [-1, 1]) {
        box(m.steelDark, 0.14, 1.5, 0.14, V(bx, this.deckTop + 0.9, s * 1.16), trailer);
      }
      const chain = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 6, 14, Math.PI), m.steelDark);
      chain.rotation.set(0, Math.PI / 2, Math.PI);
      chain.position.set(bx, this.deckTop + 0.4, 0);
      trailer.add(chain);
    }
    box(m.paintYellow, 0.5, 0.36, 0.05, V(-10.1, 1.5, 0), trailer);
  }

  /** 0 = off-square, 1 = parked in the working position. */
  drive(target: number, dt: number): { moving: boolean; speed: number } {
    const before = this.travel.value;
    this.travel.step(THREE.MathUtils.clamp(target, 0, 1), dt);
    const t = this.travel.value;
    const f = THREE.MathUtils.clamp(t, 0, 1) * this.stopIndex;
    const i = THREE.MathUtils.clamp(Math.floor(f), 0, this.path.length - 2);
    const p = this.path[i].clone().lerp(this.path[i + 1], f - i);
    const dir = this.path[i + 1].clone().sub(this.path[i]).normalize();
    this.root.position.copy(p);
    this.root.rotation.y = Math.atan2(-dir.z, dir.x);

    const speed = Math.abs(this.travel.velocity);
    const roll = (t - before) * this.stopIndex * 3.2;
    for (const w of this.wheels) w.rotation.z -= roll;
    return { moving: speed > 0.002, speed };
  }

  get progress(): number {
    return this.travel.value;
  }

  /** World position of the trunk's resting axis on the bolsters. */
  deckAxisWorld(offsetAlong: number, out = new THREE.Vector3()): THREE.Vector3 {
    this.root.updateWorldMatrix(true, false);
    return out.set(offsetAlong, this.deckTop + 0.34, 0).applyMatrix4(this.root.matrixWorld);
  }
}
