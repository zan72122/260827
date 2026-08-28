import {
  ACESFilmicToneMapping,
  BackSide,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PointLight,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { World, DECK_TOP, MAX_DEPTH, MIN_DEPTH } from './world'
import { U, srgb } from './gfx/shaderlib'
import { buildBoat } from './gfx/boat'
import { Rod } from './gfx/rod'
import { Rig } from './gfx/rig'
import { buildWater } from './gfx/water'
import { FishSchool } from './gfx/fish'
import { Audio } from './audio'
import { clamp, smoothstep } from './util/num'

/** the camera is fixed per act: it never becomes a toy of its own */
const AZIMUTH = (42 * Math.PI) / 180
const CAM_F = new Vector2(Math.cos(AZIMUTH), Math.sin(AZIMUTH))

interface Rig3 {
  dist: number
  y: number
  targetY: number
  fovL: number
  fovP: number
}
const RIGS: Record<number, Rig3> = {
  1: { dist: 1.95, y: 0.76, targetY: 0.08, fovL: 42, fovP: 46 },
  2: { dist: 1.8, y: 0.76, targetY: 0.14, fovL: 40, fovP: 44 },
  3: { dist: 1.5, y: 0.95, targetY: 0.62, fovL: 36, fovP: 48 },
}
const CONFIRM_RIG: Rig3 = { dist: 0.62, y: 0.3, targetY: -0.1, fovL: 40, fovP: 44 }
/** while the reel lifts the rig, the frame opens to include the opening */
const LIFT_RIG: Rig3 = { dist: 1.3, y: 1.15, targetY: 0.58, fovL: 30, fovP: 38 }

const POCKET: Record<number, [number, number, number]> = {
  1: [1.05, 0.85, 1.0],
  2: [0.24, 0.28, 0.24],
  3: [0.0, 0.0, 0.0],
}

// development-only camera and staging overrides; stripped from production builds
const DEV = import.meta.env.DEV ? new URLSearchParams(location.hash.slice(1)) : null
if (DEV) {
  for (const a of [1, 2, 3]) {
    const v = DEV.get('r' + a)
    if (v) {
      const [dist, y, targetY, fov] = v.split(',').map(Number)
      RIGS[a] = { dist, y, targetY, fovL: fov, fovP: fov }
    }
  }
}

const canvas = document.getElementById('stage') as HTMLCanvasElement
const veil = document.getElementById('veil') as HTMLDivElement

const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.outputColorSpace = SRGBColorSpace
renderer.toneMapping = ACESFilmicToneMapping
renderer.toneMappingExposure = 1.25
renderer.shadowMap.enabled = true
renderer.shadowMap.type = PCFSoftShadowMap

const scene = new Scene()
scene.background = new Color(0x0c1114)
const camera = new PerspectiveCamera(38, 1, 0.05, 90)

// ---- lighting: one cold low window, one warm cabin lamp, and their bounce
// the sun sits behind the cabin windows, i.e. on the far side of the section
// placed so its low glancing light glints off the water right at the opening
const winDir = new Vector3(
  -4.2 * CAM_F.x + 0.9 * CAM_F.y,
  1.75,
  -4.2 * CAM_F.y - 0.9 * CAM_F.x
)
const key = new DirectionalLight(srgb(0xc3d3de), 2.6)
key.position.copy(winDir)
key.castShadow = true
key.shadow.mapSize.set(1024, 1024)
key.shadow.camera.near = 0.5
key.shadow.camera.far = 14
key.shadow.camera.left = -2.6
key.shadow.camera.right = 2.6
key.shadow.camera.top = 2.6
key.shadow.camera.bottom = -2.6
key.shadow.bias = -0.0016
key.shadow.normalBias = 0.012
scene.add(key)
scene.add(key.target)

const lampLight = new PointLight(srgb(0xffb877), 1.9, 5.5, 2)
lampLight.position.set(0, DECK_TOP + 1.05, 0)
scene.add(lampLight)

const hemi = new HemisphereLight(srgb(0x64757f), srgb(0x201d19), 0.4)
scene.add(hemi)

// light that has come down through the water: it only ever arrives from above,
// which is why a fish flank flashes silver and its belly does not
const downwell = new DirectionalLight(srgb(0x8ea8b4), 1.5)
downwell.position.set(0.4, 6, 0.6)
scene.add(downwell)

// open sky over the lake, lighting the outside of the hull from the near side
const sky = new DirectionalLight(srgb(0x9fb4c2), 1.25)
sky.position.set(Math.cos(AZIMUTH) * 5, 3.4, Math.sin(AZIMUTH) * 5)
scene.add(sky)

const bounce = new PointLight(srgb(0x93a09c), 0.5, 4.2, 2)
bounce.position.set(Math.cos(AZIMUTH) * 1.1, DECK_TOP + 0.3, Math.sin(AZIMUTH) * 1.1)
scene.add(bounce)

// cold enclosing gloom so nothing ever reads as empty background
const dome = new Mesh(
  new SphereGeometry(38, 16, 12),
  new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
    fragmentShader: `precision highp float; varying vec3 vP;
      void main(){ float h = clamp( vP.y / 38.0 * 0.5 + 0.5, 0.0, 1.0 );
        vec3 c = mix( vec3(0.030,0.038,0.043), vec3(0.135,0.156,0.170), smoothstep(0.42,0.86,h) );
        gl_FragColor = vec4(c,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
)
dome.renderOrder = -5
scene.add(dome)

// ---- the world and everything that draws it
const world = new World()
const boat = buildBoat()
boat.group.rotation.y = -AZIMUTH
scene.add(boat.group)
const rod = new Rod()
boat.tilt.add(rod.group)
const rig = new Rig()
scene.add(rig.group)
// WebGL 2 is the baseline; where WebGPU exists the device can afford a
// denser shoal and finer suspended matter, so those are raised and nothing else
const TIER = typeof navigator !== 'undefined' && 'gpu' in navigator ? 2 : 1
const water = buildWater(TIER)
scene.add(water.group)
const school = new FishSchool(4, TIER > 1 ? 44 : 24)
scene.add(school.group)

const audio = new Audio()
if (DEV) Object.assign(window as any, { __w: world, __school: school, __cam: camera })

U.uCamF.value.copy(CAM_F)
U.uAxis.value.set(0, 0)
U.uSun.value.copy(winDir).normalize()

// ---- input: one drag controls the rig, one short upward flick sets the hook
interface Touch {
  id: number
  startY: number
  lastY: number
  startT: number
  peakY: number
  startDepth: number
  moved: number
}
let touch: Touch | null = null
let depthPixels = 0
// a hook set is a short, upward, non-returning flick
const STRIKE_MS = DEV && DEV.get('strikems') ? Number(DEV.get('strikems')) : 380

function pxToMetres() {
  return 2.0 / Math.max(320, window.innerHeight)
}

canvas.addEventListener('pointerdown', (e) => {
  if (!world.started) begin()
  try {
    canvas.setPointerCapture(e.pointerId)
  } catch {
    /* capture is a convenience; the gesture still works without it */
  }
  touch = {
    id: e.pointerId,
    startY: e.clientY,
    lastY: e.clientY,
    startT: e.timeStamp,
    peakY: e.clientY,
    startDepth: world.lureRestDepth,
    moved: 0,
  }
  depthPixels = 0
})
canvas.addEventListener('pointermove', (e) => {
  if (!touch || e.pointerId !== touch.id) return
  const dy = e.clientY - touch.startY
  touch.lastY = e.clientY
  touch.peakY = Math.min(touch.peakY, e.clientY)
  touch.moved = Math.max(touch.moved, Math.abs(dy))
  depthPixels = dy
  // drag up = lift the rig, drag down = drop it deeper
  world.dragTo(clamp(touch.startDepth - dy * pxToMetres(), MAX_DEPTH, MIN_DEPTH))
})
function endTouch(e: PointerEvent) {
  if (!touch || e.pointerId !== touch.id) return
  const dt = e.timeStamp - touch.startT
  const net = touch.startY - e.clientY
  const rebound = e.clientY - touch.peakY
  if (DEV) (window as any).__g = { dt, net, rebound, moved: touch.moved }
  if (dt < STRIKE_MS && net > 24 && rebound < 16) {
    world.dragTo(touch.startDepth)
    world.strike()
    audio.strike(world.hooked !== null)
  }
  touch = null
  void depthPixels
}
canvas.addEventListener('pointerup', endTouch)
canvas.addEventListener('pointercancel', endTouch)

function begin() {
  world.started = true
  veil.style.opacity = '0'
  setTimeout(() => veil.remove(), 1000)
  audio.start()
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.suspend()
  else {
    audio.resume()
    last = performance.now()
  }
})

// ---- resize / orientation
let portrait = false
function resize() {
  const w = window.innerWidth
  const h = window.innerHeight
  portrait = h >= w
  const dpr = Math.min(window.devicePixelRatio || 1, quality.dpr)
  renderer.setPixelRatio(dpr)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  updateScales()
}
window.addEventListener('resize', resize)
window.addEventListener('orientationchange', () => setTimeout(resize, 120))

function updateScales() {
  const h = window.innerHeight
  const dpr = renderer.getPixelRatio()
  const half = Math.tan((camera.fov * Math.PI) / 360)
  rig.setPixelScale((2 * half) / (h * dpr))
  water.snowMat.uniforms.uPxScale.value = (h * dpr) / (2 * half)
}

// ---- adaptive quality: keep the loop alive before keeping it pretty
const quality = { dpr: Math.min(window.devicePixelRatio || 1, 2), frames: 0, acc: 0 }
function adapt(dt: number) {
  quality.acc += dt
  quality.frames++
  if (quality.frames < 90) return
  const avg = quality.acc / quality.frames
  quality.frames = 0
  quality.acc = 0
  if (avg > 0.028 && quality.dpr > 1) {
    quality.dpr = Math.max(1, quality.dpr - 0.35)
    resize()
  } else if (avg > 0.05) {
    renderer.shadowMap.enabled = false
  }
}

// ---- camera director
const camPos = new Vector3()
const camTarget = new Vector3()
let camFov = 38
function rigPos(r: Rig3, out: Vector3) {
  return out.set(CAM_F.x * r.dist, r.y, CAM_F.y * r.dist)
}
const tmpPos = new Vector3()
const tmpPos2 = new Vector3()
{
  const r = RIGS[1]
  rigPos(r, camPos)
  camTarget.set(0, r.targetY, 0)
  camFov = r.fovL
}

let lift = 0
function updateCamera(dt: number) {
  const r = RIGS[world.act]
  rigPos(r, tmpPos)
  let ty = r.targetY
  let fov = portrait ? r.fovP : r.fovL
  // follow the rig up when the reel runs, so the fish arrives inside the frame
  const wantLift = world.reelState === 'winding' || world.reelState === 'showing' ? 1 : 0
  lift += (wantLift - lift) * (1 - Math.exp(-2.2 * dt))
  if (lift > 0.002) {
    rigPos(LIFT_RIG, tmpPos2)
    tmpPos.lerp(tmpPos2, lift)
    ty += (LIFT_RIG.targetY - ty) * lift
    fov += ((portrait ? LIFT_RIG.fovP : LIFT_RIG.fovL) - fov) * lift
  }
  // confirmation: ride down the line, look at what was actually there, come back
  const ct = world.confirmTimer
  const dive =
    world.confirm > 0.02 ? clamp(smoothstep(0.12, 1.0, ct) - smoothstep(2.5, 3.4, ct), 0, 1) : 0
  if (dive > 0) {
    rigPos(CONFIRM_RIG, tmpPos2)
    tmpPos2.y = CONFIRM_RIG.y + world.lurePosition.y
    tmpPos.lerp(tmpPos2, dive)
    ty = ty + (world.lurePosition.y + CONFIRM_RIG.targetY - ty) * dive
    fov = fov + ((portrait ? CONFIRM_RIG.fovP : CONFIRM_RIG.fovL) - fov) * dive
  }
  const k = 1 - Math.exp(-2.6 * dt)
  camPos.lerp(tmpPos, k)
  camTarget.y += (ty - camTarget.y) * k
  camFov += (fov - camFov) * k
  camera.position.copy(camPos)
  camera.lookAt(camTarget)
  if (Math.abs(camera.fov - camFov) > 0.01) {
    camera.fov = camFov
    camera.updateProjectionMatrix()
    updateScales()
  }
}

// ---- main loop
const tipWorld = new Vector3()
const spoolWorld = new Vector3()
const guidesWorld = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
let last = performance.now()
let prevReel = world.reelState
let prevContact = 0

function frame(now: number) {
  requestAnimationFrame(frame)
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  adapt(dt)

  if (DEV) {
    const a = Number(DEV.get('act') || 0)
    if (a) world.act = a as 1 | 2 | 3
  }
  // fixed sub-steps keep the rod and the fish behaving the same on any device
  let rest = dt
  while (rest > 1e-5) {
    const h = Math.min(1 / 120, rest)
    world.step(h)
    rest -= h
  }

  // hull roll moves the whole boat: deck, opening, rod, hanging lamp
  boat.tilt.rotation.x = world.boatSway
  boat.tilt.rotation.z = world.boatSway * 0.34
  boat.tilt.position.y = world.boatSway * 0.14
  boat.lamp.rotation.x = -world.boatSway * 2.3
  boat.lamp.rotation.z = -world.boatSway * 0.8

  rod.update(world.rodTipDeflection.y, world.reelSpin)
  boat.group.updateMatrixWorld(true)
  tipWorld.copy(rod.tipLocal)
  boat.tilt.localToWorld(tipWorld)
  for (let i = 0; i < 4; i++) {
    guidesWorld[i].copy(rod.guideLocal[i])
    boat.tilt.localToWorld(guidesWorld[i])
  }
  spoolWorld.copy(rod.guideLocal[0]).setY(rod.guideLocal[0].y - 0.03)
  boat.tilt.localToWorld(spoolWorld)

  rig.update(world, spoolWorld, guidesWorld, tipWorld)
  rig.targetBait(world.baitPos)
  school.update(world, dt)

  updateCamera(dt)

  // one shared description of the medium for every material
  U.uTime.value = world.time
  U.uCamPos.value.copy(camera.position)
  U.uCutDeck.value = world.cutawayVisibility.deck
  U.uCutSurface.value = world.cutawayVisibility.surface
  U.uPocket.value = world.cutawayVisibility.pocket
  if (DEV) {
    const c = DEV.get('cut')
    if (c) {
      const [a, b, cc] = c.split(',').map(Number)
      U.uCutDeck.value = a
      U.uCutSurface.value = b
      U.uPocket.value = cc
    }
  }
  U.uPocketC.value.set(world.baitPos.x, world.baitPos.y + 0.05, world.baitPos.z)
  const pr = POCKET[world.act]
  const prv = U.uPocketR.value as Vector3
  const grow = world.confirm > 0.02 ? 1 + world.confirm * 2.4 : 1
  prv.set(pr[0] * grow, pr[1] * grow, pr[2] * grow)
  U.uRipple.value.set(world.ripple.amp, world.ripple.t)
  ;(water.surface.material as ShaderMaterial).uniforms.uSurfaceBreak.value = world.surfaceBreak

  boat.lamp.getWorldPosition(lampLight.position)
  lampLight.position.y -= 0.28
  ;(water.surface.material as ShaderMaterial).uniforms.uLampPos.value.copy(lampLight.position)
  key.target.position.set(0, 0.1, 0)

  // sound follows the same state, never its own timeline
  if (world.fishContact > 0.5 && prevContact <= 0.5) {
    audio.contact(0.8, 0.05 + Math.abs(world.lurePosition.y) / 6)
  }
  prevContact = world.fishContact
  if (world.reelState !== prevReel) {
    audio.reel(world.reelState === 'winding')
    if (world.reelState === 'showing') audio.splash()
    prevReel = world.reelState
  }

  renderer.render(scene, camera)
}

resize()
requestAnimationFrame(frame)
