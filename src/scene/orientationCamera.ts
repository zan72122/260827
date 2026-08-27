/**
 * orientationCamera.ts — OrientationSpecificCamera + LandmarkTracker.
 *
 * The camera flies from a three-quarter view of the whole slide down to the front
 * lens of the objective, and the LandmarkTracker guarantees that the hair follicle
 * lands on the same screen anchor the entire way. The anchor sits ABOVE the middle
 * of the screen so a child's hand rests below the thing they are looking at.
 */

import * as THREE from 'three';
import { HERO_SLIDE } from '../micro/specimen';
import { SLIDE_TOP_Y } from './physicalSlideScene';

export interface Anchor {
  /** 0..1 across the screen. */
  x: number;
  /** 0..1 down the screen. 0.5 is dead centre. */
  y: number;
}

interface PathKey {
  p: number;
  azimuthDeg: number;
  elevationDeg: number;
}

/**
 * Portrait frames the slide along the long screen axis; landscape lays it across.
 * Both end looking straight down the optical axis at the marked spot.
 */
function pathKeys(portrait: boolean): PathKey[] {
  const az0 = portrait ? -76 : -26;
  const el0 = portrait ? 40 : 33;
  return [
    { p: 0.0, azimuthDeg: az0, elevationDeg: el0 },
    { p: 0.08, azimuthDeg: az0 * 0.62, elevationDeg: el0 + 17 },
    { p: 0.15, azimuthDeg: az0 * 0.28, elevationDeg: 74 },
    { p: 0.22, azimuthDeg: az0 * 0.08, elevationDeg: 86 },
    { p: 0.28, azimuthDeg: 0, elevationDeg: 90 },
    { p: 0.34, azimuthDeg: 0, elevationDeg: 90 },
  ];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class OrientationCamera {
  readonly camera: THREE.PerspectiveCamera;
  anchor: Anchor = { x: 0.5, y: 0.42 };
  portrait = true;
  azimuthRad = 0;
  private width = 1;
  private height = 1;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.06, 900);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.portrait = height >= width;
    this.camera.aspect = width / height;
    // A tall screen needs a slightly wider lens to hold the slide; a wide one does not.
    this.camera.fov = this.portrait ? 43 : 37;
    // Keep the subject clear of the thumb without shoving it into the status bar.
    this.anchor = this.portrait ? { x: 0.5, y: 0.415 } : { x: 0.5, y: 0.455 };
    this.camera.updateProjectionMatrix();
  }

  /** World position of the hero anchor, given the stage's current offset. */
  heroWorld(slideOffset: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(
      slideOffset.x + HERO_SLIDE.x,
      slideOffset.y + SLIDE_TOP_Y,
      slideOffset.z - HERO_SLIDE.y,
    );
  }

  /**
   * Places the camera for this progress and locks the landmark to the anchor.
   * The off-axis projection is what does the locking: the camera looks straight at
   * the follicle, then the frustum is shifted so it appears where we want it.
   */
  /** Half-width of the frustum at unit distance, from the current fov and aspect. */
  private tanHalfH(): number {
    return Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5) * this.camera.aspect;
  }

  /**
   * Distance that makes the 3D view cover exactly `fieldMM` across the screen — the
   * same number the microscope compositor uses. Deriving it rather than hand-tuning
   * it is what makes the crossing into the circular field seamless instead of a cut.
   */
  distanceFor(fieldMM: number, elevationRad: number): number {
    const d = fieldMM * 0.5 / Math.max(this.tanHalfH(), 1e-4);
    // An oblique view sees the slide foreshortened, so it has to stand further back.
    return d / Math.max(Math.sin(elevationRad), 0.34);
  }

  update(progress: number, target: THREE.Vector3, fieldMM: number): void {
    const keys = pathKeys(this.portrait);
    let a = keys[0];
    let b = keys[keys.length - 1];
    let t = 1;
    if (progress <= keys[0].p) {
      a = b = keys[0];
      t = 0;
    } else {
      for (let i = 0; i < keys.length - 1; i++) {
        if (progress >= keys[i].p && progress <= keys[i + 1].p) {
          a = keys[i];
          b = keys[i + 1];
          t = (progress - a.p) / (b.p - a.p);
          t = t * t * (3 - 2 * t);
          break;
        }
      }
      if (progress >= keys[keys.length - 1].p) {
        a = b = keys[keys.length - 1];
        t = 0;
      }
    }

    const az = THREE.MathUtils.degToRad(lerp(a.azimuthDeg, b.azimuthDeg, t));
    const el = THREE.MathUtils.degToRad(lerp(a.elevationDeg, b.elevationDeg, t));
    const distance = this.distanceFor(fieldMM, el);
    this.azimuthRad = az;

    const ce = Math.cos(el);
    this.camera.position.set(
      target.x + Math.sin(az) * ce * distance,
      target.y + Math.sin(el) * distance,
      target.z + Math.cos(az) * ce * distance,
    );
    // Screen "up" is chosen so that depth into the dermis runs DOWN the screen,
    // matching the microscope view exactly.
    if (el > THREE.MathUtils.degToRad(84)) {
      // Looking almost straight down, "up" needs a horizontal reference or the view
      // rolls about its own axis and the landmark's orientation would swim.
      this.camera.up.set(-Math.sin(az), 0, -Math.cos(az));
    } else {
      this.camera.up.set(0, 1, 0);
    }
    this.camera.lookAt(target);

    this.applyAnchorOffset();
  }

  /** Shifts the frustum so the point the camera looks at lands on the anchor. */
  private applyAnchorOffset(): void {
    const dx = (0.5 - this.anchor.x) * this.width;
    const dy = (0.5 - this.anchor.y) * this.height;
    this.camera.setViewOffset(this.width, this.height, dx, dy, this.width, this.height);
    this.camera.updateProjectionMatrix();
  }

  /** Where a world point actually lands on screen, 0..1 from the top left. */
  project(world: THREE.Vector3): { x: number; y: number } {
    const v = world.clone().project(this.camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }
}

/**
 * LandmarkTracker keeps one truth for both halves of the game: in the 3D scene the
 * camera is aimed at the follicle, and in the microscope view the field is centred on
 * exactly the same specimen coordinate. Because both use the same anchor, the
 * hand-over at the edge of the objective does not shift the subject by a pixel.
 */
export class LandmarkTracker {
  private readonly scratch = new THREE.Vector3();

  worldTarget(camera: OrientationCamera, slideOffset: THREE.Vector3): THREE.Vector3 {
    return camera.heroWorld(slideOffset, this.scratch);
  }

  /** Screen position of the landmark in the 3D pass, for verification and debug. */
  screenPosition(camera: OrientationCamera, slideOffset: THREE.Vector3): { x: number; y: number } {
    return camera.project(camera.heroWorld(slideOffset, new THREE.Vector3()));
  }
}
