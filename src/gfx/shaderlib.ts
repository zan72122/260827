import { Color, Material, Vector2, Vector3, type IUniform } from 'three'

/**
 * One set of uniforms shared by every material in the scene, above and below
 * the water, so the two halves can never tell different stories.
 */
export const U: Record<string, IUniform> = {
  uAxis: { value: new Vector2(0, 0) },
  uCamF: { value: new Vector2(0.75, 0.66) }, // XZ unit vector, axis -> camera
  uCamPos: { value: new Vector3(0, 1, 3) },
  uWaterY: { value: 0 },
  uTime: { value: 0 },
  uCutDeck: { value: 1 },
  uCutSurface: { value: 1 },
  uDeckR: { value: 2.0 },
  uDeckW: { value: 1.0 },
  uSurfR: { value: 2.0 },
  uSurfW: { value: 0.95 },
  uPocket: { value: 1 },
  uPocketC: { value: new Vector3(0, -1.25, 0) },
  uPocketR: { value: new Vector3(0.85, 0.95, 0.85) },
  uMurkIn: { value: 0.1 },
  uMurkOut: { value: 1.55 },
  uRipple: { value: new Vector2(0, 9) }, // amplitude, seconds since it started
  uSun: { value: new Vector3(-0.45, 0.72, -0.52) },
}

/** shared GLSL: the local cutaway masks and the underwater medium */
export const COMMON_GLSL = /* glsl */ `
uniform vec2  uAxis;
uniform vec2  uCamF;
uniform vec3  uCamPos;
uniform float uWaterY;
uniform float uCutDeck;
uniform float uCutSurface;
uniform float uDeckR;
uniform float uDeckW;
uniform float uSurfR;
uniform float uSurfW;
uniform float uPocket;
uniform vec3  uPocketC;
uniform vec3  uPocketR;
uniform float uMurkIn;
uniform float uMurkOut;

vec2 axisFrame( vec2 p ) {
  vec2 d = p - uAxis;
  return vec2( dot( d, uCamF ), dot( d, vec2( -uCamF.y, uCamF.x ) ) );
}

// near-side core removed from the deck: a clean sectioned face, no soft edge
// the section opens toward the viewer like a core taken out of the boat,
// so the edge of the cut is a curve rather than a straight razor line
float deckCut( vec3 wp ) {
  vec2 f = axisFrame( wp.xz );
  float w = uDeckW * ( 0.46 + 0.54 * smoothstep( 0.0, 0.62, f.x ) );
  float inFan = step( 0.0, f.x ) * step( f.x, uDeckR ) * step( abs( f.y ), w );
  return uCutDeck * inFan;
}

// near-side wedge of the water surface removed, but the ring where the line
// enters is kept so its ripples stay readable
float surfaceCut( vec3 wp ) {
  vec2 f = axisFrame( wp.xz );
  float r = length( wp.xz - uAxis );
  float keepEntry = smoothstep( 0.15, 0.25, r );
  float near = smoothstep( 0.02, 0.62, f.x );
  float outer = 1.0 - smoothstep( uSurfR, uSurfR + 1.4, f.x );
  float lat = 1.0 - smoothstep( uSurfW, uSurfW + 0.42, abs( f.y ) );
  return clamp( uCutSurface * keepEntry * near * outer * lat, 0.0, 1.0 );
}

// the pocket of clear water around the bait; everything else stays murky
float pocket( vec3 wp ) {
  vec2 f = axisFrame( wp.xz );
  vec2 fc = axisFrame( uPocketC.xz );
  vec3 e = vec3( ( f.x - fc.x ) / uPocketR.z, ( wp.y - uPocketC.y ) / uPocketR.y, ( f.y - fc.y ) / uPocketR.x );
  return uPocket * ( 1.0 - smoothstep( 0.52, 1.0, length( e ) ) );
}

vec3 waterTint( float y ) {
  float d = clamp( uWaterY - y, 0.0, 8.0 );
  vec3 c = mix( vec3( 0.108, 0.133, 0.116 ), vec3( 0.046, 0.072, 0.086 ), smoothstep( 0.0, 1.7, d ) );
  return mix( c, vec3( 0.014, 0.026, 0.042 ), smoothstep( 1.5, 4.4, d ) );
}

// light scattered into the eye along the view ray; this is what a distant
// object fades into, and what the far wall of the water is made of
vec3 inscatter( vec3 wp ) {
  vec3 dir = normalize( wp - uCamPos );
  return waterTint( min( uCamPos.y, uWaterY ) + dir.y * 3.1 );
}

// distance the light actually travelled through water before reaching the eye
float waterPath( vec3 wp ) {
  float camAbove = step( uWaterY, uCamPos.y );
  float frac = camAbove * clamp( ( uCamPos.y - uWaterY ) / max( uCamPos.y - wp.y, 1e-4 ), 0.0, 1.0 );
  return distance( uCamPos, wp ) * ( 1.0 - frac );
}

vec3 applyWater( vec3 rgb, vec3 wp ) {
  float under = clamp( ( uWaterY - wp.y ) * 14.0, 0.0, 1.0 );
  if ( under <= 0.001 ) return rgb;
  float k = mix( uMurkOut, uMurkIn, clamp( pocket( wp ), 0.0, 1.0 ) );
  float f = 1.0 - exp( -k * waterPath( wp ) );
  vec3 att = exp( -vec3( 0.66, 0.31, 0.17 ) * clamp( uWaterY - wp.y, 0.0, 8.0 ) );
  vec3 c = rgb * mix( vec3( 1.0 ), att, under );
  return mix( c, inscatter( wp ), f * under );
}
`

export interface WaterHookOptions {
  /** this mesh is part of the deck and can be sectioned away */
  deckCut?: boolean
  /** this mesh lives under the surface and is dimmed / hidden by the medium */
  underwater?: boolean
  /** fade the mesh out with the pocket instead of hard-hiding it (fish silhouettes) */
  extraFragment?: string
}

/**
 * Attaches the shared world uniforms to a standard material. Every object is
 * lit and occluded by the same medium description, so the above-water and
 * below-water halves stay consistent.
 */
export function hookMaterial(mat: Material, opts: WaterHookOptions = {}) {
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(U)) shader.uniforms[k] = U[k]
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWorldPos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
        #else
          vWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        #endif`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPos;\n${COMMON_GLSL}`)
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        ${opts.deckCut ? 'if ( deckCut( vWorldPos ) > 0.5 ) discard;' : ''}`
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        ${opts.underwater ? 'gl_FragColor.rgb = applyWater( gl_FragColor.rgb, vWorldPos );' : ''}
        ${opts.extraFragment ?? ''}`
      )
  }
  mat.customProgramCacheKey = () =>
    `cw_${opts.deckCut ? 1 : 0}_${opts.underwater ? 1 : 0}_${opts.extraFragment ? opts.extraFragment.length : 0}`
  return mat
}

export const srgb = (hex: number) => new Color().setHex(hex, 'srgb')
