/**
 * 場面の組み立て / scene assembly.
 *
 * 近景に治具の把手、中景にピンと櫛歯の接触点、遠景に作業灯と部品トレー。
 * 光は広い作業灯と控えめな窓光。金属は環境マップで光源と周囲の形を映す。
 */

import * as THREE from 'three'
import type { Pin } from '../core/mechanics.ts'
import { buildEnvironment, createMaterials, type Materials } from './materials.ts'
import { buildMechanism, type Mechanism } from './mechanism.ts'
import { buildJigs, type Jigs } from './jigs.ts'

export interface Stage {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  mechanism: Mechanism
  jigs: Jigs
  materials: Materials
  reveal: THREE.Group
  /** 構図の調整用 (開発時のみ)。縦画面と横画面の作業構図を上書きする。 */
  tuneFraming(which: 'portrait' | 'landscape' | 'reveal', patch: Partial<{
    target: [number, number, number]
    distance: number
    azimuth: number
    elevation: number
    fov: number
  }>): void
  setSize(w: number, h: number, dpr: number): void
  /** 0 = 作業構図、1 = 引いて工房を見せる構図 */
  setReveal(t: number): void
  /** 画面上での 1 mm あたりの CSS px 数 (指定した世界座標の深さで) */
  pxPerMm(at: THREE.Vector3): number
  project(p: THREE.Vector3, out: THREE.Vector2): THREE.Vector2
  dispose(): void
}

interface Framing {
  target: THREE.Vector3
  distance: number
  azimuth: number
  elevation: number
  fov: number
}

const WORK_PORTRAIT: Framing = {
  target: new THREE.Vector3(-4.6, 12.0, 10.0),
  distance: 108,
  azimuth: 0.75,
  elevation: 0.42,
  fov: 30,
}
const WORK_LANDSCAPE: Framing = {
  target: new THREE.Vector3(-3.0, 12.0, 8.0),
  distance: 105,
  azimuth: 0.66,
  elevation: 0.40,
  fov: 21,
}
/** 完成後の「少し引く」構図。縦横で引く量が違う (縦は幅が狭いぶん多く引く)。 */
const REVEAL_LANDSCAPE: Framing = {
  target: new THREE.Vector3(-14, 8, 2),
  distance: 205,
  azimuth: 0.72,
  elevation: 0.31,
  fov: 30,
}
const REVEAL_PORTRAIT: Framing = {
  target: new THREE.Vector3(8, 11, -2),
  distance: 288,
  azimuth: 0.70,
  elevation: 0.30,
  fov: 30,
}

function lerpFraming(a: Framing, b: Framing, t: number, out: Framing): Framing {
  out.target.lerpVectors(a.target, b.target, t)
  out.distance = a.distance + (b.distance - a.distance) * t
  out.azimuth = a.azimuth + (b.azimuth - a.azimuth) * t
  out.elevation = a.elevation + (b.elevation - a.elevation) * t
  out.fov = a.fov + (b.fov - a.fov) * t
  return out
}

