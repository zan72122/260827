// 押し出し直後の湿潤セメント系材料のマテリアル。
// - aBirth: 押出時刻（ゲーム秒）。時間経過で乾いて明るく・艶が落ちる
// - 砂粒/骨材のスペックル、層境界の暗い水平線、微小な法線荒れ
// MeshStandardMaterial に onBeforeCompile で注入する。

import * as THREE from 'three';
import { COLORS, DIM } from '../config';

export interface ConcreteUniforms {
  uNow: { value: number };
}

export function makeConcreteMaterial(): { mat: THREE.MeshStandardMaterial; uniforms: ConcreteUniforms } {
  const uniforms: ConcreteUniforms = { uNow: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNow = uniforms.uNow;
    shader.uniforms.uWet = { value: new THREE.Color(COLORS.concreteWet) };
    shader.uniforms.uDry = { value: new THREE.Color(COLORS.concreteDry) };
    shader.uniforms.uLayerH = { value: DIM.layerH };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aBirth;
        attribute float aRand;
        varying float vBirth;
        varying float vRand;
        varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBirth = aBirth;
        vRand = aRand;
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNow;
        uniform vec3 uWet;
        uniform vec3 uDry;
        uniform float uLayerH;
        varying float vBirth;
        varying float vRand;
        varying vec3 vWPos;
        float hash3(vec3 p){
          p = fract(p * 0.3183099 + vec3(0.1, 0.17, 0.13));
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float vnoise(vec3 p){
          vec3 i = floor(p); vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float n000 = hash3(i);
          float n100 = hash3(i + vec3(1,0,0));
          float n010 = hash3(i + vec3(0,1,0));
          float n110 = hash3(i + vec3(1,1,0));
          float n001 = hash3(i + vec3(0,0,1));
          float n101 = hash3(i + vec3(1,0,1));
          float n011 = hash3(i + vec3(0,1,1));
          float n111 = hash3(i + vec3(1,1,1));
          return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
                     mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float age = max(uNow - vBirth, 0.0);
        float wet = exp(-age / 55.0);
        // 打設直後は暗く湿り、時間で明るく乾く
        vec3 cWet = uWet * (0.94 + vRand * 0.12);
        vec3 cDry = uDry * (0.95 + vRand * 0.10);
        vec3 baseCol = mix(cDry, cWet, wet);
        // 砂粒・骨材スペックル（2スケール）
        float g1 = hash3(floor(vWPos * 320.0));
        float g2 = vnoise(vWPos * 38.0);
        baseCol *= 0.92 + 0.16 * g1;
        baseCol *= 0.94 + 0.12 * g2;
        // まれに大きめの骨材が覗く明点
        float agg = step(0.988, hash3(floor(vWPos * 150.0) + 7.0));
        baseCol = mix(baseCol, vec3(0.72, 0.70, 0.66), agg * 0.55 * (1.0 - wet * 0.5));
        // 層境界: 水平の暗い積層線（境界に近いほど暗く）
        float ly = fract(vWPos.y / uLayerH);
        float seam = 1.0 - smoothstep(0.0, 0.16, min(ly, 1.0 - ly));
        baseCol *= 1.0 - seam * 0.16;
        diffuseColor.rgb = baseCol;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // 湿潤面はやや艶、乾くと艶消し
        roughnessFactor = mix(0.94, 0.42, wet);
        roughnessFactor += (g2 - 0.5) * 0.12;
        roughnessFactor = clamp(roughnessFactor + seam * 0.05, 0.3, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // 微細な表面荒れ（骨材の凹凸）
        vec3 nJ = vec3(vnoise(vWPos * 90.0) - 0.5, vnoise(vWPos * 90.0 + 31.7) - 0.5, vnoise(vWPos * 90.0 + 67.3) - 0.5);
        normal = normalize(normal + nJ * (0.35 - wet * 0.15));`);
  };
  // マージ後のジオメトリでも同じ material を共有する
  mat.customProgramCacheKey = () => 'concrete-bead';
  return { mat, uniforms };
}

/** プレキャスト屋根やスラブ用の乾いたコンクリート */
export function makePrecastMaterial(map?: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xa8a49b,
    roughness: 0.95,
    metalness: 0.0,
    map: map ?? null,
  });
}
