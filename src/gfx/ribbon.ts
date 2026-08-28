import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, ShaderMaterial, Vector3 } from 'three'
import { COMMON_GLSL, U } from './shaderlib'

/**
 * A physical filament drawn as a view-aligned ribbon. It keeps a real world
 * thickness but never falls below roughly one pixel, so a 0.15 mm line stays
 * readable on a phone without being made to glow.
 */
export class Ribbon {
  mesh: Mesh
  private geo: BufferGeometry
  private pos: BufferAttribute
  private tan: BufferAttribute
  private count: number

  constructor(count: number, width: number, color: [number, number, number], minPx = 1.35) {
    this.count = count
    this.geo = new BufferGeometry()
    const n = count * 2
    this.pos = new BufferAttribute(new Float32Array(n * 3), 3)
    this.tan = new BufferAttribute(new Float32Array(n * 3), 3)
    const side = new BufferAttribute(new Float32Array(n), 1)
    for (let i = 0; i < count; i++) {
      side.setX(i * 2, -1)
      side.setX(i * 2 + 1, 1)
    }
    const idx: number[] = []
    for (let i = 0; i < count - 1; i++) {
      const a = i * 2
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
    this.geo.setAttribute('position', this.pos)
    this.geo.setAttribute('tangent3', this.tan)
    this.geo.setAttribute('side', side)
    this.geo.setIndex(idx)
    this.geo.setDrawRange(0, idx.length)

    const mat = new ShaderMaterial({
      uniforms: { ...U, uWidth: { value: width }, uMinPx: { value: minPx }, uPxScale: { value: 0.002 }, uColor: { value: color } },
      side: DoubleSide,
      transparent: false,
      vertexShader: /* glsl */ `
        attribute vec3 tangent3;
        attribute float side;
        uniform float uWidth;
        uniform float uMinPx;
        uniform float uPxScale;
        varying vec3 vWorldPos;
        varying float vSide;
        void main() {
          vec4 wp = modelMatrix * vec4( position, 1.0 );
          vWorldPos = wp.xyz;
          vec4 mv = viewMatrix * wp;
          vec3 tv = normalize( ( viewMatrix * vec4( tangent3, 0.0 ) ).xyz );
          vec3 toEye = normalize( -mv.xyz );
          vec3 sideDir = normalize( cross( tv, toEye ) );
          float w = max( uWidth, uMinPx * uPxScale * max( -mv.z, 0.05 ) );
          mv.xyz += sideDir * side * w;
          vSide = side;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uColor;
        varying vec3 vWorldPos;
        varying float vSide;
        ${COMMON_GLSL}
        void main() {
          float r = clamp( abs( vSide ), 0.0, 1.0 );
          float round = sqrt( max( 1.0 - r * r, 0.0 ) );
          vec3 c = uColor * ( 0.55 + 0.45 * round );
          gl_FragColor = vec4( applyWater( c, vWorldPos ), 1.0 );
          #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
    })
    this.mesh = new Mesh(this.geo, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 2
  }

  setPixelScale(v: number) {
    ;(this.mesh.material as ShaderMaterial).uniforms.uPxScale.value = v
  }

  /** feed a polyline in world space; unused nodes collapse onto the last point */
  setPoints(points: Vector3[]) {
    const n = Math.min(points.length, this.count)
    const t = new Vector3()
    for (let i = 0; i < this.count; i++) {
      const p = points[Math.min(i, n - 1)]
      const a = points[Math.max(0, Math.min(i - 1, n - 1))]
      const b = points[Math.min(i + 1, n - 1)]
      t.copy(b).sub(a)
      if (t.lengthSq() < 1e-12) t.set(0, 1, 0)
      t.normalize()
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k
        this.pos.setXYZ(j, p.x, p.y, p.z)
        this.tan.setXYZ(j, t.x, t.y, t.z)
      }
    }
    this.pos.needsUpdate = true
    this.tan.needsUpdate = true
  }
}
