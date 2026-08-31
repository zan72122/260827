/**
 * wood.ts — one procedural wood, evaluated in RING SPACE.
 *
 * The shader reads the mesh's object-space position, and both the ring and the
 * wedge carry geometry authored in ring coordinates that is never re-baked.
 * So the growth rings are concentric with the lathe axis (which is what you get
 * when a ring is turned out of a trunk disc), the wedge's grain is a literal
 * continuation of the ring's, and moving the wedge cannot make the pattern
 * swim: its material coordinates travel with its vertices.
 */

import * as THREE from 'three'

const NOISE = /* glsl */ `
float rwHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float rwNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rwHash(i + vec3(0,0,0)), rwHash(i + vec3(1,0,0)), f.x),
                 mix(rwHash(i + vec3(0,1,0)), rwHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(rwHash(i + vec3(0,0,1)), rwHash(i + vec3(1,0,1)), f.x),
                 mix(rwHash(i + vec3(0,1,1)), rwHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float rwFbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * rwNoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
`

export type WoodOptions = {
  /** Growth-ring spacing in metres. */
  ringSpacing?: number
  early?: THREE.Color
  late?: THREE.Color
}

export function createWoodMaterial(opts: WoodOptions = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.80,
    metalness: 0.0,
  })
  const uniforms = {
    uRingSpacing: { value: opts.ringSpacing ?? 0.0052 },
    uEarly: { value: opts.early ?? new THREE.Color(0xd8bb8a) },
    uLate: { value: opts.late ?? new THREE.Color(0x7c5528) },
  }
  mat.userData.uniforms = uniforms

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aFresh;
         varying vec3 vRingPos;
         varying float vFresh;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vRingPos = position;
         vFresh = aFresh;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uRingSpacing;
         uniform vec3 uEarly;
         uniform vec3 uLate;
         varying vec3 vRingPos;
         varying float vFresh;
         ${NOISE}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 P = vRingPos;
          float rr = length(P.xz);
          // Angular coordinates use the unit direction, never atan(): an angle
          // has a seam at +-pi and the seam would show as a line up the ring.
          vec2 dir = rr > 1e-6 ? P.xz / rr : vec2(1.0, 0.0);

          // The trunk was a little off-centre and never perfectly round.
          float warp = rwFbm(vec3(P.xz * 34.0, P.y * 11.0)) - 0.5;
          float wob  = rwNoise(vec3(dir * 0.9, P.y * 3.1)) - 0.5;
          float rw = rr + 0.0034 * warp + 0.0026 * wob;

          // growth rings: a wide pale earlywood band, a narrow dark latewood one
          float g = fract(rw / uRingSpacing);
          float late = smoothstep(0.58, 0.76, g) - smoothstep(0.88, 1.0, g);
          late *= 0.66 + 0.60 * rwNoise(vec3(dir * 7.0, P.y * 5.0));

          // wide colour zones: no two boards are the same shade all over
          float zone = rwFbm(vec3(P.xz * 7.0, P.y * 2.0));

          // fibres running along the trunk axis
          float fib = rwNoise(vec3(rw * 620.0, P.y * 52.0, dir.x * 6.0)) - 0.5;
          float fib2 = rwNoise(vec3(rw * 2100.0, P.y * 160.0, dir.y * 9.0)) - 0.5;
          // medullary rays: faint radial flecks
          float ray = smoothstep(0.78, 1.0, rwNoise(vec3(dir * 36.0, rr * 9.0)));

          // A sawn face cuts the growth rings lengthwise, so the bands read
          // as stripes there; keep them softer than on the turned surfaces or
          // the blank looks like corrugated card.
          vec3 wood = mix(uEarly, uLate, clamp(late, 0.0, 1.0) * (1.0 - 0.34 * vFresh));
          wood *= 0.92 + 0.17 * zone;
          wood *= 1.0 + 0.085 * fib + 0.045 * fib2;
          wood = mix(wood, wood * 1.09 + 0.010, ray * 0.30);

          // A freshly sawn face is paler and fuzzier than a turned surface,
          // and carries faint radial saw striations.
          float saw = sin(P.y * 1150.0 + warp * 5.0) * 0.5 + 0.5;
          vec3 fresh = wood * 1.13 + 0.026;
          fresh *= 1.0 - 0.030 * saw;
          wood = mix(wood, fresh, vFresh);

          diffuseColor.rgb *= wood;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          float rr2 = length(vRingPos.xz);
          float g2 = fract(rr2 / uRingSpacing);
          // latewood is denser -> a touch glossier; sawn faces are fuzzy
          roughnessFactor = roughnessFactor
            - 0.06 * (smoothstep(0.58, 0.76, g2) - smoothstep(0.88, 1.0, g2))
            + 0.02 * (rwNoise(vec3(vRingPos * 900.0)) - 0.5)
            + 0.14 * vFresh;
          roughnessFactor = clamp(roughnessFactor, 0.30, 0.98);
        }`,
      )
  }
  mat.customProgramCacheKey = () => 'reifen-wood-v3'
  return mat
}
