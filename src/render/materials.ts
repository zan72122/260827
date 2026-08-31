import * as THREE from 'three';

/**
 * Procedural wood, evaluated in object space so that the grain *ends* where the
 * timber was cut.  A leaf board therefore shows long figure on its faces and
 * ring end grain (木口) on its ends, and every part carries its own fibre
 * direction — the boards are not decorated with a pasted-on knot each.
 *
 * Nothing is downloaded: there are no image assets in this build.
 */

export interface WoodOptions {
  /** early-wood colour */
  light: number;
  /** late-wood (ring) colour */
  dark: number;
  /** direction of the fibres in object space */
  fibre: THREE.Vector3;
  /** rings per metre */
  ringFreq: number;
  /** how much the rings wander along the fibre */
  wander: number;
  roughness: number;
  /** oil finish sheen */
  clearcoat: number;
  /** translucent stain multiplied over the wood, or null for bare timber */
  stain?: THREE.Color | null;
  stainAmount?: number;
  /** ring contrast */
  contrast?: number;
  /**
   * Where the centre of the log sits relative to this part, in metres.  A part
   * cut from near the heart shows curved rings; one cut from further out shows
   * nearly straight grain.
   */
  ringCentre?: [number, number];
  name: string;
}

const WOOD_GLSL = /* glsl */ `
varying vec3 vWoodPos;
uniform vec3 uLight;
uniform vec3 uDark;
uniform vec3 uFibre;
uniform float uRingFreq;
uniform float uWander;
uniform vec3 uStain;
uniform float uStainAmount;
uniform float uContrast;
uniform vec2 uRingCentre;

float wHash(vec3 p){ return fract(sin(dot(p, vec3(17.13, 91.7, 43.3))) * 43758.5453); }
float wNoise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float n000 = wHash(i), n100 = wHash(i+vec3(1,0,0));
  float n010 = wHash(i+vec3(0,1,0)), n110 = wHash(i+vec3(1,1,0));
  float n001 = wHash(i+vec3(0,0,1)), n101 = wHash(i+vec3(1,0,1));
  float n011 = wHash(i+vec3(0,1,1)), n111 = wHash(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
             mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
}
float wFbm(vec3 p){
  return wNoise(p)*0.55 + wNoise(p*2.07)*0.28 + wNoise(p*4.11)*0.17;
}
vec3 woodColour(vec3 p){
  vec3 a = normalize(abs(uFibre.y) < 0.9 ? cross(uFibre, vec3(0.0,1.0,0.0)) : cross(uFibre, vec3(1.0,0.0,0.0)));
  vec3 b = normalize(cross(uFibre, a));
  float along = dot(p, uFibre);
  vec2 cross2 = vec2(dot(p, a), dot(p, b));
  // the log the part was cut from is off to one side, so rings are not centred
  cross2 += uRingCentre;
  float r = length(cross2);
  r += uWander * (wFbm(vec3(cross2 * 7.0, along * 3.4)) - 0.5);
  // rings are not evenly spaced: growth years vary
  r += 0.12 / uRingFreq * (wFbm(vec3(cross2 * 1.7, along * 0.6)) - 0.5);
  float rings = fract(r * uRingFreq);
  float late = smoothstep(0.52, 0.74, rings) * (1.0 - smoothstep(0.80, 0.97, rings));
  late = clamp(late * uContrast, 0.0, 1.0);
  // fine pores, stretched hard along the fibre
  float pore = wFbm(vec3(cross2 * 190.0, along * 9.0));
  float slow = wFbm(vec3(cross2 * 3.0, along * 1.1));
  vec3 col = mix(uLight, uDark, late);
  col *= 1.0 - 0.045 * pore;
  col *= 0.955 + 0.09 * slow;
  col = mix(col, col * uStain, uStainAmount);
  return col;
}
`;

export function makeWood(o: WoodOptions): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: o.roughness,
    metalness: 0,
    clearcoat: o.clearcoat,
    clearcoatRoughness: 0.42,
    sheen: 0,
  });
  mat.name = o.name;
  const fibre = o.fibre.clone().normalize();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLight = { value: new THREE.Color(o.light).convertSRGBToLinear() };
    shader.uniforms.uDark = { value: new THREE.Color(o.dark).convertSRGBToLinear() };
    shader.uniforms.uFibre = { value: fibre };
    shader.uniforms.uRingFreq = { value: o.ringFreq };
    shader.uniforms.uWander = { value: o.wander };
    shader.uniforms.uStain = {
      value: (o.stain ? o.stain.clone() : new THREE.Color(0xffffff)).convertSRGBToLinear(),
    };
    shader.uniforms.uStainAmount = { value: o.stainAmount ?? 0 };
    shader.uniforms.uContrast = { value: o.contrast ?? 1 };
    shader.uniforms.uRingCentre = {
      value: new THREE.Vector2(...(o.ringCentre ?? [0.055, 0.031])),
    };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWoodPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWoodPos = position;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WOOD_GLSL)
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb *= woodColour(vWoodPos);',
      );
  };
  mat.customProgramCacheKey = () => 'wood-' + o.name;
  return mat;
}

