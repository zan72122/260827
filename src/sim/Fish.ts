import * as THREE from 'three'
import { fishSkin } from '../scene/Textures'
import { applyUnderwater } from '../scene/Water'

/**
 * A small baitfish, roughly 9 cm. Local +Z is forward. The body carries a
 * per-instance swim phase so nothing in the school beats in unison.
 */
export function createFishGeometry(detail: 'low' | 'high' = 'low') {
  const stations = detail === 'high' ? 22 : 13
  const ring = detail === 'high' ? 12 : 8
  const L = 0.09
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = []

  const profile = (t: number) => {
    // t: 0 = tail root, 1 = snout
    // a 9 cm baitfish: about 23 mm deep and 12 mm across at the shoulder
    const body = Math.sin(Math.pow(t, 0.72) * Math.PI * 0.98)
    const w = 0.0050 * (0.20 + body * 1.0)
    const h = 0.0094 * (0.24 + body * 1.0)
    return [w, h]
  }
  for (let s = 0; s < stations; s++) {
    const t = s / (stations - 1)
    const z = (t - 0.42) * L
    const [w, h] = profile(t)
    for (let r = 0; r <= ring; r++) {
      const a = (r / ring) * Math.PI * 2
      const x = Math.sin(a) * w
      const y = Math.cos(a) * h - (1 - t) * 0.0008
      pos.push(x, y, z)
      nor.push(x, y, 0)
      uv.push(t, (1 - Math.cos(a)) * 0.5)
    }
  }
  for (let s = 0; s < stations - 1; s++) {
    for (let r = 0; r < ring; r++) {
      const a = s * (ring + 1) + r, b = a + ring + 1
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  // caudal fin: a forked blade, thin enough to be translucent at the edge
  const base = pos.length / 3
  const tz = -0.42 * L
  const fin = [
    [0, 0.001, tz], [0, 0.0135, tz - 0.023], [0, 0.004, tz - 0.012],
    [0, -0.001, tz], [0, -0.0135, tz - 0.023], [0, -0.004, tz - 0.012],
  ]
  for (const [x, y, z] of fin) { pos.push(x, y, z); nor.push(0, 0, 1); uv.push(0.02, 0.5) }
  idx.push(base, base + 1, base + 2, base + 3, base + 5, base + 4)
  // dorsal and anal fins
  const b2 = pos.length / 3
  pos.push(0, 0.0085, 0.010, 0, 0.017, -0.001, 0, 0.008, -0.013)
  pos.push(0, -0.0075, -0.004, 0, -0.014, -0.013, 0, -0.006, -0.018)
  for (let i = 0; i < 6; i++) { nor.push(0, 0, 1); uv.push(0.5, i < 3 ? 0.04 : 0.95) }
  idx.push(b2, b2 + 1, b2 + 2, b2 + 3, b2 + 5, b2 + 4)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

const SWIM_VERT = /* glsl */ `
  attribute float aPhase;
  attribute float aSpeed;
  uniform float uTime;
  uniform float uSway;
`
const SWIM_BODY = /* glsl */ `
  float tailT = clamp((0.35 - transformed.z / 0.09), 0.0, 1.4);
  float wave = sin(uTime * (5.4 * aSpeed) + aPhase - transformed.z * 46.0);
  transformed.x += wave * tailT * tailT * 0.0070 * uSway;
  objectNormal.x += wave * tailT * 0.5 * uSway;
`

export function createFishMaterial() {
  const skin = fishSkin()
  const mat = applyUnderwater(new THREE.MeshStandardMaterial({
    map: skin.map, roughnessMap: skin.roughnessMap,
    color: 0xffffff, roughness: 0.42, metalness: 0.12, side: THREE.DoubleSide,
  })) as THREE.MeshStandardMaterial
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer)
    shader.uniforms.uTime = fishTime
    shader.uniforms.uSway = { value: 1 }
    shader.vertexShader = SWIM_VERT + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n' + SWIM_BODY
    )
  }
  mat.customProgramCacheKey = () => 'fish'
  return mat
}

export const fishTime = { value: 0 }

/** Give a geometry a constant swim phase (for one-off, non-instanced fish). */
export function attachPhase(geo: THREE.BufferGeometry, phase: number, speed: number) {
  const n = geo.attributes.position.count
  const p = new Float32Array(n), s = new Float32Array(n)
  p.fill(phase); s.fill(speed)
  geo.setAttribute('aPhase', new THREE.BufferAttribute(p, 1))
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(s, 1))
  return geo
}
