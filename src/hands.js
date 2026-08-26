import * as THREE from 'three';

// Stylized but grounded adult artisan hands wearing gray cut-resistant knit
// gloves with a snug cuff, plus long dark work sleeves. The child's finger
// drives these hands; the hands are what touch tools and glass.

const GLOVE = new THREE.MeshStandardMaterial({ color: 0x9fa8ad, roughness: 0.92 });
const GLOVE_DARK = new THREE.MeshStandardMaterial({ color: 0x6b7478, roughness: 0.95 }); // palm coating
const CUFF = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.95 });
const SLEEVE = new THREE.MeshStandardMaterial({ color: 0x37475a, roughness: 1.0 });
const BRASS = new THREE.MeshStandardMaterial({ color: 0xb08d3f, metalness: 0.8, roughness: 0.35 });
const STEEL = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.85, roughness: 0.3 });
const STEEL_WORN = new THREE.MeshStandardMaterial({ color: 0x777d84, metalness: 0.7, roughness: 0.55 });
const GRIP = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.8 });
const RUBBER_RED = new THREE.MeshStandardMaterial({ color: 0x8d3730, roughness: 0.85 });
const RUBBER_PAD = new THREE.MeshStandardMaterial({ color: 0x2e2320, roughness: 0.95 });
const ORANGE = new THREE.MeshStandardMaterial({ color: 0xc46a2b, roughness: 0.7 });

function capsule(r, len, mat) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 8), mat);
  m.castShadow = true;
  return m;
}

// A gloved hand. Local frame: palm faces -y, fingers point -z, wrist at +z.
// mirror=true builds the left hand. setCurl(0..1) closes the fingers.
export function makeHand({ mirror = false } = {}) {
  const g = new THREE.Group();
  const sx = mirror ? -1 : 1;
  const joints = [];

  // palm: flattened sphere reads as a gloved palm
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 10), GLOVE);
  palm.scale.set(0.92, 0.42, 1.15);
  palm.castShadow = true;
  g.add(palm);
  const palmPad = new THREE.Mesh(new THREE.SphereGeometry(0.046, 12, 8), GLOVE_DARK);
  palmPad.scale.set(0.88, 0.34, 1.1);
  palmPad.position.y = -0.006;
  g.add(palmPad);

  // four fingers
  const fingerX = [-0.031, -0.011, 0.010, 0.030];
  const fingerLen = [0.040, 0.047, 0.044, 0.035];
  for (let i = 0; i < 4; i++) {
    const root = new THREE.Group();
    root.position.set(sx * fingerX[i], -0.002, -0.048);
    const seg1 = capsule(0.0105, fingerLen[i] * 0.55, GLOVE);
    seg1.rotation.x = Math.PI / 2;
    seg1.position.z = -fingerLen[i] * 0.32;
    root.add(seg1);
    const knuckle = new THREE.Group();
    knuckle.position.z = -fingerLen[i] * 0.62;
    const seg2 = capsule(0.0095, fingerLen[i] * 0.5, GLOVE);
    seg2.rotation.x = Math.PI / 2;
    seg2.position.z = -fingerLen[i] * 0.3;
    knuckle.add(seg2);
    root.add(knuckle);
    g.add(root);
    joints.push({ root, knuckle, base: 0 });
  }

  // thumb (opposite side for the mirrored hand)
  const thumbRoot = new THREE.Group();
  thumbRoot.position.set(sx * -0.042, -0.008, -0.012);
  thumbRoot.rotation.y = sx * 0.75;
  const th1 = capsule(0.012, 0.026, GLOVE);
  th1.rotation.x = Math.PI / 2;
  th1.position.z = -0.016;
  thumbRoot.add(th1);
  const thKnuckle = new THREE.Group();
  thKnuckle.position.z = -0.033;
  const th2 = capsule(0.0105, 0.022, GLOVE);
  th2.rotation.x = Math.PI / 2;
  th2.position.z = -0.014;
  thKnuckle.add(th2);
  thumbRoot.add(thKnuckle);
  g.add(thumbRoot);

  // cuff + long sleeve toward the artisan (up and back)
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.041, 0.05, 12), CUFF);
  cuff.rotation.x = Math.PI / 2 - 0.35;
  cuff.position.set(0, 0.014, 0.062);
  cuff.castShadow = true;
  g.add(cuff);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.058, 0.34, 12), SLEEVE);
  sleeve.rotation.x = Math.PI / 2 - 0.35;
  sleeve.position.set(0, 0.078, 0.23);
  sleeve.castShadow = true;
  g.add(sleeve);

  function setCurl(c) {
    for (const j of joints) {
      j.root.rotation.x = -c * 1.15;
      j.knuckle.rotation.x = -c * 1.25;
    }
    thumbRoot.rotation.x = -c * 0.55;
    thKnuckle.rotation.x = -c * 0.7;
  }
  setCurl(0.25);

  return { group: g, setCurl };
}

