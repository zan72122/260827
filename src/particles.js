// Small particle helpers: blade snow spray (converging toward the auger),
// faint steam behind the towel, wash-water sparkle, and snow-dust puffs at
// the chute outlet. Everything is pooled and cheap.

import * as THREE from 'three';

const POINT_VERT = /* glsl */`
attribute float aLife;
attribute float aSize;
varying float vLife;
void main(){
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (140.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const POINT_FRAG = /* glsl */`
precision mediump float;
uniform vec3 uColor;
uniform float uOpacity;
varying float vLife;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.12, length(d)) * vLife * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

class PointPool {
  constructor(count, color, opacity, gravity, drag) {
    this.count = count;
    this.gravity = gravity;
    this.drag = drag;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.decay = new Float32Array(count);
    this.size = new Float32Array(count);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    const mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
      transparent: true,
      depthWrite: false
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }
  spawn(x, y, z, vx, vy, vz, life, size) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = 1;
    this.decay[i] = 1 / life;
    this.size[i] = size;
  }
  update(dt) {
    const drag = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= this.decay[i] * dt;
      if (this.life[i] < 0) this.life[i] = 0;
      this.vel[i * 3 + 1] += this.gravity * dt;
      this.vel[i * 3] *= drag; this.vel[i * 3 + 1] *= drag; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.015) { this.pos[i * 3 + 1] = 0.015; this.vel[i * 3 + 1] *= -0.15; }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aLife.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene) {
    this.snow = new PointPool(240, 0xf6fafc, 0.9, -3.2, 2.2);      // blade shavings
    this.steam = new PointPool(60, 0xdfe8ee, 0.16, 0.5, 1.2);       // warm water steam
    this.sparkle = new PointPool(80, 0xcfe6f2, 0.55, -2.0, 1.5);    // wash water
    this.dust = new PointPool(60, 0xf2f7fa, 0.5, -0.6, 1.4);        // chute outlet puffs
    for (const p of [this.snow, this.steam, this.sparkle, this.dust]) scene.add(p.points);
    this._acc = 0;
  }

  // veh: Resurfacer — emit around the working conditioner
  emitWork(veh, dt) {
    const w = veh.workIntensity;
    if (w <= 0.02) return;
    this._acc += dt * w * 90;
    const f = veh.forward, r = veh.right;
    const ce = veh.conditionerEdges();
    while (this._acc >= 1) {
      this._acc -= 1;
      const lat = (Math.random() * 2 - 1);
      // snow chips at the blade, converging inward toward the horizontal auger
      const bx = ce.c.x + r.x * lat * 1.0 + f.x * 0.3;
      const bz = ce.c.z + r.z * lat * 1.0 + f.z * 0.3;
      this.snow.spawn(
        bx, 0.06, bz,
        -r.x * lat * (0.7 + Math.random() * 0.6) + f.x * (0.2 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.3,
        0.5 + Math.random() * 0.9,
        -r.z * lat * (0.7 + Math.random() * 0.6) + f.z * (0.2 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.3,
        0.35 + Math.random() * 0.35, 2.6 + Math.random() * 2.4
      );
      // wash-water sparkle under the spray bar
      if (Math.random() < 0.5) {
        const l2 = (Math.random() * 2 - 1) * 0.95;
        this.sparkle.spawn(
          ce.c.x + r.x * l2 - f.x * 0.1, 0.12, ce.c.z + r.z * l2 - f.z * 0.1,
          (Math.random() - 0.5) * 0.2, -0.3, (Math.random() - 0.5) * 0.2,
          0.22, 1.6 + Math.random() * 1.2
        );
      }
    }
    // faint steam just behind the towel (warm ice-making water)
    if (Math.random() < w * 0.5) {
      const l3 = (Math.random() * 2 - 1) * 0.9;
      this.steam.spawn(
        ce.c.x + r.x * l3 - f.x * 0.6, 0.1, ce.c.z + r.z * l3 - f.z * 0.6,
        (Math.random() - 0.5) * 0.12, 0.28 + Math.random() * 0.2, (Math.random() - 0.5) * 0.12,
        1.4 + Math.random() * 0.8, 7 + Math.random() * 8
      );
    }
    // snow-dust puffs at the chute outlet into the tank
    if (Math.random() < w * 0.25) {
      const p = veh.group.localToWorld(new THREE.Vector3(0.6, 1.9, 2.45));
      this.dust.spawn(p.x, p.y, p.z,
        (Math.random() - 0.5) * 0.2, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.2,
        0.5, 2.5 + Math.random() * 2);
    }
  }

  burstLidOpen(veh) {
    const p = veh.group.localToWorld(new THREE.Vector3(0, 1.8, 2.95));
    for (let i = 0; i < 22; i++) {
      this.dust.spawn(p.x, p.y, p.z,
        (Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.7, (Math.random() - 0.5) * 0.8,
        0.8 + Math.random() * 0.5, 3 + Math.random() * 3);
    }
  }

  update(dt) {
    this.snow.update(dt);
    this.steam.update(dt);
    this.sparkle.update(dt);
    this.dust.update(dt);
  }
}
