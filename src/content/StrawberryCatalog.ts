import * as THREE from 'three';
import { Rng, clamp, lerp } from '../core/rng';
import { ValueNoise } from '../core/noise';
import { makeCanvas, canvasTexture, normalTexture } from './Textures';
import type { AdaptiveQuality } from '../core/Quality';

/**
 * A lengthwise strawberry slice: a real 4-7 mm solid with a flat knife face on
 * each side, a curved skin band around the silhouette, a pale pith core and a
 * tip / shoulder that differ from berry to berry. Never a flat red card.
 */
export interface BerryVariant {
  id: string;
  label: string;
  length: number;
  width: number;
  depth: number;
  thickness: number;
  tipLen: number;
  tipSharp: number;
  shoulder: number;
  shoulderFlat: number;
  hullDip: number;
  bend: number;
  asym: number;
  pithWidth: number;
  pithReach: number;
  pithPale: number;
  flesh: string;
  fleshDeep: string;
  skin: string;
  pith: string;
  seedCoat: string;
  seed: number;
}

export const BERRY_VARIANTS: readonly BerryVariant[] = [
  {
    id: 'large',
    label: 'おおきい',
    length: 0.0345,
    width: 0.0268,
    depth: 0.0242,
    thickness: 0.0066,
    tipLen: 0.34,
    tipSharp: 0.62,
    shoulder: 0.2,
    shoulderFlat: 0.66,
    hullDip: 0.05,
    bend: 0.045,
    asym: 0.05,
    pithWidth: 0.34,
    pithReach: 0.72,
    pithPale: 0.82,
    flesh: '#d3323a',
    fleshDeep: '#9d1d27',
    skin: '#b21c26',
    pith: '#f4e2d8',
    seedCoat: '#d9c07a',
    seed: 1201,
  },
  {
    id: 'small',
    label: 'ちいさい',
    length: 0.0252,
    width: 0.0206,
    depth: 0.0188,
    thickness: 0.0045,
    tipLen: 0.4,
    tipSharp: 0.7,
    shoulder: 0.24,
    shoulderFlat: 0.58,
    hullDip: 0.07,
    bend: -0.05,
    asym: -0.07,
    pithWidth: 0.22,
    pithReach: 0.55,
    pithPale: 0.55,
    flesh: '#c92c37',
    fleshDeep: '#8f1922',
    skin: '#a5171f',
    pith: '#f0dcd0',
    seedCoat: '#c8ab63',
    seed: 2202,
  },
  {
    id: 'pointed',
    label: 'さきが ながい',
    length: 0.0372,
    width: 0.0218,
    depth: 0.0202,
    thickness: 0.0052,
    tipLen: 0.56,
    tipSharp: 0.5,
    shoulder: 0.17,
    shoulderFlat: 0.72,
    hullDip: 0.04,
    bend: 0.07,
    asym: 0.04,
    pithWidth: 0.26,
    pithReach: 0.62,
    pithPale: 0.7,
    flesh: '#cf2f36',
    fleshDeep: '#941a22',
    skin: '#ad1a22',
    pith: '#f2e0d4',
    seedCoat: '#d3b571',
    seed: 3303,
  },
  {
    id: 'round',
    label: 'かたが まるい',
    length: 0.0288,
    width: 0.0272,
    depth: 0.0256,
    thickness: 0.0062,
    tipLen: 0.46,
    tipSharp: 0.86,
    shoulder: 0.3,
    shoulderFlat: 0.5,
    hullDip: 0.09,
    bend: -0.03,
    asym: 0.06,
    pithWidth: 0.3,
    pithReach: 0.68,
    pithPale: 0.66,
    flesh: '#d63a40',
    fleshDeep: '#a02128',
    skin: '#b8212a',
    pith: '#f5e6dc',
    seedCoat: '#dcc384',
    seed: 4404,
  },
  {
    id: 'broadface',
    label: 'きりくちが ひろい',
    length: 0.0316,
    width: 0.0298,
    depth: 0.0234,
    thickness: 0.0071,
    tipLen: 0.38,
    tipSharp: 0.74,
    shoulder: 0.22,
    shoulderFlat: 0.68,
    hullDip: 0.06,
    bend: 0.02,
    asym: -0.05,
    pithWidth: 0.29,
    pithReach: 0.7,
    pithPale: 0.6,
    flesh: '#d13138',
    fleshDeep: '#991e26',
    skin: '#af1b24',
    pith: '#f3e1d6',
    seedCoat: '#d5b96f',
    seed: 5505,
  },
  {
    id: 'pale',
    label: 'しろい ところが おおい',
    length: 0.0304,
    width: 0.0236,
    depth: 0.0214,
    thickness: 0.0057,
    tipLen: 0.42,
    tipSharp: 0.66,
    shoulder: 0.26,
    shoulderFlat: 0.62,
    hullDip: 0.08,
    bend: -0.06,
    asym: 0.03,
    pithWidth: 0.52,
    pithReach: 0.86,
    pithPale: 1.0,
    flesh: '#d9555a',
    fleshDeep: '#ab353c',
    skin: '#bb3038',
    pith: '#f8efe8',
    seedCoat: '#dcc68d',
    seed: 6606,
  },
];

