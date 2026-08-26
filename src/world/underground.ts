import * as THREE from 'three';
import { M } from '../materials';
import { beltRun, photoEye, fluorescent } from './conveyor';
import { wp } from '../journey';
import type { Segment, FrameState } from './types';

/**
 * ConveyorSegment: the hidden sort-hall level under the terminal.
 * Low slab ceiling, galvanized guards, sensors, cable trays, a maintenance
 * walkway — machines are the protagonists, no crowds.
 */
export function buildUnderground(): Segment {
  const g = new THREE.Group();
  const FLOOR = -2.35;
  const CEIL = 0.45;

  // hall shell: floor / ceiling slab / walls
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(28.5, 13.6), M.concreteFloor);
  (M.concreteFloor.map as THREE.Texture).repeat.set(7, 3);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(18.2, FLOOR, 1.1);
  floor.receiveShadow = true;
  g.add(floor);

  const slabMat = new THREE.MeshStandardMaterial({ color: 0x64676a, roughness: 0.95 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(22.2, 0.3, 13.6), slabMat);
  slab.position.set(19.05, CEIL + 0.15, 1.1);
  g.add(slab);

  const wallFar = new THREE.Mesh(new THREE.BoxGeometry(28.5, 3.4, 0.3), M.concreteWall);
  (M.concreteWall.map as THREE.Texture).repeat.set(8, 1.2);
  wallFar.position.set(18.2, FLOOR + 1.7, 7.9);
  wallFar.receiveShadow = true;
  g.add(wallFar);
  const wallNear = new THREE.Mesh(new THREE.BoxGeometry(28.5, 3.4, 0.3), M.concreteWall);
  wallNear.position.set(18.2, FLOOR + 1.7, -5.2);
  wallNear.receiveShadow = true;
  g.add(wallNear);
  // (the end wall with its shutter openings belongs to the make-up segment)

  // decline shaft behind the check-in wall (taller service space)
  const shaftCeil = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.25, 7), slabMat);
  shaftCeil.position.set(6.1, 2.3, 0);
  g.add(shaftCeil);
  const shaftWallL = new THREE.Mesh(new THREE.BoxGeometry(3.9, 4.7, 0.25), M.concreteWall);
  shaftWallL.position.set(6.1, 0, 4.9);
  g.add(shaftWallL);
  // camera flies on the -z side: keep that side of the shaft open wider
  const shaftWallR = new THREE.Mesh(new THREE.BoxGeometry(3.9, 4.7, 0.25), M.concreteWall);
  shaftWallR.position.set(6.1, 0, -3.4);
  g.add(shaftWallR);
  const shaftBack = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4.7, 8.6), M.concreteWall);
  shaftBack.position.set(4.78, 0, 0.75);
  g.add(shaftBack);

  // columns
  for (const cx of [11, 16, 21, 26]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.8, 0.45), M.concreteWall);
    col.position.set(cx, FLOOR + 1.4, -3.9);
    g.add(col);
  }

  // conveyors: continuation, decline, sort-hall straight run
  g.add(beltRun(new THREE.Vector3(4.7, 0.445, 0), wp(3), { width: 0.85, legsTo: FLOOR }));
  g.add(beltRun(wp(3), wp(4), { width: 0.85, legsTo: FLOOR, guardH: 0.24 }));
  g.add(beltRun(wp(4), new THREE.Vector3(15.95, -1.5, 0), { width: 0.85, legsTo: FLOOR }));

  // maintenance walkway with yellow railing (foreground parallax layer)
  const walk = new THREE.Mesh(
    new THREE.BoxGeometry(21, 0.08, 1.0),
    new THREE.MeshStandardMaterial({ color: 0x4a4e52, roughness: 0.9 }),
  );
  walk.position.set(19, FLOOR + 0.16, -2.7);
  g.add(walk);
  for (let i = 0; i <= 10; i++) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.95, 0.05), M.yellowRail);
    post.position.set(9 + i * 2.05, FLOOR + 0.66, -2.25);
    g.add(post);
  }
  for (const ry of [0.55, 1.0]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(21, 0.05, 0.05), M.yellowRail);
    rail.position.set(19, FLOOR + 0.16 + ry, -2.25);
    g.add(rail);
  }

  // cable tray high on the far wall + conduit drops
  const tray = new THREE.Mesh(new THREE.BoxGeometry(24, 0.1, 0.35), M.galvanized);
  tray.position.set(19, 0.1, -5.05);
  g.add(tray);
  for (const jx of [10.5, 17.5, 24.5]) {
    const jbox = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.16), M.steelDark);
    jbox.position.set(jx, -0.7, -5.06);
    g.add(jbox);
    const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6), M.galvanized);
    conduit.position.set(jx, -0.05, -5.06);
    g.add(conduit);
  }

  // flow chevrons on the far wall (shape-only, pointing along travel)
  for (const cx of [9.5, 14.5]) {
    const chev = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.55), M.chevron);
    chev.position.set(cx, -0.55, -5.02);
    g.add(chev);
  }

  // photo-eye sensors beside the line
  g.add(photoEye(new THREE.Vector3(12.4, -1.32, 0.62)));
  g.add(photoEye(new THREE.Vector3(15.1, -1.32, -0.62), Math.PI));

  // fluorescent battens + real lights (parented here so culling kills them)
  for (const fx of [7.5, 11, 15, 19, 23, 27]) {
    const f = fluorescent(1.4);
    f.position.set(fx, CEIL - 0.06, 1.6);
    f.rotation.y = Math.PI / 2;
    g.add(f);
  }
  for (const lx of [9, 15, 21, 27]) {
    const pl = new THREE.PointLight(0xe8ecda, 14, 11, 2);
    pl.position.set(lx, CEIL - 0.25, 1.2);
    g.add(pl);
  }
  // one light in the decline shaft
  const shaftLight = new THREE.PointLight(0xe8ecda, 10, 8, 2);
  shaftLight.position.set(6.2, 1.7, 0);
  g.add(shaftLight);

  // spare rollers leaning on the wall (maintenance clutter, sparse)
  for (let i = 0; i < 3; i++) {
    const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 8), M.roller);
    spare.position.set(25.5 + i * 0.12, FLOOR + 0.42, -5.02);
    spare.rotation.z = 0.35 + i * 0.04;
    g.add(spare);
  }

  const update = (_st: FrameState) => {};
  return { group: g, range: [0.13, 0.72], update };
}
