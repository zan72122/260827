import * as THREE from 'three'
import { R_INNER, R_OUTER } from './core/profile'
import {
  JIG_TOP,
  PIVOT_R,
  RING_TOP,
  SAW_CARRIAGE_END,
  SAW_CARRIAGE_PARK,
  SAW_CARRIAGE_START,
  SAW_TILT_PARK,
  SAW_LEAD,
  SAW_RAIL_SIDE,
  SLIDE_MAX,
  SLIDE_TURN_UNLOCK,
  TRAY_TOP,
} from './core/layout'
import { THETA1, type Quality } from './core/blank'
import { BlankView } from './scene/blankView'
import { makeWorkshop } from './scene/workshop'
import { Saw } from './scene/tool'
import { makeEnvironment, makeLights } from './scene/env'
import { CameraRig, type ShotSpec } from './game/camera'
import { GameState, clamp, NO_CUT } from './game/state'
import { Sfx } from './audio/sfx'
import { DiagText, makeDiagnostics } from './debug/overlay'

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search)
const DEBUG = params.has('debug')
const ORBIT = params.has('orbit')
const PLAIN = params.has('plain')

const app = document.getElementById('app') as HTMLDivElement
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
})
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.12
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(PLAIN ? 0x2b2620 : 0x241c15)
scene.environment = makeEnvironment(renderer)
scene.environmentIntensity = 0.45

let quality: Quality = 'high'
const lights = makeLights(2048)
scene.add(lights.group)

const workshop = makeWorkshop()
if (!PLAIN) scene.add(workshop.root)
else {
  // A bare turntable: just enough surface to read contact and shadow.
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.62, 0.02, 64),
    new THREE.MeshStandardMaterial({ color: 0x6f6a62, roughness: 0.95 }),
  )
  pad.position.y = JIG_TOP - 0.01
  pad.receiveShadow = true
  scene.add(pad)
}

const blank = new BlankView(quality)
scene.add(blank.root)

const saw = new Saw()
if (!PLAIN) scene.add(saw.root)

const diagnostics = makeDiagnostics()
scene.add(diagnostics)
diagnostics.visible = DEBUG

const camera = new THREE.PerspectiveCamera(52, 1, 0.02, 12)
const rig = new CameraRig(camera)

const state = new GameState()
const sfx = new Sfx()
const diag = new DiagText()
diag.show(DEBUG)

// ---------------------------------------------------------------------------
// hint: a soft warm pool of light on the bench under whatever to touch next
// ---------------------------------------------------------------------------

function radialTexture() {
  const N = 64
  const d = new Uint8Array(N * N * 4)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N - 0.5
      const v = (y + 0.5) / N - 0.5
      const r = Math.hypot(u, v) * 2
      const a = Math.max(0, 1 - r)
      const s = a * a * (3 - 2 * a)
      const i = (y * N + x) * 4
      d[i] = 255
      d[i + 1] = 244
      d[i + 2] = 214
      d[i + 3] = Math.round(255 * s)
    }
  }
  const t = new THREE.DataTexture(d, N, N)
  t.needsUpdate = true
  return t
}
const hint = new THREE.Mesh(
  new THREE.PlaneGeometry(0.17, 0.17),
  new THREE.MeshBasicMaterial({
    map: radialTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0,
  }),
)
hint.rotation.x = -Math.PI / 2
scene.add(hint)

// ---------------------------------------------------------------------------
// shots
// ---------------------------------------------------------------------------

const _v = new THREE.Vector3()
const ringBoxPts: THREE.Vector3[] = []
for (const sx of [-1, 1])
  for (const sz of [-1, 1])
    for (const sy of [0, 1])
      ringBoxPts.push(
        new THREE.Vector3(sx * R_OUTER, sy ? RING_TOP : JIG_TOP, sz * R_OUTER),
      )

function isPortrait() {
  return renderer.domElement.clientHeight >= renderer.domElement.clientWidth
}

/** Azimuth is the whole composition rule:
 *    portrait  ~7 deg  -> ring far/up, wedge near/down, and the sawn face is
 *                         almost edge-on until the child turns it
 *    landscape ~42 deg -> ring left, wedge right, so the two can be compared
 *  The turn always ends with the face square to the camera, because the
 *  target yaw is derived from the azimuth. */
const azimuth = () => (isPortrait() ? 7 : 42)

/** The points a shot must keep on screen.  Framing on the whole 410 mm ring
 *  every time would shrink the 100 mm blank to a thumbnail, so later shots
 *  frame on the wedge plus the part of the ring that proves where it came
 *  from: the notch it left behind. */