/* --------------------------------------------------------------- silhouette */

/** Half width (0..1 of `width`/2) at s, where s = 0 is the tip and 1 the hull. */
function halfWidth(v: BerryVariant, s: number): number {
  let w = 1;
  if (s < v.tipLen) w *= Math.pow(clamp(s / v.tipLen, 0, 1), v.tipSharp);
  if (s > 1 - v.shoulder) {
    const t = clamp((s - (1 - v.shoulder)) / v.shoulder, 0, 1);
    w *= Math.sqrt(Math.max(0, 1 - t * t * (1 - v.shoulderFlat * v.shoulderFlat)));
  }
  return w * (1 + 0.07 * Math.sin(Math.PI * s));
}

/** Lateral drift of the centreline: what keeps a berry from being symmetric. */
function centreLine(v: BerryVariant, s: number): number {
  return v.bend * Math.sin(Math.PI * s) * 0.5 + v.bend * 0.18 * Math.sin(Math.PI * 2.7 * s);
}

/** Closed silhouette polygon in the berry's own XY plane, CCW, metres. */
export function berryContour(v: BerryVariant, segments: number): THREE.Vector2[] {
  const hw = v.width / 2;
  const hl = v.length / 2;
  const ns = Math.max(12, Math.round(segments * 0.42));
  const pts: THREE.Vector2[] = [];
  const s0 = 0.02;

  const side = (s: number, sign: 1 | -1): THREE.Vector2 => {
    const w = halfWidth(v, s) * hw * (1 + sign * v.asym);
    const cx = centreLine(v, s) * hw;
    return new THREE.Vector2(cx + sign * w, -hl + s * v.length);
  };

  // Right flank, tip -> hull.
  for (let i = 0; i <= ns; i++) pts.push(side(s0 + (1 - s0) * (i / ns), 1));
  // Hull edge: shallow concave dip left by the removed calyx.
  const a = pts[pts.length - 1];
  const b = side(1, -1);
  const nt = Math.max(4, Math.round(segments * 0.09));
  for (let i = 1; i < nt; i++) {
    const t = i / nt;
    const x = lerp(a.x, b.x, t);
    const y = lerp(a.y, b.y, t) - Math.sin(Math.PI * t) * v.hullDip * v.length;
    pts.push(new THREE.Vector2(x, y));
  }
  // Left flank, hull -> tip.
  for (let i = 0; i <= ns; i++) pts.push(side(1 - (1 - s0) * (i / ns), -1));
  // Rounded tip: close the two flanks with a small arc instead of a spike.
  const l = pts[pts.length - 1];
  const r = pts[0];
  const mid = new THREE.Vector2((l.x + r.x) / 2, (l.y + r.y) / 2);
  const rad = l.distanceTo(r) / 2;
  const nb = Math.max(4, Math.round(segments * 0.07));
  for (let i = 1; i < nb; i++) {
    const t = i / nb;
    const ang = Math.PI * (1 - t);
    pts.push(
      new THREE.Vector2(
        mid.x - Math.cos(ang) * rad * (l.x < r.x ? -1 : 1),
        mid.y - Math.sin(ang) * rad * 0.92,
      ),
    );
  }

  // One light smoothing pass removes the slope break where the tip taper meets
  // the body, without rounding away the shoulder.
  const out: THREE.Vector2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + n - 1) % n];
    const s = pts[(i + 1) % n];
    out.push(
      new THREE.Vector2(
        p.x * 0.62 + q.x * 0.19 + s.x * 0.19,
        p.y * 0.62 + q.y * 0.19 + s.y * 0.19,
      ),
    );
  }
  return out;
}

