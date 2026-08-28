import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'

function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCanvas(size: number) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return c
}

/** small value-noise field, tileable enough for surface detail */
function noiseField(size: number, cells: number, rnd: () => number) {
  const g = new Float32Array(cells * cells)
  for (let i = 0; i < g.length; i++) g[i] = rnd()
  const out = new Float32Array(size * size)
  const s = size / cells
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / s
      const fy = y / s
      const x0 = Math.floor(fx) % cells
      const y0 = Math.floor(fy) % cells
      const x1 = (x0 + 1) % cells
      const y1 = (y0 + 1) % cells
      let tx = fx - Math.floor(fx)
      let ty = fy - Math.floor(fy)
      tx = tx * tx * (3 - 2 * tx)
      ty = ty * ty * (3 - 2 * ty)
      const a = g[y0 * cells + x0]
      const b = g[y0 * cells + x1]
      const c = g[y1 * cells + x0]
      const d = g[y1 * cells + x1]
      out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty
    }
  }
  return out
}

function fbm(size: number, rnd: () => number, octaves = 4, base = 4) {
  const out = new Float32Array(size * size)
  let amp = 1
  let sum = 0
  for (let o = 0; o < octaves; o++) {
    const f = noiseField(size, base << o, rnd)
    for (let i = 0; i < out.length; i++) out[i] += f[i] * amp
    sum += amp
    amp *= 0.5
  }
  for (let i = 0; i < out.length; i++) out[i] /= sum
  return out
}

function toTexture(canvas: HTMLCanvasElement, srgbSpace: boolean, repeat = 1): Texture {
  const t = new CanvasTexture(canvas)
  if (srgbSpace) t.colorSpace = SRGBColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 8
  return t
}

export interface SurfaceMaps {
  map: Texture
  roughnessMap: Texture
  bumpMap: Texture
}

/**
 * Worn grey non-slip deck paint over plywood: grain in one direction only,
 * asymmetric wear near the fishing hole, damp patches that are not mirrored.
 */
export function deckMaps(size = 512): SurfaceMaps {
  const rnd = mulberry(20260827)
  const grain = fbm(size, rnd, 4, 3)
  const speck = fbm(size, rnd, 3, 48)
  const wear = fbm(size, rnd, 3, 2)

  const col = makeCanvas(size)
  const rgh = makeCanvas(size)
  const bmp = makeCanvas(size)
  const cd = col.getContext('2d')!.createImageData(size, size)
  const rd = rgh.getContext('2d')!.createImageData(size, size)
  const bd = bmp.getContext('2d')!.createImageData(size, size)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      // grain runs along X only
      const gx = grain[(y % size) * size + ((x * 3) % size)]
      const g = grain[i] * 0.55 + gx * 0.45
      const sp = speck[i]
      const w = wear[i]
      // paint worn through to ply in an off-centre band
      const nx = x / size - 0.42
      const ny = y / size - 0.57
      const worn = Math.max(0, 1 - Math.hypot(nx * 1.35, ny) * 3.1) * (0.35 + w * 0.9)
      let r = 0.315 + g * 0.05 - sp * 0.045
      let gg = 0.328 + g * 0.048 - sp * 0.045
      let b = 0.312 + g * 0.042 - sp * 0.045
      // where the paint is worn through, plywood shows warmer
      r = r + worn * 0.115
      gg = gg + worn * 0.062
      b = b + worn * 0.012
      // dark damp streaks, only on one side
      const damp = Math.max(0, w - 0.56) * (nx > -0.1 ? 2.2 : 0.5)
      r -= damp * 0.16
      gg -= damp * 0.15
      b -= damp * 0.12

      const o = i * 4
      cd.data[o] = Math.min(255, Math.max(0, r * 255))
      cd.data[o + 1] = Math.min(255, Math.max(0, gg * 255))
      cd.data[o + 2] = Math.min(255, Math.max(0, b * 255))
      cd.data[o + 3] = 255

      // rough paint, but the damp band and the polished worn patch are smoother
      const rough = 0.94 - damp * 0.5 - worn * 0.18 + (sp - 0.5) * 0.12
      const rv = Math.min(255, Math.max(0, rough * 255))
      rd.data[o] = rd.data[o + 1] = rd.data[o + 2] = rv
      rd.data[o + 3] = 255

      const bump = sp * 0.75 + g * 0.25
      const bv = Math.min(255, Math.max(0, bump * 255))
      bd.data[o] = bd.data[o + 1] = bd.data[o + 2] = bv
      bd.data[o + 3] = 255
    }
  }
  col.getContext('2d')!.putImageData(cd, 0, 0)
  rgh.getContext('2d')!.putImageData(rd, 0, 0)
  bmp.getContext('2d')!.putImageData(bd, 0, 0)
  return { map: toTexture(col, true, 2), roughnessMap: toTexture(rgh, false, 2), bumpMap: toTexture(bmp, false, 2) }
}

