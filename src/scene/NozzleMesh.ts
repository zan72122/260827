import * as THREE from 'three';
import type { NozzleSpec, Profile } from '../piping/NozzleProfile';
import { offsetProfile } from '../piping/NozzleProfile';
import { makeStainless } from '../render/MetalMaterial';
import { clamp, hash2, smoothstep } from '../util/math';

/**
 * A real pressed-metal piping tip: two lofted sheet surfaces a wall thickness
 * apart, joined by a genuinely thin rim at the opening and a rolled band at the
 * bag end. Origin sits at the centre of the opening, +Y runs up into the bag.
 */

interface Shell {
  positions: number[];
  indices: number[];
  uvs: number[];
}

function unitCirclePoints(p: Profile): Float32Array {
  const out = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const th = p.arc[i] * Math.PI * 2;
    out[i * 2] = Math.cos(th);
    out[i * 2 + 1] = Math.sin(th);
  }
  return out;
}

function meanRadius(p: Profile): number {
  let s = 0;
  for (let i = 0; i < p.count; i++) s += Math.hypot(p.pts[i * 2], p.pts[i * 2 + 1]);
  return s / p.count;
}

function shapeAt(
  p: Profile,
  circle: Float32Array,
  i: number,
  s: number,
  topR: number,
  meanR: number,
  seamBoost: number,
): [number, number] {
  const w = smoothstep(0.24, 1.0, s);
  const r = topR + (meanR - topR) * s;
  // rolled band at the bag end + a faint longitudinal weld seam
  const band = smoothstep(0.0, 0.06, s) * (1 - smoothstep(0.06, 0.16, s));
  const seam = Math.exp(-Math.pow((p.arc[i] - 0.5) * 46, 2)) * 0.00006;
  const rr = r + band * 0.00042 + seam + seamBoost;
  const ax = circle[i * 2] * rr;
  const ay = circle[i * 2 + 1] * rr;
  return [ax + (p.pts[i * 2] - ax) * w, ay + (p.pts[i * 2 + 1] - ay) * w];
}

function loft(
  p: Profile,
  topR: number,
  length: number,
  rings: number,
  seamBoost: number,
  flipWinding: boolean,
): Shell {
  const circle = unitCirclePoints(p);
  const meanR = meanRadius(p);
  const stride = p.count + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let k = 0; k < rings; k++) {
    const s = k / (rings - 1);
    const y = length * (1 - s);
    for (let i = 0; i <= p.count; i++) {
      const ii = i % p.count;
      const [x, z] = shapeAt(p, circle, ii, s, topR, meanR, seamBoost);
      positions.push(x, y, z);
      uvs.push(i === p.count ? 1 : p.arc[ii], s);
    }
  }
  for (let k = 0; k < rings - 1; k++) {
    for (let i = 0; i < p.count; i++) {
      const a = k * stride + i;
      const b = k * stride + i + 1;
      const c = (k + 1) * stride + i + 1;
      const d = (k + 1) * stride + i;
      if (flipWinding) indices.push(a, c, b, a, d, c);
      else indices.push(a, b, c, a, c, d);
    }
  }
  return { positions, indices, uvs };
}

function ringAt(p: Profile, topR: number, length: number, s: number, seamBoost: number) {
  const circle = unitCirclePoints(p);
  const meanR = meanRadius(p);
  const pts: number[] = [];
  for (let i = 0; i <= p.count; i++) {
    const ii = i % p.count;
    const [x, z] = shapeAt(p, circle, ii, s, topR, meanR, seamBoost);
    pts.push(x, length * (1 - s), z);
  }
  return pts;
}

function strip(inner: number[], outer: number[], count: number, flip: boolean): Shell {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const stride = count + 1;
  for (let i = 0; i <= count; i++) {
    positions.push(inner[i * 3], inner[i * 3 + 1], inner[i * 3 + 2]);
    uvs.push(i / count, 0);
  }
  for (let i = 0; i <= count; i++) {
    positions.push(outer[i * 3], outer[i * 3 + 1], outer[i * 3 + 2]);
    uvs.push(i / count, 1);
  }
  for (let i = 0; i < count; i++) {
    const a = i;
    const b = i + 1;
    const c = stride + i + 1;
    const d = stride + i;
    if (flip) indices.push(a, c, b, a, d, c);
    else indices.push(a, b, c, a, c, d);
  }
  return { positions, indices, uvs };
}

