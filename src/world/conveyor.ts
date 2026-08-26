import * as THREE from 'three';
import { M } from '../materials';

/**
 * Shared conveyor hardware builders. Belt tops sit exactly on the journey
 * path (path y == riding surface). The belt rubber texture is shared, so
 * scrolling its offset in main.ts makes every belt respond to the finger.
 */

const X = new THREE.Vector3(1, 0, 0);

function alignGroup(a: THREE.Vector3, b: THREE.Vector3): { g: THREE.Group; len: number } {
  const g = new THREE.Group();
  const dir = b.clone().sub(a);
  const len = dir.length();
  dir.normalize();
  g.position.copy(a).add(b).multiplyScalar(0.5);
  g.quaternion.setFromUnitVectors(X, dir);
  return { g, len };
}

function scaleTopUV(geo: THREE.BoxGeometry, factor: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * factor);
  uv.needsUpdate = true;
}

export interface BeltOpts {
  width?: number;
  guards?: boolean;
  guardH?: number;
  legsTo?: number | null; // floor y to drop legs to
  frame?: boolean;
}

/** A straight belt conveyor run from a to b (both are belt-TOP points). */
export function beltRun(a: THREE.Vector3, b: THREE.Vector3, opts: BeltOpts = {}): THREE.Group {
  const { width = 0.8, guards = true, guardH = 0.26, legsTo = null, frame = true } = opts;
  const root = new THREE.Group();
  const { g, len } = alignGroup(a, b);

  const beltGeo = new THREE.BoxGeometry(len + 0.02, 0.05, width);
  scaleTopUV(beltGeo, len / 1.4);
  const belt = new THREE.Mesh(beltGeo, M.beltRubber);
  belt.position.y = -0.025;
  belt.receiveShadow = true;
  g.add(belt);

  if (frame) {
    const fr = new THREE.Mesh(new THREE.BoxGeometry(len + 0.06, 0.12, width + 0.14), M.beltFrame);
    fr.position.y = -0.115;
    fr.receiveShadow = true;
    g.add(fr);
    // head/tail drum hints
    for (const e of [-1, 1]) {
      const drum = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, width + 0.02, 10),
        M.roller,
      );
      drum.rotation.x = Math.PI / 2;
      drum.position.set((len / 2) * e, -0.05, 0);
      g.add(drum);
    }
  }
  if (guards) {
    for (const sz of [-1, 1]) {
      const guard = new THREE.Mesh(new THREE.BoxGeometry(len + 0.06, guardH, 0.025), M.galvanized);
      guard.position.set(0, guardH / 2 - 0.02, (width / 2 + 0.07) * sz);
      guard.receiveShadow = true;
      g.add(guard);
      // top edge fold
      const fold = new THREE.Mesh(new THREE.BoxGeometry(len + 0.06, 0.025, 0.06), M.galvanized);
      fold.position.set(0, guardH - 0.02, (width / 2 + 0.07) * sz);
      g.add(fold);
    }
  }
  root.add(g);

  if (legsTo !== null) {
    const nLegs = Math.max(2, Math.round(len / 1.7) + 1);
    for (let i = 0; i < nLegs; i++) {
      const t = nLegs === 1 ? 0.5 : i / (nLegs - 1);
      const p = a.clone().lerp(b, THREE.MathUtils.clamp(t, 0.06, 0.94));
      const topY = p.y - 0.17;
      const h = topY - legsTo;
      if (h < 0.15) continue;
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, h, 0.07), M.steelDark);
        // legs are vertical in world space regardless of belt slope
        leg.position.set(p.x, legsTo + h / 2, p.z + (width / 2 - 0.05) * sz);
        root.add(leg);
      }
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, width - 0.04), M.steelDark);
      cross.position.set(p.x, legsTo + h * 0.35, p.z);
      root.add(cross);
    }
  }
  return root;
}

/** A gravity/powered roller deck (instanced rollers) from a to b. */
export function rollerDeck(
  a: THREE.Vector3,
  b: THREE.Vector3,
  width = 0.8,
  spacing = 0.13,
): { group: THREE.Group; heroRoller: THREE.Mesh } {
  const root = new THREE.Group();
  const { g, len } = alignGroup(a, b);
  const n = Math.max(2, Math.floor(len / spacing));
  const geo = new THREE.CylinderGeometry(0.042, 0.042, width, 10);
  const inst = new THREE.InstancedMesh(geo, M.roller, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const sc = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + spacing / 2 + i * spacing;
    m.compose(new THREE.Vector3(x, -0.045, 0), q, sc);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.receiveShadow = true;
  g.add(inst);
  // side rails
  for (const sz of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 0.03), M.beltFrame);
    rail.position.set(0, -0.03, (width / 2 + 0.035) * sz);
    g.add(rail);
  }
  // one "hero" roller that can visibly pre-spin (non-verbal lane hint)
  const hero = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, width, 12), M.roller);
  hero.rotation.x = Math.PI / 2;
  hero.position.set(-len / 2 + spacing / 2, -0.044, 0);
  // stripe so rotation is visible
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.012, width * 0.98),
    M.steelDark,
  );
  stripe.position.x = 0.04;
  hero.add(stripe);
  g.add(hero);
  root.add(g);
  return { group: root, heroRoller: hero };
}

/** Photo-eye sensor pair on a small bracket with a tiny red LED. */
export function photoEye(pos: THREE.Vector3, rotY = 0): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.04), M.steelDark);
  g.add(body);
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.011, 6, 6),
    new THREE.MeshStandardMaterial({
      color: 0x330000,
      emissive: 0xcc2211,
      emissiveIntensity: 1.6,
    }),
  );
  led.position.set(0, 0.02, 0.022);
  g.add(led);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.02), M.galvanized);
  bracket.position.y = -0.19;
  g.add(bracket);
  g.position.copy(pos);
  g.rotation.y = rotY;
  return g;
}

/** Ceiling-mounted fluorescent batten fixture (emissive tube). */
export function fluorescent(len = 1.3): THREE.Group {
  const g = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.14), M.steelDark);
  g.add(housing);
  const tube = new THREE.Mesh(
    new THREE.BoxGeometry(len * 0.92, 0.02, 0.05),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xf2f5e8,
      emissiveIntensity: 2.2,
    }),
  );
  tube.position.y = -0.03;
  g.add(tube);
  return g;
}

/** Generic other-bag geometry for instanced background luggage. */
export function otherBagGeometry(): THREE.BoxGeometry {
  return new THREE.BoxGeometry(0.62, 0.26, 0.4);
}
