/**
 * Device capability tiering. Chosen once at boot from renderer + screen facts,
 * then used to size DPR, particle budgets and shadow maps. No runtime thrash:
 * the tier never changes, only the DPR clamp adapts if frames get expensive.
 */
export type Tier = 'low' | 'mid' | 'high'

export interface Quality {
  tier: Tier
  /** Upper bound for renderer pixel ratio. */
  maxDpr: number
  /** In-globe snow particle count. */
  snowCount: number
  /** Near-field pour particles at the workbench. */
  pourCount: number
  /** Bubbles rising through the liquid. */
  bubbleCount: number
  shadowMapSize: number
  shadows: boolean
  /** Extra back-face pass on the glass shell (reads as real thickness). */
  glassBackPass: boolean
  /** Distant shelf globes rendered as geometry rather than flat impostors. */
  shelfGeometry: boolean
  /** Draw the far wall of the liquid too; one extra full-sphere layer. */
  liquidBackFace: boolean
}

const TABLE: Record<Tier, Omit<Quality, 'tier'>> = {
  low: {
    maxDpr: 1.4,
    snowCount: 420,
    pourCount: 90,
    bubbleCount: 34,
    shadowMapSize: 512,
    shadows: true,
    glassBackPass: false,
    shelfGeometry: false,
    liquidBackFace: false,
  },
  mid: {
    maxDpr: 2,
    snowCount: 760,
    pourCount: 140,
    bubbleCount: 52,
    shadowMapSize: 1024,
    shadows: true,
    glassBackPass: true,
    shelfGeometry: true,
    liquidBackFace: true,
  },
  high: {
    maxDpr: 2,
    snowCount: 1150,
    pourCount: 190,
    bubbleCount: 70,
    shadowMapSize: 1536,
    shadows: true,
    glassBackPass: true,
    shelfGeometry: true,
    liquidBackFace: true,
  },
}

function detectTier(gl: WebGL2RenderingContext | WebGLRenderingContext): Tier {
  const dbg = gl.getExtension('WEBGL_debug_renderer_info')
  const name = (
    dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
  ).toLowerCase()

  const cores = navigator.hardwareConcurrency ?? 4
  const px = Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1)

  // Apple GPUs are consistently strong; an A12-and-up phone handles the mid set.
  const apple = /apple/.test(name)
  if (apple && cores >= 6 && px >= 1600) return 'high'
  if (apple) return 'mid'

  if (/adreno (7|8)\d\d/.test(name) || /mali-g[7-9]\d/.test(name)) return 'mid'
  if (/swiftshader|software|llvmpipe|angle \(google/.test(name)) return 'low'
  if (cores >= 8 && px >= 2200) return 'high'
  if (cores >= 6) return 'mid'
  return 'low'
}

/** `?q=low|mid|high` forces a tier — for QA, and for a misdetected device. */
function forcedTier(): Tier | null {
  const q = new URLSearchParams(location.search).get('q')
  return q === 'low' || q === 'mid' || q === 'high' ? q : null
}

export function makeQuality(gl: WebGL2RenderingContext | WebGLRenderingContext): Quality {
  const tier = forcedTier() ?? detectTier(gl)
  return { tier, ...TABLE[tier] }
}
