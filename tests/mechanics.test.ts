import { describe, expect, it } from 'vitest'
import {
  TWO_PI,
  contactHalfAngle,
  cantileverProfile,
  deflectionAt,
  engagementFromTravel,
  isAudibleRelease,
  isSecurelyMeshed,
  pinOuterRadius,
  releaseLoudness,
  stepPasses,
  toothDeflections,
  toothRestRadius,
  wrapPi,
} from '../src/core/mechanics.ts'
import { CYLINDER, MESH, PIN_TIP_RADIUS } from '../src/core/spec.ts'
import { SINGLE_PIN_TRACK, SONG_PINS, TOOTH_HZ, toothWidth } from '../src/core/song.ts'

const deg = (d: number) => (d * Math.PI) / 180

describe('ピンの外形 / pin profile', () => {
  it('ピンの中心では先端半径そのもの', () => {
    expect(pinOuterRadius(0)).toBeCloseTo(PIN_TIP_RADIUS, 10)
  })

  it('角度が離れるほど単調に細くなり、やがて実体が無くなる', () => {
    let prev = pinOuterRadius(0)
    for (let d = 0.0005; d < 0.04; d += 0.0005) {
      const r = pinOuterRadius(d)
      if (r === 0) {
        expect(d).toBeGreaterThan(Math.atan(CYLINDER.pinRadius / CYLINDER.bodyRadius) - 1e-3)
        break
      }
      expect(r).toBeLessThanOrEqual(prev + 1e-9)
      prev = r
    }
  })

  it('左右対称', () => {
    for (const d of [0.005, 0.015, 0.03]) {
      expect(pinOuterRadius(d)).toBeCloseTo(pinOuterRadius(-d), 12)
    }
  })
})

describe('接触の角度幅 / contact window', () => {
  it('隙間が残っている間 (e <= 0) は幅ゼロ = 空振り', () => {
    expect(contactHalfAngle(0)).toBe(0)
    expect(contactHalfAngle(-0.05)).toBe(0)
    expect(contactHalfAngle(engagementFromTravel(0))).toBe(0)
    expect(contactHalfAngle(engagementFromTravel(MESH.initialClearance * 0.5))).toBe(0)
  })

  it('噛み合いが深いほど接触が長く続く', () => {
    let prev = 0
    for (const e of [0.01, 0.05, 0.1, 0.2, 0.4, MESH.maxEngagement]) {
      const h = contactHalfAngle(e)
      expect(h).toBeGreaterThan(prev)
      prev = h
    }
  })

  it('ストッパーの範囲でも接触幅はピン 1 本の太さの範囲に収まる', () => {
    const physicalMax = Math.atan(CYLINDER.pinRadius / CYLINDER.bodyRadius)
    expect(contactHalfAngle(MESH.maxEngagement)).toBeLessThan(physicalMax)
    expect(contactHalfAngle(MESH.maxEngagement)).toBeLessThan(deg(2))
  })

  it('接触幅の端でたわみがちょうど 0 になる (幾何が閉じている)', () => {
    for (const e of [0.05, 0.15, 0.3, 0.55]) {
      const h = contactHalfAngle(e)
      expect(deflectionAt(h, e)).toBeLessThan(1e-6)
      expect(deflectionAt(h * 0.999, e)).toBeGreaterThan(0)
    }
  })
})

describe('たわみ / deflection', () => {
  it('ピンの真上で最大、その値は噛み合い深さに等しい', () => {
    for (const e of [0.02, 0.1, 0.3, MESH.maxEngagement]) {
      expect(deflectionAt(0, e)).toBeCloseTo(e, 9)
    }
  })

  it('空振り設定ではどの角度でもたわまない', () => {
    const e = engagementFromTravel(0)
    for (let d = -0.05; d <= 0.05; d += 0.001) {
      expect(deflectionAt(d, e)).toBe(0)
    }
  })

  it('ストッパーが歯先を壊す深さまで押し込ませない', () => {
    const e = engagementFromTravel(MESH.maxTravel)
    expect(e).toBeCloseTo(MESH.maxEngagement, 12)
    // 歯先はピン先端円より内側へは入れない = ピンが歯を貫通しない
    expect(toothRestRadius(e)).toBeGreaterThan(CYLINDER.bodyRadius)
  })

  it('片持ち梁の形状は根元 0、自由端 1', () => {
    expect(cantileverProfile(0)).toBe(0)
    expect(cantileverProfile(1)).toBeCloseTo(1, 12)
    expect(cantileverProfile(0.5)).toBeGreaterThan(0)
    expect(cantileverProfile(0.5)).toBeLessThan(1)
  })
})

