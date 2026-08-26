import * as THREE from 'three';

/**
 * The bag's entire journey is ONE continuous 3D path through a single world.
 * journeyProgress (0..1) maps to arc length along this path via anchor points,
 * so the spec's progress milestones land exactly on the right hardware.
 */

export interface PathSample {
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
}

// Waypoints: [x, y(surface top the bag rides on), z]
// Terminal floor is y=0. The sort hall is a real basement level (belt top -1.5).
export const WAYPOINTS: [number, number, number][] = [
  [-0.6, 0.45, 0], //  0 check-in scale (start)
  [2.6, 0.45, 0], //  1 injection belt run
  [4.2, 0.45, 0], //  2 rubber strip curtain plane
  [6.2, 0.38, 0], //  3 backstage begins, top of decline
  [10.6, -1.5, 0], //  4 bottom of decline (sort hall level)
  [16.0, -1.5, 0], //  5 screening machine inlet
  [19.8, -1.5, 0], //  6 screening machine outlet
  [23.6, -1.5, 0], //  7 high-speed diverter point
  [26.8, -1.5, 2.6], //  8 diverted branch lane
  [29.0, -1.45, 3.2], //  9 shutter into make-up incline
  [33.6, 0.3, 3.2], // 10 top of incline (ground level make-up hall)
  [37.6, 0.42, 3.2], // 11 make-up hall, carts alongside
  [40.6, 0.42, 3.2], // 12 building exit door (to apron)
  [43.6, 0.45, 3.6], // 13 outdoor transfer belt
  [47.0, 0.55, 4.6], // 14 belt loader rear (transfer contact)
  [49.6, 2.95, 8.8], // 15 loader head at cargo sill
  [50.2, 3.0, 10.2], // 16 through the cargo doorway
  [50.8, 3.0, 11.9], // 17 final rest beside other bags
];

// progress anchor → waypoint index (spec milestones)
const ANCHORS: [number, number][] = [
  [0.0, 0],
  [0.1, 1],
  [0.16, 2], // curtain contact mid-point
  [0.22, 3],
  [0.31, 4],
  [0.4, 5],
  [0.54, 6],
  [0.6, 7], // diverter clunk
  [0.66, 8],
  [0.69, 9],
  [0.73, 10],
  [0.755, 11],
  [0.78, 12],
  [0.84, 13],
  [0.9, 14],
  [0.965, 15],
  [0.982, 16],
  [1.0, 17],
];

