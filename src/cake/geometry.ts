import * as THREE from 'three';

export interface SectorSpec {
  rInner?: number;
  rOuter: number;
  y0: number;
  y1: number;
  a0: number;
  a1: number;
  arcSeg?: number;
  /** Texture tiles measured in centimetres. */
  uvScale?: number;
  radialSeg?: number;
  /** Real relief carved into the cut faces: open crumb, not just a normal map. */
  capRelief?: {
    seg: [number, number];
    depth: (r: number, y: number) => number;
  };
}

export interface SectorParts {
  outer?: THREE.BufferGeometry;
  inner?: THREE.BufferGeometry;
  top?: THREE.BufferGeometry;
  bottom?: THREE.BufferGeometry;
  capStart?: THREE.BufferGeometry;
  capEnd?: THREE.BufferGeometry;
}

function makeGeometry(pos: number[], nor: number[], uv: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * Builds the individual surfaces of an angular slab of the cake. Each surface is
 * returned on its own so that a cut face can carry a different material from a
 * baked face — a crumb structure is not a crust.
 */
export function buildSector(spec: SectorSpec, want: (keyof SectorParts)[]): SectorParts {
  const rIn = spec.rInner ?? 0;
  const rOut = spec.rOuter;
  const { y0, y1, a0, a1 } = spec;
  const uvS = spec.uvScale ?? 6;
  const full = a1 - a0 >= Math.PI * 2 - 1e-6;
  const arcSeg = spec.arcSeg ?? Math.max(6, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 96));
  const radSeg = spec.radialSeg ?? 4;
  const out: SectorParts = {};
  const ang = (i: number) => a0 + ((a1 - a0) * i) / arcSeg;

  if (want.includes('outer')) {
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
    const rows = 2;
    for (let j = 0; j < rows; j++) {
      const y = j === 0 ? y0 : y1;
      for (let i = 0; i <= arcSeg; i++) {
        const a = ang(i);
        const c = Math.cos(a), s = Math.sin(a);
        pos.push(c * rOut, y, s * rOut);
        nor.push(c, 0, s);
        uv.push((a * rOut) / uvS, y / uvS);
      }
    }
    const cols = arcSeg + 1;
    for (let i = 0; i < arcSeg; i++) {
      const a = i, b = i + 1, c = i + cols, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    out.outer = makeGeometry(pos, nor, uv, idx);
  }

  if (want.includes('inner') && rIn > 0) {
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let j = 0; j < 2; j++) {
      const y = j === 0 ? y0 : y1;
      for (let i = 0; i <= arcSeg; i++) {
        const a = ang(i);
        const c = Math.cos(a), s = Math.sin(a);
        pos.push(c * rIn, y, s * rIn);
        nor.push(-c, 0, -s);
        uv.push((a * rIn) / uvS, y / uvS);
      }
    }
    const cols = arcSeg + 1;
    for (let i = 0; i < arcSeg; i++) {
      const a = i, b = i + 1, c = i + cols, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    out.inner = makeGeometry(pos, nor, uv, idx);
  }

  const disc = (y: number, up: boolean) => {
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let j = 0; j <= radSeg; j++) {
      const r = rIn + ((rOut - rIn) * j) / radSeg;
      for (let i = 0; i <= arcSeg; i++) {
        const a = ang(i);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        pos.push(x, y, z);
        nor.push(0, up ? 1 : -1, 0);
        uv.push(x / uvS + 0.5, z / uvS + 0.5);
      }
    }
    const cols = arcSeg + 1;
    for (let j = 0; j < radSeg; j++) {
      for (let i = 0; i < arcSeg; i++) {
        const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
        if (up) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
    return makeGeometry(pos, nor, uv, idx);
  };
  if (want.includes('top')) out.top = disc(y1, true);
  if (want.includes('bottom')) out.bottom = disc(y0, false);

  const cap = (a: number, atStart: boolean) => {
    const c = Math.cos(a), s = Math.sin(a);
    const nx = -Math.sin(a), nz = Math.cos(a);
    const sign = atStart ? -1 : 1;
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
    const relief = spec.capRelief;
    const rSeg = relief ? relief.seg[0] : 6;
    const hSeg = relief ? relief.seg[1] : 3;
    for (let j = 0; j <= hSeg; j++) {
      const y = y0 + ((y1 - y0) * j) / hSeg;
      for (let i = 0; i <= rSeg; i++) {
        const r = rIn + ((rOut - rIn) * i) / rSeg;
        let dep = 0;
        if (relief) {
          // Fade the relief out at the seams so layers still meet cleanly.
          const edge =
            Math.min(1, (Math.min(i, rSeg - i) / rSeg) * 5) *
            Math.min(1, (Math.min(j, hSeg - j) / hSeg) * 4);
          dep = relief.depth(r, y) * edge;
        }
        pos.push(c * r + nx * sign * -dep, y, s * r + nz * sign * -dep);
        nor.push(nx * sign, 0, nz * sign);
        uv.push(r / uvS, y / uvS);
      }
    }
    const cols = rSeg + 1;
    for (let j = 0; j < hSeg; j++) {
      for (let i = 0; i < rSeg; i++) {
        const p = j * cols + i, q = p + 1, r2 = p + cols, t = r2 + 1;
        if (atStart) idx.push(p, r2, q, q, r2, t);
        else idx.push(p, q, r2, q, t, r2);
      }
    }
    const g = makeGeometry(pos, nor, uv, idx);
    if (relief) g.computeVertexNormals();
    return g;
  };
  if (!full) {
    if (want.includes('capStart')) out.capStart = cap(a0, true);
    if (want.includes('capEnd')) out.capEnd = cap(a1, false);
  }
  return out;
}

/** A rounded fillet where the cream wall meets the board. */
export function filletRing(r: number, y: number, size: number, a0: number, a1: number): THREE.BufferGeometry {
  const arcSeg = Math.max(8, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 96));
  const prof = 5;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= prof; j++) {
    const t = j / prof;
    const ang = (t * Math.PI) / 2;
    const rr = r - size + Math.cos(ang) * size;
    const yy = y + Math.sin(ang) * size;
    for (let i = 0; i <= arcSeg; i++) {
      const a = a0 + ((a1 - a0) * i) / arcSeg;
      const c = Math.cos(a), s = Math.sin(a);
      pos.push(c * rr, yy, s * rr);
      nor.push(c * Math.cos(ang), Math.sin(ang) - 0.4, s * Math.cos(ang));
      uv.push((a * r) / 6, yy / 6);
    }
  }
  const cols = arcSeg + 1;
  for (let j = 0; j < prof; j++) {
    for (let i = 0; i < arcSeg; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = makeGeometry(pos, nor, uv, idx);
  g.computeVertexNormals();
  return g;
}

/** Piped cream rosette used sparingly on the top face. */
export function rosetteGeometry(radius: number, height: number, turns = 2.15): THREE.BufferGeometry {
  const steps = 150;
  const tubeSeg = 7;
  const pts: THREE.Vector3[] = [];
  const radii: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * Math.PI * 2 * turns;
    const r = radius * (1 - t * 0.82);
    pts.push(new THREE.Vector3(Math.cos(a) * r, height * t, Math.sin(a) * r));
    radii.push(radius * (0.34 - t * 0.2) + 0.04);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const frames = curve.computeFrenetFrames(steps, false);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = pts[i];
    const N = frames.normals[Math.min(i, steps - 1)];
    const B = frames.binormals[Math.min(i, steps - 1)];
    for (let j = 0; j <= tubeSeg; j++) {
      const v = (j / tubeSeg) * Math.PI * 2;
      const cx = Math.cos(v), sy = Math.sin(v);
      const nx = N.x * cx + B.x * sy;
      const ny = N.y * cx + B.y * sy;
      const nz = N.z * cx + B.z * sy;
      pos.push(p.x + nx * radii[i], p.y + ny * radii[i], p.z + nz * radii[i]);
      nor.push(nx, ny, nz);
      uv.push(i / steps, j / tubeSeg);
    }
  }
  const cols = tubeSeg + 1;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < tubeSeg; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  return makeGeometry(pos, nor, uv, idx);
}