/** Fibre runs along +X (a board's length), the usual case for the leaf boards. */
export const FIBRE_X = new THREE.Vector3(1, 0, 0);
export const FIBRE_Y = new THREE.Vector3(0, 1, 0);
export const FIBRE_Z = new THREE.Vector3(0, 0, 1);

export interface Palette {
  leaf: THREE.MeshPhysicalMaterial;
  trunk: THREE.MeshPhysicalMaterial;
  star: THREE.MeshPhysicalMaterial;
  pot: THREE.MeshPhysicalMaterial;
  jig: THREE.MeshPhysicalMaterial;
  bench: THREE.MeshPhysicalMaterial;
  rack: THREE.MeshPhysicalMaterial;
  stock: THREE.MeshPhysicalMaterial;
  brass: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  cord: THREE.MeshStandardMaterial;
  felt: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
}

export function buildPalette(): Palette {
  const leafStain = new THREE.Color(0x6d9a44);
  return {
    // 葉板: pale hinoki-like board under a thin green stain — the grain still reads
    leaf: makeWood({
      name: 'leaf',
      light: 0xeadfc4,
      dark: 0xc9b491,
      fibre: FIBRE_X,
      ringFreq: 260,
      wander: 0.014,
      roughness: 0.62,
      clearcoat: 0.22,
      stain: leafStain,
      stainAmount: 0.84,
      contrast: 0.75,
      ringCentre: [0.11, 0.07],
    }),
    // 幹: hard, close-grained maple, oiled
    trunk: makeWood({
      name: 'trunk',
      light: 0xd0b489,
      dark: 0xb2955f,
      fibre: FIBRE_Y,
      ringFreq: 420,
      wander: 0.006,
      roughness: 0.5,
      clearcoat: 0.34,
      contrast: 0.5,
      ringCentre: [0.052, 0.029],
    }),
    star: makeWood({
      name: 'star',
      light: 0xd8bf93,
      dark: 0xbc9f70,
      fibre: FIBRE_X,
      ringFreq: 360,
      wander: 0.010,
      roughness: 0.55,
      clearcoat: 0.28,
      contrast: 0.55,
      ringCentre: [0.09, 0.05],
    }),
    // 鉢: dark walnut
    pot: makeWood({
      name: 'pot',
      light: 0x8a6440,
      dark: 0x67462b,
      fibre: FIBRE_Y,
      ringFreq: 210,
      wander: 0.014,
      roughness: 0.44,
      clearcoat: 0.4,
      contrast: 0.7,
      ringCentre: [0.021, 0.013],
    }),
    jig: makeWood({
      name: 'jig',
      light: 0xc4a87c,
      dark: 0xa98d61,
      fibre: FIBRE_X,
      ringFreq: 150,
      wander: 0.020,
      roughness: 0.74,
      clearcoat: 0.06,
      contrast: 0.7,
      ringCentre: [0.38, 0.24],
    }),
    bench: makeWood({
      name: 'bench',
      light: 0xb99d74,
      dark: 0xa2855e,
      fibre: FIBRE_X,
      ringFreq: 95,
      wander: 0.022,
      roughness: 0.8,
      clearcoat: 0.05,
      contrast: 0.65,
      ringCentre: [0.46, 0.29],
    }),
    rack: makeWood({
      name: 'rack',
      light: 0x9a8160,
      dark: 0x7f6746,
      fibre: FIBRE_Y,
      ringFreq: 90,
      wander: 0.025,
      roughness: 0.85,
      clearcoat: 0,
      contrast: 0.7,
      ringCentre: [0.34, 0.21],
    }),
    stock: makeWood({
      name: 'stock',
      light: 0xcbb591,
      dark: 0xb29a74,
      fibre: FIBRE_X,
      ringFreq: 120,
      wander: 0.022,
      roughness: 0.82,
      clearcoat: 0,
      contrast: 0.6,
      ringCentre: [0.4, 0.26],
    }),
    brass: new THREE.MeshStandardMaterial({
      color: 0x8f6b2c,
      metalness: 0.85,
      roughness: 0.46,
      name: 'brass',
    }),
    steel: new THREE.MeshStandardMaterial({
      color: 0x8b9298,
      metalness: 0.92,
      roughness: 0.34,
      name: 'steel',
    }),
    cord: new THREE.MeshStandardMaterial({
      color: 0xb8a98c,
      roughness: 0.95,
      metalness: 0,
      name: 'cord',
    }),
    felt: new THREE.MeshStandardMaterial({
      color: 0x4a4137,
      roughness: 1,
      metalness: 0,
      name: 'felt',
    }),
    wall: new THREE.MeshStandardMaterial({
      color: 0x6f6558,
      roughness: 0.95,
      metalness: 0,
      name: 'wall',
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0xdfe9f2,
      roughness: 0.18,
      metalness: 0,
      transparent: true,
      opacity: 0.32,
      name: 'glass',
    }),
  };
}
