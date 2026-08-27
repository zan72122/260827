/**
 * microscopeView.ts — CircularMicroscopeMask + the brightfield compositor.
 *
 * Draws the specimen as it appears down the eyepiece: two pyramid levels blended,
 * a circular field with real optical vignetting rather than a black PNG frame, a
 * focus rack that softens the plane of section, the pathologist's marker ring on the
 * underside of the glass, and dust sitting on top of the coverslip at its own depth.
 *
 * The circle is not a cut-out pasted over the 3D scene: while the objective is still
 * closing on the coverslip the surround stays transparent, so the hardware behind it
 * remains visible and the crossing reads as passing under the lens.
 */

import * as THREE from 'three';
import type { LevelRect } from '../micro/tissuePyramid';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform vec4 uRectA;      // centre.xy, half extent.xy  (TISSUE mm)
uniform vec4 uRectB;
uniform float uBlend;

uniform vec2 uCentre;     // TISSUE mm at the centre of the field
uniform vec2 uHalfSpan;   // half width/height of the visible field, mm
uniform vec2 uAnchor;     // where the landmark sits on screen, 0..1
uniform vec2 uResolution;
uniform float uRot;      // keeps the section's orientation identical to the 3D view

uniform float uCircleR;   // field radius as a fraction of the short screen side
uniform float uFieldOpen;
uniform float uSurround;
uniform float uFocusBlurMM;
uniform float uNA;
uniform float uLamp;      // illumination intensity
uniform float uInk;       // visibility of the marker ring on the slide underside
uniform float uDust;
uniform float uGrit;      // objective-change unsteadiness

const vec3 SURROUND = vec3(0.043, 0.047, 0.055);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 sampleLevel(sampler2D tex, vec4 rect, vec2 t) {
  // Levels are rendered picture-side-up: texture v = 1 is the shallowest tissue, so
  // the vertical axis is inverted on the way back in.
  vec2 d = (t - rect.xy) / (2.0 * rect.zw);
  vec2 uv = vec2(0.5 + d.x, 0.5 - d.y);
  return texture2D(tex, clamp(uv, vec2(0.0015), vec2(0.9985))).rgb;
}

/** True while the point still falls inside a level's rendered rectangle. */
float inside(vec4 rect, vec2 t) {
  vec2 d = abs(t - rect.xy) - rect.zw;
  return step(max(d.x, d.y), 0.0);
}

vec3 specimen(vec2 t) {
  vec3 a = sampleLevel(uTexA, uRectA, t);
  if (uBlend <= 0.002) return a;
  vec3 b = sampleLevel(uTexB, uRectB, t);
  // Never blend in the finer level outside the ground it actually covers.
  return mix(a, b, uBlend * inside(uRectB, t));
}