export function buildStage(canvas: HTMLCanvasElement, pins: readonly Pin[]): Stage {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x14100d)
  const envTex = buildEnvironment(renderer)
  scene.environment = envTex

  const materials = createMaterials()
  const mechanism = buildMechanism(materials, pins)
  scene.add(mechanism.root)
  const jigs = buildJigs(materials)
  scene.add(jigs.root)

  const reveal = buildRoom(materials)
  scene.add(reveal)

  // ---- 光 ------------------------------------------------------------------
  // 広い作業灯。唯一の動的な影はこれ。
  const lamp = new THREE.DirectionalLight(0xfff1dc, 2.7)
  lamp.position.set(-52, 62, 40)
  lamp.target.position.set(0, 10, 4)
  lamp.castShadow = true
  lamp.shadow.mapSize.set(1024, 1024)
  lamp.shadow.camera.near = 20
  lamp.shadow.camera.far = 220
  const s = 62
  lamp.shadow.camera.left = -s
  lamp.shadow.camera.right = s
  lamp.shadow.camera.top = s
  lamp.shadow.camera.bottom = -s
  lamp.shadow.bias = -0.0009
  lamp.shadow.normalBias = 0.35
  scene.add(lamp, lamp.target)

  // 控えめな窓光 (冷たい、影なし)
  const window1 = new THREE.DirectionalLight(0x9fb8d4, 0.6)
  window1.position.set(-120, 46, -60)
  scene.add(window1)

  // 工房の広がりを見せるための、机まわりの弱い灯り。影は落とさない。
  const room = new THREE.PointLight(0xffe6c2, 900, 340, 2)
  room.position.set(-48, 50, 34)
  scene.add(room)

  // 接触部の下側にわずかな返り。暗部にも構造が残るようにするだけで、
  // 発光するピンやネオン線は使わない。
  const bounce = new THREE.DirectionalLight(0xbfd0e2, 0.5)
  bounce.position.set(40, -20, 70)
  scene.add(bounce)

  // 暗部にも構造が残るように
  scene.add(new THREE.HemisphereLight(0x8b9cae, 0x3a2e22, 0.75))

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 900)
  const current: Framing = {
    target: WORK_PORTRAIT.target.clone(),
    distance: WORK_PORTRAIT.distance,
    azimuth: WORK_PORTRAIT.azimuth,
    elevation: WORK_PORTRAIT.elevation,
    fov: WORK_PORTRAIT.fov,
  }
  let revealT = 0
  let width = 1
  let height = 1

  const applyCamera = () => {
    const wide = width >= height
    const work = wide ? WORK_LANDSCAPE : WORK_PORTRAIT
    lerpFraming(work, wide ? REVEAL_LANDSCAPE : REVEAL_PORTRAIT, revealT, current)
    const ce = Math.cos(current.elevation)
    camera.position.set(
      current.target.x + Math.sin(current.azimuth) * ce * current.distance,
      current.target.y + Math.sin(current.elevation) * current.distance,
      current.target.z + Math.cos(current.azimuth) * ce * current.distance,
    )
    camera.lookAt(current.target)
    camera.fov = current.fov
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    // 画面上の当たり判定を同じフレームで正しく出すため、描画を待たずに確定する。
    camera.updateMatrixWorld(true)
  }

  const ndc = new THREE.Vector3()
  return {
    scene,
    camera,
    renderer,
    mechanism,
    jigs,
    materials,
    reveal,
    tuneFraming(which, patch) {
      const f =
        which === 'portrait'
          ? WORK_PORTRAIT
          : which === 'landscape'
            ? WORK_LANDSCAPE
            : REVEAL_LANDSCAPE
      if (patch.target) f.target.set(...patch.target)
      if (patch.distance !== undefined) f.distance = patch.distance
      if (patch.azimuth !== undefined) f.azimuth = patch.azimuth
      if (patch.elevation !== undefined) f.elevation = patch.elevation
      if (patch.fov !== undefined) f.fov = patch.fov
      applyCamera()
    },
    setSize(w, h, dpr) {
      width = Math.max(1, w)
      height = Math.max(1, h)
      renderer.setPixelRatio(dpr)
      renderer.setSize(width, height, false)
      applyCamera()
    },
    setReveal(t) {
      revealT = Math.min(1, Math.max(0, t))
      applyCamera()
    },
    pxPerMm(at) {
      const d = camera.position.distanceTo(at)
      const visible = 2 * d * Math.tan((camera.fov * Math.PI) / 360)
      return height / visible
    },
    project(p, out) {
      camera.updateMatrixWorld()
      ndc.copy(p).project(camera)
      out.set(((ndc.x + 1) / 2) * width, ((1 - ndc.y) / 2) * height)
      return out
    },
    dispose() {
      materials.dispose()
      envTex.dispose()
      renderer.dispose()
    },
  }
}

