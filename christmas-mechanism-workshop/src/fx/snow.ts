import * as THREE from 'three';
import { makeDotSprite } from '../mat/textures';

/** Snow beyond the window. Purely shader-driven; nothing to step on the CPU. */
export class SnowField {
  readonly points: THREE.Points;
  private material: THREE.ShaderMaterial;

  constructor(count: number, box: THREE.Box3) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const attr = new Float32Array(count * 3);
    const size = new THREE.Vector3();
    box.getSize(size);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = box.min.x + Math.random() * size.x;
      pos[i * 3 + 1] = box.min.y + Math.random() * size.y;
      pos[i * 3 + 2] = box.min.z + Math.random() * size.z;
      attr[i * 3] = 0.18 + Math.random() * 0.42;      // fall speed
      attr[i * 3 + 1] = Math.random() * 100;          // phase
      attr[i * 3 + 2] = 0.5 + Math.random() * 1.5;    // size
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aFlake', new THREE.BufferAttribute(attr, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -6), 24);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        tDot: { value: makeDotSprite(0.45) },
        uMinY: { value: box.min.y },
        uSpanY: { value: Math.max(0.001, size.y) },
        uScale: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aFlake;   // fall speed, phase, size
        uniform float uTime; uniform float uMinY; uniform float uSpanY; uniform float uScale;
        varying float vFade;
        void main() {
          vec3 p = position;
          float fall = uTime * aFlake.x + aFlake.y;
          float y = uMinY + mod(p.y - uMinY - fall, uSpanY);
          float drift = sin(uTime * 0.50 + aFlake.y * 3.1) * 0.55
                      + sin(uTime * 0.19 + aFlake.y) * 0.90;
          vec3 wp = vec3(p.x + drift, y, p.z + cos(uTime * 0.31 + aFlake.y * 2.2) * 0.35);
          vec4 mv = modelViewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aFlake.z * uScale * 9.0 / max(-mv.z, 0.5);
          // distance haze: the far village dissolves into blue dusk
          vFade = 0.78 * (1.0 - smoothstep(8.0, 26.0, -mv.z));
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        uniform sampler2D tDot;
        varying float vFade;
        void main() {
          float a = texture2D(tDot, gl_PointCoord).a * vFade;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.84, 0.90, 1.0), a);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;
  }

  setDpr(s: number) { this.material.uniforms.uScale.value = s; }
  update(_dt: number, time: number) { this.material.uniforms.uTime.value = time; }
}
