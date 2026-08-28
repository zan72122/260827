import * as THREE from 'three';
import type { FinMaps, FishMaps } from './textures';

export interface FishBuildOptions {
  bodySegments: number;
  radialSegments: number;
  transmission: boolean;
  fishMaps: FishMaps;
  finMaps: FinMaps;
  env: THREE.Texture;
}

/** Small deterministic RNG so a given fish keeps its form across reloads. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

type Anchor = [number, number];

function sampleAnchors(anchors: Anchor[], t: number): number {
  if (t <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (t >= last[0]) return last[1];
  let i = 0;
  while (i < anchors.length - 2 && anchors[i + 1][0] < t) i++;
  const [x0, y0] = anchors[i];
  const [x1, y1] = anchors[i + 1];
  const p = (t - x0) / (x1 - x0);
  const s = p * p * (3 - 2 * p);
  // one-sided slope continuation keeps the silhouette free of flat facets
  const ym1 = anchors[Math.max(0, i - 1)][1];
  const y2 = anchors[Math.min(anchors.length - 1, i + 2)][1];
  const m0 = (y1 - ym1) * 0.5;
  const m1 = (y2 - y0) * 0.5;
  const h00 = 2 * p ** 3 - 3 * p ** 2 + 1;
  const h10 = p ** 3 - 2 * p ** 2 + p;
  const h01 = -2 * p ** 3 + 3 * p ** 2;
  const h11 = p ** 3 - p ** 2;
  return (h00 * y0 + h10 * m0 + h01 * y1 + h11 * m1) * 0.6 + (y0 + (y1 - y0) * s) * 0.4;
}

const H_PROFILE: Anchor[] = [
  [0.0, 0.05],
  [0.03, 0.21],
  [0.08, 0.43],
  [0.16, 0.67],
  [0.26, 0.87],
  [0.37, 1.0],
  [0.5, 0.95],
  [0.62, 0.79],
  [0.74, 0.56],
  [0.84, 0.33],
  [0.92, 0.185],
  [1.0, 0.12],
];

const W_PROFILE: Anchor[] = [
  [0.0, 0.06],
  [0.05, 0.31],
  [0.12, 0.53],
  [0.22, 0.74],
  [0.32, 0.8],
  [0.45, 0.73],
  [0.6, 0.58],
  [0.75, 0.38],
  [0.88, 0.19],
  [1.0, 0.08],
];

const C_PROFILE: Anchor[] = [
  [0.0, -0.075],
  [0.1, -0.02],
  [0.3, 0.02],
  [0.6, 0.012],
  [1.0, 0.0],
];

export interface FishForm {
  length: number;
  depth: number; // half depth in metres
  width: number; // half width in metres
  bend: number;
  headSlope: number;
  finScale: number;
  forkDepth: number;
  seed: number;
}

export function randomForm(seed: number): FishForm {
  const r = rng(seed);
  const length = 0.098 + r() * 0.032;
  return {
    length,
    depth: length * (0.121 + r() * 0.028),
    width: length * (0.048 + r() * 0.013),
    bend: (r() - 0.5) * 0.055,
    headSlope: 0.85 + r() * 0.35,
    finScale: 0.9 + r() * 0.24,
    forkDepth: 0.4 + r() * 0.22,
    seed,
  };
}

function halfHeight(f: FishForm, t: number): number {
  const base = sampleAnchors(H_PROFILE, t);
  const head = t < 0.2 ? 1 + (0.2 - t) * (f.headSlope - 1) * 1.5 : 1;
  return f.depth * base * head;
}
function halfWidth(f: FishForm, t: number): number {
  return f.width * sampleAnchors(W_PROFILE, t);
}
function centreY(f: FishForm, t: number): number {
  return f.depth * sampleAnchors(C_PROFILE, t) + f.bend * Math.sin(t * Math.PI) * f.length;
}

function surface(f: FishForm, t: number, a: number, out: THREE.Vector3): THREE.Vector3 {
  const h = halfHeight(f, t);
  const w = halfWidth(f, t);
  const ny = Math.cos(a);
  const nz = Math.sin(a);
  const y =
    ny >= 0 ? h * Math.pow(ny, 1.16) : -h * Math.pow(-ny, 0.9) * 1.02;
  const keel = 1 - 0.34 * Math.max(0, ny) ** 2;
  const z = w * Math.sign(nz) * Math.pow(Math.abs(nz), 1.02) * keel;
  out.set(t * f.length, centreY(f, t) + y, z);
  return out;
}

function buildBody(f: FishForm, nu: number, nv: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= nu; i++) {
    const t = Math.pow(i / nu, 0.94);
    for (let j = 0; j <= nv; j++) {
      const a = (j / nv) * Math.PI * 2;
      surface(f, t, a, p);
      pos.push(p.x, p.y, p.z);
      uv.push(t, j / nv);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const A = i * (nv + 1) + j;
      const B = A + nv + 1;
      idx.push(A, B, A + 1, A + 1, B, B + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();

  // weld the dorsal seam normals so the ridge does not show a hard edge
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i <= nu; i++) {
    const a = i * (nv + 1);
    const b = a + nv;
    const x = (n.getX(a) + n.getX(b)) * 0.5;
    const y = (n.getY(a) + n.getY(b)) * 0.5;
    const z = (n.getZ(a) + n.getZ(b)) * 0.5;
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
  n.needsUpdate = true;
  return g;
}

interface FinSpec {
  base: (u: number) => THREE.Vector3;
  margin: (u: number) => THREE.Vector3;
  normal: THREE.Vector3;
  thickness: number;
  camber: number;
  nu: number;
  nv: number;
}

/** Fins are real thin sheets: full thickness at the base, tapering into the margin,
 *  with a rim so they never read as a flat card. */