void main() {
  vec2 res = uResolution;
  float shortSide = min(res.x, res.y);

  // Screen position relative to the landmark anchor, in millimetres of specimen.
  // The section is mounted a few degrees off square, exactly as the 3D slide shows
  // it, so the same rotation is applied here and the landmark keeps its bearing
  // through the hand-over.
  // Convert to millimetres FIRST: rotating normalised screen coordinates before a
  // non-uniform scale would shear the field and quietly stretch the tissue.
  vec2 relMM = (vUv - uAnchor) * vec2(1.0, -1.0) * 2.0 * uHalfSpan;
  float cs = cos(uRot), sn = sin(uRot);
  vec2 t = uCentre + vec2(relMM.x * cs - relMM.y * sn, relMM.x * sn + relMM.y * cs);

  // Distance from the centre of the optical field, in short-side fractions.
  vec2 fromCentre = (vUv - uAnchor) * res / shortSide;
  float rr = length(fromCentre);
  float edge = 1.2 / shortSide;

  float mmPerPx = (2.0 * uHalfSpan.x) / res.x;
  vec3 col;

  if (uFocusBlurMM > mmPerPx * 0.55) {
    // A focus rack softens everything in the section together. Nine taps is plenty
    // at the tiny radii real racking produces; this is not a cinematic bokeh.
    float r = uFocusBlurMM;
    col = specimen(t) * 0.28;
    float wsum = 0.28;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853981634;
      vec2 o = vec2(cos(a), sin(a)) * r * (0.55 + 0.45 * mod(float(i), 2.0));
      col += specimen(t + o) * 0.09;
      wsum += 0.09;
    }
    col /= wsum;
  } else {
    col = specimen(t);
  }

  // --- the pathologist's marker ring, inked on the underside of the slide ---
  if (uInk > 0.001) {
    // A pen line is neither perfectly round nor perfectly even.
    vec2 ink = t - uCentre;
    float wob = 0.055 * (hash12(floor(vec2(atan(ink.y, ink.x) * 6.0, 0.0))) - 0.5);
    float dr = abs(length(ink) - (3.20 + wob)) - 0.070;
    // A millimetre of glass below the plane of section: hopelessly out of focus.
    float inkBlur = max(1.0 * uNA, mmPerPx * 1.5);
    float ia = 1.0 - smoothstep(-inkBlur, inkBlur, dr);
    col = mix(col, vec3(0.086, 0.098, 0.145), ia * 0.55 * uInk);
  }

  // --- dust and mounting-medium specks on top of the coverslip ---
  if (uDust > 0.001) {
    float dustBlur = max(0.17 * uNA, mmPerPx);
    vec2 g = floor(t / 0.85);
    float acc = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 cell = g + vec2(float(i), float(j));
        float h = hash12(cell * 3.7);
        if (h > 0.34) continue;
        vec2 c = (cell + vec2(hash12(cell), hash12(cell + 7.1))) * 0.85;
        float d = length(t - c) - 0.012 * (0.5 + h);
        acc = max(acc, 1.0 - smoothstep(-dustBlur, dustBlur, d));
      }
    }
    col = mix(col, vec3(0.42, 0.42, 0.45), acc * 0.14 * uDust);
  }

  // --- brightfield illumination: a Kohler-even field with a gentle cos^4 falloff ---
  float vign = 1.0 - 0.105 * pow(clamp(rr / max(uCircleR, 0.001), 0.0, 1.4), 2.4);
  col *= mix(1.0, vign, uFieldOpen);
  col *= uLamp;
  // Halogen light is faintly warm; the effect is small and never tinted for style.
  col *= vec3(1.006, 0.999, 0.988);

  // --- the field stop: an optical edge, not a pasted-on black frame ---
  float inField = 1.0 - smoothstep(uCircleR - edge * 1.6, uCircleR + edge * 1.6, rr);
  // A trace of lateral colour right at the rim, well under a pixel. Nothing more.
  float rim = smoothstep(uCircleR * 0.86, uCircleR, rr) * uFieldOpen;
  col.r *= 1.0 + 0.012 * rim;
  col.b *= 1.0 - 0.010 * rim;

  // The mechanical stage vibrates for a moment as the turret is turned.
  col *= 1.0 - uGrit * 0.05 * hash12(vUv * res + uGrit);

  vec3 outside = SURROUND * (0.85 + 0.30 * smoothstep(1.4, 0.4, rr));
  // Inside the field stop the view is FULLY opaque from the moment the aperture
  // exists. Blending the hardware through it would make the crossing read as a
  // dissolve between two renders instead of an optical hand-over.
  float alpha = max(uSurround, inField);
  vec3 rgb = mix(outside, col, inField);
  gl_FragColor = vec4(rgb, clamp(alpha, 0.0, 1.0));
}
`;

export interface MicroscopeViewUniformInput {
  centre: { x: number; y: number };
  halfSpanX: number;
  halfSpanY: number;
  anchorX: number;
  anchorY: number;
  circleR: number;
  fieldOpen: number;
  surround: number;
  focusBlurMM: number;
  na: number;
  lamp: number;
  ink: number;
  dust: number;
  grit: number;
  rot: number;
  width: number;
  height: number;
}

export class CircularMicroscopeView {
  readonly material: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTexA: { value: null },
        uTexB: { value: null },
        uRectA: { value: new THREE.Vector4(0, 0, 1, 1) },
        uRectB: { value: new THREE.Vector4(0, 0, 1, 1) },
        uBlend: { value: 0 },
        uCentre: { value: new THREE.Vector2() },
        uHalfSpan: { value: new THREE.Vector2(1, 1) },
        uAnchor: { value: new THREE.Vector2(0.5, 0.5) },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uCircleR: { value: 0.46 },
        uFieldOpen: { value: 0 },
        uSurround: { value: 0 },
        uFocusBlurMM: { value: 0 },
        uNA: { value: 0.1 },
        uLamp: { value: 1 },
        uInk: { value: 0 },
        uDust: { value: 0 },
        uGrit: { value: 0 },
        uRot: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  setLevels(
    texA: THREE.Texture,
    rectA: LevelRect,
    texB: THREE.Texture,
    rectB: LevelRect,
    blend: number,
  ): void {
    const u = this.material.uniforms;
    u.uTexA.value = texA;
    u.uTexB.value = texB;
    u.uRectA.value.set(rectA.centreX, rectA.centreY, rectA.halfW, rectA.halfH);
    u.uRectB.value.set(rectB.centreX, rectB.centreY, rectB.halfW, rectB.halfH);
    u.uBlend.value = blend;
  }

  apply(v: MicroscopeViewUniformInput): void {
    const u = this.material.uniforms;
    u.uCentre.value.set(v.centre.x, v.centre.y);
    u.uHalfSpan.value.set(v.halfSpanX, v.halfSpanY);
    u.uAnchor.value.set(v.anchorX, v.anchorY);
    u.uResolution.value.set(v.width, v.height);
    u.uCircleR.value = v.circleR;
    u.uFieldOpen.value = v.fieldOpen;
    u.uSurround.value = v.surround;
    u.uFocusBlurMM.value = v.focusBlurMM;
    u.uNA.value = v.na;
    u.uLamp.value = v.lamp;
    u.uInk.value = v.ink;
    u.uDust.value = v.dust;
    u.uGrit.value = v.grit;
    u.uRot.value = v.rot;
  }

  dispose(): void {
    this.material.dispose();
    (this.mesh.geometry as THREE.BufferGeometry).dispose();
  }
}
