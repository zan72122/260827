/**
 * はじめて音になる、オルゴール工房
 *
 * 起動した瞬間から机の上に未調整のメカがあり、保持ねじは緩んでいます。
 * 調整つまみで櫛歯をシリンダーへ近づけ、試し回しハンドルで確かめ、
 * 噛み合ったら固定ねじを締める。それだけの作品です。
 */

import * as THREE from 'three'
import { COMB, EXAGGERATIONS, JIG, MESH } from './core/spec.ts'
import {
  isAudibleRelease,
  releaseLoudness,
  stepPasses,
  toothDeflections,
} from './core/mechanics.ts'
import { SONG_PINS, TOOTH_HZ } from './core/song.ts'
import { Workshop } from './core/state.ts'
import { AudioEngine } from './audio/engine.ts'
import { buildStage } from './view/scene.ts'
import { Controls } from './input/controls.ts'
import { U_RADIAL } from './view/mechanism.ts'
import { TOOL_GRIP_Y } from './view/jigs.ts'

const canvas = document.getElementById('view') as HTMLCanvasElement
const overlay = document.getElementById('app') as HTMLElement
const hintEl = document.getElementById('hint') as HTMLElement
const demoEl = document.getElementById('demo') as HTMLElement
const pulseEl = document.getElementById('pulse') as HTMLElement
const muteBtn = document.getElementById('mute') as HTMLButtonElement
const againBtn = document.getElementById('again') as HTMLButtonElement

const shop = new Workshop()
shop.loadPersisted()
const audio = new AudioEngine()
const stage = buildStage(canvas, SONG_PINS)

const deflect = new Float32Array(COMB.teeth)
const shimmerAmp = new Float32Array(COMB.teeth)
const shimmerAge = new Float32Array(COMB.teeth)

let demoShown = false
let hintHidden = false
// 起動直後だけ少し引いた位置から始め、切り替えではなく連続した寄りで
// ピンと歯の隙間が見える斜め側面へ近づく。操作は最初のフレームから効く。
let revealT = shop.screwsTight ? 1 : 0.3
let lastTime = performance.now()
let toolTwist = 0
let frameCount = 0
let activeScrew = 0

// ---- 画面サイズ ------------------------------------------------------------
function resize(): void {
  const w = Math.max(1, Math.round(overlay.clientWidth))
  const h = Math.max(1, Math.round(overlay.clientHeight))
  // 通常 DPR 上限 1.5。負荷が高い端末でも接触点の形は削らない。
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  stage.setSize(w, h, dpr)
}
window.addEventListener('resize', resize)
window.addEventListener('orientationchange', () => window.setTimeout(resize, 60))
resize()

// ---- 操作 ------------------------------------------------------------------
const v3a = new THREE.Vector3()
const v3b = new THREE.Vector3()
const v2a = new THREE.Vector2()
const v2b = new THREE.Vector2()
const knobAxisWorld = new THREE.Vector3()
const grabDir = new THREE.Vector3()

/** ドラムを「正の向き (= 櫛が近づく向き)」に転がしたときの画面上の向きと倍率。 */
function knobScreenAxis(): { dir: THREE.Vector2; pxPerTravelMm: number } {
  const a = U_RADIAL
  grabDir.copy(stage.camera.position).sub(stage.jigs.knobCentre)
  grabDir.addScaledVector(a, -grabDir.dot(a)).normalize()
  // travel が増えるとドラムは -a まわりに回る (setKnob と同じ符号)
  knobAxisWorld.crossVectors(a, grabDir).negate().normalize()
  stage.project(stage.jigs.knobCentre, v2a)
  stage.project(v3a.copy(stage.jigs.knobCentre).addScaledVector(knobAxisWorld, 1), v2b)
  const dir = v2b.clone().sub(v2a)
  const pxPerMm = dir.length()
  dir.normalize()
  return { dir, pxPerTravelMm: pxPerMm * JIG.rimMmPerTravelMm }
}

