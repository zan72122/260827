import * as THREE from 'three'
import { frostTexture, paintTexture, snowTexture, woodTexture } from './textures'

/**
 * A small, deliberately contrasting material set: warm oiled wood, cold painted
 * metal, matte ceramic, chipped enamel on the miniatures, and one snow surface.
 * Nothing here is white-on-white, which is what keeps the workshop from
 * collapsing into a pale blue fantasy.
 */

export interface MatKit {
  benchWood: THREE.MeshStandardMaterial
  darkWood: THREE.MeshStandardMaterial
  brass: THREE.MeshStandardMaterial
  steel: THREE.MeshStandardMaterial
  paintedMetal: THREE.MeshStandardMaterial
  ceramic: THREE.MeshStandardMaterial
  rubber: THREE.MeshStandardMaterial
  snow: THREE.MeshStandardMaterial
  frost: THREE.MeshBasicMaterial
  wall: THREE.MeshStandardMaterial
  dispose(): void
}

export function createMaterials(): MatKit {
  const wood = woodTexture()
  const paint = paintTexture()
  const snowTex = snowTexture()
  const frost = frostTexture()

  const benchWood = new THREE.MeshStandardMaterial({
    map: wood,
    color: 0xa8814f,
    roughness: 0.62,
    metalness: 0.04,
  })
  benchWood.map!.repeat.set(2, 1.2)

  const darkWood = new THREE.MeshStandardMaterial({
    map: wood,
    color: 0x8a6039,
    roughness: 0.55,
    metalness: 0.05,
  })

  const brass = new THREE.MeshStandardMaterial({
    map: paint,
    color: 0xcb9c4c,
    roughness: 0.33,
    metalness: 0.86,
  })

  const steel = new THREE.MeshStandardMaterial({
    color: 0x8b8f95,
    roughness: 0.42,
    metalness: 0.75,
  })

  const paintedMetal = new THREE.MeshStandardMaterial({
    map: paint,
    color: 0x6c7a86,
    roughness: 0.52,
    metalness: 0.28,
  })

  const ceramic = new THREE.MeshStandardMaterial({
    color: 0xdcd3c4,
    roughness: 0.38,
    metalness: 0.02,
  })

  const rubber = new THREE.MeshStandardMaterial({
    color: 0x24262a,
    roughness: 0.92,
    metalness: 0.0,
  })

  const snow = new THREE.MeshStandardMaterial({
    map: snowTex,
    color: 0xeef3f8,
    roughness: 0.86,
    metalness: 0.0,
  })
  // Fine enough to hold up when the camera is standing on it.
  snow.map!.repeat.set(9, 9)

  const frostMat = new THREE.MeshBasicMaterial({ map: frost, color: 0xcfe0ea })

  const wall = new THREE.MeshStandardMaterial({ color: 0x8b7c6a, roughness: 0.94 })

  const kit: MatKit = {
    benchWood, darkWood, brass, steel, paintedMetal, ceramic, rubber,
    snow, frost: frostMat, wall,
    dispose() {
      for (const m of [
        benchWood, darkWood, brass, steel, paintedMetal, ceramic, rubber, snow, frostMat, wall,
      ]) m.dispose()
    },
  }
  return kit
}

/** Enamel used on the miniatures — one shared texture, per-piece colour. */
export function enamel(color: number, rough = 0.55): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: paintTexture(),
    color,
    roughness: rough,
    metalness: 0.05,
  })
}
