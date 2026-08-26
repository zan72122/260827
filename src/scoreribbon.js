import * as THREE from 'three';
import { scoreSparkleTexture } from './textures.js';

const MAX_PTS = 900;

// The visible score: a thin silver scratch laid exactly where the wheel has
// rolled (never ahead of it). Later the same ribbon shows the running crack:
// a short bright fracture front travels along it and leaves a slightly
// whiter line behind.
export class ScoreRibbon {
  constructor(parent, surfaceY) {
    this.surfaceY = surfaceY;
    this.width = 0.0018;
    this.points = [];
    this.arcs = [];

    const positions = new Float32Array(MAX_PTS * 2 * 3);
    const arcSide = new Float32Array(MAX_PTS * 2 * 2); // arclength, side(0/1)
    const indices = new Uint16Array((MAX_PTS - 1) * 6);
    for (let i = 0; i < MAX_PTS - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      indices.set([a, b, c, b, d, c], i * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geo.setAttribute('arcSide', new THREE.BufferAttribute(arcSide, 2));
    this.geo.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geo.setDrawRange(0, 0);

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uCrack: { value: -1 },        // crack front arclength (-1: not cracking)
        uSparkle: { value: scoreSparkleTexture() },
        uOpacity: { value: 1 }
      },
      vertexShader: /* glsl */`
        attribute vec2 arcSide;
        varying vec2 vAS;
        void main() {
          vAS = arcSide;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vAS;
        uniform float uCrack;
        uniform float uOpacity;
        uniform sampler2D uSparkle;
        void main() {
          float side = vAS.y;
          float edge = 1.0 - pow(abs(side * 2.0 - 1.0), 1.4);
          vec4 sp = texture2D(uSparkle, vec2(fract(vAS.x * 9.0), side));
          // base scratch: thin silvery diffuse glint
          vec3 col = vec3(0.86, 0.87, 0.88) * (0.55 + 0.45 * sp.a);
          float alpha = edge * (0.34 + 0.30 * sp.a);
          if (uCrack >= 0.0) {
            float behind = uCrack - vAS.x;
            if (behind >= 0.0) {
              // cracked: slightly whiter, a touch stronger
              col = mix(col, vec3(0.97), 0.55);
              alpha = edge * (0.5 + 0.24 * sp.a);
            }
            // short bright fracture front
            float front = 1.0 - smoothstep(0.0, 0.020, abs(behind));
            col = mix(col, vec3(1.0), front * 0.85);
            alpha = max(alpha, front * 0.9 * edge);
          }
          gl_FragColor = vec4(col, alpha * uOpacity);
        }
      `
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.renderOrder = 20;
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this.totalLen = 0;
  }

  reset() {
    this.points.length = 0;
    this.arcs.length = 0;
    this.totalLen = 0;
    this.geo.setDrawRange(0, 0);
    this.mat.uniforms.uCrack.value = -1;
    this.mat.uniforms.uOpacity.value = 1;
  }

  // p: sheet-local {x, y(=v)} on the top surface
  appendPoint(p) {
    const n = this.points.length;
    if (n >= MAX_PTS) return;
    if (n > 0) {
      const q = this.points[n - 1];
      this.totalLen += Math.hypot(p.x - q.x, p.y - q.y);
    }
    this.points.push({ x: p.x, y: p.y });
    this.arcs.push(this.totalLen);
    this._updateVerts();
  }

  _updateVerts() {
    const pos = this.geo.getAttribute('position');
    const as = this.geo.getAttribute('arcSide');
    const n = this.points.length;
    const w = this.width / 2;
    for (let i = Math.max(0, n - 3); i < n; i++) {
      const p = this.points[i];
      const pPrev = this.points[Math.max(0, i - 1)];
      const pNext = this.points[Math.min(n - 1, i + 1)];
      let dx = pNext.x - pPrev.x, dy = pNext.y - pPrev.y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      const nx = -dy, ny = dx;
      pos.setXYZ(i * 2, p.x + nx * w, this.surfaceY, p.y + ny * w);
      pos.setXYZ(i * 2 + 1, p.x - nx * w, this.surfaceY, p.y - ny * w);
      as.setXY(i * 2, this.arcs[i], 0);
      as.setXY(i * 2 + 1, this.arcs[i], 1);
    }
    pos.needsUpdate = true;
    as.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
  }

  setCrack(arc) {
    this.mat.uniforms.uCrack.value = arc;
  }

  fade(o) {
    this.mat.uniforms.uOpacity.value = o;
  }

  pointAtArc(arc) {
    const arcs = this.arcs, pts = this.points;
    if (pts.length === 0) return { x: 0, y: 0 };
    if (arc <= 0) return pts[0];
    for (let i = 1; i < pts.length; i++) {
      if (arcs[i] >= arc) {
        const t = (arc - arcs[i - 1]) / Math.max(1e-9, arcs[i] - arcs[i - 1]);
        return {
          x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
          y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t
        };
      }
    }
    return pts[pts.length - 1];
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.geo.dispose();
    this.mat.uniforms.uSparkle.value.dispose();
    this.mat.dispose();
  }
}
