import { clamp, lerp } from '../util/math';

export type NozzleId = 'openStar' | 'round' | 'petal';

/**
 * A closed 2D cross-section, in metres, expressed in the (u, v) plane of the
 * extrusion frame. This single polyline is what gets swept: the silhouette of
 * every piped shape therefore comes from real geometry, never from a normal map.
 */
export interface Profile {
  /** flat [u0, v0, u1, v1, ...], closed loop, counter-clockwise */
  pts: Float32Array;
  count: number;
  /** cross-section area (m^2) */
  area: number;
  /** largest distance from the section centroid */
  maxR: number;
  /** per-point convexity, 0 in a valley .. 1 on a ridge tip */
  ridge: Float32Array;
  /** arc-length parameter 0..1 around the loop, for UVs */
  arc: Float32Array;
}

export interface NozzleSpec {
  id: NozzleId;
  label: string;
  /** inner opening: this is what the cream is */
  opening: Profile;
  /** cream section — the opening, very slightly relaxed as real cream does */
  cream: Profile;
  /** sheet-metal wall thickness (m) */
  wall: number;
  /** overall nozzle body length (m) */
  length: number;
  /** radius of the wide (bag) end */
  topRadius: number;
  /** how strongly the section should keep a world-up alignment while sweeping */
  rollLock: number;
  /** base extrusion speed multiplier */
  flowScale: number;
}

function buildProfile(u: number[], v: number[]): Profile {
  const n = u.length;
  const pts = new Float32Array(n * 2);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += u[i];
    cy += v[i];
  }
  cx /= n;
  cy /= n;
  for (let i = 0; i < n; i++) {
    pts[i * 2] = u[i] - cx;
    pts[i * 2 + 1] = v[i] - cy;
  }

  // shoelace area; flip winding to CCW if needed
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area2 += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  if (area2 < 0) {
    for (let i = 0; i < n >> 1; i++) {
      const k = n - 1 - i;
      const au = pts[i * 2];
      const av = pts[i * 2 + 1];
      pts[i * 2] = pts[k * 2];
      pts[i * 2 + 1] = pts[k * 2 + 1];
      pts[k * 2] = au;
      pts[k * 2 + 1] = av;
    }
    area2 = -area2;
  }

  let maxR = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(pts[i * 2], pts[i * 2 + 1]);
    if (r > maxR) maxR = r;
  }

  // convexity: signed turn at each vertex, normalised
  const ridge = new Float32Array(n);
  let maxTurn = 1e-6;
  const turns = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const h = (i - 1 + n) % n;
    const j = (i + 1) % n;
    const ax = pts[i * 2] - pts[h * 2];
    const ay = pts[i * 2 + 1] - pts[h * 2 + 1];
    const bx = pts[j * 2] - pts[i * 2];
    const by = pts[j * 2 + 1] - pts[i * 2 + 1];
    const cross = ax * by - ay * bx;
    const dot = ax * bx + ay * by;
    const t = Math.atan2(cross, dot);
    turns[i] = t;
    if (Math.abs(t) > maxTurn) maxTurn = Math.abs(t);
  }
  for (let i = 0; i < n; i++) ridge[i] = clamp(turns[i] / maxTurn, -1, 1) * 0.5 + 0.5;

  const arc = new Float32Array(n);
  let total = 0;
  for (let i = 1; i < n; i++) {
    total += Math.hypot(pts[i * 2] - pts[(i - 1) * 2], pts[i * 2 + 1] - pts[(i - 1) * 2 + 1]);
    arc[i] = total;
  }
  const closing =
    total + Math.hypot(pts[0] - pts[(n - 1) * 2], pts[1] - pts[(n - 1) * 2 + 1]);
  for (let i = 0; i < n; i++) arc[i] = closing > 0 ? arc[i] / closing : 0;

  return { pts, count: n, area: area2 * 0.5, maxR, ridge, arc };
}

/** Offset a closed profile outward along its vertex normals (used for the metal wall). */
export function offsetProfile(p: Profile, d: number): Profile {
  const n = p.count;
  const u: number[] = new Array(n);
  const v: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const h = (i - 1 + n) % n;
    const j = (i + 1) % n;
    const tx = p.pts[j * 2] - p.pts[h * 2];
    const ty = p.pts[j * 2 + 1] - p.pts[h * 2 + 1];
    const l = Math.hypot(tx, ty) || 1;
    // CCW loop -> outward normal is (ty, -tx)
    u[i] = p.pts[i * 2] + (ty / l) * d;
    v[i] = p.pts[i * 2 + 1] + (-tx / l) * d;
  }
  return buildProfile(u, v);
}

