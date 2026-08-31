import { clamp } from '../util/math';

export type GestureKind = 'star' | 'shell' | 'rosette' | 'rope' | 'ribbon';

export interface PathPoint {
  x: number;
  z: number;
  t: number;
}

export interface GestureResult {
  kind: GestureKind;
  /** total travelled length (m) */
  length: number;
  /** straight line start→end (m) */
  net: number;
  duration: number;
  /** unit direction of the overall move */
  dirX: number;
  dirZ: number;
  /** loop fit, only meaningful for rosette */
  cx: number;
  cz: number;
  radius: number;
  /** signed, in turns */
  turns: number;
  /** how many times the stroke reversed its turn direction */
  oscillations: number;
}

/**
 * Reads the shape of the stroke the child actually made. Every outcome is a
 * valid decoration — this only decides which structure to build, never whether
 * the player did well.
 */
export function classifyGesture(path: PathPoint[], oscillations: number): GestureResult {
  const n = path.length;
  const first = path[0];
  const last = path[n - 1];
  let length = 0;
  for (let i = 1; i < n; i++) {
    length += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  }
  const dx = last.x - first.x;
  const dz = last.z - first.z;
  const net = Math.hypot(dx, dz);
  const duration = Math.max(1e-3, last.t - first.t);

  // signed turning, and a circle fit over the whole stroke
  let turns = 0;
  let cx = 0;
  let cz = 0;
  for (const p of path) {
    cx += p.x;
    cz += p.z;
  }
  cx /= n;
  cz /= n;
  let radius = 0;
  for (const p of path) radius += Math.hypot(p.x - cx, p.z - cz);
  radius /= n;
  // how close the stroke is to lying on one circle — a bowed line is not a loop
  let variance = 0;
  for (const p of path) {
    const d = Math.hypot(p.x - cx, p.z - cz) - radius;
    variance += d * d;
  }
  const circularity = radius > 1e-5 ? Math.sqrt(variance / n) / radius : 1;

  let prevAng = 0;
  let havePrev = false;
  for (let i = 1; i < n; i++) {
    const ax = path[i].x - cx;
    const az = path[i].z - cz;
    if (Math.hypot(ax, az) < 1e-4) continue;
    const ang = Math.atan2(az, ax);
    if (havePrev) {
      let d = ang - prevAng;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      turns += d;
    }
    prevAng = ang;
    havePrev = true;
  }
  turns /= Math.PI * 2;

  const straightness = length > 1e-5 ? net / length : 0;
  const dirLen = net > 1e-6 ? net : 1;

  let kind: GestureKind;
  if (length < 0.0075) {
    kind = 'star';
  } else if (oscillations >= 3 && length > 0.016 && Math.abs(turns) < 0.85) {
    // keeps reversing its turn direction and never closes on itself
    kind = 'ribbon';
  } else if (
    Math.abs(turns) > 0.60 &&
    straightness < 0.52 &&
    radius > 0.0042 &&
    circularity < 0.55
  ) {
    kind = 'rosette';
  } else if (length < 0.042 && straightness > 0.58 && duration < 1.8) {
    kind = 'shell';
  } else {
    kind = 'rope';
  }

  return {
    kind,
    length,
    net,
    duration,
    dirX: dx / dirLen,
    dirZ: dz / dirLen,
    cx,
    cz,
    radius: clamp(radius, 0.004, 0.045),
    turns,
    oscillations,
  };
}
