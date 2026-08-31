import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const OUT = 'shots'
fs.mkdirSync(OUT, { recursive: true })

const PORTRAIT = { width: 420, height: 900 }
const LANDSCAPE = { width: 900, height: 420 }

export async function launch() {
  return chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--disable-lcd-text',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-first-run',
      '--disable-default-apps',
    ],
  })
}

export async function openGame(browser, { viewport = PORTRAIT, query = '' } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1.6 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`${BASE}/${query}`, { waitUntil: 'load' })
  await page.waitForFunction('!!window.__reifen', null, { timeout: 30000 })
  page.__errors = errors
  return page
}

export const settle = (page, frames = 40) =>
  page.evaluate(
    (n) =>
      new Promise((res) => {
        let i = 0
        const t = () => (++i >= n ? res() : requestAnimationFrame(t))
        requestAnimationFrame(t)
      }),
    frames,
  )

async function main() {
  const browser = await launch()

  // ---- stage 1: bare environment, shape verification ---------------------
  const p = await openGame(browser, { viewport: { width: 1000, height: 750 }, query: '?plain=1&orbit=1' })
  await settle(p, 20)

  const views = [
    ['v1-ring-oblique', 42, 34, 0.62, 0, 0, 0],
    ['v2-ring-top', 0, 88, 0.60, 0, 0, 0],
    ['v3-ring-side', 8, 4, 0.58, 0, 0, 0],
    ['v4-ring-back', 190, 24, 0.60, 0, 0, 0],
  ]
  for (const [name, az, el, d, sx, sy, sz] of views) {
    await p.evaluate(
      ([az, el, d, sx, sy, sz]) => {
        const { camera } = window.__reifen
        const a = (az * Math.PI) / 180
        const e = (el * Math.PI) / 180
        camera.position.set(
          sx + d * Math.cos(e) * Math.cos(a),
          sy + d * Math.sin(e),
          sz + d * Math.cos(e) * Math.sin(a),
        )
        camera.lookAt(sx, sy + 0.05, sz)
      },
      [az, el, d, sx, sy, sz],
    )
    await settle(p, 3)
    await p.screenshot({ path: `${OUT}/${name}.png` })
  }
  console.log('errors:', p.__errors)
  await p.close()
  await browser.close()
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
