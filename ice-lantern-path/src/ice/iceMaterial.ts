import * as THREE from 'three';
import { NOISE_GLSL } from '../core/glsl';

export interface IceUniforms {
  uFreeze: { value: number };
  uFront: { value: number };
  uLit: { value: number };
  uTime: { value: number };
  uHeave: { value: number };
  uRi: { value: number };
  uRo: { value: number };
  uTop: { value: number };
  uWarm: { value: THREE.Color };
  uWater: { value: THREE.Color };
  uIce: { value: THREE.Color };
}

export function makeIceUniforms(ri: number, ro: number, top: number): IceUniforms {
  return {
    uFreeze: { value: 0 },
    uFront: { value: 0 },
    uLit: { value: 0 },
    uTime: { value: 0 },
    uHeave: { value: 0 },
    uRi: { value: ri },
    uRo: { value: ro },
    uTop: { value: top },
    uWarm: { value: new THREE.Color(0xffb265) },
    uWater: { value: new THREE.Color(0xafd3dc) },
    uIce: { value: new THREE.Color(0xd9ebee) },
  };
}

const VERT_PARS = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vObjNrm;
varying vec3 vWPos;
varying vec3 vWNrm;
uniform float uHeave;
uniform float uRi;
uniform float uRo;
uniform float uTop;
`;

// Water expands as it freezes: the last part to solidify - the middle of the
// wall - heaves up a couple of millimetres. That is the only morph we need.
const VERT_BODY = /* glsl */ `
vObjPos = position;
vObjNrm = normal;
float _r = length(position.xz);
float _tAnn = clamp((_r - uRi) / max(0.0001, uRo - uRi), 0.0, 1.0);
float _mid = 1.0 - abs(_tAnn * 2.0 - 1.0);
float _isTop = smoothstep(uTop - 0.012, uTop - 0.001, position.y) * step(0.35, normal.y);
transformed.y += uHeave * _isTop * (_mid * 0.9 + 0.1);
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vObjNrm;
varying vec3 vWPos;
varying vec3 vWNrm;
uniform float uFreeze;
uniform float uFront;
uniform float uLit;
uniform float uTime;
uniform float uRi;
uniform float uRo;
uniform float uTop;
uniform vec3 uWarm;
uniform vec3 uWater;
uniform vec3 uIce;
${NOISE_GLSL}

struct IceLook { float cloud; float frost; float frozen; float bubbles; float path; float cavity; float front; float top; };

