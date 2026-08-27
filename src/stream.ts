import * as THREE from 'three';
import { DynamicTube } from './tube';
import { GLSL_NOISE, clamp, lerp } from './util';
import { ParticleSystem, PType } from './particles';

/**
 * The hose stream. The dense center flow is a deformable tube that follows
 * a ballistic arc from the nozzle tip to the (smoothed) impact point;
 * spray droplets peel off the outer third and splash particles erupt at
 * impact. The shader keeps it watery: translucent blue-white with
 * scrolling streaks, foamy rim, and noise break-up toward the end —
 * never a rigid laser cylinder.
 */

const SEGS = 40;

const waterVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vViewDir;
void main(){
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const waterFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vViewDir;
uniform float uTime;
uniform float uFade;
${GLSL_NOISE}
void main(){
  float u = vUv.x;
  float streak = ffFbm(vec2(vUv.y * 4.0 + sin(u * 9.0) * 0.25, u * 8.0 - uTime * 8.5));
  float rim = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir))), 1.7);
  // dense near the nozzle, breaking up toward the impact
  float alpha = 0.9 - 0.45 * u;
  float breakup = smoothstep(0.12, 0.7, streak + (1.25 - u * 1.35));
  alpha *= breakup;
  alpha = clamp(alpha, 0.0, 1.0) * uFade;
  if (alpha < 0.02) discard;
  vec3 base = mix(vec3(0.62, 0.76, 0.87), vec3(0.88, 0.95, 1.0), streak);
  vec3 col = base + rim * 0.45 + smoothstep(0.72, 1.0, streak) * 0.3;
  gl_FragColor = vec4(col, alpha);
}
`;

export class WaterStream {
  readonly mesh: THREE.Mesh;
  private tube: DynamicTube;
  private mat: THREE.ShaderMaterial;
  private pts: THREE.Vector3[] = [];
  private radii: number[] = [];
  /** 0..1 how open the nozzle is (eases in/out) */
  openAmount = 0;
  private sprayAccum = 0;
  private splashAccum = 0;
  private steamAccum = 0;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  constructor() {
    this.tube = new DynamicTube(SEGS, 8);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uFade: { value: 0 } },
      vertexShader: waterVert,
      fragmentShader: waterFrag,
    });
    this.mesh = new THREE.Mesh(this.tube.geometry, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 25;
    this.mesh.visible = false;
    for (let i = 0; i <= SEGS; i++) {
      this.pts.push(new THREE.Vector3());
      this.radii.push(0.05);
    }
  }

  /** evaluate arc point at t in [0,1] between nozzle N and target T */
  private arcPoint(out: THREE.Vector3, n: THREE.Vector3, target: THREE.Vector3, t: number, droop: number): THREE.Vector3 {
    const u = Math.pow(t, 0.75); // apex slightly before midway, longer falling tail
    const arcH = clamp(0.11 * n.distanceTo(target), 0.18, 1.5);
    out.lerpVectors(n, target, t);
    out.y += arcH * 4 * u * (1 - u) - droop * t * t * 2.2;
    return out;
  }

  /**
   * @param open whether the player is holding
   * @param nozzle world nozzle tip
   * @param target world impact point
   * @param heatHit 0..1 how hot the impact area is (steam)
   * @returns tangent direction at the nozzle (for aiming the crew rig)
   */
  update(
    dt: number, time: number,
    open: boolean,
    nozzle: THREE.Vector3, target: THREE.Vector3,
    heatHit: number,
    particles: ParticleSystem,
  ): THREE.Vector3 {
    this.openAmount = clamp(this.openAmount + (open ? dt / 0.12 : -dt / 0.18), 0, 1);
    const oa = this.openAmount;
    this.mesh.visible = oa > 0.02;
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uFade.value = oa;

    // after release the arc droops so the water visibly falls away
    const droop = (1 - oa) * 1.4;
    const dist = nozzle.distanceTo(target);

    if (this.mesh.visible) {
      for (let i = 0; i <= SEGS; i++) {
        const t = i / SEGS;
        const p = this.arcPoint(this.pts[i], nozzle, target, t, droop);
        // growing lateral wobble so the far stream shivers like real water
        const wob = 0.028 * t * t * dist;
        p.x += Math.sin(time * 21 + t * 9) * wob * 0.35;
        p.y += Math.sin(time * 17 + t * 13 + 2) * wob * 0.22;
        this.radii[i] = (0.048 + 0.13 * Math.pow(t, 1.3)) * (0.5 + 0.5 * oa);
      }
      this.tube.update(this.pts, this.radii);

      // outer spray peels off the last part of the stream
      this.sprayAccum += dt * 110 * oa;
      while (this.sprayAccum > 1) {
        this.sprayAccum -= 1;
        const t = 0.5 + Math.random() * 0.5;
        const p = this.arcPoint(this.tmpA, nozzle, target, t, droop);
        const p2 = this.arcPoint(this.tmpB, nozzle, target, Math.min(1, t + 0.04), droop);
        p2.sub(p).normalize().multiplyScalar(3.5 + Math.random() * 3);
        particles.spawn(
          PType.Spray,
          p.x, p.y, p.z,
          p2.x + (Math.random() - 0.5) * 1.4,
          p2.y + (Math.random() - 0.5) * 1.0,
          p2.z + (Math.random() - 0.5) * 1.4,
          0.3 + Math.random() * 0.35, 0.06 + Math.random() * 0.05,
        );
      }

      // impact splash
      this.splashAccum += dt * 120 * oa;
      while (this.splashAccum > 1) {
        this.splashAccum -= 1;
        const ang = Math.random() * Math.PI * 2;
        const sp = 0.5 + Math.random() * 1.7;
        particles.spawn(
          PType.Splash,
          target.x + (Math.random() - 0.5) * 0.25,
          target.y + 0.05,
          target.z + (Math.random() - 0.5) * 0.25,
          Math.cos(ang) * sp, 1.2 + Math.random() * 2.2, Math.sin(ang) * sp,
          0.3 + Math.random() * 0.3, 0.12 + Math.random() * 0.1,
        );
      }

      // steam only where the water is actually meeting heat
      this.steamAccum += dt * 34 * oa * clamp(heatHit, 0, 1);
      while (this.steamAccum > 1) {
        this.steamAccum -= 1;
        particles.spawn(
          PType.Steam,
          target.x + (Math.random() - 0.5) * 0.6,
          target.y + 0.15,
          target.z + (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 0.7, (Math.random() - 0.5) * 0.4,
          1.1 + Math.random() * 0.9, 0.5,
        );
      }
    }

    // nozzle aim tangent (evaluated a hair in so the pow() slope is finite)
    const t0 = this.arcPoint(this.tmpA, nozzle, target, 0.02, droop);
    const t1 = this.arcPoint(this.tmpB, nozzle, target, 0.09, droop);
    return t1.sub(t0).normalize();
  }
}