function contourBox(contour: THREE.Vector2[]): THREE.Box2 {
  const box = new THREE.Box2();
  for (const p of contour) box.expandByPoint(p);
  return box;
}

/* ----------------------------------------------------------------- geometry */

function scaleAbout(pts: THREE.Vector2[], c: THREE.Vector2, k: number): THREE.Vector2[] {
  return pts.map((p) => new THREE.Vector2(c.x + (p.x - c.x) * k, c.y + (p.y - c.y) * k));
}

/**
 * Build the slice solid: flat cut face, skin band, flat back face. Group 0 is
 * flesh (the two knife faces), group 1 is skin (the curved rim).
 */
export function buildSliceGeometry(
  v: BerryVariant,
  segments: number,
  box: THREE.Box2,
): THREE.BufferGeometry {
  const mid = berryContour(v, segments);
  const centroid = new THREE.Vector2();
  for (const p of mid) centroid.add(p);
  centroid.multiplyScalar(1 / mid.length);

  const half = v.thickness / 2;
  const k = Math.sqrt(Math.max(0.4, 1 - (half / (v.depth / 2)) ** 2));
  const face = scaleAbout(mid, centroid, k);
  const n = mid.length;

  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const bw = box.max.x - box.min.x;
  const bh = box.max.y - box.min.y;

  const faceUv = (p: THREE.Vector2): [number, number] => [
    (p.x - box.min.x) / bw,
    (p.y - box.min.y) / bh,
  ];

  const tris = THREE.ShapeUtils.triangulateShape(face, []);

  // Front cut face (+Z).
  const frontBase = 0;
  for (const p of face) {
    pos.push(p.x, p.y, half);
    nor.push(0, 0, 1);
    const [u, w] = faceUv(p);
    uv.push(u, w);
  }
  for (const t of tris) idx.push(frontBase + t[0], frontBase + t[1], frontBase + t[2]);

  // Back cut face (-Z), mirrored so the pith reads through from either side.
  const backBase = pos.length / 3;
  for (const p of face) {
    pos.push(p.x, p.y, -half);
    nor.push(0, 0, -1);
    const [u, w] = faceUv(p);
    uv.push(1 - u, w);
  }
  for (const t of tris) idx.push(backBase + t[2], backBase + t[1], backBase + t[0]);

  const capCount = idx.length;

  // Skin band: front rim -> equator -> back rim.
  const arc: number[] = [0];
  for (let i = 1; i <= n; i++) {
    arc.push(arc[i - 1] + mid[i % n].distanceTo(mid[i - 1]));
  }
  const total = arc[n];
  const bandBase = pos.length / 3;
  const rings: THREE.Vector2[][] = [face, mid, face];
  const zs = [half, 0, -half];
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < n; i++) {
      const p = rings[r][i];
      pos.push(p.x, p.y, zs[r]);
      const outward = new THREE.Vector2(p.x - centroid.x, p.y - centroid.y).normalize();
      const zn = r === 0 ? 0.62 : r === 2 ? -0.62 : 0;
      const nv = new THREE.Vector3(outward.x, outward.y, zn).normalize();
      nor.push(nv.x, nv.y, nv.z);
      uv.push((arc[i] / total) * 6, (zs[r] / v.thickness + 0.5) * 0.5 + 0.25);
    }
  }
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = bandBase + r * n + i;
      const b = bandBase + r * n + j;
      const c = bandBase + (r + 1) * n + j;
      const d = bandBase + (r + 1) * n + i;
      idx.push(a, b, c, a, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geom.setIndex(idx);
  geom.addGroup(0, capCount, 0);
  geom.addGroup(capCount, idx.length - capCount, 1);
  geom.computeBoundingSphere();
  geom.computeBoundingBox();
  return geom;
}

