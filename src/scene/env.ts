/**
 * env.ts — workshop light.
 *
 * One window (a warm-white directional light coming in low from the side, so
 * grooves and sawn faces catch light differently), one soft bounce, and a tiny
 * procedural environment map so the steel of the saw has something to reflect.
 */

import * as THREE from 'three'

export function makeEnvironment(renderer: THREE.WebGLRenderer) {
  const W = 96
  const H = 48
  const data = new Float32Array(W * H * 4)
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1) // 0 = top
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1)
      // walls: dim warm brown, darker towards the floor
      let r = 0.10 + 0.10 * (1 - v)
      let g = 0.085 + 0.075 * (1 - v)
      let b = 0.070 + 0.052 * (1 - v)
      // floor
      if (v > 0.72) {
        const f = (v - 0.72) / 0.28
        r = THREE.MathUtils.lerp(r, 0.085, f)
        g = THREE.MathUtils.lerp(g, 0.068, f)
        b = THREE.MathUtils.lerp(b, 0.052, f)
      }
      // the window: a bright rectangle on one wall
      const du = Math.abs(((u - 0.63 + 1.5) % 1) - 0.5)
      const win = smooth(0.42, 0.30, du) * smooth(0.16, 0.06, Math.abs(v - 0.40))
      r += win * 3.1
      g += win * 3.0
      b += win * 2.85
      const i = (y * W + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 1
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.needsUpdate = true
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = pmrem.fromEquirectangular(tex).texture
  pmrem.dispose()
  tex.dispose()
  return env
}

function smooth(a: number, b: number, x: number) {
  const t = THREE.MathUtils.clamp((a - x) / (a - b), 0, 1)
  return t * t * (3 - 2 * t)
}

export type Lights = {
  window: THREE.DirectionalLight
  fill: THREE.HemisphereLight
  bounce: THREE.DirectionalLight
  group: THREE.Group
}

export function makeLights(shadowMapSize: number): Lights {
  const group = new THREE.Group()

  // The window is behind-left of the bench and fairly low, so the grooves of
  // the ring read as ridges and shadows rather than as flat black lines.
  const win = new THREE.DirectionalLight(0xfff1da, 3.55)
  win.position.set(-0.62, 0.86, -0.72)
  win.target.position.set(0.10, 0.03, 0.0)
  win.castShadow = true
  win.shadow.mapSize.set(shadowMapSize, shadowMapSize)
  const cam = win.shadow.camera
  cam.left = -0.46
  cam.right = 0.62
  cam.top = 0.50
  cam.bottom = -0.46
  cam.near = 0.20
  cam.far = 2.1
  win.shadow.bias = -0.00016
  win.shadow.normalBias = 0.0024
  win.shadow.radius = 3.0
  group.add(win, win.target)

  // Warm bounce off the bench, and a cool sky term.
  const fill = new THREE.HemisphereLight(0xc6d6e6, 0x8a6f4c, 0.95)
  group.add(fill)

  // A weak second light from the front-right so the near side is not black.
  const bounce = new THREE.DirectionalLight(0xffdcae, 0.62)
  bounce.position.set(0.85, 0.34, 0.62)
  bounce.target.position.set(0.10, 0.03, 0)
  group.add(bounce, bounce.target)

  return { window: win, fill, bounce, group }
}
