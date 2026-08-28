import * as THREE from 'three'

/* ------------------------------------------------------------------ *
 * Procedural texture library.
 * Every surface in the game is generated here: there are no stand-in
 * assets. The goal is readable *material*, not decoration -- aggregate
 * in the concrete, spangle in the galvanising, scuffs only where a rig
 * actually rubs the inside of the bait tub.
 * ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Tileable value noise. */
function makeNoise(seed: number, period = 64) {
  const rnd = mulberry32(seed)
  const grid = new Float32Array(period * period)
  for (let i = 0; i < grid.length; i++) grid[i] = rnd()
  const at = (x: number, y: number) => grid[(((y % period) + period) % period) * period + (((x % period) + period) % period)]
  const smooth = (t: number) => t * t * (3 - 2 * t)
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y)
    const xf = smooth(x - xi), yf = smooth(y - yi)
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1)
    return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf
  }
}

function fbm(seed: number, period = 64) {
  const layers = [makeNoise(seed, period), makeNoise(seed + 91, period), makeNoise(seed + 613, period), makeNoise(seed + 1721, period)]
  return (x: number, y: number, scale: number) => {
    let v = 0, amp = 0.5, f = scale, total = 0
    for (let i = 0; i < layers.length; i++) {
      v += layers[i](x * f, y * f) * amp
      total += amp
      amp *= 0.5
      f *= 2
    }
    return v / total
  }
}

function canvas2d(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  return [c, ctx]
}

