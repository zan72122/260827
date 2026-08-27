// Camera rig with a fixed chain of shots:
// INTRO (beset supply ship -> distant harbour -> back), INPUT (locked high
// oblique: ship, drawable ice, harbour all visible; no rotate/zoom while the
// finger is down), FOLLOW (low 3/4 from astern), CLOSE (one-time side view
// of the bow riding onto the first ice), MID (deck+bow+lane), FINALE (high
// wide: the child's whole lane + the supply ship using it), DOCK (crane).
// All moves are continuous damped swings — no hard cuts, no left/right flip.

import * as THREE from 'three';
import { START, PORT_DOCK, clamp } from './const';

export type CamMode = 'intro' | 'input' | 'follow' | 'close' | 'mid' | 'finale' | 'dock';

export interface CamContext {
  shipPos: THREE.Vector3;
  shipHeading: number;
  aspect: number;
  time: number;
}

function catmull(p: THREE.Vector3[], t: number, out: THREE.Vector3): THREE.Vector3 {
  const n = p.length - 1;
  const f = clamp(t, 0, 0.9999) * n;
  const i = Math.floor(f);
  const u = f - i;
  const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[Math.min(n, i + 1)], p3 = p[Math.min(n, i + 2)];
  const u2 = u * u, u3 = u2 * u;
  out.set(0, 0, 0);
  out.addScaledVector(p1, 2).addScaledVector(p2.clone().sub(p0), u)
    .addScaledVector(p0.clone().multiplyScalar(2).sub(p1.clone().multiplyScalar(5)).add(p2.clone().multiplyScalar(4)).sub(p3), u2)
    .addScaledVector(p1.clone().multiplyScalar(3).sub(p0).sub(p2.clone().multiplyScalar(3)).add(p3), u3);
  return out.multiplyScalar(0.5);
}

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  mode: CamMode = 'intro';
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private introT = 0;
  introDuration = 8.5;
  private closeSide = 1;
  private tmpP = new THREE.Vector3();
  private tmpL = new THREE.Vector3();

  private introPosKeys: THREE.Vector3[] = [];
  private introLookKeys: THREE.Vector3[] = [];

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 1, 1400);
    this.buildIntro(aspect);
    this.pos.copy(this.introPosKeys[0]);
    this.look.copy(this.introLookKeys[0]);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  private buildIntro(aspect: number): void {
    const [ovP, ovL] = this.overview(aspect);
    this.introPosKeys = [
      new THREE.Vector3(START.x - 34, 10, START.z - 68),  // beside the waiting supply ship
      new THREE.Vector3(START.x - 18, 15, START.z - 40),
      new THREE.Vector3(START.x + 30, 85, START.z + 130), // rise over the ice toward...
      new THREE.Vector3(PORT_DOCK.x - 40, 34, PORT_DOCK.z - 95), // ...the harbour (the goal)
      ovP.clone(),
    ];
    this.introLookKeys = [
      new THREE.Vector3(START.x, 3, START.z - 30),
      new THREE.Vector3(START.x, 2, START.z),
      new THREE.Vector3(PORT_DOCK.x, 4, PORT_DOCK.z - 40),
      new THREE.Vector3(PORT_DOCK.x + 6, 4, PORT_DOCK.z + 6),
      ovL.clone(),
    ];
  }

  /** High oblique that frames start ship + ice + harbour, per orientation. */
  private overview(aspect: number): [THREE.Vector3, THREE.Vector3] {
    if (aspect < 1) {
      // portrait: lane runs from near (bottom) to far (top)
      return [
        new THREE.Vector3(START.x + 4, 225, START.z - 245),
        new THREE.Vector3(START.x + 8, -30, START.z + 215),
      ];
    }
    // landscape: swing the same shot ~40° so the lane reads left -> right
    return [
      new THREE.Vector3(START.x - 200, 150, START.z - 70),
      new THREE.Vector3(START.x + 120, -24, START.z + 205),
    ];
  }

  setMode(m: CamMode): void {
    if (m === 'intro') this.introT = 0;
    this.mode = m;
  }

  skipIntro(): void { this.introT = this.introDuration; }
  get introFinished(): boolean { return this.introT >= this.introDuration; }

  onResize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1 ? 62 : 50;
    this.camera.updateProjectionMatrix();
    this.buildIntro(aspect);
  }

  /** Pick which side the one-time close shot uses (side of first turn). */
  setCloseSide(side: number): void { this.closeSide = side >= 0 ? 1 : -1; }

  update(dt: number, ctx: CamContext): void {
    const { shipPos, shipHeading, aspect } = ctx;
    const fwd = new THREE.Vector3(Math.sin(shipHeading), 0, Math.cos(shipHeading));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);

    let targetP = this.tmpP;
    let targetL = this.tmpL;
    let lambda = 1.6;

    switch (this.mode) {
      case 'intro': {
        this.introT = Math.min(this.introT + dt, this.introDuration);
        const t = this.introT / this.introDuration;
        const e = t < 0.5 ? 2 * t * t : 1 - (1 - t) * (2 - 2 * t) * 0.5; // gentle in/out-ish
        catmull(this.introPosKeys, e, targetP);
        catmull(this.introLookKeys, e, targetL);
        lambda = 12; // follow the spline closely
        break;
      }
      case 'input': {
        const [p, l] = this.overview(aspect);
        targetP.copy(p); targetL.copy(l);
        lambda = 2.2;
        break;
      }
      case 'follow': {
        targetP.copy(shipPos)
          .addScaledVector(fwd, -(aspect < 1 ? 88 : 72))
          .addScaledVector(right, 10)
          .setY(shipPos.y + (aspect < 1 ? 34 : 26));
        targetL.copy(shipPos).addScaledVector(fwd, 30).setY(2.5);
        lambda = 1.4;
        break;
      }
      case 'close': {
        targetP.copy(shipPos)
          .addScaledVector(fwd, 30)
          .addScaledVector(right, this.closeSide * 60)
          .setY(16);
        targetL.copy(shipPos).addScaledVector(fwd, 12).setY(2);
        lambda = 1.1;
        break;
      }
      case 'mid': {
        targetP.copy(shipPos)
          .addScaledVector(fwd, -(aspect < 1 ? 62 : 52))
          .addScaledVector(right, 20)
          .setY(shipPos.y + (aspect < 1 ? 30 : 23));
        targetL.copy(shipPos).addScaledVector(fwd, 32).setY(1.5);
        lambda = 1.2;
        break;
      }
      case 'finale': {
        const [p, l] = this.overview(aspect);
        targetP.copy(p); targetL.copy(l);
        lambda = 0.9;
        break;
      }
      case 'dock': {
        if (aspect < 1) {
          targetP.set(PORT_DOCK.x - 30, 26, PORT_DOCK.z - 78);
        } else {
          targetP.set(PORT_DOCK.x - 66, 24, PORT_DOCK.z - 58);
        }
        targetL.set(PORT_DOCK.x + 2, 2, PORT_DOCK.z + 4);
        lambda = 0.9;
        break;
      }
    }

    const k = 1 - Math.exp(-lambda * dt);
    this.pos.lerp(targetP, k);
    this.look.lerp(targetL, k);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  /** Instantly place the camera at its current mode target (used on reset). */
  snap(ctx: CamContext): void {
    this.update(10, ctx);
  }
}
