import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from './materials';

/**
 * Two postal workers, each a single skinned mesh on a six bone rig. They do not
 * do the sorting for the child - they keep the hall inhabited.
 */
export class PostWorker {
  readonly group = new THREE.Group();
  private bones: THREE.Bone[] = [];
  private phase: number;
  private mesh: THREE.SkinnedMesh;

  constructor(mats: MaterialLibrary, seed = 0) {
    this.phase = seed * 1.7;

    const parts: THREE.BufferGeometry[] = [];

    const legs = new THREE.CylinderGeometry(0.15, 0.19, 0.9, 12, 2);
    legs.translate(0, 0.45, 0);
    parts.push(legs);

    const torso = new THREE.CylinderGeometry(0.21, 0.17, 0.55, 14, 3);
    torso.translate(0, 1.2, 0);
    parts.push(torso);

    const collar = new THREE.CylinderGeometry(0.09, 0.13, 0.1, 10);
    collar.translate(0, 1.52, 0);
    parts.push(collar);

    const cap = new THREE.CylinderGeometry(0.135, 0.14, 0.06, 14);
    cap.translate(0, 1.78, 0);
    parts.push(cap);
    const peak = new THREE.BoxGeometry(0.16, 0.02, 0.1);
    peak.translate(0, 1.755, 0.14);
    parts.push(peak);

    for (const s of [-1, 1]) {
      const arm = new THREE.CylinderGeometry(0.052, 0.045, 0.52, 8);
      arm.translate(0, -0.26, 0);
      arm.rotateZ(s * 0.14);
      arm.translate(s * 0.22, 1.42, 0);
      parts.push(arm);
      const hand = new THREE.SphereGeometry(0.055, 10, 8);
      hand.translate(s * 0.28, 1.16, 0);
      parts.push(hand);
    }

    const geo = mergeGeometries(parts, false);
    if (!geo) throw new Error('worker geometry merge failed');
    for (const p of parts) p.dispose();

    // --- rig
    const root = new THREE.Bone();
    const hips = new THREE.Bone();
    hips.position.y = 0.9;
    const chest = new THREE.Bone();
    chest.position.y = 0.35;
    const neck = new THREE.Bone();
    neck.position.y = 0.36;
    const armL = new THREE.Bone();
    armL.position.set(0.22, 0.3, 0);
    const armR = new THREE.Bone();
    armR.position.set(-0.22, 0.3, 0);

    root.add(hips);
    hips.add(chest);
    chest.add(neck, armL, armR);
    this.bones = [root, hips, chest, neck, armL, armR];

    // --- weights: nearest joint by height, arms take over past the shoulder
    const pos = geo.attributes.position;
    const skinIndex: number[] = [];
    const skinWeight: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      let a = 0;
      let b = 1;
      let w = 1;
      if (y < 0.9) {
        a = 1;
        b = 0;
        w = THREE.MathUtils.clamp(y / 0.9, 0, 1) * 0.5 + 0.5;
      } else if (Math.abs(x) > 0.17 && y > 1.05 && y < 1.6) {
        a = x > 0 ? 4 : 5;
        b = 2;
        w = THREE.MathUtils.clamp((Math.abs(x) - 0.17) / 0.1, 0, 1);
      } else if (y < 1.45) {
        a = 2;
        b = 1;
        w = THREE.MathUtils.clamp((y - 0.9) / 0.55, 0, 1);
      } else {
        a = 3;
        b = 2;
        w = THREE.MathUtils.clamp((y - 1.45) / 0.2, 0, 1);
      }
      skinIndex.push(a, b, 0, 0);
      skinWeight.push(w, 1 - w, 0, 0);
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

    const material = mats.cloth.clone();
    material.color = new THREE.Color(seed % 2 === 0 ? 0x5d7280 : 0x7a6a4e);

    this.mesh = new THREE.SkinnedMesh(geo, material);
    this.mesh.castShadow = true;
    const skeleton = new THREE.Skeleton(this.bones);
    this.mesh.add(root);
    this.mesh.bind(skeleton);
    this.group.add(this.mesh);

    // a face-less painted head keeps this out of uncanny territory
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.128, 14, 10), mats.skin);
    face.scale.set(1, 1.1, 0.95);
    face.position.y = 0.07;
    this.bones[3].add(face);
  }

  update(t: number): void {
    const p = t * 1.1 + this.phase;
    this.bones[1].rotation.z = Math.sin(p * 0.6) * 0.03;
    this.bones[2].rotation.y = Math.sin(p * 0.45) * 0.12;
    this.bones[3].rotation.x = Math.sin(p * 0.7) * 0.06 - 0.05;
    this.bones[4].rotation.x = Math.sin(p) * 0.5 - 0.35;
    this.bones[5].rotation.x = Math.sin(p + 1.9) * 0.45 - 0.3;
    this.bones[4].rotation.z = Math.sin(p * 0.5) * 0.08;
  }
}