/** 作業台、作業灯、部品トレー、窓、小さなクリスマスの工房。 */
function buildRoom(mats: Materials): THREE.Group {
  const g = new THREE.Group()
  const geoms: THREE.BufferGeometry[] = []
  const keep = <T extends THREE.BufferGeometry>(x: T): T => (geoms.push(x), x)

  const bench = new THREE.Mesh(keep(new THREE.BoxGeometry(300, 7, 190)), mats.bench)
  bench.position.set(0, -8.8, -6)
  bench.receiveShadow = true
  g.add(bench)

  const wallBack = new THREE.Mesh(keep(new THREE.BoxGeometry(420, 260, 5)), mats.wall)
  wallBack.position.set(0, 108, -128)
  g.add(wallBack)
  const wallLeft = new THREE.Mesh(keep(new THREE.BoxGeometry(5, 260, 280)), mats.wall)
  wallLeft.position.set(-166, 108, -20)
  g.add(wallLeft)

  // 窓 (控えめな冷たい光の面)
  const win = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(74, 96)),
    new THREE.MeshBasicMaterial({ color: 0x9db8d6 }),
  )
  win.position.set(-163, 96, -30)
  win.rotation.y = Math.PI / 2
  g.add(win)
  for (const off of [-1, 1]) {
    const bar = new THREE.Mesh(keep(new THREE.BoxGeometry(1.6, 96, 2.2)), mats.wall)
    bar.position.set(-162, 96, -30 + off * 18)
    g.add(bar)
  }

  // 作業灯 (笠 + 発光面)。反射に映る形の実体。
  const shade = new THREE.Mesh(keep(new THREE.ConeGeometry(13, 15, 24, 1, true)), mats.lampShade)
  shade.position.set(-52, 58, 34)
  shade.rotation.set(0.62, 0, 0.48)
  g.add(shade)
  const glow = new THREE.Mesh(keep(new THREE.CircleGeometry(9.5, 24)), mats.lampGlow)
  glow.position.set(-49.6, 53.2, 37.6)
  glow.lookAt(0, 8, 4)
  g.add(glow)
  const arm = new THREE.Mesh(keep(new THREE.CylinderGeometry(1.6, 1.6, 74, 12)), mats.frame)
  arm.position.set(-76, 28, 16)
  arm.rotation.z = 0.62
  arm.rotation.x = -0.28
  const armFoot = new THREE.Mesh(keep(new THREE.CylinderGeometry(9, 10, 2.4, 20)), mats.frame)
  armFoot.position.set(-98, -4, 8)
  armFoot.receiveShadow = true
  g.add(armFoot)
  g.add(arm)

  // 部品トレー (奥) と、予備のピン・ねじ
  const tray = new THREE.Mesh(keep(new THREE.BoxGeometry(46, 1.6, 30)), mats.frame)
  tray.position.set(-62, -4.6, -34)
  tray.receiveShadow = true
  g.add(tray)
  for (const off of [[-23, 0], [23, 0], [0, -15], [0, 15]] as const) {
    const wallP = new THREE.Mesh(
      keep(new THREE.BoxGeometry(off[0] === 0 ? 46 : 1.6, 4, off[0] === 0 ? 1.6 : 30)),
      mats.frame,
    )
    wallP.position.set(-62 + off[0], -2.8, -34 + off[1])
    g.add(wallP)
  }
  const spare = new THREE.InstancedMesh(
    keep(new THREE.CylinderGeometry(0.25, 0.25, 6, 6)),
    mats.pin,
    22,
  )
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)
  let seed = 991
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let i = 0; i < 22; i++) {
    p.set(-62 + (rnd() - 0.5) * 36, -3.6, -34 + (rnd() - 0.5) * 22)
    q.setFromEuler(new THREE.Euler(Math.PI / 2, rnd() * Math.PI, 0))
    spare.setMatrixAt(i, m.compose(p, q, one))
  }
  spare.instanceMatrix.needsUpdate = true
  g.add(spare)

  const cloth = new THREE.Mesh(keep(new THREE.BoxGeometry(40, 0.8, 26)), mats.felt)
  cloth.position.set(58, -4.9, -28)
  cloth.rotation.y = -0.2
  g.add(cloth)

  // 小さなクリスマスの工房 — 控えめに、奥に。
  const jar = new THREE.Mesh(keep(new THREE.CylinderGeometry(6, 6.6, 12, 20)), mats.brass)
  jar.position.set(58, 0.7, -14)
  jar.castShadow = true
  g.add(jar)
  for (let i = 0; i < 5; i++) {
    const sprig = new THREE.Mesh(keep(new THREE.ConeGeometry(4.2 - i * 0.6, 7, 9)), mats.fir)
    sprig.position.set(58 + (i % 2 === 0 ? 1.2 : -1.4), 9 + i * 3.4, -14 + (i % 3) * 0.9)
    sprig.castShadow = true
    g.add(sprig)
  }
  const bauble = new THREE.Mesh(keep(new THREE.SphereGeometry(3.1, 16, 12)), mats.paint)
  bauble.position.set(47, -2.4, -2)
  bauble.castShadow = true
  g.add(bauble)
  const cone = new THREE.Mesh(keep(new THREE.ConeGeometry(3.4, 9, 10)), mats.wood)
  cone.position.set(72, -0.8, -30)
  cone.rotation.z = 0.35
  g.add(cone)

  return g
}

