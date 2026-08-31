import { expect, test, type Page } from '@playwright/test'

/**
 * この作品固有の検収を、実際の画面と実際のポインタ操作で確かめる。
 * 撮れた画像は docs/evidence/ に残る。
 */

const SIZES = [
  { w: 390, h: 844, name: '390x844' },
  { w: 844, h: 390, name: '844x390' },
  { w: 820, h: 1180, name: '820x1180' },
  { w: 1180, h: 820, name: '1180x820' },
]

interface Reading {
  travel: number
  engagement: number
  theta: number
  phase: string
  releases: number
  contacts: number
  deflection: number[]
  screws: number[]
}

interface TargetInfo {
  x: number
  y: number
  r: number
  on: boolean
  ax: [number, number]
}

declare global {
  interface Window {
    __orgel: {
      read(): Reading
      probe(): Record<string, unknown>
      setTravel(mm: number): void
      setTheta(rad: number): void
      advance(rad: number): void
      tighten(): void
      frames(): number
      tune(which: 'portrait' | 'landscape' | 'reveal', patch: Record<string, unknown>): void
      controls: { targets: Record<string, { centre: { x: number; y: number }; radius: number; enabled: boolean; axis: { x: number; y: number } }> }
      spec: { MESH: { initialClearance: number; maxTravel: number; audibleEngagement: number } }
    }
  }
}

async function boot(page: Page, w: number, h: number): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.setViewportSize({ width: w, height: h })
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__orgel), undefined, { timeout: 40_000 })
  await page.waitForTimeout(700)
  return errors
}

const read = (page: Page) => page.evaluate(() => window.__orgel.read())

/** 描画ループが n フレーム進むまで待つ (読み取りが描画を追い越さないように)。 */
async function nextFrames(page: Page, n = 3): Promise<void> {
  const from = await page.evaluate(() => window.__orgel.frames())
  await page.waitForFunction((f) => window.__orgel.frames() >= f, from + n, { timeout: 20_000 })
}

/**
 * ガバナー制限つきの追従が指示角に追いつくまで待つ。
 * 「描画フレームが 3 回進んでも theta が変わらない」ことで判定する
 * (時間だけで見ると、1 フレームが長い環境で止まったと誤判定するため)。
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>
    delete w['__sFrame']
    delete w['__sTheta']
    delete w['__sHold']
  })
  await page
    .waitForFunction(
      () => {
        const w = window as unknown as Record<string, unknown>
        const f = window.__orgel.frames()
        if (w['__sFrame'] === f) return false
        w['__sFrame'] = f
        const t = window.__orgel.read().theta
        const same = w['__sTheta'] !== undefined && Math.abs(t - (w['__sTheta'] as number)) < 1e-9
        w['__sHold'] = same ? ((w['__sHold'] as number) ?? 0) + 1 : 0
        w['__sTheta'] = t
        return ((w['__sHold'] as number) ?? 0) >= 3
      },
      undefined,
      { timeout: 40_000, polling: 'raf' },
    )
    .catch(() => undefined)
}

const targets = (page: Page) =>
  page.evaluate(() => {
    const t = window.__orgel.controls.targets
    const g = (k: string): TargetInfo => ({
      x: Math.round(t[k]!.centre.x),
      y: Math.round(t[k]!.centre.y),
      r: Math.round(t[k]!.radius),
      on: t[k]!.enabled,
      ax: [t[k]!.axis.x, t[k]!.axis.y],
    })
    return { knob: g('knob'), handle: g('handle'), tool: g('tool') }
  })

/** ドラムを一本の指で転がす。 */
async function dragKnob(page: Page, px: number): Promise<void> {
  const t = await targets(page)
  const size = page.viewportSize()!
  const steps = 8
  const sx = Math.min(size.width - 6, Math.max(6, t.knob.x))
  const sy = Math.min(size.height - 6, Math.max(6, t.knob.y))
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      sx + (t.knob.ax[0] * px * i) / steps,
      sy + (t.knob.ax[1] * px * i) / steps,
    )
  }
  await page.mouse.up()
}

