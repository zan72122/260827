import { BufferAttribute, BufferGeometry, Float32BufferAttribute } from 'three';
import type { Rng } from '../core/Rng';
import { clamp, lerp } from '../core/math';

/**
 * Trunk shell: a swept tube with a non-linear taper, a slight natural sweep and
 * per-ring irregularity, so the stem never reads as a lathe-perfect cone.
 * UVs run around the trunk in u and along it in v, matching the bark bake.
 */
export const buildTrunkGeometry = (
  height: number,
  buttRadius: number,
  tipRadius: number,
  rings: number,
  radialSegments: number,
  rng: Rng,
): BufferGeometry => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Sweep: the stem leans a few centimetres out of plumb over its length,
  // the way a felled forest-grown conifer actually does.
  const sweepA = rng.range(-0.16, 0.16);
  const sweepB = rng.range(-0.1, 0.1);
  const bulge: number[] = [];
  for (let i = 0; i <= rings; i++) bulge.push(rng.range(-0.012, 0.02));

  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const y = t * height;
    const taper = Math.pow(1 - t, 1.25);
    const r = Math.max(tipRadius, lerp(tipRadius, buttRadius, taper) + bulge[i] * (1 - t));
    const cx = sweepA * t * t + sweepB * Math.sin(t * Math.PI * 1.6) * 0.5;
    const cz = sweepB * t * t * 0.6;
    for (let s = 0; s <= radialSegments; s++) {
      const a = (s / radialSegments) * Math.PI * 2;
      const lobe = 1 + Math.sin(a * 3 + t * 5) * 0.028 + Math.sin(a * 7 - t * 3) * 0.014;
      const rr = r * lobe;
      const x = Math.cos(a) * rr + cx;
      const z = Math.sin(a) * rr + cz;
      positions.push(x, y, z);
      normals.push(Math.cos(a), 0.12, Math.sin(a));
      uvs.push(s / radialSegments, t * height * 0.22);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let s = 0; s < radialSegments; s++) {
      const a = i * (radialSegments + 1) + s;
      const b = a + radialSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
};

/**
 * Unit limb: a tapered tube along +X of length 1, radius 1 at the root and
 * `tipScale` at the far end. Instances scale it to the branch they represent.
 */
export const buildLimbGeometry = (segments: number, radialSegments: number, tipScale: number): BufferGeometry => {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const r = lerp(1, tipScale, Math.pow(t, 0.8));
    // Limbs sag slightly under their own needle load.
    const sag = -Math.pow(t, 1.8) * 0.09;
    for (let s = 0; s <= radialSegments; s++) {
      const a = (s / radialSegments) * Math.PI * 2;
      positions.push(t, Math.sin(a) * r + sag, Math.cos(a) * r);
      uvs.push(s / radialSegments, t);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let s = 0; s < radialSegments; s++) {
      const a = i * (radialSegments + 1) + s;
      const b = a + radialSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
};

/**
 * One needle sprig: a short shoot carrying flat needle blades in a spiral.
 * Solid geometry rather than alpha cards — cut-outs are what give AI-looking
 * foliage its glowing fringe, and at this scale the blades are cheap.
 */
export const buildSprigGeometry = (blades: number, rng: Rng): BufferGeometry => {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let vi = 0;
  const shootLength = 1;
  for (let i = 0; i < blades; i++) {
    const t = (i + 0.5) / blades;
    const spiral = i * 2.39996 + rng.jitter(0.3);
    const x = t * shootLength;
    // Needles sweep forward along the shoot and outward from it.
    const out = 0.46 + rng.range(-0.06, 0.12);
    const fwd = 0.34 + t * 0.26;
    const dy = Math.sin(spiral);
    const dz = Math.cos(spiral);
    const w = 0.05;
    const px = x;
    const tipX = x + fwd;
    const tipY = dy * out;
    const tipZ = dz * out;
    // Quad: two root corners offset across the needle, one narrow tip.
    positions.push(px, dy * 0.03 - dz * w, dz * 0.03 + dy * w);
    positions.push(px, dy * 0.03 + dz * w, dz * 0.03 - dy * w);
    positions.push(tipX, tipY, tipZ);
    positions.push(tipX * 0.99, tipY * 0.98, tipZ * 0.98);
    const shade = 0.78 + rng.range(0, 0.38) + t * 0.12;
    const tint = rng.range(-0.05, 0.05);
    for (let k = 0; k < 4; k++) {
      colors.push(clamp(shade * (1 + tint), 0, 1.6), clamp(shade, 0, 1.6), clamp(shade * (0.92 - tint), 0, 1.6));
    }
    indices.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
    vi += 4;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const norm = geo.getAttribute('normal') as BufferAttribute;
  geo.setAttribute('normal', norm);
  return geo;
};
