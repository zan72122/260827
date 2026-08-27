import * as THREE from 'three';
import { glassRoughnessMap, cutFaceRoughnessMap } from './textures.js';

// Glass palette: body color is a light tint (float glass reads nearly clear
// face-on), edge color is the same hue much deeper (short attenuation path
// through the pane thickness dominates at the edges).
export const GLASS_PALETTE = [
  { name: 'clear', body: 0xf2f7f4, edge: 0x9dbfae, css: 'rgba(190,225,205,0.85)', atten: 0xcfe8da },
  { name: 'aqua', body: 0xe9f4f6, edge: 0x6fa9b8, css: 'rgba(140,205,220,0.9)', atten: 0xbfe2e8 },
  { name: 'green', body: 0xecf5ec, edge: 0x5f9a6c, css: 'rgba(120,195,140,0.9)', atten: 0xbfe0c5 },
  { name: 'amber', body: 0xf8f2e6, edge: 0xc08b3e, css: 'rgba(235,175,90,0.9)', atten: 0xead9b5 },
  { name: 'rose', body: 0xf8eef0, edge: 0xc06a80, css: 'rgba(235,140,165,0.9)', atten: 0xecc9d1 }
];

let sharedRoughMap = null;
let sharedCutRoughMap = null;

export function makeGlassMaterialSet(paletteEntry, envMap) {
  if (!sharedRoughMap) sharedRoughMap = glassRoughnessMap();
  if (!sharedCutRoughMap) sharedCutRoughMap = cutFaceRoughnessMap();

  // Faces: high transparency, real transmission (background refracts slightly),
  // weak environment reflection, smudge/dust roughness variation.
  const body = new THREE.MeshPhysicalMaterial({
    color: paletteEntry.body,
    metalness: 0,
    roughness: 0.16,
    roughnessMap: sharedRoughMap,
    transmission: 1.0,
    thickness: 0.012,
    ior: 1.52,
    attenuationColor: new THREE.Color(paletteEntry.atten),
    attenuationDistance: 0.05,
    envMap,
    envMapIntensity: 0.55,
    specularIntensity: 0.7,
    side: THREE.FrontSide
  });

  // Factory (seamed) edge: same glass but the light path is long, so the tint
  // is much deeper; still glossy.
  const edgeCol = new THREE.Color(paletteEntry.edge).multiplyScalar(0.62);
  const factoryEdge = new THREE.MeshPhysicalMaterial({
    color: edgeCol,
    metalness: 0,
    roughness: 0.24,
    transmission: 0.3,
    thickness: 0.03,
    ior: 1.52,
    attenuationColor: new THREE.Color(paletteEntry.edge),
    attenuationDistance: 0.012,
    envMap,
    envMapIntensity: 0.3,
    side: THREE.FrontSide
  });

  // Fresh cut face: same deep tint but micro-rough (fine fracture texture),
  // catches light with a slightly frosty sheen.
  const cutFace = new THREE.MeshPhysicalMaterial({
    color: edgeCol.clone().multiplyScalar(1.15),
    metalness: 0,
    roughness: 0.5,
    roughnessMap: sharedCutRoughMap,
    transmission: 0.22,
    thickness: 0.03,
    ior: 1.52,
    attenuationColor: new THREE.Color(paletteEntry.edge),
    attenuationDistance: 0.012,
    envMap,
    envMapIntensity: 0.45,
    side: THREE.FrontSide
  });

  return [body, factoryEdge, cutFace];
}

export function disposeMaterialSet(set) {
  for (const m of set) m.dispose();
}
