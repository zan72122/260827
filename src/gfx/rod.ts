import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three'
import { DECK_TOP } from '../world'
import { metalMaps } from './textures'
import { hookMaterial, srgb } from './shaderlib'

const SEGMENTS = 30
const RADIAL = 7
export const ROD_BUTT = new Vector3(-0.07, 0.795, -0.45)
export const ROD_TIP_REST = new Vector3(0.012, 0.72, 0)

const UP = new Vector3(0, 1, 0)

export class Rod {
  group = new Group()
  tipLocal = ROD_TIP_REST.clone()
  guideLocal: Vector3[] = []
  private blank: Mesh
  private geo: BufferGeometry
  private guides: Mesh[] = []
  private spool: Mesh
  private dir = new Vector3()
  private bendDir = new Vector3()
  private length = 0
  private tmpA = new Vector3()
  private tmpB = new Vector3()
  private q = new Quaternion()

  constructor() {
    this.dir.copy(ROD_TIP_REST).sub(ROD_BUTT)
    this.length = this.dir.length()
    this.dir.normalize()
    this.bendDir.copy(UP).addScaledVector(this.dir, -UP.dot(this.dir)).normalize()

    this.geo = new BufferGeometry()
    const count = (SEGMENTS + 1) * RADIAL
    this.geo.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3))
    this.geo.setAttribute('normal', new BufferAttribute(new Float32Array(count * 3), 3))
    const uv = new Float32Array(count * 2)
    const idx: number[] = []
    for (let i = 0; i <= SEGMENTS; i++) {
      for (let j = 0; j < RADIAL; j++) {
        uv[(i * RADIAL + j) * 2] = j / RADIAL
        uv[(i * RADIAL + j) * 2 + 1] = i / SEGMENTS
        if (i < SEGMENTS) {
          const a = i * RADIAL + j
          const b = i * RADIAL + ((j + 1) % RADIAL)
          const c = (i + 1) * RADIAL + j
          const d = (i + 1) * RADIAL + ((j + 1) % RADIAL)
          idx.push(a, c, b, b, c, d)
        }
      }
    }
    this.geo.setAttribute('uv', new BufferAttribute(uv, 2))
    this.geo.setIndex(idx)

    // matte carbon blank whose last third is painted pale so it reads
    // against the dark water without any glow
    const blankMat = hookMaterial(
      new MeshStandardMaterial({ color: srgb(0xffffff), roughness: 0.52, metalness: 0.05 }),
      {
        extraFragment: `
          float s = vMapUvRod;
          vec3 carbon = vec3( 0.055, 0.056, 0.060 );
          vec3 painted = vec3( 0.70, 0.675, 0.615 );
          float m = smoothstep( 0.60, 0.72, s );
          gl_FragColor.rgb *= mix( carbon, painted, m );`,
      }
    ) as MeshStandardMaterial
    // pass the blank parameter through as its own varying
    const base = blankMat.onBeforeCompile
    blankMat.onBeforeCompile = (shader, renderer) => {
      base(shader, renderer)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vMapUvRod;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUvRod = uv.y;')
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\nvarying float vMapUvRod;'
      )
    }
    blankMat.customProgramCacheKey = () => 'rod_blank'

    this.blank = new Mesh(this.geo, blankMat)
    this.blank.castShadow = true
    this.group.add(this.blank)

    const alloy = metalMaps(256, [0.58, 0.59, 0.61])
    const guideMat = hookMaterial(
      new MeshStandardMaterial({
        map: alloy.map,
        roughnessMap: alloy.roughnessMap,
        roughness: 0.42,
        metalness: 0.85,
      })
    )
    for (let i = 0; i < 4; i++) {
      const r = 0.0075 - i * 0.0012
      const gm = new Mesh(new TorusGeometry(r, 0.0012, 5, 14), guideMat)
      gm.castShadow = true
      this.guides.push(gm)
      this.group.add(gm)
      this.guideLocal.push(new Vector3())
    }

    // electric reel: moulded body, alloy spool, worn switch
    const bodyMat = hookMaterial(new MeshStandardMaterial({ color: srgb(0x1e2124), roughness: 0.62, metalness: 0.08 }))
    const body = new Mesh(new BoxGeometry(0.085, 0.062, 0.058), bodyMat)
    const bodyPos = ROD_BUTT.clone().addScaledVector(this.dir, 0.035).add(new Vector3(0, -0.045, 0))
    body.position.copy(bodyPos)
    body.lookAt(bodyPos.clone().add(this.dir))
    body.castShadow = true
    this.group.add(body)

    const spoolMat = hookMaterial(
      new MeshStandardMaterial({ map: alloy.map, roughnessMap: alloy.roughnessMap, roughness: 0.45, metalness: 0.8 })
    )
    this.spool = new Mesh(new CylinderGeometry(0.021, 0.021, 0.03, 18), spoolMat)
    this.spool.position.copy(bodyPos).add(new Vector3(0, 0.008, 0))
    this.spool.quaternion.setFromUnitVectors(UP, this.tmpA.copy(this.dir).cross(UP).normalize())
    this.spool.castShadow = true
    this.group.add(this.spool)

    const knob = new Mesh(new CylinderGeometry(0.008, 0.008, 0.012, 10), spoolMat)
    knob.position.copy(this.spool.position).addScaledVector(this.tmpA, 0.026)
    knob.quaternion.copy(this.spool.quaternion)
    this.group.add(knob)

    const clamp = new Mesh(new CylinderGeometry(0.014, 0.014, 0.05, 10), bodyMat)
    clamp.position.copy(ROD_BUTT).add(new Vector3(0, -0.02, 0))
    clamp.castShadow = true
    this.group.add(clamp)
    const grip = new Mesh(new CylinderGeometry(0.011, 0.013, 0.075, 12), new MeshStandardMaterial({ color: srgb(0x30281f), roughness: 0.95 }))
    grip.position.copy(ROD_BUTT).addScaledVector(this.dir, -0.028)
    grip.quaternion.setFromUnitVectors(UP, this.dir)
    this.group.add(grip)

    const stem = new Mesh(new CylinderGeometry(0.012, 0.012, 0.09, 10), bodyMat)
    stem.position.set(ROD_BUTT.x, (ROD_BUTT.y + DECK_TOP + 0.3) / 2 - 0.02, ROD_BUTT.z + 0.045)
    this.group.add(stem)

    this.update(0, 0)
  }

  /** point on the blank; bend grows toward the tip like a loaded cantilever */
  private point(s: number, bend: number, out: Vector3) {
    out.copy(ROD_BUTT).addScaledVector(this.dir, s * this.length)
    const shape = Math.pow(s, 2.25)
    out.addScaledVector(this.bendDir, bend * shape)
    return out
  }

  update(bend: number, reelSpin: number) {
    const pos = this.geo.attributes.position as BufferAttribute
    const nrm = this.geo.attributes.normal as BufferAttribute
    const a = this.tmpA
    const b = this.tmpB
    const tangent = new Vector3()
    const nx = new Vector3()
    const ny = new Vector3()
    for (let i = 0; i <= SEGMENTS; i++) {
      const s = i / SEGMENTS
      this.point(s, bend, a)
      this.point(Math.min(1, s + 0.01), bend, b)
      tangent.copy(b).sub(a).normalize()
      nx.copy(UP).cross(tangent).normalize()
      ny.copy(tangent).cross(nx).normalize()
      const r = 0.0062 * (1 - s) + 0.0013 * s
      for (let j = 0; j < RADIAL; j++) {
        const th = (j / RADIAL) * Math.PI * 2
        const cx = Math.cos(th)
        const cy = Math.sin(th)
        const k = i * RADIAL + j
        pos.setXYZ(k, a.x + (nx.x * cx + ny.x * cy) * r, a.y + (nx.y * cx + ny.y * cy) * r, a.z + (nx.z * cx + ny.z * cy) * r)
        nrm.setXYZ(k, nx.x * cx + ny.x * cy, nx.y * cx + ny.y * cy, nx.z * cx + ny.z * cy)
      }
      if (i === SEGMENTS) this.tipLocal.copy(a)
    }
    pos.needsUpdate = true
    nrm.needsUpdate = true
    this.geo.computeBoundingSphere()

    const gs = [0.34, 0.56, 0.77, 0.94]
    for (let i = 0; i < this.guides.length; i++) {
      const s = gs[i]
      this.point(s, bend, a)
      this.point(Math.min(1, s + 0.01), bend, b)
      tangent.copy(b).sub(a).normalize()
      this.guideLocal[i].copy(a).addScaledVector(UP, -(0.0068 * (1 - s) + 0.00135 * s) - 0.0055)
      this.guides[i].position.copy(this.guideLocal[i])
      this.q.setFromUnitVectors(UP, tangent)
      this.guides[i].quaternion.copy(this.q)
    }
    this.spool.rotation.y = reelSpin
  }
}
