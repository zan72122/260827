// きらきらと、インクが広がる波紋。どちらも3D空間の中で起きる（DOMではない）。
import * as THREE from './three.js';
import { texFromCanvas, sparkCanvas, softDiscCanvas } from './textures.js';

const MAX = 96;

export class Sparkles {
  constructor(scene) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -999;
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texFromCanvas(sparkCanvas(128), { srgb: true }) },
        tint: { value: new THREE.Color(0xfff2d8) },
      },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (260.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        uniform vec3 tint;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(tint * t.rgb, t.a * vAlpha);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.visible = false;
    scene.add(this.points);
    this.cursor = 0;
  }

  burst(center, count = 26, spread = 2.6, up = 5.4, tint = null) {
    if (tint !== null) this.points.material.uniforms.tint.value.setHex(tint);
    for (let k = 0; k < count; k++) {
      const i = this.cursor % MAX;
      this.cursor++;
      const a = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.55) * spread;
      this.pos[i * 3] = center.x + Math.cos(a) * r;
      this.pos[i * 3 + 1] = center.y + 0.2 + Math.random() * 0.7;
      this.pos[i * 3 + 2] = center.z + Math.sin(a) * r;
      this.vel[i * 3] = Math.cos(a) * (0.8 + Math.random() * 2.2);
      this.vel[i * 3 + 1] = up * (0.45 + Math.random() * 0.85);
      this.vel[i * 3 + 2] = Math.sin(a) * (0.8 + Math.random() * 2.2);
      this.maxLife[i] = 0.8 + Math.random() * 0.7;
      this.life[i] = this.maxLife[i];
      this.size[i] = 0.7 + Math.random() * 0.9;
      this.alpha[i] = 1;
    }
    this.points.visible = true;
  }

  update(dt) {
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      alive++;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= 11.0 * dt;
      this.vel[i * 3] *= 1 - dt * 1.2;
      this.vel[i * 3 + 2] *= 1 - dt * 1.2;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5) * (0.6 + 0.4 * Math.sin(this.life[i] * 26));
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; this.alpha[i] = 0; }
    }
    this.points.visible = alive > 0;
    if (alive > 0) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.alpha.needsUpdate = true;
      this.points.geometry.attributes.size.needsUpdate = true;
    }
  }
}

/** 押した瞬間に紙の上へ広がる、インクの波紋 */
export class Ripple {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({
      map: texFromCanvas(softDiscCanvas(128, 0.74), { srgb: true }),
      transparent: true, depthWrite: false, opacity: 0,
      blending: THREE.AdditiveBlending, color: 0xffffff,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.t = 0; this.dur = 0.6; this.from = 2; this.to = 9;
  }
  play(pos, color = 0xffffff, from = 2.0, to = 9.0, dur = 0.6) {
    this.mesh.position.copy(pos);
    this.mesh.position.y += 0.06;
    this.mat.color.setHex(color);
    this.from = from; this.to = to; this.dur = dur; this.t = 0;
    this.mesh.visible = true;
  }
  update(dt) {
    if (!this.mesh.visible) return;
    this.t += dt;
    const k = Math.min(1, this.t / this.dur);
    const s = this.from + (this.to - this.from) * (1 - Math.pow(1 - k, 2.2));
    this.mesh.scale.set(s, 1, s);
    this.mat.opacity = 0.5 * (1 - k) * (1 - k);
    if (k >= 1) this.mesh.visible = false;
  }
}

/** ドラッグ中、スタンプが降りる場所を示す光の円 */
export class LandingMarker {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({
      map: texFromCanvas(softDiscCanvas(128, 0.5), { srgb: true }),
      transparent: true, depthWrite: false, opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    this.mesh.scale.set(5.4, 1, 5.4);
    scene.add(this.mesh);
    this.base = 0;
    this.target = 0;
    this.pulse = 0;
  }
  show(pos, color, strength = 1, size = 5.4) {
    this.mesh.position.copy(pos);
    this.mesh.position.y += 0.05;
    this.mat.color.setHex(color);
    this.target = strength;
    this.wantSize = size;
  }
  hide() { this.target = 0; }
  update(dt) {
    this.pulse += dt * 3.6;
    this.base += (this.target - this.base) * Math.min(1, dt * 11);
    if (this.wantSize) {
      const s = this.mesh.scale.x + (this.wantSize - this.mesh.scale.x) * Math.min(1, dt * 9);
      this.mesh.scale.set(s, 1, s);
    }
    this.mat.opacity = this.base * (0.80 + Math.sin(this.pulse) * 0.20);
    this.mesh.visible = this.base > 0.004;
  }
}
