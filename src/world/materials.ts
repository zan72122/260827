/** One shared material library. Built once, reused by every prop. */
import * as THREE from 'three';
import {
  makeBarkMaps,
  makeConcreteMaps,
  makeCutFaceMap,
  makeGroundMaps,
  makePaintMaps,
  makeRubberMaps,
  makeWearMaps,
} from '../core/textures';

export class Materials {
  readonly bark: THREE.MeshStandardMaterial;
  readonly branch: THREE.MeshStandardMaterial;
  readonly needle: THREE.MeshStandardMaterial;
  readonly cut: THREE.MeshStandardMaterial;
  readonly debris: THREE.MeshStandardMaterial;
  readonly net: THREE.MeshStandardMaterial;
  readonly knot: THREE.MeshStandardMaterial;
  readonly balerPaint: THREE.MeshStandardMaterial;
  readonly shakerPaint: THREE.MeshStandardMaterial;
  readonly wear: THREE.MeshStandardMaterial;
  readonly rubber: THREE.MeshStandardMaterial;
  readonly ground: THREE.MeshStandardMaterial;
  readonly wet: THREE.MeshStandardMaterial;
  readonly concrete: THREE.MeshStandardMaterial;
  readonly plaster: THREE.MeshStandardMaterial;
  readonly darkSteel: THREE.MeshStandardMaterial;
  readonly truckPaint: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshStandardMaterial;
  readonly cloth: THREE.MeshStandardMaterial;
  readonly skin: THREE.MeshStandardMaterial;
  readonly farFoliage: THREE.MeshStandardMaterial;
  readonly timber: THREE.MeshStandardMaterial;
  readonly lampGlow: THREE.MeshBasicMaterial;

  constructor(anisotropy: number) {
    const aniso = Math.min(8, anisotropy);
    const barkMaps = makeBarkMaps(512, aniso);
    this.bark = new THREE.MeshStandardMaterial({
      ...barkMaps,
      color: 0xb9ada0,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(1.05, 1.05),
    });
    this.branch = new THREE.MeshStandardMaterial({
      map: barkMaps.map,
      normalMap: barkMaps.normalMap,
      roughnessMap: barkMaps.roughnessMap,
      color: 0x9c8f80,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(0.5, 0.5),
    });
    this.needle = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0,
      side: THREE.DoubleSide,
      flatShading: false,
    });
    this.cut = new THREE.MeshStandardMaterial({
      map: makeCutFaceMap(256),
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.debris = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.net = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.knot = new THREE.MeshStandardMaterial({ color: 0xb64f18, roughness: 0.6, metalness: 0 });

    const balerMaps = makePaintMaps(0x4d7d64, 512, aniso);
    this.balerPaint = new THREE.MeshStandardMaterial({
      ...balerMaps,
      roughness: 1,
      metalness: 0.14,
      normalScale: new THREE.Vector2(0.5, 0.5),
    });
    const shakerMaps = makePaintMaps(0x936228, 512, aniso);
    this.shakerPaint = new THREE.MeshStandardMaterial({
      ...shakerMaps,
      roughness: 1,
      metalness: 0.14,
      normalScale: new THREE.Vector2(0.5, 0.5),
    });
    const wearMaps = makeWearMaps(256, aniso);
    this.wear = new THREE.MeshStandardMaterial({
      ...wearMaps,
      roughness: 1,
      metalness: 0.85,
    });
    const rubberMaps = makeRubberMaps(256, aniso);
    this.rubber = new THREE.MeshStandardMaterial({
      ...rubberMaps,
      roughness: 1,
      metalness: 0.02,
      normalScale: new THREE.Vector2(0.85, 0.85),
    });

    const groundMaps = makeGroundMaps(512, aniso);
    groundMaps.map.repeat.set(56, 56);
    groundMaps.normalMap.repeat.set(56, 56);
    groundMaps.roughnessMap.repeat.set(56, 56);
    this.ground = new THREE.MeshStandardMaterial({
      ...groundMaps,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(0.32, 0.32),
    });
    this.wet = new THREE.MeshStandardMaterial({
      color: 0x272a2b,
      roughness: 0.22,
      metalness: 0.05,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const conc = makeConcreteMaps(512, aniso);
    conc.map.repeat.set(60, 60);
    conc.normalMap.repeat.set(60, 60);
    conc.roughnessMap.repeat.set(60, 60);
    this.concrete = new THREE.MeshStandardMaterial({
      ...conc,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(0.09, 0.09),
    });

    this.plaster = new THREE.MeshStandardMaterial({
      map: conc.map,
      normalMap: conc.normalMap,
      roughnessMap: conc.roughnessMap,
      color: 0x8f9298,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(0.25, 0.25),
    });

    this.darkSteel = new THREE.MeshStandardMaterial({ color: 0x33383c, roughness: 0.62, metalness: 0.7 });
    this.truckPaint = new THREE.MeshStandardMaterial({ color: 0x53616b, roughness: 0.55, metalness: 0.35 });
    this.glass = new THREE.MeshStandardMaterial({
      color: 0x2b3338,
      roughness: 0.12,
      metalness: 0.1,
      transparent: true,
      opacity: 0.72,
    });
    this.cloth = new THREE.MeshStandardMaterial({ color: 0x2c3742, roughness: 0.92, metalness: 0 });
    this.skin = new THREE.MeshStandardMaterial({ color: 0x9a7358, roughness: 0.78, metalness: 0 });
    this.farFoliage = new THREE.MeshStandardMaterial({
      color: 0x243521,
      roughness: 0.97,
      metalness: 0,
      vertexColors: true,
    });
    this.timber = new THREE.MeshStandardMaterial({ color: 0x4d4130, roughness: 0.97, metalness: 0 });
    this.lampGlow = new THREE.MeshBasicMaterial({ color: 0xffe6bb });
  }
}
