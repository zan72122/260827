import * as THREE from 'three';
import { Rng, fbm2 } from '../util/math';
import { ROOM } from './layout';

const GROUND = 0.30;

/* ------------------------------------------------------------------ *
 * The village beyond the glass.  Real geometry at real distance so the
 * window has depth, held apart from the room by aerial perspective (scene
 * fog) rather than by blurring it into mush.
 * ------------------------------------------------------------------ */

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.00, '#0d1830');
  g.addColorStop(0.34, '#1b2b4a');
  g.addColorStop(0.62, '#3a4664');
  g.addColorStop(0.82, '#6d6274');
  g.addColorStop(0.93, '#9c7d70');
  g.addColorStop(1.00, '#b08b6e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function snowTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const n = fbm2(x / S * 7, y / S * 7, 4, 202);
      const v = 150 + n * 70;
      const i = (y * S + x) * 4;
      img.data[i] = v * 0.92; img.data[i + 1] = v * 0.96; img.data[i + 2] = v * 1.05;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(9, 9);
  return t;
}

export class Outside {
  readonly group = new THREE.Group();
  readonly snowBox: THREE.Box3;
  private windowMat: THREE.MeshBasicMaterial;

  constructor() {
    const rng = new Rng(1224);
    const g = this.group;

    /* ---- sky ---- */
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 34),
      new THREE.MeshBasicMaterial({ map: skyTexture(), fog: false, depthWrite: false }),
    );
    sky.position.set(0, 7, -30);
    sky.renderOrder = -10;
    g.add(sky);

    /* ---- snow ground with drifts ---- */
    const groundGeo = new THREE.PlaneGeometry(80, 44, 48, 26);
    const pos = groundGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      // drifts, plus a bank that rises toward the shop wall
      const bank = Math.max(0, 1 - Math.abs(y + 4) / 7) * 0.5;
      pos.setZ(i, (fbm2(x * 0.08, y * 0.08, 3, 17) - 0.5) * 1.15 + bank);
    }
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({
      map: snowTexture(), roughness: 0.92, metalness: 0, color: 0xa9bacf,
    }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, GROUND, -16);
    g.add(ground);

    /* ---- houses ---- */


    const houseWall = new THREE.MeshStandardMaterial({ color: 0x4a3d38, roughness: 0.95 });
    const houseRoof = new THREE.MeshStandardMaterial({ color: 0xa8b6c8, roughness: 0.88 });
    const trunk = new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 1 });
    const foliage = new THREE.MeshStandardMaterial({ color: 0x23362f, roughness: 1 });
    this.windowMat = new THREE.MeshBasicMaterial({ color: 0xffb35c, fog: true });

    const roofShape = new THREE.Shape();
    roofShape.moveTo(-0.62, 0); roofShape.lineTo(0.62, 0); roofShape.lineTo(0, 0.46);
    roofShape.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 1, bevelEnabled: false });
    roofGeo.translate(0, 0, -0.5);

    const litWindows: THREE.Matrix4[] = [];
    const mtx = new THREE.Matrix4();
    const houses: [number, number, number][] = [
      [-4.9, -8.6, 1.25], [-1.1, -12.4, 1.05], [3.9, -9.8, 1.35],
      [8.4, -13.4, 1.1], [-9.2, -14.6, 0.95], [1.0, -18.0, 0.85],
      [12.6, -19.5, 0.9], [-14.5, -21.0, 0.8],
    ];
    for (const [hx, hz, s] of houses) {
      const wallH = 2.15 * s;
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.0 * s, wallH, 1.7 * s), houseWall);
      body.position.set(hx, GROUND + wallH / 2, hz);
      const rot = rng.range(-0.35, 0.35);
      body.rotation.y = rot;
      g.add(body);
      const roof = new THREE.Mesh(roofGeo, houseRoof);
      roof.scale.set(1.75 * s, 1.6 * s, 1.75 * s);
      roof.position.set(hx, GROUND + wallH, hz);
      roof.rotation.y = rot;
      g.add(roof);
      // one or two warm windows, always on the face turned toward us
      const count = rng.int(1, 2);
      for (let i = 0; i < count; i++) {
        const ox = (i - (count - 1) / 2) * 0.34 * s;
        const local = new THREE.Vector3(ox * 2.4, GROUND + wallH * 0.56, 0.86 * s + 0.006);
        local.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
        mtx.makeRotationY(rot);
        mtx.setPosition(hx + local.x, local.y, hz + local.z);
        mtx.scale(new THREE.Vector3(0.42 * s, 0.52 * s, 1));
        litWindows.push(mtx.clone());
      }
    }
    const winMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1), this.windowMat, litWindows.length);
    litWindows.forEach((m4, i) => winMesh.setMatrixAt(i, m4));
    winMesh.instanceMatrix.needsUpdate = true;
    g.add(winMesh);

    /* ---- trees ---- */
    const treeGeo = new THREE.ConeGeometry(0.5, 1.9, 7);
    const trunkGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.4, 5);
    const treeCount = 22;
    const trees = new THREE.InstancedMesh(treeGeo, foliage, treeCount);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunk, treeCount);
    for (let i = 0; i < treeCount; i++) {
      const tx = rng.range(-24, 24);
      const tz = rng.range(-24, -6.5);
      const s = rng.range(1.0, 2.2);
      mtx.makeTranslation(tx, GROUND + 0.2 + 0.95 * s, tz);
      mtx.scale(new THREE.Vector3(s, s, s));
      trees.setMatrixAt(i, mtx);
      mtx.makeTranslation(tx, GROUND + 0.2 * s, tz);
      mtx.scale(new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(i, mtx);
    }
    trees.instanceMatrix.needsUpdate = true;
    trunks.instanceMatrix.needsUpdate = true;
    g.add(trees, trunks);

    /* ---- a fence just outside the glass, to anchor the near distance ---- */
    const postGeo = new THREE.BoxGeometry(0.08, 0.82, 0.08);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x53443a, roughness: 1 });
    const posts = new THREE.InstancedMesh(postGeo, postMat, 12);
    for (let i = 0; i < 12; i++) {
      mtx.makeRotationY(rng.range(-0.08, 0.08));
      mtx.setPosition(-3.2 + i * 0.62, GROUND + 0.40 + rng.range(-0.04, 0.04), -3.4);
      posts.setMatrixAt(i, mtx);
    }
    posts.instanceMatrix.needsUpdate = true;
    g.add(posts);
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(7.0, 0.05, 0.04),
      postMat,
    );
    rail.position.set(0.2, GROUND + 0.60, -3.4);
    g.add(rail);

    this.snowBox = new THREE.Box3(
      new THREE.Vector3(-16, GROUND, -22),
      new THREE.Vector3(16, 9.0, -2.6),
    );

    g.position.z = ROOM.backZ - 0.9;
  }

  /** The village lamps warm up as the sky drops toward night. */
  setEvening(t: number) {
    this.windowMat.color.setRGB(1.0 * (0.5 + t * 0.6), 0.62 * (0.5 + t * 0.55), 0.3 * (0.5 + t * 0.4));
  }
}
