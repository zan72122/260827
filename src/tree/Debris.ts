import * as THREE from 'three';
import { Rng, clamp } from '../core/rng';

type Kind = 0 | 1 | 2; // 0 dry needle, 1 dust mote, 2 twig

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: THREE.Vector3;
  life: number;
  ttl: number;
  kind: Kind;
  landed: boolean;
  active: boolean;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Only what a shaker actually knocks loose: brown needles, a little dust, the odd
 * twig. Never a shower of healthy green foliage.
 */
export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private readonly parts: Particle[] = [];
  private readonly rng = new Rng(9182);
  private groundY = 0;
  private cursor = 0;
  /** Counts landings this frame so audio can tick with them. */
  landings = 0;

  constructor(count: number) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      transparent: true,
      opacity: 1,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      this.parts.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        scale: new THREE.Vector3(1, 1, 1),
        life: 0,
        ttl: 1,
        kind: 0,
        landed: false,
        active: false,
      });
      col.setHSL(0.08, 0.4, 0.22);
      this.mesh.setColorAt(i, col);
      this.mesh.setMatrixAt(i, ZERO);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setGround(y: number): void {
    this.groundY = y;
  }

  spawn(at: THREE.Vector3, kind: Kind, energy: number): void {
    const p = this.parts[this.cursor];
    this.cursor = (this.cursor + 1) % this.parts.length;
    const r = this.rng;
    p.pos.copy(at);
    p.vel.set(r.jitter(0.5) * energy, r.range(-0.2, 0.35) * energy, r.jitter(0.5) * energy);
    p.spin.set(r.jitter(9), r.jitter(9), r.jitter(9));
    p.quat.setFromEuler(tmpE.set(r.range(0, 6.28), r.range(0, 6.28), r.range(0, 6.28)));
    p.kind = kind;
    p.landed = false;
    p.active = true;
    p.life = 0;
    if (kind === 0) {
      p.scale.set(0.0042, 0.036 + r.next() * 0.018, 0.0042);
      p.ttl = 14;
    } else if (kind === 1) {
      const s = 0.009 + r.next() * 0.012;
      p.scale.set(s, s, s);
      p.ttl = 1.6 + r.next();
    } else {
      p.scale.set(0.007, 0.06 + r.next() * 0.06, 0.007);
      p.ttl = 14;
    }
    const col = new THREE.Color();
    const idx = (this.cursor + this.parts.length - 1) % this.parts.length;
    if (kind === 1) col.setHSL(0.09, 0.14, 0.5 + r.jitter(0.07));
    else if (kind === 2) col.setHSL(0.07, 0.36, 0.24 + r.jitter(0.04));
    else col.setHSL(0.077 + r.jitter(0.02), 0.5, 0.31 + r.jitter(0.06));
    this.mesh.setColorAt(idx, col);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    this.landings = 0;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (!p.active) continue;
      p.life += dt;
      if (!p.landed) {
        // needles flutter; dust drifts; twigs just drop
        const drag = p.kind === 0 ? 3.4 : p.kind === 1 ? 5.5 : 1.6;
        const grav = p.kind === 1 ? -0.35 : -9.4;
        p.vel.y += grav * dt;
        p.vel.x += Math.sin(p.life * 7 + i) * (p.kind === 0 ? 0.22 : 0.05) * dt * 10;
        p.vel.multiplyScalar(Math.max(0, 1 - drag * dt));
        p.pos.addScaledVector(p.vel, dt);
        tmpQ.setFromEuler(tmpE.set(p.spin.x * dt, p.spin.y * dt, p.spin.z * dt));
        p.quat.multiply(tmpQ);
        if (p.pos.y <= this.groundY + 0.006) {
          p.pos.y = this.groundY + 0.006;
          p.landed = true;
          p.life = 0;
          this.landings++;
          if (p.kind === 1) p.active = false;
          // lie flat once it settles
          p.quat.setFromEuler(tmpE.set(Math.PI / 2, this.rng.range(0, 6.28), 0));
        }
      } else if (p.life > p.ttl) {
        p.active = false;
      }
      if (!p.active) {
        this.mesh.setMatrixAt(i, ZERO);
        continue;
      }
      let s = 1;
      if (p.kind === 1) s = clamp(1 - p.life / p.ttl, 0, 1);
      else if (p.landed) s = clamp((p.ttl - p.life) / 2.5, 0, 1);
      tmpS.copy(p.scale).multiplyScalar(s);
      tmpM.compose(p.pos, p.quat, tmpS);
      this.mesh.setMatrixAt(i, tmpM);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < this.parts.length; i++) {
      this.parts[i].active = false;
      this.mesh.setMatrixAt(i, ZERO);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
