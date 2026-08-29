import * as THREE from 'three';

/**
 * OrientationState — the five ways a slice can face inside the ring, and the
 * only thing a tap changes. They are not cosmetic: each one puts the slab at a
 * different angle to the knife, so the red shape that appears on the cut face
 * is a direct consequence of which one the child chose.
 *
 *   faceOut  cut face turned outward, tip up      -> a narrow tall stripe
 *   faceIn   cut face turned inward, tip down     -> a narrow stripe, tapering down
 *   tipCW    turned clockwise round the ring   -> the whole berry, leaning out
 *   tipCCW   turned counterclockwise            -> the whole berry, mirrored and
 *                                                 leaning in
 *
 * The two turned states put the flat of the slice along the ring, so the knife
 * runs nearly along it and the section is the berry's own outline rather than a
 * stripe through it. Turning one way or the other mirrors that outline and
 * leans it the opposite way, which is what a child sees change.
 *   slanted  half turned                          -> a wider oblique band
 */
export type OrientationId = 'faceOut' | 'faceIn' | 'tipCW' | 'tipCCW' | 'slanted';

export const ORIENTATIONS: readonly OrientationId[] = [
  'faceOut',
  'faceIn',
  'tipCW',
  'tipCCW',
  'slanted',
];

export const ORIENTATION_LABEL: Record<OrientationId, string> = {
  faceOut: 'きりくち そと',
  faceIn: 'きりくち うち',
  tipCW: 'さき みぎまわり',
  tipCCW: 'さき ひだりまわり',
  slanted: 'すこし ななめ',
};

export const nextOrientation = (o: OrientationId): OrientationId =>
  ORIENTATIONS[(ORIENTATIONS.indexOf(o) + 1) % ORIENTATIONS.length];

const UP = new THREE.Vector3(0, 1, 0);

/** Build a rotation from a wanted local +Z (slab normal) and local +Y (hull). */
function frame(yAxis: THREE.Vector3, zAxis: THREE.Vector3): THREE.Quaternion {
  const z = zAxis.clone().normalize();
  const y = yAxis.clone().addScaledVector(z, -yAxis.dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(x, y, z),
  );
}

const axisAngle = (axis: THREE.Vector3, deg: number): THREE.Quaternion =>
  new THREE.Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180);

/**
 * Rotation for a slice in the well at `slotAngle`. Tilt is a small per-berry
 * wobble; it settles toward zero once the cream supports the berry.
 */
export function orientationQuaternion(
  id: OrientationId,
  slotAngle: number,
  wobble = 0,
): THREE.Quaternion {
  const radial = new THREE.Vector3(Math.cos(slotAngle), 0, Math.sin(slotAngle));
  const tangent = new THREE.Vector3(-Math.sin(slotAngle), 0, Math.cos(slotAngle));
  const down = UP.clone().negate();
  let q: THREE.Quaternion;

  switch (id) {
    case 'faceOut':
      // Hull resting on the sponge, tip up, flat face looking out of the cake.
      q = frame(down, radial);
      break;
    case 'faceIn':
      // Flipped end for end: flat face looking at the middle, tip down.
      q = frame(UP, radial.clone().negate());
      break;
    case 'tipCW':
      // Turned to face along the ring, then leaned so the tip points onward.
      // The lean is small on purpose: the knife then runs nearly along the flat
      // of the slice, and what appears on the cut face is the whole berry.
      q = axisAngle(radial, 6)
        .multiply(frame(down, tangent))
        .multiply(axisAngle(new THREE.Vector3(0, 0, 1), 34));
      break;
    case 'tipCCW':
      // Mirror of tipCW: the slice is turned the other way round the ring, so
      // its silhouette arrives on the cut face mirrored and leaning the other
      // way. Same roll sign as tipCW because the frame itself is flipped.
      q = axisAngle(radial, -6)
        .multiply(frame(down, tangent.clone().negate()))
        .multiply(axisAngle(new THREE.Vector3(0, 0, 1), 34));
      break;
    case 'slanted':
    default:
      q = frame(down, radial.clone().add(tangent).normalize()).multiply(
        axisAngle(new THREE.Vector3(1, 0, 0), 8),
      );
      break;
  }

  if (wobble !== 0) {
    q = axisAngle(tangent, wobble * 7).multiply(q);
  }
  return q;
}
