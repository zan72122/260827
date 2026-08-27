import * as THREE from 'three';
import { clamp } from './util';

/**
 * World-space wetness accumulator. Water impacts are splatted into a
 * render target covering the training pad (XZ plane). Materials opt in
 * via makeWettable(): where the mask is wet, albedo darkens and
 * roughness drops so the surface picks up sheen — dry vs. wet is
 * readable at a glance, and dwelling longer wets more.
 *
 * A coarse CPU mirror of the same data drives gameplay (drips) and the
 * automated playtests.
 */

// world region covered by the mask
export const WET_X0 = -14;
export const WET_Z0 = -4;
export const WET_W = 28;
export const WET_H = 28;

const RT_SIZE = 512;
const GRID = 96;

export class WetMask {
  readonly texture: THREE.Texture;
  private rt: THREE.WebGLRenderTarget;
  private splatScene: THREE.Scene;
  private splatCam: THREE.OrthographicCamera;
  private splatMesh: THREE.Mesh;
  private splatMat: THREE.ShaderMaterial;
  private pending: { x: number; z: number; radius: number; strength: number }[] = [];
  private cpu = new Float32Array(GRID * GRID);
  private needsClear = true;

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(RT_SIZE, RT_SIZE, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.texture = this.rt.texture;
    this.splatScene = new THREE.Scene();
    this.splatCam = new THREE.OrthographicCamera(WET_X0, WET_X0 + WET_W, WET_Z0 + WET_H, WET_Z0, -1, 1);
    this.splatMat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      uniforms: { uStrength: { value: 0.1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uStrength;
        void main(){
          float r = length(vUv - 0.5) * 2.0;
          float s = uStrength * smoothstep(1.0, 0.25, r);
          gl_FragColor = vec4(s, s, s, 1.0);
        }
      `,
    });
    this.splatMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.splatMat);
    this.splatScene.add(this.splatMesh);
  }

  /** queue a wet splat at world (x, z) */
  splat(x: number, z: number, radius: number, strength: number): void {
    this.pending.push({ x, z, radius, strength });
    // CPU mirror
    const gx = ((x - WET_X0) / WET_W) * GRID;
    const gz = ((z - WET_Z0) / WET_H) * GRID;
    const gr = Math.max(1, (radius / WET_W) * GRID);
    const x0 = Math.max(0, Math.floor(gx - gr)), x1 = Math.min(GRID - 1, Math.ceil(gx + gr));
    const z0 = Math.max(0, Math.floor(gz - gr)), z1 = Math.min(GRID - 1, Math.ceil(gz + gr));
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const d = Math.hypot(ix - gx, iz - gz) / gr;
        if (d < 1) this.cpu[iz * GRID + ix] += strength * (1 - d * 0.75);
      }
    }
  }

  /** wetness 0..~saturated at a world point (CPU mirror) */
  sample(x: number, z: number): number {
    const gx = Math.round(((x - WET_X0) / WET_W) * GRID);
    const gz = Math.round(((z - WET_Z0) / WET_H) * GRID);
    if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID) return 0;
    return this.cpu[gz * GRID + gx];
  }

  totalWetness(): number {
    let s = 0;
    for (let i = 0; i < this.cpu.length; i++) s += clamp(this.cpu[i], 0, 2);
    return s;
  }

  reset(): void {
    this.needsClear = true;
    this.pending.length = 0;
    this.cpu.fill(0);
  }

  /** render queued splats into the RT; call once per frame before the main render */
  flush(renderer: THREE.WebGLRenderer): void {
    if (!this.needsClear && this.pending.length === 0) return;
    const prevRT = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.rt);
    if (this.needsClear) {
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, false, false);
      this.needsClear = false;
    }
    for (const s of this.pending) {
      this.splatMesh.position.set(s.x, s.z, 0);
      this.splatMesh.scale.set(s.radius * 2, s.radius * 2, 1);
      this.splatMat.uniforms.uStrength.value = s.strength;
      renderer.render(this.splatScene, this.splatCam);
    }
    this.pending.length = 0;
    renderer.setRenderTarget(prevRT);
    renderer.autoClear = prevAutoClear;
  }
}

/**
 * Inject wet-mask sampling into a MeshStandardMaterial: darkens albedo and
 * lowers roughness where wet. darken=how strongly the albedo drops.
 */
export function makeWettable(mat: THREE.MeshStandardMaterial, wet: WetMask, darken = 0.55): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWetMask = { value: wet.texture };
    shader.uniforms.uWetRegion = { value: new THREE.Vector4(WET_X0, WET_Z0, WET_W, WET_H) };
    shader.uniforms.uWetDarken = { value: darken };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFfWorldPos;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFfWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFfWorldPos;
        uniform sampler2D uWetMask;
        uniform vec4 uWetRegion;
        uniform float uWetDarken;
        float ffWetAmount(){
          vec2 wuv = (vFfWorldPos.xz - uWetRegion.xy) / uWetRegion.zw;
          if (any(lessThan(wuv, vec2(0.0))) || any(greaterThan(wuv, vec2(1.0)))) return 0.0;
          return smoothstep(0.04, 0.55, texture2D(uWetMask, wuv).r);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float ffWet = ffWetAmount();
        diffuseColor.rgb *= mix(1.0, 1.0 - uWetDarken, ffWet);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.9, 0.97, 1.05), ffWet * 0.6);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.07, ffWet);`,
      );
  };
  mat.needsUpdate = true;
}