/** Blend a profile toward its own smoothed self — cream rounds the metal edge a hair. */
export function relaxProfile(p: Profile, k: number, passes = 1): Profile {
  const n = p.count;
  let u = new Float64Array(n);
  let vv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    u[i] = p.pts[i * 2];
    vv[i] = p.pts[i * 2 + 1];
  }
  for (let pass = 0; pass < passes; pass++) {
    const nu = new Float64Array(n);
    const nv = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const h = (i - 1 + n) % n;
      const j = (i + 1) % n;
      nu[i] = lerp(u[i], (u[h] + u[j]) * 0.5, k);
      nv[i] = lerp(vv[i], (vv[h] + vv[j]) * 0.5, k);
    }
    u = nu;
    vv = nv;
  }
  return buildProfile(Array.from(u), Array.from(vv));
}

/** 8-tooth open star, the classic 1M/824 shape. */
export function openStarOpening(samplesPerTooth: number): Profile {
  const teeth = 8;
  const R = 0.00575;
  const r = 0.00318;
  const n = teeth * samplesPerTooth;
  const u: number[] = [];
  const v: number[] = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const c = 0.5 + 0.5 * Math.cos(teeth * th);
    // sharp-ish tip, rounded valley — the real punched profile
    const shape = Math.pow(c, 0.78);
    const rad = r + (R - r) * shape;
    u.push(Math.cos(th) * rad);
    v.push(Math.sin(th) * rad);
  }
  return buildProfile(u, v);
}

/** Plain round tip (Wilton 12 / Ateco 806-ish). */
export function roundOpening(segments: number): Profile {
  const R = 0.00475;
  const u: number[] = [];
  const v: number[] = [];
  for (let i = 0; i < segments; i++) {
    const th = (i / segments) * Math.PI * 2;
    u.push(Math.cos(th) * R);
    v.push(Math.sin(th) * R);
  }
  return buildProfile(u, v);
}

/**
 * Petal / rose tip (104-style): a long slot, fat on one side, knife-thin on the
 * other, with a slight banana curve. The thin edge is at +u.
 */
export function petalOpening(samples: number): Profile {
  const L = 0.0132;
  const thick = 0.00175;
  const thin = 0.00026;
  const bow = 0.10;
  const half = Math.max(6, samples >> 1);
  const side = (sign: number, from: number, to: number): { u: number[]; v: number[] } => {
    const uu: number[] = [];
    const vv: number[] = [];
    for (let i = 0; i <= half; i++) {
      const s = lerp(from, to, i / half);
      const sx = (s - 0.5) * L;
      const sy = Math.sin(Math.PI * s) * bow * L;
      let h = thin + (thick - thin) * Math.pow(1 - s, 0.62);
      // round off the fat end instead of leaving a square corner
      const capT = clamp(s / 0.16, 0, 1);
      h *= Math.sqrt(Math.max(0.0001, 1 - (1 - capT) * (1 - capT)));
      // outline normal is roughly the section's short axis
      uu.push(sx);
      vv.push(sy + sign * h);
    }
    return { u: uu, v: vv };
  };
  const a = side(1, 0, 1);
  const b = side(-1, 1, 0);
  return buildProfile([...a.u, ...b.u], [...a.v, ...b.v]);
}

export interface ProfileQuality {
  /** samples per star tooth */
  starTooth: number;
  roundSegments: number;
  petalSamples: number;
}

export function buildNozzles(q: ProfileQuality): Record<NozzleId, NozzleSpec> {
  const star = openStarOpening(q.starTooth);
  const round = roundOpening(q.roundSegments);
  const petal = petalOpening(q.petalSamples);
  return {
    openStar: {
      id: 'openStar',
      label: 'オープンスター',
      opening: star,
      cream: relaxProfile(star, 0.24, 1),
      wall: 0.00036,
      length: 0.0315,
      topRadius: 0.0092,
      rollLock: 0.25,
      flowScale: 1,
    },
    round: {
      id: 'round',
      label: 'まる',
      opening: round,
      cream: relaxProfile(round, 0.1, 1),
      wall: 0.00034,
      length: 0.0305,
      topRadius: 0.009,
      rollLock: 0,
      flowScale: 0.95,
    },
    petal: {
      id: 'petal',
      label: 'はなびら',
      opening: petal,
      cream: relaxProfile(petal, 0.3, 2),
      wall: 0.0003,
      length: 0.0325,
      topRadius: 0.0092,
      rollLock: 1,
      flowScale: 0.82,
    },
  };
}
