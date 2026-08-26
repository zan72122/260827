// 2D geometry for the score curve on the sheet plane.
// Sheet-local coordinates: u along local x in [-hw, +hw], v along local z in [-hh, +hh].
// Edges: 0: v=-hh (far), 1: u=+hw (right), 2: v=+hh (near), 3: u=-hw (left).

const CORNER_MARGIN = 0.028; // keep score ends away from corners so no sliver corner pieces

export function vlen(x, y) { return Math.hypot(x, y); }

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

export class RectBounds {
  constructor(hw, hh) {
    this.hw = hw;
    this.hh = hh;
    this.perimeter = 4 * hw + 4 * hh;
  }

  contains(p, eps = 0) {
    return Math.abs(p.x) <= this.hw - eps && Math.abs(p.y) <= this.hh - eps;
  }

  // Distance from p to the nearest boundary point (p assumed inside).
  distToBoundary(p) {
    return Math.min(this.hw - Math.abs(p.x), this.hh - Math.abs(p.y));
  }

  // Nearest boundary point (perpendicular projection), corner-safe.
  nearestBoundaryPoint(p) {
    const dx = this.hw - Math.abs(p.x);
    const dy = this.hh - Math.abs(p.y);
    let q;
    if (dx < dy) q = { x: Math.sign(p.x || 1) * this.hw, y: p.y };
    else q = { x: p.x, y: Math.sign(p.y || 1) * this.hh };
    return this.nudgeOffCorner(this.clampToBoundary(q));
  }

  // Snap a point that is on/near the boundary exactly onto it.
  clampToBoundary(p) {
    const dx = this.hw - Math.abs(p.x);
    const dy = this.hh - Math.abs(p.y);
    const q = { x: clamp(p.x, -this.hw, this.hw), y: clamp(p.y, -this.hh, this.hh) };
    if (Math.abs(dx) < Math.abs(dy)) q.x = Math.sign(p.x || 1) * this.hw;
    else q.y = Math.sign(p.y || 1) * this.hh;
    return q;
  }

  edgeOf(p, eps = 1e-6) {
    if (Math.abs(p.y + this.hh) < eps) return 0;
    if (Math.abs(p.x - this.hw) < eps) return 1;
    if (Math.abs(p.y - this.hh) < eps) return 2;
    if (Math.abs(p.x + this.hw) < eps) return 3;
    return -1;
  }

  // Slide a boundary point along its edge so it is at least CORNER_MARGIN from corners.
  nudgeOffCorner(p) {
    const q = { x: p.x, y: p.y };
    const e = this.edgeOf(q, 1e-4);
    const m = Math.min(CORNER_MARGIN, 0.35 * Math.min(this.hw, this.hh));
    if (e === 0 || e === 2) q.x = clamp(q.x, -this.hw + m, this.hw - m);
    else if (e === 1 || e === 3) q.y = clamp(q.y, -this.hh + m, this.hh - m);
    return q;
  }

  // First intersection of ray (origin inside, direction) with the boundary.
  rayToBoundary(origin, dir) {
    let best = Infinity;
    const d = { x: dir.x, y: dir.y };
    const len = vlen(d.x, d.y);
    if (len < 1e-9) return null;
    d.x /= len; d.y /= len;
    if (d.x > 1e-9) best = Math.min(best, (this.hw - origin.x) / d.x);
    if (d.x < -1e-9) best = Math.min(best, (-this.hw - origin.x) / d.x);
    if (d.y > 1e-9) best = Math.min(best, (this.hh - origin.y) / d.y);
    if (d.y < -1e-9) best = Math.min(best, (-this.hh - origin.y) / d.y);
    if (!isFinite(best) || best < 0) return null;
    return { x: origin.x + d.x * best, y: origin.y + d.y * best, t: best };
  }