// Oil-fed pencil-style glass cutter. Local origin = wheel contact point,
// -z = travel direction, +y = up. The handle leans back against the travel.
export function makeCutter() {
  const g = new THREE.Group();

  // small tungsten-carbide wheel (~5.6 mm dia) in a steel head
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.0012, 16), STEEL);
  wheel.rotation.z = Math.PI / 2; // axle along x -> rolls along z
  wheel.position.y = 0.0028;
  g.add(wheel);
  const fork = new THREE.Mesh(new THREE.BoxGeometry(0.0044, 0.006, 0.005), STEEL_WORN);
  fork.position.y = 0.0062;
  g.add(fork);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.0036, 0.0028, 0.014, 10), BRASS);
  head.position.y = 0.015;
  g.add(head);

  // tilted brass barrel (oil reservoir) with a dark grip
  const lean = new THREE.Group();
  lean.position.y = 0.02;
  lean.rotation.x = 0.42; // leans back over +z (opposite travel)
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0056, 0.085, 12), BRASS);
  barrel.position.y = 0.045;
  barrel.castShadow = true;
  lean.add(barrel);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0078, 0.0072, 0.045, 12), GRIP);
  grip.position.y = 0.055;
  lean.add(grip);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.0068, 10, 8), BRASS);
  cap.position.y = 0.09;
  lean.add(cap);
  g.add(lean);

  return { group: g, lean };
}

// Running pliers. Local origin = mouth center where the pane sits between the
// jaws; -z points into the pane along the score. setSqueeze(0..1) closes them.
export function makeRunningPliers() {
  const g = new THREE.Group();

  const upper = new THREE.Group();
  const lower = new THREE.Group();
  g.add(upper, lower);

  const jawU = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.011, 0.05), RUBBER_RED);
  jawU.position.set(0, 0.011, -0.02);
  jawU.castShadow = true;
  upper.add(jawU);
  // upper pad is flat with a center relief so pressure lands either side of the score
  const padU = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.004, 0.044), RUBBER_PAD);
  padU.position.set(0, 0.0045, -0.02);
  upper.add(padU);

  const jawL = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.011, 0.05), RUBBER_RED);
  jawL.position.set(0, -0.011, -0.02);
  jawL.castShadow = true;
  lower.add(jawL);
  // lower pad carries the gentle center ridge that bends the pane upward
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 0.044), RUBBER_PAD);
  ridge.position.set(0, -0.0045, -0.02);
  lower.add(ridge);

  // pivot + handles sweeping back toward the artisan
  const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.02, 10), STEEL_WORN);
  pivot.rotation.z = Math.PI / 2;
  pivot.position.set(0, 0, 0.028);
  g.add(pivot);
  const handleU = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.009, 0.19, 10), RUBBER_RED);
  handleU.rotation.x = Math.PI / 2 - 0.18;
  handleU.position.set(0, 0.022, 0.12);
  handleU.castShadow = true;
  upper.add(handleU);
  const handleL = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.009, 0.19, 10), RUBBER_RED);
  handleL.rotation.x = Math.PI / 2 + 0.18;
  handleL.position.set(0, -0.022, 0.12);
  handleL.castShadow = true;
  lower.add(handleL);

  function setSqueeze(s) {
    upper.rotation.x = -s * 0.05;
    lower.rotation.x = s * 0.05;
  }
  setSqueeze(0);

  return { group: g, setSqueeze };
}

// Single-cup suction lifter with a fold-down cam lever.
export function makeSuctionCup() {
  const g = new THREE.Group();
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.012, 20), ORANGE);
  cup.position.y = 0.006;
  cup.castShadow = true;
  g.add(cup);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), ORANGE);
  dome.position.y = 0.012;
  g.add(dome);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.018, 0.024), STEEL_WORN);
  bar.position.y = 0.052;
  g.add(bar);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.02), RUBBER_RED);
  lever.position.set(0.05, 0.068, 0);
  lever.rotation.z = -0.5;
  g.add(lever);
  return { group: g };
}
