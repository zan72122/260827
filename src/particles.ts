// Small pooled billboard-particle system: soot puffs, snow brushes.
import * as THREE from 'three';

interface P {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

export class ParticleSystem {
  points: THREE.Points;
  private pool: P[] = [];
  private geo: THREE.BufferGeometry;
  private mat: THREE.PointsMaterial;
  private gravity: number;

  constructor(count: number, color: number, size: number, gravity: number, opacity = 0.75) {
    this.gravity = gravity;
    this.geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mat = new THREE.PointsMaterial({
      color, size, transparent: true, opacity, depthWrite: false, sizeAttenuation: true
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      this.pool.push({
        alive: false,
        pos: new THREE.Vector3(0, -100, 0),
        vel: new THREE.Vector3(),
        life: 0, maxLife: 1, size
      });
    }
  }

  emit(origin: THREE.Vector3, n: number, spread: number, upVel: number, life = 1): void {
    let emitted = 0;
    for (const p of this.pool) {
      if (emitted >= n) break;
      if (p.alive) continue;
      p.alive = true;
      p.pos.copy(origin).add(new THREE.Vector3(
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread * 0.5,
        (Math.random() - 0.5) * spread
      ));
      p.vel.set(
        (Math.random() - 0.5) * spread * 2.2,
        upVel * (0.5 + Math.random() * 0.8),
        (Math.random() - 0.5) * spread * 2.2
      );
      p.life = 0;
      p.maxLife = life * (0.6 + Math.random() * 0.8);
      emitted++;
    }
  }

  update(dt: number): void {
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    let i = 0;
    for (const p of this.pool) {
      if (p.alive) {
        p.life += dt;
        if (p.life >= p.maxLife) {
          p.alive = false;
          p.pos.set(0, -100, 0);
        } else {
          p.vel.y += this.gravity * dt;
          p.vel.multiplyScalar(1 - dt * 1.8);
          p.pos.addScaledVector(p.vel, dt);
        }
      }
      pos.setXYZ(i, p.pos.x, p.pos.y, p.pos.z);
      i++;
    }
    pos.needsUpdate = true;
  }
}