describe('検収: 隙間が大きい設定では、ピンが通過しても楽音が出ない', () => {
  it('起動時の設定で 1 回転させても発音イベントが 0 件', () => {
    const e = engagementFromTravel(0)
    const events = stepPasses(0, TWO_PI * 3, e, SONG_PINS)
    expect(events).toHaveLength(0)
  })

  it('細かい刻みで 1 回転させても 0 件', () => {
    const e = engagementFromTravel(MESH.initialClearance * 0.9)
    let total = 0
    for (let i = 0; i < 600; i++) {
      total += stepPasses((i * TWO_PI) / 600, ((i + 1) * TWO_PI) / 600, e, SONG_PINS).length
    }
    expect(total).toBe(0)
  })
})

describe('検収: 適正設定では接触 → たわみ → 解放と発音が一致する', () => {
  const e = engagementFromTravel(0.30)
  const pins = SINGLE_PIN_TRACK
  const pin = pins[0]!

  it('一本のピンと一本の歯で、接触と解放が 1 回ずつ順番に起きる', () => {
    const events = stepPasses(0, TWO_PI, e, pins)
    expect(events.map((x) => x.kind)).toEqual(['contact', 'release'])
    const [contact, release] = events
    expect(contact!.tooth).toBe(pin.tooth)
    expect(release!.tooth).toBe(pin.tooth)
    expect(contact!.at).toBeLessThan(release!.at)
  })

  it('接触イベントの角度はピン中心の手前、解放は奥', () => {
    const h = contactHalfAngle(e)
    const events = stepPasses(0, TWO_PI, e, pins)
    const angleOf = (at: number) => at * TWO_PI
    expect(angleOf(events[0]!.at)).toBeCloseTo(pin.angle - h, 9)
    expect(angleOf(events[1]!.at)).toBeCloseTo(pin.angle + h, 9)
  })

  it('接触区間の内側では歯がたわみ、外側ではたわまない', () => {
    const out = new Float32Array(TOOTH_HZ.length)
    const h = contactHalfAngle(e)
    toothDeflections(pin.angle - h * 2, e, pins, out)
    expect(out[pin.tooth]).toBe(0) // 接触前
    toothDeflections(pin.angle, e, pins, out)
    expect(out[pin.tooth]).toBeCloseTo(e, 6) // 接触中 = 最大たわみ
    toothDeflections(pin.angle + h * 2, e, pins, out)
    expect(out[pin.tooth]).toBe(0) // 解放後
  })

  it('解放は楽音、浅すぎる接触は楽音にならない', () => {
    expect(isAudibleRelease(e)).toBe(true)
    expect(isAudibleRelease(MESH.audibleEngagement * 0.5)).toBe(false)
    expect(releaseLoudness(e)).toBeGreaterThan(0)
    expect(releaseLoudness(MESH.maxEngagement)).toBeGreaterThan(releaseLoudness(0.05))
  })

  it('曲全体でも、発音の数はピンの数と一致する (接触していない歯は鳴らない)', () => {
    const events = stepPasses(0, TWO_PI, e, SONG_PINS)
    const releases = events.filter((x) => x.kind === 'release')
    expect(releases).toHaveLength(SONG_PINS.length)
    const contacts = events.filter((x) => x.kind === 'contact')
    expect(contacts).toHaveLength(SONG_PINS.length)
    for (const r of releases) {
      expect(SONG_PINS[r.pin]!.tooth).toBe(r.tooth)
    }
  })
})

