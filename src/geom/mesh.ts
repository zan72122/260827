/**
 * Small helpers for building the doll out of real surfaces.
 *
 * The pieces are hollow paper shells, so every one of them is generated as an
 * outer surface, an inner surface and the rim/cut bands that join them. Nothing
 * here is a sphere stretched into a shape: the wall has a front, a back and a
 * measurable thickness, which is what makes the cutaway readable and what keeps
 * the head from passing through the body.
 */
import { BufferGeometry, BufferAttribute } from 'three';
import { MM } from '../sim/dims';

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** Accumulates triangles, then hands over a BufferGeometry in metres. */
export class MeshBuilder {
  private pos: number[] = [];
  private idx: number[] = [];
  private uv: number[] = [];

  vertex(p: P3, u = 0, v = 0): number {
    this.pos.push(p.x * MM, p.y * MM, p.z * MM);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * A quad grid over (u, v). `flip` reverses the winding, which is what turns an
 * outer surface into an inner one.
 */
export function addGrid(
  mb: MeshBuilder,
  nu: number,
  nv: number,
  vWraps: boolean,
  f: (u: number, v: number) => P3,
  flip = false,
): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    const row: number[] = [];
    const cols = vWraps ? nv : nv;
    for (let j = 0; j <= cols; j++) {
      const v = j / nv;
      row.push(mb.vertex(f(u, v), v, u));
    }
    rows.push(row);
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = rows[i]![j]!;
      const b = rows[i]![j + 1]!;
      const c = rows[i + 1]![j + 1]!;
      const d = rows[i + 1]![j]!;
      if (flip) mb.quad(a, d, c, b);
      else mb.quad(a, b, c, d);
    }
  }
  return rows;
}

/** Close a ring of vertices onto a single apex point. */
export function addFan(mb: MeshBuilder, ring: number[], apex: P3, flip = false): void {
  const a = mb.vertex(apex, 0.5, 0.5);
  for (let j = 0; j < ring.length - 1; j++) {
    if (flip) mb.tri(a, ring[j + 1]!, ring[j]!);
    else mb.tri(a, ring[j]!, ring[j + 1]!);
  }
}

/** Stitch two rings of equal length into a band (the rim, or a cut face). */
export function addBand(mb: MeshBuilder, ringA: number[], ringB: number[], flip = false): void {
  for (let j = 0; j < ringA.length - 1; j++) {
    const a = ringA[j]!;
    const b = ringA[j + 1]!;
    const c = ringB[j + 1]!;
    const d = ringB[j]!;
    if (flip) mb.quad(a, d, c, b);
    else mb.quad(a, b, c, d);
  }
}

/** Copy a ring of vertices into a builder, returning the new indices. */
export function ringOf(mb: MeshBuilder, pts: P3[]): number[] {
  return pts.map((p, i) => mb.vertex(p, i / (pts.length - 1), 0));
}

/** A capsule-ish tapered tube along a polyline in the x-y plane. */
export function addTube(
  mb: MeshBuilder,
  path: { x: number; y: number; z?: number; r: number }[],
  seg = 14,
  capStart = true,
  capEnd = true,
): void {
  const rings: number[][] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const prev = path[Math.max(0, i - 1)]!;
    const next = path[Math.min(path.length - 1, i + 1)]!;
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    const ux = -ty;
    const uy = tx;
    const ring: number[] = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      ring.push(
        mb.vertex(
          {
            x: p.x + ux * p.r * ca,
            y: p.y + uy * p.r * ca,
            z: (p.z ?? 0) + p.r * sa,
          },
          j / seg,
          i / (path.length - 1),
        ),
      );
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) addBand(mb, rings[i]!, rings[i + 1]!, true);
  if (capStart) addFan(mb, rings[0]!, { x: path[0]!.x, y: path[0]!.y, z: path[0]!.z ?? 0 }, false);
  if (capEnd) {
    const e = path[path.length - 1]!;
    addFan(mb, rings[rings.length - 1]!, { x: e.x, y: e.y, z: e.z ?? 0 }, true);
  }
}

/** Sphere-ish blob, used for the counterweight and small fittings. */
export function addEllipsoid(
  mb: MeshBuilder,
  c: P3,
  r: { x: number; y: number; z: number },
  nu = 12,
  nv = 16,
): void {
  addGrid(mb, nu, nv, true, (u, v) => {
    const th = u * Math.PI;
    const ph = v * Math.PI * 2;
    return {
      x: c.x + r.x * Math.sin(th) * Math.cos(ph),
      y: c.y + r.y * Math.cos(th),
      z: c.z + r.z * Math.sin(th) * Math.sin(ph),
    };
  });
}

/** Rounded box, for the bench, tray and wooden jigs. */
export function addRoundedBox(
  mb: MeshBuilder,
  c: P3,
  h: { x: number; y: number; z: number },
  radius = 1.2,
  seg = 3,
): void {
  const n = seg * 2 + 2;
  addGrid(mb, n, n * 2, true, (u, v) => {
    const th = u * Math.PI;
    const ph = v * Math.PI * 2;
    const sx = Math.sin(th) * Math.cos(ph);
    const sy = Math.cos(th);
    const sz = Math.sin(th) * Math.sin(ph);
    const k = 6;
    const q = (t: number): number => Math.sign(t) * Math.pow(Math.abs(t), 2 / k);
    return {
      x: c.x + (h.x - radius) * q(sx) + radius * sx,
      y: c.y + (h.y - radius) * q(sy) + radius * sy,
      z: c.z + (h.z - radius) * q(sz) + radius * sz,
    };
  });
}
