import * as THREE from 'three';
import * as TX from './textures';

/** Shared material library — built once, reused by every segment. */
export const M = {
  beltRubber: null as unknown as THREE.MeshStandardMaterial,
  beltFrame: null as unknown as THREE.MeshStandardMaterial,
  galvanized: null as unknown as THREE.MeshStandardMaterial,
  steelDark: null as unknown as THREE.MeshStandardMaterial,
  roller: null as unknown as THREE.MeshStandardMaterial,
  concreteFloor: null as unknown as THREE.MeshStandardMaterial,
  concreteWall: null as unknown as THREE.MeshStandardMaterial,
  terminalFloor: null as unknown as THREE.MeshStandardMaterial,
  hazard: null as unknown as THREE.MeshStandardMaterial,
  rubberStrip: null as unknown as THREE.MeshStandardMaterial,
  apron: null as unknown as THREE.MeshStandardMaterial,
  fuselage: null as unknown as THREE.MeshStandardMaterial,
  machineShell: null as unknown as THREE.MeshStandardMaterial,
  yellowRail: null as unknown as THREE.MeshStandardMaterial,
  chevron: null as unknown as THREE.MeshBasicMaterial,
  otherBag: [] as THREE.MeshStandardMaterial[],
};

export function initMaterials(): void {
  M.beltRubber = new THREE.MeshStandardMaterial({
    map: TX.beltRubber(),
    roughness: 0.94,
    metalness: 0.0,
  });
  M.beltFrame = new THREE.MeshStandardMaterial({ color: 0x6a7076, roughness: 0.6, metalness: 0.55 });
  M.galvanized = new THREE.MeshStandardMaterial({
    map: TX.galvanized(),
    roughness: 0.55,
    metalness: 0.6,
  });
  M.steelDark = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.7, metalness: 0.4 });
  M.roller = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.42, metalness: 0.75 });
  M.concreteFloor = new THREE.MeshStandardMaterial({ map: TX.concrete(true), roughness: 0.95 });
  M.concreteWall = new THREE.MeshStandardMaterial({ map: TX.concrete(false), roughness: 0.92 });
  M.terminalFloor = new THREE.MeshStandardMaterial({
    map: TX.terminalFloor(),
    roughness: 0.25,
    metalness: 0.05,
  });
  M.hazard = new THREE.MeshStandardMaterial({ map: TX.hazard(), roughness: 0.8 });
  M.rubberStrip = new THREE.MeshStandardMaterial({
    color: 0x17181a,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  M.apron = new THREE.MeshStandardMaterial({ map: TX.apron(), roughness: 0.96 });
  M.fuselage = new THREE.MeshStandardMaterial({
    map: TX.fuselage(),
    roughness: 0.35,
    metalness: 0.25,
  });
  M.machineShell = new THREE.MeshStandardMaterial({ color: 0xd7d9db, roughness: 0.5, metalness: 0.1 });
  M.yellowRail = new THREE.MeshStandardMaterial({ color: 0xd9a91d, roughness: 0.6, metalness: 0.2 });
  M.chevron = new THREE.MeshBasicMaterial({ map: TX.chevronSign(), toneMapped: true });
  const bagColors = [0x8a3a2f, 0x2f3f6e, 0x4a4a4e, 0x6e5a2f, 0x54306e, 0x2f5e3a];
  M.otherBag = bagColors.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0 }),
  );
}