function buildFin(spec: FinSpec): THREE.BufferGeometry {
  const { nu, nv } = spec;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const b = new THREE.Vector3();
  const m = new THREE.Vector3();
  const p = new THREE.Vector3();
  const nrm = spec.normal.clone().normalize();
  const rows = (nv + 1) * (nu + 1);

  for (let side = 0; side < 2; side++) {
    const sgn = side === 0 ? 1 : -1;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      b.copy(spec.base(u));
      m.copy(spec.margin(u));
      for (let j = 0; j <= nv; j++) {
        const v = j / nv;
        p.copy(b).lerp(m, v);
        const ray = 0.55 + 0.45 * Math.abs(Math.sin(u * Math.PI * 6.5));
        const th = spec.thickness * Math.pow(1 - v, 1.5) * ray;
        const camber = Math.sin(v * Math.PI) * spec.camber;
        p.addScaledVector(nrm, sgn * th * 0.5 + camber);
        pos.push(p.x, p.y, p.z);
        uv.push(u, v);
      }
    }
  }
  for (let side = 0; side < 2; side++) {
    const off = side * rows;
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const A = off + i * (nv + 1) + j;
        const B = A + nv + 1;
        if (side === 0) idx.push(A, B, A + 1, A + 1, B, B + 1);
        else idx.push(A, A + 1, B, A + 1, B + 1, B);
      }
    }
  }
  // rim along the outer margin
  for (let i = 0; i < nu; i++) {
    const a0 = i * (nv + 1) + nv;
    const a1 = (i + 1) * (nv + 1) + nv;
    const b0 = rows + a0;
    const b1 = rows + a1;
    idx.push(a0, b0, a1, a1, b0, b1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vTotal = 0;
  let iTotal = 0;
  for (const g of list) {
    vTotal += g.getAttribute('position').count;
    iTotal += g.getIndex()!.count;
  }
  const pos = new Float32Array(vTotal * 3);
  const nor = new Float32Array(vTotal * 3);
  const uv = new Float32Array(vTotal * 2);
  const idx = new Uint32Array(iTotal);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    const u = g.getAttribute('uv') as THREE.BufferAttribute;
    const ind = g.getIndex()!;
    pos.set(p.array as Float32Array, vo * 3);
    nor.set(n.array as Float32Array, vo * 3);
    uv.set(u.array as Float32Array, vo * 2);
    for (let i = 0; i < ind.count; i++) idx[io + i] = ind.getX(i) + vo;
    vo += p.count;
    io += ind.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function buildFins(f: FishForm, quality: number): THREE.BufferGeometry {
  const L = f.length;
  const s = f.finScale;
  const fins: THREE.BufferGeometry[] = [];
  const nu = Math.max(6, Math.round(10 * quality));
  const nv = Math.max(3, Math.round(5 * quality));
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // dorsal — a long soft fin with a shallow notch near its front
  {
    const t0 = 0.33;
    const t1 = 0.66;
    fins.push(
      buildFin({
        base: (u) => {
          const t = t0 + (t1 - t0) * u;
          return v(t * L, centreY(f, t) + halfHeight(f, t) * 0.96, 0);
        },
        margin: (u) => {
          const t = t0 + (t1 - t0) * u;
          const prof =
            Math.sin(Math.min(1, u / 0.22) * Math.PI * 0.5) *
            (1 - 0.55 * u) *
            (1 - 0.25 * Math.exp(-Math.pow((u - 0.26) / 0.09, 2)));
          return v(
            (t + 0.012) * L,
            centreY(f, t) + halfHeight(f, t) * 0.96 + f.depth * 0.62 * s * prof,
            0,
          );
        },
        normal: v(0, 0, 1),
        thickness: L * 0.0055,
        camber: 0,
        nu,
        nv,
      }),
    );
  }
  // anal
  {
    const t0 = 0.64;
    const t1 = 0.84;
    fins.push(
      buildFin({
        base: (u) => {
          const t = t0 + (t1 - t0) * u;
          return v(t * L, centreY(f, t) - halfHeight(f, t) * 0.96, 0);
        },
        margin: (u) => {
          const t = t0 + (t1 - t0) * u;
          const prof = Math.sin(Math.min(1, u / 0.28) * Math.PI * 0.5) * (1 - 0.62 * u);
          return v(
            (t + 0.01) * L,
            centreY(f, t) - halfHeight(f, t) * 0.96 - f.depth * 0.42 * s * prof,
            0,
          );
        },
        normal: v(0, 0, 1),
        thickness: L * 0.005,
        camber: 0,
        nu,
        nv,
      }),
    );
  }
  // caudal — forked, the two lobes meet at a shallow centre
  {
    const tb = 0.965;
    const xb = tb * L;
    const yb = centreY(f, tb);
    const hb = halfHeight(f, tb);
    const span = L * 0.2;
    const lobe = L * (0.17 + 0.05 * f.forkDepth);
    fins.push(
      buildFin({
        base: (u) => {
          const a = (u - 0.5) * 2; // -1 lower lobe .. 1 upper lobe
          return v(xb, yb + a * hb, 0);
        },
        margin: (u) => {
          const a = (u - 0.5) * 2;
          const fork = 1 - f.forkDepth * (1 - Math.abs(a) ** 1.35);
          return v(xb + span * fork + L * 0.01, yb + a * lobe * (0.55 + 0.45 * Math.abs(a)), 0);
        },
        normal: v(0, 0, 1),
        thickness: L * 0.006,
        camber: 0,
        nu: nu + 3,
        nv,
      }),
    );
  }
  // pectorals — swept back, one per side
  for (const side of [1, -1]) {
    const t = 0.235;
    const ox = t * L;
    const oy = centreY(f, t) - halfHeight(f, t) * 0.12;
    const oz = side * halfWidth(f, t) * 0.93;
    fins.push(
      buildFin({
        base: (u) => v(ox + L * 0.022 * u, oy + f.depth * 0.16 * (0.5 - u), oz),
        margin: (u) => {
          const prof = Math.sin(Math.min(1, (u + 0.12) / 0.55) * Math.PI * 0.5) * (1 - 0.45 * u);
          return v(
            ox + L * (0.09 + 0.05 * u) * s * prof + L * 0.02,
            oy - f.depth * (0.34 + 0.2 * u) * s * prof,
            oz + side * f.width * 0.5 * prof,
          );
        },
        normal: v(0, 0.55, side * 0.83),
        thickness: L * 0.004,
        camber: side * L * 0.004,
        nu,
        nv: Math.max(3, nv - 1),
      }),
    );
  }
  // pelvics — short, below and slightly behind the pectorals
  for (const side of [1, -1]) {
    const t = 0.37;
    const ox = t * L;
    const oy = centreY(f, t) - halfHeight(f, t) * 0.94;
    const oz = side * halfWidth(f, t) * 0.35;
    fins.push(
      buildFin({
        base: (u) => v(ox + L * 0.02 * u, oy, oz),
        margin: (u) => {
          const prof = Math.sin(Math.min(1, (u + 0.2) / 0.6) * Math.PI * 0.5) * (1 - 0.5 * u);
          return v(ox + L * 0.05 * prof, oy - f.depth * 0.3 * s * prof, oz + side * f.width * 0.2 * prof);
        },
        normal: v(0, 0.2, side * 0.98),
        thickness: L * 0.0035,
        camber: 0,
        nu: Math.max(5, nu - 3),
        nv: Math.max(3, nv - 1),
      }),
    );
  }
  return mergeGeometries(fins);
}

export interface FishMeshes {
  group: THREE.Group;
  /** child frame that turns the body from hanging head-up to swimming level */
  tilt: THREE.Group;
  body: THREE.Mesh;
  fins: THREE.Mesh;
  form: FishForm;
  /** metres from the mouth (group origin) to the tail tip, straight down when hanging */
  hangLength: number;
}

export function makeFishMaterials(o: FishBuildOptions): {
  body: THREE.MeshPhysicalMaterial;
  fin: THREE.MeshPhysicalMaterial;
  eye: THREE.MeshPhysicalMaterial;
} {
  const body = new THREE.MeshPhysicalMaterial({
    map: o.fishMaps.map,
    roughnessMap: o.fishMaps.roughnessMap,
    normalMap: o.fishMaps.normalMap,
    normalScale: new THREE.Vector2(0.32, 0.32),
    metalness: 0.0,
    roughness: 1.0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.075,
    specularIntensity: 1.0,
    specularColor: new THREE.Color(0xdfeaf2),
    envMap: o.env,
    envMapIntensity: 0.55,
    sheen: 0.14,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0xbfd0d8),
  });
  const fin = new THREE.MeshPhysicalMaterial({
    map: o.finMaps.map,
    alphaMap: o.finMaps.alphaMap,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    metalness: 0,
    roughness: 0.34,
    clearcoat: 0.55,
    clearcoatRoughness: 0.2,
    envMap: o.env,
    envMapIntensity: 0.4,
    color: new THREE.Color(0xe6e8e2),
    transmission: o.transmission ? 0.42 : 0,
    thickness: 0.0015,
    ior: 1.34,
    attenuationDistance: 0.02,
    attenuationColor: new THREE.Color(0xa9b0ac),
  });
  const eye = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x10131a),
    metalness: 0,
    roughness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMap: o.env,
    envMapIntensity: 0.85,
  });
  return { body, fin, eye };
}

