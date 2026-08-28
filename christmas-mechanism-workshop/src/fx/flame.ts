import * as THREE from 'three';
import { clamp, damp } from '../util/math';

/* ------------------------------------------------------------------ *
 * Candle and lighter flames.  Small geometry (one cylindrical billboard
 * each) plus a shader that shapes a teardrop with a blue base and flickers
 * on cheap trig noise.  All flames in the workshop live in one draw call.
 * ------------------------------------------------------------------ */

export class FlameField {
  readonly mesh: THREE.Mesh;
  readonly count: number;
  private aOffset: THREE.InstancedBufferAttribute;
  private aScale: THREE.InstancedBufferAttribute;
  private aSeed: THREE.InstancedBufferAttribute;
  private aAmt: THREE.InstancedBufferAttribute;
  private target: Float32Array;
  private material: THREE.ShaderMaterial;
  private flicker: Float32Array;

  constructor(count: number) {
    this.count = count;
    const base = new THREE.PlaneGeometry(1, 1, 1, 6);
    base.translate(0, 0.5, 0);

    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    geo.instanceCount = count;

    this.aOffset = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.aScale = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
    this.aSeed = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.aAmt = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    for (let i = 0; i < count; i++) {
      this.aSeed.setX(i, Math.random() * 100);
      this.aScale.setXY(i, 0.011, 0.026);
      this.aOffset.setXYZ(i, 0, -999, 0);
    }
    geo.setAttribute('aOffset', this.aOffset);
    geo.setAttribute('aScale', this.aScale);
    geo.setAttribute('aSeed', this.aSeed);
    geo.setAttribute('aAmt', this.aAmt);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 12);

    this.target = new Float32Array(count);
    this.flicker = new Float32Array(count);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute vec2 aScale;
        attribute float aSeed;
        attribute float aAmt;
        varying vec2 vUv;
        varying float vSeed;
        varying float vAmt;
        void main() {
          vUv = uv; vSeed = aSeed; vAmt = aAmt;
          vec3 toCam = normalize(cameraPosition - aOffset);
          vec3 up = vec3(0.0, 1.0, 0.0);
          vec3 right = normalize(cross(up, toCam));
          float s = 0.55 + 0.45 * clamp(aAmt, 0.0, 1.0);
          vec3 wp = aOffset
                  + right * position.x * aScale.x * s
                  + up * position.y * aScale.y * s;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uTime;
        varying vec2 vUv;
        varying float vSeed;
        varying float vAmt;

        void main() {
          if (vAmt <= 0.004) discard;
          float t = uTime * 1.0 + vSeed * 9.7;

          // the tip wanders, the root stays put
          float sway = (sin(t * 6.3 + vUv.y * 5.4) * 0.55
                      + sin(t * 10.9 + vUv.y * 9.1 + 1.9) * 0.3) * 0.075 * pow(vUv.y, 1.7);
          float x = (vUv.x - 0.5) + sway;

          float h = 0.80 + 0.13 * sin(t * 8.1 + vSeed) + 0.07 * sin(t * 14.3 + 2.1);
          float y = vUv.y / max(h, 0.2);
          if (y > 1.0) discard;

          float w = 0.50 * pow(1.0 - y, 0.5) * pow(clamp(y * 5.0, 0.0, 1.0), 0.42);
          float d = abs(x) / max(w, 1e-4);
          float body = 1.0 - smoothstep(0.55, 1.02, d);
          if (body <= 0.001) discard;

          float core = 1.0 - smoothstep(0.0, 0.62, d + y * 0.75);
          float bluish = (1.0 - smoothstep(0.0, 0.30, y)) * (1.0 - smoothstep(0.55, 1.0, d));

          vec3 col = mix(vec3(1.00, 0.42, 0.10), vec3(1.0, 0.80, 0.42), core);
          col = mix(col, vec3(1.0, 0.96, 0.86), core * core * 0.85);
          col = mix(col, vec3(0.34, 0.55, 1.0), bluish * 0.72);

          float a = body * (0.55 + core * 0.65) * vAmt;
          a *= 1.0 - smoothstep(0.86, 1.0, y);
          gl_FragColor = vec4(col * (1.5 + core * 2.6) * vAmt, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  place(i: number, p: THREE.Vector3, w = 0.011, h = 0.026) {
    this.aOffset.setXYZ(i, p.x, p.y, p.z);
    this.aScale.setXY(i, w, h);
    this.aOffset.needsUpdate = true;
    this.aScale.needsUpdate = true;
  }
  setLit(i: number, on: boolean) { this.target[i] = on ? 1 : 0; }
  isLit(i: number) { return this.target[i] > 0.5; }
  /** 0..1 how far along the ignition ramp this flame is */
  amount(i: number) { return this.aAmt.getX(i); }

  update(dt: number, time: number) {
    this.material.uniforms.uTime.value = time;
    let dirty = false;
    for (let i = 0; i < this.count; i++) {
      const cur = this.aAmt.getX(i);
      const tgt = this.target[i];
      if (Math.abs(cur - tgt) > 0.0008) {
        // catching is quick, dying back is slower
        const next = damp(cur, tgt, tgt > cur ? 7.5 : 4.0, dt);
        this.aAmt.setX(i, clamp(next, 0, 1));
        dirty = true;
      } else if (cur !== tgt) {
        this.aAmt.setX(i, tgt);
        dirty = true;
      }
      this.flicker[i] = 0.82 + 0.18 * Math.sin(time * 7.3 + i * 2.1);
    }
    if (dirty) this.aAmt.needsUpdate = true;
  }

  /** flicker-modulated brightness for the light rigs that follow a flame */
  brightness(i: number) { return this.aAmt.getX(i) * this.flicker[i]; }

  worldPos(i: number, out: THREE.Vector3) {
    return out.set(this.aOffset.getX(i), this.aOffset.getY(i), this.aOffset.getZ(i));
  }
}