/** ハンドルを一本の指で円弧に回す。sign>0 が送り方向。 */
async function crank(page: Page, turns: number, sign = 1): Promise<void> {
  const t = await targets(page)
  const size = page.viewportSize()!
  const cx = t.handle.x
  const cy = t.handle.y
  // 画面に収まる半径で回す。回転の量は中心まわりの角度で決まるので、
  // どこを掴んでも同じだけ回る。
  const edge = Math.min(cx, size.width - cx, cy, size.height - cy) - 10
  const r = Math.max(26, Math.min(78, edge))
  const at = (a: number): [number, number] => [
    Math.min(size.width - 4, Math.max(4, cx + Math.cos(a) * r)),
    Math.min(size.height - 4, Math.max(4, cy + Math.sin(a) * r)),
  ]
  const start = Math.PI
  await page.mouse.move(...at(start))
  await page.mouse.down()
  const total = Math.PI * 2 * turns * sign
  const steps = Math.max(6, Math.round(Math.abs(turns) * 14))
  for (let i = 1; i <= steps; i++) await page.mouse.move(...at(start + (total * i) / steps))
  await page.mouse.up()
}

/** ねじ回しの把手をつかんで、ねじの軸まわりに短い円弧で回す。 */
async function twistTool(page: Page, arcs = 14): Promise<void> {
  const size = page.viewportSize()!
  const inside = (x: number, y: number) =>
    x > 3 && x < size.width - 3 && y > 3 && y < size.height - 3
  for (let n = 0; n < arcs; n++) {
    const tool = await page.evaluate(() => {
      const t = window.__orgel.controls.targets['tool']! as unknown as {
        centre: { x: number; y: number }
        pivot: { x: number; y: number }
        enabled: boolean
      }
      return { on: t.enabled, cx: t.centre.x, cy: t.centre.y, px: t.pivot.x, py: t.pivot.y }
    })
    if (!tool.on) break
    // つかむのは把手そのもの。指はねじ頭から離れている。
    if (!inside(tool.cx, tool.cy)) break
    const r = Math.hypot(tool.cx - tool.px, tool.cy - tool.py)
    const a0 = Math.atan2(tool.cy - tool.py, tool.cx - tool.px)
    await page.mouse.move(tool.cx, tool.cy)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) {
      const a = a0 + (Math.PI * 1.2 * i) / 8
      const x = tool.px + Math.cos(a) * r
      const y = tool.py + Math.sin(a) * r
      if (!inside(x, y)) break
      await page.mouse.move(x, y)
    }
    await page.mouse.up()
    const done = await page.evaluate(() => window.__orgel.read().screws.every((v) => v >= 1))
    if (done) break
  }
}

