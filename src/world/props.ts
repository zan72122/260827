import * as THREE from 'three';
import { makePellet, makeLeather } from '../gfx/textures';

/**
 * The single cast pellet. One body, fixed timestep, one containment sphere --
 * enough to make "the ball is inside, and the ball is what rings" legible, and
 * cheap enough to never cost a frame.
 */
export class Pellet {
  readonly mesh: THREE.Mesh;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly radius: number;
  /** null while the pellet is loose on the bench */
  container: { centre: THREE.Vector3; radius: number } | null = null;
  held = false;
  restY = 0;
  onImpact: ((speed: number, kind: 'bench' | 'shell') => void) | null = null;
  private acc = 0;
  private prevContainer = new THREE.Vector3();

  constructor(env: THREE.Texture, radius: number) {
    this.radius = radius;
    const t = makePellet(256);
    const mat = new THREE.MeshStandardMaterial({
      map: t.map, roughnessMap: t.roughnessMap,
      color: 0x9a9a9e, metalness: 0.88, roughness: 0.72,
      envMap: env, envMapIntensity: 0.55,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 26, 18), mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  place(x: number, y: number, z: number) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.mesh.position.copy(this.pos);
  }

  update(dt: number) {
    this.acc = Math.min(this.acc + dt, 0.1);
    const h = 1 / 140;
    while (this.acc >= h) {
      this.step(h);
      this.acc -= h;
    }
    this.mesh.position.copy(this.pos);
    // roll a little so it never looks like a floating decal
    if (!this.held) {
      const s = this.vel.length();
      if (s > 0.001) {
        _axis.set(-this.vel.z, 0, this.vel.x).normalize();
        this.mesh.rotateOnWorldAxis(_axis, (s * dt) / this.radius);
      }
    }
    if (this.container) this.prevContainer.copy(this.container.centre);
  }

  private step(h: number) {
    if (this.held) { this.vel.set(0, 0, 0); return; }
    this.vel.y -= 9.81 * h;
    this.vel.multiplyScalar(1 - 0.7 * h);
    this.pos.addScaledVector(this.vel, h);

    const c = this.container;
    if (c) {
      // shell velocity, so a hard shake throws the pellet at the wall
      _shell.copy(c.centre).sub(this.prevContainer).multiplyScalar(1 / Math.max(h, 1e-4));
      _rel.copy(this.pos).sub(c.centre);
      const maxR = c.radius - this.radius;
      const d = _rel.length();
      if (d > maxR) {
        _n.copy(_rel).multiplyScalar(1 / Math.max(d, 1e-6));
        this.pos.copy(c.centre).addScaledVector(_n, maxR);
        _relV.copy(this.vel).sub(_shell);
        const vn = _relV.dot(_n);
        if (vn > 0) {
          _relV.addScaledVector(_n, -vn * 1.52);       // restitution 0.52
          _relV.multiplyScalar(0.93);                  // tangential loss
          this.vel.copy(_relV).add(_shell);
          if (vn > 0.05) this.onImpact?.(vn, 'shell');
        }
      }
    } else if (this.pos.y - this.radius < this.restY) {
      this.pos.y = this.restY + this.radius;
      if (this.vel.y < 0) {
        const speed = -this.vel.y;
        this.vel.y = speed * 0.34;
        this.vel.x *= 0.7; this.vel.z *= 0.7;
        if (speed > 0.06) this.onImpact?.(speed, 'bench');
        if (speed < 0.12) this.vel.y = 0;
      }
    }
  }

  syncContainer() {
    if (this.container) this.prevContainer.copy(this.container.centre);
  }
}

/** Soft brush used to bring up the gloss. */
export class Brush {
  readonly root = new THREE.Group();
  readonly tip = new THREE.Object3D();

