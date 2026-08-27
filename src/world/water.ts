import * as THREE from 'three';
import { WORLD } from './terrain';
import type { Quality } from '../core/quality';

// Sea surface: low-frequency vertex waves + analytic normals + fresnel sky
// reflection + depth-based colour from a precomputed seabed depth texture.
// No fluid sim. The `uClarity` uniform is raised during route planning so the
// seabed reads clearly through the water, and lowered for the realistic look
// while sailing.
export class Water {
  readonly mesh: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;

  constructor(depthTex: THREE.Texture, quality: Quality) {
    const w = WORLD.maxX - WORLD.minX;
    const h = WORLD.maxZ - WORLD.minZ;
    const geo = new THREE.PlaneGeometry(w, h, quality.waterSeg, Math.round(quality.waterSeg * 0.7));
    geo.rotateX(-Math.PI / 2);

    this.uniforms = {
      uTime: { value: 0 },
      uClarity: { value: 0.5 },
      uSunDir: { value: new THREE.Vector3(0.35, 0.8, 0.3).normalize() },
      uDepthTex: { value: depthTex },
      uWorldMin: { value: new THREE.Vector2(WORLD.minX, WORLD.minZ) },
      uWorldSize: { value: new THREE.Vector2(w, h) },
      uShallow: { value: new THREE.Color(0x3d9db0) },
      uDeep: { value: new THREE.Color(0x0b3d5c) },
      uSkyHorizon: { value: new THREE.Color(0xcfe4ee) },
      uSkyZenith: { value: new THREE.Color(0x3f7fc2) },
      uFogColor: { value: new THREE.Color(0x0b3d5c) },
      uFogDensity: { value: 0.0 }
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorld;
        varying vec3 vNormalW;

        // 3 low-frequency directional waves; returns height and accumulates
        // analytic slope for the normal.
        float waveH(vec2 p, vec2 dir, float amp, float len, float speed, inout vec2 slope) {
          float k = 6.28318 / len;
          float ph = dot(p, dir) * k + uTime * speed;
          float s = sin(ph);
          float c = cos(ph);
          slope += dir * (amp * k * c);
          return amp * s;
        }

        void main() {
          vec3 pos = position;
          vec2 p = (modelMatrix * vec4(position, 1.0)).xz;
          vec2 slope = vec2(0.0);
          float y = 0.0;
          y += waveH(p, normalize(vec2(1.0, 0.35)), 0.28, 34.0, 0.9, slope);
          y += waveH(p, normalize(vec2(-0.5, 1.0)), 0.18, 21.0, 1.2, slope);
          y += waveH(p, normalize(vec2(0.3, -1.0)), 0.10, 11.0, 1.7, slope);
          pos.y += y;
          vNormalW = normalize(vec3(-slope.x, 1.0, -slope.y));
          vec4 wp = modelMatrix * vec4(pos, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uClarity;
        uniform vec3 uSunDir;
        uniform sampler2D uDepthTex;
        uniform vec2 uWorldMin;
        uniform vec2 uWorldSize;
        uniform vec3 uShallow;
        uniform vec3 uDeep;
        uniform vec3 uSkyHorizon;
        uniform vec3 uSkyZenith;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        varying vec3 vWorld;
        varying vec3 vNormalW;

        void main() {
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 N = normalize(vNormalW);

          vec2 uv = (vWorld.xz - uWorldMin) / uWorldSize;
          float depth01 = texture2D(uDepthTex, uv).r;

          if (gl_FrontFacing) {
            // Seen from above: depth colour + fresnel sky reflection + sun glint.
            vec3 waterCol = mix(uShallow, uDeep, smoothstep(0.02, 0.75, depth01));
            float fres = pow(1.0 - max(dot(V, N), 0.0), 3.0);
            fres = mix(0.04, 0.85, fres);
            vec3 R = reflect(-V, N);
            vec3 sky = mix(uSkyHorizon, uSkyZenith, clamp(R.y, 0.0, 1.0));
            float glint = pow(max(dot(R, uSunDir), 0.0), 220.0) * 3.0;
            vec3 col = mix(waterCol, sky, fres) + vec3(1.0, 0.95, 0.8) * glint;
            // Clarity: planning view lets the seabed show through.
            float alpha = mix(0.88, 0.42, uClarity);
            alpha = mix(alpha, min(alpha + 0.35, 0.96), fres);
            // Shore fade so the edge does not cut hard across beaches.
            alpha *= smoothstep(0.0, 0.035, depth01);
            gl_FragColor = vec4(col, alpha);
          } else {
            // Seen from below: bright ceiling toward the sun (Snell-window feel).
            float up = pow(max(dot(-V, vec3(0.0, 1.0, 0.0)), 0.0), 2.0);
            vec3 ceilCol = mix(uDeep * 1.1, vec3(0.75, 0.9, 0.95), up * 0.85);
            float sunPatch = pow(max(dot(normalize(-V + N * 0.2), uSunDir), 0.0), 18.0);
            ceilCol += vec3(0.9, 0.9, 0.75) * sunPatch * 0.7;
            float dist = length(cameraPosition - vWorld);
            float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
            vec3 col = mix(ceilCol, uFogColor, f);
            gl_FragColor = vec4(col, 0.92);
          }
        }
      `
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'water';
    this.mesh.renderOrder = 5;
  }

  /** Swap in the depth field of a re-seeded seabed (replays). */
  setDepthTexture(tex: THREE.Texture): void {
    this.uniforms.uDepthTex.value = tex;
  }
  setClarity(v: number): void {
    this.uniforms.uClarity.value = v;
  }
  getClarity(): number {
    return this.uniforms.uClarity.value as number;
  }
  setUnderFog(color: THREE.Color, density: number): void {
    (this.uniforms.uFogColor.value as THREE.Color).copy(color);
    this.uniforms.uFogDensity.value = density;
  }
  update(t: number): void {
    this.uniforms.uTime.value = t;
  }
  /** Approximate surface height for floating things (matches vertex shader). */
  surfaceY(x: number, z: number, t: number): number {
    const wave = (dx: number, dz: number, amp: number, len: number, speed: number) => {
      const l = Math.hypot(dx, dz);
      const ux = dx / l, uz = dz / l;
      const k = 6.28318 / len;
      return amp * Math.sin((x * ux + z * uz) * k + t * speed);
    };
    return wave(1, 0.35, 0.28, 34, 0.9) + wave(-0.5, 1, 0.18, 21, 1.2) + wave(0.3, -1, 0.10, 11, 1.7);
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
