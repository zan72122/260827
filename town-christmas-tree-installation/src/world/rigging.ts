import * as THREE from 'three';
import { Materials } from './materials';
import { Cable, catenaryPoints, ribbonGeometry } from '../game/geom';
import type { ConiferTree } from './tree';

/** A rebuildable flat webbing strap. */
class Strap {
  readonly mesh: THREE.Mesh;
  constructor(
    material: THREE.Material,
    private width: number,
    private thickness: number,
  ) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }
  update(points: THREE.Vector3[], up?: THREE.Vector3): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = ribbonGeometry(points, this.width, this.thickness, up);
  }
  dispose(): void {
    this.mesh.geometry.dispose();
  }
}

function shackleMesh(m: Materials, size: number): THREE.Group {
  const g = new THREE.Group();
  const bow = new THREE.Mesh(new THREE.TorusGeometry(size, size * 0.19, 8, 20, Math.PI * 1.25), m.steel);
  bow.rotation.set(Math.PI / 2, 0, Math.PI * 0.375);
  bow.castShadow = true;
  g.add(bow);
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.2, size * 0.2, size * 2.1, 12), m.steelDark);
  pin.rotation.z = Math.PI / 2;
  pin.position.y = size * 0.72;
  pin.castShadow = true;
  g.add(pin);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.32, size * 0.32, size * 0.28, 10), m.steelDark);
  head.rotation.z = Math.PI / 2;
  head.position.set(size * 1.05, size * 0.72, 0);
  g.add(head);
  return g;
}

interface SlingParts {
  wrap: Strap;
  legL: Strap;
  legR: Strap;
  shackle: THREE.Group;
  group: THREE.Group;
  height: number;
  placed: number;
  colorIndex: number;
}

/**
 * Two wide webbing slings choked around the trunk, their legs meeting at a
 * bow shackle on the hook, plus the ground crew's tag line.
 */
export class Rigging {
  readonly slings: SlingParts[] = [];
  readonly tagLine: Cable;
  private tree: ConiferTree;
  private scene: THREE.Object3D;
  private tension = 0;
  private tagWorldAnchor = new THREE.Vector3();
  private tagPull = 0;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  constructor(m: Materials, tree: ConiferTree, scene: THREE.Object3D) {
    this.tree = tree;
    this.scene = scene;
    const heights = tree.slingHeights;
    heights.forEach((h, i) => {
      const group = new THREE.Group();
      scene.add(group);
      const mat = i === 0 ? m.slingRed : m.slingBlue;
      const parts: SlingParts = {
        wrap: new Strap(mat, 0.3, 0.024),
        legL: new Strap(mat, 0.3, 0.024),
        legR: new Strap(mat, 0.3, 0.024),
        shackle: shackleMesh(m, 0.19),
        group,
        height: h,
        placed: 0,
        colorIndex: i,
      };
      group.add(parts.wrap.mesh, parts.legL.mesh, parts.legR.mesh, parts.shackle);
      this.slings.push(parts);
    });

    this.tagLine = new Cable(m.cord, 0.028, 6);
    this.tagLine.mesh.visible = false;
    scene.add(this.tagLine.mesh);
  }

  setPlaced(index: number, t: number): void {
    this.slings[index].placed = THREE.MathUtils.clamp(t, 0, 1);
  }

  setTension(t: number): void {
    this.tension = THREE.MathUtils.clamp(t, 0, 1);
  }

  setTagAnchor(p: THREE.Vector3): void {
    this.tagWorldAnchor.copy(p);
  }

  setTagPull(v: number): void {
    this.tagPull = THREE.MathUtils.clamp(v, -1, 1);
  }

  showTagLine(v: boolean): void {
    this.tagLine.mesh.visible = v;
  }

  /** The crew de-rigs once the tree stands on its own guys. */
  stow(): void {
    for (const s of this.slings) s.group.visible = false;
    this.tagLine.mesh.visible = false;
  }

  /** World position where the sling legs meet — the load side of the hook. */
  private shacklePoint(hook: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(hook).add(new THREE.Vector3(0, -0.28, 0));
  }

  update(hook: THREE.Vector3): void {
    const root = this.tree.root;
    root.updateWorldMatrix(true, false);
    const invQ = root.quaternion.clone().invert();
    // Local direction that currently points at the ground: the staging offset
    // slides the sling up off the setts and onto the trunk.
    const downLocal = new THREE.Vector3(0, -1, 0).applyQuaternion(invQ);
    const sideLocal = new THREE.Vector3(0, 0, 1).applyQuaternion(invQ);

    const shackleWorld = this.shacklePoint(hook, this.tmpA);

    for (const s of this.slings) {
      const stage = 1 - s.placed;
      const c = this.tree.trunkPointLocal(s.height);
      const r = this.tree.trunkRadiusAt(s.height) + 0.035 - this.tension * 0.012;
      const offset = downLocal.clone().multiplyScalar(stage * 1.15).addScaledVector(sideLocal, stage * 1.35);

      // Choked wrap: an open loop hugging the trunk, ends rising to the legs.
      const wrapPts: THREE.Vector3[] = [];
      const span = Math.PI * 1.86;
      const n = 22;
      for (let i = 0; i <= n; i++) {
        const a = -span / 2 + (i / n) * span;
        const p = c
          .clone()
          .add(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r * -1))
          .add(offset);
        // A slack strap sits a little loose around the bole.
        const loose = (1 - this.tension) * 0.02 * Math.sin(i * 2.1);
        p.x += loose;
        wrapPts.push(p);
      }
      s.wrap.update(wrapPts.map((p) => p.clone().applyMatrix4(root.matrixWorld)));

      const endA = wrapPts[0].clone().applyMatrix4(root.matrixWorld);
      const endB = wrapPts[wrapPts.length - 1].clone().applyMatrix4(root.matrixWorld);

      // Legs converge on the shackle; visible only once the sling is on the
      // trunk and the hook is somewhere above it.
      const attach = s.placed > 0.02;
      s.legL.mesh.visible = attach;
      s.legR.mesh.visible = attach;
      s.shackle.visible = attach;
      if (attach) {
        const sag = (1 - this.tension) * 0.9 + 0.06;
        s.legL.update(catenaryPoints(endA, shackleWorld, sag, 10));
        s.legR.update(catenaryPoints(endB, shackleWorld, sag, 10));
        s.shackle.position.copy(shackleWorld);
        s.shackle.lookAt(endA);
        s.shackle.rotateX(Math.PI / 2);
      }
    }

    if (this.tagLine.mesh.visible) {
      const top = this.tree.worldTrunkPoint(this.tree.tagLineHeight, this.tmpB);
      const ground = this.tagWorldAnchor.clone();
      ground.x += this.tagPull * 1.6;
      const dist = top.distanceTo(ground);
      const sag = Math.max(0.08, (1 - Math.abs(this.tagPull)) * 0.5 + dist * 0.02);
      this.tagLine.update(catenaryPoints(top, ground, sag, 16));
    }
  }

  dispose(): void {
    for (const s of this.slings) {
      s.wrap.dispose();
      s.legL.dispose();
      s.legR.dispose();
      this.scene.remove(s.group);
    }
    this.tagLine.dispose();
  }
}
