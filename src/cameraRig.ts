import * as THREE from 'three';
import { ROWS, TREE_HEIGHT } from './config';
import { radiusAbove, radiusBelow, rowY } from './paper/profile';

export type Framing = {
  orientation: 'portrait' | 'landscape';
  azimuth: number;
  elevation: number;
  distance: number;
  targetY: number;
  fov: number;
};

/**
 * Points on the outside of the fully opened tree, plus the foot of the jig.
 * The framing is solved against these rather than guessed from the height, so
 * the widest bough never runs off the side of a narrow phone.
 */
const HULL: THREE.Vector3[] = (() => {
  const pts: THREE.Vector3[] = [];
  const ring = (y: number, r: number) => {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
  };
  for (let j = 0; j < ROWS; j++) {
    ring(rowY(j), Math.max(radiusBelow(j), radiusAbove(j)));
  }
  ring(0, 0.032); // the wooden cup the spine stands in
  pts.push(new THREE.Vector3(0, TREE_HEIGHT + 0.004, 0));
  return pts;
})();

const probe = new THREE.PerspectiveCamera();

function project(f: Framing, aspect: number): { minX: number; maxX: number; minY: number; maxY: number } {
  const ce = Math.cos(f.elevation);
  probe.fov = f.fov;
  probe.aspect = aspect;
  probe.near = 0.02;
  probe.far = 6;
  probe.position.set(
    Math.sin(f.azimuth) * ce * f.distance,
    f.targetY + Math.sin(f.elevation) * f.distance,
    Math.cos(f.azimuth) * ce * f.distance
  );
  probe.lookAt(0, f.targetY, 0);
  probe.updateProjectionMatrix();
  probe.updateMatrixWorld();

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const v = new THREE.Vector3();
  for (const p of HULL) {
    v.copy(p).project(probe);
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  return { minX, maxX, minY, maxY };
}

type Recipe = {
  azimuth: number;
  elevation: number;
  fov: number;
  /** clear space at the sides, as a fraction of the frame */
  marginX: number;
  /** clear space above the tip */
  marginTop: number;
  /** at least this much clear bench under the tree, for the hand */
  minBottom: number;
};

function solve(r: Recipe, aspect: number, orientation: Framing['orientation']): Framing {
  const f: Framing = {
    orientation,
    azimuth: r.azimuth,
    elevation: r.elevation,
    distance: 0.7,
    targetY: 0.14,
    fov: r.fov,
  };

  // 1. back off until the whole tree fits inside the margins
  let lo = 0.25;
  let hi = 3.0;
  for (let i = 0; i < 26; i++) {
    f.distance = (lo + hi) / 2;
    const b = project(f, aspect);
    const usedX = Math.max(-b.minX, b.maxX) / (1 - r.marginX);
    const usedY = (b.maxY - b.minY) / (2 - 2 * r.marginTop - 2 * r.minBottom);
    if (Math.max(usedX, usedY) > 1) lo = f.distance;
    else hi = f.distance;
  }
  f.distance = hi;

  // 2. slide the rig vertically so the tip sits just under the top margin and
  //    everything left over becomes working space beneath the paper
  for (let i = 0; i < 12; i++) {
    const b = project(f, aspect);
    const wantTop = 1 - 2 * r.marginTop;
    const err = b.maxY - wantTop;
    if (Math.abs(err) < 0.002) break;
    // NDC 1.0 spans half the frame height at the target plane
    const halfWorld = f.distance * Math.tan((f.fov / 2) * (Math.PI / 180));
    f.targetY += err * halfWorld;
  }
  return f;
}

/**
 * Portrait and landscape are two different pictures, not one lens opened up.
 * Portrait stands close and near-frontal, sized by the 0.23 m opened width,
 * with the bench below the paper kept clear for the hand. Landscape steps back
 * into a raised three-quarter view where the still-shut leaves and the opened
 * cells can be read against each other.
 */
export function frameFor(width: number, height: number): Framing {
  const aspect = width / height;
  const landscape = width > height * 1.08;
  if (landscape) {
    return solve(
      {
        azimuth: THREE.MathUtils.degToRad(-44),
        elevation: THREE.MathUtils.degToRad(19),
        fov: 40,
        marginX: 0.06,
        marginTop: 0.07,
        minBottom: 0.13,
      },
      aspect,
      'landscape'
    );
  }
  return solve(
    {
      azimuth: THREE.MathUtils.degToRad(-19),
      elevation: THREE.MathUtils.degToRad(17),
      fov: 46,
      marginX: 0.065,
      marginTop: 0.14,
      minBottom: 0.24,
    },
    aspect,
    'portrait'
  );
}

/** The short establishing view the game opens on before settling to work. */
export function establishing(f: Framing): Framing {
  return {
    ...f,
    azimuth: f.azimuth - THREE.MathUtils.degToRad(26),
    elevation: f.elevation + THREE.MathUtils.degToRad(10),
    distance: f.distance * 1.45,
    targetY: f.targetY + 0.03,
  };
}

export function lerpFraming(a: Framing, b: Framing, t: number): Framing {
  const m = (x: number, y: number) => x + (y - x) * t;
  return {
    orientation: b.orientation,
    azimuth: m(a.azimuth, b.azimuth),
    elevation: m(a.elevation, b.elevation),
    distance: m(a.distance, b.distance),
    targetY: m(a.targetY, b.targetY),
    fov: m(a.fov, b.fov),
  };
}

export function applyFraming(camera: THREE.PerspectiveCamera, f: Framing) {
  const ce = Math.cos(f.elevation);
  camera.position.set(
    Math.sin(f.azimuth) * ce * f.distance,
    f.targetY + Math.sin(f.elevation) * f.distance,
    Math.cos(f.azimuth) * ce * f.distance
  );
  camera.fov = f.fov;
  camera.lookAt(0, f.targetY, 0);
  camera.updateProjectionMatrix();
}
