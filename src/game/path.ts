// Stroke -> route processing.
//
// Contract (see design spec):
//  - right bends stay right, left stays left, S stays S, order is preserved
//  - long strokes make long channels, stroke speed nudges sailing vigour
//  - finger jitter of a few px is removed, but the child's large-scale
//    curvature is kept: equidistant resampling + light smoothing + a
//    pure-pursuit reconstruction that only rounds turns the real ship
//    could never make (min turning radius)
//  - obstacle avoidance widens turns early but never flips the chosen side

import {
  MIN_TURN_RADIUS, START, START_HEADING, PORT_APPROACH, PORT_DOCK, IB_HOLDING,
  OBSTACLES, Obstacle, clamp, wrapAngle,
} from './const';

export interface P2 { x: number; z: number }

export interface Route {
  /** fine equidistant points (step RSTEP) of the FULL icebreaker route */
  pts: P2[];
  /** heading (radians, forward=(sin,cos)) at each point */
  headings: number[];
  step: number;
  totalLen: number;
  /** arc-length where the child's drawn portion ends */
  drawnLen: number;
  /** arc-length of the point where supply route branches off to the berth */
  branchLen: number;
  /** supply ship route: shares [0..branchLen] then goes to the dock */
  supplyPts: P2[];
  supplyHeadings: number[];
  supplyTotalLen: number;
  /** 0.85..1.15 from stroke speed */
  speedFactor: number;
}

const RSTEP = 3; // metres between resampled points

function dist(a: P2, b: P2): number {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

/** Resample a polyline to equidistant points. */
export function resample(pts: P2[], step: number): P2[] {
  if (pts.length === 0) return [];
  const out: P2[] = [{ ...pts[0] }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1], b = pts[i];
    let seg = dist(a, b);
    if (seg < 1e-6) continue;
    let t = step - carry;
    while (t <= seg) {
      out.push({ x: a.x + (b.x - a.x) * (t / seg), z: a.z + (b.z - a.z) * (t / seg) });
      t += step;
    }
    carry = seg - (t - step);
  }
  return out;
}

/** Moving-average smoothing, endpoints pinned. Removes finger jitter only. */
function smooth(pts: P2[], radius: number, passes: number): P2[] {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    const out: P2[] = cur.map((pt) => ({ ...pt }));
    for (let i = 1; i < cur.length - 1; i++) {
      let sx = 0, sz = 0, n = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = clamp(i + k, 0, cur.length - 1);
        sx += cur[j].x; sz += cur[j].z; n++;
      }
      out[i].x = sx / n; out[i].z = sz / n;
    }
    cur = out;
  }
  return cur;
}

/**
 * Pure-pursuit reconstruction: rebuild the path with a bounded turn rate so
 * only physically impossible kinks get rounded. Chases the input points in
 * order, so left/right choices and S-shapes survive.
 */
function pursuit(
  startPos: P2, startHeading: number, targets: P2[],
  step: number, minRadius: number,
): { pts: P2[]; headings: number[] } {
  const maxTurn = step / minRadius;
  const pts: P2[] = [{ ...startPos }];
  const headings: number[] = [startHeading];
  let pos = { ...startPos };
  let h = startHeading;
  let ti = 0;
  // pure-pursuit lookahead: aiming ~15 m ahead on the stroke keeps the
  // heading aligned with the drawn line through lobes tighter than the
  // ship can actually turn, instead of overshooting and losing the tail
  const capture = Math.max(step * 2.2, 15);
  const maxSteps = 4000;
  for (let n = 0; n < maxSteps && ti < targets.length; n++) {
    // advance target index past anything within the lookahead
    while (ti < targets.length - 1 && dist(pos, targets[ti]) < capture) ti++;
    let tgt = targets[ti];
    let d = dist(pos, tgt);
    if (d < capture && ti === targets.length - 1) break;
    // A stroke point inside one of the ship's minimum turning circles is a
    // kink sharper than the hull can steer — skip it (the "round impossible
    // corners" rule). Chasing it would make the route spiral.
    const inTurnCircle = (t2: P2): boolean => {
      const R = minRadius * 0.96;
      const lx = pos.x - Math.cos(h) * minRadius, lz = pos.z + Math.sin(h) * minRadius;
      const rx = pos.x + Math.cos(h) * minRadius, rz = pos.z - Math.sin(h) * minRadius;
      return Math.hypot(t2.x - lx, t2.z - lz) < R || Math.hypot(t2.x - rx, t2.z - rz) < R;
    };
    let guard = 0;
    while (ti < targets.length - 1 && inTurnCircle(tgt) && guard++ < targets.length) {
      ti++;
      tgt = targets[ti];
    }
    d = dist(pos, tgt);
    if (ti === targets.length - 1 && inTurnCircle(tgt)) {
      break; // stroke ends in an impossible hook — stop here; the analytic
             // extension (arc + tangent) takes over and still delivers
    }
    const desired = Math.atan2(tgt.x - pos.x, tgt.z - pos.z);
    h += clamp(wrapAngle(desired - h), -maxTurn, maxTurn);
    pos = { x: pos.x + Math.sin(h) * step, z: pos.z + Math.cos(h) * step };
    pts.push({ ...pos });
    headings.push(h);
  }
  return { pts, headings };
}