function focusPoints(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  const pb = blank.pieceBox()
  for (const sx of [pb.min.x, pb.max.x])
    for (const sy of [pb.min.y, pb.max.y])
      for (const sz of [pb.min.z, pb.max.z]) pts.push(new THREE.Vector3(sx, sy, sz))
  return pts
}

function ringPoints(x0: number, x1: number, zHalf: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  for (const x of [x0, x1])
    for (const z of [-zHalf, zHalf])
      for (const y of [JIG_TOP, RING_TOP]) out.push(new THREE.Vector3(x, y, z))
  return out
}

function shotFor(): { shot: ShotSpec; pts: THREE.Vector3[] } {
  const p = isPortrait()
  const az = azimuth()
  switch (state.phase) {
    case 'title':
    case 'cut':
    case 'reset': {
      // The whole ring, the tool, and where the blade is going.  During a
      // reset the blank is off the bench, so it is deliberately left out of
      // the framing: the camera holds still and the new blank arrives into it.
      const pts = ringBoxPts.concat(state.phase === 'reset' ? [] : focusPoints())
      pts.push(saw.handleWorld(_v.clone()))
      pts.push(
        new THREE.Vector3(
          state.bladeR * Math.cos(THETA1),
          JIG_TOP,
          state.bladeR * Math.sin(THETA1),
        ),
      )
      return {
        shot: {
          target: new THREE.Vector3(0.08, 0.055, 0),
          azimuthDeg: az,
          elevationDeg: p ? 46 : 42,
          pad: 0.03,
        },
        pts,
      }
    }
    case 'pull':
      // the gap opening between the ring and the wedge is the whole point here
      return {
        shot: {
          target: new THREE.Vector3(0.14, 0.05, 0),
          azimuthDeg: az,
          elevationDeg: p ? 40 : 37,
          pad: 0.03,
        },
        pts: ringPoints(-0.10, R_OUTER, 0.15).concat(focusPoints()),
      }
    case 'turn':
      return {
        shot: {
          target: new THREE.Vector3(0.19, 0.05, 0),
          azimuthDeg: az,
          elevationDeg: p ? 31 : 27,
          pad: 0.03,
        },
        pts: ringPoints(-0.02, R_OUTER, 0.11).concat(focusPoints()),
      }
    default:
      // Low enough that the blank reads as a side view, high enough that the
      // ring sits above it on screen rather than behind it: the finished blank
      // is seen against plain bench, with its own notch still in shot.
      return {
        shot: {
          target: new THREE.Vector3(0.21, 0.050, 0),
          azimuthDeg: az,
          elevationDeg: p ? 27 : 24,
          pad: 0.04,
        },
        pts: ringPoints(-0.02, R_OUTER, 0.10).concat(focusPoints()),
      }
  }
}

// ---------------------------------------------------------------------------
// input: one finger, pointer capture, safe cancel
// ---------------------------------------------------------------------------

type DragMode = 'saw' | 'slide' | 'turn'
type Drag = {
  id: number
  mode: DragMode
  planeY: number
  grabOffset: number
  last: THREE.Vector2
}
let drag: Drag | null = null
let touched = false

const ray = new THREE.Raycaster()
const ndc = new THREE.Vector2()
const railDir = new THREE.Vector3(Math.cos(THETA1), 0, Math.sin(THETA1))
const railOrigin = new THREE.Vector3(
  -Math.sin(THETA1) * SAW_RAIL_SIDE,
  0,
  Math.cos(THETA1) * SAW_RAIL_SIDE,
)

function setNdc(e: PointerEvent) {
  const r = renderer.domElement.getBoundingClientRect()
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
}

/** Where the pointer ray meets the horizontal plane y = h. */
function planeHit(h: number, out = new THREE.Vector3()) {
  ray.setFromCamera(ndc, camera)
  const o = ray.ray.origin
  const d = ray.ray.direction
  if (Math.abs(d.y) < 1e-6) return null
  const t = (h - o.y) / d.y
  if (t <= 0) return null
  return out.copy(o).addScaledVector(d, t)
}

const _hit = new THREE.Vector3()
const _pivot = new THREE.Vector3()