/** brushed, scuffed light alloy for the reel body and the hole liner */
export function metalMaps(size = 256, tint = [0.62, 0.63, 0.64]): SurfaceMaps {
  const rnd = mulberry(7717)
  const brush = fbm(size, rnd, 3, 6)
  const scratch = fbm(size, rnd, 2, 64)
  const col = makeCanvas(size)
  const rgh = makeCanvas(size)
  const bmp = makeCanvas(size)
  const cd = col.getContext('2d')!.createImageData(size, size)
  const rd = rgh.getContext('2d')!.createImageData(size, size)
  const bd = bmp.getContext('2d')!.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const b = brush[(y % size) * size + ((x * 8) % size)]
      const s = scratch[i]
      const o = i * 4
      const v = 0.86 + b * 0.18 - s * 0.1
      cd.data[o] = Math.min(255, tint[0] * v * 255)
      cd.data[o + 1] = Math.min(255, tint[1] * v * 255)
      cd.data[o + 2] = Math.min(255, tint[2] * v * 255)
      cd.data[o + 3] = 255
      const rough = 0.42 + b * 0.3 + (s > 0.7 ? 0.22 : 0)
      const rv = Math.min(255, rough * 255)
      rd.data[o] = rd.data[o + 1] = rd.data[o + 2] = rv
      rd.data[o + 3] = 255
      const bv = Math.min(255, (b * 0.5 + s * 0.5) * 255)
      bd.data[o] = bd.data[o + 1] = bd.data[o + 2] = bv
      bd.data[o + 3] = 255
    }
  }
  col.getContext('2d')!.putImageData(cd, 0, 0)
  rgh.getContext('2d')!.putImageData(rd, 0, 0)
  bmp.getContext('2d')!.putImageData(bd, 0, 0)
  return { map: toTexture(col, true, 1), roughnessMap: toTexture(rgh, false, 1), bumpMap: toTexture(bmp, false, 1) }
}

/** wakasagi flank: dark olive back, pale belly, faint lateral line */
export function fishSkin(size = 256): Texture {
  const c = makeCanvas(size)
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, size)
  g.addColorStop(0.0, '#414738')
  g.addColorStop(0.22, '#6d7360')
  g.addColorStop(0.42, '#b6bcab')
  g.addColorStop(0.55, '#e4e6da')
  g.addColorStop(0.76, '#efece0')
  g.addColorStop(1.0, '#d8d4c6')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const rnd = mulberry(4242)
  ctx.globalAlpha = 0.11
  for (let i = 0; i < 900; i++) {
    const x = rnd() * size
    const y = rnd() * size
    ctx.fillStyle = rnd() > 0.5 ? '#2c3129' : '#e8e5d8'
    ctx.fillRect(x, y, 1.6, 1.2)
  }
  ctx.globalAlpha = 0.22
  ctx.fillStyle = '#2f342b'
  ctx.fillRect(0, size * 0.45, size, 1.8)
  ctx.globalAlpha = 1
  return toTexture(c, true, 1)
}

/** cold winter light seen through a fogged boat window */
export function windowGlow(size = 128): Texture {
  const c = makeCanvas(size)
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, size)
  g.addColorStop(0, '#cfd8dd')
  g.addColorStop(0.55, '#aab6bd')
  g.addColorStop(1, '#7e8a90')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const rnd = mulberry(99)
  ctx.globalAlpha = 0.25
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(rnd() * size, rnd() * size, rnd() * 5 + 1, 0, 7)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  return toTexture(c, true, 1)
}
