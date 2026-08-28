import * as THREE from 'three';
import { clamp, Rng } from '../util/math';
import { makeSmokeSprite } from '../mat/textures';

/* ------------------------------------------------------------------ *
 * Incense smoke.  A ribbon of soft billboards that leaves the mouth as a
 * thin thread, bends in the room's air, widens and thins out.  CPU driven
 * (a few dozen particles), one instanced draw call, no volumetrics.
 * ------------------------------------------------------------------ */

interface Particle {
  age: number; life: number;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  seed: number; rot: number; spin: number;
  alive: boolean;
}

export class SmokeEmitter {
  readonly mesh: THREE.Mesh;
  readonly origin = new THREE.Vector3();
  readonly dir = new THREE.Vector3(0, 1, 0);
  readonly wind = new THREE.Vector3(0.012, 0, -0.006);
  rate = 0;
  strength = 1;
  /** thin thread at the mouth, wider once it has climbed */
  spread = 0.0016;
  speed = 0.075;

  private parts: Particle[] = [];
  private aOffset: THREE.InstancedBufferAttribute;
  private aParams: THREE.InstancedBufferAttribute;
  private material: THREE.ShaderMaterial;
  private emitAcc = 0;
  private rng = new Rng(4242);
  private count: number;

  constructor(count: number) {
    this.count = count;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    geo.instanceCount = count;

    this.aOffset = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.aParams = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    geo.setAttribute('aOffset', this.aOffset);
    geo.setAttribute('aParams', this.aParams);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.2, 0), 8);

    for (let i = 0; i < count; i++) {
      this.parts.push({
        age: 0, life: 1, px: 0, py: -999, pz: 0, vx: 0, vy: 0, vz: 0,
        seed: this.rng.next() * 10, rot: 0, spin: 0, alive: false,
      });
      this.aOffset.setXYZ(i, 0, -999, 0);
    }

    const tex = makeSmokeSprite();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tSmoke: { value: tex },
        uTint: { value: new THREE.Color(0.62, 0.60, 0.58) },
        uWarm: { value: new THREE.Color(1.0, 0.72, 0.45) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute vec4 aParams; // size, rot, alpha, seed
        varying vec2 vUv;
        varying float vAlpha;
        varying float vSeed;
        varying float vRise;
        void main() {
          vUv = uv; vAlpha = aParams.z; vSeed = aParams.w;
          vec3 toCam = normalize(cameraPosition - aOffset);
          vec3 upW = vec3(0.0, 1.0, 0.0);
          vec3 right = normalize(cross(upW, toCam));
          vec3 up = normalize(cross(toCam, right));
          float c = cos(aParams.y), s = sin(aParams.y);
          vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
          vec3 wp = aOffset + right * p.x * aParams.x + up * p.y * aParams.x;
          vRise = clamp(aParams.x * 30.0, 0.0, 1.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tSmoke;
        uniform vec3 uTint;
        uniform vec3 uWarm;
        varying vec2 vUv;
        varying float vAlpha;
        varying float vSeed;
        varying float vRise;
        void main() {
          if (vAlpha <= 0.002) discard;
          vec4 s = texture2D(tSmoke, vUv);
          float a = s.a * vAlpha;
          if (a <= 0.003) discard;
          // young smoke sits in candle light and is warmer; old smoke is cool
          vec3 col = mix(uWarm * 0.55 + uTint * 0.5, uTint, vRise);
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  setOrigin(p: THREE.Vector3, dir: THREE.Vector3) {
    this.origin.copy(p);
    this.dir.copy(dir).normalize();
  }

  /** Kill everything in flight - used when the doll is opened again. */
  clear() {
    for (let i = 0; i < this.count; i++) {
      this.parts[i].alive = false;
      this.aOffset.setXYZ(i, 0, -999, 0);
      this.aParams.setXYZW(i, 0, 0, 0, this.parts[i].seed);
    }
    this.aOffset.needsUpdate = true;
    this.aParams.needsUpdate = true;
  }

  private spawn(p: Particle) {
    const r = this.rng;
    p.alive = true;
    p.age = 0;
    p.life = 2.7 + r.next() * 1.5;
    p.px = this.origin.x + (r.next() - 0.5) * this.spread;
    p.py = this.origin.y + (r.next() - 0.5) * this.spread;
    p.pz = this.origin.z + (r.next() - 0.5) * this.spread;
    const jitter = 0.14;
    p.vx = this.dir.x * this.speed + (r.next() - 0.5) * this.speed * jitter;
    p.vy = this.dir.y * this.speed + (r.next() - 0.5) * this.speed * jitter;
    p.vz = this.dir.z * this.speed + (r.next() - 0.5) * this.speed * jitter;
    p.seed = r.next() * 10;
    p.rot = r.next() * Math.PI * 2;
    p.spin = (r.next() - 0.5) * 0.55;
  }

  update(dt: number, time: number) {
    if (this.rate > 0) {
      this.emitAcc += this.rate * dt;
      while (this.emitAcc >= 1) {
        this.emitAcc -= 1;
        const free = this.parts.find((q) => !q.alive);
        if (!free) { this.emitAcc = 0; break; }
        this.spawn(free);
      }
    }

    for (let i = 0; i < this.count; i++) {
      const p = this.parts[i];
      if (!p.alive) continue;
      p.age += dt;
      const a = p.age / p.life;
      if (a >= 1) {
        p.alive = false;
        this.aOffset.setXYZ(i, 0, -999, 0);
        this.aParams.setXYZW(i, 0, 0, 0, p.seed);
        continue;
      }
      // buoyancy fades as the thread cools
      const buoy = 0.062 * (1 - a * 0.55);
      p.vy += buoy * dt;
      // slow curl: the room has air in it, the thread is not a straight line
      const cx = Math.sin(time * 0.55 + p.py * 9.0 + p.seed * 3.1);
      const cz = Math.cos(time * 0.47 + p.py * 8.2 + p.seed * 2.3);
      p.vx += (cx * 0.030 + this.wind.x) * dt;
      p.vz += (cz * 0.030 + this.wind.z) * dt;
      const drag = 1 - Math.min(0.9, 0.85 * dt);
      p.vx *= drag; p.vy *= drag * 0.999; p.vz *= drag;
      p.px += p.vx * dt; p.py += p.vy * dt; p.pz += p.vz * dt;
      p.rot += p.spin * dt;

      const size = 0.0042 + Math.pow(a, 0.78) * 0.040;
      const fadeIn = clamp(a / 0.06, 0, 1);
      const fadeOut = Math.pow(1 - a, 1.55);
      const alpha = fadeIn * fadeOut * 0.34 * this.strength;

      this.aOffset.setXYZ(i, p.px, p.py, p.pz);
      this.aParams.setXYZW(i, size, p.rot, alpha, p.seed);
    }
    this.aOffset.needsUpdate = true;
    this.aParams.needsUpdate = true;
  }
}
