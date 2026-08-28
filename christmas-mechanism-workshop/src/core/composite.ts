import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * Final composite.  Two jobs:
 *   1. local heat shimmer above the flames - a screen-space warp confined
 *      to small columns over each burning wick, so hot air visibly bends
 *      what is behind it without a refraction pass or a magic blue beam;
 *   2. a gentle vignette and a whisper of warm/cool separation, then tone
 *      mapping.  Deliberately no global bloom.
 * ------------------------------------------------------------------ */

export const MAX_HEAT = 4;

export class Composite {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        uTime: { value: 0 },
        uAspect: { value: 1 },
        uVignette: { value: 0.9 },
        uHeat: { value: Array.from({ length: MAX_HEAT }, () => new THREE.Vector4(0, 0, 0, 0)) },
        uShimmer: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tScene;
        uniform float uTime;
        uniform float uAspect;
        uniform float uVignette;
        uniform float uShimmer;
        uniform vec4 uHeat[${MAX_HEAT}];
        varying vec2 vUv;

        float hash11(float p) {
          p = fract(p * 0.1031);
          p *= p + 33.33;
          return fract((p + p) * p);
        }

        void main() {
          vec2 uv = vUv;

          if (uShimmer > 0.5) {
            vec2 warp = vec2(0.0);
            for (int i = 0; i < ${MAX_HEAT}; i++) {
              vec4 h = uHeat[i];
              if (h.w <= 0.001) continue;
              vec2 d = uv - h.xy;
              d.x *= uAspect;
              // the plume only exists above the flame and widens as it climbs
              float up = uv.y - h.xy.y;
              if (up < -0.01) continue;
              float climb = clamp(up / max(h.z, 1e-4), 0.0, 1.0);
              float width = h.z * (0.34 + climb * 0.95);
              float lateral = 1.0 - smoothstep(0.0, width, abs(d.x));
              float vertical = (1.0 - smoothstep(0.0, h.z, up)) * smoothstep(-0.012, 0.02, up);
              float mask = lateral * vertical * h.w;
              if (mask <= 0.002) continue;
              float seed = hash11(float(i) * 17.13) * 40.0;
              float t = uTime * 1.9 + seed;
              float wob = sin(uv.y * 190.0 - t * 3.1) * 0.55
                        + sin(uv.y * 311.0 - t * 2.05 + 1.7) * 0.32
                        + sin(uv.x * 240.0 + t * 1.4) * 0.13;
              warp.x += wob * mask * 0.0028;
              warp.y += sin(uv.y * 150.0 - t * 2.6) * mask * 0.0011;
            }
            uv += warp;
          }

          vec3 col = texture2D(tScene, uv).rgb;

          // very small chromatic separation at the far edges: glass, not glitch
          float r2 = dot(vUv - 0.5, vUv - 0.5);
          if (r2 > 0.16) {
            vec2 off = (vUv - 0.5) * (r2 - 0.16) * 0.006;
            col.r = texture2D(tScene, uv + off).r;
            col.b = texture2D(tScene, uv - off).b;
          }

          float vig = 1.0 - uVignette * smoothstep(0.18, 0.82, r2);
          col *= vig;

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(
      new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  setHeat(index: number, x: number, y: number, radius: number, strength: number) {
    if (index >= MAX_HEAT) return;
    (this.material.uniforms.uHeat.value as THREE.Vector4[])[index].set(x, y, radius, strength);
  }
  clearHeat() {
    for (const v of this.material.uniforms.uHeat.value as THREE.Vector4[]) v.set(0, 0, 0, 0);
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
