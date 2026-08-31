/**
 * 材質と環境光 / materials and lighting environment.
 *
 * 外部配信アセットは使いません。傷や木目はその場で描いたテクスチャです。
 * 金属は全部を同じ金色にせず、シリンダー (機械鋼)、櫛歯 (磨いた薄鋼)、
 * フレーム (鈍い鋳物)、治具 (真鍮)、錘 (鉛)、ねじ (黒染め) を分けています。
 */

import * as THREE from 'three'

function canvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, s: number) => void,
): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  if (ctx) draw(ctx, size)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

/** 加工方向に沿う細い傷。旋盤で挽いた面らしく、周方向に流れる。 */
function machiningRoughness(base: number, streaks: number): THREE.Texture {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = `rgb(${base},${base},${base})`
    ctx.fillRect(0, 0, s, s)
    let seed = 20260830
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let i = 0; i < streaks; i++) {
      const y = rnd() * s
      const v = base + (rnd() * 2 - 1) * 26
      ctx.strokeStyle = `rgb(${v | 0},${v | 0},${v | 0})`
      ctx.lineWidth = rnd() < 0.85 ? 0.6 : 1.4
      ctx.globalAlpha = 0.25 + rnd() * 0.4
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(s, y + (rnd() * 2 - 1) * 1.5)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  })
}

function woodTexture(): { map: THREE.Texture; rough: THREE.Texture } {
  const draw = (light: string, dark: string, lineAlpha: number) =>
    canvasTexture(512, (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, 0, s)
      g.addColorStop(0, light)
      g.addColorStop(1, dark)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, s, s)
      let seed = 7717
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
      for (let i = 0; i < 190; i++) {
        const y = rnd() * s
        ctx.strokeStyle = rnd() < 0.5 ? dark : light
        ctx.globalAlpha = lineAlpha * (0.3 + rnd() * 0.7)
        ctx.lineWidth = 0.6 + rnd() * 2.4
        ctx.beginPath()
        ctx.moveTo(0, y)
        for (let x = 0; x <= s; x += 32) {
          ctx.lineTo(x, y + Math.sin((x / s) * 6.2 + i) * (3 + rnd() * 5))
        }
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    })
  return {
    map: draw('#9c6a3e', '#6d4525', 0.45),
    rough: draw('#8a8a8a', '#b4b4b4', 0.5),
  }
}

export interface Materials {
  cylinder: THREE.MeshStandardMaterial
  pin: THREE.MeshStandardMaterial
  comb: THREE.MeshStandardMaterial
  combWear: THREE.MeshStandardMaterial
  lead: THREE.MeshStandardMaterial
  frame: THREE.MeshStandardMaterial
  brass: THREE.MeshStandardMaterial
  grip: THREE.MeshStandardMaterial
  screw: THREE.MeshStandardMaterial
  slot: THREE.MeshStandardMaterial
  wood: THREE.MeshStandardMaterial
  bench: THREE.MeshStandardMaterial
  wall: THREE.MeshStandardMaterial
  lampShade: THREE.MeshStandardMaterial
  lampGlow: THREE.MeshBasicMaterial
  felt: THREE.MeshStandardMaterial
  fir: THREE.MeshStandardMaterial
  paint: THREE.MeshStandardMaterial
  dispose(): void
}