  // Perimeter parameter, counter-clockwise walk C0(-hw,-hh) -> C1(hw,-hh) -> C2(hw,hh) -> C3(-hw,hh).
  boundaryParam(p) {
    const { hw, hh } = this;
    const e = this.edgeOf(p, 1e-4);
    const W = 2 * hw, H = 2 * hh;
    switch (e) {
      case 0: return p.x + hw;
      case 1: return W + (p.y + hh);
      case 2: return W + H + (hw - p.x);
      case 3: return W + H + W + (hh - p.y);
      default: {
        const q = this.clampToBoundary(p);
        return this.boundaryParam(q);
      }
    }
  }

  boundaryPoint(s) {
    const { hw, hh } = this;
    const W = 2 * hw, H = 2 * hh;
    s = ((s % this.perimeter) + this.perimeter) % this.perimeter;
    if (s < W) return { x: -hw + s, y: -hh };
    s -= W;
    if (s < H) return { x: hw, y: -hh + s };
    s -= H;
    if (s < W) return { x: hw - s, y: hh };
    s -= W;
    return { x: -hw, y: hh - s };
  }

  cornerParams() {
    const W = 2 * this.hw, H = 2 * this.hh;
    return [0, W, W + H, W + H + W];
  }
}

// Builds the score polyline incrementally as the child drags.
// The laid path IS the final cut curve, so what you see is exactly what splits.
// - light exponential smoothing removes jitter
// - a minimum step length resamples the input
// - per-step turn clamping rounds off angles a wheel cutter could not follow
// - reversals are ignored: the wheel stays where it is instead of backtracking
export class StrokeBuilder {
  constructor(rect) {
    this.rect = rect;
    this.points = [];          // laid path, first point on the boundary
    this.smoothX = 0; this.smoothY = 0;
    this.hasSmooth = false;
    this.done = false;         // reached the far boundary
    this.minStep = 0.009;
    this.maxTurn = 0.42;       // rad per step (~24 deg) -> min radius ~ minStep/maxTurn
    this.edgeSnap = 0.012;     // reaching this close to an edge ends the stroke
    this.startEdge = -1;
  }

  // Called once with the touch-down position (sheet-local).
  begin(p) {
    const inside = {
      x: clamp(p.x, -this.rect.hw + 1e-4, this.rect.hw - 1e-4),
      y: clamp(p.y, -this.rect.hh + 1e-4, this.rect.hh - 1e-4)
    };
    const entry = this.rect.nearestBoundaryPoint(inside);
    this.startEdge = this.rect.edgeOf(entry, 1e-4);
    this.points.push(entry);
    // Lay a straight lead-in from the edge to the touch point (assist: the
    // artisan starts every score at the edge of the pane).
    this._appendTowards(inside, true);
    this.smoothX = inside.x; this.smoothY = inside.y;
    this.hasSmooth = true;
  }

  addSample(p) {
    if (this.done) return;
    const a = 0.38;
    if (!this.hasSmooth) { this.smoothX = p.x; this.smoothY = p.y; this.hasSmooth = true; }
    this.smoothX += (p.x - this.smoothX) * a;
    this.smoothY += (p.y - this.smoothY) * a;
    const target = {
      x: clamp(this.smoothX, -this.rect.hw, this.rect.hw),
      y: clamp(this.smoothY, -this.rect.hh, this.rect.hh)
    };
    this._appendTowards(target, false);
  }

  _lastDir() {
    const n = this.points.length;
    if (n < 2) return null;
    const a = this.points[n - 2], b = this.points[n - 1];
    const l = vlen(b.x - a.x, b.y - a.y);
    if (l < 1e-9) return null;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  }

