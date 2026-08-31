import * as THREE from 'three'
import { paperFiberMaps, woodMaps } from './textures'

export interface MaterialSet {
  paper: THREE.MeshStandardMaterial
  board: THREE.MeshStandardMaterial
  tab: THREE.MeshStandardMaterial
  wood: THREE.MeshStandardMaterial
  woodWorn: THREE.MeshStandardMaterial
  metal: THREE.MeshStandardMaterial
  wall: THREE.MeshStandardMaterial
  shelf: THREE.MeshStandardMaterial
  frame: THREE.MeshStandardMaterial
  sky: THREE.MeshBasicMaterial
  dispose(): void
}

/**
 * 薄紙の逆光透過。紙そのものが光るのでも、ガラスのように透けるのでもなく、
 * 「裏から当たった光がにじんで表に出る」量だけを足す。
 */
function addPaperTranslucency(mat: THREE.MeshStandardMaterial, amount: number): void {
  const uniforms = { uTranslucency: { value: amount } }
  mat.userData.translucency = uniforms.uTranslucency
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTranslucency = uniforms.uTranslucency
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTranslucency;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
#if ( NUM_DIR_LIGHTS > 0 )
  {
    vec3 tL = directionalLights[ 0 ].direction;
    vec3 tN = normalize( normal );
    float back = max( 0.0, -dot( tN, tL ) );
    vec3 tV = normalize( vViewPosition );
    float thru = max( 0.0, -dot( tV, tL ) );
    float amt = pow( back, 1.6 ) * ( 0.35 + 0.65 * thru );
    reflectedLight.indirectDiffuse += directionalLights[ 0 ].color * diffuseColor.rgb * amt * uTranslucency;
  }
#endif`,
      )
  }
  mat.customProgramCacheKey = () => 'paper-translucency'
}

export function createMaterials(seed: number): MaterialSet {
  const fiber = paperFiberMaps(seed)
  const wood = woodMaps(seed + 11)

  const paper = new THREE.MeshStandardMaterial({
    color: 0x37674f,
    roughness: 0.94,
    metalness: 0,
    side: THREE.DoubleSide,
    roughnessMap: fiber.rough,
    normalMap: fiber.normal,
    normalScale: new THREE.Vector2(0.62, 0.62),
    vertexColors: true,
    flatShading: false,
  })
  addPaperTranslucency(paper, 0.55)

  const board = new THREE.MeshStandardMaterial({
    color: 0x2a5340,
    roughness: 0.87,
    metalness: 0,
    side: THREE.DoubleSide,
    roughnessMap: fiber.rough,
    normalMap: fiber.normal,
    normalScale: new THREE.Vector2(0.45, 0.45),
  })
  addPaperTranslucency(board, 0.1)

  // つかみ代は「紙本体と見分けられる」ことが要件。素材も色も変える（未晒クラフト）。
  const tab = new THREE.MeshStandardMaterial({
    color: 0xb98a51,
    roughness: 0.8,
    metalness: 0,
    side: THREE.DoubleSide,
    roughnessMap: fiber.rough,
    normalMap: fiber.normal,
    normalScale: new THREE.Vector2(0.5, 0.5),
  })

  const woodMat = new THREE.MeshStandardMaterial({
    map: wood.color,
    roughnessMap: wood.rough,
    roughness: 0.72,
    metalness: 0,
    color: 0xffffff,
  })
  // 使い込んだ縁: 同じ木でも当たる場所だけ滑らかで色が抜ける
  const woodWorn = new THREE.MeshStandardMaterial({
    map: wood.color,
    roughnessMap: wood.rough,
    roughness: 0.42,
    metalness: 0,
    color: 0xc9ae8c,
  })

  // 木の台とは別の反射と粗さ。環境が控えめな室内なので、真っ黒に沈まない程度の金属にする。
  const metal = new THREE.MeshStandardMaterial({
    color: 0xc2c8cf,
    roughness: 0.38,
    metalness: 0.55,
  })

  const wall = new THREE.MeshStandardMaterial({ color: 0xbfb6a6, roughness: 0.95, metalness: 0 })
  const shelf = new THREE.MeshStandardMaterial({ color: 0x8c7355, roughness: 0.78, metalness: 0 })
  const frame = new THREE.MeshStandardMaterial({ color: 0xe6e2d8, roughness: 0.6, metalness: 0 })
  const sky = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })

  return {
    paper,
    board,
    tab,
    wood: woodMat,
    woodWorn,
    metal,
    wall,
    shelf,
    frame,
    sky,
    dispose() {
      for (const m of [paper, board, tab, woodMat, woodWorn, metal, wall, shelf, frame, sky]) m.dispose()
      fiber.rough.dispose()
      fiber.normal.dispose()
      wood.color.dispose()
      wood.rough.dispose()
    },
  }
}
