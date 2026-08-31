import type { Page } from '@playwright/test'

export interface GameApi {
  state(): {
    open: number
    openSpeed: number
    clipT: number
    clipAttached: boolean
    phase: 'unfolding' | 'clipReady' | 'clipped'
    paperColor: number
    muted: boolean
    everCompleted: boolean
    everClipped: boolean
  }
  stats(): { triangles: number; calls: number; geometries: number; textures: number; programs: number }
  startTrace(): void
  trace(): Array<{ t: number; open: number; clipT: number; x: number; drag: number }>
  tabScreen(): { x: number; y: number }
  clipScreen(): { x: number; y: number }
  clipScreenAt(k: number): { x: number; y: number }
  swatchScreen(i: number): { x: number; y: number }
  frontBandY(): number
}

declare global {
  interface Window {
    __game: GameApi
    __dev?: { view(v: 'front' | 'side' | 'back' | 'top'): void }
  }
}

export interface BootOpts {
  /** 検査用の軽量描画（既定 true）。ソフトウェアGLでも操作を確認できるようにするだけで、
   *  ジオメトリ・当たり判定・状態遷移・カメラは通常と同一。画面証拠では false にする。 */
  lite?: boolean
  query?: string
}

export async function boot(page: Page, opts: BootOpts = {}): Promise<void> {
  const query = `?fixq=1${opts.lite === false ? '' : '&lite=1'}${opts.query ?? ''}`
  await page.route('**', (route) => {
    const u = route.request().url()
    return u.startsWith('http://127.0.0.1') || u.startsWith('data:') || u.startsWith('blob:')
      ? route.continue()
      : route.abort()
  })
  await page.goto('/' + query, { waitUntil: 'load' })
  await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 })
  await page.waitForTimeout(400)
}

export const state = (page: Page) => page.evaluate(() => window.__game.state())

/** 離したあとの小さな弾性戻りが収まるまで待つ。 */
export const waitSettled = (page: Page) =>
  page.waitForFunction(() => window.__game.state().openSpeed === 0, null, { timeout: 120000 })
export const stats = (page: Page) => page.evaluate(() => window.__game.stats())

/** 手前のドラッグ帯を使って、右へ引く（＝開く）。短いストロークを継ぎ足せる。 */
export async function stroke(page: Page, dx: number, steps = 5, y?: number): Promise<void> {
  const size = page.viewportSize()!
  const by = y ?? (await page.evaluate(() => window.__game.frontBandY()))
  const startX = dx > 0 ? size.width * 0.12 : size.width * 0.88
  await page.mouse.move(startX, by)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + (dx * i) / steps, by)
  }
  await page.mouse.up()
  await waitSettled(page)
}

export async function openFully(page: Page): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const s = await state(page)
    if (s.open >= 0.995) return
    await stroke(page, page.viewportSize()!.width * 0.72, 6)
  }
}

/** クリップを継ぎ目までドラッグして留める。 */
export async function attachClip(page: Page): Promise<void> {
  const path = await page.evaluate(() => ({
    from: window.__game.clipScreenAt(0),
    to: window.__game.clipScreenAt(1),
  }))
  await page.mouse.move(path.from.x, path.from.y)
  await page.mouse.down()
  const N = 8
  for (let i = 1; i <= N; i++) {
    await page.mouse.move(
      path.from.x + ((path.to.x - path.from.x) * i) / N,
      path.from.y + ((path.to.y - path.from.y) * i) / N,
    )
  }
  await page.mouse.up()
  await page.waitForTimeout(200)
}

/** クリップを机の方へ引き戻して外す。 */
export async function detachClip(page: Page): Promise<void> {
  const path = await page.evaluate(() => ({
    from: window.__game.clipScreenAt(1),
    to: window.__game.clipScreenAt(0),
  }))
  await page.mouse.move(path.from.x, path.from.y)
  await page.mouse.down()
  const N = 8
  for (let i = 1; i <= N; i++) {
    await page.mouse.move(
      path.from.x + ((path.to.x - path.from.x) * i) / N,
      path.from.y + ((path.to.y - path.from.y) * i) / N,
    )
  }
  await page.mouse.up()
  await page.waitForTimeout(200)
}

/** 何回か左へ引いて閉じる。 */
export async function closeFully(page: Page): Promise<void> {
  for (let i = 0; i < 8; i++) {
    if ((await state(page)).open <= 0.005) return
    await stroke(page, -page.viewportSize()!.width * 0.75, 6)
  }
}
