/** The whole game lives in this plain data model, so an orientation change
 *  (which only ever touches camera + canvas size) can never lose progress. */

export type PieceKind =
  | 'house'
  | 'fir'
  | 'lamp'
  | 'bridge'
  | 'snowman'
  | 'deer'
  | 'centerTree'

export type PedestalKind = 'oak' | 'ceramic' | 'brass'

export interface PlacedPiece {
  id: number
  kind: PieceKind
  /** Position on the base disc, in globe-local metres. */
  x: number
  z: number
  rotY: number
  /** Index into the kind's palette — keeps saves tiny and colours reproducible. */
  paint: number
}

export interface GlobeRecipe {
  v: 1
  id: string
  created: number
  seed: number
  pieces: PlacedPiece[]
  /** 0..1 — how much snow was scooped in. */
  snow: number
  pedestal: PedestalKind
}

export const MAX_PIECES = 5
export const MIN_PIECES = 3
export const MAX_SAVED = 3

export type Stage =
  | 'title'
  | 'town'
  | 'snow'
  | 'liquid'
  | 'seal'
  | 'invert'
  | 'mount'
  | 'shake'
  | 'dive'
  | 'inside'
  | 'finale'

export const STAGE_ORDER: Stage[] = [
  'town',
  'snow',
  'liquid',
  'seal',
  'invert',
  'mount',
  'shake',
  'dive',
  'inside',
  'finale',
]

export interface Settings {
  sound: boolean
  /** Weakens camera travel and slows transitions. */
  calmCamera: boolean
  /** Removes the lamp flicker and softens light changes. */
  steadyLight: boolean
  motionShake: boolean
}

export function defaultSettings(): Settings {
  const reduce =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  return { sound: true, calmCamera: reduce, steadyLight: reduce, motionShake: false }
}

export function newRecipe(): GlobeRecipe {
  return {
    v: 1,
    id: 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36),
    created: Date.now(),
    seed: (Math.random() * 0xffffffff) >>> 0,
    pieces: [],
    snow: 0,
    pedestal: 'oak',
  }
}

/** Live, non-persisted build state for the globe currently on the bench. */
export class BuildState {
  recipe: GlobeRecipe = newRecipe()
  stage: Stage = 'title'
  /** 0..1 of the sphere's usable interior height. */
  liquid = 0
  /** 0..1 gasket seated depth. */
  gasket = 0
  /** 0..1 collar tightened. */
  collar = 0
  /** 0..1 of a full 180 deg flip. */
  invert = 0
  mounted = false
  /** Times the player has shaken this globe — only used to vary the coach hint. */
  shakes = 0

  reset(recipe?: GlobeRecipe) {
    this.recipe = recipe ?? newRecipe()
    this.liquid = 0
    this.gasket = 0
    this.collar = 0
    this.invert = 0
    this.mounted = false
    this.shakes = 0
  }

  /** Restores a saved globe straight into its finished, shakeable form. */
  loadFinished(recipe: GlobeRecipe) {
    this.recipe = recipe
    this.liquid = 1
    this.gasket = 1
    this.collar = 1
    this.invert = 1
    this.mounted = true
    this.shakes = 0
  }
}
