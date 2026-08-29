import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  Vector3,
  type Material,
} from 'three';

const UP = new Vector3(0, 1, 0);
const ALT = new Vector3(1, 0, 0);

/**
 * A tube swept along a polyline whose vertices are rewritten in place.
 * Used for every flexible run in the plaza — wire rope, guy wires, the light
 * harness feeders — so cables are real geometry with thickness and shading
 * rather than glowing screen-space lines.
 */
export class TubeStrip {
  readonly mesh: Mesh;
  private readonly segments: number;
  private readonly radial: number;
  private readonly position: Float32BufferAttribute;
  private readonly normal: Float32BufferAttribute;
  private readonly tangent = new Vector3();
  private readonly binormal = new Vector3();
  private readonly normalV = new Vector3();
  private readonly point = new Vector3();

  constructor(segments: number, radial: number, private radius: number, material: Material) {
    this.segments = segments;
    this.radial = radial;
    const vertexCount = (segments + 1) * (radial + 1);
    const geo = new BufferGeometry();
    this.position = new Float32BufferAttribute(new Float32Array(vertexCount * 3), 3);
    this.normal = new Float32BufferAttribute(new Float32Array(vertexCount * 3), 3);
    const uv = new Float32BufferAttribute(new Float32Array(vertexCount * 2), 2);
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      for (let s = 0; s <= radial; s++) {
        uv.setXY(i * (radial + 1) + s, s / radial, i / segments);
      }
    }
    for (let i = 0; i < segments; i++) {
      for (let s = 0; s < radial; s++) {
        const a = i * (radial + 1) + s;
        const b = a + radial + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    geo.setAttribute('position', this.position);
    geo.setAttribute('normal', this.normal);
    geo.setAttribute('uv', uv);
    geo.setIndex(indices);
    geo.boundingSphere = null;
    this.mesh = new Mesh(geo, material);
    this.mesh.frustumCulled = false;
  }

  setRadius(r: number): void {
    this.radius = r;
  }

  /** `points.length` must be `segments + 1`. */
  update(points: Vector3[]): void {
    const n = this.segments;
    for (let i = 0; i <= n; i++) {
      const p = points[Math.min(i, points.length - 1)];
      const prev = points[Math.max(0, Math.min(i - 1, points.length - 1))];
      const next = points[Math.min(i + 1, points.length - 1)];
      this.tangent.copy(next).sub(prev);
      if (this.tangent.lengthSq() < 1e-8) this.tangent.set(0, 1, 0);
      this.tangent.normalize();
      const ref = Math.abs(this.tangent.dot(UP)) > 0.95 ? ALT : UP;
      this.binormal.crossVectors(this.tangent, ref).normalize();
      this.normalV.crossVectors(this.binormal, this.tangent).normalize();
      for (let s = 0; s <= this.radial; s++) {
        const a = (s / this.radial) * Math.PI * 2;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        const nx = this.binormal.x * cx + this.normalV.x * cy;
        const ny = this.binormal.y * cx + this.normalV.y * cy;
        const nz = this.binormal.z * cx + this.normalV.z * cy;
        this.point.set(p.x + nx * this.radius, p.y + ny * this.radius, p.z + nz * this.radius);
        const idx = i * (this.radial + 1) + s;
        this.position.setXYZ(idx, this.point.x, this.point.y, this.point.z);
        this.normal.setXYZ(idx, nx, ny, nz);
      }
    }
    this.position.needsUpdate = true;
    this.normal.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}

/**
 * A flat webbing ribbon with a real width and a twist, for lifting slings.
 * Webbing is not a rope: it has a face and an edge, and the face turns towards
 * the trunk where it bears.
 */
export class RibbonStrip {
  readonly mesh: Mesh;
  private readonly segments: number;
  private readonly position: Float32BufferAttribute;
  private readonly normal: Float32BufferAttribute;
  private readonly tangent = new Vector3();
  private readonly side = new Vector3();
  private readonly nrm = new Vector3();

  constructor(segments: number, private width: number, private thickness: number, material: Material) {
    this.segments = segments;
    const vertexCount = (segments + 1) * 4;
    const geo = new BufferGeometry();
    this.position = new Float32BufferAttribute(new Float32Array(vertexCount * 3), 3);
    this.normal = new Float32BufferAttribute(new Float32Array(vertexCount * 3), 3);
    const uv = new Float32BufferAttribute(new Float32Array(vertexCount * 2), 2);
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      for (let k = 0; k < 4; k++) uv.setXY(i * 4 + k, k / 3, i / segments);
    }
    for (let i = 0; i < segments; i++) {
      for (let k = 0; k < 4; k++) {
        const a = i * 4 + k;
        const b = i * 4 + ((k + 1) % 4);
        const c = a + 4;
        const d = b + 4;
        indices.push(a, c, b, b, c, d);
      }
    }
    geo.setAttribute('position', this.position);
    geo.setAttribute('normal', this.normal);
    geo.setAttribute('uv', uv);
    geo.setIndex(indices);
    geo.boundingSphere = null;
    this.mesh = new Mesh(geo, material);
    this.mesh.frustumCulled = false;
  }

  /** `faceTarget` orients the flat of the webbing (usually the trunk axis). */
  update(points: Vector3[], faceTarget: Vector3, stretch = 0): void {
    const n = this.segments;
    const w = this.width * (1 - stretch * 0.18);
    const t = this.thickness;
    for (let i = 0; i <= n; i++) {
      const p = points[Math.min(i, points.length - 1)];
      const prev = points[Math.max(0, Math.min(i - 1, points.length - 1))];
      const next = points[Math.min(i + 1, points.length - 1)];
      this.tangent.copy(next).sub(prev);
      if (this.tangent.lengthSq() < 1e-8) this.tangent.set(0, 1, 0);
      this.tangent.normalize();
      this.side.crossVectors(this.tangent, faceTarget);
      if (this.side.lengthSq() < 1e-6) this.side.crossVectors(this.tangent, ALT);
      this.side.normalize();
      this.nrm.crossVectors(this.side, this.tangent).normalize();
      const base = i * 4;
      const corners: Array<[number, number]> = [
        [-w / 2, t / 2],
        [w / 2, t / 2],
        [w / 2, -t / 2],
        [-w / 2, -t / 2],
      ];
      for (let k = 0; k < 4; k++) {
        const [su, nv] = corners[k];
        const x = p.x + this.side.x * su + this.nrm.x * nv;
        const y = p.y + this.side.y * su + this.nrm.y * nv;
        const z = p.z + this.side.z * su + this.nrm.z * nv;
        this.position.setXYZ(base + k, x, y, z);
        const sign = k === 0 || k === 1 ? 1 : -1;
        this.normal.setXYZ(base + k, this.nrm.x * sign, this.nrm.y * sign, this.nrm.z * sign);
      }
    }
    this.position.needsUpdate = true;
    this.normal.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}

/** Sampled catenary between two points; `sag` is the mid-span droop in metres. */
export const sampleCatenary = (
  from: Vector3,
  to: Vector3,
  sag: number,
  out: Vector3[],
): Vector3[] => {
  const n = out.length - 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = out[i];
    p.lerpVectors(from, to, t);
    p.y -= Math.sin(t * Math.PI) * sag;
  }
  return out;
};

export const makePoints = (count: number): Vector3[] =>
  Array.from({ length: count }, () => new Vector3());
