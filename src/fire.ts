import * as THREE from 'three';
import { GLSL_NOISE, clamp, damp, mulberry32 } from './util';
import { ParticleSystem, PType } from './particles';
import { WetMask, makeWettable } from './wetmask';

/**
 * A controlled training fire: a burn structure (steel pan, firebrick
 * enclosure, or wooden crib) plus procedural flame billboards, an ember
 * bed, a flickering light, and smoke/steam hooks.
 *
 * Fire weakens ONLY from water landing near it (per-frame falloff around
 * the impact point). As intensity drops the flames get shorter, cooler in
 * color and dimmer, smoke thins, and the crackle bed (audio) fades.
 */

export type FireKind = 'pan' | 'brick' | 'crib';

export interface FireSpotConfig {
  kind: FireKind;
  x: number;
  z: number;
  /** flame footprint radius */
  radius: number;
  seed: number;
}

const flameVert = /* glsl */ `
attribute vec3 aCenter;
attribute vec2 aCorner;
attribute vec2 aSize;
attribute float aPhase;
uniform float uTime;
uniform float uIntensity;
uniform vec3 uCamRight;
varying vec2 vUv;
varying float vPhase;
void main(){
  float h = aSize.y * (0.3 + 0.7 * uIntensity);
  float w = aSize.x * (0.5 + 0.5 * uIntensity);
  float sway = sin(uTime * 2.7 + aPhase * 19.0) * 0.09 * h * aCorner.y;
  vec3 pos = aCenter
    + uCamRight * (aCorner.x * w + sway)
    + vec3(0.0, 1.0, 0.0) * (aCorner.y * h);
  vUv = vec2(aCorner.x + 0.5, aCorner.y);
  vPhase = aPhase;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const flameFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vPhase;
uniform float uTime;
uniform float uIntensity;
${GLSL_NOISE}
void main(){
  float t = uTime * (1.5 + vPhase * 0.8);
  float n = ffFbm(vec2(vUv.x * 2.4 + vPhase * 7.0, vUv.y * 2.8 - t));
  float cx = vUv.x - 0.5;
  float body = 1.0 - smoothstep(0.0, 0.5, abs(cx) * (1.1 + vUv.y * 1.7));
  float vert = 1.0 - vUv.y;
  float d = body * vert * 1.7 + n * 0.85 - 0.92;
  float a = smoothstep(0.0, 0.3, d);
  if (a < 0.02) discard;
  float core = smoothstep(0.22, 0.7, d);
  vec3 cool = vec3(0.62, 0.10, 0.02);
  vec3 mid  = vec3(1.0, 0.42, 0.05);
  vec3 hot  = vec3(1.0, 0.86, 0.5);
  vec3 col = mix(cool, mid, smoothstep(0.0, 0.4, d));
  col = mix(col, hot, core * (0.3 + 0.7 * uIntensity));
  col *= (0.3 + 0.85 * uIntensity);
  gl_FragColor = vec4(col * a, a);
}
`;

export class FireSpot {
  readonly cfg: FireSpotConfig;
  readonly group = new THREE.Group();
  readonly position: THREE.Vector3;
  /** height above ground at which water visually lands on this target */
  readonly surfaceY: number;
  /** 0..1 burning intensity */
  intensity = 1;
  /** lingers after dousing so steam keeps rising briefly */
  residualHeat = 1;
  /** accumulated water on/around this target, feeds after-drips */
  wetLoad = 0;

  private flameMat: THREE.ShaderMaterial;
  private light: THREE.PointLight;
  private emberMat: THREE.MeshStandardMaterial;
  private displayIntensity = 1;
  private smokeAccum = 0;
  private dripAccum = 0;
  private rand: () => number;
  private dripPoints: THREE.Vector3[] = [];

