import * as THREE from 'three';
import { M } from '../materials';
import * as TX from '../textures';
import { beltRun, otherBagGeometry } from './conveyor';
import { wp } from '../journey';
import type { Segment, FrameState } from './types';

/**
 * AirsideSegment: daylight, wind, a wide apron with guidance markings, GSE,
 * and the aircraft — a generalized narrow-body with a real (thick, hinged)
 * cargo door. Fuselage axis runs along +X at z=12.1, center y=3.9, r=2.05.
 */

export const FUSELAGE = { z: 12.1, y: 3.9, r: 2.05, doorX0: 49.3, doorX1: 50.9 };

function ringSegment(
  x0: number,
  x1: number,
  thetaStart: number,
  thetaLength: number,
  r = FUSELAGE.r,
  mat: THREE.Material = M.fuselage,
): THREE.Mesh {
  const len = x1 - x0;
  const geo = new THREE.CylinderGeometry(r, r, len, 40, 1, true, thetaStart, thetaLength);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.z = -Math.PI / 2; // axis → +X (world x = local y)
  mesh.position.set((x0 + x1) / 2, FUSELAGE.y, FUSELAGE.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// door arc on the -z belly side (see design notes): φ ∈ [2.604, 3.239]
const DOOR_T0 = 2.604;
const DOOR_T1 = 3.239;

export function buildAirside(): Segment {
  const g = new THREE.Group();

  // ---- sky dome ----
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(150, 32, 16),
    new THREE.MeshBasicMaterial({ map: TX.sky(), side: THREE.BackSide, fog: false }),
  );
  dome.position.set(48, 0, 10);
  g.add(dome);

  // ---- apron ----
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), M.apron);
  (M.apron.map as THREE.Texture).repeat.set(9, 7);
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(66, -0.01, 14);
  apron.receiveShadow = true;
  g.add(apron);

  // painted markings: yellow lead-in line under the fuselage centerline + T-bar
  const paintY = 0.005;
  const yellowMat = new THREE.MeshStandardMaterial({ color: 0xc7a41c, roughness: 0.9 });
  const lead = new THREE.Mesh(new THREE.PlaneGeometry(46, 0.3), yellowMat);
  lead.rotation.x = -Math.PI / 2;
  lead.position.set(62, paintY, FUSELAGE.z);
  g.add(lead);
  const tbar = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 6), yellowMat);
  tbar.rotation.x = -Math.PI / 2;
  tbar.position.set(58.5, paintY, FUSELAGE.z);
  g.add(tbar);
  // red equipment clearance line (restraint: one line, near the stand)
  const redMat = new THREE.MeshStandardMaterial({ color: 0xa03028, roughness: 0.9 });
  const clear1 = new THREE.Mesh(new THREE.PlaneGeometry(30, 0.14), redMat);
  clear1.rotation.x = -Math.PI / 2;
  clear1.position.set(58, paintY, 2.0);
  g.add(clear1);
  // white apron edge dashes
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xd8dadb, roughness: 0.9 });
  const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.4, 0.18), dashMat, 14);
  const dm = new THREE.Matrix4();
  const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  for (let i = 0; i < 14; i++) {
    dm.compose(new THREE.Vector3(44 + i * 3.1, paintY, -4.5), dq, new THREE.Vector3(1, 1, 1));
    dashes.setMatrixAt(i, dm);
  }
  g.add(dashes);

  // ---- building exterior (the wall we exit through) ----
  const cladMat = new THREE.MeshStandardMaterial({ color: 0x9aa4a8, roughness: 0.7, metalness: 0.3 });
  const bw = (cz: number, w: number, cy: number, h: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, h, w), cladMat);
    m.position.set(41.15, cy, cz);
    m.receiveShadow = true;
    m.castShadow = true;
    g.add(m);
  };
  bw(-3.4, 11.2, 2.5, 5.3);
  bw(7.45, 7.1, 2.5, 5.3);
  bw(3.2, 1.5, 3.55, 3.2); // above door
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 22), M.steelDark);
  parapet.position.set(41.15, 5.3, 1.9);
  g.add(parapet);
  // long facade continuing into the distance both ways
  const facade = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6.5, 70), cladMat);
  facade.position.set(40.6, 3.2, -24);
  g.add(facade);

  // ---- outdoor transfer conveyor to the loader ----
  const dir14 = wp(14).clone().sub(wp(13)).normalize();
  g.add(beltRun(new THREE.Vector3(41.1, 0.42, 3.2), wp(13), { width: 0.85, legsTo: 0 }));
  g.add(
    beltRun(wp(13), wp(14).clone().addScaledVector(dir14, -0.45), {
      width: 0.85,
      legsTo: 0,
    }),
  );
  // corner transfer plate at the bend
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 1.1), M.galvanized);
  plate.position.set(wp(13).x, wp(13).y - 0.035, wp(13).z + 0.1);
  plate.rotation.y = 0.3;
  g.add(plate);

  // ================= AIRCRAFT =================
  const NOSE = 68.5;
  const TAIL = 38.5;
  const { doorX0, doorX1 } = FUSELAGE;
  // fuselage skin: full rings fore/aft of the door, split rings around it
  g.add(ringSegment(TAIL + 3.5, doorX0, 0, Math.PI * 2));
  g.add(ringSegment(doorX1, NOSE - 2.5, 0, Math.PI * 2));
  g.add(ringSegment(doorX0, doorX1, DOOR_T1, Math.PI * 2 - (DOOR_T1 - 0))); // wraps past door
  g.add(ringSegment(doorX0, doorX1, 0, DOOR_T0));

  // nose cone
  const nose = new THREE.Mesh(new THREE.SphereGeometry(FUSELAGE.r, 28, 18), M.fuselage);
  nose.scale.set(1.9, 1, 1);
  nose.position.set(NOSE - 2.5, FUSELAGE.y, FUSELAGE.z);
  nose.castShadow = true;
  g.add(nose);
  // cockpit window band (dark, wrapped plane)
  const cockpit = new THREE.Mesh(
    new THREE.CylinderGeometry(FUSELAGE.r * 0.985, FUSELAGE.r * 0.985, 0.55, 24, 1, true, Math.PI * 0.6, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: 0x161c22, roughness: 0.25, side: THREE.DoubleSide }),
  );
  cockpit.rotation.z = -Math.PI / 2;
  cockpit.position.set(NOSE - 1.1, FUSELAGE.y + 0.55, FUSELAGE.z);
  cockpit.scale.set(0.7, 1, 0.7);
  g.add(cockpit);
  // tail cone + empennage
  const tailCone = new THREE.Mesh(
    new THREE.CylinderGeometry(FUSELAGE.r, 0.45, 7, 28, 1, true),
    M.fuselage,
  );
  tailCone.rotation.z = Math.PI / 2;
  tailCone.position.set(TAIL + 0.1, FUSELAGE.y + 0.5, FUSELAGE.z);
  tailCone.rotation.x = 0;
  tailCone.castShadow = true;
  g.add(tailCone);
  const finGeo = new THREE.BoxGeometry(3.6, 5.4, 0.28);
  const fin = new THREE.Mesh(finGeo, M.fuselage);
  fin.position.set(TAIL - 0.6, FUSELAGE.y + 3.6, FUSELAGE.z);
  fin.rotation.z = 0.6;
  fin.castShadow = true;
  g.add(fin);
  for (const sz of [-1, 1]) {
    const stab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 4.6), M.fuselage);
    stab.position.set(TAIL - 0.4, FUSELAGE.y + 1.1, FUSELAGE.z + 3 * sz);
    stab.rotation.y = 0.5 * sz;
    stab.rotation.x = -0.06 * sz;
    g.add(stab);
  }

  // wings (low wing, swept; near wing toward the camera side -z)
  for (const sz of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.24, 13.5), M.fuselage);
    wing.position.set(56.5 - 2.2, FUSELAGE.y - 0.85 + 0.55, FUSELAGE.z + 7.4 * sz);
    wing.rotation.y = -0.42 * sz;
    wing.rotation.x = -0.05 * sz;
    wing.castShadow = true;
    g.add(wing);
    // engine pod + pylon
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.78, 2.9, 20, 1, true), M.fuselage);
    eng.rotation.z = Math.PI / 2;
    eng.position.set(56.8, 1.55, FUSELAGE.z + 4.0 * sz);
    eng.castShadow = true;
    g.add(eng);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.83, 0.07, 8, 24), M.steelDark);
    lip.rotation.y = Math.PI / 2;
    lip.position.set(58.25, 1.55, FUSELAGE.z + 4.0 * sz);
    g.add(lip);
    const spinner = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), M.steelDark);
    spinner.position.set(58.15, 1.55, FUSELAGE.z + 4.0 * sz);
    g.add(spinner);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 0.24), M.fuselage);
    pylon.position.set(56.6, 2.55, FUSELAGE.z + 4.0 * sz);
    g.add(pylon);
  }

  // landing gear
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.9 });
  const strutMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.35, metalness: 0.7 });
  const gear = (gx: number, gz: number, twin: boolean) => {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.0, 10), strutMat);
    strut.position.set(gx, 1.05, gz);
    g.add(strut);
    for (const so of twin ? [-0.22, 0.22] : [-0.16, 0.16]) {
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.32, 18), tyreMat);
      tyre.rotation.x = Math.PI / 2;
      tyre.position.set(gx, 0.5, gz + so);
      tyre.castShadow = true;
      g.add(tyre);
    }
    // chock
    const chock = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.2), M.yellowRail);
    chock.position.set(gx - 0.62, 0.08, gz);
    g.add(chock);
  };
  gear(65.4, FUSELAGE.z, false); // nose gear
  gear(56.6, FUSELAGE.z - 2.0, true); // main
  gear(56.6, FUSELAGE.z + 2.0, true);

  // ---- cargo door: frame reveal + open door panel ----
  const doorGrp = buildCargoDoor();
  g.add(doorGrp);

  // ---- GSE dressing ----
  // parked cart train near the nose stand
  const obGeo = otherBagGeometry();
  const trainBags = new THREE.InstancedMesh(obGeo, M.otherBag[4], 4);
  const tm = new THREE.Matrix4();
  let ti = 0;
  const parkedCart = (cx: number, cz: number, rot: number) => {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.09, 1.3), M.steelDark);
    bed.position.set(cx, 0.5, cz);
    bed.rotation.y = rot;
    g.add(bed);
    for (const e of [-0.9, 0.9]) {
      const wl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 10), tyreMat);
      wl.rotation.x = Math.PI / 2;
      wl.position.set(cx + Math.cos(rot) * e, 0.16, cz - Math.sin(rot) * e + 0.5);
      g.add(wl);
      const wr = wl.clone();
      wr.position.z = cz - Math.sin(rot) * e - 0.5;
      g.add(wr);
    }
    tm.compose(
      new THREE.Vector3(cx, 0.68, cz),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot + 0.1),
      new THREE.Vector3(1, 1, 1),
    );
    trainBags.setMatrixAt(ti++, tm);
    tm.compose(
      new THREE.Vector3(cx + 0.7, 0.68, cz + 0.1),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot - 0.15),
      new THREE.Vector3(1, 1, 1),
    );
    trainBags.setMatrixAt(ti++, tm);
  };
  parkedCart(59.5, 6.2, 0.2);
  parkedCart(62.4, 6.6, 0.05);
  trainBags.count = ti;
  g.add(trainBags);

  // safety cones near the wingtip / engine
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xc2521e, roughness: 0.7 });
  for (const [cx, cz] of [
    [52.5, 2.8],
    [56.5, 1.2],
    [61.5, 3.4],
    [66.8, 10.2],
  ] as const) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 10), coneMat);
    cone.position.set(cx, 0.25, cz);
    g.add(cone);
    const coneBase = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.34), coneMat);
    coneBase.position.set(cx, 0.02, cz);
    g.add(coneBase);
  }

  // windsock (ambient wind indicator)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 4.4, 8), M.galvanized);
  pole.position.set(45, 2.2, -7.5);
  g.add(pole);
  const sock = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.1, 1.5, 10, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xc2521e, roughness: 0.85, side: THREE.DoubleSide }),
  );
  sock.rotation.z = Math.PI / 2 + 0.18;
  sock.position.set(45.8, 4.25, -7.5);
  g.add(sock);

  // distant scenery: far terminal facade + tower + another aircraft silhouette
  const farTerm = new THREE.Mesh(
    new THREE.BoxGeometry(60, 9, 8),
    new THREE.MeshStandardMaterial({ color: 0x8b9298, roughness: 0.8 }),
  );
  farTerm.position.set(80, 4.5, -28);
  g.add(farTerm);
  const winBand = new THREE.Mesh(
    new THREE.BoxGeometry(60.2, 2.2, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x36444e, roughness: 0.4 }),
  );
  winBand.position.set(80, 5.4, -23.9);
  g.add(winBand);
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.4, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x9ba2a6, roughness: 0.8 }),
  );
  tower.position.set(105, 8, -20);
  g.add(tower);
  const towerCab = new THREE.Mesh(
    new THREE.CylinderGeometry(2.0, 1.6, 2.4, 12),
    new THREE.MeshStandardMaterial({ color: 0x3c464e, roughness: 0.4 }),
  );
  towerCab.position.set(105, 17, -20);
  g.add(towerCab);
  const farPlane = new THREE.Group();
  const fBody = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 26, 12), M.fuselage);
  fBody.rotation.z = Math.PI / 2;
  farPlane.add(fBody);
  const fFin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 4.4, 0.2), M.fuselage);
  fFin.position.set(-12, 3, 0);
  fFin.rotation.z = 0.5;
  farPlane.add(fFin);
  farPlane.position.set(95, 3.2, 42);
  farPlane.rotation.y = 0.5;
  g.add(farPlane);

  const update = (st: FrameState) => {
    // windsock flutter (ambient)
    sock.rotation.z = Math.PI / 2 + 0.14 + Math.sin(st.time * 1.9) * 0.09;
    sock.rotation.y = Math.sin(st.time * 0.7) * 0.2;
  };

  // aircraft + apron must already be visible when the exit curtain parts
  return { group: g, range: [0.72, 1.01], update };
}

