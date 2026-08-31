import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep, wrapAngle } from '../util/math';
import { CAKE_TOP } from '../scene/CakeSurfaceContact';

export type ShotName =
  | 'macro'
  | 'approach'
  | 'extrude'
  | 'inspect'
  | 'bench'
  | 'topDown'
  | 'lowSide'
  | 'free'
  | 'finale';

export interface DirectorContext {
  tip: THREE.Vector3;
  /** unit direction of the current stroke, if any */
  strokeDirX: number;
  strokeDirZ: number;
  aspect: number;
  portrait: boolean;
  elapsed: number;
}

interface ShotDef {
  radius: number;
  elevation: number;
  /** null = derive from the tip / free azimuth */
  azimuth: number | null;
  fov: number;
  target(ctx: DirectorContext, out: THREE.Vector3): void;
  tau: number;
  margin: number;
  /** how far to drop the subject in the frame, leaving room for the kitchen */
  lift?: number;
}

const FREE_AZ = -0.72;

/**
 * There is no free camera. Each beat of the game has one shot that makes the
 * relationship between the metal opening, the cream coming out and the finished
 * shape readable — and every one of them can be held in portrait or landscape.
 */
export class CameraDirector {
  private shot: ShotName = 'macro';
  private pos = new THREE.Vector3(0.05, 0.22, 0.09);
  private look = new THREE.Vector3(0, 0.1, 0);
  private fov = 30;
  private az = FREE_AZ;
  private tmpTarget = new THREE.Vector3();
  private since = 0;
  private lastBias = 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {
    camera.position.copy(this.pos);
    camera.lookAt(this.look);
  }

  get current(): ShotName {
    return this.shot;
  }

  get timeInShot(): number {
    return this.since;
  }

  set(shot: ShotName): void {
    if (this.shot === shot) return;
    this.shot = shot;
    this.since = 0;
  }

  private defs: Record<ShotName, ShotDef> = {
    macro: {
      radius: 0.0118,
      elevation: -0.44,
      azimuth: -0.55,
      fov: 26,
      tau: 0.55,
      margin: 1.0,
      target: (c, o) => o.set(c.tip.x, c.tip.y + 0.0035, c.tip.z),
    },
    approach: {
      radius: 0.062,
      elevation: 0.36,
      azimuth: -0.68,
      fov: 30,
      tau: 0.85,
      margin: 1.08,
      target: (c, o) => o.set(c.tip.x * 0.4, lerp(c.tip.y, CAKE_TOP + 0.012, 0.55), c.tip.z * 0.4),
    },
    extrude: {
      radius: 0.040,
      elevation: 0.24,
      azimuth: null,
      fov: 30,
      tau: 0.5,
      margin: 1.12,
      target: (c, o) => o.set(c.tip.x * 0.92, CAKE_TOP + 0.010, c.tip.z * 0.92),
    },
    inspect: {
      radius: 0.055,
      elevation: 0.40,
      azimuth: null,
      fov: 30,
      tau: 0.9,
      margin: 1.15,
      target: (c, o) => o.set(c.tip.x * 0.9, CAKE_TOP + 0.009, c.tip.z * 0.9),
    },
    bench: {
      radius: 0.112,
      elevation: 0.52,
      azimuth: null,
      fov: 32,
      tau: 0.9,
      margin: 1.06,
      lift: 0.030,
      target: (_c, o) => o.set(0.03, 0.030, -0.048),
    },
    topDown: {
      radius: 0.052,
      elevation: 1.14,
      azimuth: null,
      fov: 30,
      tau: 0.7,
      margin: 1.15,
      target: (c, o) => o.set(c.tip.x, CAKE_TOP + 0.006, c.tip.z),
    },
    lowSide: {
      radius: 0.050,
      // low enough to read the belly and the tail, high enough that the cake
      // top is still a surface you can draw a circle on
      elevation: 0.345,
      azimuth: null,
      fov: 30,
      tau: 0.6,
      margin: 1.15,
      target: (c, o) => o.set(c.tip.x, CAKE_TOP + 0.008, c.tip.z),
    },
    free: {
      radius: 0.086,
      elevation: 0.505,
      azimuth: null,
      fov: 31,
      tau: 0.75,
      margin: 1.1,
      lift: 0.062,
      target: (c, o) => o.set(c.tip.x * 0.3, CAKE_TOP + 0.014, c.tip.z * 0.3),
    },
    finale: {
      radius: 0.094,
      elevation: 0.48,
      azimuth: null,
      fov: 31,
      tau: 1.4,
      margin: 1.12,
      lift: 0.048,
      target: (_c, o) => o.set(0, CAKE_TOP + 0.012, 0),
    },
  };