/**
 * Push points radially away from obstacles, widening a little early.
 * Radial push keeps whichever side the path already leans to.
 */
function avoidObstacles(pts: P2[], obstacles: Obstacle[], clearance: number): P2[] {
  const out = pts.map((p) => ({ ...p }));
  for (const ob of obstacles) {
    const margin = ob.r + clearance;
    const soft = margin + 18; // start easing out before we're truly close
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      let dx = p.x - ob.x, dz = p.z - ob.z;
      let d = Math.hypot(dx, dz);
      if (d >= soft) continue;
      if (d < 1e-3) {
        // dead centre: pick the side the neighbours lean to
        const nb = out[Math.max(0, i - 3)];
        dx = nb.x - ob.x; dz = nb.z - ob.z;
        d = Math.hypot(dx, dz) || 1;
      }
      const want = d < margin ? margin : margin + (soft - margin) * ((d - margin) / (soft - margin)) ** 2;
      const push = Math.max(want, d);
      out[i].x = ob.x + (dx / d) * push;
      out[i].z = ob.z + (dz / d) * push;
    }
  }
  return out;
}

/**
 * Analytic bounded-curvature path to a point (turn on one minimum-radius
 * circle until the tangent line points at the target, then run straight).
 * Terminates by construction — no pursuit, no spirals. Used for the
 * auto-extension to the harbour and the supply ship's berth approach.
 */
function arcThenStraight(
  start: P2, startHeading: number, target: P2, minRadius: number, step: number,
  depth = 0,
): { pts: P2[]; headings: number[] } {
  const candidates: { len: number; pts: P2[]; headings: number[] }[] = [];
  for (const side of [-1, 1]) { // -1 = left turn (heading decreases), +1 = right
    // circle centre for this side
    const cx = start.x + side * Math.cos(startHeading) * minRadius;
    const cz = start.z - side * Math.sin(startHeading) * minRadius;
    const dcx = target.x - cx, dcz = target.z - cz;
    const d = Math.hypot(dcx, dcz);
    if (d < minRadius * 1.02) continue; // target inside this circle: other side handles it
    const alpha = Math.atan2(dcx, dcz);          // bearing of target about centre
    const beta = Math.acos(clamp(minRadius / d, -1, 1)); // tangent-point offset
    for (const sgn of [-1, 1]) {
      const psi = alpha + sgn * beta;            // candidate tangent-point angle
      const px = cx + Math.sin(psi) * minRadius;
      const pz = cz + Math.cos(psi) * minRadius;
      // heading while on the circle at angle psi, for this turn side
      const hAt = psi + side * Math.PI / 2;
      const bearing = Math.atan2(target.x - px, target.z - pz);
      if (Math.abs(wrapAngle(hAt - bearing)) > 0.06) continue; // wrong tangent
      // arc sweep from start angle to psi, in this side's turn direction
      const theta0 = startHeading + side * Math.PI / 2 - Math.PI;
      // position angle of start about centre:
      const thetaS = Math.atan2(start.x - cx, start.z - cz);
      void theta0;
      let sweep = wrapAngle(psi - thetaS);
      if (side > 0 && sweep < -1e-4) sweep += Math.PI * 2;  // right turn: angle increases
      if (side < 0 && sweep > 1e-4) sweep -= Math.PI * 2;   // left turn: angle decreases
      const arcLen = Math.abs(sweep) * minRadius;
      const straight = Math.hypot(target.x - px, target.z - pz);
      const pts: P2[] = [];
      const headings: number[] = [];
      const na = Math.max(1, Math.ceil(arcLen / step));
      for (let i = 1; i <= na; i++) {
        const th = thetaS + sweep * (i / na);
        pts.push({ x: cx + Math.sin(th) * minRadius, z: cz + Math.cos(th) * minRadius });
        headings.push(th + side * Math.PI / 2);
      }
      const ns = Math.max(1, Math.ceil(straight / step));
      for (let i = 1; i <= ns; i++) {
        pts.push({ x: px + (target.x - px) * (i / ns), z: pz + (target.z - pz) * (i / ns) });
        headings.push(bearing);
      }
      candidates.push({ len: arcLen + straight, pts, headings });
    }
  }
  candidates.sort((a, b) => a.len - b.len);
  const direct = Math.hypot(target.x - start.x, target.z - start.z);
  // an honest U-turn (~pi*R of arc) is fine; only a near-full-circle sweep
  // counts as degenerate
  const loopish = candidates.length === 0 ||
    candidates[0].len > direct + minRadius * Math.PI * 1.5;
  const fx0 = Math.sin(startHeading), fz0 = Math.cos(startHeading);
  const aheadX = start.x + fx0 * minRadius * 0.8;
  const aheadZ = start.z + fz0 * minRadius * 0.8;
  const seaRoom = Math.abs(aheadX) < 185 && aheadZ > -235 && aheadZ < 238;
  if (loopish && depth < 4 && (seaRoom || candidates.length === 0)) {
    // the target sits inside (or nearly inside) a turning circle: the only
    // pure arc solution is a huge loop. A real ship would stand on for a
    // bit and then swing round — advance straight, then solve again.
    const fx = Math.sin(startHeading), fz = Math.cos(startHeading);
    const adv = minRadius * 0.8;
    const mid: P2 = { x: start.x + fx * adv, z: start.z + fz * adv };
    const pts: P2[] = [];
    const headings: number[] = [];
    const ns = Math.max(1, Math.ceil(adv / step));
    for (let i = 1; i <= ns; i++) {
      pts.push({ x: start.x + fx * adv * (i / ns), z: start.z + fz * adv * (i / ns) });
      headings.push(startHeading);
    }
    const rest = arcThenStraight(mid, startHeading, target, minRadius, step, depth + 1);
    return { pts: [...pts, ...rest.pts], headings: [...headings, ...rest.headings] };
  }
  if (candidates.length === 0) {
    // give up gracefully: straight line (only reachable after depth limit)
    const pts: P2[] = [];
    const headings: number[] = [];
    const b = Math.atan2(target.x - start.x, target.z - start.z);
    const ns = Math.max(1, Math.ceil(direct / step));
    for (let i = 1; i <= ns; i++) {
      pts.push({ x: start.x + (target.x - start.x) * (i / ns), z: start.z + (target.z - start.z) * (i / ns) });
      headings.push(b);
    }
    return { pts, headings };
  }
  return { pts: candidates[0].pts, headings: candidates[0].headings };
}

