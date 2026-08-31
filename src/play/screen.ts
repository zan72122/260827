import * as THREE from 'three';

export interface Viewport {
  width: number; // CSS px
  height: number; // CSS px
}

const tmp = new THREE.Vector3();

/** Project a world point to CSS pixels inside the canvas. */
export function toScreen(
  camera: THREE.PerspectiveCamera,
  world: THREE.Vector3,
  vp: Viewport,
  out = new THREE.Vector2(),
): THREE.Vector2 {
  tmp.copy(world).project(camera);
  return out.set(((tmp.x + 1) / 2) * vp.width, ((1 - tmp.y) / 2) * vp.height);
}

/** How many metres one CSS pixel covers at the depth of `world`. */
export function metresPerPixel(
  camera: THREE.PerspectiveCamera,
  world: THREE.Vector3,
  vp: Viewport,
): number {
  const dist = camera.position.distanceTo(world);
  return (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / vp.height;
}

/** Distance in CSS px from a point to a segment. */
export function distToSegment(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-6) return p.distanceTo(a);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/**
 * Point on a plane through `planePoint` facing the camera, under the given CSS
 * pixel.  This is the free-carry plane: it gives the child two axes of control
 * that always line up with what they see.
 */
export function pointerOnCameraPlane(
  camera: THREE.PerspectiveCamera,
  px: number,
  py: number,
  vp: Viewport,
  planePoint: THREE.Vector3,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const ndc = new THREE.Vector2((px / vp.width) * 2 - 1, 1 - (py / vp.height) * 2);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, planePoint);
  const hit = ray.ray.intersectPlane(plane, out);
  return hit ?? out.copy(planePoint);
}
