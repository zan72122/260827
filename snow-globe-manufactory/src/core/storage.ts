import { MAX_SAVED, type GlobeRecipe, type Settings, defaultSettings } from './state'

const KEY_GLOBES = 'sgm.globes.v1'
const KEY_SETTINGS = 'sgm.settings.v1'

function safeRead(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function safeWrite(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private browsing / quota — the session still plays, it just won't persist */
  }
}

function isRecipe(x: unknown): x is GlobeRecipe {
  if (!x || typeof x !== 'object') return false
  const r = x as Partial<GlobeRecipe>
  return (
    r.v === 1 &&
    typeof r.id === 'string' &&
    Array.isArray(r.pieces) &&
    typeof r.snow === 'number' &&
    typeof r.seed === 'number'
  )
}

export function loadGlobes(): GlobeRecipe[] {
  const raw = safeRead(KEY_GLOBES)
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecipe).slice(0, MAX_SAVED)
}

/** Newest first; keeps at most MAX_SAVED, replacing an entry with the same id. */
export function saveGlobe(recipe: GlobeRecipe): GlobeRecipe[] {
  const rest = loadGlobes().filter((g) => g.id !== recipe.id)
  const next = [recipe, ...rest].slice(0, MAX_SAVED)
  safeWrite(KEY_GLOBES, next)
  return next
}

export function loadSettings(): Settings {
  const raw = safeRead(KEY_SETTINGS)
  const base = defaultSettings()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<Settings>
  return {
    sound: typeof r.sound === 'boolean' ? r.sound : base.sound,
    calmCamera: typeof r.calmCamera === 'boolean' ? r.calmCamera : base.calmCamera,
    steadyLight: typeof r.steadyLight === 'boolean' ? r.steadyLight : base.steadyLight,
    motionShake: typeof r.motionShake === 'boolean' ? r.motionShake : base.motionShake,
  }
}

export function saveSettings(s: Settings) {
  safeWrite(KEY_SETTINGS, s)
}