export function buildFish(
  form: FishForm,
  mats: { body: THREE.Material; fin: THREE.Material; eye: THREE.Material },
  o: FishBuildOptions,
): FishMeshes {
  const nu = o.bodySegments;
  const nv = o.radialSegments;
  const bodyGeo = buildBody(form, nu, nv);
  const finGeo = buildFins(form, o.bodySegments / 44);

  const body = new THREE.Mesh(bodyGeo, mats.body);
  const fins = new THREE.Mesh(finGeo, mats.fin);
  body.castShadow = true;
  fins.castShadow = false;
  body.renderOrder = 1;
  fins.renderOrder = 2;

  // eyes: small, set into the head, not character-sized
  const eyeR = form.depth * 0.15;
  const et = 0.085;
  const eyeGeo = new THREE.SphereGeometry(eyeR, 14, 10);
  const inner = new THREE.Group();
  for (const side of [1, -1]) {
    const e = new THREE.Mesh(eyeGeo, mats.eye);
    e.position.set(
      et * form.length,
      centreY(form, et) + halfHeight(form, et) * 0.38,
      side * (halfWidth(form, et) * 0.86),
    );
    e.scale.set(0.9, 1, 0.7);
    inner.add(e);
  }

  const pivot = new THREE.Group();
  // hooked fish hang head-up: local +X (snout->tail) points down in the parent frame
  inner.add(body, fins);
  inner.position.set(0, 0, 0);
  const tilt = new THREE.Group();
  tilt.rotation.z = -Math.PI / 2;
  tilt.add(inner);
  pivot.add(tilt);

  return {
    group: pivot,
    tilt,
    body,
    fins,
    form,
    hangLength: form.length * 1.2,
  };
}