/**
 * The same solid as `buildSliceGeometry`, but welded: one shared ring of
 * vertices between the knife faces and the skin band, positions only. The
 * section code needs a watertight hull so it can chain a cut outline through
 * shared mesh edges instead of comparing floating point positions.
 */
export function buildSliceCollider(
  v: BerryVariant,
  segments: number,
): THREE.BufferGeometry {
  const mid = berryContour(v, segments);
  const centroid = new THREE.Vector2();
  for (const p of mid) centroid.add(p);
  centroid.multiplyScalar(1 / mid.length);

  const half = v.thickness / 2;
  const k = Math.sqrt(Math.max(0.4, 1 - (half / (v.depth / 2)) ** 2));
  const face = scaleAbout(mid, centroid, k);
  const n = mid.length;

  const pos = new Float32Array(n * 3 * 3);
  const rings = [face, mid, face];
  const zs = [half, 0, -half];
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < n; i++) {
      const p = rings[r][i];
      const o = (r * n + i) * 3;
      pos[o] = p.x;
      pos[o + 1] = p.y;
      pos[o + 2] = zs[r];
    }
  }

  const idx: number[] = [];
  const tris = THREE.ShapeUtils.triangulateShape(face, []);
  for (const t of tris) idx.push(t[0], t[1], t[2]);
  for (const t of tris) idx.push(2 * n + t[2], 2 * n + t[1], 2 * n + t[0]);
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = r * n + i;
      const b = r * n + j;
      const c = (r + 1) * n + j;
      const d = (r + 1) * n + i;
      idx.push(a, b, c, a, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setIndex(idx);
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

/* ----------------------------------------------------------------- textures */

interface BerryMaps {
  flesh: THREE.Texture;
  fleshNormal: THREE.Texture;
  fleshRough: THREE.Texture;
  skin: THREE.Texture;
  skinNormal: THREE.Texture;
  skinRough: THREE.Texture;
}

/**
 * The cut-face map is authored in the berry's own (width, length) frame, so a
 * section polygon can sample it directly: a cut parallel to the face lands on
 * the whole silhouette with its skin ring and seed cross sections, and a cut
 * across the slab samples a narrow column through the pith. Both are correct
 * for the same painted interior.
 */
function buildFleshMap(v: BerryVariant, size: number, anisotropy: number): {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
} {
  const { canvas, ctx } = makeCanvas(size);
  const rough = makeCanvas(size);
  const rng = new Rng(v.seed);
  const noise = new ValueNoise(v.seed ^ 0x77, 64);
  const height = new Float32Array(size * size);

  const contour = berryContour(v, 192);
  const box = contourBox(contour);
  const bw = box.max.x - box.min.x;
  const bh = box.max.y - box.min.y;
  const toPx = (p: THREE.Vector2): [number, number] => [
    ((p.x - box.min.x) / bw) * size,
    (1 - (p.y - box.min.y) / bh) * size,
  ];

  // Outside the silhouette reads as skin so any overshoot at the polygon edge
  // still looks like the outside of a berry.
  ctx.fillStyle = v.skin;
  ctx.fillRect(0, 0, size, size);

  const path = new Path2D();
  contour.forEach((p, i) => {
    const [x, y] = toPx(p);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  path.closePath();

  ctx.save();
  ctx.clip(path);

  // Flesh body: deeper toward the skin, warmer toward the core.
  const g = ctx.createRadialGradient(
    size * 0.5,
    size * 0.55,
    size * 0.05,
    size * 0.5,
    size * 0.5,
    size * 0.62,
  );
  g.addColorStop(0, v.flesh);
  g.addColorStop(0.62, v.flesh);
  g.addColorStop(1, v.fleshDeep);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // Pith: a pale column, widest under the hull, fading out before the tip.
  const pithSteps = 16;
  for (let step = pithSteps; step >= 1; step--) {
    const spread = step / pithSteps;
    ctx.beginPath();
    let started = false;
    for (let side = 0; side < 2; side++) {
      const dir = side === 0 ? 1 : -1;
      for (let i = 0; i <= 48; i++) {
        const s = side === 0 ? i / 48 : 1 - i / 48;
        const reach = clamp((s - 0.08) / (v.pithReach - 0.08), 0, 1);
        const taper = Math.pow(Math.sin(Math.PI * 0.5 * reach), 0.7) * (0.45 + 0.55 * s);
        const w =
          halfWidth(v, s) * (v.width / 2) * v.pithWidth * taper * (0.55 + spread * 0.62);
        const cx = centreLine(v, s) * (v.width / 2);
        const p = new THREE.Vector2(cx + dir * w, -v.length / 2 + s * v.length);
        const [x, y] = toPx(p);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
    ctx.fillStyle = v.pith;
    // Light passes: a strawberry core is pale, not painted white.
    ctx.globalAlpha = 0.030 * v.pithPale + 0.011;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Internal fibres running from the core out to the skin.
  const fibres = Math.round(90 + rng.next() * 40);
  for (let i = 0; i < fibres; i++) {
    const s = rng.range(0.1, 0.98);
    const dir = rng.next() < 0.5 ? 1 : -1;
    const w = halfWidth(v, s) * (v.width / 2);
    const cx = centreLine(v, s) * (v.width / 2);
    const y = -v.length / 2 + s * v.length;
    const inner = new THREE.Vector2(cx + dir * w * rng.range(0.05, 0.3), y);
    const outerS = clamp(s + rng.jitter(0.06), 0.05, 0.99);
    const outer = new THREE.Vector2(
      centreLine(v, outerS) * (v.width / 2) +
        dir * halfWidth(v, outerS) * (v.width / 2) * rng.range(0.86, 0.98),
      -v.length / 2 + outerS * v.length,
    );
    const [x0, y0] = toPx(inner);
    const [x1, y1] = toPx(outer);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(
      (x0 + x1) / 2 + rng.jitter(size * 0.012),
      (y0 + y1) / 2 + rng.jitter(size * 0.012),
      x1,
      y1,
    );
    ctx.lineWidth = rng.range(0.6, 2.0) * (size / 1024);
    ctx.strokeStyle = rng.next() < 0.62 ? 'rgba(250,232,224,0.30)' : 'rgba(146,26,34,0.24)';
    ctx.stroke();
  }

  // Achene cross sections sit just inside the skin, irregularly spaced.
  let acc = 0;
  const step = size * 0.052;
  for (let i = 1; i < contour.length; i++) {
    acc += Math.hypot(
      (contour[i].x - contour[i - 1].x) / bw,
      (contour[i].y - contour[i - 1].y) / bh,
    ) * size;
    if (acc < step * rng.range(0.5, 1.8)) continue;
    acc = 0;
    const p = contour[i];
    const inwardX = (size * 0.5 - ((p.x - box.min.x) / bw) * size) * 0.055;
    const inwardY = (size * 0.5 - (1 - (p.y - box.min.y) / bh) * size) * 0.055;
    const [x, y] = toPx(p);
    const rx = rng.range(2.4, 5.4) * (size / 1024);
    ctx.save();
    ctx.translate(x + inwardX, y + inwardY);
    ctx.rotate(rng.next() * Math.PI);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, rx * rng.range(0.55, 0.8), 0, 0, Math.PI * 2);
    ctx.fillStyle = v.seedCoat;
    ctx.globalAlpha = rng.range(0.55, 0.85);
    ctx.fill();
    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = 'rgba(122,20,26,0.7)';
    ctx.lineWidth = 1.1 * (size / 1024);
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // Skin ring plus the pale vascular line just inside it.
  ctx.strokeStyle = v.skin;
  ctx.lineWidth = size * 0.0072;
  ctx.stroke(path);
  ctx.strokeStyle = 'rgba(252,238,232,0.42)';
  ctx.lineWidth = size * 0.0045;
  ctx.save();
  ctx.clip(path);
  ctx.stroke(path);
  ctx.restore();

  // Fine grain, plus the roughness split between wet flesh and dry pith.
  const img = ctx.getImageData(0, 0, size, size);
  const rimg = rough.ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const n = noise.fbm(x / size + 1.3, y / size + 4.1, 40, 3);
      const m = (n - 0.5) * 16;
      img.data[o] = clamp(img.data[o] + m, 0, 255);
      img.data[o + 1] = clamp(img.data[o + 1] + m * 0.8, 0, 255);
      img.data[o + 2] = clamp(img.data[o + 2] + m * 0.7, 0, 255);
      const lum = (img.data[o] + img.data[o + 1] + img.data[o + 2]) / 765;
      const pale = clamp((img.data[o + 2] / 255 - 0.4) * 2.2, 0, 1);
      // A knife face is smooth; only the pith is matte.
      const r = lerp(0.30, 0.62, pale) + (n - 0.5) * 0.05;
      const c = Math.round(clamp(r, 0, 1) * 255);
      rimg.data[o] = c;
      rimg.data[o + 1] = c;
      rimg.data[o + 2] = c;
      rimg.data[o + 3] = 255;
      height[y * size + x] = 0.5 + (lum - 0.5) * 0.25 + (n - 0.5) * 0.5;
    }
  }
  ctx.putImageData(img, 0, 0);
  rough.ctx.putImageData(rimg, 0, 0);

  return {
    map: canvasTexture(canvas, { anisotropy }),
    // Deliberately shallow: the blade leaves a flat face, not a rough one.
    normalMap: normalTexture(height, size, size / 260, anisotropy),
    roughnessMap: canvasTexture(rough.canvas, { srgb: false, anisotropy }),
  };
}

function buildSkinMap(v: BerryVariant, size: number, anisotropy: number): {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
} {
  const s = Math.max(256, size >> 1);
  const { canvas, ctx } = makeCanvas(s);
  const rough = makeCanvas(s);
  const rng = new Rng(v.seed ^ 0x1234);
  const noise = new ValueNoise(v.seed ^ 0x99, 64);
  const height = new Float32Array(s * s);

  ctx.fillStyle = v.skin;
  ctx.fillRect(0, 0, s, s);

  // Achene pits, scattered without a lattice.
  const count = Math.round(s * s / 640);
  for (let i = 0; i < count; i++) {
    const cx = rng.next() * s;
    const cy = rng.next() * s;
    const r = rng.range(2.2, 4.4) * (s / 512);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rng.next() * Math.PI);
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.66, 0, 0, Math.PI * 2);
    ctx.fillStyle = rng.next() < 0.7 ? v.seedCoat : '#8d5f2c';
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = 'rgba(96,12,18,0.9)';
    ctx.lineWidth = 1.4 * (s / 512);
    ctx.stroke();
    ctx.restore();
    const ri = Math.ceil(r * 1.6);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        const d = Math.hypot(dx, dy / 0.66) / r;
        if (d > 1.6) continue;
        const x = (Math.round(cx) + dx + s) % s;
        const y = (Math.round(cy) + dy + s) % s;
        height[y * s + x] += d < 1 ? -0.55 * (1 - d * d) : 0.18 * (1.6 - d);
      }
    }
  }
  ctx.globalAlpha = 1;

  const img = ctx.getImageData(0, 0, s, s);
  const rimg = rough.ctx.createImageData(s, s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const o = (y * s + x) * 4;
      const n = noise.fbm(x / s, y / s, 12, 4);
      const m = (n - 0.5) * 26;
      img.data[o] = clamp(img.data[o] + m, 0, 255);
      img.data[o + 1] = clamp(img.data[o + 1] + m * 0.5, 0, 255);
      img.data[o + 2] = clamp(img.data[o + 2] + m * 0.5, 0, 255);
      // Berry skin is satin: never a mirror, never chalk.
      const c = Math.round(clamp(0.40 + (n - 0.5) * 0.22, 0, 1) * 255);
      rimg.data[o] = c;
      rimg.data[o + 1] = c;
      rimg.data[o + 2] = c;
      rimg.data[o + 3] = 255;
      height[y * s + x] += (n - 0.5) * 0.3;
    }
  }
  ctx.putImageData(img, 0, 0);
  rough.ctx.putImageData(rimg, 0, 0);

  const nt = normalTexture(height, s, s / 24, anisotropy);

  return {
    map: canvasTexture(canvas, { anisotropy }),
    normalMap: nt,
    roughnessMap: canvasTexture(rough.canvas, { srgb: false, anisotropy }),
  };
}

