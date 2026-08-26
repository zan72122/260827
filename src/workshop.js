import * as THREE from 'three';
import {
  woodTexture, feltTexture, plasterTexture, concreteFloorTexture,
  dustPatchTexture, contactShadowTexture
} from './textures.js';

// Builds the static small glass workshop set.
// Layout (meters, y up):
//   cutting table centered at origin, felt top at y = TABLE_TOP
//   window in the left wall (x = -ROOM_X), warm daylight entering from there
//   glass rack + workbench along the back wall (z = -ROOM_Z)

export const TABLE_TOP = 0.92;
const ROOM_X = 2.7, ROOM_Z = 2.1, ROOM_H = 2.9;

export function buildWorkshop(scene, renderer) {
  const group = new THREE.Group();
  scene.add(group);

  const woodTex = woodTexture([116, 88, 60]);
  woodTex.repeat.set(2, 2);
  const woodDark = woodTexture([84, 62, 42], false);
  const felt = feltTexture();
  felt.repeat.set(3, 2);
  const plaster = plasterTexture();
  plaster.repeat.set(3, 2);
  const floorTex = concreteFloorTexture();
  floorTex.repeat.set(4, 4);

  const matWood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.85 });
  const matWoodDark = new THREE.MeshStandardMaterial({ map: woodDark, roughness: 0.9 });
  const matFelt = new THREE.MeshStandardMaterial({ map: felt, roughness: 1.0 });
  const matPlaster = new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.95 });
  const matFloor = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92 });
  const matSteel = new THREE.MeshStandardMaterial({ color: 0x8b8f94, metalness: 0.75, roughness: 0.45 });

  // floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_X * 2.4, ROOM_Z * 3.2), matFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // walls (back and left; the others stay behind the camera)
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_X * 2.4, ROOM_H), matPlaster);
  backWall.position.set(0, ROOM_H / 2, -ROOM_Z);
  backWall.receiveShadow = true;
  group.add(backWall);

  const leftWallMat = matPlaster.clone();
  const leftWall = new THREE.Group();
  // wall with a window opening: four plaster slabs around the hole
  const winC = { y: 1.72, z: -0.55, w: 1.35, h: 1.05 }; // window center/size on the left wall
  const slabs = [
    // [zCenter, yCenter, zSize, ySize]
    [(-ROOM_Z + (winC.z - winC.w / 2)) / 2, ROOM_H / 2, (winC.z - winC.w / 2) + ROOM_Z, ROOM_H],
    [(winC.z + winC.w / 2 + ROOM_Z * 1.2) / 2, ROOM_H / 2, ROOM_Z * 1.2 - (winC.z + winC.w / 2), ROOM_H],
    [winC.z, (winC.y + winC.h / 2 + ROOM_H) / 2, winC.w, ROOM_H - (winC.y + winC.h / 2)],
    [winC.z, (winC.y - winC.h / 2) / 2, winC.w, winC.y - winC.h / 2]
  ];
  for (const [zc, yc, zs, ys] of slabs) {
    if (zs <= 0.01 || ys <= 0.01) continue;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(zs, ys), leftWallMat);
    s.rotation.y = Math.PI / 2;
    s.position.set(-ROOM_X, yc, zc);
    s.receiveShadow = true;
    leftWall.add(s);
  }
  // window frame
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.7 });
  const fw = 0.055;
  for (const [dy, dz, sy, sz] of [
    [winC.h / 2, 0, fw, winC.w + fw], [-winC.h / 2, 0, fw, winC.w + fw],
    [0, winC.w / 2, winC.h + fw, fw], [0, -winC.w / 2, winC.h + fw, fw],
    [0, 0, winC.h + fw, fw * 0.6]
  ]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, sy, sz), frameMat);
    bar.position.set(-ROOM_X + 0.02, winC.y + dy, winC.z + dz);
    leftWall.add(bar);
  }
  // bright sky outside (the light source you can see)
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(winC.w * 1.6, winC.h * 1.6),
    new THREE.MeshBasicMaterial({ color: 0xfff4dc })
  );
  sky.rotation.y = Math.PI / 2;
  sky.position.set(-ROOM_X - 0.25, winC.y, winC.z);
  leftWall.add(sky);
  group.add(leftWall);

  // near/right walls so low camera angles never see out of the room
  const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_X * 2.4, ROOM_H), matPlaster);
  frontWall.position.set(0, ROOM_H / 2, ROOM_Z * 1.35);
  frontWall.rotation.y = Math.PI;
  group.add(frontWall);
  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_Z * 3.2, ROOM_H), matPlaster);
  rightWall.position.set(ROOM_X, ROOM_H / 2, 0);
  rightWall.rotation.y = -Math.PI / 2;
  group.add(rightWall);

  // ---- cutting table: heavy wood frame, padded felt top with a soft edge pad
  const table = new THREE.Group();
  const topW = 1.5, topD = 1.05, topT = 0.055;
  const top = new THREE.Mesh(new THREE.BoxGeometry(topW, topT, topD), matWood);
  top.position.y = TABLE_TOP - topT / 2 - 0.012;
  top.castShadow = true; top.receiveShadow = true;
  table.add(top);
  const feltPad = new THREE.Mesh(new THREE.BoxGeometry(topW - 0.05, 0.012, topD - 0.05), matFelt);
  feltPad.position.y = TABLE_TOP - 0.006;
  feltPad.receiveShadow = true;
  table.add(feltPad);
  // rounded pad strip around the rim (protects edges when tilting panes)
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x3a4440, roughness: 1 });
  for (const [x, z, sx, sz] of [
    [0, topD / 2 - 0.02, topW, 0.045], [0, -topD / 2 + 0.02, topW, 0.045],
    [topW / 2 - 0.02, 0, 0.045, topD], [-topW / 2 + 0.02, 0, 0.045, topD]
  ]) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.018, sz), rimMat);
    rim.position.set(x, TABLE_TOP - 0.002, z);
    table.add(rim);
  }
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, TABLE_TOP - topT, 0.09), matWoodDark);
    leg.position.set(lx * (topW / 2 - 0.1), (TABLE_TOP - topT) / 2, lz * (topD / 2 - 0.1));
    leg.castShadow = true;
    table.add(leg);
  }
  // lower shelf with a folded cloth and an oil bottle
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(topW - 0.24, 0.03, topD - 0.3), matWoodDark);
  shelf.position.y = 0.32;
  table.add(shelf);
  const cloth = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.05, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x7a8aa0, roughness: 1 })
  );
  cloth.position.set(-0.3, 0.36, 0.1);
  table.add(cloth);
  const oil = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.04, 0.14, 12),
    new THREE.MeshStandardMaterial({ color: 0xd8b23a, roughness: 0.4, metalness: 0.1 })
  );
  oil.position.set(0.25, 0.41, -0.05);
  table.add(oil);
  group.add(table);

  // ---- glass rack (A-frame) with leaning panes, lightweight opaque stand-ins
  const rack = new THREE.Group();
  rack.position.set(0.95, 0, -ROOM_Z + 0.42);
  const railGeo = new THREE.BoxGeometry(1.5, 0.07, 0.09);
  const baseRail = new THREE.Mesh(railGeo, matWoodDark);
  baseRail.position.y = 0.035;
  baseRail.castShadow = true;
  rack.add(baseRail);
  const backRail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.07), matWoodDark);
  backRail.position.set(0, 1.32, -0.3);
  rack.add(backRail);
  for (const px of [-0.65, 0, 0.65]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.5, 0.07), matWoodDark);
    post.position.set(px, 0.75, -0.34);
    post.rotation.x = -0.2;
    post.castShadow = true;
    rack.add(post);
  }
  // stacked panes: viewed edge-on stacked glass reads deep green and almost
  // opaque, so cheap non-transmissive materials keep overdraw low.
  const paneGeo = new THREE.BoxGeometry(1.1, 1.15, 0.006);
  const paneMat = new THREE.MeshStandardMaterial({
    color: 0xbcd6c8, metalness: 0.05, roughness: 0.12,
    envMapIntensity: 1.0, transparent: false
  });
  const paneEdgeMat = new THREE.MeshStandardMaterial({ color: 0x35584a, roughness: 0.35 });
  const paneMats = [paneEdgeMat, paneEdgeMat, paneEdgeMat, paneEdgeMat, paneMat, paneMat];
  const panes = new THREE.InstancedMesh(paneGeo, paneMats, 7);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 7; i++) {
    const e = new THREE.Euler(-0.2 - i * 0.008, 0, 0);
    const q = new THREE.Quaternion().setFromEuler(e);
    m4.compose(
      new THREE.Vector3(-0.45 + i * 0.16 + (i % 3) * 0.01, 0.62, -0.02 - i * 0.028),
      q, new THREE.Vector3(1, 1, 1)
    );
    panes.setMatrixAt(i, m4);
  }
  panes.castShadow = true;
  rack.add(panes);
  group.add(rack);

  // ---- workbench along the back wall with used tools + spare PPE
  const bench = new THREE.Group();
  bench.position.set(-1.45, 0, -ROOM_Z + 0.36);
  const benchTop = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.55), matWood);
  benchTop.position.y = 0.86;
  benchTop.castShadow = true; benchTop.receiveShadow = true;
  bench.add(benchTop);
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.83, 0.07), matWoodDark);
    leg.position.set(lx * 0.58, 0.415, lz * 0.2);
    bench.add(leg);
  }
  // straightedge
  const rule = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.008, 0.05), matSteel);
  rule.position.set(-0.1, 0.9, -0.05);
  rule.rotation.y = 0.3;
  bench.add(rule);
  // spare cut-resistant gloves (pair, flat)
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0x9aa4ab, roughness: 0.95 });
  for (const dx of [0.22, 0.34]) {
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.2), gloveMat);
    glove.position.set(dx, 0.9, 0.08);
    glove.rotation.y = dx * 2;
    bench.add(glove);
  }
  // safety glasses resting on the bench
  const specs = new THREE.Group();
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: 0xdfe8ea, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.5
  });
  const lens = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.035, 0.008), lensMat);
  specs.add(lens);
  const arm1 = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.12), matSteel);
  arm1.position.set(-0.06, 0, 0.06);
  specs.add(arm1);
  const arm2 = arm1.clone(); arm2.position.x = 0.06;
  specs.add(arm2);
  specs.position.set(0.45, 0.9, -0.12);
  specs.rotation.y = -0.5;
  bench.add(specs);
  group.add(bench);

  // dust / fine cullet patches on the floor, local and asymmetric
  const dustTex = dustPatchTexture();
  const dustMat = new THREE.MeshBasicMaterial({
    map: dustTex, transparent: true, depthWrite: false, opacity: 0.8
  });
  for (const [x, z, s, r] of [[0.9, -1.25, 0.5, 0.4], [1.35, -1.05, 0.32, 2.1], [-1.5, -1.3, 0.38, 1.2]]) {
    const dust = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 0.8), dustMat);
    dust.rotation.x = -Math.PI / 2;
    dust.rotation.z = r;
    dust.position.set(x, 0.002, z);
    dust.renderOrder = 1;
    group.add(dust);
  }

  // ---- lighting
  const hemi = new THREE.HemisphereLight(0xf5ead8, 0x4d453b, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
  sun.position.set(-2.4, 2.35, -0.5); // in through the window
  sun.target.position.set(0.35, TABLE_TOP, 0.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 8;
  sun.shadow.camera.left = -1.8; sun.shadow.camera.right = 1.8;
  sun.shadow.camera.top = 1.8; sun.shadow.camera.bottom = -1.8;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0xdfe6ef, 0.5);
  fill.position.set(1.8, 2.2, 1.6);
  scene.add(fill);

  // contact shadow under the sheet position (soft, baked blob)
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.55
    })
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(0, TABLE_TOP + 0.0008, 0);
  contact.renderOrder = 2;
  group.add(contact);

  return { group, sun, hemi, contactShadow: contact, windowCenter: new THREE.Vector3(-ROOM_X, winC.y, winC.z) };
}
