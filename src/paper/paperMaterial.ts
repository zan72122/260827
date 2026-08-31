import * as THREE from 'three';
import { BONDS, PAPER_HALF } from '../config';

export type PaperUniforms = {
  uOpen: { value: number };
  uStackGap: { value: number };
  uHalfPaper: { value: number };
  uBonds: { value: number };
  uSunDirView: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uThrough: { value: number };
  uOpenAmount: { value: number };
};

export function createPaperUniforms(): PaperUniforms {
  return {
    uOpen: { value: 0 },
    uStackGap: { value: 0 },
    uHalfPaper: { value: PAPER_HALF },
    uBonds: { value: BONDS },
    uSunDirView: { value: new THREE.Vector3(0, 0, 1) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uThrough: { value: 0.5 },
    uOpenAmount: { value: 0 },
  };
}

/**
 * The honeycomb is deformed entirely on the GPU. Positions AND normals are
 * derived analytically from the fan angle, so shading always matches the shape
 * that is actually on screen - a half-open tree is never lit like a shut one.
 *
 * Surface point of a leaf, with theta(y) the leaf's zig-zag angle:
 *   P(r,y) = r*d(theta) + y*Y + n(theta)*offset,  d=(cos,0,sin), n=(-sin,0,cos)
 * Its tangents give the exact normal:
 *   dP/dr x dP/dy  =  n - r*theta'(y)*Y
 */
const COMMON = /* glsl */ `
uniform float uOpen;
uniform float uStackGap;
uniform float uHalfPaper;
uniform float uBonds;
attribute vec4 aGeom;   // radius, y, bondIndex, bondSlope
attribute vec4 aMode;   // stackIndex, side, rimKind, leafIndex

void hcResolve(out vec3 hcPos, out vec3 hcNrm, out float hcKind) {
  float r = aGeom.x;
  float y = aGeom.y;
  float theta  = uOpen * aGeom.z / uBonds;
  float thetaY = uOpen * aGeom.w / uBonds;
  float ct = cos(theta);
  float st = sin(theta);
  vec3 d = vec3(ct, 0.0, st);
  vec3 n = vec3(-st, 0.0, ct);
  float off = aMode.x * uStackGap + aMode.y * uHalfPaper;
  hcPos = d * r + vec3(0.0, y, 0.0) + n * off;
  vec3 faceN = normalize(n - vec3(0.0, r * thetaY, 0.0));
  hcKind = aMode.z;
  if (hcKind < 0.5)      hcNrm = faceN * aMode.y;
  else if (hcKind < 1.5) hcNrm = d;
  else if (hcKind < 2.5) hcNrm = -d;
  else if (hcKind < 3.5) hcNrm = vec3(0.0, 1.0, 0.0);
  else                   hcNrm = vec3(0.0, -1.0, 0.0);
}
`;

const VERTEX_VARYINGS = /* glsl */ `
varying float vLeafId;
varying float vRimKind;
varying float vTilt;
varying float vRadial;
`;

function patchVertex(
  shader: THREE.WebGLProgramParametersWithUniforms,
  patchNormals: boolean
) {
  shader.vertexShader =
    COMMON + (patchNormals ? VERTEX_VARYINGS : '') + '\n' + shader.vertexShader;

  const assign = /* glsl */ `
    vec3 hcPos; vec3 hcNrm; float hcKind;
    hcResolve(hcPos, hcNrm, hcKind);
  `;

  if (patchNormals) {
    // three emits <beginnormal_vertex> before <begin_vertex>, so everything is
    // resolved once, here, and reused below.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `${assign}
       vec3 objectNormal = hcNrm;
       vLeafId = aMode.w;
       vRimKind = hcKind;
       vTilt = clamp(abs(aGeom.w) * uOpen / uBonds * aGeom.x * 40.0, 0.0, 1.0);
       vRadial = uv.x;
       #ifdef USE_TANGENT
         vec3 objectTangent = vec3( tangent.xyz );
       #endif`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      'vec3 transformed = hcPos;'
    );
  } else {
    // Depth pass: no normals needed, and its <beginnormal_vertex> sits inside
    // an #ifdef we must not touch.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `${assign} vec3 transformed = hcPos;`
    );
  }
}

/** Subtle, non-emissive backlight bleed: paper is thin, not a lamp. */
const FRAG_HEAD = /* glsl */ `
uniform vec3 uSunDirView;
uniform vec3 uSunColor;
uniform float uThrough;
uniform float uOpenAmount;
varying float vLeafId;
varying float vRimKind;
varying float vTilt;
varying float vRadial;
`;

/**
 * Analytic ambient occlusion down the depth of each cell. The paper near the
 * spine is boxed in by its neighbours and by the glue lines; the paper near the
 * open mouth is not. Without this the cells read as a quilted surface instead
 * of as little rooms with a way in.
 */
const FRAG_AO = /* glsl */ `
  float cellDepth = clamp(vRadial, 0.0, 1.0);
  float ambientOcclusion = mix(0.30, 1.0, pow(cellDepth, 0.65));
  ambientOcclusion = mix(1.0, ambientOcclusion, step(vRimKind, 0.5) * uOpenAmount);
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_CLEARCOAT )
    clearcoatSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined( USE_SHEEN )
    sheenSpecularIndirect *= ambientOcclusion;
  #endif
  material.diffuseColor.rgb *= mix(1.0, ambientOcclusion, 0.55);
`;

const FRAG_TAIL = /* glsl */ `
  if (vRimKind < 0.5) {
    float back = max(0.0, dot(-normal, uSunDirView));
    outgoingLight += uSunColor * diffuseColor.rgb * uThrough * pow(back, 2.5) * 0.55;
  }
`;

export function createPaperMaterial(
  uniforms: PaperUniforms,
  base: THREE.MeshStandardMaterialParameters
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial(base);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    patchVertex(shader, true);
    shader.fragmentShader = FRAG_HEAD + '\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       float leafTint = fract(sin(vLeafId * 12.9898) * 43758.5453);
       diffuseColor.rgb *= 0.93 + 0.14 * leafTint;
       diffuseColor.rgb *= 1.0 - 0.10 * vTilt;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <aomap_fragment>',
      FRAG_AO
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      FRAG_TAIL + '\n#include <opaque_fragment>'
    );
  };
  mat.customProgramCacheKey = () => 'honeycomb-paper';
  return mat;
}

/** Shadows must follow the same deformation, or the tree casts a shut stack. */
export function createPaperDepthMaterial(uniforms: PaperUniforms): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    patchVertex(shader, false);
  };
  mat.customProgramCacheKey = () => 'honeycomb-depth';
  return mat;
}
