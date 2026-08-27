import * as THREE from 'three';

/**
 * One pooled particle system for spray, splash, steam, smoke and drips.
 * A single THREE.Points draw call; dead particles are recycled, nothing
 * is allocated during play. CPU-side integration is cheap at this count.
 */

export const enum PType { Spray = 0, Splash = 1, Steam = 2, Smoke = 3, Drip = 4 }

const MAX = 1300;

interface P {
  alive: boolean;
  type: PType;
  age: number;
  life: number;
  size: number;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  seed: number;
}

export class ParticleSystem {
  readonly points: THREE.Points;
  private pool: P[] = [];
  private free: number[] = [];
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;

  constructor() {
    for (let i = 0; i < MAX; i++) {
      this.pool.push({
        alive: false, type: PType.Spray, age: 0, life: 1, size: 1,
        px: 0, py: -100, pz: 0, vx: 0, vy: 0, vz: 0, seed: Math.random(),
      });
      this.free.push(i);
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(MAX * 4), 4);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(MAX), 1);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aSize', this.sizeAttr);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute vec4 aColor;
        attribute float aSize;
        varying vec4 vColor;
        uniform float uScale;
        void main(){
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 1.0, 240.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          float a = vColor.a * smoothstep(1.0, 0.35, r);
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor.rgb, a);
        }
      `,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 30;
  }

  /** update projection scale so point sizes track viewport height */
  setViewport(heightPx: number, fovDeg: number): void {
    const mat = this.points.material as THREE.ShaderMaterial;
    mat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  spawn(
    type: PType,
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size: number,
  ): void {
    const idx = this.free.pop();
    if (idx === undefined) return;
    const p = this.pool[idx];
    p.alive = true; p.type = type; p.age = 0; p.life = life; p.size = size;
    p.px = x; p.py = y; p.pz = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.seed = Math.random();
  }

  clear(): void {
    this.free.length = 0;
    for (let i = 0; i < MAX; i++) {
      this.pool[i].alive = false;
      this.free.push(i);
    }
  }

  update(dt: number): void {
    const pos = this.posAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;
    const siz = this.sizeAttr.array as Float32Array;
    for (let i = 0; i < MAX; i++) {
      const p = this.pool[i];
      if (!p.alive) {
        pos[i * 3 + 1] = -100;
        col[i * 4 + 3] = 0;
        continue;
      }
      p.age += dt;
      // reclaim: expired, fell below ground, or drifted out of the arena
      if (p.age >= p.life || p.py < -0.25 || Math.abs(p.px) > 25 || p.pz < -15 || p.pz > 40) {
        p.alive = false;
        this.free.push(i);
        pos[i * 3 + 1] = -100;
        col[i * 4 + 3] = 0;
        continue;
      }
      const t = p.age / p.life;
      let r = 0.9, g = 0.95, b = 1.0, a = 0.5, sz = p.size;
      switch (p.type) {
        case PType.Spray:
          p.vy -= 9.8 * dt;
          a = 0.42 * (1 - t);
          break;
        case PType.Splash:
          p.vy -= 12 * dt;
          p.vx *= 1 - 1.6 * dt; p.vz *= 1 - 1.6 * dt;
          a = 0.55 * (1 - t * t);
          sz = p.size * (1 + t * 1.6);
          break;
        case PType.Steam:
          p.vy += 1.1 * dt;
          p.vx += (p.seed - 0.5) * 0.7 * dt;
          p.vx *= 1 - 0.8 * dt; p.vz *= 1 - 0.8 * dt;
          r = 0.93; g = 0.95; b = 0.96;
          a = 0.22 * Math.sin(Math.min(1, t) * Math.PI);
          sz = p.size * (1 + t * 2.6);
          break;
        case PType.Smoke: {
          p.vy += 0.85 * dt;
          p.vx += Math.sin(p.age * 2 + p.seed * 20) * 0.25 * dt;
          const shade = 0.18 + p.seed * 0.1;
          r = shade; g = shade; b = shade + 0.01;
          a = 0.16 * Math.sin(Math.min(1, t) * Math.PI);
          sz = p.size * (1 + t * 3.0);
          break;
        }
        case PType.Drip:
          p.vy -= 11 * dt;
          r = 0.75; g = 0.85; b = 0.92;
          a = 0.55 * (1 - t * 0.5);
          break;
      }
      p.px += p.vx * dt; p.py += p.vy * dt; p.pz += p.vz * dt;
      pos[i * 3] = p.px; pos[i * 3 + 1] = p.py; pos[i * 3 + 2] = p.pz;
      col[i * 4] = r; col[i * 4 + 1] = g; col[i * 4 + 2] = b; col[i * 4 + 3] = a;
      siz[i] = sz;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }
}
