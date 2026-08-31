import { describe, expect, it } from 'vitest'
import { OPEN_COMPLETE, Store } from '../../src/state/store'
import { TestClock } from '../../src/util/clock'

describe('遊びの状態', () => {
  it('指の移動だけで開き、止めれば止まる', () => {
    const s = new Store()
    s.applyDrag(0.2, 0.016)
    expect(s.open).toBeCloseTo(0.2, 9)
    // 入力が無い間は減衰だけ。時間では完成へ進まない。
    for (let i = 0; i < 600; i++) s.settle(0.016)
    expect(s.open).toBeLessThan(0.2 + 0.031)
    expect(s.phase).toBe('unfolding')
  })

  it('逆に引けば戻り、また引けば続きから開く', () => {
    const s = new Store()
    s.applyDrag(0.4, 0.016)
    s.applyDrag(-0.25, 0.016)
    expect(s.open).toBeCloseTo(0.15, 9)
    s.applyDrag(0.3, 0.016)
    expect(s.open).toBeCloseTo(0.45, 9)
  })

  it('短いストロークを継ぎ足して全開にできる', () => {
    const s = new Store()
    for (let i = 0; i < 10; i++) {
      s.applyDrag(0.12, 0.016)
      s.releaseDrag(0)
      for (let k = 0; k < 20; k++) s.settle(0.016)
    }
    expect(s.open).toBe(1)
    expect(s.phase).toBe('clipReady')
  })

  it('クリック回数や経過時間だけでは完成しない', () => {
    const s = new Store()
    const clock = new TestClock()
    for (let i = 0; i < 200; i++) {
      s.applyDrag(0, 0.016)
      s.releaseDrag(0)
      clock.advance(0.05)
      s.settle(0.05)
    }
    expect(s.open).toBe(0)
    expect(s.everCompleted).toBe(false)
    expect(s.canClip()).toBe(false)
  })

  it('離したときの弾性戻りは上限を超えない', () => {
    const s = new Store()
    s.applyDrag(0.5, 0.016)
    s.releaseDrag(5)
    let max = s.open
    for (let i = 0; i < 400; i++) {
      s.settle(0.016)
      max = Math.max(max, s.open)
    }
    expect(max).toBeLessThanOrEqual(0.5 + 0.0301)
    expect(max).toBeGreaterThan(0.5)
  })

  it('全開に達したときだけクリップを使える', () => {
    const s = new Store()
    s.applyDrag(0.9, 0.016)
    expect(s.canClip()).toBe(false)
    s.applyClipDrag(1)
    expect(s.clipT).toBe(0)
    s.applyDrag(0.2, 0.016)
    expect(s.open).toBe(1)
    expect(s.canClip()).toBe(true)
  })

  it('触れただけでは留まらない。離した位置で決まる', () => {
    const s = new Store()
    s.applyDrag(1.2, 0.016)
    s.applyClipDrag(0.5)
    expect(s.clipAttached).toBe(false)
    expect(s.releaseClip()).toBe(false)
    expect(s.clipT).toBe(0)
    s.applyClipDrag(0.95)
    expect(s.releaseClip()).toBe(true)
    expect(s.clipAttached).toBe(true)
  })

  it('留める→外す→閉じる→開く を繰り返しても状態が壊れない', () => {
    const s = new Store()
    for (let cycle = 0; cycle < 30; cycle++) {
      s.applyDrag(1.5, 0.016)
      expect(s.open).toBe(1)
      s.applyClipDrag(1)
      expect(s.releaseClip()).toBe(true)
      expect(s.phase).toBe('clipped')
      // 留めている間は開閉しない
      s.applyDrag(-0.5, 0.016)
      expect(s.open).toBe(1)
      // 外す
      s.applyClipDrag(-0.4)
      expect(s.clipAttached).toBe(false)
      s.releaseClip()
      expect(s.clipT).toBe(0)
      s.applyDrag(-1.5, 0.016)
      expect(s.open).toBe(0)
      expect(s.phase).toBe('unfolding')
    }
    expect(s.everCompleted).toBe(true)
  })

  it('完成の閾値は 1 のごく手前まで', () => {
    const s = new Store()
    s.applyDrag(OPEN_COMPLETE - 0.001, 0.016)
    expect(s.canClip()).toBe(false)
    s.applyDrag(0.002, 0.016)
    expect(s.canClip()).toBe(true)
  })

  it('紙の色は完成後に選べる（収集要素は増やさない）', () => {
    const s = new Store()
    s.setPaperColor(2)
    expect(s.snapshot().paperColor).toBe(2)
  })
})