function toTexture(c: HTMLCanvasElement, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 4
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Derive a normal map from a single-channel height canvas. */
function heightToNormal(src: HTMLCanvasElement, strength: number) {
  const size = src.width
  const sctx = src.getContext('2d')!
  const h = sctx.getImageData(0, 0, size, size).data
  const [c, ctx] = canvas2d(size)
  const out = ctx.createImageData(size, size)
  const H = (x: number, y: number) => h[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength
      let nx = -dx, ny = -dy, nz = 1
      const l = Math.hypot(nx, ny, nz)
      nx /= l; ny /= l; nz /= l
      const i = (y * size + x) * 4
      out.data[i] = (nx * 0.5 + 0.5) * 255
      out.data[i + 1] = (ny * 0.5 + 0.5) * 255
      out.data[i + 2] = (nz * 0.5 + 0.5) * 255
      out.data[i + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  const t = toTexture(c, 1, false)
  return t
}

export interface Surface {
  map: THREE.Texture
  roughnessMap?: THREE.Texture
  normalMap?: THREE.Texture
}

let cache: Record<string, Surface> = {}
function cached(key: string, build: () => Surface): Surface {
  if (!cache[key]) cache[key] = build()
  return cache[key]
}

/* ---------------------------- concrete ---------------------------- */
/** Deck concrete: exposed aggregate, drainage streaks running seaward,
 *  damp patches in the low corner, salt bloom near the edge. */
export function concrete(): Surface {
  return cached('concrete', () => {
    const size = 512
    const [c, ctx] = canvas2d(size)
    const [rc, rctx] = canvas2d(size)
    const [hc, hctx] = canvas2d(size)
    const n = fbm(7, 64)
    const rnd = mulberry32(21)
    const img = ctx.createImageData(size, size)
    const rimg = rctx.createImageData(size, size)
    const himg = hctx.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size
        const base = n(u, v, 12) * 0.55 + n(u, v, 48) * 0.45
        // v is the seaward axis: damp increases toward v=1 (the edge)
        const damp = Math.pow(Math.max(0, v - 0.35) / 0.65, 1.7) * (0.45 + 0.55 * n(u, v, 6))
        // drainage streaks: elongated along v
        const streak = n(u * 6, v * 0.35, 8)
        let g = 0.60 + (base - 0.5) * 0.28
        g -= damp * 0.20
        g -= Math.max(0, streak - 0.55) * 0.18
        const i = (y * size + x) * 4
        const tint = 1 - damp * 0.06
        img.data[i] = Math.min(255, g * 255 * 1.02 * tint)
        img.data[i + 1] = Math.min(255, g * 255 * 1.0 * tint)
        img.data[i + 2] = Math.min(255, g * 255 * 0.955)
        img.data[i + 3] = 255
        let rough = 0.92 - damp * 0.34 + (base - 0.5) * 0.1
        rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = Math.max(0, Math.min(255, rough * 255))
        rimg.data[i + 3] = 255
        const hgt = base
        himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = hgt * 255
        himg.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    rctx.putImageData(rimg, 0, 0)
    hctx.putImageData(himg, 0, 0)
    // aggregate: pebbles ground flush with the surface
    for (let i = 0; i < 900; i++) {
      const x = rnd() * size, y = rnd() * size, r = 1.6 + rnd() * 4.2
      const l = 0.5 + rnd() * 0.35
      ctx.globalAlpha = 0.35 + rnd() * 0.4
      ctx.fillStyle = `rgb(${(l * 190) | 0},${(l * 188) | 0},${(l * 178) | 0})`
      ctx.beginPath()
      ctx.ellipse(x, y, r, r * (0.6 + rnd() * 0.6), rnd() * 3.14, 0, 6.29)
      ctx.fill()
      hctx.globalAlpha = 0.5
      hctx.fillStyle = `rgb(${(l * 255) | 0},${(l * 255) | 0},${(l * 255) | 0})`
      hctx.beginPath()
      hctx.ellipse(x, y, r, r * 0.8, 0, 0, 6.29)
      hctx.fill()
    }
    // salt bloom, only on the seaward third
    ctx.globalAlpha = 1
    for (let i = 0; i < 220; i++) {
      const x = rnd() * size, y = size * (0.62 + rnd() * 0.38), r = 3 + rnd() * 16
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, 'rgba(232,230,222,0.30)')
      g.addColorStop(1, 'rgba(232,230,222,0)')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.29); ctx.fill()
    }
    hctx.globalAlpha = 1
    return { map: toTexture(c, 1), roughnessMap: toTexture(rc, 1, false), normalMap: heightToNormal(hc, 2.2) }
  })
}

/* --------------------------- galvanised --------------------------- */
/** Hot-dip galvanised rail: crystalline spangle, hand polish on top of
 *  the tube, salt run only down the seaward face. u wraps the tube. */
export function galvanized(): Surface {
  return cached('galv', () => {
    const size = 256
    const [c, ctx] = canvas2d(size)
    const [rc, rctx] = canvas2d(size)
    const [hc, hctx] = canvas2d(size)
    const rnd = mulberry32(5)
    // spangle: scattered crystal seeds, nearest-seed cell shading
    const seeds: { x: number; y: number; l: number }[] = []
    for (let i = 0; i < 70; i++) seeds.push({ x: rnd() * size, y: rnd() * size, l: 0.78 + rnd() * 0.3 })
    const img = ctx.createImageData(size, size)
    const rimg = rctx.createImageData(size, size)
    const himg = hctx.createImageData(size, size)
    const n = fbm(33, 32)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let best = 1e9, bl = 1, second = 1e9
        for (const s of seeds) {
          let dx = Math.abs(s.x - x); dx = Math.min(dx, size - dx)
          let dy = Math.abs(s.y - y); dy = Math.min(dy, size - dy)
          const d = dx * dx + dy * dy
          if (d < best) { second = best; best = d; bl = s.l } else if (d < second) second = d
        }
        const edge = Math.min(1, (Math.sqrt(second) - Math.sqrt(best)) / 4)
        const u = x / size, v = y / size
        const grain = n(u, v, 22)
        let l = bl * (0.9 + grain * 0.2) * (0.86 + edge * 0.14)
        // sea-facing band (u 0.25-0.75): dull white corrosion + salt run
        const sea = Math.max(0, 1 - Math.abs(u - 0.5) / 0.3)
        const run = Math.max(0, n(u * 3, v * 0.25, 9) - 0.5) * 2
        l = l * (1 - sea * run * 0.22) + sea * run * 0.30
        // hand-polished band near u=0 (the top of the tube)
        const hand = Math.max(0, 1 - Math.min(Math.abs(u), 1 - Math.abs(u)) / 0.16)
        const i = (y * size + x) * 4
        img.data[i] = Math.min(255, l * 168)
        img.data[i + 1] = Math.min(255, l * 172)
        img.data[i + 2] = Math.min(255, l * 174)
        img.data[i + 3] = 255
        const rough = 0.58 - hand * 0.26 + sea * run * 0.22 + (grain - 0.5) * 0.12
        rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = Math.max(0, Math.min(255, rough * 255))
        rimg.data[i + 3] = 255
        himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = (0.35 + edge * 0.4 + grain * 0.25) * 255
        himg.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    rctx.putImageData(rimg, 0, 0)
    hctx.putImageData(himg, 0, 0)
    return { map: toTexture(c, 1), roughnessMap: toTexture(rc, 1, false), normalMap: heightToNormal(hc, 1.1) }
  })
}

/* ----------------------------- resin ------------------------------ */
/** Bait tub: thick moulded polypropylene, mould texture outside,
 *  scuffed only on the inside where rigs are drawn through. */
export function resin(inside: boolean): Surface {
  return cached('resin' + (inside ? 'i' : 'o'), () => {
    const size = 256
    const [c, ctx] = canvas2d(size)
    const [rc, rctx] = canvas2d(size)
    const [hc, hctx] = canvas2d(size)
    const n = fbm(inside ? 111 : 71, 32)
    const rnd = mulberry32(inside ? 9 : 4)
    const img = ctx.createImageData(size, size)
    const rimg = rctx.createImageData(size, size)
    const himg = hctx.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size
        // near-white detail map: the tint comes from the material colour,
        // so a dark map here would multiply down to black
        const grain = n(u, v, 40)
        const l = 0.90 + (grain - 0.5) * 0.07
        const i = (y * size + x) * 4
        img.data[i] = l * 255 * 0.98
        img.data[i + 1] = l * 255 * 1.0
        img.data[i + 2] = l * 255 * 0.99
        img.data[i + 3] = 255
        const rough = inside ? 0.52 + (grain - 0.5) * 0.2 : 0.66 + (grain - 0.5) * 0.16
        rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = rough * 255
        rimg.data[i + 3] = 255
        himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = grain * 255
        himg.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    rctx.putImageData(rimg, 0, 0)
    hctx.putImageData(himg, 0, 0)
    if (inside) {
      // wear polish: fine parallel scratches along the draw direction only
      for (let i = 0; i < 260; i++) {
        const y = rnd() * size
        const len = 30 + rnd() * 180
        const x = rnd() * size
        ctx.strokeStyle = `rgba(255,255,252,${0.10 + rnd() * 0.18})`
        ctx.lineWidth = 0.6 + rnd() * 1.3
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y + (rnd() - 0.5) * 4); ctx.stroke()
        rctx.strokeStyle = `rgba(70,70,70,${0.2 + rnd() * 0.3})`
        rctx.lineWidth = 1 + rnd() * 2
        rctx.beginPath(); rctx.moveTo(x, y); rctx.lineTo(x + len, y + (rnd() - 0.5) * 4); rctx.stroke()
      }
    }
    return { map: toTexture(c, 1), roughnessMap: toTexture(rc, 1, false), normalMap: heightToNormal(hc, inside ? 0.5 : 0.9) }
  })
}

