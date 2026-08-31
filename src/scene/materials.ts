import * as THREE from 'three';
import { makeLindenMaps, makeBenchMaps, makeSteelMaps, makeWallMap } from './textures';

/**
 * Trunk and shavings are the SAME wood. What differs is thickness: a 1 mm
 * shaving passes light, a solid cone does not. One extra term in the standard
 * material gives that, so the two read as one material at two thicknesses
 * rather than as two different substances.
 */
const translucent: THREE.MeshStandardMaterial[] = [];
const _backDir = new THREE.Vector3();

function addTranslucency(mat: THREE.MeshStandardMaterial, amount: number, tint: THREE.ColorRepresentation) {
  mat.userData.backLight = amount;
  mat.userData.backColor = new THREE.Color(tint);
  mat.userData.backDir = new THREE.Vector3(0, 0, 1);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBackLight = { value: amount };
    shader.uniforms.uBackColor = { value: mat.userData.backColor };
    shader.uniforms.uBackDir = { value: mat.userData.backDir };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uBackLight;\nuniform vec3 uBackColor;\nuniform vec3 uBackDir;\nvoid main() {')
      .replace('#include <opaque_fragment>', `
        float _wrap = max(0.0, -dot(normalize(normal), uBackDir));
        outgoingLight += uBackColor * uBackLight * pow(_wrap, 1.7) * diffuseColor.rgb;
      #include <opaque_fragment>`);
    mat.userData.shader = shader;
  };
  translucent.push(mat);
}

/** Call once per frame: the back-light direction lives in view space. */
export function updateTranslucency(lightWorldDir: THREE.Vector3, camera: THREE.Camera) {
  for (const m of translucent) {
    _backDir.copy(lightWorldDir).transformDirection(camera.matrixWorldInverse).normalize();
    (m.userData.backDir as THREE.Vector3).copy(_backDir);
  }
}

export interface Materials {
  blank: THREE.MeshStandardMaterial;
  shaving: THREE.MeshStandardMaterial;
  bench: THREE.MeshStandardMaterial;
  jigWood: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  blade: THREE.MeshStandardMaterial;
  handle: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  shelf: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
}

export function makeMaterials(texSize: number): Materials {
  const linden = makeLindenMaps(7, texSize);
  const linden2 = makeLindenMaps(19, texSize);
  const bench = makeBenchMaps(21, texSize);
  const steelM = makeSteelMaps(33, Math.min(512, texSize));
  const wallM = makeWallMap(51, 512);

  const blank = new THREE.MeshStandardMaterial({
    map: linden.map, roughnessMap: linden.roughnessMap, bumpMap: linden.bumpMap,
    bumpScale: 0.05, roughness: 1.0, metalness: 0.0, color: 0xffffff,
  });
  addTranslucency(blank, 0.05, 0xd9b98c);

  const shaving = new THREE.MeshStandardMaterial({
    map: linden.map, roughnessMap: linden.roughnessMap, bumpMap: linden.bumpMap,
    bumpScale: 0.02, roughness: 0.95, metalness: 0.0, color: 0xfff4e2,
    side: THREE.DoubleSide,
  });
  addTranslucency(shaving, 0.85, 0xf2c98d);

  const benchMat = new THREE.MeshStandardMaterial({
    map: bench.map, roughnessMap: bench.roughnessMap, bumpMap: bench.bumpMap,
    bumpScale: 0.09, roughness: 1.0, metalness: 0.0, color: 0xd0b394,
  });

  const jigWood = new THREE.MeshStandardMaterial({
    map: bench.map, roughnessMap: bench.roughnessMap, bumpMap: bench.bumpMap,
    bumpScale: 0.06, roughness: 0.95, metalness: 0.0, color: 0xd8b98e,
  });

  const steel = new THREE.MeshStandardMaterial({
    color: 0x767b81, metalness: 1.0, roughness: 0.52,
    roughnessMap: steelM.roughnessMap, bumpMap: steelM.bumpMap, bumpScale: 0.012,
    envMapIntensity: 1.0,
  });
  const blade = new THREE.MeshStandardMaterial({
    color: 0xccd2d8, metalness: 1.0, roughness: 0.26,
    roughnessMap: steelM.roughnessMap, bumpMap: steelM.bumpMap, bumpScale: 0.008,
    envMapIntensity: 2.0,
  });
  const handle = new THREE.MeshStandardMaterial({
    map: linden2.map, roughnessMap: linden2.roughnessMap, bumpMap: linden2.bumpMap,
    bumpScale: 0.04, roughness: 0.72, metalness: 0.0, color: 0xb98a5c,
  });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08d4d, metalness: 1.0, roughness: 0.45 });
  // blacksmith's ironwork on the jig: dark, matte, not mirror-bright
  const iron = new THREE.MeshStandardMaterial({
    color: 0x3f4348, metalness: 1.0, roughness: 0.66,
    roughnessMap: steelM.roughnessMap, bumpMap: steelM.bumpMap, bumpScale: 0.02,
    envMapIntensity: 0.55,
  });
  const wall = new THREE.MeshStandardMaterial({ map: wallM, roughness: 0.96, metalness: 0, color: 0xa79c8c });
  const shelf = new THREE.MeshStandardMaterial({
    map: bench.map, roughnessMap: bench.roughnessMap, roughness: 1.0, metalness: 0, color: 0x6d5940,
  });
  const floor = new THREE.MeshStandardMaterial({
    map: bench.map, roughnessMap: bench.roughnessMap, roughness: 1.0, metalness: 0, color: 0x6e5942,
  });

  for (const t of [linden, linden2, bench]) {
    for (const k of ['map', 'roughnessMap', 'bumpMap'] as const) {
      (t[k] as THREE.Texture).repeat.set(1, 1);
    }
  }
  return { blank, shaving, bench: benchMat, jigWood, steel, blade, handle, brass, iron, wall, shelf, floor };
}