/** ハンドルを 1 rad 回したとき、画面上で何 rad 回って見えるか (符号つき)。 */
function handleScreenGain(spin: number): number {
  stage.project(stage.jigs.handleCentre, v2a)
  const angleAt = (s: number): number => {
    stage.jigs.handleProbe(s, v3b)
    stage.project(v3b, v2b)
    return Math.atan2(v2b.y - v2a.y, v2b.x - v2a.x)
  }
  const eps = 0.02
  let d = angleAt(spin + eps) - angleAt(spin - eps)
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d / (2 * eps)
}

let knobAxis = knobScreenAxis()

const controls = new Controls(
  overlay,
  (e) => {
    if (e.id === 'knob') {
      if (!shop.knobEnabled) return
      shop.setTravel(shop.travel + e.alongPx / Math.max(1e-3, knobAxis.pxPerTravelMm))
    } else if (e.id === 'handle') {
      const gain = handleScreenGain(shop.theta / JIG.handleToCylinder)
      if (Math.abs(gain) < 1e-4) return
      const spinDelta = -e.turn / gain
      const res = shop.advanceTarget(spinDelta * JIG.handleToCylinder)
      if (res.blocked > 0 && shop.ratchetLoad > (Math.PI * 2) / JIG.ratchetTeeth) {
        shop.ratchetLoad = 0
        audio.ratchet()
      }
    } else {
      // 工具: 画面上の時計回りが締める向き。
      const screwTurn = -e.turn
      toolTwist -= screwTurn
      if (screwTurn > 0 && shop.screws[activeScrew] !== undefined) {
        const need = (JIG.screwTightenDeg * Math.PI) / 180
        const p = Math.min(1, (shop.screws[activeScrew] ?? 0) + screwTurn / need)
        shop.screws[activeScrew] = p
        audio.screw(p)
      }
    }
  },
  () => {
    void audio.start()
    hideHint()
    hideDemo()
  },
  () => {
    /* つかみ替えのたびに何もしない (見た目の変化は毎フレーム反映) */
  },
)

muteBtn.addEventListener('click', () => {
  void audio.start()
  audio.setMuted(!audio.isMuted)
  muteBtn.classList.toggle('muted', audio.isMuted)
})
againBtn.addEventListener('click', () => {
  shop.loosen()
  revealT = 0
  toolTwist = 0
  activeScrew = 0
})

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    audio.suspend()
    shop.persist()
  } else {
    void audio.resume()
    // 音声時計と描画時計のずれを溜めないよう、復帰時に刻みをやり直す。
    lastTime = performance.now()
  }
})
window.addEventListener('pagehide', () => shop.persist())

function hideHint(): void {
  if (hintHidden) return
  hintHidden = true
  hintEl.classList.add('gone')
}
function hideDemo(): void {
  demoEl.classList.remove('show')
}

// ---- 一度だけの、ごく短い非言語の見本 --------------------------------------
window.setTimeout(() => {
  if (demoShown || shop.travel > 0) return
  demoShown = true
  demoEl.classList.add('show')
  window.setTimeout(hideDemo, 2600)
}, 700)

// ---- 毎フレーム ------------------------------------------------------------
let pulseUntil = 0

