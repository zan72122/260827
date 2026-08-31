import * as THREE from 'three';
import { DIM, mm } from '../core/units';
import { TAU, clamp, lerp, makeRandom, ringNoise } from '../util/math';
import type { Materials } from '../render/materials';

/**
 * The cake.
 *
 * It is one object throughout: the side is coated unevenly and gets evened out
 * where the scraper actually touches it; the top carries whatever flowers were
 * placed on it; and when it is cut, the same body is rebuilt as two pieces with
 * a genuine cross-section — sponge, filling, sponge — rather than swapped for a
 * different model.
 */

export const CAKE_H = DIM.cakeHeight;
export const CAKE_R = DIM.cakeRadius;
/** Thickness of the buttercream coat on the side. */
const COAT = mm(3.0);
/** Thickness of the buttercream on top. */
const TOP_COAT = mm(4.0);

/** Sponge and filling stack, as fractions of the sponge body height. */
const LAYERS: Array<{ from: number; to: number; kind: 'sponge' | 'filling' }> = [
  { from: 0.0, to: 0.315, kind: 'sponge' },
  { from: 0.315, to: 0.395, kind: 'filling' },
  { from: 0.395, to: 0.685, kind: 'sponge' },
  { from: 0.685, to: 0.765, kind: 'filling' },
  { from: 0.765, to: 1.0, kind: 'sponge' },
];
const SPONGE_H = CAKE_H - TOP_COAT;

const SIDE_ROWS = 18;

/** Where the unevenness of a hand-applied coat actually sits. */
function ampProfile(t: number): number {
  return mm(6.0) * Math.pow(Math.sin(Math.PI * clamp(t, 0, 1)), 0.5) + mm(0.4);
}

function sampleRoughness(rough: Float32Array, angle: number): number {
  const n = rough.length;
  const f = ((angle / TAU) * n + n * 4) % n;
  const i0 = Math.floor(f);
  const i1 = (i0 + 1) % n;
  const t = f - i0;
  return lerp(rough[i0], rough[i1], t);
}

/** Outer radius of the iced cake at a given bearing and height. */
export function cakeRadiusAt(rough: Float32Array, angle: number, y: number): number {
  const t = clamp(y / CAKE_H, 0, 1);
  // A slight swell through the middle and the soft roll where the top edge was
  // pulled in with the palette knife.
  const shoulder = -mm(2.8) * Math.pow(clamp((t - 0.89) / 0.11, 0, 1), 1.5);
  const foot = -mm(1.1) * Math.pow(clamp((0.05 - t) / 0.05, 0, 1), 1.6);
  const body = CAKE_R + mm(0.7) * Math.sin(Math.PI * t) + shoulder + foot;
  // Horizontal lines the scraper leaves behind. These survive smoothing: a
  // finished coat is even, not machined.
  const bands = mm(0.34) * Math.sin(t * 44 + Math.sin(angle * 2.3) * 1.4);
  // The lumps of a hand-applied coat only ever stand proud of the surface,
  // because a blade can take cream off but cannot put it back.
  const lumpShape = 0.45 + 0.55 * (ringNoise(angle * 1.7 + t * 1.6, 4711, 6) * 0.5 + 0.5);
  const lump = sampleRoughness(rough, angle) * ampProfile(t) * lumpShape;
  return body + bands + lump;
}

/** Height of the top surface, which the palette knife left faintly ridged. */
export function cakeTopY(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const a = Math.atan2(z, x);
  const spiral = Math.sin(r * 150 + a * 1.6) * mm(0.42);
  const rim = mm(0.9) * Math.pow(clamp((r / CAKE_R - 0.72) / 0.28, 0, 1), 1.4);
  const dome = -mm(0.5) * Math.pow(r / CAKE_R, 2);
  return CAKE_H + spiral + dome + rim;
}

