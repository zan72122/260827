import type * as THREE from 'three';

/** What the game is asking the child to do right now, in world space.
 *  The ghost hand and the automated play-through both read this. */
export type Hint =
  | { kind: 'tap'; at: THREE.Vector3 }
  | { kind: 'swipe'; at: THREE.Vector3; dir: 'up' | 'down' }
  | { kind: 'drag'; from: THREE.Vector3; to: THREE.Vector3 }
  | { kind: 'arc'; from: THREE.Vector3; to: THREE.Vector3 }
  | { kind: 'trace'; from: THREE.Vector3; to: THREE.Vector3 }
  | null;