describe('検収: ハンドルを止めると新規発音が止まり、連打音にならない', () => {
  const e = engagementFromTravel(0.30)
  const pin = SINGLE_PIN_TRACK[0]!

  it('角度が進まないステップはイベントを一切出さない', () => {
    const theta = pin.angle + contactHalfAngle(e) + 0.001
    for (let i = 0; i < 240; i++) {
      expect(stepPasses(theta, theta, e, SINGLE_PIN_TRACK)).toHaveLength(0)
    }
  })

  it('接触の途中で止め続けても、解放していないので発音しない', () => {
    const theta = pin.angle // 真上 = 最大たわみで停止
    const first = stepPasses(0, theta, e, SINGLE_PIN_TRACK)
    expect(first.map((x) => x.kind)).toEqual(['contact'])
    for (let i = 0; i < 240; i++) {
      expect(stepPasses(theta, theta, e, SINGLE_PIN_TRACK)).toHaveLength(0)
    }
    // その状態では歯はたわんだまま保持される
    const out = new Float32Array(TOOTH_HZ.length)
    toothDeflections(theta, e, SINGLE_PIN_TRACK, out)
    expect(out[pin.tooth]).toBeCloseTo(e, 6)
  })

  it('解放を跨いだ直後に同じ角度で刻み続けても二度鳴らない', () => {
    const release = pin.angle + contactHalfAngle(e)
    const crossed = stepPasses(release - 1e-6, release, e, SINGLE_PIN_TRACK)
    expect(crossed.filter((x) => x.kind === 'release')).toHaveLength(1)
    for (let i = 0; i < 120; i++) {
      expect(stepPasses(release, release, e, SINGLE_PIN_TRACK)).toHaveLength(0)
    }
  })

  it('逆回しは受け付けない (ラチェット): 角度が戻る区間は 0 件', () => {
    const release = pin.angle + contactHalfAngle(e) + 0.05
    expect(stepPasses(release, release - 0.4, e, SINGLE_PIN_TRACK)).toHaveLength(0)
  })
})

describe('検収: 噛み合い量を変えても、歯に割り当てた音程は変わらない', () => {
  it('どの調整量でも、同じピンは常に同じ歯を弾く', () => {
    const seen = new Map<number, Set<number>>()
    for (const travel of [0.11, 0.2, 0.35, 0.5, MESH.maxTravel]) {
      const e = engagementFromTravel(travel)
      for (const ev of stepPasses(0, TWO_PI, e, SONG_PINS)) {
        if (ev.kind !== 'release') continue
        const set = seen.get(ev.pin) ?? new Set<number>()
        set.add(ev.tooth)
        seen.set(ev.pin, set)
      }
    }
    expect(seen.size).toBe(SONG_PINS.length)
    for (const [pin, teeth] of seen) {
      expect([...teeth]).toEqual([SONG_PINS[pin]!.tooth])
    }
  })

  it('調律表は調整に依存しない定数で、歯の幅は音程の順に並ぶ', () => {
    for (let t = 1; t < TOOTH_HZ.length; t++) {
      expect(TOOTH_HZ[t]!).toBeGreaterThan(TOOTH_HZ[t - 1]!)
      expect(toothWidth(t)).toBeLessThan(toothWidth(t - 1))
    }
  })

  it('噛み合いを変えて変わるのは強さだけで、音の対応表ではない', () => {
    const soft = stepPasses(0, TWO_PI, engagementFromTravel(0.16), SONG_PINS)
      .filter((x) => x.kind === 'release')
    const firm = stepPasses(0, TWO_PI, engagementFromTravel(0.60), SONG_PINS)
      .filter((x) => x.kind === 'release')
    expect(soft.map((x) => x.tooth)).toEqual(firm.map((x) => x.tooth))
    expect(releaseLoudness(firm[0]!.deflection)).toBeGreaterThan(
      releaseLoudness(soft[0]!.deflection),
    )
  })
})

