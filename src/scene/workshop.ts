import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { SPEC } from '../design'
import { silhouetteRadius } from '../honeycomb/profile'
import { windowSky } from './textures'
import type { MaterialSet } from './materials'
import { makeRng } from '../util/rng'

export interface Workshop {
  group: THREE.Group
  sun: THREE.DirectionalLight
  lamp: THREE.PointLight
  background: THREE.Group
  dispose(): void
}

/** ツリーの輪郭を平面図形にしたもの（裁断済みの紙束・裁ち落としに使う） */
function silhouetteShape(scale = 1): THREE.Shape {
  const s = new THREE.Shape()
  const steps = 60
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= steps; i++) {
    const y = (i / steps) * SPEC.H
    pts.push(new THREE.Vector2(silhouetteRadius(y) * scale, y * scale))
  }
  s.moveTo(-pts[0].x, pts[0].y)
  for (const p of pts) s.lineTo(p.x, p.y)
  for (let i = pts.length - 1; i >= 0; i--) s.lineTo(-pts[i].x, pts[i].y)
  s.closePath()
  return s
}

export function createWorkshop(mats: MaterialSet, seed: number): Workshop {
  const group = new THREE.Group()
  const background = new THREE.Group()
  group.add(background)
  const rng = makeRng(seed)
  const disposables: Array<{ dispose(): void }> = []
  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g)
    return g
  }

  // ---- 机 ---------------------------------------------------------------
  const DESK_W = 2.9
  const DESK_D = 1.15
  const DESK_FRONT = -0.33
  const deskTop = track(new THREE.BoxGeometry(DESK_W, 0.032, DESK_D))
  const desk = new THREE.Mesh(deskTop, mats.wood)
  desk.position.set(0, -0.016, DESK_FRONT + DESK_D / 2)
  desk.receiveShadow = true
  desk.castShadow = true
  group.add(desk)

  // 使い込んだ手前の縁だけ、当たって色が抜け滑らかになっている
  const edge = new THREE.Mesh(track(new THREE.BoxGeometry(DESK_W, 0.034, 0.028)), mats.woodWorn)
  edge.position.set(0, -0.016, DESK_FRONT + 0.012)
  edge.receiveShadow = true
  group.add(edge)

  const legGeo = track(new THREE.BoxGeometry(0.06, 0.72, 0.06))
  for (const sx of [-1, 1]) {
    for (const sz of [0, 1]) {
      const leg = new THREE.Mesh(legGeo, mats.wood)
      leg.position.set(sx * (DESK_W / 2 - 0.07), -0.39, DESK_FRONT + 0.09 + sz * (DESK_D - 0.2))
      leg.castShadow = true
      group.add(leg)
    }
  }

  // ---- 床・壁 -----------------------------------------------------------
  const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(9, 9)), mats.wall)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, -0.75, 0.2)
  floor.receiveShadow = true
  background.add(floor)

  const wallGeoms: THREE.BufferGeometry[] = []
  const WALL_Z = 1.35
  const WIN_W = 0.95
  const WIN_H = 0.84
  const WIN_Y = 0.47
  const WIN_X = -0.52
  // 窓のぶんだけ抜いた壁を4枚の板で作る
  const wallPieces: Array<[number, number, number, number]> = [
    [-3.2, 3.2, WIN_Y + WIN_H / 2, 1.9],
    [-3.2, 3.2, WIN_Y - WIN_H / 2 - 0.95, 1.9],
    [-3.2, WIN_X - WIN_W / 2, WIN_Y, WIN_H],
    [WIN_X + WIN_W / 2, 3.2, WIN_Y, WIN_H],
  ]
  for (const [x0, x1, cy, h] of wallPieces) {
    const g = new THREE.BoxGeometry(x1 - x0, h, 0.04)
    g.translate((x0 + x1) / 2, cy + (h === 1.9 ? h / 2 : 0), WALL_Z)
    wallGeoms.push(g)
  }
  const wall = new THREE.Mesh(track(mergeGeometries(wallGeoms, false)!), mats.wall)
  wall.receiveShadow = true
  background.add(wall)
  for (const g of wallGeoms) g.dispose()

  const sky = new THREE.Mesh(track(new THREE.PlaneGeometry(WIN_W, WIN_H)), mats.sky)
  const skyTex = windowSky()
  disposables.push(skyTex)
  ;(mats.sky as THREE.MeshBasicMaterial).map = skyTex
  mats.sky.needsUpdate = true
  sky.position.set(WIN_X, WIN_Y, WALL_Z + 0.06)
  background.add(sky)

  const frameGeoms: THREE.BufferGeometry[] = []
  const bar = (w: number, h: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, 0.03)
    g.translate(x, y, z)
    frameGeoms.push(g)
  }
  bar(WIN_W + 0.08, 0.05, WIN_X, WIN_Y + WIN_H / 2, WALL_Z - 0.01)
  bar(WIN_W + 0.08, 0.05, WIN_X, WIN_Y - WIN_H / 2, WALL_Z - 0.01)
  bar(0.05, WIN_H, WIN_X - WIN_W / 2, WIN_Y, WALL_Z - 0.01)
  bar(0.05, WIN_H, WIN_X + WIN_W / 2, WIN_Y, WALL_Z - 0.01)
  bar(0.03, WIN_H, WIN_X, WIN_Y, WALL_Z - 0.01)
  const winFrame = new THREE.Mesh(track(mergeGeometries(frameGeoms, false)!), mats.frame)
  winFrame.castShadow = true
  background.add(winFrame)
  for (const g of frameGeoms) g.dispose()

  // ---- 紙の棚（用途が分かる形にする） ------------------------------------
  const shelfGeoms: THREE.BufferGeometry[] = []
  const SH_X = 0.98
  const SH_Z = 1.15
  for (let i = 0; i < 4; i++) {
    const g = new THREE.BoxGeometry(0.72, 0.022, 0.34)
    g.translate(SH_X, 0.12 + i * 0.3, SH_Z)
    shelfGeoms.push(g)
  }
  for (const sx of [-1, 1]) {
    const g = new THREE.BoxGeometry(0.026, 1.15, 0.34)
    g.translate(SH_X + sx * 0.36, 0.66, SH_Z)
    shelfGeoms.push(g)
  }
  const shelf = new THREE.Mesh(track(mergeGeometries(shelfGeoms, false)!), mats.shelf)
  shelf.castShadow = true
  shelf.receiveShadow = true
  background.add(shelf)
  for (const g of shelfGeoms) g.dispose()

  // 棚に載る紙の平束と巻いた紙
  const stackGeoms: THREE.BufferGeometry[] = []
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 3; k++) {
      const h = 0.03 + rng() * 0.06
      const g = new THREE.BoxGeometry(0.19, h, 0.26)
      g.translate(SH_X - 0.24 + k * 0.24 + (rng() - 0.5) * 0.02, 0.133 + i * 0.3 + h / 2, SH_Z + (rng() - 0.5) * 0.03)
      g.rotateY((rng() - 0.5) * 0.08)
      stackGeoms.push(g)
    }
  }
  for (let i = 0; i < 5; i++) {
    const g = new THREE.CylinderGeometry(0.035, 0.035, 0.3, 10, 1, true)
    g.rotateZ(Math.PI / 2)
    g.translate(SH_X + 0.1 + (rng() - 0.5) * 0.2, 0.16 + Math.floor(rng() * 3) * 0.3, SH_Z + 0.06)
    stackGeoms.push(g)
  }
  const stacks = new THREE.Mesh(track(mergeGeometries(stackGeoms, false)!), mats.board)
  stacks.castShadow = true
  background.add(stacks)
  for (const g of stackGeoms) g.dispose()

  // ---- 手前の作業まわり ---------------------------------------------------
  // 元の平たい材料（同じ輪郭・同じ厚みの束）。完成後に並べて見せる。
  const flatShape = silhouetteShape(0.98)
  const flatGeo = track(
    new THREE.ExtrudeGeometry(flatShape, { depth: SPEC.N * SPEC.tau + 2 * SPEC.tauBoard, bevelEnabled: false, curveSegments: 2 }),
  )
  const flatStack = new THREE.Mesh(flatGeo, mats.board)
  flatStack.rotation.x = -Math.PI / 2
  flatStack.rotation.z = -1.15
  flatStack.position.set(-0.185, 0.0016, 0.145)
  flatStack.castShadow = true
  flatStack.receiveShadow = true
  group.add(flatStack)

  // 裁ち落としの紙端材（少量）
  const scrapGeoms: THREE.BufferGeometry[] = []
  for (let i = 0; i < 5; i++) {
    const w = 0.016 + rng() * 0.03
    const d = 0.012 + rng() * 0.022
    const g = new THREE.BoxGeometry(w, 0.0009, d)
    g.rotateY(rng() * Math.PI)
    g.translate(-0.14 + rng() * 0.09, 0.0005, -0.19 + rng() * 0.09)
    scrapGeoms.push(g)
  }
  const scraps = new THREE.Mesh(track(mergeGeometries(scrapGeoms, false)!), mats.board)
  scraps.receiveShadow = true
  group.add(scraps)
  for (const g of scrapGeoms) g.dispose()

  // 治具（紙を押さえる金属定規）。当たる面だけ擦れている。
  const jig = new THREE.Mesh(track(new THREE.BoxGeometry(0.155, 0.005, 0.022)), mats.metal)
  jig.position.set(0.065, 0.0025, 0.155)
  jig.rotation.y = -0.62
  jig.castShadow = true
  jig.receiveShadow = true
  group.add(jig)

  // ---- 照明 -------------------------------------------------------------
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.3)
  sun.position.set(-1.02, 1.5, 1.55)
  sun.target.position.set(0, 0.12, 0)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.near = 0.5
  sun.shadow.camera.far = 4.2
  sun.shadow.camera.left = -0.7
  sun.shadow.camera.right = 0.7
  sun.shadow.camera.top = 0.7
  sun.shadow.camera.bottom = -0.5
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.0012
  // left/right/top/bottom/near/far を変えたら投影行列を作り直す必要がある
  sun.shadow.camera.updateProjectionMatrix()
  group.add(sun, sun.target)

  const fill = new THREE.HemisphereLight(0xd9e6ef, 0x6b5a45, 0.55)
  group.add(fill)

  // 手前からの弱い返し光。窓が奥にあるので、これが無いと紙の手前側が暗く沈む。
  const bounce = new THREE.DirectionalLight(0xf2e6d2, 1.05)
  bounce.position.set(-0.5, 0.55, -1.5)
  bounce.target.position.set(0, 0.12, 0)
  group.add(bounce, bounce.target)

  const lamp = new THREE.PointLight(0xffd9a0, 0.34, 1.9, 2)
  lamp.position.set(0.5, 0.44, -0.34)
  group.add(lamp)

  return {
    group,
    sun,
    lamp,
    background,
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}
