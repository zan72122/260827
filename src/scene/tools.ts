import * as THREE from 'three';
import type { MaterialSet } from '../materials';
import { mergeGeometries } from '../cake/berry';

/**
 * Blade with real stock thickness: thin at the edge, full at the spine, ground
 * along its length. Never a zero-thickness card and never a uniformly round tip.
 */
function bladeGeometry(len: number, height: number, spine: number): THREE.BufferGeometry {
  const U = 44;
  const V = 30;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const H = (u: number) => {
    const t = Math.max(0, (u - 0.6) / 0.4);
    return height * (1 - t * t * 0.93) * (1 - Math.max(0, (0.06 - u) / 0.06) * 0.12);
  };
  const T = (h: number) => spine * (0.08 + 0.92 * Math.min(1, Math.pow(h, 0.55)));
  for (let i = 0; i <= U; i++) {
    const u = i / U;
    const hgt = H(u);
    for (let j = 0; j <= V; j++) {
      const v = j / V;
      let h: number;
      let z: number;
      if (v < 0.45) {
        h = v / 0.45;
        z = T(h) / 2;
      } else if (v < 0.55) {
        const phi = ((v - 0.45) / 0.1) * Math.PI;
        h = 1 + 0.05 * Math.sin(phi);
        z = (T(1) / 2) * Math.cos(phi);
      } else {
        h = (1 - v) / 0.45;
        z = -T(h) / 2;
      }
      pos.push(u * len, h * hgt, z);
      uv.push(u * 3.2, v);
    }
  }
  const cols = V + 1;
  for (let i = 0; i < U; i++) {
    for (let j = 0; j < V; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Heel cap.
  const base = pos.length / 3;
  pos.push(0, H(0) * 0.5, 0);
  uv.push(0, 0.5);
  for (let j = 0; j <= V; j++) {
    const p = j * 3;
    pos.push(pos[p], pos[p + 1], pos[p + 2]);
    uv.push(0, j / V);
  }
  for (let j = 0; j < V; j++) idx.push(base, base + 1 + j + 1, base + 1 + j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function handle(mats: MaterialSet, len: number, r: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r, len, 16, 1), mats.metalHandle);
  body.rotation.z = Math.PI / 2;
  body.position.x = -len / 2;
  body.castShadow = true;
  g.add(body);
  const capEnd = new THREE.Mesh(new THREE.SphereGeometry(r * 0.86, 14, 10), mats.metalHandle);
  capEnd.position.x = -len;
  g.add(capEnd);
  const bolster = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.06, r * 0.94, 0.7, 16), mats.metal);
  bolster.rotation.z = Math.PI / 2;
  bolster.position.x = -0.35;
  g.add(bolster);
  for (let i = 0; i < 3; i++) {
    const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, r * 1.75, 10), mats.metal);
    rivet.rotation.x = Math.PI / 2;
    rivet.position.set(-1.6 - i * 2.5, 0, 0);
    g.add(rivet);
  }
  return g;
}

/** Blade origin at the heel, edge along -Y, length along +X. */
export function buildKnife(mats: MaterialSet): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(bladeGeometry(22, 3.4, 0.18), mats.metal);
  blade.castShadow = true;
  g.add(blade);
  g.add(handle(mats, 10.5, 1.05));
  return g;
}

export function buildPaletteKnife(mats: MaterialSet): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(bladeGeometry(18, 2.1, 0.12), mats.metal);
  blade.castShadow = true;
  g.add(blade);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(1.02, 14, 8), mats.metal);
  tip.scale.set(0.35, 1, 0.11);
  tip.position.set(18, 1.05, 0);
  g.add(tip);
  g.add(handle(mats, 9, 0.95));
  return g;
}

