import * as THREE from 'three';
import type { MaterialLibrary } from './materials';

export interface BeltOptions {
  length: number;
  width: number;
  height: number;
  guards?: boolean;
}

/** A rubber belt on rollers, with a frame, side guards and paper lint on the surface. */
export class Belt {
  readonly group = new THREE.Group();
  private surface: THREE.Mesh;
  private rollers: THREE.Mesh[] = [];
  private speed = 0;

  constructor(mats: MaterialLibrary, opts: BeltOptions) {
    const { length, width, height } = opts;

    this.surface = new THREE.Mesh(new THREE.BoxGeometry(length, 0.018, width), mats.belt.clone());
    const m = this.surface.material as THREE.MeshStandardMaterial;
    if (m.map) {
      m.map = m.map.clone();
      m.map.needsUpdate = true;
      m.map.repeat.set(Math.max(2, length * 3), 1);
    }
    this.surface.position.y = height;
    this.surface.receiveShadow = true;
    this.group.add(this.surface);

    const rollerGeo = new THREE.CylinderGeometry(0.032, 0.032, width + 0.02, 14);
    const count = Math.max(2, Math.round(length / 0.35));
    for (let i = 0; i < count; i++) {
      const r = new THREE.Mesh(rollerGeo, mats.steelRaw);
      r.rotation.x = Math.PI / 2;
      r.position.set(-length / 2 + (i / (count - 1)) * length, height - 0.02, 0);
      this.rollers.push(r);
      this.group.add(r);
    }

    for (const z of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.05, 0.022), mats.steelPainted);
      rail.position.set(0, height - 0.035, z * (width / 2 + 0.014));
      this.group.add(rail);
      if (opts.guards !== false) {
        const guard = new THREE.Mesh(new THREE.BoxGeometry(length, 0.05, 0.008), mats.steelPainted);
        guard.position.set(0, height + 0.032, z * (width / 2 + 0.012));
        this.group.add(guard);
      }
    }

    const legCount = Math.max(2, Math.round(length / 0.9));
    for (let i = 0; i < legCount; i++) {
      const x = -length / 2 + 0.1 + (i / Math.max(1, legCount - 1)) * (length - 0.2);
      for (const z of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, height - 0.05, 0.03), mats.steelPainted);
        leg.position.set(x, (height - 0.05) / 2, z * (width / 2 - 0.01));
        this.group.add(leg);
      }
    }
  }

  setSpeed(v: number): void {
    this.speed = v;
  }

  update(dt: number): void {
    if (this.speed === 0) return;
    const m = this.surface.material as THREE.MeshStandardMaterial;
    if (m.map) m.map.offset.x = (m.map.offset.x - this.speed * dt * 0.6) % 1;
    for (const r of this.rollers) r.rotation.y += this.speed * dt * 6;
  }
}

/**
 * Named deterministic routes. Nothing on this floor teleports: every letter and
 * every bag rides a path that exists in the room.
 */
export class ConveyorController {
  readonly group = new THREE.Group();
  private belts = new Map<string, Belt>();
  private paths = new Map<string, THREE.CatmullRomCurve3>();

  addBelt(name: string, belt: Belt, position: THREE.Vector3, rotationY = 0): Belt {
    belt.group.position.copy(position);
    belt.group.rotation.y = rotationY;
    this.belts.set(name, belt);
    this.group.add(belt.group);
    return belt;
  }

  belt(name: string): Belt | undefined {
    return this.belts.get(name);
  }

  addPath(name: string, points: THREE.Vector3[], tension = 0.3): THREE.CatmullRomCurve3 {
    const c = new THREE.CatmullRomCurve3(points, false, 'catmullrom', tension);
    this.paths.set(name, c);
    return c;
  }

  point(name: string, t: number, target: THREE.Vector3): THREE.Vector3 {
    const c = this.paths.get(name);
    if (!c) throw new Error(`unknown conveyor path: ${name}`);
    return c.getPoint(THREE.MathUtils.clamp(t, 0, 1), target);
  }

  tangent(name: string, t: number, target: THREE.Vector3): THREE.Vector3 {
    const c = this.paths.get(name);
    if (!c) throw new Error(`unknown conveyor path: ${name}`);
    return c.getTangent(THREE.MathUtils.clamp(t, 0, 1), target);
  }

  setSpeed(name: string, v: number): void {
    this.belts.get(name)?.setSpeed(v);
  }

  setAllSpeed(v: number): void {
    for (const b of this.belts.values()) b.setSpeed(v);
  }

  update(dt: number): void {
    for (const b of this.belts.values()) b.update(dt);
  }
}