/* ------------------------------ ami ------------------------------- */
/** Wet krill mass: irregular pale-pink translucent fragments packed
 *  together, darker where the packing is dense and wet. */
export function amiMass(light = false): Surface {
  return cached('ami' + (light ? 'L' : ''), () => {
    const size = 256
    const [c, ctx] = canvas2d(size)
    const [rc, rctx] = canvas2d(size)
    const [hc, hctx] = canvas2d(size)
    ctx.fillStyle = light ? '#d8a396' : '#a8756a'
    ctx.fillRect(0, 0, size, size)
    hctx.fillStyle = '#4a4a4a'
    hctx.fillRect(0, 0, size, size)
    rctx.fillStyle = '#4d4d4d'
    rctx.fillRect(0, 0, size, size)
    const rnd = mulberry32(17)
    for (let i = 0; i < 2200; i++) {
      const x = rnd() * size, y = rnd() * size
      const w = 2.5 + rnd() * 10, h = w * (0.18 + rnd() * 0.26)
      const a = rnd() * 6.29
      const t = rnd()
      // pale pink through salmon: shrimp flesh, translucent at the edges
      const warm = rnd() * 0.55
      const r = (light ? 246 : 230) + t * 9
      const g = (light ? 198 : 170) + t * 38 - warm * 34
      const b = (light ? 190 : 160) + t * 34 - warm * 44
      ctx.save(); ctx.translate(x, y); ctx.rotate(a)
      ctx.globalAlpha = 0.35 + rnd() * 0.5
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`
      ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, 6.29); ctx.fill()
      ctx.restore()
      hctx.save(); hctx.translate(x, y); hctx.rotate(a)
      hctx.globalAlpha = 0.5
      hctx.fillStyle = `rgb(${(140 + t * 110) | 0},${(140 + t * 110) | 0},${(140 + t * 110) | 0})`
      hctx.beginPath(); hctx.ellipse(0, 0, w, h, 0, 0, 6.29); hctx.fill()
      hctx.restore()
      // wet sheen: low roughness on the top of each fragment
      rctx.save(); rctx.translate(x, y); rctx.rotate(a)
      rctx.globalAlpha = 0.4
      rctx.fillStyle = `rgb(${(50 + rnd() * 60) | 0},0,0)`
      rctx.beginPath(); rctx.ellipse(0, 0, w * 0.7, h * 0.7, 0, 0, 6.29); rctx.fill()
      rctx.restore()
    }
    return { map: toTexture(c, 1), roughnessMap: toTexture(rc, 1, false), normalMap: heightToNormal(hc, 1.6) }
  })
}

/* ------------------------------ fish ------------------------------ */
/** Small baitfish flank: dark olive back, wet silver flank with a
 *  broken lateral stripe, pale belly. v runs back-to-belly. */
export function fishSkin(): Surface {
  return cached('fish', () => {
    const size = 128
    const [c, ctx] = canvas2d(size)
    const g = ctx.createLinearGradient(0, 0, 0, size)
    g.addColorStop(0.0, '#26302b')
    g.addColorStop(0.16, '#38443b')
    g.addColorStop(0.34, '#8a979a')
    g.addColorStop(0.5, '#c3ccc9')
    g.addColorStop(0.62, '#d6dbd6')
    g.addColorStop(0.82, '#c9cdc6')
    g.addColorStop(1.0, '#9aa39c')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    const rnd = mulberry32(3)
    // lateral line, broken
    for (let x = 0; x < size; x += 2) {
      if (rnd() < 0.25) continue
      ctx.fillStyle = `rgba(150,164,166,${0.25 + rnd() * 0.3})`
      ctx.fillRect(x, size * 0.44 + (rnd() - 0.5) * 2, 2, 1.4)
    }
    // scale speckle
    for (let i = 0; i < 900; i++) {
      const x = rnd() * size, y = rnd() * size
      ctx.fillStyle = `rgba(255,255,255,${rnd() * 0.07})`
      ctx.fillRect(x, y, 1.4, 1.0)
    }
    const [rc, rctx] = canvas2d(size)
    const rg = rctx.createLinearGradient(0, 0, 0, size)
    rg.addColorStop(0, '#7a7a7a')
    rg.addColorStop(0.5, '#3d3d3d')
    rg.addColorStop(1, '#5c5c5c')
    rctx.fillStyle = rg
    rctx.fillRect(0, 0, size, size)
    return { map: toTexture(c, 1), roughnessMap: toTexture(rc, 1, false) }
  })
}

/* ------------------------------ wood ------------------------------ */
export function bench(): Surface {
  return cached('bench', () => {
    const size = 256
    const [c, ctx] = canvas2d(size)
    const [rc, rctx] = canvas2d(size)
    const n = fbm(55, 32)
    const img = ctx.createImageData(size, size)
    const rimg = rctx.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size
        const rings = Math.sin((v * 14 + n(u, v, 5) * 0.8) * 6.283) * 0.5 + 0.5
        const g = 0.62 + rings * 0.09 + (n(u, v, 30) - 0.5) * 0.07
        const wet = Math.max(0, n(u, v, 7) - 0.62)
        const i = (y * size + x) * 4
        img.data[i] = g * 255 * 1.0 * (1 - wet * 0.4)
        img.data[i + 1] = g * 255 * 0.93 * (1 - wet * 0.4)
        img.data[i + 2] = g * 255 * 0.83 * (1 - wet * 0.35)
        img.data[i + 3] = 255
        const r = 0.85 - wet * 0.45
        rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = r * 255
        rimg.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    rctx.putImageData(rimg, 0, 0)
    return { map: toTexture(c, 1), roughnessMap: toTexture(rc, 1, false) }
  })
}

/* --------------------------- water ripple -------------------------- */
/** Tiling ripple normal map: crossed swell plus wind chop. */
export function waterNormal(): THREE.Texture {
  const key = 'waterN'
  if ((cache as any)[key]) return (cache as any)[key].map
  const size = 256
  const [hc, hctx] = canvas2d(size)
  const n = fbm(88, 64)
  const img = hctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size
      const swell = Math.sin((u * 2 + v * 0.6) * 6.283) * 0.5 + 0.5
      const chop = n(u, v, 9) * 0.6 + n(u, v, 26) * 0.4
      const h = swell * 0.35 + chop * 0.65
      const i = (y * size + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = h * 255
      img.data[i + 3] = 255
    }
  }
  hctx.putImageData(img, 0, 0)
  const t = heightToNormal(hc, 1.5)
  cache[key] = { map: t }
  return t
}

/** Paint-flaked steel for hull / port hardware in the distance. */
export function paintedSteel(hue: string): Surface {
  return cached('paint' + hue, () => {
    const size = 128
    const [c, ctx] = canvas2d(size)
    ctx.fillStyle = hue
    ctx.fillRect(0, 0, size, size)
    const rnd = mulberry32(hue.length * 31 + 7)
    for (let i = 0; i < 260; i++) {
      const x = rnd() * size, y = rnd() * size, r = 1 + rnd() * 6
      ctx.globalAlpha = 0.08 + rnd() * 0.22
      ctx.fillStyle = rnd() < 0.45 ? '#6d4a33' : '#2b2b28'
      ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.5 + rnd()), rnd() * 3, 0, 6.29); ctx.fill()
    }
    ctx.globalAlpha = 1
    const [rc, rctx] = canvas2d(size)
    rctx.fillStyle = '#8c8c8c'
    rctx.fillRect(0, 0, size, size)
    return { map: toTexture(c, 1), roughnessMap: toTexture(rc, 1, false) }
  })
}

export function disposeTextureCache() {
  for (const k of Object.keys(cache)) {
    const s = cache[k]
    s.map.dispose(); s.roughnessMap?.dispose(); s.normalMap?.dispose()
  }
  cache = {}
}