function onDown(e: PointerEvent) {
  if (drag || state.phase === 'title' || state.phase === 'reset') return
  setNdc(e)
  ray.setFromCamera(ndc, camera)
  touched = true
  sfx.unlock()

  if (state.phase === 'cut') {
    const hits = ray.intersectObject(saw.grab, true)
    if (!hits.length) return
    const h = planeHit(saw.handleWorld(_v).y, _hit)
    if (!h) return
    drag = {
      id: e.pointerId,
      mode: 'saw',
      planeY: _v.y,
      grabOffset: state.carriage - h.clone().sub(railOrigin).dot(railDir),
      last: new THREE.Vector2(e.clientX, e.clientY),
    }
  } else if (state.phase === 'pull' || state.phase === 'turn') {
    const hits = ray.intersectObjects([...blank.pieceMeshes, pieceGrab], true)
    if (!hits.length) return
    const y = clamp(hits[0].point.y, JIG_TOP + 0.004, JIG_TOP + 0.030)
    const h = planeHit(y, _hit)
    if (!h) return
    if (state.phase === 'pull') {
      drag = {
        id: e.pointerId,
        mode: 'slide',
        planeY: y,
        grabOffset: state.slide - h.x,
        last: new THREE.Vector2(e.clientX, e.clientY),
      }
    } else {
      drag = {
        id: e.pointerId,
        mode: 'turn',
        planeY: y,
        grabOffset: 0,
        last: new THREE.Vector2(h.x, h.z),
      }
    }
  }
  if (drag) {
    try {
      renderer.domElement.setPointerCapture(e.pointerId)
    } catch {
      /* capture is best effort */
    }
  }
}

function onMove(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return
  setNdc(e)
  const h = planeHit(drag.planeY, _hit)
  if (!h) return
  if (drag.mode === 'saw') {
    const along = h.clone().sub(railOrigin).dot(railDir)
    state.setCarriage(along + drag.grabOffset, lastDt)
  } else if (drag.mode === 'slide') {
    state.setSlide(h.x + drag.grabOffset)
  } else {
    // Tangential drag around the wedge's own axis; the effective radius is
    // clamped so grabbing near the middle does not spin it wildly.
    _pivot.set(PIVOT_R + state.slide, drag.planeY, 0)
    const vx = drag.last.x - _pivot.x
    const vz = drag.last.y - _pivot.z
    const R = Math.max(Math.hypot(vx, vz), 0.065)
    const tx = -vz / R
    const tz = vx / R
    const dPsi = -((h.x - drag.last.x) * tx + (h.z - drag.last.y) * tz) / R
    state.setYaw(state.yaw + dPsi)
    drag.last.set(h.x, h.z)
  }
}

function endDrag(e?: PointerEvent) {
  if (!drag) return
  if (e) {
    try {
      renderer.domElement.releasePointerCapture(drag.id)
    } catch {
      /* already released */
    }
  }
  drag = null
  sfx.quiet()
}

const el = renderer.domElement
el.addEventListener('pointerdown', onDown)
el.addEventListener('pointermove', onMove)
el.addEventListener('pointerup', endDrag)
el.addEventListener('pointercancel', endDrag)
el.addEventListener('lostpointercapture', () => endDrag())
el.addEventListener('contextmenu', (e) => e.preventDefault())

/** A generous invisible handle around the lower half of the wedge. */
const pieceGrab = new THREE.Mesh(
  new THREE.BoxGeometry(0.14, 0.055, 0.10),
  new THREE.MeshBasicMaterial({ visible: false }),
)
scene.add(pieceGrab)

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const titleEl = document.getElementById('title') as HTMLDivElement
const startEl = document.getElementById('start') as HTMLButtonElement
const replayEl = document.getElementById('replay') as HTMLButtonElement
const muteEl = document.getElementById('mute') as HTMLButtonElement

startEl.addEventListener('click', () => {
  titleEl.style.display = 'none'
  state.phase = 'cut'
  state.t = 0
  sfx.unlock()
})
if (PLAIN || params.has('auto')) {
  titleEl.style.display = 'none'
  state.phase = 'cut'
}

replayEl.addEventListener('click', () => {
  if (state.phase !== 'done') return
  state.phase = 'reset'
  state.resetT = 0
  state.t = 0
  replayEl.style.display = 'none'
})
muteEl.addEventListener('click', () => {
  sfx.setMuted(!sfx.muted)
  muteEl.textContent = sfx.muted ? '🔇' : '🔊'
})

// ---------------------------------------------------------------------------
// resize / orientation
// ---------------------------------------------------------------------------

