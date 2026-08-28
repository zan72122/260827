import * as THREE from 'three';

/**
 * Builds a solid, double-sided metal sheet from a parametric mid-surface.
 *
 * Every piece of the bell is one of these: the sheet has real thickness, every
 * cut edge (slit, sound hole, petal outline) gets a chamfered wall, and the
 * whole thing can be re-evaluated each frame while the metal is being formed.
 * The topology is fixed at build time; only positions and normals move.
 */
export interface SheetSurface {
  nu: number;
  nv: number;
  /** mid-surface position of grid node (i,j) */
  point(i: number, j: number, out: THREE.Vector3): void;
  /** outward unit normal of the mid-surface at (i,j) */
  normalAt(i: number, j: number, out: THREE.Vector3): void;
  /** half of the sheet thickness at (i,j) */
  half(i: number, j: number): number;
  /** texture coordinate in flat-blank space, so the rolling grain stays put */
  uvAt(i: number, j: number, out: THREE.Vector2): void;
  /** false when the material of cell (i,j) has been punched out */
  cellOn?(i: number, j: number): boolean;
}

interface WallVert {
  node: number;
  ring: number;      // 0 = top face, 1 = bottom face
  /** 0: edge runs along u (wall faces +-v), 1: edge runs along v (wall faces +-u) */
  axis: 0 | 1;
  sign: number;
}

const RINGS = 2;          // wall cross-section segments -> chamfered cut edge
const BULGE = 0.5;        // slight burr left by the blanking die

export class SheetMesh {
  readonly geometry = new THREE.BufferGeometry();
  private nodeCount: number;
  private wallVerts: WallVert[] = [];
  private pos: Float32Array;
  private nrm: Float32Array;
  private P: Float32Array;      // cached node mid-surface positions
  private N: Float32Array;      // cached node normals
  private H: Float32Array;      // cached half thickness
  private surface: SheetSurface;