function frame(now: number): void {
  frameCount++
  const dt = Math.min(0.25, Math.max(0, (now - lastTime) / 1000))
  lastTime = now

  const engagement = shop.engagement
  const [prev, next] = shop.integrate(dt)

  // 通過イベント。角度区間から求めるので、フレームが飛んでも重複も欠落もない。
  const events = stepPasses(prev, next, engagement, SONG_PINS)
  for (const ev of events) {
    const delay = ev.at * dt
    if (ev.kind === 'contact') {
      shop.contactsFelt++
      audio.contact(releaseLoudness(ev.deflection), delay)
    } else {
      if (isAudibleRelease(ev.engagement)) {
        shop.releasesHeard++
        shop.sawFirstNote = true
        if (shop.phase === 'play') shop.notesSincePlay++
        audio.release(ev.tooth, releaseLoudness(ev.deflection), delay)
        const t = ev.tooth
        shimmerAmp[t] = Math.min(ev.deflection, EXAGGERATIONS.releaseShimmerAmplitude)
        shimmerAge[t] = 0
        pulseUntil = now + 180
      }
    }
  }

  // 歯のたわみ。接触中は保持され、解放後は微細なブレだけが残る。
  toothDeflections(shop.theta, engagement, SONG_PINS, deflect)
  for (let t = 0; t < COMB.teeth; t++) {
    const amp = shimmerAmp[t] ?? 0
    if (amp > 1e-5) {
      shimmerAge[t] = (shimmerAge[t] ?? 0) + dt
      const age = shimmerAge[t] ?? 0
      const env = Math.exp(-age / EXAGGERATIONS.releaseShimmerDecaySec)
      if (env < 0.02) {
        shimmerAmp[t] = 0
      } else {
        // 実際の音の周波数のまま揺らす。描画では時間平均のにじみとして見える。
        deflect[t] = (deflect[t] ?? 0) + amp * env * Math.sin(2 * Math.PI * (TOOTH_HZ[t] ?? 440) * age)
      }
    }
  }

  shop.refreshPhase()
  stage.mechanism.setRotation(shop.theta)
  stage.mechanism.setEngagement(engagement)
  stage.mechanism.setDeflections(deflect)
  stage.jigs.setKnob(shop.travel)
  stage.jigs.setHandle(shop.theta)
  for (let i = 0; i < shop.screws.length; i++) stage.mechanism.setScrew(i, shop.screws[i] ?? 0)

  // 工具は、噛み合って一音が出てから、締め終わるまで出る。
  // 締める順番は、いま画面に見えているねじから。
  activeScrew = pickReachableScrew()
  const showTool = shop.phase === 'fasten' && activeScrew >= 0
  stage.jigs.setToolAt(showTool ? (stage.mechanism.screwHeads[activeScrew] ?? null) : null, toolTwist)

  // 完成後は、まず作業構図のまま数音聴かせてから、少しだけ引く。
  const wantReveal = shop.phase === 'play' && shop.notesSincePlay >= 5 ? 1 : 0
  revealT += (wantReveal - revealT) * Math.min(1, dt * (revealT > wantReveal ? 1.5 : 0.9))
  stage.setReveal(revealT)
  againBtn.hidden = shop.phase !== 'play'

  updateTargets()
  updateOverlay(now)

  stage.renderer.render(stage.scene, stage.camera)
  requestAnimationFrame(frame)
}

/** まだ締まっていないねじのうち、画面に収まっているものを選ぶ。 */
function pickReachableScrew(): number {
  const margin = 24
  const w = overlay.clientWidth
  const h = overlay.clientHeight
  let fallback = -1
  for (let i = 0; i < shop.screws.length; i++) {
    if ((shop.screws[i] ?? 0) >= 1) continue
    if (fallback < 0) fallback = i
    const head = stage.mechanism.screwHeads[i]
    if (!head) continue
    head.getWorldPosition(v3a)
    stage.project(v3a, v2a)
    if (v2a.x > margin && v2a.x < w - margin && v2a.y > margin && v2a.y < h - margin) return i
  }
  return fallback
}

function updateTargets(): void {
  knobAxis = knobScreenAxis()
  const knob = controls.targets.knob
  stage.project(stage.jigs.knobCentre, knob.centre)
  knob.pivot.copy(knob.centre)
  knob.axis.copy(knobAxis.dir)
  knob.radius = clamp(stage.pxPerMm(stage.jigs.knobCentre) * JIG.knobRadius * 1.5, 52, 150)
  knob.enabled = shop.knobEnabled

  const handle = controls.targets.handle
  stage.project(stage.jigs.handleCentre, handle.centre)
  handle.pivot.copy(handle.centre)
  handle.radius = clamp(stage.pxPerMm(stage.jigs.handleCentre) * JIG.handleRadius * 1.45, 56, 170)
  handle.enabled = true

  const tool = controls.targets.tool
  if (stage.jigs.tool.visible) {
    // 指がつかむのは把手。先端 (ねじ頭) は指から離してある。
    stage.jigs.tool.getWorldPosition(v3a)
    v3b.set(0, TOOL_GRIP_Y, 0).applyQuaternion(stage.jigs.tool.quaternion).add(v3a)
    stage.project(v3b, tool.centre)
    stage.project(v3a, tool.pivot)
    tool.radius = 74
    tool.enabled = true
  } else {
    tool.enabled = false
  }
}

