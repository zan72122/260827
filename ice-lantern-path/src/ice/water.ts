import * as THREE from 'three';
import { NOISE_GLSL } from '../core/glsl';
import { D } from './dims';
import { moldInnerRadiusAt } from '../world/props';

const RIPPLES = 4;

export interface WaterUniforms {
  uTime: { value: number };
  uRip: { value: THREE.Vector4[] };
  uAgitate: { value: number };
  uSettle: { value: number };
  uTint: { value: THREE.Color };
}

const SURF_PARS = /* glsl */ `
uniform float uTime;
uniform vec4 uRip[${RIPPLES}];
uniform float uAgitate;
uniform float uSettle;
uniform vec3 uTint;
varying vec3 vSurfPos;
${NOISE_GLSL}
float waterH(vec2 p){
  float s = 0.0;
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 R = uRip[i];
    float age = uTime - R.w;
    if (R.z <= 0.0001 || age < 0.0 || age > 3.0) continue;
    float d = length(p - R.xy);
    s += R.z * sin(d * 105.0 - age * 13.0) * exp(-d * 11.0) * exp(-age * 2.6);
  }
  // global slosh that settles after the pour stops
  s += uSettle * 0.0016 * sin(p.x * 21.0 + uTime * 7.5) * cos(p.y * 18.0 - uTime * 6.2);
  // fine chop only while water is actually falling in
  s += uAgitate * 0.0009 * (vnoise(vec3(p * 120.0, uTime * 3.0)) - 0.5);
  return s;
}
`;

export class WaterRig {
  group = new THREE.Group();
  level = 0; // 0..1 of D.waterTop
  private surfDisc: THREE.Mesh;
  private surfRing: THREE.Mesh;
  private column: THREE.Mesh;
  private base: THREE.Mesh;
  private uniforms: WaterUniforms;
  private ripIdx = 0;
  private stream: THREE.Mesh;
  private streamMat: THREE.ShaderMaterial;
  private bubbles: THREE.InstancedMesh;
  private bubbleData: Array<{
    p: THREE.Vector3;
    v: number;
    a: number;
    r: number;
    state: 0 | 1 | 2; // rising / clinging / frozen
    life: number;
  }> = [];
  private dummy = new THREE.Object3D();
  private active = 0;
  pouring = false;
  frozen = false;
  bodyMat: THREE.MeshPhysicalMaterial;
  surfMat: THREE.MeshPhysicalMaterial;

