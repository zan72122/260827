import * as THREE from 'three';
import { clamp, easeInOutCubic, damp } from '../core/util';
import type { Stage, Orientation } from '../core/stage';

export interface Shot {
  /** degrees, 0 = looking from +Z */
  yaw: number;
  /** degrees above the bench */
  pitch: number;
  dist: number;
  target: [number, number, number];
  fov: number;
}

export type ShotName =
  | 'intro' | 'press' | 'drop' | 'petals' | 'clinch'
  | 'polish' | 'cord' | 'lift' | 'shake';

type ShotTable = Record<ShotName, Shot>;

/**
 * The camera is never handed to the player. Each step has one shot that shows
 * the cause and the effect in the same frame, and moves are always tweened --
 * the metal is never cut away from mid-deformation.
 */
const LANDSCAPE: ShotTable = {
  intro:  { yaw:  36, pitch: 31, dist: 0.98, target: [0, 0.05, -0.01], fov: 31 },
  press:  { yaw: -22, pitch: 27, dist: 1.10, target: [-0.02, 0.10, 0.05], fov: 36 },
  drop:   { yaw:   8, pitch: 62, dist: 0.94, target: [0, 0.03, -0.02], fov: 32 },
  petals: { yaw:  26, pitch: 42, dist: 1.16, target: [0, 0.07, -0.01], fov: 31 },
  clinch: { yaw:  20, pitch: 30, dist: 1.26, target: [0, 0.10, 0.04], fov: 36 },
  polish: { yaw:  12, pitch: 24, dist: 1.02, target: [0, 0.12, 0], fov: 32 },
  cord:   { yaw:  14, pitch: 22, dist: 1.14, target: [0, 0.15, 0.02], fov: 34 },
  lift:   { yaw:  12, pitch: 14, dist: 1.30, target: [0, 0.26, 0], fov: 32 },
  shake:  { yaw:  10, pitch: 10, dist: 1.55, target: [0, 0.36, 0], fov: 34 },
};

const PORTRAIT: ShotTable = {
  intro:  { yaw:  30, pitch: 38, dist: 0.90, target: [0, 0.05, -0.02], fov: 45 },
  press:  { yaw: -16, pitch: 34, dist: 1.02, target: [0, 0.08, 0.05], fov: 48 },
  drop:   { yaw:   6, pitch: 66, dist: 0.88, target: [0, 0.04, -0.01], fov: 44 },
  petals: { yaw:  18, pitch: 46, dist: 1.08, target: [0, 0.08, -0.01], fov: 42 },
  clinch: { yaw:  16, pitch: 36, dist: 1.14, target: [0, 0.10, 0.04], fov: 46 },
  polish: { yaw:  10, pitch: 24, dist: 0.80, target: [0, 0.13, 0], fov: 40 },
  cord:   { yaw:  12, pitch: 24, dist: 0.96, target: [0, 0.15, 0.02], fov: 42 },
  lift:   { yaw:  10, pitch: 16, dist: 1.02, target: [0, 0.28, 0], fov: 42 },
  shake:  { yaw:   8, pitch: 12, dist: 1.22, target: [0, 0.38, 0], fov: 44 },
};

export class Director {
  private cur: Shot;
  private from: Shot;
  private to: Shot;
  private t = 1;
  private dur = 1;
  private orientation: Orientation;
  private name: ShotName = 'intro';
  /** extra target offset that follows a moving object (the lifted bell) */
  readonly follow = new THREE.Vector3();
  private followBlend = 0;
  private shakeAmp = 0;
  private time = 0;

  constructor(private stage: Stage) {
    this.orientation = stage.orientation;
    const s = this.table()[this.name];
    this.cur = { ...s, target: [...s.target] as [number, number, number] };
    this.from = { ...this.cur };
    this.to = { ...this.cur };
    this.apply();
  }

  private table() { return this.orientation === 'landscape' ? LANDSCAPE : PORTRAIT; }

