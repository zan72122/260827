import * as THREE from 'three';
import type { MaterialSet } from '../materials';
import { Rng } from '../util/rng';
import { CAKE } from '../cake/design';

export const STATION = {
  cut: new THREE.Vector3(0, 0, 0),
  build: new THREE.Vector3(34, 0, 0),
};

export interface Turntable {
  group: THREE.Group;
  plate: THREE.Group;
  /** World height of the cake board's top face. */
  cakeY: number;
}

export interface Kitchen {
  root: THREE.Group;
  cutTable: Turntable;
  buildTable: Turntable;
  tray: THREE.Group;
}

function roundedBox(w: number, h: number, d: number, r: number, seg = 3): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const x = -w / 2 + r;
  const y = -d / 2 + r;
  const W = w - 2 * r;
  const D = d - 2 * r;
  shape.moveTo(x, y - r);
  shape.lineTo(x + W, y - r);
  shape.absarc(x + W, y, r, -Math.PI / 2, 0, false);
  shape.lineTo(x + W + r, y + D);
  shape.absarc(x + W, y + D, r, 0, Math.PI / 2, false);
  shape.lineTo(x, y + D + r);
  shape.absarc(x, y + D, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x - r, y);
  shape.absarc(x, y, r, Math.PI, Math.PI * 1.5, false);
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelSize: r * 0.3, bevelThickness: r * 0.3, bevelSegments: seg, curveSegments: 8 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, h, 0);
  return g;
}