  constructor(capacity: number, active: number) {
    this.uniforms = {
      uTime: { value: 0 },
      uRip: { value: Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, 0, -10)) },
      uAgitate: { value: 0 },
      uSettle: { value: 0 },
      uTint: { value: new THREE.Color(0xbcd8de) },
    };

    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0xa3c6ce,
      roughness: 0.08,
      metalness: 0,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
      ior: 1.33,
      envMapIntensity: 0.9,
      side: THREE.DoubleSide,
    });

    this.surfMat = new THREE.MeshPhysicalMaterial({
      color: 0xa9cfd8,
      roughness: 0.03,
      metalness: 0,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      clearcoat: 0.9,
      clearcoatRoughness: 0.04,
      ior: 1.33,
      envMapIntensity: 1.3,
      side: THREE.DoubleSide,
    });
    this.surfMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + SURF_PARS)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vSurfPos = position;
           transformed.y += waterH(position.xz);`
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + SURF_PARS)
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
           float e = 0.0035;
           float h0 = waterH(vSurfPos.xz);
           float hx = waterH(vSurfPos.xz + vec2(e, 0.0));
           float hz = waterH(vSurfPos.xz + vec2(0.0, e));
           vec3 pert = normalize(vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e));
           normal = normalize(mix(normal, normalize(vec3(pert.x, pert.y * 1.0, pert.z)), 0.85));`
        );
    };
    this.surfMat.customProgramCacheKey = () => 'water-surface';

    // --- body: a base disc plus the annulus between the two moulds ------
    const baseGeo = new THREE.CylinderGeometry(0.1495, 0.1465, D.spacerH, 48, 1, true);
    baseGeo.translate(0, D.spacerH / 2, 0);
    this.base = new THREE.Mesh(baseGeo, this.bodyMat);
    this.base.position.y = D.outerFloor;
    this.base.renderOrder = 9;
    this.group.add(this.base);

    const colH = D.waterTop - D.spacerH;
    const colGeo = new THREE.CylinderGeometry(0.1585, 0.1495, colH, 56, 1, true);
    colGeo.translate(0, colH / 2, 0);
    this.column = new THREE.Mesh(colGeo, this.bodyMat);
    this.column.position.y = D.cavityFloor;
    this.column.renderOrder = 9;
    this.group.add(this.column);

    const disc = new THREE.CircleGeometry(0.149, 56);
    disc.rotateX(-Math.PI / 2);
    this.surfDisc = new THREE.Mesh(disc, this.surfMat);
    this.surfDisc.renderOrder = 10;
    this.group.add(this.surfDisc);

    const ring = new THREE.RingGeometry(0.0955, 0.1585, 72, 3);
    ring.rotateX(-Math.PI / 2);
    this.surfRing = new THREE.Mesh(ring, this.surfMat);
    this.surfRing.renderOrder = 10;
    this.group.add(this.surfRing);

    // --- pour stream ---------------------------------------------------
    const sg = new THREE.CylinderGeometry(0.0125, 0.009, 1, 14, 1, true);
    sg.translate(0, -0.5, 0);
    this.streamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: this.uniforms.uTime,
        uTint: this.uniforms.uTint,
        uFade: { value: 1 },
      },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ vUv = uv; vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uTime; uniform vec3 uTint; uniform float uFade;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        ${NOISE_GLSL}
        void main(){
          float n = vnoise(vec3(vUv.x * 7.0, vUv.y * 13.0 - uTime * 7.5, 0.0));
          float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float fres = pow(1.0 - max(dot(vN, vV), 0.0), 1.6);
          float a = (0.30 + n * 0.35 + fres * 0.5) * smoothstep(0.0, 0.09, vUv.y) * uFade;
          gl_FragColor = vec4(uTint * (0.78 + n * 0.3 + fres * 0.45), clamp(a, 0.0, 0.86));
        }`,
    });
    this.stream = new THREE.Mesh(sg, this.streamMat);
    this.stream.visible = false;
    this.stream.renderOrder = 11;
    this.stream.frustumCulled = false;

    // --- bubbles: one fixed pool, never allocated again -----------------
    const bg = new THREE.SphereGeometry(1, 8, 6);
    const bm = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.08,
      metalness: 0,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    this.bubbles = new THREE.InstancedMesh(bg, bm, capacity);
    this.bubbles.count = 0;
    this.bubbles.renderOrder = 11;
    this.bubbles.frustumCulled = false;
    this.group.add(this.bubbles);
    for (let i = 0; i < capacity; i++) {
      this.bubbleData.push({ p: new THREE.Vector3(), v: 0, a: 0, r: 0.002, state: 0, life: 0 });
    }
    this.active = Math.min(capacity, active);

    this.setLevel(0);
  }

  get streamMesh() {
    return this.stream;
  }

  setActiveBubbles(n: number) {
    this.active = Math.min(this.bubbleData.length, n);
  }

  get surfaceY() {
    return D.outerFloor + this.level * D.waterTop;
  }

  setLevel(v: number) {
    this.level = THREE.MathUtils.clamp(v, 0, 1);
    const h = this.level * D.waterTop;
    const y = D.outerFloor + h;
    const baseH = Math.min(h, D.spacerH);
    this.base.scale.y = Math.max(0.0001, baseH / D.spacerH);
    this.base.visible = h > 0.0005;
    const colH = Math.max(0, h - D.spacerH);
    this.column.scale.y = Math.max(0.0001, colH / (D.waterTop - D.spacerH));
    this.column.visible = colH > 0.0005;

    const inAnnulus = h > D.spacerH + 0.002;
    this.surfDisc.visible = !inAnnulus && h > 0.0005;
    this.surfRing.visible = inAnnulus;
    this.surfDisc.position.y = y;
    this.surfRing.position.y = y;
    const r = moldInnerRadiusAt(y);
    this.surfDisc.scale.setScalar(Math.max(0.2, (r - 0.001) / 0.149));
    this.surfRing.scale.setScalar(Math.max(0.2, (r - 0.001) / 0.1585));
  }

  ripple(x: number, z: number, amp = 0.0022) {
    const v = this.uniforms.uRip.value[this.ripIdx % RIPPLES];
    v.set(x, z, amp, this.uniforms.uTime.value);
    this.ripIdx++;
  }

  /** spawn a bubble; kind 0 = from the pour, 1 = off a twig, 2 = on the wall */
  spawnBubble(x: number, y: number, z: number, kind: 0 | 1 | 2) {
    for (let i = 0; i < this.active; i++) {
      const b = this.bubbleData[i];
      if (b.life > 0) continue;
      b.p.set(x, y, z);
      b.r = kind === 2 ? 0.0012 + Math.random() * 0.0016 : 0.0016 + Math.random() * 0.0026;
      b.v = kind === 2 ? 0 : 0.035 + Math.random() * 0.05;
      b.a = Math.random() * Math.PI * 2;
      b.state = kind === 2 ? 1 : 0;
      b.life = kind === 2 ? 999 : 4 + Math.random() * 3;
      return;
    }
  }

  freezeBubbles() {
    for (const b of this.bubbleData) {
      if (b.life > 0) {
        b.state = 2;
        b.life = 999;
      }
    }
  }

  hideWater() {
    this.base.visible = false;
    this.column.visible = false;
    this.surfDisc.visible = false;
    this.surfRing.visible = false;
  }

  hideBubbles() {
    this.bubbles.count = 0;
    for (const b of this.bubbleData) b.life = 0;
  }

  /** from/to are world space: the stream lives outside the mould group. */
  setPour(on: boolean, from: THREE.Vector3 | null, to: THREE.Vector3 | null) {
    if (this.pouring !== on) {
      if (!on) this.uniforms.uSettle.value = Math.max(this.uniforms.uSettle.value, 1);
    }
    this.pouring = on;
    this.uniforms.uAgitate.value = on ? 1 : 0;
    this.stream.visible = on && !!from && !!to;
    if (on && from && to) {
      const len = Math.max(0.02, from.distanceTo(to));
      this.stream.position.copy(from);
      this.stream.scale.set(1, len, 1);
      const dir = new THREE.Vector3().subVectors(to, from).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      this.stream.quaternion.copy(q);
    }
  }

  update(dt: number, elapsed: number) {
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uSettle.value *= Math.pow(0.16, dt);
    if (this.uniforms.uSettle.value < 0.002) this.uniforms.uSettle.value = 0;

    const surf = this.surfaceY;
    let n = 0;
    for (let i = 0; i < this.active; i++) {
      const b = this.bubbleData[i];
      if (b.life <= 0) continue;
      if (b.state === 0) {
        b.life -= dt;
        b.p.y += b.v * dt;
        b.a += dt * 3.2;
        b.p.x += Math.cos(b.a) * 0.0009;
        b.p.z += Math.sin(b.a * 1.3) * 0.0009;
        if (b.p.y > surf - 0.004) {
          // reaches the surface: pops and leaves a ripple
          this.ripple(b.p.x, b.p.z, 0.0009);
          b.life = 0;
          continue;
        }
      } else if (b.state === 1) {
        b.a += dt * 0.6;
      }
      this.dummy.position.copy(b.p);
      this.dummy.scale.setScalar(b.r);
      this.dummy.updateMatrix();
      this.bubbles.setMatrixAt(n, this.dummy.matrix);
      n++;
    }
    this.bubbles.count = n;
    if (n > 0) this.bubbles.instanceMatrix.needsUpdate = true;
  }
}