/* ------------------------------------------------------------------ catalog */

export interface BerryAssets {
  variant: BerryVariant;
  box: THREE.Box2;
  near: THREE.BufferGeometry;
  far: THREE.BufferGeometry;
  /** Welded hull used by the section generator. */
  collider: THREE.BufferGeometry;
  maps: BerryMaps;
  achenes: { matrices: THREE.Matrix4[]; colors: THREE.Color[] };
}

export class StrawberryCatalog {
  private readonly assets = new Map<string, BerryAssets>();

  constructor(private readonly quality: AdaptiveQuality) {}

  variants(): readonly BerryVariant[] {
    return BERRY_VARIANTS;
  }

  variant(id: string): BerryVariant {
    return BERRY_VARIANTS.find((v) => v.id === id) ?? BERRY_VARIANTS[0];
  }

  get(id: string): BerryAssets {
    const hit = this.assets.get(id);
    if (hit) return hit;
    const v = this.variant(id);
    const aniso = Math.min(8, this.quality.maxAnisotropy);
    const size = this.quality.textureSize;
    const contour = berryContour(v, 192);
    const box = contourBox(contour);
    const flesh = buildFleshMap(v, size, aniso);
    const skin = buildSkinMap(v, size, aniso);
    const made: BerryAssets = {
      variant: v,
      box,
      near: buildSliceGeometry(v, this.quality.berrySegments, box),
      far: buildSliceGeometry(v, 28, box),
      collider: buildSliceCollider(v, this.quality.sectionSegments),
      maps: {
        flesh: flesh.map,
        fleshNormal: flesh.normalMap,
        fleshRough: flesh.roughnessMap,
        skin: skin.map,
        skinNormal: skin.normalMap,
        skinRough: skin.roughnessMap,
      },
      achenes: buildAchenes(v, contour, this.quality.acheneCount),
    };
    this.assets.set(id, made);
    return made;
  }

