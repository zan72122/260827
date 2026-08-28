import * as THREE from 'three';
import { WORLD } from './rig';

export type ShotName = 'cabin' | 'tip' | 'mid' | 'hole' | 'tank';

interface Shot {
  focus: THREE.Vector3;
  /** vertical extent to cover, in metres */
  span: number;
  dir: THREE.Vector3;
  /** horizontal extent that must also fit, for subjects wider than they are tall */
  width?: number;
}

const SHOTS: Record<ShotName, Shot> = {
  cabin: {
    focus: new THREE.Vector3(-0.06, 0.86, -0.05),
    span: 2.25,
    dir: new THREE.Vector3(0.42, 0.3, 0.86).normalize(),
  },
  tip: {
    focus: new THREE.Vector3(WORLD.rodTip.x - 0.03, WORLD.rodTip.y + 0.01, WORLD.rodTip.z),
    span: 0.4,
    dir: new THREE.Vector3(0.5, 0.1, 0.86).normalize(),
  },
  mid: {
    focus: new THREE.Vector3(-0.1, 0.94, 0.02),
    span: 2.04,
    dir: new THREE.Vector3(0.2, 0.14, 0.97).normalize(),
  },
  hole: {
    focus: new THREE.Vector3(0, -0.12, 0),
    span: 0.5,
    dir: new THREE.Vector3(0.08, 0.52, 0.85).normalize(),
  },
  tank: {
    focus: new THREE.Vector3(0.6, WORLD.deckY + 0.085, 0.3),
    span: 0.5,
    width: 0.5,
    dir: new THREE.Vector3(0.14, 0.4, 0.9).normalize(),
  },
};

const FOLLOW_DOWN = new THREE.Vector3(0.1, 0.52, 0.85).normalize();
const FOLLOW_LEVEL = new THREE.Vector3(0.15, 0.07, 0.99).normalize();
const followDir = new THREE.Vector3();

export class Director {
  readonly camera: THREE.PerspectiveCamera;
  private shot: ShotName = 'cabin';
  private mode: 'shot' | 'reveal' = 'shot';
  private revealBlend = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private targetPos = new THREE.Vector3();
  private targetLook = new THREE.Vector3();
  private portrait = true;
  private lambda = 2.4;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.02, 40);
    this.setShot('cabin', true);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.portrait = h >= w;
    this.camera.updateProjectionMatrix();
  }

  resetReveal(): void {
    this.revealBlend = 0;
  }

  setShot(name: ShotName, snap = false): void {
    this.shot = name;
    this.mode = 'shot';
    this.lambda = name === 'tip' ? 2.8 : 2.2;
    if (snap) {
      this.computeShot(SHOTS[name], this.targetPos, this.targetLook);
      this.pos.copy(this.targetPos);
      this.look.copy(this.targetLook);
      this.apply();
    }
  }

  /** Continuous reveal framing: nothing cuts once the spool starts turning. */
  reveal(topFishY: number, dt: number): void {
    this.mode = 'reveal';
    this.lambda = 3.2;
    // hand over from the dark-hole look to the rising framing well before
    // the first silver reaches the surface
    const depth = WORLD.waterY - topFishY;
    const k = THREE.MathUtils.smoothstep(depth, 0.3, 0.78);
    this.revealBlend = THREE.MathUtils.damp(this.revealBlend, 1 - k, 3.2, dt);
  }

  private followFraming(topFishY: number, sinkerY: number, focus: THREE.Vector3): number {
    // the frame keeps the water in view until the sinker itself is clear, so there
    // is always somewhere for the next fish to come from
    const lift = THREE.MathUtils.smoothstep(sinkerY, 0.02, 0.32);
    const bottom = THREE.MathUtils.lerp(-0.3, sinkerY - 0.1, lift);
    const top = Math.max(topFishY + 0.13, 0.24);
    let span = Math.max(0.58, top - bottom);
    let mid = (top + bottom) * 0.5;
    if (!this.portrait) {
      // landscape is short: follow the window where the next fish arrives instead of
      // pulling back far enough for the whole rig, keeping the line continuous
      const b = Math.max(bottom, top - 0.78, -0.2);
      span = Math.max(0.58, top - b);
      mid = (top + b) * 0.5;
    }
    focus.set(0, mid, 0);
    return span;
  }

  private computeShot(shot: Shot, outPos: THREE.Vector3, outLook: THREE.Vector3): void {
    let span = shot.span;
    if (shot.width) span = Math.max(span, shot.width / this.camera.aspect);
    this.frame(shot.focus, span, shot.dir, outPos, outLook);
  }

  private frame(
    focus: THREE.Vector3,
    span: number,
    dir: THREE.Vector3,
    outPos: THREE.Vector3,
    outLook: THREE.Vector3,
  ): void {
    const fovV = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = (span * 0.5) / Math.tan(fovV / 2) * 1.06;
    outLook.copy(focus);
    // landscape puts reel and rod tip on the left and the rising rig right of centre
    if (!this.portrait) outLook.x -= 0.19;
    outPos.copy(outLook).addScaledVector(dir, dist);
    if (!this.portrait) outPos.x += 0.07;
    // the hatch is a well: keep the camera high enough that the near coaming never
    // masks the bottom of the frame, so there is always water left to watch
    const bottomY = focus.y - span * 0.5;
    const need =
      (WORLD.deckY + 0.02 - bottomY) * (Math.abs(outPos.z) / WORLD.holeHalfZ) + bottomY + 0.01;
    if (outPos.y < need) outPos.y = need;
  }

  update(dt: number, topFishY: number, sinkerY: number): void {
    if (this.mode === 'reveal') {
      const focus = new THREE.Vector3();
      const span = this.followFraming(topFishY, sinkerY, focus);
      const aPos = new THREE.Vector3();
      const aLook = new THREE.Vector3();
      this.computeShot(SHOTS.hole, aPos, aLook);
      const bPos = new THREE.Vector3();
      const bLook = new THREE.Vector3();
      // looking down into the water while the fish is still below, level once it is up
      // landscape stays closer to level so the vertical world still reads
      const lv = Math.max(
        THREE.MathUtils.smoothstep(topFishY, 0.0, 0.4),
        this.portrait ? 0 : 0.55,
      );
      followDir.lerpVectors(FOLLOW_DOWN, FOLLOW_LEVEL, lv).normalize();
      this.frame(focus, span, followDir, bPos, bLook);
      this.targetPos.lerpVectors(aPos, bPos, this.revealBlend);
      this.targetLook.lerpVectors(aLook, bLook, this.revealBlend);
    } else {
      this.computeShot(SHOTS[this.shot], this.targetPos, this.targetLook);
    }
    this.pos.x = THREE.MathUtils.damp(this.pos.x, this.targetPos.x, this.lambda, dt);
    this.pos.y = THREE.MathUtils.damp(this.pos.y, this.targetPos.y, this.lambda, dt);
    this.pos.z = THREE.MathUtils.damp(this.pos.z, this.targetPos.z, this.lambda, dt);
    this.look.x = THREE.MathUtils.damp(this.look.x, this.targetLook.x, this.lambda, dt);
    this.look.y = THREE.MathUtils.damp(this.look.y, this.targetLook.y, this.lambda, dt);
    this.look.z = THREE.MathUtils.damp(this.look.z, this.targetLook.z, this.lambda, dt);
    this.apply();
  }

  private apply(): void {
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
