import * as THREE from 'three';
import type { TextureSet } from './textures';

export type CoatMode = 'angular' | 'radialIn' | 'radialOut';

export interface CoatUniforms {
  uCoat: { value: number };
}

/**
 * Makes a material reveal itself progressively, the way a coat of cream is laid
 * on: either swept around the turntable or spiralled across the top.
 */
function makeCoatable(mat: THREE.Material, mode: CoatMode, radius: number, key: string): CoatUniforms {
  const u: CoatUniforms = { uCoat: { value: 1 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCoat = u.uCoat;
    shader.uniforms.uCoatRadius = { value: radius };
    shader.vertexShader =
      'varying vec3 vCoatPos;\n' +
      shader.vertexShader.replace(
        '#include <fog_vertex>',
        '#include <fog_vertex>\n  vCoatPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );
    const param =
      mode === 'angular'
        ? 'float p = (atan(vCoatPos.z, vCoatPos.x) + 3.14159265) / 6.2831853;'
        : mode === 'radialIn'
        ? 'float p = 1.0 - clamp(length(vCoatPos.xz) / uCoatRadius, 0.0, 1.0);'
        : 'float p = clamp(length(vCoatPos.xz) / uCoatRadius, 0.0, 1.0);';
    shader.fragmentShader =
      'uniform float uCoat;\nuniform float uCoatRadius;\nvarying vec3 vCoatPos;\n' +
      shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>\n  ${param}\n  if (p > uCoat) discard;`
      );
  };
  mat.customProgramCacheKey = () => `coat-${mode}-${key}`;
  return u;
}

/** Nappe: the faint striations a palette knife leaves as the turntable spins. */
function addNappeStriations(mat: THREE.MeshPhysicalMaterial, kind: 'wall' | 'top' = 'wall') {
  const prev = mat.onBeforeCompile;
  const bandExpr =
    kind === 'wall'
      ? 'float band = sin(vNappePos.y * 24.0 + sin(ang * 3.0) * 0.9 + sin(vNappePos.y * 7.0) * 1.7);'
      : 'float band = sin(length(vNappePos.xz) * 17.0 + sin(ang * 4.0) * 1.1 + sin(length(vNappePos.xz) * 5.0) * 1.4);';
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    if (!shader.vertexShader.includes('vNappePos')) {
      shader.vertexShader =
        'varying vec3 vNappePos;\n' +
        shader.vertexShader.replace(
          '#include <fog_vertex>',
          '#include <fog_vertex>\n  vNappePos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
        );
    }
    shader.fragmentShader =
      'varying vec3 vNappePos;\n' +
      shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  {
    float ang = atan(vNappePos.z, vNappePos.x);
    ${bandExpr}
    float striae = smoothstep(0.2, 1.0, band);
    roughnessFactor = clamp(roughnessFactor - striae * 0.17 + (1.0 - striae) * 0.07, 0.05, 1.0);
    diffuseColor.rgb *= 1.0 + striae * 0.02;
  }`
      );
  };
}

/** Cross-section of a strawberry, driven by attributes baked from real geometry. */
export function makeBerryCutMaterial(): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.52,
    metalness: 0,
    clearcoat: 0.16,
    clearcoatRoughness: 0.42,
    envMapIntensity: 0.5,
    side: THREE.FrontSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute float aRadial;\nattribute float aAngle;\nattribute float aSeed;\n' +
      'varying float vRadial;\nvarying float vAngle;\nvarying float vSeed;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vRadial = aRadial;\n  vAngle = aAngle;\n  vSeed = aSeed;'
      );
    shader.fragmentShader =
      `varying float vRadial;
varying float vAngle;
varying float vSeed;
float bhash(vec2 p){ return fract(sin(dot(p, vec2(41.7, 289.1))) * 43758.5453); }
float bnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(bhash(i), bhash(i+vec2(1.0,0.0)), f.x),
             mix(bhash(i+vec2(0.0,1.0)), bhash(i+vec2(1.0,1.0)), f.x), f.y);
}
` +
      shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
  {
    float t = clamp(vRadial, 0.0, 1.0);
    float a = vAngle;
    // Break the perfect bullseye: no berry is a target pattern.
    float wob = bnoise(vec2(a * 2.0, vSeed * 7.0)) * 0.09
              + bnoise(vec2(a * 6.0 + 3.0, vSeed * 11.0)) * 0.04 - 0.065;
    float tt = clamp(t + wob, 0.0, 1.0);

    float skin = smoothstep(0.918, 0.985, tt);
    // Pale pith, drifting off centre the way a real core does.
    float core = 1.0 - smoothstep(0.02, 0.1, tt * (1.0 + 0.35 * sin(a * 1.0 + vSeed * 6.0)));
    float fib = sin(a * 19.0 + sin(a * 3.0 + vSeed * 5.0) * 2.4);
    fib = pow(max(fib, 0.0), 5.0) * smoothstep(0.08, 0.7, tt) * (1.0 - skin);
    float ring = smoothstep(0.8, 0.9, tt) * (1.0 - smoothstep(0.94, 0.99, tt));
    float seeds = smoothstep(0.7, 0.97, bnoise(vec2(a * 23.0, vSeed * 3.0 + 1.0))) * ring;

    vec3 skinCol  = vec3(0.330, 0.018, 0.030);
    vec3 fleshOut = vec3(0.660, 0.048, 0.060);
    vec3 fleshMid = vec3(0.780, 0.105, 0.108);
    vec3 fleshIn  = vec3(0.855, 0.218, 0.200);
    vec3 pithCol  = vec3(0.950, 0.880, 0.822);

    vec3 col = mix(fleshIn, fleshMid, smoothstep(0.02, 0.38, tt));
    col = mix(col, fleshOut, smoothstep(0.38, 0.92, tt));
    col = mix(col, pithCol, core * 0.55);
    col = mix(col, vec3(0.930, 0.690, 0.650), fib * 0.2);
    col = mix(col, vec3(0.88, 0.78, 0.48), seeds * 0.55);
    col = mix(col, skinCol, skin);
    col *= 0.92 + bnoise(vec2(a * 21.0, tt * 24.0)) * 0.16;
    diffuseColor.rgb *= col;
  }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
  {
    float t = clamp(vRadial, 0.0, 1.0);
    // A very thin juice film, pooled in patches rather than a mirror centre.
    float juice = smoothstep(0.45, 0.9, bnoise(vec2(vAngle * 5.0, t * 6.0)))
                * (1.0 - smoothstep(0.72, 0.95, t));
    roughnessFactor = clamp(roughnessFactor - juice * 0.16, 0.26, 1.0);
  }`
        );
  };
  mat.customProgramCacheKey = () => 'berryCut';
  return mat;
}

/** One cake's own coat materials, so two cakes never share a coat progress. */
export interface CoatSet {
  wall: THREE.MeshPhysicalMaterial;
  top: THREE.MeshPhysicalMaterial;
  underWall: THREE.MeshPhysicalMaterial;
  underTop: THREE.MeshPhysicalMaterial;
  u: { wall: CoatUniforms; top: CoatUniforms; underWall: CoatUniforms; underTop: CoatUniforms };
}

export interface MaterialSet {
  spongeCut: THREE.MeshStandardMaterial;
  spongeBake: THREE.MeshStandardMaterial;
  creamOuter: THREE.MeshPhysicalMaterial;
  creamTop: THREE.MeshPhysicalMaterial;
  cream: THREE.MeshPhysicalMaterial;
  creamCut: THREE.MeshPhysicalMaterial;
  berrySkin: THREE.MeshPhysicalMaterial;
  berryHull: THREE.MeshStandardMaterial;
  berryCut: THREE.MeshPhysicalMaterial;
  metal: THREE.MeshStandardMaterial;
  metalHandle: THREE.MeshStandardMaterial;
  board: THREE.MeshStandardMaterial;
  bench: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  crumb: THREE.MeshStandardMaterial;
  makeCoat: () => CoatSet;
}

export function createMaterials(t: TextureSet, cakeRadius: number): MaterialSet {
  const spongeCut = new THREE.MeshStandardMaterial({
    map: t.spongeCutColor,
    normalMap: t.spongeCutNormal,
    roughnessMap: t.spongeCutRough,
    aoMap: t.spongeCutAO,
    aoMapIntensity: 0.6,
    roughness: 1,
    metalness: 0,
    color: 0xffffff,
  });
  spongeCut.normalScale.set(0.45, 0.45);

  const spongeBake = new THREE.MeshStandardMaterial({
    map: t.spongeBakeColor,
    normalMap: t.spongeBakeNormal,
    roughnessMap: t.spongeBakeRough,
    roughness: 1,
    metalness: 0,
  });

  const creamBase = () =>
    new THREE.MeshPhysicalMaterial({
      map: t.creamColor,
      normalMap: t.creamNormal,
      roughnessMap: t.creamRough,
      roughness: 1,
      metalness: 0,
      sheen: 0.5,
      sheenRoughness: 0.65,
      sheenColor: new THREE.Color(0xfff4e3),
      clearcoat: 0.12,
      clearcoatRoughness: 0.5,
    });

  const cream = creamBase();
  const creamOuter = creamBase();
  addNappeStriations(creamOuter, 'wall');
  const creamTop = creamBase();
  addNappeStriations(creamTop, 'top');

  const makeCoat = (): CoatSet => {
    const wall = creamBase();
    const uWall = makeCoatable(wall, 'angular', cakeRadius, 'wall');
    addNappeStriations(wall);

    const top = creamBase();
    const uTop = makeCoatable(top, 'radialOut', cakeRadius, 'top');
    addNappeStriations(top, 'top');

    const underBase = () =>
      new THREE.MeshPhysicalMaterial({
        map: t.creamColor,
        normalMap: t.creamNormal,
        roughness: 0.62,
        metalness: 0,
        color: new THREE.Color(0xf0dfc2),
      });
    const underWall = underBase();
    const uUnderWall = makeCoatable(underWall, 'angular', cakeRadius, 'uw');
    const underTop = underBase();
    const uUnderTop = makeCoatable(underTop, 'radialOut', cakeRadius, 'ut');

    return { wall, top, underWall, underTop, u: { wall: uWall, top: uTop, underWall: uUnderWall, underTop: uUnderTop } };
  };

  const creamCut = new THREE.MeshPhysicalMaterial({
    map: t.creamCutColor,
    normalMap: t.creamCutNormal,
    roughness: 0.5,
    metalness: 0,
    sheen: 0.35,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0xfff2e0),
    clearcoat: 0.2,
    clearcoatRoughness: 0.35,
  });

  const berrySkin = new THREE.MeshPhysicalMaterial({
    map: t.berrySkinColor,
    normalMap: t.berrySkinNormal,
    roughnessMap: t.berrySkinRough,
    roughness: 1,
    metalness: 0,
    clearcoat: 0.65,
    clearcoatRoughness: 0.22,
    sheen: 0.2,
    sheenColor: new THREE.Color(0xff6a5a),
  });
  berrySkin.normalScale.set(1.1, 1.1);

  const berryHull = new THREE.MeshStandardMaterial({
    color: 0x63913f,
    roughness: 0.66,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const metal = new THREE.MeshStandardMaterial({
    color: 0xcfd3d6,
    metalness: 1,
    roughness: 1,
    roughnessMap: t.metalRough,
    normalMap: t.metalNormal,
    envMapIntensity: 1.35,
  });
  metal.normalScale.set(0.35, 0.35);

  const metalHandle = new THREE.MeshStandardMaterial({
    color: 0x2c2f33,
    metalness: 0.15,
    roughness: 0.62,
  });

  const board = new THREE.MeshStandardMaterial({
    map: t.boardColor,
    normalMap: t.boardNormal,
    roughness: 0.78,
    metalness: 0,
  });

  const bench = new THREE.MeshStandardMaterial({
    map: t.benchColor,
    normalMap: t.benchNormal,
    roughnessMap: t.benchRough,
    roughness: 1,
    metalness: 0.85,
    envMapIntensity: 0.75,
  });
  bench.normalScale.set(0.5, 0.5);

  const wall = new THREE.MeshStandardMaterial({
    map: t.wallColor,
    roughness: 0.85,
    metalness: 0,
  });

  const crumb = new THREE.MeshStandardMaterial({
    color: 0xe7cf9c,
    roughness: 0.95,
    metalness: 0,
  });

  return {
    spongeCut,
    spongeBake,
    creamOuter,
    creamTop,
    cream,
    creamCut,
    berrySkin,
    berryHull,
    berryCut: makeBerryCutMaterial(),
    metal,
    metalHandle,
    board,
    bench,
    wall,
    crumb,
    makeCoat,
  };
}
