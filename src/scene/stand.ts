import * as THREE from 'three';
import { TREE_HEIGHT } from '../config';
import { repeated, type Textures } from '../textures';

export const HOOK_Y = TREE_HEIGHT + 0.055;
const POST_X = 0.235;
const POST_Z = -0.135;

/**
 * A plain bench jig: a turned wooden cup that locates the foot of the spine,
 * a steel post behind the work, an arm over the top and a thread down to the
 * apex. Both support points are visible. It is this game's working aid, not a
 * piece of traditional manufacturing equipment.
 */
export function buildStand(tex: Textures): THREE.Group {
  const g = new THREE.Group();

  const wood = new THREE.MeshStandardMaterial({
    color: 0x8a6a45,
    roughness: 0.66,
    metalness: 0,
    map: repeated(tex.wood, 2, 2),
    roughnessMap: repeated(tex.woodRough, 2, 2),
    normalMap: repeated(tex.woodNormal, 2, 2),
    normalScale: new THREE.Vector2(0.4, 0.4),
  });
  const steel = new THREE.MeshStandardMaterial({
    color: 0x9aa0a6,
    roughness: 0.36,
    metalness: 0.9,
  });
  const cordMat = new THREE.MeshStandardMaterial({ color: 0xcfc6b2, roughness: 0.95 });

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  // cup that the foot of the tree sits in
  add(new THREE.CylinderGeometry(0.026, 0.03, 0.009, 28), wood, 0, 0.0045, 0);
  const ring = add(new THREE.TorusGeometry(0.0215, 0.0025, 8, 28), wood, 0, 0.0092, 0);
  ring.rotation.x = Math.PI / 2;

  // post and its foot, set to one side and well clear of the opened tree
  add(new THREE.BoxGeometry(0.10, 0.016, 0.085), wood, POST_X, 0.008, POST_Z);
  add(new THREE.CylinderGeometry(0.0055, 0.0055, HOOK_Y, 14), steel, POST_X, HOOK_Y / 2, POST_Z);

  // arm reaching from the post over to the axis, above the tree
  const from = new THREE.Vector3(POST_X, HOOK_Y, POST_Z);
  const to = new THREE.Vector3(0, HOOK_Y, 0);
  const dir = to.clone().sub(from);
  const arm = add(
    new THREE.CylinderGeometry(0.0032, 0.0032, dir.length(), 10),
    steel,
    (from.x + to.x) / 2,
    HOOK_Y,
    (from.z + to.z) / 2
  );
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());

  const hook = add(new THREE.TorusGeometry(0.006, 0.0012, 6, 16, Math.PI * 1.4), steel, 0, HOOK_Y - 0.006, 0);
  hook.rotation.y = Math.PI / 2;
  hook.rotation.z = Math.PI * 0.25;

  // thread down to the apex
  const cordLen = HOOK_Y - 0.012 - TREE_HEIGHT;
  add(
    new THREE.CylinderGeometry(0.00045, 0.00045, cordLen, 5),
    cordMat,
    0,
    TREE_HEIGHT + cordLen / 2,
    0
  );

  return g;
}