function makeGeometry(
  positions: number[],
  uvs: number[],
  index: number[],
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** The iced skin of a sector (or the whole cake when `full`). */
function buildIcedSkin(
  rough: Float32Array,
  from: number,
  to: number,
  cols: number,
  full: boolean,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const colCount = full ? cols : cols + 1;

  // --- side
  const angleOf = (i: number) => (full ? from + (i / cols) * (to - from) : lerp(from, to, i / cols));
  for (let r = 0; r <= SIDE_ROWS; r++) {
    const y = (r / SIDE_ROWS) * CAKE_H;
    for (let i = 0; i < colCount; i++) {
      const a = angleOf(i);
      const rad = cakeRadiusAt(rough, a, y);
      positions.push(Math.cos(a) * rad, y, Math.sin(a) * rad);
      uvs.push((a / TAU) * 3.2, y / CAKE_H);
    }
  }
  const sideAt = (i: number, r: number) => r * colCount + (full ? i % cols : i);
  for (let r = 0; r < SIDE_ROWS; r++) {
    for (let i = 0; i < cols; i++) {
      const a = sideAt(i, r);
      const b = sideAt(i + 1, r);
      const c = sideAt(i + 1, r + 1);
      const d = sideAt(i, r + 1);
      index.push(a, c, b, a, d, c);
    }
  }

  // --- top, as concentric rings so the palette-knife ridges show. The rings
  // stop short of the axis and a single centre vertex closes them, because a
  // ring collapsed onto a point makes degenerate triangles with no normal.
  const topBase = positions.length / 3;
  const topRings = 8;
  for (let ring = 0; ring <= topRings; ring++) {
    for (let i = 0; i < colCount; i++) {
      const a = angleOf(i);
      const t = ring / (topRings + 1);
      const outer = cakeRadiusAt(rough, a, CAKE_H) - mm(0.6);
      const rad = outer * (1 - t);
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad;
      positions.push(x, cakeTopY(x, z), z);
      uvs.push(0.5 + (x / CAKE_R) * 0.5, 0.5 + (z / CAKE_R) * 0.5);
    }
  }
  const topAt = (i: number, ring: number) => topBase + ring * colCount + (full ? i % cols : i);
  for (let ring = 0; ring < topRings; ring++) {
    for (let i = 0; i < cols; i++) {
      const a = topAt(i, ring);
      const b = topAt(i + 1, ring);
      const c = topAt(i + 1, ring + 1);
      const d = topAt(i, ring + 1);
      index.push(a, c, b, a, d, c);
    }
  }
  const topCentre = positions.length / 3;
  positions.push(0, cakeTopY(0, 0), 0);
  uvs.push(0.5, 0.5);
  for (let i = 0; i < cols; i++) {
    index.push(topCentre, topAt(i + 1, topRings), topAt(i, topRings));
  }

  // --- bottom
  const botBase = positions.length / 3;
  positions.push(0, 0, 0);
  uvs.push(0.5, 0.5);
  for (let i = 0; i < colCount; i++) {
    const a = angleOf(i);
    const rad = cakeRadiusAt(rough, a, 0);
    positions.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    uvs.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
  }
  for (let i = 0; i < cols; i++) {
    const a = botBase + 1 + (full ? i % cols : i);
    const b = botBase + 1 + (full ? (i + 1) % cols : i + 1);
    index.push(botBase, a, b);
  }

  return makeGeometry(positions, uvs, index);
}

/**
 * One radial cut face: sponge bands and filling bands as separate geometry, so
 * they are separate materials with real edges between them.
 */
function buildCutFace(
  rough: Float32Array,
  angle: number,
  facingSign: number,
): { sponge: THREE.BufferGeometry; cream: THREE.BufferGeometry } {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const rnd = makeRandom(Math.round(angle * 1000) + 17);

  const build = (bands: Array<{ y0: number; y1: number }>, crumb: boolean) => {
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    const NR = 12;
    const NY = 5;
    for (const band of bands) {
      const base = positions.length / 3;
      for (let j = 0; j <= NY; j++) {
        const y = lerp(band.y0, band.y1, j / NY);
        const rMax = cakeRadiusAt(rough, angle, y) - (crumb ? COAT : 0);
        for (let i = 0; i <= NR; i++) {
          const r = (i / NR) * rMax;
          // The blade drags crumb, so a cut face is never dead flat.
          const bump = crumb
            ? (rnd() - 0.5) * mm(0.5) + Math.sin(r * 260 + y * 190) * mm(0.22)
            : (rnd() - 0.5) * mm(0.12);
          const off = bump * facingSign;
          positions.push(cosA * r - sinA * off, y, sinA * r + cosA * off);
          uvs.push(r / CAKE_R, y / CAKE_H);
        }
      }
      for (let j = 0; j < NY; j++) {
        for (let i = 0; i < NR; i++) {
          const a = base + j * (NR + 1) + i;
          const b = a + 1;
          const c = a + NR + 2;
          const d = a + NR + 1;
          if (facingSign > 0) index.push(a, b, c, a, c, d);
          else index.push(a, c, b, a, d, c);
        }
      }
    }
    return makeGeometry(positions, uvs, index);
  };

  const spongeBands = LAYERS.filter((l) => l.kind === 'sponge').map((l) => ({
    y0: l.from * SPONGE_H,
    y1: l.to * SPONGE_H,
  }));
  const creamBands = LAYERS.filter((l) => l.kind === 'filling').map((l) => ({
    y0: l.from * SPONGE_H,
    y1: l.to * SPONGE_H,
  }));
  // The coat itself, seen end-on: a thin band up the outside and across the top.
  creamBands.push({ y0: SPONGE_H, y1: CAKE_H });

  const spongeGeo = build(spongeBands, true);
  const creamGeo = build(creamBands, false);

  // The side coat appears on the cut face as a sliver outboard of the sponge.
  const sliver = (() => {
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    const NY = 10;
    for (let j = 0; j <= NY; j++) {
      const y = (j / NY) * SPONGE_H;
      const rOuter = cakeRadiusAt(rough, angle, y);
      const rInner = rOuter - COAT;
      for (const r of [rInner, rOuter]) {
        positions.push(cosA * r, y, sinA * r);
        uvs.push(r / CAKE_R, y / CAKE_H);
      }
    }
    for (let j = 0; j < NY; j++) {
      const a = j * 2;
      if (facingSign > 0) index.push(a, a + 1, a + 3, a, a + 3, a + 2);
      else index.push(a, a + 3, a + 1, a, a + 2, a + 3);
    }
    return makeGeometry(positions, uvs, index);
  })();

  // Merge the sliver into the cream face by concatenating index/positions.
  const merged = (() => {
    const p1 = creamGeo.attributes.position.array as Float32Array;
    const u1 = creamGeo.attributes.uv.array as Float32Array;
    const i1 = creamGeo.getIndex()!.array as ArrayLike<number>;
    const p2 = sliver.attributes.position.array as Float32Array;
    const u2 = sliver.attributes.uv.array as Float32Array;
    const i2 = sliver.getIndex()!.array as ArrayLike<number>;
    const offset = p1.length / 3;
    const positions = new Float32Array(p1.length + p2.length);
    positions.set(p1, 0);
    positions.set(p2, p1.length);
    const uvs = new Float32Array(u1.length + u2.length);
    uvs.set(u1, 0);
    uvs.set(u2, u1.length);
    const index = new Uint32Array(i1.length + i2.length);
    for (let k = 0; k < i1.length; k++) index[k] = i1[k];
    for (let k = 0; k < i2.length; k++) index[i1.length + k] = i2[k] + offset;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    return geo;
  })();

  creamGeo.dispose();
  sliver.dispose();
  return { sponge: spongeGeo, cream: merged };
}

/** A wedge or a remainder: iced outside, cut faces inside. */
export function buildCakeSector(
  materials: Materials,
  rough: Float32Array,
  from: number,
  to: number,
): THREE.Group {
  const group = new THREE.Group();
  const span = to - from;
  const cols = Math.max(6, Math.round((Math.abs(span) / TAU) * 160));

  const skin = new THREE.Mesh(buildIcedSkin(rough, from, to, cols, false), materials.coatCream);
  skin.castShadow = true;
  skin.receiveShadow = true;
  group.add(skin);

  for (const [angle, sign] of [
    [from, -1],
    [to, 1],
  ] as Array<[number, number]>) {
    const face = buildCutFace(rough, angle, sign);
    const s = new THREE.Mesh(face.sponge, materials.sponge);
    const c = new THREE.Mesh(face.cream, materials.coatCream);
    s.castShadow = true;
    s.receiveShadow = true;
    c.receiveShadow = true;
    group.add(s, c);
  }
  return group;
}

/** The uncut cake, whose side coat the child evens out. */
export class WholeCake {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  private readonly rough: Float32Array;
  private readonly cols: number;
  private readonly geometry: THREE.BufferGeometry;

  constructor(materials: Materials, rough: Float32Array) {
    this.rough = rough;
    this.cols = 128;
    this.geometry = buildIcedSkin(rough, 0, TAU, this.cols, true);
    this.mesh = new THREE.Mesh(this.geometry, materials.coatCream);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'cake';
    this.group.add(this.mesh);
  }

  /** Push the current roughness values back into the side vertices. */
  refresh(): void {
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    const cols = this.cols;
    for (let r = 0; r <= SIDE_ROWS; r++) {
      const y = (r / SIDE_ROWS) * CAKE_H;
      for (let i = 0; i < cols; i++) {
        const a = (i / cols) * TAU;
        const rad = cakeRadiusAt(this.rough, a, y);
        pos.setXYZ(r * cols + i, Math.cos(a) * rad, y, Math.sin(a) * rad);
      }
    }
    // The top rings follow the side so the shoulder stays joined.
    const topBase = (SIDE_ROWS + 1) * cols;
    const topRings = 8;
    for (let ring = 0; ring <= topRings; ring++) {
      for (let i = 0; i < cols; i++) {
        const a = (i / cols) * TAU;
        const t = ring / (topRings + 1);
        const outer = cakeRadiusAt(this.rough, a, CAKE_H) - mm(0.6);
        const rad = outer * (1 - t);
        const x = Math.cos(a) * rad;
        const z = Math.sin(a) * rad;
        pos.setXYZ(topBase + ring * cols + i, x, cakeTopY(x, z), z);
      }
    }
    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

/** The initial patchy coat: a few high spots, the way a crumb coat comes out. */
export function initialCoat(columns: number, seed = 7): Float32Array {
  const out = new Float32Array(columns);
  const rnd = makeRandom(seed);
  const lumps = 6;
  const centres = Array.from({ length: lumps }, () => rnd() * TAU);
  const widths = Array.from({ length: lumps }, () => 0.18 + rnd() * 0.42);
  const heights = Array.from({ length: lumps }, () => 0.6 + rnd() * 0.6);
  for (let i = 0; i < columns; i++) {
    const a = (i / columns) * TAU;
    let v = 0.12;
    for (let k = 0; k < lumps; k++) {
      let d = Math.abs(a - centres[k]);
      d = Math.min(d, TAU - d);
      v += heights[k] * Math.exp(-(d * d) / (2 * widths[k] * widths[k]));
    }
    out[i] = clamp(v, 0, 1.35);
  }
  return out;
}