function toGeometry(sh: Shell): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(sh.positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(sh.uvs, 2));
  g.setIndex(sh.indices);
  g.computeVertexNormals();
  return g;
}

export interface NozzleObject {
  group: THREE.Group;
  /** local Y where the bag socket starts */
  socketY: number;
  spec: NozzleSpec;
  dispose(): void;
}

export function buildNozzle(spec: NozzleSpec, rings = 22): NozzleObject {
  const group = new THREE.Group();
  const inner = spec.opening;
  const outer = offsetProfile(spec.opening, spec.wall);

  const metal = makeStainless({ roughness: 0.27 });
  const innerMetal = makeStainless({ roughness: 0.34, color: 0xbfc3c6, drawn: 0.5 });
  innerMetal.side = THREE.BackSide;

  const outerGeo = toGeometry(loft(outer, spec.topRadius + spec.wall, spec.length, rings, 0, false));
  const innerGeo = toGeometry(loft(inner, spec.topRadius, spec.length, rings, 0, true));
  const outerMesh = new THREE.Mesh(outerGeo, metal);
  const innerMesh = new THREE.Mesh(innerGeo, innerMetal);
  outerMesh.castShadow = true;
  group.add(outerMesh, innerMesh);

  // the opening rim: real sheet thickness, sharp
  const rimIn = ringAt(inner, spec.topRadius, spec.length, 1, 0);
  const rimOut = ringAt(outer, spec.topRadius + spec.wall, spec.length, 1, 0);
  const rimGeo = toGeometry(strip(rimIn, rimOut, inner.count, true));
  const rim = new THREE.Mesh(rimGeo, makeStainless({ roughness: 0.16, color: 0xdadde0, drawn: 0.3 }));
  rim.castShadow = true;
  group.add(rim);

  // rolled edge at the bag end
  const topIn = ringAt(inner, spec.topRadius, spec.length, 0, 0);
  const topOut = ringAt(outer, spec.topRadius + spec.wall, spec.length, 0, 0);
  const topGeo = toGeometry(strip(topIn, topOut, inner.count, false));
  group.add(new THREE.Mesh(topGeo, makeStainless({ roughness: 0.38, drawn: 0.6 })));

  // thin cream residue clinging just above the rim
  const residue = buildResidue(inner, spec.length);
  group.add(residue);

  group.userData.nozzleId = spec.id;
  return {
    group,
    socketY: spec.length * 0.72,
    spec,
    dispose(): void {
      outerGeo.dispose();
      innerGeo.dispose();
      rimGeo.dispose();
      topGeo.dispose();
      metal.dispose();
      innerMetal.dispose();
    },
  };
}

/** A patchy, very thin film of cream left on the metal near the opening. */
function buildResidue(p: Profile, length: number): THREE.Mesh {
  const rings = 5;
  const stride = p.count + 1;
  const pos: number[] = [];
  const idx: number[] = [];
  const alpha: number[] = [];
  for (let k = 0; k < rings; k++) {
    const s = k / (rings - 1);
    const y = length * (0.0 + s * 0.09);
    for (let i = 0; i <= p.count; i++) {
      const ii = i % p.count;
      const patch = clamp(hash2(ii * 0.37, 3.1) * 1.5 - 0.35, 0, 1);
      const grow = 0.00013 * patch * (1 - s * 0.5);
      const px = p.pts[ii * 2];
      const pz = p.pts[ii * 2 + 1];
      const r = Math.hypot(px, pz) || 1;
      pos.push(px + (px / r) * grow, y + 0.00004, pz + (pz / r) * grow);
      alpha.push(patch * (1 - s) * 0.85);
    }
  }
  for (let k = 0; k < rings - 1; k++) {
    for (let i = 0; i < p.count; i++) {
      const a = k * stride + i;
      const b = k * stride + i + 1;
      const c = (k + 1) * stride + i + 1;
      const d = (k + 1) * stride + i;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alpha, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({
    color: 0xf6f0e6,
    roughness: 0.62,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vA;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvA = aAlpha;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vA;')
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\ngl_FragColor.a *= vA;',
      );
  };
  return new THREE.Mesh(g, m);
}
