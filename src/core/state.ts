/**
 * 作業の状態 / workshop state.
 *
 * 画面の大きさや向きに一切依存しません。回転しても噛み合い量 (travel) と
 * 曲の位相 (theta) はここに残り続けます。
 */

import { GOVERNOR, JIG, MESH } from './spec.ts'
import { engagementFromTravel, isSecurelyMeshed } from './mechanics.ts'

export type Phase =
  /** 調整と試し回しを自由に行き来する段階 */
  | 'work'
  /** 噛み合ったので、固定ねじを締める段階 */
  | 'fasten'
  /** 締結済み。自由に回して曲を聴く段階 */
  | 'play'

export interface Snapshot {
  travel: number
  theta: number
  screws: number[]
  phase: Phase
  releasesHeard: number
  contactsFelt: number
  sawFirstNote: boolean
}

const STORAGE_KEY = 'orgel-koubou/v1'

export class Workshop {
  /** 櫛歯ブロックがシリンダーへ近づいた実変位 (mm)。 */
  travel = 0
  /** シリンダーの累積回転角 (rad)。ラチェットにより単調非減少。 */
  theta = 0
  /** ハンドルが指示している累積角。theta はガバナー制限つきで追従する。 */
  target = 0
  /** 各固定ねじの締まり具合 0..1。 */
  screws: number[] = new Array(JIG.screwCount).fill(0)
  phase: Phase = 'work'
  /** 楽音として解放された回数。 */
  releasesHeard = 0
  /** 接触した回数 (空振りしていない証拠)。 */
  contactsFelt = 0
  /** 最初の一音を自分の調整で出したか。 */
  sawFirstNote = false
  /** 完成後、作業構図のまま何音聴かせたか。 */
  notesSincePlay = 0
  /** 逆回しでラチェットに当たっている量 (rad)。 */
  ratchetLoad = 0

  get engagement(): number {
    return engagementFromTravel(this.travel)
  }

  get meshed(): boolean {
    return isSecurelyMeshed(this.engagement)
  }

  get screwsTight(): boolean {
    return this.screws.every((s) => s >= 1)
  }

  /** 調整つまみは、締結中は物理的に効かない (櫛が締め付けられているため)。 */
  get knobEnabled(): boolean {
    return this.screws.every((s) => s <= 0.001)
  }

  setTravel(next: number): void {
    if (!this.knobEnabled) return
    this.travel = Math.min(MESH.maxTravel, Math.max(0, next))
  }

  /** ハンドルの指示角を進める。逆回しはラチェットが受け止めて進まない。 */
  advanceTarget(delta: number): { blocked: number } {
    if (delta >= 0) {
      this.ratchetLoad = 0
      this.target += delta
      return { blocked: 0 }
    }
    this.ratchetLoad += -delta
    return { blocked: -delta }
  }

  /** ガバナー制限つきで theta を target に追従させる。戻り値は [前, 後]。 */
  integrate(dt: number): [number, number] {
    const prev = this.theta
    const remaining = this.target - this.theta
    if (remaining <= 0) return [prev, prev]
    const maxStep = GOVERNOR.maxAngularSpeed * dt
    const step = Math.min(remaining, maxStep)
    this.theta = prev + step
    return [prev, this.theta]
  }

  loosen(): void {
    this.screws = this.screws.map(() => 0)
    this.phase = 'work'
    this.notesSincePlay = 0
  }

  snapshot(): Snapshot {
    return {
      travel: this.travel,
      theta: this.theta,
      screws: [...this.screws],
      phase: this.phase,
      releasesHeard: this.releasesHeard,
      contactsFelt: this.contactsFelt,
      sawFirstNote: this.sawFirstNote,
    }
  }

  restore(s: Partial<Snapshot> | null): void {
    if (!s) return
    if (typeof s.travel === 'number') this.travel = Math.min(MESH.maxTravel, Math.max(0, s.travel))
    if (typeof s.theta === 'number' && Number.isFinite(s.theta) && s.theta >= 0) {
      this.theta = s.theta
      this.target = s.theta
    }
    if (Array.isArray(s.screws) && s.screws.length === JIG.screwCount) {
      this.screws = s.screws.map((v) => Math.min(1, Math.max(0, Number(v) || 0)))
    }
    if (s.phase === 'work' || s.phase === 'fasten' || s.phase === 'play') this.phase = s.phase
    if (typeof s.releasesHeard === 'number') this.releasesHeard = s.releasesHeard
    if (typeof s.contactsFelt === 'number') this.contactsFelt = s.contactsFelt
    if (typeof s.sawFirstNote === 'boolean') this.sawFirstNote = s.sawFirstNote
  }

  /** 画面回転で iOS Safari がページを作り直しても状態を失わないための保険。 */
  persist(): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot()))
    } catch {
      /* プライベートモードなどでは黙って諦める */
    }
  }

  loadPersisted(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) this.restore(JSON.parse(raw) as Partial<Snapshot>)
    } catch {
      /* ignore */
    }
  }

  /** 進行段階を今の実態から更新する。 */
  refreshPhase(): void {
    if (this.screwsTight) {
      this.phase = 'play'
    } else if (this.meshed && this.sawFirstNote) {
      this.phase = 'fasten'
    } else {
      this.phase = 'work'
    }
  }
}