  private desiredAzimuth(ctx: DirectorContext): number {
    const r = Math.hypot(ctx.tip.x, ctx.tip.z);
    switch (this.shot) {
      case 'lowSide': {
        // stand square to the shell so its belly and tail read
        const a = Math.atan2(ctx.strokeDirZ, ctx.strokeDirX);
        return a + Math.PI * 0.5;
      }
      case 'free':
      case 'extrude':
      case 'inspect':
      case 'topDown': {
        const follow = smoothstep(0.030, 0.060, r);
        const toTip = Math.atan2(ctx.tip.z, ctx.tip.x);
        return FREE_AZ + wrapAngle(toTip - FREE_AZ) * follow * 0.85;
      }
      default:
        return FREE_AZ;
    }
  }

  /**
   * While the child is piping, the camera holds absolutely still. Moving it
   * mid-stroke would quietly rotate the mapping from finger to cake under their
   * hand, and the circle they drew would come out as a spiral.
   */
  freeze(on: boolean): void {
    this.frozen = on;
  }

  private frozen = false;

  update(dt: number, ctx: DirectorContext): void {
    this.since += dt;
    if (this.frozen) {
      this.camera.position.copy(this.pos);
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.look.x, this.look.y + this.lastBias, this.look.z);
      return;
    }
    const d = this.defs[this.shot];
    d.target(ctx, this.tmpTarget);

    // portrait uses the height of the screen for the cake, landscape widens out
    // so the bag and the finished pattern share the frame
    const fovBase = ctx.portrait ? d.fov + 2 : d.fov;
    const vFov = (fovBase * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * ctx.aspect);
    const fit = Math.min(vFov, hFov);
    let radius = d.radius * d.margin;
    if (!ctx.portrait && (this.shot === 'free' || this.shot === 'finale' || this.shot === 'bench'))
      radius *= 1.24;
    if (ctx.portrait && (this.shot === 'free' || this.shot === 'finale')) radius *= 1.04;
    const dist = radius / Math.tan(fit / 2);

    const azTarget = d.azimuth ?? this.desiredAzimuth(ctx);
    this.az += wrapAngle(azTarget - this.az) * clamp(dt / Math.max(d.tau, 1e-3), 0, 1);

    const el = d.elevation;
    const ce = Math.cos(el);
    const px = this.tmpTarget.x + Math.cos(this.az) * ce * dist;
    const py = this.tmpTarget.y + Math.sin(el) * dist;
    const pz = this.tmpTarget.z + Math.sin(this.az) * ce * dist;

    const k = Math.max(d.tau, 1e-3);
    this.pos.x = damp(this.pos.x, px, k * 0.45, dt);
    this.pos.y = damp(this.pos.y, py, k * 0.45, dt);
    this.pos.z = damp(this.pos.z, pz, k * 0.45, dt);
    this.look.x = damp(this.look.x, this.tmpTarget.x, k * 0.42, dt);
    this.look.y = damp(this.look.y, this.tmpTarget.y, k * 0.42, dt);
    this.look.z = damp(this.look.z, this.tmpTarget.z, k * 0.42, dt);
    this.fov = damp(this.fov, fovBase, k * 0.5, dt);

    // a tall frame can afford to sit the cake lower and show the kitchen above
    const bias = (d.lift ?? 0) * (ctx.portrait ? 1 : 0.42);
    this.lastBias = bias;
    this.camera.position.copy(this.pos);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.look.x, this.look.y + bias, this.look.z);
  }

  /** Horizontal direction pointing away from the camera — the bag leans this way. */
  bagLean(out: THREE.Vector3): THREE.Vector3 {
    out.set(this.look.x - this.pos.x, 0, this.look.z - this.pos.z);
    if (out.lengthSq() < 1e-8) out.set(0, 0, -1);
    return out.normalize();
  }
}
