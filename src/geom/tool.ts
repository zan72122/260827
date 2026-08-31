import * as THREE from 'three';
import type { Materials } from '../scene/materials';

/**
 * The chisel, as real geometry.
 *
 * Local frame: the cutting edge is at the origin, the tool runs along +Z
 * towards the handle, the blade's width is along X, and its FLAT BACK faces
 * -Y. The back is the reference face: it rides on the wood, which is what
 * holds the cut to one depth. A single bevel is ground on the +Y side.
 */

interface Section { z: number; hw: number; y0: number; y1: number }

/** flat-shaded sweep of a rectangular section: gives real arrises, no rounding */
function sweepRect(sections: Section[], capFront: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const P = (s: Section, k: number): [number, number, number] => {
    switch (k) {
      case 0: return [-s.hw, s.y1, s.z];
      case 1: return [s.hw, s.y1, s.z];
      case 2: return [s.hw, s.y0, s.z];
      default: return [-s.hw, s.y0, s.z];
    }
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], u0: number, u1: number) => {
    const n = new THREE.Vector3().subVectors(new THREE.Vector3(...(b as [number, number, number])), new THREE.Vector3(...(a as [number, number, number])))
      .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...(d as [number, number, number])), new THREE.Vector3(...(a as [number, number, number])))).normalize();
    const push = (p: number[], uu: number, vv: number) => { pos.push(p[0], p[1], p[2]); nor.push(n.x, n.y, n.z); uv.push(uu, vv); };
    push(a, u0, 0); push(b, u0, 1); push(c, u1, 1);
    push(a, u0, 0); push(c, u1, 1); push(d, u1, 0);
  };
  for (let i = 0; i < sections.length - 1; i++) {
    const s = sections[i], t = sections[i + 1];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      // side quad: s[k] -> s[k2] -> t[k2] -> t[k]
      quad(P(s, k2), P(s, k), P(t, k), P(t, k2), s.z, t.z);
    }
  }
  if (capFront) {
    const s = sections[0];
    quad(P(s, 0), P(s, 1), P(s, 2), P(s, 3), 0, 0.02);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export interface Chisel {
  group: THREE.Group;
  /** distance from the edge, along +Z, of the point the finger holds */
  gripZ: number;
  length: number;
  dispose(): void;
}

export function makeChisel(mat: Materials, bladeWidth: number): Chisel {
  const group = new THREE.Group();
  const hw = bladeWidth * 0.5 + 0.007;
  const th = 0.012;                 // blade stock thickness
  const backY = -th * 0.5;
  const edgeLand = 0.0005;          // the tiny flat left by honing
  const bevel = 0.026;              // bevel land, ~20 deg

  const blade = sweepRect([
    { z: 0.000, hw, y0: backY, y1: backY + edgeLand },
    { z: bevel, hw, y0: backY, y1: backY + th },
    { z: 0.092, hw, y0: backY, y1: backY + th },
    { z: 0.108, hw: hw * 0.70, y0: backY, y1: backY + th },
    { z: 0.128, hw: 0.016, y0: -0.016, y1: 0.016 },
  ], true);
  const bladeMesh = new THREE.Mesh(blade, mat.blade);
  bladeMesh.castShadow = true;
  group.add(bladeMesh);

  const tang = sweepRect([
    { z: 0.128, hw: 0.016, y0: -0.016, y1: 0.016 },
    { z: 0.156, hw: 0.013, y0: -0.013, y1: 0.013 },
  ], false);
  const tangMesh = new THREE.Mesh(tang, mat.steel);
  tangMesh.castShadow = true;
  group.add(tangMesh);

  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.037, 0.040, 24, 1, true), mat.brass);
  ferrule.rotation.x = Math.PI / 2;
  ferrule.position.z = 0.156 + 0.020;
  ferrule.castShadow = true;
  group.add(ferrule);

  // turned handle: a real lathe profile with a swell to fill a small hand
  const prof: THREE.Vector2[] = [];
  const pts: [number, number][] = [
    [0.0000, 0.176], [0.0340, 0.176], [0.0372, 0.192], [0.0470, 0.234],
    [0.0562, 0.290], [0.0604, 0.352], [0.0596, 0.418], [0.0546, 0.478],
    [0.0480, 0.530], [0.0400, 0.568], [0.0276, 0.596], [0.0110, 0.614], [0.0000, 0.618],
  ];
  for (const [r, z] of pts) prof.push(new THREE.Vector2(Math.max(r, 0.0001), z));
  const handleGeo = new THREE.LatheGeometry(prof, 28);
  handleGeo.rotateX(Math.PI / 2);
  const handle = new THREE.Mesh(handleGeo, mat.handle);
  handle.castShadow = true;
  group.add(handle);

  return {
    group,
    gripZ: 0.34,
    length: 0.618,
    dispose() { blade.dispose(); tang.dispose(); handleGeo.dispose(); (ferrule.geometry as THREE.BufferGeometry).dispose(); },
  };
}
