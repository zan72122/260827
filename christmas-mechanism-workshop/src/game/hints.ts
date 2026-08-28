import * as THREE from 'three';

/* A soft warm ring that marks where something belongs. Deliberately quiet:
 * it is a pointer for a four-year-old, not a magic effect. */

export class Indicator {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private strength = 0;
  private targetStrength = 0;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uHue: { value: 0 }, uSize: { value: 0.12 } },
      vertexShader: /* glsl */ `
        uniform float uSize;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          mv.xy += position.xy * uSize;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        uniform float uTime; uniform float uAmt; uniform float uHue;
        varying vec2 vUv;
        void main() {
          if (uAmt <= 0.003) discard;
          vec2 d = vUv - 0.5;
          float r = length(d) * 2.0;
          float pulse = 0.62 + 0.24 * sin(uTime * 2.6);
          float ring = smoothstep(0.10, 0.0, abs(r - pulse)) * 0.85;
          float inner = (1.0 - smoothstep(0.0, pulse * 0.9, r)) * 0.10;
          float a = (ring + inner) * uAmt * (1.0 - smoothstep(0.92, 1.0, r));
          if (a <= 0.004) discard;
          vec3 col = mix(vec3(1.0, 0.80, 0.46), vec3(0.72, 0.90, 1.0), uHue);
          gl_FragColor = vec4(col * (0.8 + ring), a);
        }
      `,
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
  }

  show(pos: THREE.Vector3, radius = 0.05, cool = false) {
    this.mesh.position.copy(pos);
    this.mat.uniforms.uSize.value = radius * 2.6;
    this.targetStrength = 1;
    this.mat.uniforms.uHue.value = cool ? 1 : 0;
    this.mesh.visible = true;
  }
  hide() { this.targetStrength = 0; }

  update(dt: number, time: number) {
    this.strength += (this.targetStrength - this.strength) * Math.min(1, dt * 5);
    this.mat.uniforms.uAmt.value = this.strength;
    this.mat.uniforms.uTime.value = time;
    if (this.strength < 0.004 && this.targetStrength === 0) this.mesh.visible = false;
  }
}
