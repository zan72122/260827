/**
 * tissueMaterial.ts — the one draw call that turns the parametric model into pixels.
 *
 * Used both by the pyramid generator (rendering a level into a texture) and by the
 * development preview page. Sampling is a rotated-grid supersample so that the
 * band-limiting is honest rather than merely smooth.
 */

import * as THREE from 'three';
import { TISSUE_MODEL_GLSL, tissueDefines } from './tissueShader';

export interface TissueUniforms {
  uCentre: { value: THREE.Vector2 };
  /** Field width in mm covered by the full quad. */
  uFieldMM: { value: number };
  /** Aspect (height/width) of the target so square millimetres stay square. */
  uAspect: { value: number };
  /** Size of one output texel in mm. */
  uTexelMM: { value: number };
  /** Objective resolution limit in mm. */
  uOptResMM: { value: number };
  /** Focal plane inside the section, mm. */
  uFocusZ: { value: number };
  /** Numerical aperture in force. */
  uNA: { value: number };
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

function fragment(samples: 1 | 2 | 4): string {
  return `
precision highp float;
${tissueDefines()}
varying vec2 vUv;
uniform vec2 uCentre;
uniform float uFieldMM;
uniform float uAspect;
uniform float uTexelMM;
uniform float uOptResMM;
uniform float uFocusZ;
uniform float uNA;
uniform float uDebugMark;

${TISSUE_MODEL_GLSL}

void main() {
  vec2 halfSpan = vec2(uFieldMM, uFieldMM * uAspect) * 0.5;
  // TISSUE +y is depth into the dermis, which must run DOWN the screen.
  vec2 base = uCentre + (vUv - 0.5) * 2.0 * halfSpan * vec2(1.0, -1.0);
  vec3 acc = vec3(0.0);
${supersampleBody(samples)}
  if (uDebugMark > 0.5) {
    // Development only: an absolute millimetre grid plus a ring on the hero anchor.
    // Because both are in real specimen millimetres, any framing or scale error in
    // the pyramid or the compositor shows up immediately as a wrong grid pitch.
    vec2 h = base - vec2(HERO_X, HERO_Y);
    float px = uTexelMM;
    vec2 gm = abs(fract(base / 1.0 + 0.5) - 0.5) * 1.0;
    vec2 gs = abs(fract(base / 0.1 + 0.5) - 0.5) * 0.1;
    float major = 1.0 - smoothstep(px * 0.6, px * 1.8, min(gm.x, gm.y));
    float minor = 1.0 - smoothstep(px * 0.6, px * 1.8, min(gs.x, gs.y));
    acc = mix(acc, vec3(0.05, 0.35, 0.95), minor * 0.45);
    acc = mix(acc, vec3(0.0, 0.75, 0.25), major * 0.85);
    float ring = abs(length(h) - 0.15) - 0.006;
    acc = mix(acc, vec3(1.0, 0.15, 0.75), 1.0 - smoothstep(0.0, px * 1.5, ring));
  }
  // Alpha carries the section outline so the slide shows bare glass around it.
  gl_FragColor = vec4(acc, heTissueCoverage(base, uTexelMM));
}
`;
}

/**
 * A rotated 2x2 grid beats an axis-aligned one on the near-horizontal structures
 * that dominate skin (the epidermis, the collagen, the corneal laminae).
 */
function supersampleBody(samples: 1 | 2 | 4): string {
  if (samples === 1) {
    return `  acc = heTissue(base, uTexelMM, uOptResMM, uFocusZ, uNA);`;
  }
  const offsets: Array<[number, number]> =
    samples === 2
      ? [
          [-0.2, -0.4],
          [0.2, 0.4],
        ]
      : [
          [-0.325, -0.125],
          [0.125, -0.325],
          [-0.125, 0.325],
          [0.325, 0.125],
        ];
  const lines = offsets
    .map(
      ([ox, oy]) =>
        `  acc += heTissue(base + vec2(${ox.toFixed(4)}, ${oy.toFixed(
          4,
        )}) * uTexelMM, uTexelMM, uOptResMM, uFocusZ, uNA);`,
    )
    .join('\n');
  return `${lines}\n  acc /= ${samples.toFixed(1)};`;
}

export function createTissueMaterial(samples: 1 | 2 | 4 = 2): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: fragment(samples),
    uniforms: {
      uCentre: { value: new THREE.Vector2(0, 0) },
      uFieldMM: { value: 1.0 },
      uAspect: { value: 1.0 },
      uTexelMM: { value: 0.001 },
      uOptResMM: { value: 0.0005 },
      uFocusZ: { value: 0.0 },
      uNA: { value: 0.65 },
      uDebugMark: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  });
}
