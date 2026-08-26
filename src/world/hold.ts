import * as THREE from 'three';
import { M } from '../materials';
import { otherBagGeometry } from './conveyor';
import { FUSELAGE } from './airside';
import type { Segment, FrameState } from './types';

/**
 * CargoHoldSegment: the bulk hold interior. Curved liner walls with visible
 * frames, floor with a roller strip at the doorway, a cargo net, a dim lamp,
 * and a small pile of other bags the hero bag settles beside.
 */
export function buildHold(): Segment {
  const g = new THREE.Group();
  const { y: cy, z: cz } = FUSELAGE;
  const rIn = 1.92;
  const X0 = 47.9;
  const X1 = 53.1;
  const FLOOR_Y = 3.0;

  // curved interior liner (backside of a cylinder segment, upper ~3/4)
  const linerMat = new THREE.MeshStandardMaterial({
    color: 0x9aa39f,
    roughness: 0.85,
    side: THREE.BackSide,
  });
  // door theta arc must stay open in the liner too (same mapping as exterior)
  const DT0 = 2.604;
  const DT1 = 3.239;
  const linerPiece = (x0: number, x1: number, t0: number, tl: number) => {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(rIn, rIn, x1 - x0, 28, 1, true, t0, tl),
      linerMat,
    );
    m.rotation.z = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, cy, cz);
    g.add(m);
  };
  linerPiece(X0, FUSELAGE.doorX0, 0, Math.PI * 2);
  linerPiece(FUSELAGE.doorX1, X1, 0, Math.PI * 2);
  linerPiece(FUSELAGE.doorX0, FUSELAGE.doorX1, DT1, Math.PI * 2 - DT1);
  linerPiece(FUSELAGE.doorX0, FUSELAGE.doorX1, 0, DT0);
  // visible frames (ribs)
  const ribMat = new THREE.MeshStandardMaterial({ color: 0x767e7a, roughness: 0.7 });
  for (let x = X0 + 0.5; x < X1 - 0.2; x += 0.72) {
    if (x > FUSELAGE.doorX0 - 0.1 && x < FUSELAGE.doorX1 + 0.1) continue; // keep the doorway clear
    const rib = new THREE.Mesh(new THREE.TorusGeometry(rIn - 0.03, 0.028, 6, 24), ribMat);
    rib.rotation.y = Math.PI / 2;
    rib.position.set(x, cy, cz);
    g.add(rib);
  }

  // flat hold floor
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x5b6160, roughness: 0.9 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(X1 - X0, 0.12, 3.6), floorMat);
  floor.position.set((X0 + X1) / 2, FLOOR_Y - 0.06, cz);
  floor.receiveShadow = true;
  g.add(floor);
  // floor roller strip across the doorway (short rollers the bag rumbles over)
  const rollers = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8),
    M.roller,
    8,
  );
  const rm = new THREE.Matrix4();
  const rq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
  for (let i = 0; i < 8; i++) {
    rm.compose(
      new THREE.Vector3(50.2, FLOOR_Y + 0.01, cz - 1.55 + i * 0.24),
      rq,
      new THREE.Vector3(1, 1, 1),
    );
    rollers.setMatrixAt(i, rm);
  }
  g.add(rollers);

  // end bulkheads
  const bulkMat = new THREE.MeshStandardMaterial({ color: 0x848c88, roughness: 0.85 });
  for (const bx of [X0 + 0.05, X1 - 0.05]) {
    const bulk = new THREE.Mesh(new THREE.CylinderGeometry(rIn - 0.01, rIn - 0.01, 0.08, 24), bulkMat);
    bulk.rotation.z = -Math.PI / 2;
    bulk.position.set(bx, cy, cz);
    g.add(bulk);
  }

  // cargo net at the forward end (thin diagonal straps + fittings)
  const netMat = new THREE.MeshStandardMaterial({ color: 0x3c3a34, roughness: 0.95 });
  const net = new THREE.Group();
  for (let i = -3; i <= 3; i++) {
    const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.4, 4), netMat);
    s1.position.set(0, cy - FLOOR_Y + 1.0 - 1.2, i * 0.42);
    s1.rotation.x = 0.5;
    net.add(s1);
    const s2 = s1.clone();
    s2.rotation.x = -0.5;
    net.add(s2);
  }
  for (const fy of [-0.4, 1.2]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 3.4), netMat);
    strap.position.set(0, fy, 0);
    net.add(strap);
  }
  net.position.set(X1 - 0.35, FLOOR_Y + 0.6, cz);
  g.add(net);
  // net attach fittings
  for (const nz of [cz - 1.5, cz + 1.5]) {
    const fit = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), M.roller);
    fit.position.set(X1 - 0.35, FLOOR_Y + 0.08, nz);
    g.add(fit);
  }

  // other bags already loaded (the pile the hero bag joins)
  const obGeo = otherBagGeometry();
  const pile = new THREE.InstancedMesh(obGeo, M.otherBag[0], 6);
  const pm = new THREE.Matrix4();
  const ps = new THREE.Vector3(1, 1, 1);
  const positions: [number, number, number, number][] = [
    [49.2, FLOOR_Y + 0.14, cz + 0.9, 0.15],
    [49.9, FLOOR_Y + 0.14, cz + 1.15, -0.2],
    [49.5, FLOOR_Y + 0.14, cz + 0.1, 1.5],
    [49.55, FLOOR_Y + 0.42, cz + 0.6, 0.4],
    [51.6, FLOOR_Y + 0.14, cz + 1.0, 1.35],
    [51.9, FLOOR_Y + 0.14, cz + 0.15, -0.1],
  ];
  positions.forEach((p, i) => {
    pm.compose(
      new THREE.Vector3(p[0], p[1], p[2]),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p[3]),
      ps,
    );
    pile.setMatrixAt(i, pm);
  });
  // vary bag colors by using two instanced meshes
  pile.count = 4;
  g.add(pile);
  const pile2 = new THREE.InstancedMesh(obGeo, M.otherBag[3], 2);
  positions.slice(4).forEach((p, i) => {
    pm.compose(
      new THREE.Vector3(p[0], p[1], p[2]),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p[3]),
      ps,
    );
    pile2.setMatrixAt(i, pm);
  });
  g.add(pile2);

  // dim warm service lamp
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xf6ecd8,
    emissive: 0xe8d8a8,
    emissiveIntensity: 1.6,
  });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.12), lampMat);
  lamp.position.set(50.4, cy + rIn - 0.28, cz + 0.3);
  g.add(lamp);
  const lampCage = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.18), M.steelDark);
  lampCage.position.set(50.4, cy + rIn - 0.24, cz + 0.3);
  g.add(lampCage);
  const light = new THREE.PointLight(0xe8d0a0, 18, 7, 2);
  light.position.set(50.4, cy + rIn - 0.45, cz + 0.3);
  g.add(light);

  const update = (_st: FrameState) => {};
  return { group: g, range: [0.9, 1.01], update };
}