  constructor(surface: SheetSurface) {
    this.surface = surface;
    const { nu, nv } = surface;
    const cols = nv + 1;
    this.nodeCount = (nu + 1) * cols;

    const on = (i: number, j: number) =>
      i >= 0 && j >= 0 && i < nu && j < nv && (surface.cellOn ? surface.cellOn(i, j) : true);

    const indices: number[] = [];
    const gi = (i: number, j: number) => i * cols + j;
    const TOP = 0;
    const BOT = this.nodeCount;

    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        if (!on(i, j)) continue;
        const a = gi(i, j), b = gi(i + 1, j), c = gi(i + 1, j + 1), d = gi(i, j + 1);
        // outward face
        indices.push(TOP + a, TOP + b, TOP + c, TOP + a, TOP + c, TOP + d);
        // inward face
        indices.push(BOT + a, BOT + c, BOT + b, BOT + a, BOT + d, BOT + c);
      }
    }

    // walls along every free edge
    const wallBase = this.nodeCount * 2;
    const pushWall = (n0: number, n1: number, axis: 0 | 1, sign: number, flip: boolean) => {
      const start = wallBase + this.wallVerts.length;
      for (let k = 0; k <= RINGS; k++) {
        this.wallVerts.push({ node: n0, ring: k / RINGS, axis, sign });
        this.wallVerts.push({ node: n1, ring: k / RINGS, axis, sign });
      }
      for (let k = 0; k < RINGS; k++) {
        const a = start + k * 2, b = a + 1, c = a + 2, d = a + 3;
        if (flip) indices.push(a, c, b, b, c, d);
        else indices.push(a, b, c, b, d, c);
      }
    };

    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        if (!on(i, j)) continue;
        // edge at j (constant v, runs along u) facing -v
        if (!on(i, j - 1)) pushWall(gi(i, j), gi(i + 1, j), 0, -1, false);
        if (!on(i, j + 1)) pushWall(gi(i, j + 1), gi(i + 1, j + 1), 0, +1, true);
        if (!on(i - 1, j)) pushWall(gi(i, j), gi(i, j + 1), 1, -1, true);
        if (!on(i + 1, j)) pushWall(gi(i + 1, j), gi(i + 1, j + 1), 1, +1, false);
      }
    }

    const total = this.nodeCount * 2 + this.wallVerts.length;
    this.pos = new Float32Array(total * 3);
    this.nrm = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    this.P = new Float32Array(this.nodeCount * 3);
    this.N = new Float32Array(this.nodeCount * 3);
    this.H = new Float32Array(this.nodeCount);

    const t2 = new THREE.Vector2();
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        const g = gi(i, j);
        surface.uvAt(i, j, t2);
        uv[g * 2] = t2.x; uv[g * 2 + 1] = t2.y;
        uv[(this.nodeCount + g) * 2] = t2.x; uv[(this.nodeCount + g) * 2 + 1] = t2.y;
      }
    }
    for (let w = 0; w < this.wallVerts.length; w++) {
      const g = this.wallVerts[w].node;
      const v = wallBase + w;
      uv[v * 2] = uv[g * 2]; uv[v * 2 + 1] = uv[g * 2 + 1];
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geometry.setIndex(
      total > 65000 ? new THREE.BufferAttribute(new Uint32Array(indices), 1)
                    : new THREE.BufferAttribute(new Uint16Array(indices), 1)
    );
    this.refresh();
  }

  /** Re-evaluate the surface. Call after changing the forming parameters. */
  refresh() {
    const s = this.surface;
    const { nu, nv } = s;
    const cols = nv + 1;
    const P = this.P, N = this.N, H = this.H;
    const p = _p, n = _n;

    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        const g = i * cols + j;
        s.point(i, j, p);
        s.normalAt(i, j, n);
        P[g * 3] = p.x; P[g * 3 + 1] = p.y; P[g * 3 + 2] = p.z;
        N[g * 3] = n.x; N[g * 3 + 1] = n.y; N[g * 3 + 2] = n.z;
        H[g] = s.half(i, j);
      }
    }

    const pos = this.pos, nrm = this.nrm, nc = this.nodeCount;
    for (let g = 0; g < nc; g++) {
      const h = H[g];
      const px = P[g * 3], py = P[g * 3 + 1], pz = P[g * 3 + 2];
      const nx = N[g * 3], ny = N[g * 3 + 1], nz = N[g * 3 + 2];
      pos[g * 3] = px + nx * h; pos[g * 3 + 1] = py + ny * h; pos[g * 3 + 2] = pz + nz * h;
      nrm[g * 3] = nx; nrm[g * 3 + 1] = ny; nrm[g * 3 + 2] = nz;
      const b = nc + g;
      pos[b * 3] = px - nx * h; pos[b * 3 + 1] = py - ny * h; pos[b * 3 + 2] = pz - nz * h;
      nrm[b * 3] = -nx; nrm[b * 3 + 1] = -ny; nrm[b * 3 + 2] = -nz;
    }

    // wall vertices: swept across the thickness with a small outward burr
    const base = nc * 2;
    const d = _d, nn = _nn, tmp = _t;
    for (let w = 0; w < this.wallVerts.length; w++) {
      const wv = this.wallVerts[w];
      const g = wv.node;
      const i = (g / cols) | 0, j = g % cols;
      // tangent along the grid direction the wall faces
      if (wv.axis === 0) {
        const ja = Math.min(j + 1, nv), jb = Math.max(j - 1, 0);
        this.nodeDelta(i * cols + ja, i * cols + jb, d);
      } else {
        const ia = Math.min(i + 1, nu), ib = Math.max(i - 1, 0);
        this.nodeDelta(ia * cols + j, ib * cols + j, d);
      }
      d.multiplyScalar(wv.sign);
      nn.set(N[g * 3], N[g * 3 + 1], N[g * 3 + 2]);
      // make the wall direction perpendicular to the shell normal
      d.addScaledVector(nn, -d.dot(nn));
      if (d.lengthSq() < 1e-12) d.set(1, 0, 0);
      d.normalize();

      const h = H[g];
      const r = wv.ring;
      const bulge = Math.sin(Math.PI * r) * BULGE * h;
      tmp.set(P[g * 3], P[g * 3 + 1], P[g * 3 + 2]);
      tmp.addScaledVector(nn, h * (1 - 2 * r));
      tmp.addScaledVector(d, bulge);
      const v = base + w;
      pos[v * 3] = tmp.x; pos[v * 3 + 1] = tmp.y; pos[v * 3 + 2] = tmp.z;

      const a = (0.18 + 0.64 * r) * Math.PI;
      const sa = Math.sin(a), ca = Math.cos(a);
      nrm[v * 3] = d.x * sa + nn.x * ca;
      nrm[v * 3 + 1] = d.y * sa + nn.y * ca;
      nrm[v * 3 + 2] = d.z * sa + nn.z * ca;
    }

    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  private nodeDelta(ga: number, gb: number, out: THREE.Vector3) {
    out.set(
      this.P[ga * 3] - this.P[gb * 3],
      this.P[ga * 3 + 1] - this.P[gb * 3 + 1],
      this.P[ga * 3 + 2] - this.P[gb * 3 + 2]
    );
  }

  dispose() { this.geometry.dispose(); }
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _d = new THREE.Vector3();
const _nn = new THREE.Vector3();
const _t = new THREE.Vector3();