/** Cargo door frame with visible thickness + door panel hinged open upward. */
function buildCargoDoor(): THREE.Group {
  const grp = new THREE.Group();
  const { doorX0, doorX1, r, y: cy, z: cz } = FUSELAGE;
  const innerMat = new THREE.MeshStandardMaterial({ color: 0x9aa39f, roughness: 0.7 });

  // frame reveal: short radial walls around the opening (thickness 0.09)
  const revealDepth = 0.14;
  const edge = (theta: number, x0: number, x1: number) => {
    // a thin box positioned at the arc angle, oriented radially
    const len = x1 - x0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, revealDepth, 0.06), innerMat);
    const yy = cy - r * Math.sin(theta - Math.PI); // see mapping: world_y = -r*sin(φ)
    const zz = cz + r * Math.cos(theta);
    m.position.set((x0 + x1) / 2, cy - r * Math.sin(theta), cz + r * Math.cos(theta));
    void yy;
    void zz;
    m.lookAt(new THREE.Vector3((x0 + x1) / 2, cy, cz));
    return m;
  };
  grp.add(edge(DOOR_T0, doorX0, doorX1));
  grp.add(edge(DOOR_T1, doorX0, doorX1));
  // vertical reveals at fore/aft edges of the opening
  for (const ex of [doorX0, doorX1]) {
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(r - 0.02, r - 0.02, 0.06, 12, 1, true, DOOR_T0, DOOR_T1 - DOOR_T0),
      innerMat,
    );
    seg.rotation.z = -Math.PI / 2;
    seg.position.set(ex, cy, cz);
    grp.add(seg);
  }
  // sill scuff plate
  const sill = new THREE.Mesh(
    new THREE.BoxGeometry(doorX1 - doorX0 + 0.1, 0.05, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x8e9499, metalness: 0.6, roughness: 0.4 }),
  );
  sill.position.set((doorX0 + doorX1) / 2, 2.93, cz - r * 0.86);
  grp.add(sill);

  // the door panel itself: curved, thick, hinged at its top edge, held open
  const panelArc = DOOR_T1 - DOOR_T0;
  const doorOuter = new THREE.CylinderGeometry(r + 0.02, r + 0.02, doorX1 - doorX0 - 0.06, 18, 1, true, DOOR_T0, panelArc);
  const doorInner = new THREE.CylinderGeometry(r - 0.06, r - 0.06, doorX1 - doorX0 - 0.06, 18, 1, true, DOOR_T0, panelArc);
  const doorPivot = new THREE.Group();
  // hinge line: top edge of the opening (θ = DOOR_T1 → upper edge since world_y = -r sinφ ... upper edge is the smaller |sin|)
  // Upper edge of the door is at φ=DOOR_T1 (world y ≈ cy+0.2). Hinge along X there.
  const hy = cy - r * Math.sin(DOOR_T1);
  const hz = cz + r * Math.cos(DOOR_T1);
  doorPivot.position.set((doorX0 + doorX1) / 2, hy, hz);
  const outerMesh = new THREE.Mesh(doorOuter, M.fuselage);
  outerMesh.rotation.z = -Math.PI / 2;
  outerMesh.position.set(0, cy - hy, cz - hz);
  const innerMesh = new THREE.Mesh(
    doorInner,
    new THREE.MeshStandardMaterial({ color: 0xb7bdb9, roughness: 0.75, side: THREE.BackSide }),
  );
  innerMesh.rotation.z = -Math.PI / 2;
  innerMesh.position.set(0, cy - hy, cz - hz);
  doorPivot.add(outerMesh, innerMesh);
  // edge caps to show thickness
  for (const theta of [DOOR_T0]) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(doorX1 - doorX0 - 0.06, 0.1, 0.1), innerMat);
    cap.position.set(0, cy - hy - r * Math.sin(theta) - (cy - hy) * 0, cz - hz + r * Math.cos(theta));
    cap.position.y = cy - r * Math.sin(theta) - hy;
    doorPivot.add(cap);
  }
  // swing OPEN upward-outward around hinge axis X
  doorPivot.rotation.x = -2.4;
  grp.add(doorPivot);
  // hinge arms
  for (const hx of [doorX0 + 0.25, doorX1 - 0.25]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.1), innerMat);
    arm.position.set(hx, hy + 0.22, hz - 0.12);
    arm.rotation.x = 0.5;
    grp.add(arm);
  }
  return grp;
}
