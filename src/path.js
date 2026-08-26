// One-stroke path capture and processing.
// The child's stroke is resampled, jitter-smoothed, clamped away from the
// boards, and curvature-limited to the vehicle's real minimum turn radius —
// but the large left/right intent of the stroke is preserved.

export const RINK = {
  halfW: 10,     // x extent (m)
  halfL: 17,     // z extent (m)
  margin: 2.6    // how far path centers stay off the boards
};

export const VEHICLE_SPEC = {
  wheelbase: 2.6,
  width: 2.0,
  conditionerWidth: 2.2,
  conditionerBack: 1.42,  // conditioner center behind rear axle
  minTurnRadius: 3.8,
  maxSteer: 0.62
};

function clampToRink(p) {
  const mx = RINK.halfW - RINK.margin;
  const mz = RINK.halfL - RINK.margin;
  p.x = Math.max(-mx, Math.min(mx, p.x));
  p.z = Math.max(-mz, Math.min(mz, p.z));
}

function resample(pts, step) {
  if (pts.length === 0) return [];
  const out = [{ ...pts[0] }];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1], b = pts[i];
    let dx = b.x - a.x, dz = b.z - a.z;
    let d = Math.hypot(dx, dz);
    if (d < 1e-6) continue;
    let t = 0;
    while (acc + (d - t) >= step) {
      t += step - acc;
      acc = 0;
      const k = t / d;
      out.push({ x: a.x + dx * k, z: a.z + dz * k, s: (a.s ?? 0) * (1 - k) + (b.s ?? 0) * k });
    }
    acc += d - t;
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.z - tail.z) > step * 0.4) out.push({ ...last });
  return out;
}

function smoothPass(pts, w, lockHead) {
  // small gaussian-ish neighborhood average; removes finger jitter only
  const n = pts.length;
  if (n < 5) return;
  const px = pts.map(p => p.x), pz = pts.map(p => p.z);
  const start = lockHead ? 2 : 1;
  for (let i = start; i < n - 1; i++) {
    const x = (px[i - 1] + px[i] * 2 + px[i + 1]) * 0.25;
    const z = (pz[i - 1] + pz[i] * 2 + pz[i + 1]) * 0.25;
    pts[i].x = pts[i].x * (1 - w) + x * w;
    pts[i].z = pts[i].z * (1 - w) + z * w;
  }
}

function curvatureOf(a, b, c) {
  // signed curvature through three points
  const abx = b.x - a.x, abz = b.z - a.z;
  const bcx = c.x - b.x, bcz = c.z - b.z;
  const cross = abx * bcz - abz * bcx;
  const la = Math.hypot(abx, abz), lb = Math.hypot(bcx, bcz);
  const lc = Math.hypot(c.x - a.x, c.z - a.z);
  const denom = la * lb * lc;
  if (denom < 1e-9) return 0;
  return 2 * cross / denom;
}

function relaxCurvature(pts, kmax, iters, lockHead) {
  const n = pts.length;
  if (n < 4) return;
  const start = lockHead ? 2 : 1;
  for (let it = 0; it < iters; it++) {
    for (let i = start; i < n - 1; i++) {
      const k = Math.abs(curvatureOf(pts[i - 1], pts[i], pts[i + 1]));
      if (k > kmax) {
        const w = Math.min(1, (k - kmax) / kmax) * 0.5;
        pts[i].x += ((pts[i - 1].x + pts[i + 1].x) * 0.5 - pts[i].x) * w;
        pts[i].z += ((pts[i - 1].z + pts[i + 1].z) * 0.5 - pts[i].z) * w;
      }
      clampToRink(pts[i]);
    }
  }
}

export class DrivePath {
  constructor(pts) {
    // pts: [{x,z,s}] where s = target speed (m/s)
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    }
    this.total = this.cum[this.cum.length - 1];
  }
  _seg(s) {
    s = Math.max(0, Math.min(this.total, s));
    let lo = 0, hi = this.cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid; else hi = mid;
    }
    const t = (this.cum[hi] - this.cum[lo]) > 1e-9 ? (s - this.cum[lo]) / (this.cum[hi] - this.cum[lo]) : 0;
    return { lo, hi, t };
  }
  pointAt(s) {
    const { lo, hi, t } = this._seg(s);
    const a = this.pts[lo], b = this.pts[hi];
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }
  speedAt(s) {
    const { lo, hi, t } = this._seg(s);
    return (this.pts[lo].s ?? 2) * (1 - t) + (this.pts[hi].s ?? 2) * t;
  }
  curvatureAt(s) {
    const ds = 1.0;
    const a = this.pointAt(s - ds), b = this.pointAt(s), c = this.pointAt(s + ds);
    return curvatureOf(a, b, c);
  }
}

// raw: [{x,z,t}] world points with timestamps (ms); vehicle: {x,z,heading}
export function processStroke(raw, vehicle) {
  const fx = Math.sin(vehicle.heading), fz = Math.cos(vehicle.heading);

  // per-point finger speed (world m/s), gently mapped to vehicle speed
  const speeds = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[Math.max(0, i - 2)], b = raw[Math.min(raw.length - 1, i + 2)];
    const dt = Math.max(30, b.t - a.t) / 1000;
    const v = Math.hypot(b.x - a.x, b.z - a.z) / dt;
    const norm = Math.max(0, Math.min(1, v / 16));
    speeds.push(1.5 + 1.6 * norm); // 1.5 .. 3.1 m/s — calm even for wild swipes
  }

  // lead-in along current vehicle heading so the path leaves feasibly
  const pts = [
    { x: vehicle.x, z: vehicle.z, s: 1.5 },
    { x: vehicle.x + fx * 1.4, z: vehicle.z + fz * 1.4, s: 1.5 }
  ];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (Math.hypot(p.x - vehicle.x, p.z - vehicle.z) < 2.2 && pts.length <= 2) continue;
    pts.push({ x: p.x, z: p.z, s: speeds[i] });
  }

  // very short stroke → still produce a short forward run
  let rough = resample(pts, 0.35);
  if (rough.length < 8) {
    const lx = rough.length ? rough[rough.length - 1].x : vehicle.x;
    const lz = rough.length ? rough[rough.length - 1].z : vehicle.z;
    let dx = lx - vehicle.x, dz = lz - vehicle.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) { dx = fx; dz = fz; } else { dx /= d; dz /= d; }
    for (let i = 1; i <= 12; i++) rough.push({ x: lx + dx * 0.35 * i, z: lz + dz * 0.35 * i, s: 1.6 });
    rough = resample(rough, 0.35);
  }

  rough.forEach((p, i) => { if (i > 1) clampToRink(p); });

  // jitter removal (small window — big curves survive)
  for (let i = 0; i < 4; i++) smoothPass(rough, 0.85, true);
  // real turn radius
  relaxCurvature(rough, 1 / VEHICLE_SPEC.minTurnRadius, 90, true);
  for (let i = 0; i < 2; i++) smoothPass(rough, 0.6, true);

  // smooth speeds + slow into curves
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 1; i < rough.length - 1; i++) {
      rough[i].s = ((rough[i - 1].s ?? 2) + (rough[i].s ?? 2) * 2 + (rough[i + 1].s ?? 2)) * 0.25;
    }
  }
  const path = new DrivePath(rough);
  for (let i = 0; i < rough.length; i++) {
    const k = Math.abs(path.curvatureAt(path.cum[i]));
    rough[i].s = (rough[i].s ?? 2) / (1 + 4.5 * k);
    rough[i].s = Math.max(1.1, Math.min(3.1, rough[i].s));
  }
  return new DrivePath(rough);
}