/** Chain arc+straight segments through a list of waypoints. */
function analyticRoute(
  start: P2, startHeading: number, waypoints: P2[], minRadius: number, step: number,
): { pts: P2[]; headings: number[] } {
  let pos = start, h = startHeading;
  const pts: P2[] = [{ ...start }];
  const headings: number[] = [startHeading];
  for (let wi = 0; wi < waypoints.length; wi++) {
    const wp = waypoints[wi];
    // intermediate waypoints are gates, not destinations: one we're already
    // close to has served its purpose
    if (wi < waypoints.length - 1 && dist(pos, wp) < minRadius * 1.5) continue;
    if (dist(pos, wp) < step * 2) continue;
    const seg = arcThenStraight(pos, h, wp, minRadius, step);
    pts.push(...seg.pts);
    headings.push(...seg.headings);
    pos = pts[pts.length - 1];
    h = headings[headings.length - 1];
  }
  return { pts, headings };
}

function polylineLen(pts: P2[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** A gentle arc of waypoints from `from` toward `to` for auto-extension. */
function towards(from: P2, to: P2): P2[] {
  const out: P2[] = [];
  const n = Math.max(2, Math.ceil(dist(from, to) / 20));
  for (let i = 1; i <= n; i++) {
    out.push({ x: from.x + (to.x - from.x) * (i / n), z: from.z + (to.z - from.z) * (i / n) });
  }
  return out;
}

export interface StrokeSample { x: number; z: number; t: number }

/**
 * Turn a raw one-finger stroke (world-space samples on the ice plane, with
 * timestamps) into the icebreaker route + supply route.
 */
export function buildRoute(stroke: StrokeSample[], screenSpeedPxS: number): Route {
  // --- 1. clean + lead-in from the ship's bow -------------------------------
  const raw: P2[] = [];
  for (const s of stroke) {
    // leading samples outside the drawable ice are skipped; once the stroke
    // is on the ice it simply ends where it leaves again (clamping instead
    // would bend the route along the field edge)
    const outside = s.x < -215 || s.x > 215 || s.z < -250 || s.z > 240;
    if (outside) {
      if (raw.length === 0) continue;
      break;
    }
    const p = { x: s.x, z: s.z };
    if (raw.length === 0 || dist(raw[raw.length - 1], p) > 0.75) raw.push(p);
  }
  const start: P2 = { ...START };
  let strokePts = raw;
  if (strokePts.length > 0 && dist(start, strokePts[0]) > 10) {
    strokePts = [...towards(start, strokePts[0]), ...strokePts];
  }
  if (strokePts.length < 2) strokePts = towards(start, PORT_APPROACH);

  // --- 2. equidistant resample + light smoothing (kills finger jitter) ------
  let pts = resample([start, ...strokePts], RSTEP);
  pts = smooth(pts, 2, 2);

  // --- 3. obstacle avoidance (side-preserving), then re-smooth --------------
  pts = avoidObstacles(pts, OBSTACLES, 16);
  pts = smooth(pts, 2, 1);

  // --- 4. curvature-limited reconstruction of the drawn portion -------------
  const drawn = pursuit(start, START_HEADING, pts.slice(1), RSTEP, MIN_TURN_RADIUS);
  const drawnLen = (drawn.pts.length - 1) * RSTEP;

  // --- 5. auto-extension: the icebreaker carries on to the port so the
  //        supply ship can always deliver, with wider, calmer turns.
  //        Built analytically (arc + tangent) so it can never spiral. -------
  const endPos = drawn.pts[drawn.pts.length - 1];
  const endHeading = drawn.headings[drawn.headings.length - 1];
  const nearPort = dist(endPos, PORT_APPROACH) < 26;

  const waypoints: P2[] = [];
  if (!nearPort) {
    // if the straight line to the harbour clips an obstacle, add one detour
    // vertex at the point of maximum displacement (side-preserving push)
    const line = towards(endPos, PORT_APPROACH);
    const avoided = avoidObstacles(line, OBSTACLES, 18);
    let bestI = -1, bestDev = 0;
    for (let i = 0; i < line.length; i++) {
      const dev = dist(line[i], avoided[i]);
      if (dev > bestDev) { bestDev = dev; bestI = i; }
    }
    if (bestDev > 4 && bestI >= 0) waypoints.push(avoided[bestI]);
    waypoints.push(PORT_APPROACH);
  }
  waypoints.push(IB_HOLDING);
  const ext = analyticRoute(endPos, endHeading, waypoints, MIN_TURN_RADIUS * 1.15, RSTEP);

  // --- 6. uniform resample of the whole route + headings from geometry -----
  const fullPts = resample([...drawn.pts, ...ext.pts.slice(1)], RSTEP);
  const fullHeadings = headingsOf(fullPts);
  const totalLen = (fullPts.length - 1) * RSTEP;

  // branch point: the first time the shared channel comes near PORT_APPROACH
  // (fall back to the overall closest point)
  let branchIdx = -1, bd = Infinity, closestIdx = fullPts.length - 1;
  for (let i = 0; i < fullPts.length; i++) {
    const d = dist(fullPts[i], PORT_APPROACH);
    if (d < bd) { bd = d; closestIdx = i; }
    if (branchIdx < 0 && d < 40) branchIdx = i;
  }
  if (branchIdx < 0) branchIdx = closestIdx;
  const branchLen = branchIdx * RSTEP;

  // supply route: same channel to the branch, then a calm swing to the berth
  const sup = analyticRoute(fullPts[branchIdx], fullHeadings[branchIdx], [PORT_DOCK], 34, RSTEP);
  const supplyPts = resample([...fullPts.slice(0, branchIdx + 1), ...sup.pts.slice(1)], RSTEP);
  const supplyHeadings = headingsOf(supplyPts);

  const speedFactor = clamp(0.85 + (screenSpeedPxS - 250) / 3800, 0.85, 1.15);

  return {
    pts: fullPts, headings: fullHeadings, step: RSTEP,
    totalLen, drawnLen, branchLen,
    supplyPts, supplyHeadings, supplyTotalLen: (supplyPts.length - 1) * RSTEP,
    speedFactor,
  };
}

function headingsOf(pts: P2[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    out.push(Math.atan2(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z));
  }
  out.push(out.length ? out[out.length - 1] : 0);
  return out;
}

export interface PoseSample { x: number; z: number; heading: number; curvature: number }

/** Sample position/heading at arc length s along a route point list. */
export function sampleRoute(pts: P2[], headings: number[], step: number, s: number): PoseSample {
  const f = clamp(s / step, 0, pts.length - 1.0001);
  const i = Math.floor(f);
  const t = f - i;
  const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
  const ha = headings[i], hb = headings[Math.min(i + 1, headings.length - 1)];
  const h = ha + wrapAngle(hb - ha) * t;
  const i2 = Math.min(i + 1, headings.length - 1);
  const curvature = wrapAngle(headings[i2] - headings[i]) / step;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: h, curvature };
}
