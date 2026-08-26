import * as THREE from 'three';
import { M } from '../materials';
import * as TX from '../textures';
import { beltRun } from './conveyor';
import { stripCurtain } from './curtain';
import { journey, wp } from '../journey';
import type { Segment, FrameState } from './types';

/**
 * CheckInSegment: bright passenger terminal. Bag starts on the check-in
 * scale/injection belt; the rubber strip curtain in the back wall is the
 * first crossing plane into the hidden machine world.
 */
export function buildTerminal(): Segment {
  const g = new THREE.Group();

  // floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 15), M.terminalFloor);
  (M.terminalFloor.map as THREE.Texture).repeat.set(11, 10);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(-2.5, 0, -1);
  floor.receiveShadow = true;
  g.add(floor);

  // ceiling with recessed light boxes
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 15),
    new THREE.MeshStandardMaterial({ color: 0xdfe3e5, roughness: 0.9 }),
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(-2.5, 3.6, -1);
  g.add(ceil);
  const lightPanelMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xf6f8f0,
    emissiveIntensity: 1.6,
  });
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++) {
      const lp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.5), lightPanelMat);
      lp.position.set(-7 + i * 3.4, 3.58, -5 + j * 3.4);
      g.add(lp);
    }

  // back wall (x = 4.55) with belt opening at z=0
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xb9c0c4, roughness: 0.85 });
  const wallX = 4.55;
  const mkWall = (w: number, h: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.25, h, w), wallMat);
    m.position.set(wallX, y, z);
    m.receiveShadow = true;
    g.add(m);
  };
  // opening: z -0.75..0.75, y 0.3..1.6
  mkWall(7.75, 3.6, 1.8, -4.625); // left of opening
  mkWall(5.25, 3.6, 1.8, 3.375); // right of opening
  mkWall(1.5, 0.3, 0.15, 0); // below opening
  mkWall(1.5, 2.0, 2.6, 0); // above opening
  // opening trim
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 1.66), M.beltFrame);
  trim.position.set(wallX, 1.62, 0);
  g.add(trim);

  // window wall far side (z = +5.4): mullions + daylight panels
  const dayMat = new THREE.MeshStandardMaterial({
    color: 0xcfe4f2,
    emissive: 0xbcd8ec,
    emissiveIntensity: 1.1,
  });
  for (let i = 0; i < 6; i++) {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.8, 0.06), dayMat);
    pane.position.set(-8.3 + i * 2.15, 1.9, -6.2);
    g.add(pane);
    const mull = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.4, 0.14), M.steelDark);
    mull.position.set(-8.3 + i * 2.15 + 1.06, 1.7, -6.2);
    g.add(mull);
  }

  // check-in counter alongside the belt
  const deskMat = new THREE.MeshStandardMaterial({ color: 0x5b6e78, roughness: 0.55 });
  const deskTopMat = new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.35 });
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 0.8), deskMat);
  desk.position.set(1.6, 0.55, -1.35);
  desk.castShadow = true;
  g.add(desk);
  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.06, 0.9), deskTopMat);
  deskTop.position.set(1.6, 1.13, -1.35);
  g.add(deskTop);
  const monitor = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.24, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x14181c, emissive: 0x2a4458, emissiveIntensity: 0.8 }),
  );
  monitor.position.set(1.2, 1.45, -1.3);
  monitor.rotation.y = 0.5;
  g.add(monitor);
  // FIDS board above (abstract blocks, no readable text)
  const fids = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.85, 0.08),
    new THREE.MeshBasicMaterial({ map: TX.fidsPanel() }),
  );
  fids.position.set(1.6, 2.75, -1.9);
  g.add(fids);
  for (const hx of [-0.6, 0.6]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.45, 6), M.steelDark);
    rod.position.set(1.6 + hx, 3.4, -1.9);
    g.add(rod);
  }

  // second check-in island in the background (closed position, no crowd)
  const desk2 = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 0.8), deskMat);
  desk2.position.set(1.4, 0.55, -5.2);
  g.add(desk2);
  const desk2Top = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.06, 0.9), deskTopMat);
  desk2Top.position.set(1.4, 1.13, -5.2);
  g.add(desk2Top);

  // queue stanchions (public side)
  const postMat = new THREE.MeshStandardMaterial({ color: 0x87888c, roughness: 0.3, metalness: 0.8 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x2f3f6e, roughness: 0.7 });
  const posts: [number, number][] = [
    [-1.6, -1.6],
    [-3.2, -1.6],
    [-4.8, -1.6],
    [-1.6, -3.4],
    [-3.2, -3.4],
  ];
  for (const [px, pz] of posts) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.95, 8), postMat);
    post.position.set(px, 0.475, pz - 1.2);
    g.add(post);
  }
  for (const [a, b] of [
    [0, 1],
    [1, 2],
    [3, 4],
  ]) {
    const pa = posts[a];
    const pb = posts[b];
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.05, 0.012), bandMat);
    band.position.set((pa[0] + pb[0]) / 2, 0.88, (pa[1] + pb[1]) / 2 - 1.2);
    g.add(band);
  }

  // check-in scale + injection belt (belt top on the journey path)
  const scaleFrame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 1.1), M.beltFrame);
  scaleFrame.position.set(-0.45, 0.36, 0);
  g.add(scaleFrame);
  g.add(
    beltRun(wp(0).setX(-1.1), wp(1), { width: 0.85, guards: false, legsTo: 0 }),
  );
  g.add(beltRun(wp(1), new THREE.Vector3(4.7, 0.45, 0), { width: 0.85, guards: true, guardH: 0.28, legsTo: 0 }));
  // stainless side cladding at the counter
  for (const sz of [-1, 1]) {
    const clad = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.42, 0.05), deskTopMat);
    clad.position.set(-0.2, 0.24, 0.52 * sz);
    g.add(clad);
  }
  // scale display: green digit-ish emissive bars (abstract)
  const disp = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.14, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x101512, emissive: 0x2fae52, emissiveIntensity: 1.4 }),
  );
  disp.position.set(-0.9, 0.62, 0.56);
  disp.rotation.x = -0.35;
  g.add(disp);

  // flow chevron above the opening (shape-only guidance, points into the wall)
  const chev = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), M.chevron);
  chev.position.set(wallX - 0.14, 2.05, 0);
  chev.rotation.y = -Math.PI / 2;
  g.add(chev);

  // rubber strip curtain in the opening — crossing plane #1
  const curtain = stripCurtain(1.44, 1.06, { stripW: 0.11 });
  curtain.group.position.set(4.2, 0.42, 0);
  g.add(curtain.group);
  const sCurtain = journey.sAtWaypoint[2];

  const update = (st: FrameState) => {
    curtain.update(st.s - sCurtain);
  };

  return { group: g, range: [0, 0.3], update };
}
