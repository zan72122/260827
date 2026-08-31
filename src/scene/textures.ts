import * as THREE from 'three'
import { makeRng } from '../util/rng'

/**
 * すべてのテクスチャはその場で描く。外部画像を持ち込まない
 * （資料画像の転載も実行時ホットリンクもしない）。
 */

function canvas(size: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  return { c, ctx }
}

function finish(c: HTMLCanvasElement, repeat = 1): THREE.Texture {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 4
  t.colorSpace = THREE.NoColorSpace
  return t
}

/** 紙の繊維。細長い繊維が絡んだ粗さ。ロール状のムラは作らない。 */
export function paperFiberMaps(seed: number): { rough: THREE.Texture; normal: THREE.Texture } {
  const S = 512
  const { ctx } = canvas(S)
  const rng = makeRng(seed)
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, S, S)
  ctx.lineCap = 'round'
  for (let i = 0; i < 5200; i++) {
    const x = rng() * S
    const y = rng() * S
    const a = (rng() - 0.5) * 0.9 + (rng() < 0.5 ? 0 : Math.PI / 2)
    const len = 6 + rng() * 26
    const v = 128 + (rng() - 0.5) * 74
    ctx.strokeStyle = `rgb(${v | 0},${v | 0},${v | 0})`
    ctx.lineWidth = 0.6 + rng() * 1.1
    ctx.globalAlpha = 0.35
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  const img = ctx.getImageData(0, 0, S, S)
  // 粗さマップ: 繊維の明暗をそのまま微小な粗さの差にする
  const { c: rc, ctx: rctx } = canvas(S)
  const rimg = rctx.createImageData(S, S)
  for (let i = 0; i < S * S; i++) {
    const v = img.data[i * 4]
    const r = 205 + (v - 128) * 0.32
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = Math.max(0, Math.min(255, r))
    rimg.data[i * 4 + 3] = 255
  }
  rctx.putImageData(rimg, 0, 0)

  // 法線マップ: 高さ=繊維の明暗から差分
  const { c: nc, ctx: nctx } = canvas(S)
  const nimg = nctx.createImageData(S, S)
  const h = (x: number, y: number) => img.data[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255
  const strength = 1.1
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength
      let nx = -dx
      let ny = -dy
      const nz = 1
      const l = Math.hypot(nx, ny, nz)
      nx /= l
      ny /= l
      const i = (y * S + x) * 4
      nimg.data[i] = (nx * 0.5 + 0.5) * 255
      nimg.data[i + 1] = (ny * 0.5 + 0.5) * 255
      nimg.data[i + 2] = (nz / l) * 255
      nimg.data[i + 3] = 255
    }
  }
  nctx.putImageData(nimg, 0, 0)
  return { rough: finish(rc), normal: finish(nc) }
}

/** 作業机の木目。使い込んだ縁の擦れは別途 頂点色 / AO で与える。 */
export function woodMaps(seed: number): { color: THREE.Texture; rough: THREE.Texture } {
  const S = 512
  const rng = makeRng(seed)
  const { c, ctx } = canvas(S)
  ctx.fillStyle = '#9a7247'
  ctx.fillRect(0, 0, S, S)
  for (let i = 0; i < 190; i++) {
    const y = rng() * S
    const amp = 2 + rng() * 7
    const w = 1 + rng() * 5
    const dark = rng() * 0.5
    ctx.strokeStyle = `rgba(${(96 + rng() * 40) | 0},${(66 + rng() * 30) | 0},${(38 + rng() * 22) | 0},${0.18 + dark * 0.4})`
    ctx.lineWidth = w
    ctx.beginPath()
    for (let x = 0; x <= S; x += 8) {
      const yy = y + Math.sin(x * 0.017 + i) * amp + Math.sin(x * 0.052 + i * 2.3) * amp * 0.35
      if (x === 0) ctx.moveTo(x, yy)
      else ctx.lineTo(x, yy)
    }
    ctx.stroke()
  }
  for (let i = 0; i < 14; i++) {
    const x = rng() * S
    const y = rng() * S
    const r = 3 + rng() * 8
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(70,46,26,0.75)')
    g.addColorStop(1, 'rgba(70,46,26,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const color = finish(c, 1)
  color.colorSpace = THREE.SRGBColorSpace

  const { c: rc, ctx: rctx } = canvas(S)
  const src = ctx.getImageData(0, 0, S, S)
  const out = rctx.createImageData(S, S)
  for (let i = 0; i < S * S; i++) {
    const v = src.data[i * 4]
    const r = 120 + (160 - v) * 0.45
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = Math.max(0, Math.min(255, r))
    out.data[i * 4 + 3] = 255
  }
  rctx.putImageData(out, 0, 0)
  return { color, rough: finish(rc, 1) }
}

/** 冬の窓の外。空と遠くの木立だけ。霧で埋めない。 */
export function windowSky(): THREE.Texture {
  const W = 256
  const H = 256
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#b7cbdc')
  g.addColorStop(0.62, '#d6e2ea')
  g.addColorStop(1, '#e7eef2')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  const rng = makeRng(77)
  ctx.fillStyle = 'rgba(120,138,131,0.55)'
  for (let i = 0; i < 26; i++) {
    const x = rng() * W
    const h = 26 + rng() * 46
    const w = 8 + rng() * 12
    ctx.beginPath()
    ctx.moveTo(x, H * 0.78)
    ctx.lineTo(x + w / 2, H * 0.78 - h)
    ctx.lineTo(x + w, H * 0.78)
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = 'rgba(246,248,250,0.95)'
  ctx.fillRect(0, H * 0.78, W, H * 0.22)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
