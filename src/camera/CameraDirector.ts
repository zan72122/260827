import * as THREE from 'three';
import { easeInOut, clamp } from '../util/math';

/**
 * The camera holds still while a child is working — a moving camera and a
 * moving finger fight each other — and only travels between steps of the job.
 *
 * Each shot has a portrait and a landscape framing. Upright, the flower and the
 * height of the cake matter most, so the camera stands a little higher and
 * closer; on its side, the relationship between the hands and the cake matters,
 * so it pulls back and sits lower.
 */

export interface Shot {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

export interface ShotPair {
  portrait: Shot;
  landscape: Shot;
}

const shot = (px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov: number): Shot => ({
  position: new THREE.Vector3(px, py, pz),
  target: new THREE.Vector3(tx, ty, tz),
  fov,
});

export type ShotName =
  | 'welcome'
  | 'smoothing'
  | 'piping'
  | 'placing'
  | 'carry'
  | 'candle'
  | 'cutting'
  | 'given'
  | 'admire';

export const SHOTS: Record<ShotName, ShotPair> = {
  // Upright, the frame is narrow, so every shot has to stand further back to
  // fit a 180 mm cake across it; on its side there is width to spare and the
  // camera can come in closer to the hands.
  welcome: {
    portrait: shot(-0.060, 1.360, 0.660, -0.150, 1.000, 0.0, 46),
    landscape: shot(-0.020, 1.215, 0.520, -0.145, 0.995, 0.0, 40),
  },
  smoothing: {
    portrait: shot(-0.135, 1.145, 0.600, -0.152, 0.998, 0.0, 44),
    landscape: shot(-0.140, 1.075, 0.400, -0.152, 0.995, 0.0, 34),
  },
  piping: {
    // The flower is about a third of the frame across, with the tip, the cream
    // leaving it and the petal below all inside the same view.
    portrait: shot(0.084, 1.139, 0.268, 0.045, 1.047, 0.105, 34),
    landscape: shot(0.077, 1.122, 0.235, 0.045, 1.045, 0.105, 26),
  },
  placing: {
    portrait: shot(-0.152, 1.460, 0.520, -0.152, 1.034, 0.0, 40),
    landscape: shot(-0.152, 1.300, 0.400, -0.152, 1.032, 0.0, 36),
  },
  carry: {
    portrait: shot(1.100, 1.450, 0.640, 1.900, 0.850, 1.300, 46),
    landscape: shot(1.180, 1.340, 0.720, 1.900, 0.840, 1.300, 42),
  },
  candle: {
    portrait: shot(1.559, 1.108, 0.785, 1.900, 0.808, 1.300, 44),
    landscape: shot(1.620, 1.036, 0.880, 1.900, 0.802, 1.300, 34),
  },
  cutting: {
    portrait: shot(1.520, 1.172, 0.740, 1.900, 0.790, 1.300, 44),
    landscape: shot(1.590, 1.088, 0.855, 1.900, 0.786, 1.300, 34),
  },
  given: {
    portrait: shot(1.760, 1.080, 0.760, 2.080, 0.790, 1.150, 44),
    landscape: shot(1.800, 1.010, 0.860, 2.080, 0.786, 1.150, 36),
  },
  admire: {
    portrait: shot(1.340, 1.270, 0.650, 1.900, 0.800, 1.300, 46),
    landscape: shot(1.420, 1.165, 0.760, 1.900, 0.795, 1.300, 40),
  },
};

/** Extra angles used only for checking the work, never during play. */
export const DEV_SHOTS: Record<string, ShotPair> = {
  // Far enough out that a 38 mm flower fits across a narrow portrait frame,
  // which is the point of these: to check the solid from every side.
  'flower-side': {
    portrait: shot(0.045, 1.048, 0.255, 0.045, 1.0465, 0.105, 22),
    landscape: shot(0.045, 1.048, 0.255, 0.045, 1.0465, 0.105, 22),
  },
  'flower-back': {
    portrait: shot(0.062, 1.078, -0.035, 0.045, 1.046, 0.105, 22),
    landscape: shot(0.062, 1.078, -0.035, 0.045, 1.046, 0.105, 22),
  },
  'flower-top': {
    portrait: shot(0.047, 1.190, 0.109, 0.045, 1.043, 0.105, 22),
    landscape: shot(0.047, 1.190, 0.109, 0.045, 1.043, 0.105, 22),
  },
  'flower-far-side': {
    portrait: shot(-0.100, 1.062, 0.145, 0.045, 1.046, 0.105, 22),
    landscape: shot(-0.100, 1.062, 0.145, 0.045, 1.046, 0.105, 22),
  },
  'cake-low': {
    portrait: shot(-0.115, 0.995, 0.620, -0.152, 0.992, 0.0, 38),
    landscape: shot(-0.115, 0.995, 0.620, -0.152, 0.992, 0.0, 38),
  },
  'cake-top': {
    portrait: shot(-0.152, 1.680, 0.060, -0.152, 1.030, 0.0, 40),
    landscape: shot(-0.152, 1.680, 0.060, -0.152, 1.030, 0.0, 40),
  },
  'room-wide': {
    portrait: shot(1.15, 1.95, 2.45, 0.6, 0.92, 0.35, 46),
    landscape: shot(1.15, 1.95, 2.45, 0.6, 0.92, 0.35, 46),
  },
};

export class CameraDirector {
  readonly camera: THREE.PerspectiveCamera;
  private fromPos = new THREE.Vector3();
  private fromTarget = new THREE.Vector3();
  private fromFov = 40;
  private toShot: Shot;
  private t = 1;
  private duration = 1;
  readonly target = new THREE.Vector3();
  private current: ShotName = 'welcome';
  private devShot: Shot | null = null;
  private portrait = true;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.012, 24);
    this.toShot = SHOTS.welcome.portrait;
    this.apply(this.toShot);
  }

  private apply(s: Shot): void {
    this.camera.position.copy(s.position);
    this.target.copy(s.target);
    this.camera.fov = s.fov;
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  setOrientation(portrait: boolean): void {
    if (portrait === this.portrait) return;
    this.portrait = portrait;
    // Re-frame immediately; the child does not want a swoop for turning the
    // device, they want to carry on.
    const s = this.shotFor(this.current);
    this.toShot = s;
    if (this.t >= 1) this.apply(s);
  }

  private shotFor(name: ShotName): Shot {
    const pair = SHOTS[name];
    return this.portrait ? pair.portrait : pair.landscape;
  }

  /** Aim at something whose position is only known at run time. */
  goToCustom(s: Shot, duration = 1.1): void {
    this.devShot = null;
    if (duration <= 0) {
      this.toShot = s;
      this.t = 1;
      this.apply(s);
      return;
    }
    this.fromPos.copy(this.camera.position);
    this.fromTarget.copy(this.target);
    this.fromFov = this.camera.fov;
    this.toShot = s;
    this.duration = duration;
    this.t = 0;
  }

  goTo(name: ShotName, duration = 1.1): void {
    this.current = name;
    this.devShot = null;
    const s = this.shotFor(name);
    if (duration <= 0) {
      this.toShot = s;
      this.t = 1;
      this.apply(s);
      return;
    }
    this.fromPos.copy(this.camera.position);
    this.fromTarget.copy(this.target);
    this.fromFov = this.camera.fov;
    this.toShot = s;
    this.duration = duration;
    this.t = 0;
  }

  /** True while the camera is travelling; input is ignored during a move. */
  get moving(): boolean {
    return this.t < 1;
  }

  get shotName(): ShotName {
    return this.current;
  }

  setDevShot(s: Shot | null): void {
    this.devShot = s;
    if (s) {
      this.t = 1;
      this.apply(s);
    } else {
      this.apply(this.shotFor(this.current));
    }
  }

  get inDevShot(): boolean {
    return this.devShot !== null;
  }

  update(dt: number): void {
    if (this.devShot) return;
    if (this.t >= 1) return;
    this.t = clamp(this.t + dt / this.duration, 0, 1);
    const k = easeInOut(this.t);
    this.camera.position.lerpVectors(this.fromPos, this.toShot.position, k);
    this.target.lerpVectors(this.fromTarget, this.toShot.target, k);
    this.camera.fov = this.fromFov + (this.toShot.fov - this.fromFov) * k;
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
