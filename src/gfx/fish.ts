import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three'
import { fishSkin } from './textures'
import { hookMaterial } from './shaderlib'
import type { Fish, World } from '../world'

const PROFILE: [number, number][] = [
  [0.0, 0.06],
  [0.04, 0.32],
  [0.1, 0.6],
  [0.2, 0.88],
  [0.31, 1.0],
  [0.46, 0.93],
  [0.62, 0.7],
  [0.76, 0.44],
  [0.88, 0.24],
  [0.95, 0.13],
  [1.0, 0.085],
]

function radiusAt(u: number) {
  for (let i = 1; i < PROFILE.length; i++) {
    if (u <= PROFILE[i][0]) {
      const [ua, ra] = PROFILE[i - 1]
      const [ub, rb] = PROFILE[i]
      const t = (u - ua) / (ub - ua)
      return ra + (rb - ra) * (t * t * (3 - 2 * t))
    }
  }
  return PROFILE[PROFILE.length - 1][1]
}

/** one small lake fish: spindle body, forked tail, dorsal and pectoral fins */
function fishGeometry(len = 1): BufferGeometry {
  const RINGS = 24
  const RAD = 12
  const posArr: number[] = []
  const nrmArr: number[] = []
  const uvArr: number[] = []
  const uArr: number[] = []
  const finArr: number[] = []
  const idx: number[] = []

  for (let i = 0; i <= RINGS; i++) {
    const u = i / RINGS
    const r = radiusAt(u) * 0.108 * len
    const x = (u - 0.34) * len
    for (let j = 0; j < RAD; j++) {
      const th = (j / RAD) * Math.PI * 2
      const cy = Math.cos(th)
      const cz = Math.sin(th)
      const py = cy * r * 1.55
      const pz = cz * r * 0.86
      posArr.push(x, py, pz)
      nrmArr.push(0, cy, cz)
      uvArr.push(u, 0.5 - cy * 0.5)
      uArr.push(u)
      finArr.push(0)
      if (i < RINGS) {
        const a = i * RAD + j
        const b = i * RAD + ((j + 1) % RAD)
        const c = (i + 1) * RAD + j
        const d = (i + 1) * RAD + ((j + 1) % RAD)
        idx.push(a, c, b, b, c, d)
      }
    }
  }

  const addQuad = (pts: number[][], u: number, uvv: number, mask = 1) => {
    const base = posArr.length / 3
    for (const p of pts) {
      posArr.push(p[0], p[1], p[2])
      nrmArr.push(0, 0, 1)
      uvArr.push(0.5, uvv)
      uArr.push(u)
      finArr.push(mask)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  const addBall = (cx: number, cy: number, cz: number, r: number, u: number, mask: number) => {
    const SEG = 6
    const base = posArr.length / 3
    for (let a = 0; a <= SEG; a++) {
      const phi = (a / SEG) * Math.PI
      for (let b = 0; b <= SEG; b++) {
        const th = (b / SEG) * Math.PI * 2
        const nx = Math.sin(phi) * Math.cos(th)
        const ny = Math.cos(phi)
        const nz = Math.sin(phi) * Math.sin(th)
        posArr.push(cx + nx * r, cy + ny * r, cz + nz * r)
        nrmArr.push(nx, ny, nz)
        uvArr.push(0.5, 0.5)
        uArr.push(u)
        finArr.push(mask)
      }
    }
    for (let a = 0; a < SEG; a++) {
      for (let b = 0; b < SEG; b++) {
        const p0 = base + a * (SEG + 1) + b
        const p1 = p0 + 1
        const p2 = p0 + (SEG + 1)
        const p3 = p2 + 1
        idx.push(p0, p2, p1, p1, p2, p3)
      }
    }
  }

  const tx = (1 - 0.34) * len
  // forked caudal fin, built as two lobes so the fork is real geometry
  addQuad(
    [
      [tx - 0.02 * len, 0, 0],
      [tx + 0.125 * len, 0.105 * len, 0],
      [tx + 0.072 * len, 0.016 * len, 0],
      [tx + 0.05 * len, 0, 0],
    ],
    1,
    0.3
  )
  addQuad(
    [
      [tx - 0.02 * len, 0, 0],
      [tx + 0.05 * len, 0, 0],
      [tx + 0.072 * len, -0.016 * len, 0],
      [tx + 0.125 * len, -0.105 * len, 0],
    ],
    1,
    0.3
  )
  // dorsal
  addQuad(
    [
      [0.06 * len, 0.062 * len, 0],
      [0.115 * len, 0.132 * len, 0],
      [0.205 * len, 0.112 * len, 0],
      [0.2 * len, 0.05 * len, 0],
    ],
    0.58,
    0.1
  )
  // small adipose fin, the detail that makes it this kind of fish
  addQuad(
    [
      [0.34 * len, 0.042 * len, 0],
      [0.37 * len, 0.072 * len, 0],
      [0.41 * len, 0.062 * len, 0],
      [0.405 * len, 0.035 * len, 0],
    ],
    0.78,
    0.12
  )
  // anal
  addQuad(
    [
      [0.16 * len, -0.056 * len, 0],
      [0.225 * len, -0.112 * len, 0],
      [0.3 * len, -0.09 * len, 0],
      [0.29 * len, -0.045 * len, 0],
    ],
    0.66,
    0.92
  )
  // pectorals, both sides
  for (const s of [1, -1]) {
    addQuad(
      [
        [-0.115 * len, -0.014 * len, 0.024 * len * s],
        [-0.05 * len, -0.052 * len, 0.082 * len * s],
        [0.0, -0.024 * len, 0.062 * len * s],
        [-0.025 * len, -0.004 * len, 0.026 * len * s],
      ],
      0.3,
      0.72
    )
  }
  // eyes
  for (const s of [1, -1]) {
    addBall(-0.265 * len, 0.017 * len, 0.031 * len * s, 0.0155 * len, 0.05, 2)
  }

  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(posArr), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrmArr), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvArr), 2))
  g.setAttribute('ualong', new BufferAttribute(new Float32Array(uArr), 1))
  g.setAttribute('finmask', new BufferAttribute(new Float32Array(finArr), 1))
  g.setIndex(idx)
  return g
}