test.describe('噛み合いの因果', () => {
  test('隙間が大きい設定では、ピンが通過しても楽音が出ない (空振り)', async ({ page }) => {
    const errors = await boot(page, 390, 844)
    const start = await read(page)
    expect(start.travel).toBe(0)
    expect(start.engagement).toBeLessThan(0)

    await crank(page, 1.1)
    await settle(page)
    const after = await read(page)
    expect(after.theta).toBeGreaterThan(Math.PI) // ちゃんと回っている
    expect(after.releases).toBe(0) // それでも一音も出ない
    expect(after.contacts).toBe(0)
    expect(Math.max(...after.deflection)).toBe(0)
    await page.screenshot({ path: 'docs/evidence/01-miss-390x844.png' })
    expect(errors).toEqual([])
  })

  test('接触中 / 解放後 の状態を再現できる', async ({ page }) => {
    await boot(page, 390, 844)
    // 噛み合わせてから、ピンのちょうど真上で止める = 接触中
    await page.evaluate(() => {
      window.__orgel.setTravel(0.4)
      window.__orgel.setTheta(0)
    })
    await nextFrames(page)
    const pinAngle = await page.evaluate(() => (18 * Math.PI) / 180)
    await page.evaluate((a) => window.__orgel.setTheta(a), pinAngle)
    await nextFrames(page)
    const contact = await read(page)
    expect(Math.max(...contact.deflection)).toBeGreaterThan(0.25)
    await page.screenshot({ path: 'docs/evidence/02-contact-390x844.png' })

    // 解放したあと = たわみが戻っている
    await page.evaluate((a) => window.__orgel.setTheta(a + 0.2), pinAngle)
    await page.waitForTimeout(400)
    await nextFrames(page)
    const released = await read(page)
    expect(Math.max(...released.deflection)).toBeLessThan(0.02)
    await page.screenshot({ path: 'docs/evidence/03-released-390x844.png' })
  })

  test('ハンドルを止めると新規発音が止まり、連打音にならない', async ({ page }) => {
    await boot(page, 390, 844)
    await page.evaluate(() => window.__orgel.setTravel(0.4))
    await crank(page, 1.1)
    await settle(page)
    const moving = await read(page)
    expect(moving.releases).toBeGreaterThan(3)
    await page.waitForTimeout(1200) // 指を離したまま待つ
    const stopped = await read(page)
    expect(stopped.releases).toBe(moving.releases)
    expect(stopped.theta).toBe(moving.theta)
  })

  test('逆回しは受け付けない (ラチェット)', async ({ page }) => {
    await boot(page, 390, 844)
    await page.evaluate(() => window.__orgel.setTravel(0.4))
    await crank(page, 0.5)
    await settle(page)
    const fwd = await read(page)
    await crank(page, 0.5, -1)
    await settle(page)
    const back = await read(page)
    expect(back.theta).toBeCloseTo(fwd.theta, 6)
    expect(back.releases).toBe(fwd.releases)
  })

  test('噛み合い量を変えても、歯に割り当てた音程は変わらない', async ({ page }) => {
    await boot(page, 390, 844)
    const hz = await page.evaluate(async () => {
      const seen: number[][] = []
      for (const travel of [0.2, 0.45, 0.7]) {
        window.__orgel.setTravel(travel)
        window.__orgel.setTheta(0)
        {
          const f0 = window.__orgel.frames()
          while (window.__orgel.frames() < f0 + 3) await new Promise((r) => requestAnimationFrame(r))
        }
        // 各ピンを順に真上へ持っていき、どの歯がたわむかを見る
        const rowsForTravel: number[] = []
        for (let k = 0; k < 24; k++) {
          window.__orgel.setTheta((18 * Math.PI) / 180 + (k * Math.PI * 2) / 24)
          const f0 = window.__orgel.frames()
          while (window.__orgel.frames() < f0 + 3) await new Promise((r) => requestAnimationFrame(r))
          const d = window.__orgel.read().deflection
          let best = -1
          let bestV = 0
          d.forEach((v, i) => {
            if (v > bestV) {
              bestV = v
              best = i
            }
          })
          rowsForTravel.push(best)
        }
        seen.push(rowsForTravel)
      }
      return seen
    })
    expect(hz[1]).toEqual(hz[0])
    expect(hz[2]).toEqual(hz[0])
    expect(hz[0]!.filter((v) => v >= 0).length).toBeGreaterThan(10)
  })

  test('低いフレームレート相当でも、通過イベントが重複せず安定する', async ({ page }) => {
    await boot(page, 390, 844)
    const client = await page.context().newCDPSession(page)
    await client.send('Emulation.setCPUThrottlingRate', { rate: 8 })
    await page.evaluate(() => {
      window.__orgel.setTravel(0.4)
      window.__orgel.setTheta(0)
    })
    // 2 回転ぶんの送りを一気に指示し、ガバナー制限つきで回りきるのを待つ
    await page.evaluate(() => window.__orgel.advance(Math.PI * 4))
    await page.waitForFunction(() => window.__orgel.read().theta >= Math.PI * 4 - 1e-6, undefined, {
      timeout: 40_000,
    })
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    const r = await read(page)
    // ピン 21 本 × 2 回転 = 42。過不足なし。
    expect(r.releases).toBe(42)
    expect(r.contacts).toBe(42)
    await page.screenshot({ path: 'docs/evidence/04-lowfps-390x844.png' })
  })
})