  constructor(env: THREE.Texture, scale: number) {
    const wood = new THREE.MeshStandardMaterial({
      color: 0x4a3421, roughness: 0.78, metalness: 0.0, envMap: env, envMapIntensity: 0.22,
    });
    const bristle = new THREE.MeshStandardMaterial({
      color: 0x1d1712, roughness: 0.99, metalness: 0.0,
    });
    const back = new THREE.Mesh(new THREE.BoxGeometry(scale * 1.5, scale * 0.42, scale * 0.85), wood);
    back.position.y = scale * 0.42;
    back.castShadow = true;
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(scale * 0.2, scale * 0.24, scale * 1.5, 14), wood
    );
    grip.rotation.z = Math.PI / 2;
    grip.position.set(scale * 1.35, scale * 0.5, 0);
    grip.castShadow = true;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(scale * 1.42, scale * 0.36, scale * 0.78), bristle);
    pad.position.y = scale * 0.04;
    this.root.add(back, grip, pad);
    this.tip.position.set(0, -scale * 0.14, 0);
    this.root.add(this.tip);
    this.root.visible = false;
  }
}

/** A short leather thong, drawn as a swept tube over a polyline. */
export class Rope {
  readonly mesh: THREE.Mesh;
  readonly points: THREE.Vector3[] = [];
  private sides = 8;
  private pos: Float32Array;
  private nrm: Float32Array;

  constructor(env: THREE.Texture, segments: number, radius: number) {
    for (let i = 0; i <= segments; i++) this.points.push(new THREE.Vector3());
    const n = (segments + 1) * (this.sides + 1);
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const idx: number[] = [];
    for (let i = 0; i <= segments; i++) {
      for (let j = 0; j <= this.sides; j++) {
        const k = i * (this.sides + 1) + j;
        uv[k * 2] = i / segments * 3;
        uv[k * 2 + 1] = j / this.sides;
      }
    }
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < this.sides; j++) {
        const a = i * (this.sides + 1) + j;
        const b = a + this.sides + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    const t = makeLeather(256);
    this.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: t.map, color: 0xb59a80, roughness: 0.86, metalness: 0.0,
      envMap: env, envMapIntensity: 0.25,
    }));
    this.mesh.castShadow = true;
    this.radius = radius;
  }
  private radius: number;

  refresh() {
    const P = this.points, n = P.length;
    const up = _up.set(0, 1, 0);
    let prevN = _prevN.set(1, 0, 0);
    for (let i = 0; i < n; i++) {
      _tan.copy(P[Math.min(i + 1, n - 1)]).sub(P[Math.max(i - 1, 0)]);
      if (_tan.lengthSq() < 1e-10) _tan.set(0, 1, 0);
      _tan.normalize();
      _bin.crossVectors(_tan, prevN);
      if (_bin.lengthSq() < 1e-8) _bin.crossVectors(_tan, up);
      if (_bin.lengthSq() < 1e-8) _bin.set(1, 0, 0);
      _bin.normalize();
      _nor.crossVectors(_bin, _tan).normalize();
      prevN = _prevN.copy(_nor);
      for (let j = 0; j <= this.sides; j++) {
        const a = (j / this.sides) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const k = i * (this.sides + 1) + j;
        const nx = _nor.x * ca + _bin.x * sa;
        const ny = _nor.y * ca + _bin.y * sa;
        const nz = _nor.z * ca + _bin.z * sa;
        // slightly flattened: a thong, not a wire
        const rr = this.radius * (0.62 + 0.38 * Math.abs(ca));
        this.pos[k * 3] = P[i].x + nx * rr;
        this.pos[k * 3 + 1] = P[i].y + ny * rr;
        this.pos[k * 3 + 2] = P[i].z + nz * rr;
        this.nrm[k * 3] = nx; this.nrm[k * 3 + 1] = ny; this.nrm[k * 3 + 2] = nz;
      }
    }
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    g.computeBoundingSphere();
  }

  /** Lay the thong along a smooth arc between two anchors. */
  shape(from: THREE.Vector3, to: THREE.Vector3, sag: number) {
    const n = this.points.length;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      this.points[i].lerpVectors(from, to, t);
      this.points[i].y -= Math.sin(t * Math.PI) * sag;
    }
    this.refresh();
  }
}

const _axis = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _relV = new THREE.Vector3();
const _shell = new THREE.Vector3();
const _n = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _bin = new THREE.Vector3();
const _nor = new THREE.Vector3();
const _prevN = new THREE.Vector3();
