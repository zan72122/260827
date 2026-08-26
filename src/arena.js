// Indoor arena around the rink: boards, benches, partly-empty stands,
// ceiling truss, practical white arena lights. No neon, no branding.

import * as THREE from 'three';
import { RINK } from './path.js';

export function buildArena(scene) {
  const group = new THREE.Group();

  const W = RINK.halfW, L = RINK.halfL;
  const boardH = 1.1;

  const boardMat = new THREE.MeshStandardMaterial({ color: 0xf2f3f0, roughness: 0.55 });
  const kickMat = new THREE.MeshStandardMaterial({ color: 0xd9b53c, roughness: 0.7 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.5 });

  function wall(w, d, x, z, rotY) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, boardH, 0.12), boardMat);
    b.position.y = boardH / 2;
    const kick = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, 0.13), kickMat);
    kick.position.y = 0.1; kick.position.z = 0.005;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.18), capMat);
    cap.position.y = boardH + 0.03;
    g.add(b, kick, cap);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    group.add(g);
  }
  wall(W * 2 + 0.3, 0.12, 0, -L - 0.06, 0);
  wall(W * 2 + 0.3, 0.12, 0, L + 0.06, 0);
  wall(L * 2 + 0.3, 0.12, -W - 0.06, 0, Math.PI / 2);
  wall(L * 2 + 0.3, 0.12, W + 0.06, 0, Math.PI / 2);

  // surrounding rubber-mat floor
  const matFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 110),
    new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.95 })
  );
  matFloor.rotation.x = -Math.PI / 2;
  matFloor.position.y = -0.02;
  group.add(matFloor);

  // team benches on +x side
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x7a4a2b, roughness: 0.8 });
  for (const z of [-6, 3]) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, 5.5), benchMat);
    bench.position.set(W + 1.2, 0.42, z);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 5.5), benchMat);
    back.position.set(W + 1.7, 0.8, z);
    group.add(bench, back);
  }

  // stands on -x side: stepped rows of seats, most empty
  const rows = 5, seatsPerRow = 26;
  const seatGeo = new THREE.BoxGeometry(0.5, 0.45, 0.5);
  const seatColors = [0x37536b, 0x40607c, 0x2f4a60];
  const seatMats = seatColors.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
  const rnd = (() => { let a = 99; return () => { a = a * 16807 % 2147483647; return a / 2147483647; }; })();
  const seatMesh = new THREE.InstancedMesh(seatGeo, seatMats[0], rows * seatsPerRow);
  const dummy = new THREE.Object3D();
  let si = 0;
  for (let r = 0; r < rows; r++) {
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.55 + r * 0.55, L * 2 + 4),
      new THREE.MeshStandardMaterial({ color: 0x454a50, roughness: 0.9 })
    );
    step.position.set(-W - 2.6 - r * 1.6, (0.55 + r * 0.55) / 2, 0);
    group.add(step);
    for (let s = 0; s < seatsPerRow; s++) {
      dummy.position.set(-W - 2.6 - r * 1.6, 0.55 + r * 0.55 + 0.22, -L - 1 + s * (L * 2 + 2) / seatsPerRow + 0.8);
      dummy.updateMatrix();
      seatMesh.setMatrixAt(si, dummy.matrix);
      seatMesh.setColorAt(si, new THREE.Color(seatColors[(rnd() * 3) | 0]));
      si++;
    }
  }
  seatMesh.instanceColor && (seatMesh.instanceColor.needsUpdate = true);
  group.add(seatMesh);

  // a handful of spectators among the empty seats
  const specGroup = new THREE.Group();
  const bodyColors = [0xc95f4b, 0x5b7fa6, 0xc9a44b, 0x7a5ba6, 0x5ba66e, 0xa65b8f];
  for (let i = 0; i < 8; i++) {
    const r = (rnd() * rows) | 0, s = (rnd() * seatsPerRow) | 0;
    const p = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.18, 0.3, 3, 8),
      new THREE.MeshStandardMaterial({ color: bodyColors[i % bodyColors.length], roughness: 0.9 })
    );
    body.position.y = 0.35;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xe8c39e, roughness: 0.8 })
    );
    head.position.y = 0.72;
    p.add(body, head);
    p.position.set(-W - 2.6 - r * 1.6, 0.55 + r * 0.55 + 0.35, -L - 1 + s * (L * 2 + 2) / seatsPerRow + 0.8);
    specGroup.add(p);
  }
  group.add(specGroup);

  // ceiling truss + hanging practical lights
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x565c63, roughness: 0.7, metalness: 0.4 });
  for (const z of [-11, 0, 11]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(46, 0.5, 0.5), trussMat);
    beam.position.set(0, 15.2, z);
    group.add(beam);
    for (let k = -20; k <= 20; k += 4) {
      const diag = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 4.4), trussMat);
      diag.position.set(k, 14.8, z);
      diag.rotation.x = Math.PI / 4;
      group.add(diag);
    }
  }
  for (const z of [-5.5, 5.5]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 38), trussMat);
    beam.position.set(z * 2, 15.2, 0);
    group.add(beam);
  }

  const fixtureMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xfff6e6, emissiveIntensity: 2.2, roughness: 0.4
  });
  const housingMat = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.6, metalness: 0.5 });
  const lightPositions = [
    [-6.5, 12.6, -11], [6.5, 12.6, -11],
    [-6.5, 12.6, 0], [6.5, 12.6, 0],
    [-6.5, 12.6, 11], [6.5, 12.6, 11]
  ];
  for (const [x, y, z] of lightPositions) {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.28, 0.9), housingMat);
    housing.position.set(x, y + 0.18, z);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.74), fixtureMat);
    panel.position.set(x, y, z);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4), trussMat);
    rod.position.set(x, y + 1.5, z);
    group.add(housing, panel, rod);
  }

  // end walls: concrete with the resurfacer garage door at the far end
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3f464d, roughness: 0.9 });
  for (const zEnd of [-L - 6, L + 6]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(60, 12, 0.6), wallMat);
    w.position.set(0, 6, zEnd);
    group.add(w);
  }
  for (const xEnd of [-W - 12, W + 8]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.6, 12, 2 * L + 14), wallMat);
    w.position.set(xEnd, 6, 0);
    group.add(w);
  }
  const garageDoor = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 3.2, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.7, metalness: 0.3 })
  );
  garageDoor.position.set(2.5, 1.6, -L - 5.6);
  group.add(garageDoor);
  for (let i = 0; i < 4; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.06, 0.24), housingMat);
    slat.position.set(2.5, 0.6 + i * 0.75, -L - 5.6);
    group.add(slat);
  }

  // far dark ceiling plane so the arena has a lid
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 110),
    new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 1 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = 18;
  group.add(ceil);

  scene.add(group);

  // scene lighting for standard materials (ice has its own shader lights)
  scene.add(new THREE.HemisphereLight(0xdfe8ee, 0x30363b, 0.85));
  const dir = new THREE.DirectionalLight(0xfff4e0, 1.4);
  dir.position.set(6, 12, 4);
  scene.add(dir);
  const dir2 = new THREE.DirectionalLight(0xe8f0f8, 0.5);
  dir2.position.set(-8, 9, -6);
  scene.add(dir2);
  const pt = new THREE.PointLight(0xfff6e6, 60, 50, 1.8);
  pt.position.set(0, 12.6, 0);
  scene.add(pt);

  return group;
}