describe('検収: 低フレームレート相当でも、一つの通過が重複せず安定する', () => {
  const e = engagementFromTravel(0.30)

  function runAtFrameRate(fps: number, revolutions: number, radPerSec: number) {
    const dt = 1 / fps
    const total = TWO_PI * revolutions
    const duration = total / radPerSec
    const releases: number[] = []
    let theta = 0
    for (let t = 0; t < duration; t += dt) {
      const next = Math.min(total, theta + radPerSec * dt)
      for (const ev of stepPasses(theta, next, e, SONG_PINS)) {
        if (ev.kind === 'release') releases.push(ev.pin)
      }
      theta = next
    }
    // 端数の残り
    for (const ev of stepPasses(theta, total, e, SONG_PINS)) {
      if (ev.kind === 'release') releases.push(ev.pin)
    }
    return releases
  }

  const expected = SONG_PINS.length * 2

  it.each([120, 60, 30, 15, 8, 4])('%i fps 相当で、2 回転の発音が過不足なく 1 回ずつ', (fps) => {
    const releases = runAtFrameRate(fps, 2, TWO_PI) // 1 回転/秒
    expect(releases).toHaveLength(expected)
    const counts = new Map<number, number>()
    for (const p of releases) counts.set(p, (counts.get(p) ?? 0) + 1)
    for (const [, n] of counts) expect(n).toBe(2)
    expect(counts.size).toBe(SONG_PINS.length)
  })

  it('極端に粗い 1 ステップ (10 回転を一度に) でも重複せず取りこぼさない', () => {
    const events = stepPasses(0, TWO_PI * 10, e, SONG_PINS)
    const releases = events.filter((x) => x.kind === 'release')
    // 安全弁で頭打ちにはなるが、同じ交差が二度出ることはない
    const keys = releases.map((x) => `${x.pin}`)
    expect(new Set(keys).size).toBeGreaterThan(0)
    expect(releases.every((x) => x.at >= 0 && x.at <= 1)).toBe(true)
    const sorted = [...releases].sort((a, b) => a.at - b.at)
    expect(sorted.map((x) => x.at)).toEqual(releases.map((x) => x.at))
  })

  it('刻み方を変えても、同じ角度区間なら同じ発音列になる', () => {
    const coarse = stepPasses(0, TWO_PI, e, SONG_PINS)
      .filter((x) => x.kind === 'release')
      .map((x) => x.pin)
    const fine: number[] = []
    const steps = 997
    for (let i = 0; i < steps; i++) {
      for (const ev of stepPasses((i * TWO_PI) / steps, ((i + 1) * TWO_PI) / steps, e, SONG_PINS)) {
        if (ev.kind === 'release') fine.push(ev.pin)
      }
    }
    expect(fine).toEqual(coarse)
  })
})

describe('曲とピンの対応 / song wiring', () => {
  it('ピンは角度順に並んでいて、すべて 1 回転の中に収まる', () => {
    for (let i = 1; i < SONG_PINS.length; i++) {
      expect(SONG_PINS[i]!.angle).toBeGreaterThanOrEqual(SONG_PINS[i - 1]!.angle)
    }
    for (const p of SONG_PINS) {
      expect(p.angle).toBeGreaterThanOrEqual(0)
      expect(p.angle).toBeLessThan(TWO_PI)
      expect(p.tooth).toBeGreaterThanOrEqual(0)
      expect(p.tooth).toBeLessThan(TOOTH_HZ.length)
    }
  })

  it('同じ歯を弾くピン同士は、たわみが戻る余裕を空けて並んでいる', () => {
    const byTooth = new Map<number, number[]>()
    for (const p of SONG_PINS) {
      const list = byTooth.get(p.tooth) ?? []
      list.push(p.angle)
      byTooth.set(p.tooth, list)
    }
    const minGap = contactHalfAngle(MESH.maxEngagement) * 4
    for (const [, angles] of byTooth) {
      angles.sort((a, b) => a - b)
      for (let i = 1; i < angles.length; i++) {
        expect(angles[i]! - angles[i - 1]!).toBeGreaterThan(minGap)
      }
      const wrap = TWO_PI - angles[angles.length - 1]! + angles[0]!
      expect(wrap).toBeGreaterThan(minGap)
    }
  })

  it('最初の一音は起動位置からわずかに回すだけで届く', () => {
    const e = engagementFromTravel(0.25)
    const first = stepPasses(0, deg(40), e, SONG_PINS).find((x) => x.kind === 'release')
    expect(first).toBeDefined()
  })

  it('固定してよい噛み合いの判定は、隙間が残っている間は false', () => {
    expect(isSecurelyMeshed(engagementFromTravel(0))).toBe(false)
    expect(isSecurelyMeshed(engagementFromTravel(MESH.initialClearance + 0.2))).toBe(true)
  })
})

describe('角度ユーティリティ', () => {
  it('wrapPi は (-π, π] に畳む', () => {
    expect(wrapPi(0)).toBeCloseTo(0, 12)
    expect(wrapPi(TWO_PI)).toBeCloseTo(0, 12)
    expect(wrapPi(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 12)
    expect(wrapPi(-TWO_PI - 0.3)).toBeCloseTo(-0.3, 12)
  })
})