  cut(name: ShotName, duration = 1.1) {
    this.name = name;
    this.from = { ...this.cur, target: [...this.cur.target] as [number, number, number] };
    const s = this.table()[name];
    this.to = { ...s, target: [...s.target] as [number, number, number] };
    this.t = 0;
    this.dur = Math.max(duration, 0.001);
  }

  /** re-frame after a device rotation without changing the step */
  reframe() {
    if (this.orientation === this.stage.orientation) return;
    this.orientation = this.stage.orientation;
    const s = this.table()[this.name];
    this.from = { ...this.cur, target: [...this.cur.target] as [number, number, number] };
    this.to = { ...s, target: [...s.target] as [number, number, number] };
    this.t = 0;
    this.dur = 0.55;
  }

  setFollow(p: THREE.Vector3 | null, blend = 1) {
    if (p) { this.follow.copy(p); this.followBlend = blend; }
    else this.followBlend = 0;
  }

  /** brief camera shake, used only where the machine really thumps */
  impulse(a: number) { this.shakeAmp = Math.min(this.shakeAmp + a, 0.02); }

  update(dt: number) {
    this.time += dt;
    if (this.t < 1) {
      this.t = clamp(this.t + dt / this.dur, 0, 1);
      const e = easeInOutCubic(this.t);
      this.cur.yaw = this.from.yaw + (this.to.yaw - this.from.yaw) * e;
      this.cur.pitch = this.from.pitch + (this.to.pitch - this.from.pitch) * e;
      this.cur.dist = this.from.dist + (this.to.dist - this.from.dist) * e;
      this.cur.fov = this.from.fov + (this.to.fov - this.from.fov) * e;
      for (let i = 0; i < 3; i++) {
        this.cur.target[i] = this.from.target[i] + (this.to.target[i] - this.from.target[i]) * e;
      }
    }
    this.shakeAmp = damp(this.shakeAmp, 0, 7, dt);
    this.apply();
  }

  private apply() {
    const cam = this.stage.camera;
    const yaw = (this.cur.yaw * Math.PI) / 180;
    const pitch = (this.cur.pitch * Math.PI) / 180;
    _target.set(this.cur.target[0], this.cur.target[1], this.cur.target[2]);
    if (this.followBlend > 0) {
      _target.lerp(this.follow, this.followBlend);
    }
    const cp = Math.cos(pitch);
    cam.position.set(
      _target.x + Math.sin(yaw) * cp * this.cur.dist,
      _target.y + Math.sin(pitch) * this.cur.dist,
      _target.z + Math.cos(yaw) * cp * this.cur.dist
    );
    if (this.shakeAmp > 0.0002) {
      cam.position.x += Math.sin(this.time * 61) * this.shakeAmp;
      cam.position.y += Math.sin(this.time * 47 + 1.3) * this.shakeAmp;
    }
    cam.lookAt(_target);
    if (Math.abs(cam.fov - this.cur.fov) > 0.001) {
      cam.fov = this.cur.fov;
      cam.updateProjectionMatrix();
    }
  }

  /**
   * The camera pose a named shot will have on this screen. Props are staged
   * against the shot they are used in, not against wherever the camera happens
   * to be mid-move, so nothing drifts across the bench while a move plays.
   */
  poseFor(name: ShotName, outPos: THREE.Vector3, outTarget: THREE.Vector3): number {
    const s = this.table()[name];
    const yaw = (s.yaw * Math.PI) / 180;
    const pitch = (s.pitch * Math.PI) / 180;
    outTarget.set(s.target[0], s.target[1], s.target[2]);
    const cp = Math.cos(pitch);
    outPos.set(
      outTarget.x + Math.sin(yaw) * cp * s.dist,
      outTarget.y + Math.sin(pitch) * s.dist,
      outTarget.z + Math.cos(yaw) * cp * s.dist
    );
    return s.fov;
  }

  get current(): ShotName { return this.name; }
}

const _target = new THREE.Vector3();