function updateOverlay(now: number): void {
  if (!hintHidden && shop.releasesHeard > 0) hideHint()
  if (demoEl.classList.contains('show')) {
    const k = controls.targets.knob
    demoEl.style.transform = `translate(${k.centre.x}px, ${k.centre.y}px)`
    demoEl.style.setProperty('--dx', `${knobAxis.dir.x * 26}px`)
    demoEl.style.setProperty('--dy', `${knobAxis.dir.y * 26}px`)
  }
  // 無音でも接触と解放が分かるように、消音時だけ接触点に細い輪を出す。
  const silent = audio.isMuted || !audio.started || audio.unavailable
  if (silent && now < pulseUntil) {
    stage.project(stage.mechanism.contactPoint, v2a)
    pulseEl.style.transform = `translate(${v2a.x}px, ${v2a.y}px) scale(${1 + (1 - (pulseUntil - now) / 180) * 1.6})`
    pulseEl.style.opacity = `${(pulseUntil - now) / 180}`
  } else {
    pulseEl.style.opacity = '0'
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

requestAnimationFrame(frame)

// 開発・検証用の窓口。E2E から状態を作って画面証拠を撮るために使う。
declare global {
  interface Window {
    __orgel?: Record<string, unknown>
  }
}
window.__orgel = {
  shop,
  stage,
  controls,
  audio,
  audioState: () => ({
    started: audio.started,
    muted: audio.isMuted,
    unavailable: audio.unavailable,
    now: audio.now(),
  }),
  spec: { MESH, JIG, COMB },
  setTravel: (mm: number) => {
    shop.screws = shop.screws.map(() => 0)
    shop.setTravel(mm)
  },
  setTheta: (rad: number) => {
    shop.theta = rad
    shop.target = rad
  },
  advance: (rad: number) => {
    shop.target += rad
  },
  tighten: () => {
    shop.screws = shop.screws.map(() => 1)
  },
  tune: (which: 'portrait' | 'landscape' | 'reveal', patch: Record<string, unknown>) =>
    stage.tuneFraming(which, patch as never),
  pick: (x: number, y: number) => {
    const rc = new THREE.Raycaster()
    const w = overlay.clientWidth
    const h = overlay.clientHeight
    rc.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -((y / h) * 2 - 1)), stage.camera)
    const hits = rc.intersectObject(stage.scene, true)
    return hits.slice(0, 3).map((i) => ({
      name: i.object.name || i.object.type,
      uuid: i.object.uuid.slice(0, 6),
      dist: Math.round(i.distance),
      mat: (i.object as THREE.Mesh).material instanceof THREE.Material
        ? ((i.object as THREE.Mesh).material as THREE.Material).uuid.slice(0, 6)
        : '',
    }))
  },
  probe: () => {
    const P = (v: THREE.Vector3) => {
      const o = new THREE.Vector2()
      stage.project(v, o)
      return [Math.round(o.x), Math.round(o.y)]
    }
    return {
      contact: P(stage.mechanism.contactPoint),
      knob: P(stage.jigs.knobCentre),
      handle: P(stage.jigs.handleCentre),
      pxPerMmContact: stage.pxPerMm(stage.mechanism.contactPoint),
      pxPerMmKnob: stage.pxPerMm(stage.jigs.knobCentre),
      cylLeft: P(new THREE.Vector3(-41, 1.6, -3)),
      cylRight: P(new THREE.Vector3(41, 1.6, -3)),
      combTipL: P(new THREE.Vector3(-13, 11.3, 1.8)),
      combTipR: P(new THREE.Vector3(13, 11.3, 1.8)),
      camera: stage.camera.position.toArray().map((v) => Math.round(v)),
      info: stage.renderer.info.render,
    }
  },
  frames: () => frameCount,
  read: () => ({
    travel: shop.travel,
    engagement: shop.engagement,
    theta: shop.theta,
    phase: shop.phase,
    releases: shop.releasesHeard,
    contacts: shop.contactsFelt,
    deflection: Array.from(deflect),
    screws: [...shop.screws],
  }),
}