function resize() {
  const w = app.clientWidth
  const h = app.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / Math.max(1, h)
  camera.fov = h > w ? 60 : 48
  camera.updateProjectionMatrix()
  // A rotation mid-drag must not teleport the tool or the wedge: end the
  // gesture cleanly and keep every bit of state.
  endDrag()
  state.yawTarget = Math.PI / 2 - (azimuth() * Math.PI) / 180
  state.yaw = Math.min(state.yaw, state.yawTarget)
}
addEventListener('resize', resize)
addEventListener('orientationchange', resize)
resize()
rig.snap()

// ---------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------

let prev = performance.now()
let lastDt = 1 / 60
let slowFrames = 0
let settleFrom = 0
let sawTilt = 0
const stageOffset = new THREE.Vector3()

function frame(now: number) {
  const dt = Math.min(0.05, (now - prev) / 1000)
  prev = now
  lastDt = dt
  diag.frame(dt)

  step(dt)
  renderer.render(scene, camera)

  // adaptive quality, once, after things have settled
  if (state.phase !== 'title' && diag.fps > 0 && diag.fps < 40) {
    if (++slowFrames > 90 && quality === 'high') {
      quality = 'low'
      blank.setQuality('low')
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.35))
      lights.window.shadow.mapSize.set(1024, 1024)
      lights.window.shadow.map?.dispose()
      lights.window.shadow.map = null as never
    }
  } else slowFrames = Math.max(0, slowFrames - 1)

  requestAnimationFrame(frame)
}

function step(dt: number) {
  state.tick(dt)

  if (state.justParted) sfx.release()

  // ---- reset: the notched ring and the lamb are carried off, a freshly
  // prepared blank is brought in.  No rewinding of the cut. -----------------
  if (state.phase === 'reset') {
    state.resetT += dt / 0.6
    const t = state.resetT
    const carry = (u: number) => stageOffset.set(-1.45 * u, 0.055 * Math.sin(Math.PI * u), -0.30 * u)
    if (t < 1) {
      carry(ease(t)) // the finished blank and the notched ring are taken away
    } else if (t < 2) {
      if (state.cut !== NO_CUT) {
        // Out of shot, a freshly prepared blank is put on the jig.  The cut is
        // never played backwards and the lamb is never glued back in.
        state.reset()
        state.plays++
        settleFrom = 0
        prevSlide = 0
        sawTilt = 0
        blank.setCut(NO_CUT)
      }
      carry(1 - ease(t - 1))
    } else {
      stageOffset.set(0, 0, 0)
      state.phase = 'cut'
      state.t = 0
      touched = false
      sfx.tock(0.8)
    }
  }

  // ---- the saw is drawn back out of the kerf once the wedge is parted -----
  // The craftsman withdraws the saw before lifting the piece out; until it is
  // clear the bench is cluttered and the child cannot see what they have made.
  if (state.parted && drag?.mode !== 'saw') {
    state.carriage = Math.min(SAW_CARRIAGE_PARK, state.carriage + dt * 0.42)
    sawTilt = Math.min(SAW_TILT_PARK, sawTilt + dt * 1.9)
  } else if (!state.parted) {
    sawTilt = 0
  }

  // ---- the wedge settles onto the table once it is clear ------------------
  if (state.phase === 'turn' && state.slide < SLIDE_MAX && !drag) {
    if (settleFrom === 0) settleFrom = state.slide
    const next = Math.min(SLIDE_MAX, state.slide + dt * 0.16)
    state.slide = next
    if (next >= SLIDE_MAX - 1e-4 && settleFrom !== -1) {
      settleFrom = -1
      sfx.tock(0.7)
    }
  }

  // ---- turning snaps home when it is nearly square ------------------------
  if (state.phase === 'turn' && !drag && state.yaw > state.yawTarget * 0.86) {
    state.yaw = Math.min(state.yawTarget, state.yaw + dt * 2.2)
    if (state.yaw >= state.yawTarget - 1e-3) {
      state.yaw = state.yawTarget
      state.phase = 'done'
      state.t = 0
      sfx.tock(0.55)
    }
  }

  // ---- push state into the scene ------------------------------------------
  blank.setCut(state.cut)
  blank.setPiecePose(state.slide, state.yaw)
  saw.setPose(state.carriage, sawTilt)
  blank.root.position.copy(stageOffset)
  saw.root.position.copy(stageOffset)
  workshop.root.position.set(0, 0, 0)

  // grab volume follows the lower part of the wedge
  const pb = blank.pieceBox()
  // Deliberately low: the finger works near the table, so it never sits on
  // the head and back that carry the animal's outline.
  pieceGrab.position.set(
    (pb.min.x + pb.max.x) / 2,
    JIG_TOP + 0.023,
    (pb.min.z + pb.max.z) / 2,
  )
  pieceGrab.scale.set(
    Math.max(1, (pb.max.x - pb.min.x) / 0.14 + 0.35),
    1,
    Math.max(1, (pb.max.z - pb.min.z) / 0.10 + 0.35),
  )

  // ---- sound tied to real contact -----------------------------------------
  const vSlide = Math.abs(slideSpeed(dt))
  sfx.saw(drag?.mode === 'saw' ? state.cutSpeed : 0)
  sfx.slide(drag?.mode === 'slide' ? vSlide : 0)

  // ---- hint ----------------------------------------------------------------
  const wantHint = !PLAIN && !touched && (state.phase === 'cut' || state.phase === 'pull')
  const hm = hint.material as THREE.MeshBasicMaterial
  const pulse = 0.11 + 0.06 * Math.sin(state.t * 3.1)
  hm.opacity += ((wantHint ? pulse : 0) - hm.opacity) * Math.min(1, dt * 5)
  if (state.phase === 'cut') {
    saw.handleWorld(_v)
    hint.position.set(_v.x, TRAY_TOP + 0.0015, _v.z)
  } else {
    hint.position.set((pb.min.x + pb.max.x) / 2, TRAY_TOP + 0.0015, 0)
  }
  hint.visible = hm.opacity > 0.005

  // ---- camera ---------------------------------------------------------------
  if (!ORBIT) {
    const { shot, pts } = shotFor()
    rig.update(shot, pts, dt)
  }

  // ---- replay button --------------------------------------------------------
  replayEl.style.display = state.phase === 'done' && state.t > 0.9 ? 'flex' : 'none'

  if (DEBUG) {
    diag.set([
      `phase   ${state.phase}   plays ${state.plays}`,
      `cut     ${state.cut === NO_CUT ? '-' : state.cut.toFixed(4)}  (${(state.cutProgress * 100).toFixed(0)}%)`,
      `blade   ${state.bladeR.toFixed(4)}   carriage ${state.carriage.toFixed(4)}`,
      `parted  ${state.parted}   clear ${state.clear}`,
      `slide   ${state.slide.toFixed(4)} / ${SLIDE_MAX}`,
      `yaw     ${((state.yaw * 180) / Math.PI).toFixed(1)} / ${((state.yawTarget * 180) / Math.PI).toFixed(1)}`,
      `tris    ${blank.triangleCount()}   q=${quality}`,
      `fps     ${diag.fps.toFixed(1)}   worst ${(diag.worstFrame * 1000).toFixed(1)}ms`,
      `az      ${azimuth()}  ${isPortrait() ? 'portrait' : 'landscape'}`,
    ])
  }
}

