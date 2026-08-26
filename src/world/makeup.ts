import * as THREE from 'three';
import { M } from '../materials';
import { beltRun, otherBagGeometry } from './conveyor';
import { stripCurtain } from './curtain';
import { journey, wp } from '../journey';
import type { Segment, FrameState } from './types';

/**
 * MakeUpSegment: a roller shutter lifts as the bag climbs out of the sort
 * hall into the ground-level make-up area (baggage carts, a tug), then the
 * building exit — a second rubber-strip crossing plane into daylight.
 */
export function buildMakeup(): Segment {
  const g = new THREE.Group();
  const H_FLOOR = -0.15; // make-up hall floor level

  // ---- dividing wall at x=30.1 with two openings (main lane + incline) ----
  const wallX = 30.1;
  const wall = (cz: number, w: number, cy: number, h: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, h, w), M.concreteWall);
    m.position.set(wallX, cy, cz);
    m.receiveShadow = true;
    g.add(m);
  };
  wall(-3.15, 4.9, -0.95, 2.8);
  wall(1.55, 1.7, -0.95, 2.8);
  wall(4.8, 1.6, -0.95, 2.8);
  wall(0, 1.4, 0.05, 0.8); // header over main lane exit
  wall(0, 1.4, -2.125, 0.45); // sill under main lane exit
  wall(3.2, 1.6, 0.275, 0.35); // header over incline opening
  wall(3.2, 1.6, -2.025, 0.65); // sill under incline opening

  // ---- roller shutter in the incline opening ----
  const sShutter = journey.sAtWaypoint[9] + 1.18;
  const shutterMat = new THREE.MeshStandardMaterial({ color: 0x8e9499, roughness: 0.5, metalness: 0.5 });
  // slat texture via thin ridges
  const shutter = new THREE.Group();
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.8, 1.56), shutterMat);
  panel.position.y = -0.9;
  shutter.add(panel);
  for (let i = 0; i < 10; i++) {
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 1.56), M.steelDark);
    ridge.position.set(0, -0.17 * i - 0.08, 0);
    shutter.add(ridge);
  }
  shutter.position.set(wallX, 0.1, 3.2); // closed: hangs down over the opening
  g.add(shutter);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 1.7), M.steelDark);
  housing.position.set(wallX, 0.28, 3.2);
  g.add(housing);
  for (const sz of [-1, 1]) {
    const guide = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.9, 0.08), M.beltFrame);
    guide.position.set(wallX, -0.85, 3.2 + 0.82 * sz);
    g.add(guide);
  }

  // ---- incline chute side panels (bag climbs inside a guarded chute) ----
  const chuteDir = wp(10).clone().sub(wp(9)).normalize();
  const chuteLen = wp(10).distanceTo(wp(9));
  const chuteMid = wp(9).clone().add(wp(10)).multiplyScalar(0.5);
  for (const sz of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(chuteLen, 0.55, 0.03), M.galvanized);
    side.position.copy(chuteMid).add(new THREE.Vector3(0, 0.22, 0.52 * sz));
    side.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), chuteDir);
    side.receiveShadow = true;
    g.add(side);
  }

  // ---- make-up hall shell ----
  const hallFloorMat = new THREE.MeshStandardMaterial({ map: M.concreteWall.map, roughness: 0.95 });
  const floorA = new THREE.Mesh(new THREE.BoxGeometry(11, 0.12, 5.4), hallFloorMat); // z < 2.35
  floorA.position.set(35.6, H_FLOOR - 0.06, -0.45);
  floorA.receiveShadow = true;
  g.add(floorA);
  const floorB = new THREE.Mesh(new THREE.BoxGeometry(11, 0.12, 3.5), hallFloorMat); // z > 4.05
  floorB.position.set(35.6, H_FLOOR - 0.06, 5.8);
  floorB.receiveShadow = true;
  g.add(floorB);
  const floorC = new THREE.Mesh(new THREE.BoxGeometry(6.9, 0.12, 1.7), hallFloorMat); // beyond trench
  floorC.position.set(37.65, H_FLOOR - 0.06, 3.2);
  floorC.receiveShadow = true;
  g.add(floorC);
  // trench guard rails around the floor opening
  for (const sz of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.05, 0.05), M.yellowRail);
    rail.position.set(32.1, H_FLOOR + 0.5, 3.2 + 0.95 * sz);
    g.add(rail);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.65, 0.05), M.yellowRail);
    post.position.set(34.1, H_FLOOR + 0.22, 3.2 + 0.95 * sz);
    g.add(post);
  }

  const ceil = new THREE.Mesh(
    new THREE.BoxGeometry(11.4, 0.2, 11),
    new THREE.MeshStandardMaterial({ color: 0x707478, roughness: 0.9 }),
  );
  ceil.position.set(35.5, 3.1, 2.2);
  g.add(ceil);
  const wallNear = new THREE.Mesh(new THREE.BoxGeometry(11.4, 3.4, 0.25), M.concreteWall);
  wallNear.position.set(35.5, 1.45, -3.2);
  g.add(wallNear);
  const wallFar = new THREE.Mesh(new THREE.BoxGeometry(11.4, 3.4, 0.25), M.concreteWall);
  wallFar.position.set(35.5, 1.45, 7.6);
  g.add(wallFar);
  // upper wall above the basement (hall side of the dividing wall)
  const wallBack = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.6, 11), M.concreteWall);
  wallBack.position.set(30.05, 1.6, 2.2);
  g.add(wallBack);

  // ---- end wall with the building exit door (crossing plane #2) ----
  const endWall = (cz: number, w: number, cy: number, h: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, h, w), M.concreteWall);
    m.position.set(41.0, cy, cz);
    m.receiveShadow = true;
    g.add(m);
  };
  endWall(-0.55, 5.3, 1.45, 3.4);
  endWall(5.85, 3.8, 1.45, 3.4);
  endWall(3.2, 1.5, 2.45, 1.4); // header above door
  // door frame
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 1.7), M.yellowRail);
  frame.position.set(41.0, 1.78, 3.2);
  g.add(frame);
  // exit strip curtain
  const exitCurtain = stripCurtain(1.5, 1.32, { stripW: 0.115 });
  exitCurtain.group.position.set(40.6, 0.44, 3.2);
  g.add(exitCurtain.group);
  const sExit = journey.sAtWaypoint[12];
  // daylight glare panel just beyond the door (fades once outside)
  const glareMat = new THREE.MeshBasicMaterial({
    color: 0xeaf4fa,
    transparent: true,
    opacity: 0.95,
  });
  const glare = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 1.5), glareMat);
  glare.position.set(41.35, 1.15, 3.2);
  glare.rotation.y = -Math.PI / 2;
  g.add(glare);

  // ---- conveyors through the hall ----
  g.add(beltRun(wp(10), wp(11), { width: 0.85, legsTo: H_FLOOR }));
  g.add(beltRun(wp(11), new THREE.Vector3(41.3, 0.42, 3.2), { width: 0.85, legsTo: H_FLOOR }));

  // ---- baggage carts with other bags + a tug ----
  const obGeo = otherBagGeometry();
  const cartBags = new THREE.InstancedMesh(obGeo, M.otherBag[1], 10);
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3(1, 1, 1);
  let bi = 0;
  const cart = (cx: number, cz: number, rot: number) => {
    const c = new THREE.Group();
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.09, 1.35), M.steelDark);
    bed.position.y = 0.5;
    c.add(bed);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.06, 1.4), M.beltFrame);
    roof.position.y = 1.75;
    c.add(roof);
    for (const [ex, ez] of [
      [-1.2, -0.65],
      [-1.2, 0.65],
      [1.2, -0.65],
      [1.2, 0.65],
    ] as const) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.25, 0.06), M.beltFrame);
      post.position.set(ex, 1.12, ez);
      c.add(post);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 10), M.steelDark);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(ex * 0.75, 0.17, ez);
      c.add(wheel);
    }
    c.position.set(cx, H_FLOOR, cz);
    c.rotation.y = rot;
    g.add(c);
    // stacked bags on the bed (world-space instances)
    for (let k = 0; k < 4 && bi < 10; k++) {
      const lx = -0.75 + (k % 2) * 0.78;
      const ly = 0.68 + Math.floor(k / 2) * 0.3;
      const lz = (k % 2 === 0 ? -0.25 : 0.25) * (k > 1 ? -1 : 1);
      const local = new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot + (k - 1.5) * 0.12);
      tmpM.compose(new THREE.Vector3(cx + local.x, H_FLOOR + local.y, cz + local.z), tmpQ, tmpS);
      cartBags.setMatrixAt(bi++, tmpM);
    }
  };
  cart(34.2, 0.75, 0.15);
  cart(37.4, 0.9, -0.1);
  cartBags.count = bi;
  cartBags.instanceMatrix.needsUpdate = true;
  cartBags.castShadow = true;
  g.add(cartBags);
  // tug (simplified tow tractor)
  const tug = new THREE.Group();
  const tugBody = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.6, 0.95),
    new THREE.MeshStandardMaterial({ color: 0x2e4e66, roughness: 0.6 }),
  );
  tugBody.position.y = 0.55;
  tug.add(tugBody);
  const tugCab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.9), M.steelDark);
  tugCab.position.set(-0.3, 1.1, 0);
  tug.add(tugCab);
  for (const [ex, ez] of [
    [-0.55, -0.5],
    [-0.55, 0.5],
    [0.55, -0.5],
    [0.55, 0.5],
  ] as const) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 12), M.steelDark);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(ex, 0.22, ez);
    tug.add(wheel);
  }
  tug.position.set(31.9, H_FLOOR, 0.55);
  tug.rotation.y = 0.35;
  g.add(tug);

  // chevron above the exit door (points outside)
  const chev = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.42), M.chevron);
  chev.position.set(40.8, 2.05, 3.2);
  chev.rotation.y = -Math.PI / 2;
  g.add(chev);

  // hall lights
  for (const lx of [33.5, 38.5]) {
    const pl = new THREE.PointLight(0xe6ead6, 18, 12, 2);
    pl.position.set(lx, 2.75, 1.8);
    g.add(pl);
  }

  const update = (st: FrameState) => {
    // shutter lifts as the bag approaches, closes behind (pure f(distance))
    const d = st.s - sShutter;
    const open =
      d >= 0
        ? THREE.MathUtils.clamp(1 - (d - 3.2) / 1.6, 0, 1) // hold open behind the bag
        : THREE.MathUtils.clamp(1 - (-d - 0.7) / 1.6, 0, 1);
    shutter.position.y = 0.1 + open * 1.62;
    exitCurtain.update(st.s - sExit);
    // daylight glare fades once the bag is outside
    glareMat.opacity = 0.95 * (1 - THREE.MathUtils.smoothstep(st.p, 0.78, 0.815));
  };

  return { group: g, range: [0.6, 0.85], update };
}
