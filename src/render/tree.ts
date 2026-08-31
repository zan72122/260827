import * as THREE from 'three';
import { MM } from '../core/units';
import {
  spec,
  trunkTopY,
  leafSlots,
  leafJoint,
  starJoint,
  type LeafSlot,
} from '../design/treeSpec';
import {
  buildLeafGeometry,
  buildTrunkGeometry,
  buildTrunkFootGeometry,
  buildAxleGeometry,
  buildStarGeometry,
} from './parts';
import type { Palette } from './materials';

export interface PieceRef {
  id: string;
  kind: 'leaf' | 'star';
  slot: LeafSlot | null;
  object: THREE.Object3D;
  seated: boolean;
}

/**
 * The tree as an object.  Its origin is the shoulder plane on the tree's axis,
 * so the whole group can be rotated about Y to turn the tree, and moved as one
 * when the child carries it from the jig to the pot.
 */
export class TreeModel {
  readonly group = new THREE.Group();
  readonly trunk = new THREE.Group();
  readonly pieces = new Map<string, PieceRef>();
  readonly slots: LeafSlot[] = leafSlots();
  private leafGeo = new Map<number, THREE.BufferGeometry>();

  constructor(private palette: Palette) {
    this.group.name = 'tree';

    const post = new THREE.Mesh(buildTrunkGeometry(), palette.trunk);
    post.name = 'trunk-post';
    post.castShadow = true;
    post.receiveShadow = true;
    this.trunk.add(post);

    const collar = new THREE.Mesh(buildTrunkFootGeometry(), palette.trunk);
    collar.castShadow = true;
    collar.receiveShadow = true;
    this.trunk.add(collar);

    const axle = new THREE.Mesh(buildAxleGeometry(), palette.steel);
    axle.name = 'axle';
    axle.castShadow = true;
    this.trunk.add(axle);

    this.group.add(this.trunk);

    for (const slot of this.slots) {
      const mesh = new THREE.Mesh(this.geometryFor(slot.span), palette.leaf);
      mesh.name = `leaf-${slot.id}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.pieces.set(slot.id, { id: slot.id, kind: 'leaf', slot, object: mesh, seated: false });
    }

    const star = new THREE.Group();
    star.name = 'star';
    const { boardA, boardB } = buildStarGeometry();
    const a = new THREE.Mesh(boardA, palette.star);
    const b = new THREE.Mesh(boardB, palette.star);
    a.castShadow = b.castShadow = true;
    a.receiveShadow = b.receiveShadow = true;
    star.add(a, b);
    this.pieces.set('star', { id: 'star', kind: 'star', slot: null, object: star, seated: false });
  }

  private geometryFor(span: number): THREE.BufferGeometry {
    let g = this.leafGeo.get(span);
    if (!g) {
      g = buildLeafGeometry(span);
      this.leafGeo.set(span, g);
    }
    return g;
  }

  /** Tree-local pose of a piece, `offsetMM` back along its insertion axis. */
  poseFor(id: string, offsetMM: number): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
    const piece = this.pieces.get(id)!;
    if (piece.kind === 'star') {
      const j = starJoint();
      const seatY = j.seated[1] - spec.trunk.starSlot.depth + spec.star.height / 2 + spec.star.tenonLength;
      return {
        position: new THREE.Vector3(0, (seatY + offsetMM) * MM, 0),
        quaternion: new THREE.Quaternion(),
      };
    }
    const slot = piece.slot!;
    const j = leafJoint(slot);
    const n = new THREE.Vector3(-j.axis[0], 0, -j.axis[2]); // outward
    const pos = new THREE.Vector3(
      (j.seated[0] + n.x * offsetMM) * MM,
      j.seated[1] * MM,
      (j.seated[2] + n.z * offsetMM) * MM,
    );
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      slot.yaw - Math.PI / 2,
    );
    return { position: pos, quaternion: q };
  }

  /** Put a piece into the tree at the given distance out along its axis. */
  place(id: string, offsetMM: number) {
    const piece = this.pieces.get(id)!;
    const { position, quaternion } = this.poseFor(id, offsetMM);
    if (piece.object.parent !== this.group) this.group.add(piece.object);
    piece.object.position.copy(position);
    piece.object.quaternion.copy(quaternion);
  }

  seat(id: string) {
    this.place(id, 0);
    this.pieces.get(id)!.seated = true;
  }

  detach(id: string, into: THREE.Object3D) {
    const piece = this.pieces.get(id)!;
    piece.seated = false;
    into.add(piece.object);
  }

  get seatedCount() {
    return [...this.pieces.values()].filter((p) => p.seated).length;
  }

  /** World-space point on the trunk axis at a height above the shoulder plane. */
  axisPoint(heightMM: number, target = new THREE.Vector3()) {
    return target.set(0, heightMM * MM, 0).applyMatrix4(this.group.matrixWorld);
  }

  get trunkTopWorldY() {
    return this.axisPoint(trunkTopY).y;
  }

  dispose() {
    for (const g of this.leafGeo.values()) g.dispose();
    void this.palette;
  }
}
