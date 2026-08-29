import * as THREE from 'three';
import type { Materials } from './Materials';

/**
 * The patissier's hand. Held at mid distance and usually cropped by the frame,
 * so it reads as a person working rather than as a character: correct
 * proportions, matte skin, a natural working curl, and a grip point where a tool
 * actually sits in the palm.
 */
export function makeHand(materials: Materials, side: 'left' | 'right'): {
  group: THREE.Group;
  grip: THREE.Object3D;
} {
  const g = new THREE.Group();
  const mirror = side === 'left' ? -1 : 1;
  const skin = materials.skinTone;

  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.048, 20, 14), skin);
  palm.scale.set(0.92, 0.34, 1.0);
  palm.castShadow = true;
  g.add(palm);

  const wrist = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.07, 6, 14), skin);
  wrist.rotation.x = Math.PI / 2;
  wrist.position.set(0, -0.002, -0.076);
  wrist.castShadow = true;
  g.add(wrist);

  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.038, 0.05, 20), materials.glove);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(0, -0.002, -0.124);
  cuff.castShadow = true;
  g.add(cuff);

  const fingerSpec = [
    { x: -0.031, len: [0.040, 0.026, 0.019], r: 0.0092 },
    { x: -0.010, len: [0.045, 0.029, 0.020], r: 0.0096 },
    { x: 0.011, len: [0.042, 0.027, 0.019], r: 0.0092 },
    { x: 0.031, len: [0.034, 0.022, 0.017], r: 0.0082 },
  ];

  for (const spec of fingerSpec) {
    let parent: THREE.Object3D = g;
    let curl = 0.42;
    const root = new THREE.Object3D();
    root.position.set(spec.x * mirror, 0.002, 0.044);
    g.add(root);
    parent = root;
    for (const len of spec.len) {
      const joint = new THREE.Object3D();
      joint.rotation.x = curl;
      parent.add(joint);
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(spec.r, len, 5, 12), skin);
      seg.rotation.x = Math.PI / 2;
      seg.position.z = len / 2;
      seg.castShadow = true;
      joint.add(seg);
      const next = new THREE.Object3D();
      next.position.z = len;
      joint.add(next);
      parent = next;
      curl = 0.52;
      spec.r *= 0.88;
    }
  }

  const thumbRoot = new THREE.Object3D();
  thumbRoot.position.set(-0.042 * mirror, 0.004, -0.008);
  thumbRoot.rotation.set(0.32, 0.9 * mirror, 0.5 * mirror);
  g.add(thumbRoot);
  let tParent: THREE.Object3D = thumbRoot;
  for (const len of [0.038, 0.028]) {
    const joint = new THREE.Object3D();
    joint.rotation.x = 0.34;
    tParent.add(joint);
    const seg = new THREE.Mesh(new THREE.CapsuleGeometry(0.0105, len, 5, 12), skin);
    seg.rotation.x = Math.PI / 2;
    seg.position.z = len / 2;
    seg.castShadow = true;
    joint.add(seg);
    const next = new THREE.Object3D();
    next.position.z = len;
    joint.add(next);
    tParent = next;
  }

  const grip = new THREE.Object3D();
  grip.position.set(0, 0.014, 0.03);
  g.add(grip);

  return { group: g, grip };
}