IceLook iceLook() {
  IceLook o;
  float r = length(vObjPos.xz);
  float tAnn = clamp((r - uRi) / max(0.0001, uRo - uRi), 0.0, 1.0);
  // 0 at either mould wall, 1 half way through the wall
  float edge = 1.0 - abs(tAnn * 2.0 - 1.0);
  float yN = clamp(vObjPos.y / uTop, 0.0, 1.0);
  float top = smoothstep(0.35, 0.8, vObjNrm.y) * smoothstep(uTop - 0.03, uTop - 0.004, vObjPos.y);
  o.top = top;

  // inside of the hollow: a shaded cavity, not another window on the sky
  vec2 rad2 = vObjPos.xz;
  float inward = length(rad2) > 0.001 ? -dot(normalize(vObjNrm.xz), normalize(rad2)) : 0.0;
  float depthUnderRim = 1.0 - yN;
  o.cavity = smoothstep(0.25, 0.75, inward) * (1.0 - top)
             + smoothstep(0.35, 0.8, vObjNrm.y) * step(vObjPos.y, uTop * 0.4);
  o.cavity = clamp(o.cavity, 0.0, 1.0) * smoothstep(0.02, 0.35, depthUnderRim);

  // how much ice this view ray has to cross before it leaves the wall
  vec3 V = normalize(cameraPosition - vWPos);
  float ndv = abs(dot(normalize(vWNrm), V));
  o.path = clamp(1.0 / max(0.16, ndv), 1.0, 6.0);

  // wobble the freeze front so it is never a clean circle
  float wob = fbm3(vec3(vObjPos.xz * 26.0, 3.1)) * 0.22 - 0.11;
  float front = uFront + wob * 0.5;

  // On the exposed top face the front is genuinely readable: it marches in
  // from both walls and meets in a cloudy seam.
  float frozenTop = 1.0 - smoothstep(front - 0.10, front + 0.06, edge);
  // On the walls it reads as frost climbing from the base.
  float frozenWall = smoothstep(yN - 0.25, yN + 0.05, uFront * 1.35 + wob * 0.4);
  o.frozen = mix(frozenWall, frozenTop, top);

  // Air rejected by the advancing ice collects where the wall freezes last:
  // a narrow milky core, not a milky lantern.
  float grain = fbm3(vec3(vObjPos.xz * 13.0, vObjPos.y * 5.0));
  float bands = fbm3(vec3(vObjPos.xz * 3.5, vObjPos.y * 9.0 + 4.0));
  float core = 0.12 + grain * 0.38 + bands * 0.30;
  float wallCloud = clamp(core * (o.path - 0.85) * 0.95, 0.0, 1.0);
  // trailing the front the ice is already milky; right at the wall it is clear
  float topCloud = frozenTop * (0.12 + edge * 0.9) * (0.35 + grain * 0.8);
  // the growing edge itself catches the light as a thin bright seam
  o.front = exp(-pow((edge - front) / 0.055, 2.0)) * top * step(0.02, uFront) * (1.0 - step(0.985, uFront));
  float cloud = mix(wallCloud, topCloud, top);
  cloud += smoothstep(0.075, 0.0, vObjPos.y / uTop) * 0.3; // thicker milky base
  o.cloud = clamp(cloud * o.frozen, 0.0, 1.0);

  // fine bubbles, denser in the cloudy core, seen through the wall
  float bn = vnoise(vec3(vObjPos.xz * 115.0, vObjPos.y * 80.0));
  o.bubbles = smoothstep(0.70, 0.90, bn) * (0.25 + edge * 0.9) * o.frozen * min(1.2, o.path * 0.7);

  // thin frost on the outside, patchy, never an even coat
  float fp = fbm3(vec3(vObjPos.xz * 26.0, vObjPos.y * 24.0 + 11.0));
  o.frost = clamp((uFront * 1.3 - 0.7) * (0.15 + fp * 1.5) - yN * 0.15, 0.0, 1.0)
            * 0.6 * (1.0 - top * 0.6) * (1.0 - o.cavity * 0.85);
  return o;
}
`;

const FRAG_COLOR = /* glsl */ `
IceLook look = iceLook();
// vertical growth striations along the freeze direction
float streak = fbm3(vec3(vObjPos.x * 190.0, vObjPos.y * 9.0, vObjPos.z * 190.0));
float striae = smoothstep(0.55, 0.78, streak) * 0.16 * look.frozen;
vec3 icy = mix(uIce, vec3(0.955, 0.975, 0.985), clamp(look.cloud * 1.05 + look.bubbles * 0.9 + striae, 0.0, 1.0));
icy = mix(icy, vec3(0.93, 0.955, 0.97), look.top * look.frozen * 0.55);
icy = mix(icy, vec3(0.99), look.front * 0.75);
vec3 wet = uWater;
diffuseColor.rgb *= mix(wet, icy, uFreeze * look.frozen + uFreeze * (1.0 - look.frozen) * 0.15);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.975, 0.99), look.frost * 0.8);
diffuseColor.rgb *= mix(1.0, 0.34, look.cavity);
diffuseColor.a = mix(diffuseColor.a, min(1.0, diffuseColor.a + look.cloud * 0.45 + look.frost * 0.45 + look.cavity * 0.5), uFreeze);
`;

const FRAG_ROUGH = /* glsl */ `
IceLook lookR = iceLook();
float striaeR = smoothstep(0.55, 0.78, fbm3(vec3(vObjPos.x * 190.0, vObjPos.y * 9.0, vObjPos.z * 190.0)));
roughnessFactor = mix(0.045, 0.07 + lookR.cloud * 0.40 + lookR.bubbles * 0.35 + striaeR * 0.06 * lookR.frozen, uFreeze);
roughnessFactor = mix(roughnessFactor, 0.78, lookR.frost * 0.8);
roughnessFactor = mix(roughnessFactor, 0.55, lookR.front * 0.8);
roughnessFactor = mix(roughnessFactor, 0.42, lookR.top * lookR.frozen * uFreeze * 0.8);
`;

const FRAG_TRANSMISSION = /* glsl */ `
IceLook lookT = iceLook();
material.transmission *= (1.0 - uFreeze * clamp(lookT.cloud * 0.95 + lookT.bubbles * 0.8 + lookT.frost * 0.6, 0.0, 1.0))
  * (1.0 - lookT.cavity * 0.88) * (1.0 - lookT.front * 0.7)
  // looking straight down into frozen ice: scattering, not a window
  * (1.0 - lookT.top * lookT.frozen * uFreeze * 0.85);
material.thickness = mix(0.02, 0.075, uFreeze);
`;

// Warm LED light escaping from the cavity: scattered by the cloudy ice, not a
// neon rim. Strongest low down where the light sits, never a full glow.
const FRAG_EMISSIVE = /* glsl */ `
IceLook lookE = iceLook();
float h = clamp(vObjPos.y / uTop, 0.0, 1.0);
float fall = mix(1.0, 0.28, smoothstep(0.05, 0.95, h));
float scatter = 0.15 + lookE.cloud * 0.7;
totalEmissiveRadiance += uWarm * uLit * scatter * fall * 0.85 * (1.0 + lookE.cavity * 1.6);
`;

function patch(mat: THREE.MeshPhysicalMaterial, u: IceUniforms, withTransmission: boolean) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG_ROUGH)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMISSIVE);
    if (withTransmission) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <transmission_fragment>',
        FRAG_TRANSMISSION + '\n#include <transmission_fragment>'
      );
    }
  };
  mat.customProgramCacheKey = () => `ice-${withTransmission ? 1 : 0}`;
}

/**
 * Front and back materials for the ice. Two layers of transparency at most:
 * the back shell is drawn first without writing depth, the front shell after.
 */
export function makeIceMaterials(u: IceUniforms, transmission: number) {
  const useTransmission = transmission > 0.01;
  const common: THREE.MeshPhysicalMaterialParameters = {
    color: 0xffffff,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    ior: 1.31,
    clearcoat: 0.05,
    clearcoatRoughness: 0.35,
    envMapIntensity: 1.0,
    emissive: new THREE.Color(0x000000),
  };

  const front = new THREE.MeshPhysicalMaterial({
    ...common,
    side: THREE.FrontSide,
    depthWrite: true,
    opacity: useTransmission ? 1 : 0.78,
    transmission: useTransmission ? transmission : 0,
    thickness: 0.05,
    attenuationColor: new THREE.Color(0xb2d8e0),
    attenuationDistance: 0.16,
  });
  patch(front, u, useTransmission);

  const back = new THREE.MeshPhysicalMaterial({
    ...common,
    side: THREE.BackSide,
    depthWrite: false,
    opacity: useTransmission ? 0.55 : 0.4,
    transmission: 0,
    roughness: 0.2,
  });
  patch(back, u, false);

  return { front, back };
}
