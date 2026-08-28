import * as THREE from 'three';
import { makeDotSprite } from '../mat/textures';

/* ------------------------------------------------------------------ *
 * Fine workshop dust.  It drifts everywhere, but over a lit candle it is
 * dragged upward - which is the only honest way to show that hot air is
 * rising without painting a magic beam on the screen.
 * ------------------------------------------------------------------ */

const MAX_THERMALS = 3;

export class DustField {
  readonly points: THREE.Points;
  private material: THREE.ShaderMaterial;

  constructor(count: number, bounds: THREE.Box3) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const attr = new Float32Array(count * 3); // speed, phase, size
    const size = new THREE.Vector3();
    bounds.getSize(size);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = bounds.min.x + Math.random() * size.x;
      pos[i * 3 + 1] = bounds.min.y + Math.random() * size.y;
      pos[i * 3 + 2] = bounds.min.z + Math.random() * size.z;
      attr[i * 3] = 0.006 + Math.random() * 0.022;
      attr[i * 3 + 1] = Math.random() * 100;
      attr[i * 3 + 2] = 0.6 + Math.random() * 1.2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aMote', new THREE.BufferAttribute(attr, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 8);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        tDot: { value: makeDotSprite(0.2) },
        uMinY: { value: bounds.min.y },
        uSpanY: { value: Math.max(0.001, size.y) },
        uScale: { value: 1 },
        uThermal: { value: Array.from({ length: MAX_THERMALS }, () => new THREE.Vector4(0, -99, 0, 0)) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aMote;   // speed, phase, size
        uniform float uTime;
        uniform float uMinY;
        uniform float uSpanY;
        uniform float uScale;
        uniform vec4 uThermal[${MAX_THERMALS}];
        varying float vFade;
        void main() {
          vec3 p = position;
          float rise = aMote.x;
          float boost = 0.0;
          for (int i = 0; i < ${MAX_THERMALS}; i++) {
            vec4 h = uThermal[i];
            if (h.w <= 0.001) continue;
            vec2 d = p.xz - h.xz;
            float radial = 1.0 - smoothstep(0.0, 0.075, length(d));
            float above = smoothstep(-0.03, 0.02, p.y - h.y) * (1.0 - smoothstep(0.0, 0.6, p.y - h.y));
            boost += radial * above * h.w;
          }
          rise += boost * 0.22;
          float y = uMinY + mod(p.y - uMinY + uTime * rise + aMote.y, uSpanY);
          float sw = sin(uTime * 0.42 + aMote.y * 6.2) * 0.035;
          float sw2 = cos(uTime * 0.33 + aMote.y * 4.7) * 0.035;
          vec3 wp = vec3(p.x + sw, y, p.z + sw2);
          vec4 mv = modelViewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aMote.z * uScale * (1.0 + boost * 1.6) * 1.35 / max(-mv.z, 0.05);
          vFade = 0.085 + boost * 0.42;
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        uniform sampler2D tDot;
        varying float vFade;
        void main() {
          float a = texture2D(tDot, gl_PointCoord).a * vFade;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vec3(1.0, 0.84, 0.62), a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  setThermal(i: number, p: THREE.Vector3 | null, strength: number) {
    if (i >= MAX_THERMALS) return;
    const arr = this.material.uniforms.uThermal.value as THREE.Vector4[];
    if (!p) arr[i].set(0, -99, 0, 0);
    else arr[i].set(p.x, p.y, p.z, strength);
  }
  setDpr(scale: number) { this.material.uniforms.uScale.value = scale; }
  update(_dt: number, time: number) { this.material.uniforms.uTime.value = time; }
}
