import * as THREE from 'three';
import type { PetalRecord } from '../core/FlowerRecord';
import { clamp, smoothstep } from '../util/math';

/**
 * How a petal of buttercream comes into being.
 *
 * The hand holding the bag keeps the tip at roughly one bearing beside the
 * flower and swings it up and over in a shallow arc; the other hand turns the
 * nail underneath. So in the frame of the *nail* — which is the frame the
 * flower lives in — the tip traces an arc that wraps around the centre. That is
 * the whole trick, and it is why a petal is curved rather than straight.
 *
 * The tip's attitude follows from one number, `lean`: how far above horizontal
 * the bag is held. The mouth of the tip is perpendicular to the bag, so the
 * slot — and therefore the ribbon — is the vertical direction rotated inwards
 * by exactly that angle. Holding the bag high tips the ribbon in over the cone,
 * which is how the tight inner whorl is made; holding it nearly level stands
 * the ribbon up, which is how the open outer whorl is made. The two rows differ
 * because the hand differs, not because a different model is swapped in.
 *
 * Everything below is a pure function of a PetalRecord, which is why the flower
 * can be rebuilt bit for bit when it moves from the paper to the cake to the
 * plate.
 */

export interface PetalSample {
  /** Tip outlet, in nail-local metres. */
  pos: THREE.Vector3;
  /** Unit vector along the tip's slot, from the thick end to the thin end. */
  wide: THREE.Vector3;
  /** Unit normal of the ribbon face. */
  normal: THREE.Vector3;
  /** Ribbon width at this point, metres. */
  band: number;
  /** Ribbon thickness at its root, metres. */
  thickness: number;
  /** Signed furl of the free edge here: negative inwards, positive outwards. */
  curl: number;
}

/** Bearing (radians about the nail axis) at which the piping hand sits. */
export const PIPING_BEARING = 0;

/** The tip, in the frame that does *not* turn with the nail. */
export interface PipingFrame {
  /** Mouth of the tip. */
  pos: THREE.Vector3;
  /** From the mouth towards the bag. */
  body: THREE.Vector3;
  /** Along the slot, thick end to thin end. Always perpendicular to `body`. */
  slot: THREE.Vector3;
}

export function makePipingFrame(): PipingFrame {
  return { pos: new THREE.Vector3(), body: new THREE.Vector3(1, 0, 0), slot: new THREE.Vector3(0, 1, 0) };
}

/** How many samples a sweep of this length deserves. */
export function sampleCountFor(sweep: number): number {
  return clamp(Math.round(Math.abs(sweep) / 0.055) + 2, 4, 100);
}

export const MAX_SAMPLES = 100;

/**
 * Where the tip is, and how it is held, at a given point through the petal.
 * `prog` runs 0..1 across the petal the hand set out to make.
 */
export function pipingFrameAt(rec: PetalRecord, prog: number, out: PipingFrame): PipingFrame {
  const p = clamp(prog, 0, 1);
  const arcH = Math.sin(Math.PI * p);

  const bearing = PIPING_BEARING + 0.1 * Math.sin(p * Math.PI) * (rec.row === 0 ? -1 : 1);
  const radius = rec.radius * (1 - 0.1 * arcH);
  const cb = Math.cos(bearing);
  const sb = Math.sin(bearing);

  out.pos.set(cb * radius, rec.baseY + rec.arch * arcH, sb * radius);

  // The bag rises a little as the petal is drawn over the top of the arc.
  const lean = rec.lean + 0.16 * arcH;
  const cl = Math.cos(lean);
  const sl = Math.sin(lean);
  out.body.set(cb * cl, sl, sb * cl).normalize();
  // Perpendicular to the bag, in the same vertical plane, pointing upwards.
  out.slot.set(-cb * sl, cl, -sb * sl).normalize();
  return out;
}

const _frame = makePipingFrame();

/**
 * Evaluate one cross-section of the ribbon, expressed in the nail's own frame.
 *
 * `travelled` is how far the nail has turned since the petal began;
 * `intended` is the sweep the petal was aiming for, so that a petal cut short
 * by a lifted finger is genuinely a short petal rather than a squashed one.
 */
export function samplePetal(
  rec: PetalRecord,
  travelled: number,
  intended: number,
  flow: number,
  out: PetalSample,
): PetalSample {
  const prog = clamp(travelled / Math.max(intended, 1e-4), 0, 1);
  pipingFrameAt(rec, prog, _frame);

  // The nail has turned by startAngle + travelled, so express the tip in the
  // nail's own frame by turning the opposite way.
  const arcH = Math.sin(Math.PI * prog);
  const theta = rec.startAngle + travelled;
  const ct = Math.cos(-theta);
  const st = Math.sin(-theta);
  const rot = (v: THREE.Vector3, target: THREE.Vector3) =>
    target.set(v.x * ct + v.z * st, v.y, -v.x * st + v.z * ct);

  rot(_frame.pos, out.pos);
  rot(_frame.slot, out.wide).normalize();

  // A petal is not a rectangle. The thick root stays down against the cone the
  // whole way; what rises through the middle of the stroke is the free edge, as
  // the hand lets more of the slot out and then takes it back. Narrow where the
  // cream starts, tallest across the middle, narrow again where it is cut off.
  const startTaper = 0.70 + 0.30 * smoothstep(prog / 0.14);
  const endTaper = 0.70 + 0.30 * smoothstep((1 - prog) / 0.18);
  out.band = rec.band * startTaper * endTaper * (0.62 + 0.38 * arcH);
  // The ribbon also thins out at each end, where the bag was eased off, so a
  // petal fades into the one under it rather than stopping like a cut card.
  const ends = 0.42 + 0.58 * Math.pow(arcH, 0.45);
  out.thickness = rec.thickness * flow * ends;
  // The free edge settles most at the two ends of the ribbon, where it is
  // thinnest and has least to hold it up.
  out.curl = rec.furl * (0.42 + 0.58 * Math.abs(prog * 2 - 1));

  return out;
}

export function makeSample(): PetalSample {
  return {
    pos: new THREE.Vector3(),
    wide: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 0, 1),
    band: 0.01,
    thickness: 0.002,
    curl: 0.5,
  };
}

/**
 * Fill in each sample's face normal from the direction the tip was travelling.
 * Done as a second pass because it needs the neighbours.
 */
export function computeSampleNormals(samples: PetalSample[], count: number): void {
  const tangent = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(count - 1, i + 1)];
    tangent.subVectors(b.pos, a.pos);
    if (tangent.lengthSq() < 1e-12) tangent.set(1, 0, 0);
    tangent.normalize();
    samples[i].normal.crossVectors(tangent, samples[i].wide);
    if (samples[i].normal.lengthSq() < 1e-12) samples[i].normal.set(0, 1, 0);
    samples[i].normal.normalize();
  }
}
