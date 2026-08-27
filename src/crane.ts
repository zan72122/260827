import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { wornPaintTexture } from './textures';

/**
 * Crawler crane assembled from primitives with plausible proportions:
 * tracks, slew ring, machine deck with counterweight, guarded operator cab,
 * lattice boom to the pivot sheave, and pendant lines. Paint wear sits where
 * the machine actually wears: track surrounds, deck access edges, boom foot
 * and sheave — and the pattern is not mirrored left/right.
 */
export function buildCrane(pivot: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();

  const paintTex = wornPaintTexture('#c98f27', [
    { u: 0.15, v: 0.85, r: 0.16 }, // near tracks, left access
    { u: 0.78, v: 0.9, r: 0.12 },
    { u: 0.5, v: 0.16, r: 0.1 }, // boom foot area
    { u: 0.32, v: 0.5, r: 0.08 },
  ]);
  const paint = new THREE.MeshStandardMaterial({ map: paintTex, roughness: 0.72, metalness: 0.18 });
  const paintDark = new THREE.MeshStandardMaterial({
    map: wornPaintTexture('#b3801f', [
      { u: 0.6, v: 0.75, r: 0.2 },
      { u: 0.2, v: 0.3, r: 0.1 },
    ]),
    roughness: 0.78,
    metalness: 0.15,
  });
  const dark = new THREE.MeshStandardMaterial({ color: '#3a3a3c', roughness: 0.9, metalness: 0.2 });
  const steel = new THREE.MeshStandardMaterial({ color: '#7c7d80', roughness: 0.55, metalness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: '#20262c', roughness: 0.25, metalness: 0.4 });

  // machine base position: well left of the wall so the shot stays clear
  const baseX = pivot.x - 7.2;
  const baseZ = pivot.z - 4.6;
  // horizontal direction from machine toward the pivot
  const hd = new THREE.Vector3(pivot.x - baseX, 0, pivot.z - baseZ).normalize();
  const yaw = Math.atan2(hd.z, hd.x);

  const body = new THREE.Group();
  body.position.set(baseX, 0, baseZ);
  body.rotation.y = -yaw;

  // crawler tracks
  for (const side of [-1, 1]) {
    const track = new THREE.Group();
    track.position.set(0, 0.55, side * 1.5);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.1, 0.95), dark);
    shoe.castShadow = true;
    shoe.receiveShadow = true;
    track.add(shoe);
    // drive sprockets hinted at each end
    for (const e of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 1.0, 14), steel);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(e * 2.35, 0, 0);
      track.add(wheel);
    }
    // grousers
    const grousers: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const b = new THREE.BoxGeometry(0.16, 1.16, 1.0);
      b.translate(-2.1 + i * 0.52, 0, 0);
      grousers.push(b);
    }
    const gr = new THREE.Mesh(mergeGeometries(grousers)!, dark);
    track.add(gr);
    body.add(track);
  }

  // car body + slew ring
  const car = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 2.6), paintDark);
  car.position.y = 1.15;
  car.castShadow = true;
  body.add(car);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.35, 20), steel);
  ring.position.y = 1.65;
  body.add(ring);

  // slewing upper works
  const upper = new THREE.Group();
  upper.position.y = 1.85;
  body.add(upper);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.5, 2.4), paint);
  deck.position.set(-0.4, 0.25, 0);
  deck.castShadow = true;
  upper.add(deck);

  // machinery house
  const house = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.15, 2.2), paint);
  house.position.set(-1.2, 1.05, 0);
  house.castShadow = true;
  upper.add(house);
  // exhaust
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8), dark);
  pipe.position.set(-1.9, 1.9, 0.5);
  upper.add(pipe);

  // counterweight: stacked slabs, concrete-and-steel
  const cwMat = new THREE.MeshStandardMaterial({ color: '#6f6b64', roughness: 0.95 });
  for (let i = 0; i < 3; i++) {
    const cw = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.55, 2.0 - i * 0.12), i === 1 ? paintDark : cwMat);
    cw.position.set(-2.75, 0.8 + i * 0.56, 0);
    cw.castShadow = true;
    upper.add(cw);
  }

  // guarded operator cab, offset to the right side; the only place a person is
  const cab = new THREE.Group();
  cab.position.set(0.75, 0.95, 1.05);
  const cabBox = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.25, 0.95), paint);
  cabBox.castShadow = true;
  cab.add(cabBox);
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 0.7), glass);
  windshield.position.set(0.58, 0.08, 0);
  cab.add(windshield);
  // FOPS guard bars over the glass
  for (let i = 0; i < 4; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.035), steel);
    bar.position.set(0.63, 0.06, -0.26 + i * 0.17);
    cab.add(bar);
  }
  // operator: helmet + torso silhouette behind the guarded glass
  const opMat = new THREE.MeshStandardMaterial({ color: '#2e3f52', roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.42, 8), opMat);
  torso.position.set(0.18, -0.1, 0);
  cab.add(torso);
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 8),
    new THREE.MeshStandardMaterial({ color: '#e8d24a', roughness: 0.5 })
  );
  helmet.position.set(0.18, 0.22, 0);
  cab.add(helmet);
  upper.add(cab);

  // lattice boom from foot to pivot sheave
  const foot = new THREE.Vector3(baseX + hd.x * 1.3, 2.7, baseZ + hd.z * 1.3);
  const tip = pivot.clone();
  const boomVec = tip.clone().sub(foot);
  const boomLen = boomVec.length();
  const boom = new THREE.Group();
  boom.position.copy(foot);
  boom.lookAt(tip);

  const chordMat = new THREE.MeshStandardMaterial({
    map: wornPaintTexture('#c98f27', [
      { u: 0.5, v: 0.05, r: 0.14 },
      { u: 0.45, v: 0.95, r: 0.12 },
      { u: 0.7, v: 0.4, r: 0.06 },
    ]),
    roughness: 0.7,
    metalness: 0.2,
  });
  const half = 0.34;
  const lattice: THREE.BufferGeometry[] = [];
  // 4 chords along +z (lookAt aims +z at target)
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const c = new THREE.CylinderGeometry(0.055, 0.055, boomLen, 7);
      c.rotateX(Math.PI / 2);
      c.translate(sx * half, sy * half, boomLen / 2);
      lattice.push(c);
    }
  }
  // zig-zag lacing
  const segN = Math.floor(boomLen / 0.85);
  const segL = boomLen / segN;
  for (let i = 0; i < segN; i++) {
    const z0 = i * segL;
    for (const face of [0, 1, 2, 3]) {
      const diag = new THREE.CylinderGeometry(0.028, 0.028, Math.hypot(segL, half * 2), 5);
      diag.rotateX(Math.PI / 2);
      const even = i % 2 === 0;
      const m = new THREE.Matrix4();
      const from = new THREE.Vector3();
      const to = new THREE.Vector3();
      if (face === 0) {
        from.set(even ? -half : half, half, z0);
        to.set(even ? half : -half, half, z0 + segL);
      } else if (face === 1) {
        from.set(even ? half : -half, -half, z0);
        to.set(even ? -half : half, -half, z0 + segL);
      } else if (face === 2) {
        from.set(half, even ? -half : half, z0);
        to.set(half, even ? half : -half, z0 + segL);
      } else {
        from.set(-half, even ? half : -half, z0);
        to.set(-half, even ? -half : half, z0 + segL);
      }
      const mid = from.clone().add(to).multiplyScalar(0.5);
      const dirv = to.clone().sub(from).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dirv);
      m.compose(mid, quat, new THREE.Vector3(1, 1, 1));
      const dg = diag.clone();
      dg.applyMatrix4(m);
      lattice.push(dg);
    }
  }
  const latticeMesh = new THREE.Mesh(mergeGeometries(lattice)!, chordMat);
  latticeMesh.castShadow = true;
  boom.add(latticeMesh);

  // sheave block at the tip
  const sheave = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 14), steel);
  sheave.rotation.z = Math.PI / 2;
  sheave.position.set(0, 0, boomLen);
  boom.add(sheave);
  g.add(boom);

  // pendant lines from boom tip back to the gantry
  const gantryTop = new THREE.Vector3(baseX - hd.x * 2.3, 4.2, baseZ - hd.z * 2.3);
  const gantry = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.4, 1.4), paintDark);
  gantry.position.set(gantryTop.x, 3.0, gantryTop.z);
  gantry.rotation.y = -yaw;
  gantry.castShadow = true;
  g.add(gantry);
  const pendMat = new THREE.MeshStandardMaterial({ color: '#4c4c50', roughness: 0.6, metalness: 0.5 });
  for (const off of [-0.3, 0.3]) {
    const a = tip.clone().add(new THREE.Vector3(0, -0.1, 0));
    const b = gantryTop.clone().add(new THREE.Vector3(0, 0, off));
    const len = a.distanceTo(b);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len, 5), pendMat);
    rod.position.copy(a).add(b).multiplyScalar(0.5);
    rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.add(rod);
  }

  g.add(body);
  return g;
}