  // March from the current tip towards `target` in clamped-turn steps.
  _appendTowards(target, isLeadIn) {
    let guard = 200;
    while (guard-- > 0 && !this.done) {
      const tip = this.points[this.points.length - 1];
      let dx = target.x - tip.x, dy = target.y - tip.y;
      const dist = vlen(dx, dy);
      if (dist < this.minStep) break;
      dx /= dist; dy /= dist;
      const prev = this._lastDir();
      if (prev && !isLeadIn) {
        const dot = prev.x * dx + prev.y * dy;
        // Reversal: the wheel does not run back over its own score. Ignore.
        if (dot < -0.25) break;
        let ang = Math.atan2(prev.x * dy - prev.y * dx, dot);
        if (Math.abs(ang) > this.maxTurn) {
          ang = Math.sign(ang) * this.maxTurn;
          const c = Math.cos(ang), s = Math.sin(ang);
          const nx = prev.x * c - prev.y * s;
          const ny = prev.x * s + prev.y * c;
          dx = nx; dy = ny;
        }
      }
      const step = Math.min(this.minStep, dist);
      let np = { x: tip.x + dx * step, y: tip.y + dy * step };
      np.x = clamp(np.x, -this.rect.hw, this.rect.hw);
      np.y = clamp(np.y, -this.rect.hh, this.rect.hh);
      this.points.push(np);
      // Reached the boundary (a different edge than the start)?
      if (!isLeadIn && this.rect.distToBoundary(np) < this.edgeSnap && this.arcLength() > 0.06) {
        const q = this.rect.nudgeOffCorner(this.rect.clampToBoundary(np));
        const edge = this.rect.edgeOf(q, 1e-4);
        if (edge !== this.startEdge) {
          this.points[this.points.length - 1] = q;
          this.done = true;
          return;
        }
      }
    }
  }

  arcLength() {
    let l = 0;
    for (let i = 1; i < this.points.length; i++) {
      l += vlen(this.points[i].x - this.points[i - 1].x, this.points[i].y - this.points[i - 1].y);
    }
    return l;
  }

  // After pointer-up: return the remaining polyline that carries the score to
  // the far boundary (assist), or null if the stroke already ended on an edge.
  buildCompletion() {
    if (this.done) { this._finish(); return null; }
    const pts = this.points;
    const n = pts.length;
    if (n < 2) return null;
    // average direction of the last few segments
    let k = Math.min(6, n - 1);
    let dx = pts[n - 1].x - pts[n - 1 - k].x;
    let dy = pts[n - 1].y - pts[n - 1 - k].y;
    if (vlen(dx, dy) < 1e-6) { dx = pts[n - 1].x - pts[0].x; dy = pts[n - 1].y - pts[0].y; }
    let hit = this.rect.rayToBoundary(pts[n - 1], { x: dx, y: dy });
    let exitEdge = hit ? this.rect.edgeOf(this.rect.clampToBoundary(hit), 1e-4) : -1;
    if (!hit || exitEdge === this.startEdge) {
      // Fall back to the chord direction (entry -> tip): this always leaves
      // through a different edge because the entry edge is behind it.
      const cdx = pts[n - 1].x - pts[0].x, cdy = pts[n - 1].y - pts[0].y;
      if (vlen(cdx, cdy) > 1e-6) {
        const h2 = this.rect.rayToBoundary(pts[n - 1], { x: cdx, y: cdy });
        if (h2) hit = h2;
      }
    }
    if (!hit) return null;
    const q = this.rect.nudgeOffCorner(this.rect.clampToBoundary(hit));
    // Completion segment, gently subdivided so the wheel animates along it.
    const tip = pts[n - 1];
    const segs = [];
    const L = vlen(q.x - tip.x, q.y - tip.y);
    const steps = Math.max(2, Math.ceil(L / this.minStep));
    for (let i = 1; i <= steps; i++) {
      segs.push({ x: tip.x + (q.x - tip.x) * (i / steps), y: tip.y + (q.y - tip.y) * (i / steps) });
    }
    return segs;
  }

  // Append completion points (called as the auto-run animation advances).
  appendPoint(p) {
    this.points.push({ x: p.x, y: p.y });
  }

  markDone() {
    this.done = true;
    this._finish();
  }