test.describe('一指で 調整 → 試し回し → 固定 → 演奏', () => {
  for (const s of SIZES) {
    test(`${s.name} で最後まで一本の指で通せる`, async ({ page }) => {
      const errors = await boot(page, s.w, s.h)

      // 1. 調整: ドラムを転がして櫛歯を近づける
      await dragKnob(page, Math.round(Math.min(s.w, s.h) * 0.62))
      const adjusted = await read(page)
      expect(adjusted.travel).toBeGreaterThan(adjusted.engagement) // 実変位が入っている
      expect(adjusted.engagement).toBeGreaterThan(0)
      await page.screenshot({ path: `docs/evidence/10-adjust-${s.name}.png` })

      // 2. 試し回し: 同じ指でハンドルへ持ち替えて回す
      await crank(page, 0.4)
      await settle(page)
      const cranked = await read(page)
      expect(cranked.releases).toBeGreaterThan(0)
      await page.screenshot({ path: `docs/evidence/11-crank-${s.name}.png` })

      // 3. 固定: 工具が出るまで噛み合いを深めてから、短い円弧で締める
      if (cranked.phase !== 'fasten') {
        await dragKnob(page, Math.round(Math.min(s.w, s.h) * 0.4))
        await crank(page, 0.25)
        await settle(page)
      }
      const beforeTool = await read(page)
      expect(beforeTool.phase).toBe('fasten')
      const tt = await targets(page)
      expect(tt.tool.on).toBe(true)
      await page.screenshot({ path: `docs/evidence/12-tool-${s.name}.png` })

      await twistTool(page, 16)
      const fastened = await read(page)
      expect(fastened.screws.every((v) => v >= 1)).toBe(true)
      expect(fastened.phase).toBe('play')

      // 4. 演奏: そのまま回すと短い曲になる
      const before = fastened.releases
      await crank(page, 0.5)
      await settle(page)
      const played = await read(page)
      expect(played.releases).toBeGreaterThan(before + 4)
      await page.screenshot({ path: `docs/evidence/13-play-${s.name}.png` })

      expect(errors).toEqual([])
    })
  }
})

test('完成後は作業構図のまま数音鳴らしてから引く', async ({ page }) => {
  await boot(page, 390, 844)
  await page.evaluate(() => {
    window.__orgel.setTravel(0.45)
    window.__orgel.tighten()
  })
  await page.waitForTimeout(300)
  await crank(page, 0.35)
  await settle(page)
  await page.screenshot({ path: 'docs/evidence/20-play-worksetup.png' })
  await crank(page, 1.0)
  await settle(page)
  await page.waitForTimeout(4200) // 引きのカメラが落ち着くまで
  await page.screenshot({ path: 'docs/evidence/21-reveal-workshop.png' })
  const r = await read(page)
  expect(r.phase).toBe('play')
})

test('接写: 空振り / 接触中 / 解放後 を同じ幾何から作れる', async ({ page }) => {
  await boot(page, 900, 900)
  // 作業構図とは別の、確認用の接写カメラ。機構そのものは何も変えていない。
  await page.evaluate(() =>
    window.__orgel.tune('landscape', {
      distance: 40,
      target: [-4.0, 12.3, 2.4],
      azimuth: 0.78,
      elevation: 0.44,
      fov: 30,
    }),
  )
  const pin = (18 * Math.PI) / 180

  // 空振り: 隙間が残った設定でピンが真横を通過しても、歯は動かない
  await page.evaluate((a) => {
    window.__orgel.setTravel(0)
    window.__orgel.setTheta(a)
  }, pin)
  await nextFrames(page, 4)
  expect(Math.max(...(await read(page)).deflection)).toBe(0)
  await page.screenshot({ path: 'docs/evidence/30-closeup-miss.png' })

  // 接触中: 同じ角度のまま噛み合わせると、歯が押し下げられる
  await page.evaluate((a) => {
    window.__orgel.setTravel(0.45)
    window.__orgel.setTheta(a)
  }, pin)
  await nextFrames(page, 4)
  expect(Math.max(...(await read(page)).deflection)).toBeGreaterThan(0.3)
  await page.screenshot({ path: 'docs/evidence/31-closeup-contact.png' })

  // 解放後: 通り過ぎると歯は戻る
  await page.evaluate((a) => window.__orgel.setTheta(a + 0.25), pin)
  await page.waitForTimeout(500)
  await nextFrames(page, 4)
  expect(Math.max(...(await read(page)).deflection)).toBeLessThan(0.02)
  await page.screenshot({ path: 'docs/evidence/32-closeup-released.png' })
})