export function buildKitchen(mats: MaterialSet): Kitchen {
  const root = new THREE.Group();
  const rng = new Rng(88);

  /* -------- bench: the near-field ground plane for everything else -------- */
  const benchTop = new THREE.Mesh(roundedBox(150, 4, 78, 1.2), mats.bench);
  benchTop.position.set(17, -4, 0);
  benchTop.receiveShadow = true;
  root.add(benchTop);

  const apron = new THREE.Mesh(new THREE.BoxGeometry(150, 12, 2), mats.bench);
  apron.position.set(17, -10, 38);
  root.add(apron);

  /* -------- background: kept flat and low so depth comes from overlap ------ */
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(320, 170), mats.wall);
  wall.position.set(10, 55, -78);
  wall.receiveShadow = true;
  root.add(wall);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(320, 200), new THREE.MeshStandardMaterial({ color: 0x5c554e, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(10, -92, -10);
  root.add(floor);

  const rackMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, metalness: 0.9, roughness: 0.42 });
  const rack = new THREE.Group();
  for (let s = 0; s < 4; s++) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(64, 1.2, 22), rackMat);
    shelf.position.set(0, s * 17, 0);
    rack.add(shelf);
  }
  for (const sx of [-31, 31]) {
    for (const sz of [-10, 10]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 56, 8), rackMat);
      post.position.set(sx, 27, sz);
      rack.add(post);
    }
  }
  // A used rack: a few trays and bowls, stacked unevenly on one side only.
  const bowlMat = new THREE.MeshStandardMaterial({ color: 0xb9bec2, metalness: 0.85, roughness: 0.35 });
  for (let i = 0; i < 5; i++) {
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(4.6 + i * 0.35, 14, 8, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48), bowlMat);
    bowl.position.set(-20 + rng.range(-1.5, 1.5), 18.5 + i * 1.5, rng.range(-3, 3));
    rack.add(bowl);
  }
  for (let i = 0; i < 3; i++) {
    const tray = new THREE.Mesh(new THREE.BoxGeometry(24, 0.8, 16), rackMat);
    tray.position.set(14 + rng.range(-1, 1), 35.6 + i * 1.1, rng.range(-1, 1));
    tray.rotation.y = rng.range(-0.05, 0.05);
    rack.add(tray);
  }
  rack.position.set(-42, -2, -58);
  rack.rotation.y = 0.16;
  root.add(rack);

  const caseGlass = new THREE.Mesh(
    new THREE.BoxGeometry(46, 26, 18),
    new THREE.MeshPhysicalMaterial({ color: 0xdfe8ea, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.16 })
  );
  caseGlass.position.set(84, 14, -74);
  root.add(caseGlass);
  const caseBase = new THREE.Mesh(new THREE.BoxGeometry(48, 24, 20), rackMat);
  caseBase.position.set(84, -11, -74);
  root.add(caseBase);

  /* ---------------- near props: used, but only where a hand works --------- */
  const cloth = new THREE.Group();
  const clothMat = new THREE.MeshStandardMaterial({ color: 0xd9d3c7, roughness: 0.94 });
  for (let i = 0; i < 3; i++) {
    const fold = new THREE.Mesh(roundedBox(15 - i * 1.1, 0.55, 9.5 - i * 0.7, 0.35), clothMat);
    fold.position.set(rng.range(-0.3, 0.3), i * 0.5, rng.range(-0.25, 0.25));
    fold.rotation.y = rng.range(-0.04, 0.04);
    fold.castShadow = true;
    cloth.add(fold);
  }
  cloth.position.set(17.5, 0, 22);
  cloth.rotation.y = -0.22;
  root.add(cloth);

  const mixBowl = new THREE.Mesh(new THREE.SphereGeometry(7.4, 22, 14, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), bowlMat.clone());
  mixBowl.position.set(-24, 7.2, -20);
  mixBowl.castShadow = true;
  mixBowl.receiveShadow = true;
  root.add(mixBowl);
  const bowlRim = new THREE.Mesh(new THREE.TorusGeometry(7.4, 0.28, 6, 26), bowlMat);
  bowlRim.rotation.x = Math.PI / 2;
  bowlRim.position.copy(mixBowl.position);
  root.add(bowlRim);
  // Finger marks: one arc on the near-right of the bowl, where it was carried.
  const smudge = new THREE.Mesh(
    new THREE.SphereGeometry(7.46, 18, 10, 0.5, 1.15, Math.PI * 0.56, Math.PI * 0.3),
    new THREE.MeshStandardMaterial({ color: 0xa9aeb1, roughness: 0.72, metalness: 0.55, transparent: true, opacity: 0.5 })
  );
  smudge.position.copy(mixBowl.position);
  root.add(smudge);

  // A very small scatter of crumbs, only on the working side of the bench.
  const crumbGeo = new THREE.TetrahedronGeometry(0.16, 0);
  const crumbs = new THREE.InstancedMesh(crumbGeo, mats.crumb, 26);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 26; i++) {
    const a = rng.range(-0.5, 2.2);
    const r = rng.range(11, 21);
    const s = rng.range(0.5, 1.3);
    m.compose(
      new THREE.Vector3(Math.cos(a) * r + 3, 0.12, Math.sin(a) * r * 0.6 + 6),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3))),
      new THREE.Vector3(s, s * 0.6, s)
    );
    crumbs.setMatrixAt(i, m);
  }
  crumbs.castShadow = true;
  root.add(crumbs);

  /* ------------------------------- turntables ----------------------------- */
  const ttMat = new THREE.MeshStandardMaterial({ color: 0xb6bbbe, metalness: 0.92, roughness: 0.31 });

  const makeTurntable = (): Turntable => {
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(9.4, 10.6, 1.6, 48), ttMat);
    base.position.y = 0.8;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 2.2, 28), ttMat);
    column.position.y = 2.5;
    group.add(column);
    const plate = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(11.2, 11.0, 1.1, 64), ttMat);
    disc.position.y = 4.1;
    disc.castShadow = true;
    disc.receiveShadow = true;
    plate.add(disc);
    const bearingRing = new THREE.Mesh(new THREE.TorusGeometry(10.4, 0.16, 6, 56), ttMat);
    bearingRing.rotation.x = Math.PI / 2;
    bearingRing.position.y = 3.6;
    plate.add(bearingRing);
    const board = new THREE.Mesh(
      new THREE.CylinderGeometry(CAKE.boardRadius, CAKE.boardRadius, CAKE.boardThickness, 64),
      mats.board
    );
    board.position.y = 4.65 + CAKE.boardThickness / 2;
    board.castShadow = true;
    board.receiveShadow = true;
    plate.add(board);
    group.add(plate);
    return { group, plate, cakeY: 4.65 + CAKE.boardThickness };
  };

  const cutTable = makeTurntable();
  cutTable.group.position.copy(STATION.cut);
  root.add(cutTable.group);

  const buildTable = makeTurntable();
  buildTable.group.position.copy(STATION.build);
  root.add(buildTable.group);

  /* --------- tray of sliced strawberries, set where a hand reaches -------- */
  const tray = new THREE.Group();
  const trayMat = new THREE.MeshStandardMaterial({ color: 0xc3c8cb, metalness: 0.88, roughness: 0.36 });
  const pan = new THREE.Mesh(roundedBox(22, 0.5, 13, 1.4), trayMat);
  pan.receiveShadow = true;
  tray.add(pan);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(1, 0.16, 5, 4), trayMat);
  lip.visible = false;
  tray.add(lip);
  for (const [sx, sz, w, d] of [[0, -6.4, 22, 0.5], [0, 6.4, 22, 0.5], [-10.9, 0, 0.5, 13], [10.9, 0, 0.5, 13]] as const) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 1.5, d), trayMat);
    wall.position.set(sx, 0.75, sz);
    wall.castShadow = true;
    tray.add(wall);
  }
  tray.position.set(STATION.build.x - 0.5, 0.25, 15.5);
  tray.rotation.y = -0.08;
  root.add(tray);

  /* --------------------------------- light -------------------------------- */
  const key = new THREE.DirectionalLight(0xfff3e2, 2.5);
  key.position.set(-26, 52, 34);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 10;
  key.shadow.camera.far = 160;
  const half = 46;
  key.shadow.camera.left = -half;
  key.shadow.camera.right = half;
  key.shadow.camera.top = half;
  key.shadow.camera.bottom = -half;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.05;
  key.target.position.set(17, 4, 0);
  root.add(key, key.target);

  const fill = new THREE.DirectionalLight(0xdfe9ff, 0.55);
  fill.position.set(40, 24, 46);
  root.add(fill);

  const rim = new THREE.DirectionalLight(0xffe9d0, 0.4);
  rim.position.set(18, 30, -50);
  root.add(rim);

  const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x6f6156, 0.55);
  root.add(hemi);

  return { root, cutTable, buildTable, tray };
}