  _finish() {
    const pts = this.points;
    if (pts.length < 2) return;
    pts[0] = this.rect.nudgeOffCorner(this.rect.clampToBoundary(pts[0]));
    pts[pts.length - 1] = this.rect.nudgeOffCorner(this.rect.clampToBoundary(pts[pts.length - 1]));
    // drop interior points that drifted onto the boundary (keep only endpoints there)
    for (let i = pts.length - 2; i >= 1; i--) {
      if (this.rect.distToBoundary(pts[i]) < 1e-4) pts.splice(i, 1);
    }
    // dedupe
    for (let i = pts.length - 1; i >= 1; i--) {
      if (vlen(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) < 5e-4) pts.splice(i, 1);
    }
  }
}

// Douglas-Peucker with a small epsilon: removes collinear runs before the
// polygon split so triangulation produces no zero-area slivers. The visual
// ribbon keeps the dense points; max deviation stays well under line width.
export function simplifyCurve(pts, eps = 0.0008) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = pts[a].x, ay = pts[a].y;
    let dx = pts[b].x - ax, dy = pts[b].y - ay;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    let maxD = -1, maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i].x - ax, py = pts[i].y - ay;
      const d = Math.abs(px * dy - py * dx);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > eps) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

export function polygonCentroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const c = p.x * q.y - q.x * p.y;
    a += c; cx += (p.x + q.x) * c; cy += (p.y + q.y) * c;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-12) return { x: poly[0].x, y: poly[0].y };
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

// Split the sheet rectangle with a finished score curve.
// Returns two polygons; in each, the first `curveCount` edges are cut faces.
export function splitRectByCurve(rect, curve) {
  const pts = curve.slice();
  const sEntry = rect.boundaryParam(pts[0]);
  const sExit = rect.boundaryParam(pts[pts.length - 1]);
  const P = rect.perimeter;
  const corners = rect.cornerParams();

  function walk(from, to, increasing) {
    const out = [];
    if (increasing) {
      let target = to;
      while (target <= from + 1e-9) target += P;
      for (let rep = 0; rep < 2; rep++) {
        for (const c of corners) {
          const cc = c + rep * P;
          if (cc > from + 1e-6 && cc < target - 1e-6) out.push({ s: cc, p: rect.boundaryPoint(c) });
        }
      }
      out.sort((a, b) => a.s - b.s);
    } else {
      let target = to;
      while (target >= from - 1e-9) target -= P;
      for (let rep = 0; rep < 2; rep++) {
        for (const c of corners) {
          const cc = c - rep * P;
          if (cc < from - 1e-6 && cc > target + 1e-6) out.push({ s: cc, p: rect.boundaryPoint(((c % P) + P) % P) });
        }
      }
      out.sort((a, b) => b.s - a.s);
    }
    return out.map(o => o.p);
  }

  const polyA = pts.concat(walk(sExit, sEntry, true));
  const polyB = pts.concat(walk(sExit, sEntry, false));
  const curveCount = pts.length - 1; // edges 0..curveCount-1 are cut faces

  return [
    { poly: cleanPoly(polyA), cutEdges: curveCount },
    { poly: cleanPoly(polyB), cutEdges: curveCount }
  ];
}

function cleanPoly(poly) {
  const out = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || vlen(p.x - last.x, p.y - last.y) > 4e-4) out.push(p);
  }
  while (out.length > 2 && vlen(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 4e-4) out.pop();
  return out;
}

// Resample a polyline at roughly the given spacing (for ribbons/decals).
export function resample(pts, spacing) {
  if (pts.length < 2) return pts.slice();
  const out = [{ ...pts[0] }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1], b = pts[i];
    let seg = vlen(b.x - a.x, b.y - a.y);
    let t = 0;
    while (carry + (seg - t) >= spacing) {
      const need = spacing - carry;
      t += need;
      carry = 0;
      out.push({ x: a.x + (b.x - a.x) * (t / seg), y: a.y + (b.y - a.y) * (t / seg) });
    }
    carry += seg - t;
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}