function fishMaterial(instanced: boolean) {
  const mat = hookMaterial(
    new MeshStandardMaterial({
      map: fishSkin(),
      roughness: 0.33,
      metalness: 0.22,
      transparent: true,
      depthWrite: true,
      side: 2,
    }),
    {
      underwater: true,
      extraFragment: `
        if ( vFinMask > 1.5 ) {
          gl_FragColor.rgb = vec3( 0.018, 0.02, 0.024 ) + gl_FragColor.rgb * 0.06;
          gl_FragColor.a = 1.0;
        } else {
          gl_FragColor.a *= mix( 1.0, 0.68, clamp( vFinMask, 0.0, 1.0 ) );
          gl_FragColor.rgb *= mix( 1.0, 0.78, clamp( vFinMask, 0.0, 1.0 ) );
        }`,
    }
  ) as MeshStandardMaterial
  const base = mat.onBeforeCompile
  mat.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer)
    shader.uniforms.uSwimPhase = { value: 0 }
    shader.uniforms.uSwimAmp = { value: 1 }
    ;(mat as any).userData.shader = shader
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float ualong;
        attribute float finmask;
        ${instanced ? 'attribute float iphase;' : ''}
        uniform float uSwimPhase;
        uniform float uSwimAmp;
        varying float vFinMask;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vFinMask = finmask;
        float ph = uSwimPhase ${instanced ? '+ iphase' : ''};
        float swing = sin( ph - ualong * 3.4 ) * uSwimAmp;
        transformed.z += swing * ( 0.012 + 0.075 * pow( ualong, 2.1 ) );
        transformed.y += swing * 0.004 * pow( ualong, 3.0 );`
      )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nvarying float vFinMask;'
    )
  }
  mat.customProgramCacheKey = () => (instanced ? 'fish_inst' : 'fish_solo')
  return mat
}

export class FishSchool {
  group = new Group()
  solo: { mesh: Mesh; mat: MeshStandardMaterial }[] = []
  private crowd: InstancedMesh
  private crowdPhase: Float32Array
  private tmp = new Object3D()
  private q = new Quaternion()

  constructor(soloCount: number, crowdCount: number) {
    const geo = fishGeometry(1)
    for (let i = 0; i < soloCount; i++) {
      const mat = fishMaterial(false)
      const mesh = new Mesh(geo, mat)
      mesh.castShadow = false
      mesh.frustumCulled = false
      this.group.add(mesh)
      this.solo.push({ mesh, mat })
    }

    const cgeo = geo.clone()
    this.crowdPhase = new Float32Array(crowdCount)
    const iph = new Float32Array(crowdCount)
    for (let i = 0; i < crowdCount; i++) iph[i] = Math.random() * 6.28
    this.crowdPhase.set(iph)
    cgeo.setAttribute('iphase', new InstancedBufferAttribute(iph, 1))
    this.crowd = new InstancedMesh(cgeo, fishMaterial(true), crowdCount)
    this.crowd.frustumCulled = false
    this.group.add(this.crowd)
  }

  update(w: World, dt: number) {
    for (let i = 0; i < this.solo.length; i++) {
      const f: Fish | undefined = w.fish[i]
      const { mesh, mat } = this.solo[i]
      if (!f) {
        mesh.visible = false
        continue
      }
      mesh.visible = true
      mesh.position.copy(f.pos)
      this.q.setFromAxisAngle(new Vector3(0, 1, 0), f.yaw + Math.PI / 2)
      mesh.quaternion.copy(this.q)
      // out of the water it hangs by the hook, head up
      const hang = f.phase === 'hooked' && w.reelState !== 'idle' ? Math.min(1, Math.max(0, (f.pos.y + 0.25) * 2.2)) : 0
      mesh.rotateZ(f.bank * 0.5 - hang * 0.72)
      mesh.scale.setScalar(f.size)
      const sh = (mat as any).userData.shader
      if (sh) {
        sh.uniforms.uSwimPhase.value = f.tailPhase
        sh.uniforms.uSwimAmp.value = f.phase === 'hooked' ? 1.5 : 0.55 + Math.min(1, f.vel.length() * 2.2)
      }
    }

    // the rest of the school stays out in the murk, a slow shoal
    const t = w.time
    const m = new Matrix4()
    for (let i = 0; i < this.crowd.count; i++) {
      const a = i * 2.399963 + t * (0.055 + (i % 5) * 0.006)
      const r = 2.1 + (i % 7) * 0.55
      const y = w.layerDepth - 0.25 - (i % 4) * 0.28 + Math.sin(t * 0.3 + i) * 0.1
      this.tmp.position.set(Math.cos(a) * r, y, Math.sin(a) * r)
      this.tmp.rotation.set(0, -a + Math.PI, 0)
      this.tmp.scale.setScalar((0.062 + (i % 3) * 0.012))
      this.tmp.updateMatrix()
      m.copy(this.tmp.matrix)
      this.crowd.setMatrixAt(i, m)
    }
    this.crowd.instanceMatrix.needsUpdate = true
    const csh = (this.crowd.material as any).userData?.shader
    if (csh) {
      csh.uniforms.uSwimPhase.value = t * 6
      csh.uniforms.uSwimAmp.value = 0.7
    }
    void dt
  }
}