export function createMaterials(): Materials {
  const turned = machiningRoughness(96, 320)
  turned.repeat.set(1, 8)
  const ground = machiningRoughness(120, 220)
  ground.repeat.set(2, 2)
  const cast = machiningRoughness(150, 90)
  cast.repeat.set(3, 3)
  const timber = woodTexture()
  timber.map.repeat.set(1.6, 1)
  timber.rough.repeat.set(1.6, 1)

  const mats: Materials = {
    // シリンダー: 旋盤で挽いた機械鋼。周方向の細い挽き目。
    cylinder: new THREE.MeshStandardMaterial({
      color: 0xb2b6bb,
      metalness: 0.94,
      roughness: 0.3,
      roughnessMap: turned,
    }),
    // ピン: 引き抜きの鋼線。シリンダーよりわずかに明るい。
    pin: new THREE.MeshStandardMaterial({ color: 0xc6cad0, metalness: 0.95, roughness: 0.22 }),
    // 櫛歯: 磨いた薄鋼。一番よく光る。
    comb: new THREE.MeshStandardMaterial({
      color: 0xc9ced4,
      metalness: 0.9,
      roughness: 0.24,
      roughnessMap: ground,
    }),
    // 歯先の当たり面だけ、繰り返し擦れて光っている。
    combWear: new THREE.MeshStandardMaterial({ color: 0xe8ecf0, metalness: 0.95, roughness: 0.12 }),
    // 調律用の鉛錘。柔らかく鈍い。
    lead: new THREE.MeshStandardMaterial({ color: 0x62666c, metalness: 0.55, roughness: 0.72 }),
    // フレーム・軸受け: 鈍い鋳物。
    frame: new THREE.MeshStandardMaterial({
      color: 0x6c7075,
      metalness: 0.6,
      roughness: 0.68,
      roughnessMap: cast,
    }),
    // 治具: 真鍮。工房の後付けらしく金属色が違う。
    brass: new THREE.MeshStandardMaterial({ color: 0x94793f, metalness: 0.8, roughness: 0.42 }),
    // つまみのローレット/握り: 硬い樹脂。金属ではない。
    grip: new THREE.MeshStandardMaterial({ color: 0x2f2c29, metalness: 0.05, roughness: 0.78 }),
    // ねじ: 黒染め鋼。
    screw: new THREE.MeshStandardMaterial({ color: 0x44484d, metalness: 0.72, roughness: 0.5 }),
    // すり割り (溝の中)。工具が入る場所。
    slot: new THREE.MeshStandardMaterial({ color: 0x1c1e21, metalness: 0.4, roughness: 0.85 }),
    // 響板: 木。
    wood: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: timber.map,
      roughnessMap: timber.rough,
      metalness: 0,
      roughness: 0.66,
    }),
    // 作業台の天板。
    bench: new THREE.MeshStandardMaterial({
      color: 0x8a7256,
      map: timber.map,
      roughnessMap: timber.rough,
      metalness: 0,
      roughness: 0.8,
    }),
    wall: new THREE.MeshStandardMaterial({ color: 0x4d4239, metalness: 0, roughness: 0.95 }),
    lampShade: new THREE.MeshStandardMaterial({
      color: 0x2f3338,
      metalness: 0.45,
      roughness: 0.62,
      side: THREE.DoubleSide,
    }),
    lampGlow: new THREE.MeshBasicMaterial({ color: 0xffeccb }),
    felt: new THREE.MeshStandardMaterial({ color: 0x4a3b46, metalness: 0, roughness: 1 }),
    fir: new THREE.MeshStandardMaterial({ color: 0x2f4a33, metalness: 0, roughness: 0.9 }),
    paint: new THREE.MeshStandardMaterial({ color: 0x9c3a34, metalness: 0.1, roughness: 0.5 }),
    dispose() {
      for (const t of [turned, ground, cast, timber.map, timber.rough]) t.dispose()
      for (const [, v] of Object.entries(this)) {
        if (v instanceof THREE.Material) v.dispose()
      }
    },
  }
  return mats
}

/**
 * 反射に映る周囲を作る。広い作業灯と控えめな窓光、そして部屋の面。
 * 金属が「光源と周囲の形」を映すのはこの環境マップの働きです。
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene()
  const box = (
    w: number,
    h: number,
    d: number,
    color: number,
    x: number,
    y: number,
    z: number,
    emissive = 0,
  ) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ color: emissive ? emissive : color, side: THREE.BackSide }),
    )
    m.position.set(x, y, z)
    env.add(m)
    return m
  }
  // 部屋 (内側を向いた箱)
  box(600, 340, 600, 0x3d3a38, 0, 90, 0)
  const plate = (w: number, h: number, color: number, pos: THREE.Vector3, look: THREE.Vector3) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    )
    m.position.copy(pos)
    m.lookAt(look)
    env.add(m)
  }
  // 広い作業灯 (面光源) — 反射に四角い形が映る
  plate(190, 120, 0xfffaf0, new THREE.Vector3(-40, 190, 90), new THREE.Vector3(0, 0, 0))
  // 控えめな窓光 (左奥、冷たい色)
  plate(140, 190, 0xa9c2dd, new THREE.Vector3(-260, 130, -120), new THREE.Vector3(0, 40, 0))
  // 作業台の天板 (下からの弱い返り)
  plate(400, 400, 0x5d5044, new THREE.Vector3(0, -6, 0), new THREE.Vector3(0, 100, 0))
  // 天井側の広い中間調 — 磨いた鋼が真鍮色に転ばないように
  plate(300, 300, 0x757c84, new THREE.Vector3(30, 250, -30), new THREE.Vector3(0, 0, 0))
  // 奥の棚らしい暗い塊 — 暗部にも形が残るように
  plate(110, 76, 0x6a5f52, new THREE.Vector3(150, 120, -180), new THREE.Vector3(0, 40, 0))

  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  const target = pmrem.fromScene(env, 0.02)
  pmrem.dispose()
  env.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose()
      ;(o.material as THREE.Material).dispose()
    }
  })
  return target.texture
}
