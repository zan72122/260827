import * as THREE from 'three';
import type { Materials } from './materials';
import { BLANK } from '../config';
import { makeFinishedTree } from '../geom/finishedTree';

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** scale a wood material's UVs so the grain keeps one real-world size */
function retile(mesh: THREE.Mesh, along: number, across: number) {
  const uv = mesh.geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * along, uv.getY(i) * across);
  uv.needsUpdate = true;
}

export interface Workshop {
  root: THREE.Group;
  /** everything that turns with the blank */
  spindle: THREE.Group;
  key: THREE.DirectionalLight;
  keyDir: THREE.Vector3;
  dispose(): void;
}

export function buildWorkshop(mat: Materials, scene: THREE.Scene, quality: 'high' | 'low'): Workshop {
  const root = new THREE.Group();
  const disposables: THREE.BufferGeometry[] = [];
  const track = (m: THREE.Mesh) => { disposables.push(m.geometry as THREE.BufferGeometry); return m; };

  /* ---- room ------------------------------------------------------- */
  const floor = track(box(9, 0.12, 9, mat.floor, 0, -1.0, -1.8));
  retile(floor, 14, 14);
  floor.castShadow = false;
  root.add(floor);

  const wall = track(box(9, 4.2, 0.14, mat.wall, 0, 1.1, -2.35));
  retile(wall, 5, 3);
  wall.castShadow = false;
  root.add(wall);
  const wallR = track(box(0.14, 4.2, 6.0, mat.wall, 3.1, 1.1, 0.4));
  retile(wallR, 4, 3); wallR.castShadow = false; root.add(wallR);
  const wallL = track(box(0.14, 4.2, 6.0, mat.wall, -3.9, 1.1, 0.4));
  retile(wallL, 4, 3); wallL.castShadow = false; root.add(wallL);
  const ceil = track(box(8.6, 0.14, 6.4, mat.wall, -0.4, 3.05, 0.2));
  retile(ceil, 4, 4); ceil.castShadow = false; root.add(ceil);

  // the window itself: a bright opening in the left wall, seen only obliquely
  const glassG = new THREE.PlaneGeometry(2.0, 1.5);
  const glass = new THREE.Mesh(glassG, new THREE.MeshBasicMaterial({ color: 0xfff6e6 }));
  glass.rotation.y = Math.PI / 2;
  glass.position.set(-3.82, 1.55, 0.75);
  disposables.push(glassG); root.add(glass);
  const barsG = new THREE.BoxGeometry(0.03, 1.5, 0.045);
  const bars = new THREE.Mesh(barsG, mat.jigWood);
  bars.position.set(-3.79, 1.55, 0.75);
  disposables.push(barsG); root.add(bars);

  /* ---- bench ------------------------------------------------------ */
  const top = track(box(2.9, 0.10, 1.9, mat.bench, 0, -0.05, -0.25));
  retile(top, 6, 4);
  root.add(top);
  const apron = track(box(2.9, 0.13, 0.06, mat.bench, 0, -0.16, 0.67));
  retile(apron, 6, 0.4);
  root.add(apron);
  for (const [lx, lz] of [[-1.25, 0.55], [1.25, 0.55], [-1.25, -1.05], [1.25, -1.05]] as const) {
    const leg = track(box(0.14, 0.86, 0.14, mat.bench, lx, -0.53, lz));
    retile(leg, 0.5, 3);
    root.add(leg);
  }

  /* ---- carving board clamped to the bench: this is the near edge --- */
  const board = track(box(1.24, 0.075, 1.00, mat.jigWood, 0, 0.0375, -0.02));
  retile(board, 3, 2.4);
  root.add(board);
  const batten = track(box(1.24, 0.052, 0.055, mat.jigWood, 0, 0.101, 0.452));
  retile(batten, 3, 0.2);
  root.add(batten);
  // a few shavings already swept to one side; real geometry, resting flat
  for (let i = 0; i < 4; i++) {
    const r = 0.020 + i * 0.004;
    const g = new THREE.TorusGeometry(r, 0.010, 6, 18, Math.PI * 1.5);
    const m = new THREE.Mesh(g, mat.shaving);
    m.scale.set(1, 1, 0.30);
    m.position.set(-0.30 - i * 0.085, 0.075 + 0.010, 0.16 + i * 0.048);
    m.rotation.set(Math.PI / 2, 0, 0.5 + i);
    m.castShadow = true; m.receiveShadow = true;
    disposables.push(g);
    root.add(m);
  }

  /* ---- the jig: the blank is held between two centres -------------- */
  const jigBase = track(box(0.44, 0.075, 0.36, mat.bench, 0, 0.075 + 0.0375, 0));
  retile(jigBase, 1, 1);
  root.add(jigBase);

  const cupG = new THREE.CylinderGeometry(0.080, 0.092, 0.058, 28);
  const cup = new THREE.Mesh(cupG, mat.iron);
  cup.position.set(0, 0.150 - 0.029, 0);
  cup.castShadow = true; cup.receiveShadow = true;
  disposables.push(cupG); root.add(cup);

  const lowCenterG = new THREE.ConeGeometry(0.019, 0.06, 20);
  const lowCenter = new THREE.Mesh(lowCenterG, mat.steel);
  lowCenter.position.set(0, 0.178, 0);
  lowCenter.castShadow = true;
  disposables.push(lowCenterG); root.add(lowCenter);

  // upright post + arm carrying the upper centre
  const post = track(box(0.085, 1.80, 0.085, mat.bench, -0.42, 0.075 + 0.90, -0.14));
  retile(post, 0.4, 4);
  root.add(post);
  const armG = new THREE.BoxGeometry(0.46, 0.030, 0.026);
  const arm = new THREE.Mesh(armG, mat.iron);
  arm.position.set(-0.20, BLANK.standHeight + BLANK.height + 0.095, -0.02);
  arm.castShadow = true;
  disposables.push(armG); root.add(arm);
  const braceG = new THREE.BoxGeometry(0.26, 0.022, 0.024);
  const brace = new THREE.Mesh(braceG, mat.iron);
  brace.position.set(-0.307, BLANK.standHeight + BLANK.height + 0.02, -0.05);
  brace.rotation.z = 0.52;
  brace.castShadow = true;
  disposables.push(braceG); root.add(brace);

  const upCenterG = new THREE.ConeGeometry(0.016, 0.065, 20);
  const upCenter = new THREE.Mesh(upCenterG, mat.steel);
  upCenter.rotation.x = Math.PI;
  upCenter.position.set(0, BLANK.standHeight + BLANK.height + 0.036, 0);
  upCenter.castShadow = true;
  disposables.push(upCenterG); root.add(upCenter);

  // detent pawl on the base: what makes a 60 degree index repeatable
  const pawlG = new THREE.BoxGeometry(0.03, 0.012, 0.13);
  const pawl = new THREE.Mesh(pawlG, mat.iron);
  pawl.position.set(0.112, 0.245, 0.085);
  pawl.rotation.x = -0.35;
  pawl.castShadow = true;
  disposables.push(pawlG); root.add(pawl);

  /* ---- the spindle: everything that turns with the blank ---------- */
  const spindle = new THREE.Group();
  spindle.position.y = BLANK.standHeight;
  root.add(spindle);

  // index ring with six notches, keyed to the blank
  const ringShape = new THREE.Shape();
  const R = 0.115, notch = 0.017;
  const steps = 144;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const k = Math.abs(((a * 6) / (Math.PI * 2)) % 1 - 0.5) * 2;
    const rr = R - notch * Math.pow(k, 6);
    const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
    if (i === 0) ringShape.moveTo(px, py); else ringShape.lineTo(px, py);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.046, 0, Math.PI * 2, true);
  ringShape.holes.push(hole);
  const ringG = new THREE.ExtrudeGeometry(ringShape, { depth: 0.026, bevelEnabled: false, curveSegments: 8 });
  ringG.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringG, mat.jigWood);
  ring.position.y = 0.045;
  ring.castShadow = true; ring.receiveShadow = true;
  disposables.push(ringG); spindle.add(ring);

  /* ---- shelf with a few finished pieces --------------------------- */
  const shelfY = 0.58;
  const shelf = track(box(2.4, 0.042, 0.30, mat.shelf, -0.15, shelfY, -2.10));
  retile(shelf, 5, 1);
  root.add(shelf);
  for (const bx of [-1.15, 0.85]) {
    const br = track(box(0.04, 0.40, 0.28, mat.shelf, bx, shelfY - 0.24, -2.10));
    retile(br, 0.3, 1); root.add(br);
  }
  const shelf2 = track(box(2.4, 0.042, 0.30, mat.shelf, -0.15, shelfY + 0.66, -2.10));
  retile(shelf2, 5, 1);
  root.add(shelf2);

  const model = makeFinishedTree(mat.blank, mat.shaving, 11);
  const shelfTrees: THREE.Group[] = [];
  for (const [sx, sy, sz, sc, rot] of [
    [-0.80, shelfY + 0.0275, -2.06, 0.30, 0.4],
    [-0.55, shelfY + 0.0275, -2.10, 0.24, 2.1],
    [0.52, shelfY + 0.6875, -2.06, 0.27, 1.2],
  ] as const) {
    const t = sc === 0.30 ? model : model.clone();
    t.position.set(sx, sy, sz);
    t.scale.setScalar(sc);
    t.rotation.y = rot;
    t.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    shelfTrees.push(t);
    root.add(t);
  }
  // a couple of turned blanks waiting their turn, lying on their sides
  for (const [bx, bz, br] of [[-0.05, -2.06, 0.10], [0.10, -2.12, -0.22]] as const) {
    const pts: THREE.Vector2[] = [];
    for (let y = 0; y <= 0.42; y += 0.03) pts.push(new THREE.Vector2(Math.max(0.004, 0.070 - 0.150 * y), y));
    const lg = new THREE.LatheGeometry(pts, 16);
    const lm = new THREE.Mesh(lg, mat.blank);
    lm.geometry.translate(0, -0.21, 0);
    lm.rotation.set(0, 0, Math.PI / 2 + br);
    lm.position.set(bx, shelfY + 0.045, bz);
    lm.castShadow = true; lm.receiveShadow = true;
    disposables.push(lg); root.add(lm);
  }

  scene.add(root);

  /* ---- light: one broad window, raking from the left -------------- */
  const key = new THREE.DirectionalLight(0xfff1d8, 2.4);
  key.position.set(-2.9, 2.4, 1.5);
  key.target.position.set(0, 1.05, 0);
  key.castShadow = true;
  const sz = quality === 'high' ? 2048 : 1024;
  key.shadow.mapSize.set(sz, sz);
  key.shadow.camera.left = -1.0; key.shadow.camera.right = 1.0;
  key.shadow.camera.top = 1.5; key.shadow.camera.bottom = -0.6;
  key.shadow.camera.near = 1.5; key.shadow.camera.far = 7.5;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 3;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(0xa8c0d8, 0.22);
  fill.position.set(2.4, 1.4, 1.0);
  scene.add(fill);

  const bounce = new THREE.DirectionalLight(0xe6c79c, 0.34);
  bounce.position.set(-0.4, 0.55, 2.2);
  scene.add(bounce);

    const rim = new THREE.DirectionalLight(0xffd9a8, 0.55);
  rim.position.set(2.2, 1.1, -1.6);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xcfdcea, 0x4b3a29, 0.10));

  const keyDir = new THREE.Vector3().subVectors(key.position, key.target.position).normalize();

  void shelfTrees;
  return {
    root, spindle, key, keyDir,
    dispose() {
      for (const g of disposables) g.dispose();
      scene.remove(root, key, key.target, fill, bounce, rim);
    },
  };
}
