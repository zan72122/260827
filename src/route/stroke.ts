import * as THREE from 'three';
import type { Seabed } from '../world/terrain';

// One-stroke route processing. Rules honored here:
//  - big detours / left-right asymmetry are PRESERVED (small smoothing window)
//  - finger jitter is removed
//  - corners sharper than the cable's minimum bend radius are rounded
//  - we never collapse the stroke to just its endpoints or a shortest path
const RESAMPLE_STEP = 2.0;     // metres between samples
const MIN_BEND_RADIUS = 9.0;   // metres - cable cannot turn tighter than this
const SNAP_RADIUS = 14.0;      // how close the stroke must start/end to anchors

export interface StrokeResult {
  ok: boolean;
  reason?: 'tooShort' | 'startFar' | 'endFar';
  /** Smoothed XZ polyline from anchor A to anchor B (y = 0). */
  points: THREE.Vector3[];
}

function resample(pts: THREE.Vector3[], step: number): THREE.Vector3[] {
  if (pts.length < 2) return pts.slice();
  const out: THREE.Vector3[] = [pts[0].clone()];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1], b = pts[i];
    let segLen = a.distanceTo(b);
    while (acc + segLen >= step) {
      const t = (step - acc) / segLen;
      const np = a.clone().lerp(b, t);
      out.push(np);
      a = np;
      segLen = a.distanceTo(b);
      acc = 0;
    }
    acc += segLen;
  }
  out.push(pts[pts.length - 1].clone());
  return out;
}

/** Small-window moving average: kills jitter, keeps the big shape. */
function smoothJitter(pts: THREE.Vector3[], passes: number): THREE.Vector3[] {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    const next = cur.map((v) => v.clone());
    for (let i = 1; i < cur.length - 1; i++) {
      next[i].x = cur[i - 1].x * 0.25 + cur[i].x * 0.5 + cur[i + 1].x * 0.25;
      next[i].z = cur[i - 1].z * 0.25 + cur[i].z * 0.5 + cur[i + 1].z * 0.25;
    }
    cur = next;
  }
  return cur;
}

/** Iteratively relax interior points until every turn respects MIN_BEND_RADIUS. */
function clampCurvature(pts: THREE.Vector3[], step: number, iterations = 160): void {
  const maxTurn = (step / MIN_BEND_RADIUS) * 0.85; // margin under the limit
  const a = new THREE.Vector2(), b = new THREE.Vector2();
  for (let iter = 0; iter < iterations; iter++) {
    let worst = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      a.set(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      b.set(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
      if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) continue;
      const turn = Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));
      if (turn > maxTurn) {
        worst = Math.max(worst, turn);
        const mx = (pts[i - 1].x + pts[i + 1].x) * 0.5;
        const mz = (pts[i - 1].z + pts[i + 1].z) * 0.5;
        const k = Math.min(0.75, (turn - maxTurn) / turn + 0.15);
        pts[i].x += (mx - pts[i].x) * k;
        pts[i].z += (mz - pts[i].z) * k;
      }
    }
    if (worst < maxTurn * 1.02) break;
  }
}

/** Keep the route in water deep enough for the ship (except near anchors). */
function pushOffLand(pts: THREE.Vector3[], seabed: Seabed): void {
  for (let i = 1; i < pts.length - 1; i++) {
    const tEnd = Math.min(i, pts.length - 1 - i);
    if (tEnd < 4) continue; // allow the shore approach near the ends
    let h = seabed.height(pts[i].x, pts[i].z);
    if (h > -3) {
      // Slide toward the map centre line until wet.
      for (let k = 0; k < 20 && h > -3; k++) {
        pts[i].z *= 0.9;
        pts[i].x *= 0.985;
        h = seabed.height(pts[i].x, pts[i].z);
      }
    }
  }
}

export function processStroke(
  raw: THREE.Vector3[],
  seabed: Seabed
): StrokeResult {
  if (raw.length < 4) return { ok: false, reason: 'tooShort', points: [] };
  const A = seabed.anchorA, B = seabed.anchorB;

  let pts = raw.map((p) => new THREE.Vector3(p.x, 0, p.z));

  // Accept either direction, canonicalize to A -> B.
  const startNearA = pts[0].distanceTo(new THREE.Vector3(A.x, 0, A.z));
  const startNearB = pts[0].distanceTo(new THREE.Vector3(B.x, 0, B.z));
  if (startNearB < startNearA) pts = pts.reverse();

  const dStart = Math.hypot(pts[0].x - A.x, pts[0].z - A.z);
  const dEnd = Math.hypot(pts[pts.length - 1].x - B.x, pts[pts.length - 1].z - B.z);
  if (dStart > SNAP_RADIUS) return { ok: false, reason: 'startFar', points: [] };
  if (dEnd > SNAP_RADIUS) return { ok: false, reason: 'endFar', points: [] };

  // Pin the true endpoints, then process the interior.
  pts[0].set(A.x, 0, A.z);
  pts[pts.length - 1].set(B.x, 0, B.z);

  pts = resample(pts, RESAMPLE_STEP);
  pts = smoothJitter(pts, 4);
  pushOffLand(pts, seabed);
  // Pin the anchors BEFORE the curvature pass so the pass can also round any
  // corner the pinning itself creates; resampling preserves endpoints.
  pts[0].set(A.x, 0, A.z);
  pts[pts.length - 1].set(B.x, 0, B.z);
  clampCurvature(pts, RESAMPLE_STEP);
  pts = resample(pts, RESAMPLE_STEP);
  clampCurvature(pts, RESAMPLE_STEP, 40);

  return { ok: true, points: pts };
}

/**
 * Generate an alternative valid route for the result-screen comparison:
 * pick the arc template (left / right / straight) that stays on sand and
 * differs most from what the child drew.
 */
export function alternativeRoute(
  player: THREE.Vector3[],
  seabed: Seabed
): THREE.Vector3[] {
  const A = seabed.anchorA, B = seabed.anchorB;
  const mk = (bulge: number): THREE.Vector3[] => {
    const pts: THREE.Vector3[] = [];
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = A.x + (B.x - A.x) * t;
      const z = A.z + (B.z - A.z) * t + Math.sin(t * Math.PI) * bulge;
      pts.push(new THREE.Vector3(x, 0, z));
    }
    return pts;
  };
  const candidates = [mk(0), mk(-26), mk(26), mk(-40), mk(40)];
  let best: THREE.Vector3[] = candidates[0];
  let bestScore = -Infinity;
  for (const c of candidates) {
    let hazard = 0;
    for (const p of c) {
      const t = seabed.surfaceType(p.x, p.z);
      if (t !== 'sand') hazard += 1;
      if (seabed.height(p.x, p.z) > -3 && Math.abs(p.x) < 70) hazard += 2;
    }
    // Distance from the player's route (sampled).
    let diff = 0;
    for (let i = 0; i < c.length; i += 6) {
      let dmin = Infinity;
      for (let j = 0; j < player.length; j += 6) {
        dmin = Math.min(dmin, c[i].distanceTo(player[j]));
      }
      diff += dmin;
    }
    const score = diff - hazard * 40;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
