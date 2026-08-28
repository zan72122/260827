import { PerspectiveCamera, Vector3 } from 'three';

/**
 * Scripted camera.
 *
 * The player never gets an orbit control: every beat of the game names a shot
 * and the director eases to it. Shots are functions rather than fixed points,
 * so a shot can ride the horse's chest or track the sleigh while still being
 * a single authored idea.
 */

export interface Shot {
  name: string;
  eye: (out: Vector3, t: number) => void;
  target: (out: Vector3, t: number) => void;
  fov?: number;
  /** extra field of view in portrait, where the frame is narrow */
  portraitFov?: number;
  /** in portrait the subject sits low and the road runs up the frame */
  portraitLift?: number;
  /** approximate seconds to settle after a cut */
  ease?: number;
  /** hand-held micro movement amplitude, 0 disables */
  handheld?: number;
}

const _e = new Vector3();
const _t = new Vector3();
const _up = new Vector3(0, 1, 0);

export class CameraDirector {
  private eye = new Vector3(0, 1.6, 3);
  private target = new Vector3(0, 1, 0);
  private eyeVel = new Vector3();
  private targetVel = new Vector3();
  private shot: Shot | null = null;
  private shotTime = 0;
  private fov = 46;
  private reducedMotion = false;
  portrait = false;

  constructor(private camera: PerspectiveCamera) {}

  setReducedMotion(v: boolean): void {
    this.reducedMotion = v;
  }

  get current(): string {
    return this.shot?.name ?? '';
  }

  get elapsedInShot(): number {
    return this.shotTime;
  }

  play(shot: Shot, immediate = false): void {
    if (this.shot?.name === shot.name) {
      this.shot = shot;
      return;
    }
    this.shot = shot;
    this.shotTime = 0;
    if (immediate) {
      shot.eye(this.eye, 0);
      shot.target(this.target, 0);
      this.eyeVel.set(0, 0, 0);
      this.targetVel.set(0, 0, 0);
      this.applyFov(1);
    }
  }

  private applyFov(mix: number): void {
    const s = this.shot;
    if (!s) return;
    const base = this.portrait ? (s.portraitFov ?? (s.fov ?? 46) + 8) : (s.fov ?? 46);
    this.fov += (base - this.fov) * mix;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, elapsed: number): void {
    const s = this.shot;
    if (!s) return;
    this.shotTime += dt;

    s.eye(_e, this.shotTime);
    s.target(_t, this.shotTime);

    if (this.portrait && s.portraitLift) {
      _t.y += s.portraitLift;
      _e.y += s.portraitLift * 0.35;
    }

    // Critically damped follow: no overshoot, no snap.
    const ease = Math.max(0.05, (s.ease ?? 0.55) * (this.reducedMotion ? 1.6 : 1));
    const k = 1 - Math.exp((-dt * 4.6) / ease);
    this.eye.lerp(_e, k);
    this.target.lerp(_t, k);
    this.applyFov(Math.min(1, dt * 3));

    const hh = this.reducedMotion ? 0 : (s.handheld ?? 0);
    if (hh > 0) {
      const a = elapsed * 0.9;
      this.eye.x += Math.sin(a * 1.7) * hh * 0.006;
      this.eye.y += Math.sin(a * 2.3 + 1.1) * hh * 0.005;
      this.target.y += Math.sin(a * 1.3 + 0.4) * hh * 0.003;
    }

    this.camera.position.copy(this.eye);
    this.camera.up.copy(_up);
    this.camera.lookAt(this.target);
  }

  /** Used when the game hands the camera to a new set without a visible move. */
  snap(): void {
    if (!this.shot) return;
    this.shot.eye(this.eye, this.shotTime);
    this.shot.target(this.target, this.shotTime);
    this.camera.position.copy(this.eye);
    this.camera.lookAt(this.target);
    this.applyFov(1);
  }
}

export function fixedShot(
  name: string,
  eye: [number, number, number],
  target: [number, number, number],
  opts: Partial<Shot> = {},
): Shot {
  const e = new Vector3(...eye);
  const t = new Vector3(...target);
  return {
    name,
    eye: (out) => {
      out.copy(e);
    },
    target: (out) => {
      out.copy(t);
    },
    ...opts,
  };
}