  constructor(cfg: FireSpotConfig, wet: WetMask, envSeenMats: THREE.MeshStandardMaterial[]) {
    this.cfg = cfg;
    this.rand = mulberry32(cfg.seed);
    this.position = new THREE.Vector3(cfg.x, 0, cfg.z);
    this.group.position.copy(this.position);

    const structTop = this.buildStructure(wet, envSeenMats);
    this.surfaceY = structTop;

    // ember bed
    this.emberMat = new THREE.MeshStandardMaterial({
      color: 0x1a0d08,
      roughness: 0.9,
      emissive: new THREE.Color(0xff5a18),
      emissiveIntensity: 1.4,
    });
    const ember = new THREE.Mesh(
      new THREE.CylinderGeometry(cfg.radius * 0.72, cfg.radius * 0.72, 0.05, 20),
      this.emberMat,
    );
    ember.position.y = structTop + 0.02;
    this.group.add(ember);

    // flame billboards, one draw call per spot
    this.flameMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1 },
        uCamRight: { value: new THREE.Vector3(1, 0, 0) },
      },
      vertexShader: flameVert,
      fragmentShader: flameFrag,
    });
    this.group.add(this.buildFlameMesh(structTop));

    this.light = new THREE.PointLight(0xff7a28, 14, 9, 2);
    this.light.position.set(0, structTop + 0.7, 0);
    this.group.add(this.light);
  }

  private buildFlameMesh(baseY: number): THREE.Mesh {
    const { radius } = this.cfg;
    const count = 7;
    const centers = new Float32Array(count * 4 * 3);
    const corners = new Float32Array(count * 4 * 2);
    const sizes = new Float32Array(count * 4 * 2);
    const phases = new Float32Array(count * 4);
    const indices: number[] = [];
    for (let i = 0; i < count; i++) {
      const ang = this.rand() * Math.PI * 2;
      const rr = this.rand() * radius * 0.62;
      const cx = Math.cos(ang) * rr;
      const cz = Math.sin(ang) * rr;
      const w = 0.5 + this.rand() * 0.55;
      const h = 0.75 + this.rand() * 0.75;
      const ph = this.rand();
      const cornerXY = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
      for (let c = 0; c < 4; c++) {
        const vi = i * 4 + c;
        centers[vi * 3] = cx; centers[vi * 3 + 1] = baseY; centers[vi * 3 + 2] = cz;
        corners[vi * 2] = cornerXY[c][0]; corners[vi * 2 + 1] = cornerXY[c][1];
        sizes[vi * 2] = w; sizes[vi * 2 + 1] = h;
        phases[vi] = ph;
      }
      const b = i * 4;
      indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 4 * 3), 3));
    geo.setAttribute('aCenter', new THREE.BufferAttribute(centers, 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 2));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setIndex(indices);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, baseY + 1, 0), radius + 2.2);
    const mesh = new THREE.Mesh(geo, this.flameMat);
    mesh.renderOrder = 20;
    return mesh;
  }

  /** returns the y of the burn surface */
  private buildStructure(wet: WetMask, envSeenMats: THREE.MeshStandardMaterial[]): number {
    const { kind, radius } = this.cfg;
    const g = this.group;

    const registerWettable = (mat: THREE.MeshStandardMaterial, darken: number) => {
      makeWettable(mat, wet, darken);
      envSeenMats.push(mat);
      return mat;
    };

    if (kind === 'pan') {
      // steel training pan with a scorched rim
      const steel = registerWettable(new THREE.MeshStandardMaterial({
        color: 0x3c3f42, metalness: 0.75, roughness: 0.5,
      }), 0.45);
      const wall = new THREE.Mesh(
        new THREE.CylinderGeometry(radius + 0.12, radius + 0.16, 0.3, 26, 1, true),
        steel,
      );
      wall.position.y = 0.15;
      wall.castShadow = true;
      g.add(wall);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.12, 0.028, 8, 26), steel);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.3;
      g.add(rim);
      const soot = new THREE.Mesh(
        new THREE.CylinderGeometry(radius + 0.121, radius + 0.121, 0.1, 26, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.95 }),
      );
      soot.position.y = 0.26;
      soot.rotation.y = this.rand() * Math.PI; // asymmetric scorch band
      soot.scale.setScalar(1.001);
      g.add(soot);
      const bed = new THREE.Mesh(
        new THREE.CylinderGeometry(radius + 0.1, radius + 0.1, 0.04, 26),
        new THREE.MeshStandardMaterial({ color: 0x17110c, roughness: 0.98 }),
      );
      bed.position.y = 0.22;
      g.add(bed);
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2 + 0.4;
        this.dripPoints.push(new THREE.Vector3(Math.cos(ang) * (radius + 0.14), 0.28, Math.sin(ang) * (radius + 0.14)));
      }
      return 0.26;
    }

    if (kind === 'brick') {
      // low firebrick enclosure, open at the front, pan inside
      const brickMat = registerWettable(new THREE.MeshStandardMaterial({
        color: 0xb99c72, roughness: 0.9,
      }), 0.55);
      const sootMat = new THREE.MeshStandardMaterial({ color: 0x241d16, roughness: 0.95 });
      const bw = 0.24, bh = 0.13, bd = 0.115;
      const half = radius + 0.32;
      const brickGeo = new THREE.BoxGeometry(bw, bh, bd);
      const layRow = (y: number, offset: number) => {
        const perimeter: { x: number; z: number; ry: number }[] = [];
        const n = 5;
        for (let i = 0; i < n; i++) {
          const t = (i + offset) / n - 0.5 + 0.1;
          perimeter.push({ x: t * half * 2, z: -half, ry: 0 }); // back
          perimeter.push({ x: -half, z: t * half * 2, ry: Math.PI / 2 }); // left
          perimeter.push({ x: half, z: t * half * 2, ry: Math.PI / 2 }); // right
        }
        for (const b of perimeter) {
          const m = new THREE.Mesh(brickGeo, this.rand() < 0.25 ? sootMat : brickMat);
          m.position.set(b.x + (this.rand() - 0.5) * 0.015, y, b.z + (this.rand() - 0.5) * 0.015);
          m.rotation.y = b.ry + (this.rand() - 0.5) * 0.06;
          m.castShadow = true;
          this.group.add(m);
        }
      };
      layRow(bh / 2, 0);
      layRow(bh * 1.5, 0.5);
      layRow(bh * 2.5, 0);
      const bed = new THREE.Mesh(
        new THREE.CylinderGeometry(radius + 0.12, radius + 0.12, 0.06, 22),
        new THREE.MeshStandardMaterial({ color: 0x1a130d, roughness: 0.98 }),
      );
      bed.position.y = 0.06;
      g.add(bed);
      for (let i = 0; i < 4; i++) {
        this.dripPoints.push(new THREE.Vector3((this.rand() - 0.5) * half * 1.6, bh * 3, half * (this.rand() < 0.5 ? 1 : -1)));
      }
      return 0.1;
    }

    // 'crib': stacked wooden burn crib, charred on top
    const woodMat = registerWettable(new THREE.MeshStandardMaterial({
      color: 0x74553a, roughness: 0.85,
    }), 0.6);
    const charMat = registerWettable(new THREE.MeshStandardMaterial({
      color: 0x191512, roughness: 0.95,
    }), 0.35);
    const plankLen = radius * 2.4;
    const plankGeo = new THREE.BoxGeometry(plankLen, 0.09, 0.09);
    const layers = 4;
    for (let l = 0; l < layers; l++) {
      for (let i = 0; i < 3; i++) {
        const mat = l >= layers - 2 ? charMat : woodMat;
        const m = new THREE.Mesh(plankGeo, mat);
        const off = (i - 1) * radius * 0.75;
        m.position.y = 0.045 + l * 0.095;
        if (l % 2 === 0) {
          m.position.z = off;
          m.rotation.y = (this.rand() - 0.5) * 0.05;
        } else {
          m.position.x = off;
          m.rotation.y = Math.PI / 2 + (this.rand() - 0.5) * 0.05;
        }
        m.castShadow = true;
        g.add(m);
      }
    }
    const top = 0.045 + (layers - 1) * 0.095 + 0.05;
    for (let i = 0; i < 5; i++) {
      this.dripPoints.push(new THREE.Vector3(
        (this.rand() - 0.5) * plankLen * 0.9, top - 0.1 - this.rand() * 0.2, (this.rand() - 0.5) * plankLen * 0.9,
      ));
    }
    return top;
  }

  /**
   * Apply water landing at world point `impact` for dt seconds.
   * Returns the local heat factor (0..1) used for steam/audio.
   */
  douse(impact: THREE.Vector3, dt: number): number {
    const dx = impact.x - this.position.x;
    const dz = impact.z - this.position.z;
    const d = Math.hypot(dx, dz);
    const reach = this.cfg.radius + 0.85;
    if (d > reach) return 0;
    const falloff = 1 - Math.max(0, (d - this.cfg.radius * 0.4) / (reach - this.cfg.radius * 0.4));
    const eff = falloff * falloff;
    this.intensity = clamp(this.intensity - 0.5 * eff * dt, 0, 1);
    this.wetLoad = clamp(this.wetLoad + eff * dt * 1.6, 0, 4);
    return eff * this.residualHeat;
  }

  update(dt: number, time: number, camera: THREE.Camera, particles: ParticleSystem, audioDrip: () => void): void {
    // display intensity eases toward the true value so dousing reads smoothly
    this.displayIntensity = damp(this.displayIntensity, this.intensity, 6, dt);
    const di = this.displayIntensity;

    if (this.intensity <= 0.02) {
      this.residualHeat = Math.max(0, this.residualHeat - dt * 0.12);
    } else {
      this.residualHeat = Math.max(this.residualHeat, this.intensity);
    }

    const flicker = 0.85 + 0.15 * Math.sin(time * 13 + this.cfg.seed) * Math.sin(time * 7.3);
    this.flameMat.uniforms.uTime.value = time;
    this.flameMat.uniforms.uIntensity.value = di * flicker;
    const camRight = this.flameMat.uniforms.uCamRight.value as THREE.Vector3;
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    camRight.y = 0;
    camRight.normalize();

    this.light.intensity = 15 * di * flicker;
    this.light.color.setHSL(0.052 + 0.02 * di, 0.95, 0.55);
    this.emberMat.emissiveIntensity = 1.5 * di + 0.25 * this.residualHeat;

    // smoke: thins as the fire dies
    this.smokeAccum += dt * (1.5 + 7 * di) * (di > 0.02 ? 1 : 0);
    while (this.smokeAccum > 1) {
      this.smokeAccum -= 1;
      const r = this.cfg.radius * 0.5;
      particles.spawn(
        PType.Smoke,
        this.position.x + (Math.random() - 0.5) * r,
        this.surfaceY + 0.7 + di * 0.8,
        this.position.z + (Math.random() - 0.5) * r,
        (Math.random() - 0.5) * 0.2, 0.7 + Math.random() * 0.5, (Math.random() - 0.5) * 0.2,
        2.2 + Math.random() * 1.4, 0.55,
      );
    }

    // after-drips from a soaked target
    if (this.wetLoad > 0.25) {
      this.dripAccum += dt * Math.min(this.wetLoad, 2.5) * 2.4;
      this.wetLoad = Math.max(0, this.wetLoad - dt * 0.12);
      while (this.dripAccum > 1) {
        this.dripAccum -= 1;
        const p = this.dripPoints[(Math.random() * this.dripPoints.length) | 0];
        particles.spawn(
          PType.Drip,
          this.position.x + p.x, p.y, this.position.z + p.z,
          0, -0.2, 0,
          0.5, 0.06,
        );
        if (Math.random() < 0.18) audioDrip();
      }
    }
  }

  reset(): void {
    this.intensity = 1;
    this.residualHeat = 1;
    this.wetLoad = 0;
    this.displayIntensity = 1;
  }
}