interface Seg {
  kind: 'line' | 'arc';
  s0: number;
  len: number;
  a: THREE.Vector3; // line start / arc start
  b: THREE.Vector3; // line end / arc end
  c?: THREE.Vector3; // arc control (the original corner)
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class JourneyPath {
  segs: Seg[] = [];
  totalLength = 0;
  /** arc length at each original waypoint */
  sAtWaypoint: number[] = [];
  private anchorS: [number, number][] = [];

  constructor(points: [number, number, number][], fillet = 0.9) {
    const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    // Build line segments shortened at interior corners, joined by quadratic fillets.
    const n = pts.length;
    const cut: { in: THREE.Vector3; out: THREE.Vector3 }[] = [];
    for (let i = 0; i < n; i++) {
      if (i === 0 || i === n - 1) {
        cut.push({ in: pts[i].clone(), out: pts[i].clone() });
        continue;
      }
      const dPrev = _v1.subVectors(pts[i], pts[i - 1]).length();
      const dNext = _v2.subVectors(pts[i + 1], pts[i]).length();
      const r = Math.min(fillet, dPrev * 0.45, dNext * 0.45);
      const pin = pts[i]
        .clone()
        .addScaledVector(_v1.subVectors(pts[i - 1], pts[i]).normalize(), r);
      const pout = pts[i]
        .clone()
        .addScaledVector(_v2.subVectors(pts[i + 1], pts[i]).normalize(), r);
      cut.push({ in: pin, out: pout });
    }
    let s = 0;
    for (let i = 0; i < n - 1; i++) {
      // line from cut[i].out → cut[i+1].in
      const a = cut[i].out.clone();
      const b = cut[i + 1].in.clone();
      const lineLen = a.distanceTo(b);
      if (i === 0) this.sAtWaypoint[0] = 0;
      if (lineLen > 1e-6) {
        this.segs.push({ kind: 'line', s0: s, len: lineLen, a, b });
        s += lineLen;
      }
      if (i + 1 < n - 1) {
        // arc at waypoint i+1: quadratic bezier cut[i+1].in → pts[i+1] → cut[i+1].out
        const arcA = cut[i + 1].in.clone();
        const arcB = cut[i + 1].out.clone();
        const c = pts[i + 1].clone();
        let arcLen = 0;
        let prev = arcA.clone();
        const tmp = new THREE.Vector3();
        for (let k = 1; k <= 8; k++) {
          quadBezier(arcA, c, arcB, k / 8, tmp);
          arcLen += prev.distanceTo(tmp);
          prev.copy(tmp);
        }
        this.sAtWaypoint[i + 1] = s + arcLen * 0.5;
        if (arcLen > 1e-6) {
          this.segs.push({ kind: 'arc', s0: s, len: arcLen, a: arcA, b: arcB, c });
          s += arcLen;
        }
      } else {
        this.sAtWaypoint[i + 1] = s;
      }
    }
    this.totalLength = s;
    this.anchorS = ANCHORS.map(([p, wi]) => [p, this.sAtWaypoint[wi]]);
  }

  progressToS(p: number): number {
    p = THREE.MathUtils.clamp(p, 0, 1);
    const a = this.anchorS;
    for (let i = 0; i < a.length - 1; i++) {
      if (p <= a[i + 1][0]) {
        const t = (p - a[i][0]) / (a[i + 1][0] - a[i][0]);
        return THREE.MathUtils.lerp(a[i][1], a[i + 1][1], t);
      }
    }
    return this.totalLength;
  }

  sToProgress(s: number): number {
    const a = this.anchorS;
    s = THREE.MathUtils.clamp(s, 0, this.totalLength);
    for (let i = 0; i < a.length - 1; i++) {
      if (s <= a[i + 1][1]) {
        const t = (s - a[i][1]) / Math.max(1e-6, a[i + 1][1] - a[i][1]);
        return THREE.MathUtils.lerp(a[i][0], a[i + 1][0], t);
      }
    }
    return 1;
  }

  sampleS(s: number, out: PathSample): void {
    s = THREE.MathUtils.clamp(s, 0, this.totalLength);
    let seg = this.segs[this.segs.length - 1];
    for (const sg of this.segs) {
      if (s <= sg.s0 + sg.len) {
        seg = sg;
        break;
      }
    }
    const t = THREE.MathUtils.clamp((s - seg.s0) / seg.len, 0, 1);
    if (seg.kind === 'line') {
      out.pos.lerpVectors(seg.a, seg.b, t);
      out.tangent.subVectors(seg.b, seg.a).normalize();
    } else {
      quadBezier(seg.a, seg.c!, seg.b, t, out.pos);
      // derivative of quadratic bezier
      out.tangent
        .subVectors(seg.c!, seg.a)
        .multiplyScalar(2 * (1 - t))
        .addScaledVector(_v1.subVectors(seg.b, seg.c!), 2 * t)
        .normalize();
    }
  }

  sample(progress: number, out: PathSample): void {
    this.sampleS(this.progressToS(progress), out);
  }
}

function quadBezier(
  a: THREE.Vector3,
  c: THREE.Vector3,
  b: THREE.Vector3,
  t: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const u = 1 - t;
  out.set(
    u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    u * u * a.z + 2 * u * t * c.z + t * t * b.z,
  );
  return out;
}

export const journey = new JourneyPath(WAYPOINTS);

/** Named progress milestones used across segments, audio and lighting. */
export const P = {
  beltStart: 0.02,
  curtain: 0.16,
  backstage: 0.22,
  declineEnd: 0.31,
  screenIn: 0.4,
  screenOut: 0.54,
  divert: 0.6,
  branch: 0.66,
  shutter: 0.69,
  makeup: 0.755,
  exitDoor: 0.78,
  loaderFoot: 0.9,
  sill: 0.965,
  doorway: 0.982,
  rest: 1.0,
};

/** Convenience: world position of a waypoint. */
export function wp(i: number): THREE.Vector3 {
  const w = WAYPOINTS[i];
  return new THREE.Vector3(w[0], w[1], w[2]);
}
