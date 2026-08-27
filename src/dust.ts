import * as THREE from 'three';
import { dustSpriteTexture } from './textures';
import { randRange } from './math';

/**
 * CPU-updated point sprites for dust: impact puffs, trickles from cracked
 * masonry, and ground skims. One pooled Points object, one draw call.
 */
export class DustSystem {
  private readonly count: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private cursor = 0;
  private readonly points: THREE.Points;
  private readonly geo: THREE.BufferGeometry;

  constructor(parent: THREE.Object3D, count: number) {
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.baseSize = new Float32Array(count);
    for (let i = 0; i < count; i++) this.positions[i * 3 + 1] = -100;

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 0), 40);

    const mat = new THREE.PointsMaterial({
      size: 0.55,
      map: dustSpriteTexture(),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      vertexColors: true,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    parent.add(this.points);
  }

  private emit(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    color: THREE.Color,
    life: number,
    size: number
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.positions[i * 3] = pos.x;
    this.positions[i * 3 + 1] = pos.y;
    this.positions[i * 3 + 2] = pos.z;
    this.vel[i * 3] = vel.x;
    this.vel[i * 3 + 1] = vel.y;
    this.vel[i * 3 + 2] = vel.z;
    this.colors[i * 3] = color.r;
    this.colors[i * 3 + 1] = color.g;
    this.colors[i * 3 + 2] = color.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
  }

  private static tmpP = new THREE.Vector3();
  private static tmpV = new THREE.Vector3();

  /** Puff at an impact point, biased along the impact normal. */
  burst(pos: THREE.Vector3, normal: THREE.Vector3, color: THREE.Color, n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      DustSystem.tmpP.set(
        pos.x + randRange(-0.25, 0.25),
        pos.y + randRange(-0.25, 0.25),
        pos.z + randRange(-0.15, 0.15)
      );
      DustSystem.tmpV
        .set(randRange(-1, 1), randRange(-0.4, 1.1), randRange(-1, 1))
        .multiplyScalar(speed * randRange(0.35, 1))
        .addScaledVector(normal, speed * randRange(0.3, 0.9));
      this.emit(DustSystem.tmpP, DustSystem.tmpV, color, randRange(0.8, 2.1), randRange(0.5, 1.3));
    }
  }

  /** Low, wide skirt of dust at ground level (ball skim, pile impacts). */
  groundPuff(pos: THREE.Vector3, color: THREE.Color, n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = randRange(0, Math.PI * 2);
      DustSystem.tmpP.set(pos.x + Math.cos(a) * 0.3, Math.max(0.06, pos.y) + randRange(0, 0.2), pos.z + Math.sin(a) * 0.3);
      DustSystem.tmpV.set(Math.cos(a) * speed * randRange(0.4, 1), randRange(0.2, 0.8) * speed * 0.5, Math.sin(a) * speed * randRange(0.4, 1));
      this.emit(DustSystem.tmpP, DustSystem.tmpV, color, randRange(1.0, 2.4), randRange(0.7, 1.6));
    }
  }

  step(dt: number): void {
    const drag = Math.max(0, 1 - 1.6 * dt);
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.positions[i * 3 + 1] = -100;
        continue;
      }
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - 0.5 * dt; // dust settles slowly
      this.vel[i * 3 + 2] *= drag;
      this.positions[i * 3] += this.vel[i * 3] * dt;
      this.positions[i * 3 + 1] = Math.max(0.03, this.positions[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      // fade by shrinking color toward background handled via opacity in material; approximate by dimming
      const t = this.life[i] / this.maxLife[i];
      const dim = 0.35 + 0.65 * t;
      this.colors[i * 3] *= 0.999;
      this.colors[i * 3 + 1] *= 0.999;
      this.colors[i * 3 + 2] *= 0.999;
      void dim;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}