let prevSlide = 0
function slideSpeed(dt: number) {
  const v = (state.slide - prevSlide) / Math.max(dt, 1e-4)
  prevSlide = state.slide
  return v
}

const ease = (t: number) => {
  const u = clamp(t, 0, 1)
  return u * u * (3 - 2 * u)
}

requestAnimationFrame(frame)

// ---------------------------------------------------------------------------
// test hooks: used by the screenshot / soak scripts, never by the game
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __reifen?: Record<string, unknown>
  }
}
window.__reifen = {
  state,
  blank,
  saw,
  camera,
  renderer,
  scene,
  setCarriage: (r: number) => state.setCarriage(r, 1 / 60),
  setSlide: (s: number) => state.setSlide(s),
  setYaw: (y: number) => state.setYaw(y),
  snap: () => rig.snap(),
  phase: () => state.phase,
  fps: () => diag.fps,
  constants: {
    R_INNER,
    R_OUTER,
    PIVOT_R,
    SAW_CARRIAGE_START,
    SAW_CARRIAGE_END,
    SAW_CARRIAGE_PARK,
    SAW_LEAD,
    SLIDE_MAX,
    SLIDE_TURN_UNLOCK,
    JIG_TOP,
  },
  replay: () => {
    if (state.phase !== 'done') return false
    state.phase = 'reset'
    state.resetT = 0
    state.t = 0
    return true
  },
  info: () => ({
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  }),
  hideWorkshop: (h: boolean) => {
    workshop.root.visible = !h
    saw.root.visible = !h
  },
  diagnostics: (v: boolean) => {
    diagnostics.visible = v
  },
}
