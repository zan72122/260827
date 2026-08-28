import * as THREE from 'three'

/**
 * Every surface texture is generated once into a canvas at boot. It keeps the
 * download to a single JS bundle and lets the wood, frost and paint share one
 * coherent grain instead of arriving from unrelated stock images.
 */

const cache = new Map<string, THREE.Texture>()

function make(
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  wrap: THREE.Wrapping = THREE.RepeatWrapping,
): THREE.Texture {
  const hit = cache.get(key)
  if (hit) return hit
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')!
  draw(ctx, w, h)
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = wrap
  tex.anisotropy = 4
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  cache.set(key, tex)
  return tex
}

function noise2(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
  return n - Math.floor(n)
}

function fbm(x: number, y: number, seed: number, oct = 4): number {
  let v = 0
  let a = 0.5
  let f = 1
  for (let i = 0; i < oct; i++) {
    const xi = Math.floor(x * f)
    const yi = Math.floor(y * f)
    const fx = x * f - xi
    const fy = y * f - yi
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const n00 = noise2(xi, yi, seed + i)
    const n10 = noise2(xi + 1, yi, seed + i)
    const n01 = noise2(xi, yi + 1, seed + i)
    const n11 = noise2(xi + 1, yi + 1, seed + i)
    const nx0 = n00 + (n10 - n00) * sx
    const nx1 = n01 + (n11 - n01) * sx
    v += (nx0 + (nx1 - nx0) * sy) * a
    a *= 0.5
    f *= 2
  }
  return v
}

/** Oiled oak for the workbench: long grain, a few knots, worn lighter patches. */
export function woodTexture(): THREE.Texture {
  return make('wood', 512, 512, (ctx, w, h) => {
    const img = ctx.createImageData(w, h)
    const d = img.data
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w
        const v = y / h
        // Grain runs along X; the ring pattern comes from a warped sine.
        const warp = fbm(u * 3, v * 9, 11, 4) * 0.55
        const rings = Math.sin((v * 26 + warp * 9) * Math.PI) * 0.5 + 0.5
        const fine = fbm(u * 90, v * 22, 3, 3)
        const wear = fbm(u * 2.2, v * 2.2, 27, 3)
        let t = 0.42 + rings * 0.2 + fine * 0.16 + wear * 0.2
        // Knots.
        for (const k of [
          [0.22, 0.34, 0.055],
          [0.71, 0.68, 0.045],
          [0.48, 0.12, 0.03],
        ]) {
          const dx = u - k[0]
          const dy = (v - k[1]) * 1.9
          const r = Math.hypot(dx, dy)
          if (r < k[2] * 3) {
            const ring = Math.sin(r / k[2] * 7) * 0.5 + 0.5
            const m = 1 - Math.min(1, r / (k[2] * 3))
            t = t * (1 - m * 0.8) + (0.2 + ring * 0.16) * m * 0.8
          }
        }
        const i = (y * w + x) * 4
        // Neutral grain: the material colour supplies the species, so the same
        // texture serves the pale bench top and the dark legs without doubling
        // up the orange.
        d[i] = Math.min(255, t * 255 * 1.02)
        d[i + 1] = Math.min(255, t * 255 * 0.95)
        d[i + 2] = Math.min(255, t * 255 * 0.86)
        d[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  })
}

/** Cold, uneven frost on the window pane. */
export function frostTexture(): THREE.Texture {
  return make('frost', 256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h)
    const d = img.data
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w
        const v = y / h
        // Denser toward the frame edges, the way real condensation creeps in.
        const edge = Math.min(1, Math.min(u, 1 - u, v, 1 - v) * 3.4)
        const n = fbm(u * 7, v * 7, 91, 5)
        const crys = Math.pow(fbm(u * 26, v * 26, 55, 3), 2.2)
        const t = 0.55 + (1 - edge) * 0.35 + n * 0.25 + crys * 0.3
        const c = Math.min(255, t * 210)
        const i = (y * w + x) * 4
        d[i] = c * 0.87
        d[i + 1] = c * 0.94
        d[i + 2] = c
        d[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  })
}

/** Fresh snow: fine sparkle without turning the ground into flat white. */
export function snowTexture(): THREE.Texture {
  return make('snow', 256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h)
    const d = img.data
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w
        const v = y / h
        const lumps = fbm(u * 9, v * 9, 5, 4)
        const grain = fbm(u * 120, v * 120, 17, 2)
        const t = 0.78 + lumps * 0.15 + grain * 0.09
        const i = (y * w + x) * 4
        d[i] = Math.min(255, t * 250)
        d[i + 1] = Math.min(255, t * 252)
        d[i + 2] = 255 * Math.min(1, t * 1.02)
        d[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  })
}

/** Slightly chipped enamel paint for the miniatures and the metal fittings. */
export function paintTexture(): THREE.Texture {
  return make('paint', 256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h)
    const d = img.data
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w
        const v = y / h
        const n = fbm(u * 16, v * 16, 63, 3)
        const chip = Math.pow(fbm(u * 44, v * 44, 88, 2), 5) * 1.6
        const t = Math.min(1, 0.82 + n * 0.2 - chip * 0.35)
        const c = t * 255
        const i = (y * w + x) * 4
        d[i] = c
        d[i + 1] = c
        d[i + 2] = c
        d[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  })
}

/** What is beyond the pane: overcast sky grading down to a snowfield. */
export function skyTexture(): THREE.Texture {
  return make('sky', 64, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#9db2c1')
    g.addColorStop(0.5, '#bfd0da')
    g.addColorStop(0.6, '#e2eaee')
    g.addColorStop(1, '#c2ccd1')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }, THREE.ClampToEdgeWrapping)
}

/** Soft round alpha for snow sprites and the contact shadow. */
export function blobTexture(soft = 0.55): THREE.Texture {
  return make(`blob${soft}`, 64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(soft, 'rgba(255,255,255,0.55)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }, THREE.ClampToEdgeWrapping)
}

export function disposeTextures() {
  for (const t of cache.values()) t.dispose()
  cache.clear()
}