/** Cake server: a stiff triangular plate with a stepped, cranked neck. */
export function buildServer(mats: MaterialSet): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(0, -1.5);
  s.lineTo(11.4, -3.35);
  s.quadraticCurveTo(13.4, 0, 11.4, 3.35);
  s.lineTo(0, 1.5);
  s.quadraticCurveTo(-0.7, 0, 0, -1.5);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.13,
    bevelEnabled: true,
    bevelSize: 0.07,
    bevelThickness: 0.05,
    bevelSegments: 2,
    curveSegments: 10,
  });
  geo.rotateX(-Math.PI / 2);
  const plate = new THREE.Mesh(geo, mats.metal);
  plate.castShadow = true;
  plate.receiveShadow = true;
  g.add(plate);

  const neck = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.22, 1.5), mats.metal);
  neck.position.set(-1.7, 0.85, 0);
  neck.rotation.z = 0.5;
  g.add(neck);
  const h = handle(mats, 10, 1.0);
  h.position.set(-3.1, 1.62, 0);
  g.add(h);
  return g;
}

export interface PipingBag {
  group: THREE.Group;
  /** World-space offset from the group origin to the nozzle opening. */
  nozzleTip: THREE.Vector3;
}

export function buildPipingBag(mats: MaterialSet): PipingBag {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0xf1eee7, roughness: 0.82, side: THREE.DoubleSide });
  const bagPts: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const r = 0.75 + Math.pow(t, 1.25) * 4.4;
    bagPts.push(new THREE.Vector2(r, t * 13));
  }
  bagPts.push(new THREE.Vector2(3.6, 15.4));
  bagPts.push(new THREE.Vector2(1.1, 16.4));
  const bag = new THREE.Mesh(new THREE.LatheGeometry(bagPts, 26), cloth);
  bag.castShadow = true;
  g.add(bag);

  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.46, 2.1, 18, 1, true), mats.metal);
  nozzle.position.y = -0.7;
  g.add(nozzle);
  // Star opening cut into the tip, so the piped rope is not a smooth tube.
  const star: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const tooth = new THREE.BoxGeometry(0.17, 0.5, 0.3);
    tooth.translate(Math.cos(a) * 0.4, -1.65, Math.sin(a) * 0.4);
    star.push(tooth);
  }
  const teeth = new THREE.Mesh(mergeGeometries(star), mats.metal);
  g.add(teeth);
  return { group: g, nozzleTip: new THREE.Vector3(0, -1.9, 0) };
}

/**
 * The shop's slicing guide. The child swipes; this stainless carriage carries
 * the blade, so no one is ever shown holding a knife by hand.
 */
export interface Guide {
  group: THREE.Group;
  boom: THREE.Group;
  carriage: THREE.Group;
  /** Telescoping stem that reaches down from the carriage to the blade. */
  stem: THREE.Mesh;
}

export function buildGuide(mats: MaterialSet): Guide {
  const group = new THREE.Group();
  const boom = new THREE.Group();
  const steel = mats.metal;

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.0, 18.5, 18), steel);
  post.position.set(0, 9.25, 0);
  post.castShadow = true;
  boom.add(post);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 3.4, 1.0, 22), steel);
  foot.position.y = 0.5;
  foot.castShadow = true;
  foot.receiveShadow = true;
  boom.add(foot);

  const arm = new THREE.Mesh(new THREE.BoxGeometry(30, 0.8, 1.3), steel);
  arm.position.set(-14.2, 18.2, 0);
  arm.castShadow = true;
  boom.add(arm);
  for (const dz of [0.62, -0.62]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 30, 10), steel);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(-14.2, 17.5, dz);
    boom.add(rail);
  }

  const carriage = new THREE.Group();
  const block = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.0, 2.6), steel);
  block.castShadow = true;
  carriage.add(block);
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 3.0, 12), steel);
  screw.rotation.x = Math.PI / 2;
  carriage.add(screw);
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.0, 1.0), steel);
  stem.geometry.translate(0, -0.5, 0);
  stem.position.y = -1.0;
  stem.castShadow = true;
  carriage.add(stem);
  carriage.position.set(-12, 17.5, 0);
  boom.add(carriage);

  group.add(boom);
  return { group, boom, carriage, stem };
}
