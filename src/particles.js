import * as THREE from 'three';

/** Cheap additive points, reused for the lamé burst and the snow outside. */
class PointField {
  constructor(count, tex, opts = {}) {
    const pos = new Float32Array(count * 3);
    const scl = new Float32Array(count);
    for (let i = 0; i < count; i++) { pos[i * 3 + 1] = -100; scl[i] = 1; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: opts.size || 0.004, map: tex, color: opts.color || 0xffffff,
      transparent: true, depthWrite: false, sizeAttenuation: true,
      blending: opts.blending ?? THREE.AdditiveBlending, opacity: opts.opacity ?? 1,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.count = count;
    this.p = pos;
  }
}

/** Lamé thrown into the air when the colour goes on. */
export class Glitter extends PointField {
  constructor(count, tex) {
    super(count, tex, { size: 0.0055, color: 0xfff0c0 });
    this.parts = [];
    for (let i = 0; i < count; i++) this.parts.push({ life: 0, vx: 0, vy: 0, vz: 0, x: 0, y: -100, z: 0 });
    this.next = 0;
  }

  burst(origin, n, spread = 0.55, upward = 0.7) {
    for (let i = 0; i < n; i++) {
      const p = this.parts[this.next];
      this.next = (this.next + 1) % this.count;
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI;
      p.x = origin.x; p.y = origin.y; p.z = origin.z;
      const s = 0.10 + Math.random() * spread * 0.4;
      p.vx = Math.cos(a) * Math.sin(e) * s;
      p.vy = Math.abs(Math.cos(e)) * s * upward + 0.10;
      p.vz = Math.sin(a) * Math.sin(e) * s;
      p.life = 1;
    }
  }

  update(dt) {
    const a = this.p;
    for (let i = 0; i < this.count; i++) {
      const p = this.parts[i];
      if (p.life <= 0) { a[i * 3 + 1] = -100; continue; }
      p.life -= dt * 0.42;
      p.vy -= 0.55 * dt;                       // light flakes, slow fall
      p.vx *= 1 - 1.6 * dt; p.vz *= 1 - 1.6 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

/** Snow behind the window: sells the cold outside against the warm bench. */
export class Snow extends PointField {
  constructor(count, tex, box) {
    super(count, tex, { size: 0.018, color: 0xdfeaf5, opacity: 0.85 });
    this.box = box;
    this.v = [];
    for (let i = 0; i < count; i++) {
      this.v.push({ sp: 0.08 + Math.random() * 0.16, ph: Math.random() * 6.28 });
      this.p[i * 3] = box.x + (Math.random() - 0.5) * box.w;
      this.p[i * 3 + 1] = box.y + Math.random() * box.h;
      this.p[i * 3 + 2] = box.z + (Math.random() - 0.5) * box.d;
    }
  }

  update(dt, time) {
    const a = this.p;
    for (let i = 0; i < this.count; i++) {
      const v = this.v[i];
      a[i * 3 + 1] -= v.sp * dt;
      a[i * 3] += Math.sin(time * 0.6 + v.ph) * 0.012 * dt * 10;
      if (a[i * 3 + 1] < this.box.y) {
        a[i * 3 + 1] = this.box.y + this.box.h;
        a[i * 3] = this.box.x + (Math.random() - 0.5) * this.box.w;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