  dispose(): void {
    for (const a of this.assets.values()) {
      a.near.dispose();
      a.far.dispose();
      a.collider.dispose();
      for (const t of Object.values(a.maps)) t.dispose();
    }
    this.assets.clear();
  }
}

/** Seeds sitting proud of the skin band; near LOD only. */
function buildAchenes(
  v: BerryVariant,
  contour: THREE.Vector2[],
  count: number,
): { matrices: THREE.Matrix4[]; colors: THREE.Color[] } {
  const matrices: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  if (count <= 0) return { matrices, colors };
  const rng = new Rng(v.seed ^ 0xa11);
  const base = new THREE.Color(v.seedCoat);
  const dark = new THREE.Color('#7d4f22');
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < count; i++) {
    const t = (i + rng.range(-0.35, 0.35)) / count;
    const fi = clamp(t, 0, 0.9999) * contour.length;
    const i0 = Math.floor(fi) % contour.length;
    const i1 = (i0 + 1) % contour.length;
    const f = fi - Math.floor(fi);
    const p = contour[i0].clone().lerp(contour[i1], f);
    const tangent = contour[i1].clone().sub(contour[i0]).normalize();
    const nrm = new THREE.Vector3(tangent.y, -tangent.x, 0).normalize();
    const z = rng.range(-0.28, 0.28) * v.thickness;
    const m = new THREE.Matrix4();
    q.setFromUnitVectors(up, nrm);
    const scale = rng.range(0.72, 1.25);
    m.compose(
      new THREE.Vector3(p.x + nrm.x * 0.0002, p.y + nrm.y * 0.0002, z),
      q.clone().multiply(
        new THREE.Quaternion().setFromAxisAngle(up, rng.next() * Math.PI),
      ),
      new THREE.Vector3(0.00062 * scale, 0.00042 * scale, 0.00030 * scale),
    );
    matrices.push(m);
    colors.push(base.clone().lerp(dark, rng.next() * 0.7));
  }
  return { matrices, colors };
}
