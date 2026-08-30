import * as THREE from 'three';

/**
 * Hero material #3: the small bench-burner flame.
 * Nested open cones with animated value noise, additive, plus a flickering
 * point light so the flame actually lights the glass and the bench.
 */

const VERT = /* glsl */`
varying vec2 vUv;
varying float vRim;
void main() {
  vUv = uv;
  vec3 n = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vRim = 1.0 - abs(dot(n, normalize(-mv.xyz)));   // soft at the silhouette
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
varying float vRim;
uniform float uTime;
uniform float uSeed;
uniform float uIntensity;
uniform vec3 uHot;
uniform vec3 uCool;

float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.55;
  for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  float up = vUv.y;
  // the flame licks upward: noise scrolls along the cone
  float n = fbm(vec2(vUv.x * 5.0 + uSeed, up * 4.2 - uTime * 3.1 + uSeed));
  float body = smoothstep(0.02, 0.16, up) * smoothstep(1.25, 0.30, up);
  float a = body * (0.14 + 1.05 * n * n) * uIntensity * 0.80;
  a *= 0.30 + 0.95 * (1.0 - vRim);            // soft and volumetric, not a hard cone
  vec3 col = mix(uCool, uHot, smoothstep(0.10, 0.80, up + n * 0.30));
  col += vec3(0.40, 0.52, 0.95) * smoothstep(0.20, 0.0, up) * 1.1;  // blue root
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a * 2.2, a);
}`;

export class Flame {
  constructor(quality, sparkTex) {
    this.group = new THREE.Group();
    this.layers = [];
    this.time = 0;
    this.intensity = 0;

    this.length = 0.170;                  // nominal reach of the outermost cone
    const L = quality.flameLayers;
    for (let i = 0; i < L; i++) {
      const t = i / (L - 1 || 1);
      const geo = new THREE.ConeGeometry(0.026 - t * 0.013, this.length - t * 0.050, 20, 8, true);
      geo.translate(0, (this.length - t * 0.050) * 0.5, 0);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          uTime: { value: 0 }, uSeed: { value: i * 3.77 }, uIntensity: { value: 1 },
          uHot: { value: new THREE.Color(0xffb257) },
          uCool: { value: new THREE.Color(0xff5a12) },
        },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide, toneMapped: true,
      });
      if (i >= L - 2) {                        // inner core burns blue-white
        mat.uniforms.uHot.value.set(0xdff0ff);
        mat.uniforms.uCool.value.set(0x7fb6ff);
      }
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 5 + i;
      this.layers.push(m);
      this.group.add(m);
    }

    // a soft additive halo so the burner still reads as fire from across the room
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sparkTex, color: 0xff8b3a, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0,
    }));
    this.glow.scale.setScalar(0.12);
    this.glow.position.y = 0.075;
    this.group.add(this.glow);

    this.light = new THREE.PointLight(0xff7b2e, 0, 1.4, 2);
    this.light.position.set(0, 0.075, 0);
    this.group.add(this.light);

    // embers drifting off the flame
    const n = quality.sparks;
    const pos = new Float32Array(n * 3);
    this.emberSeed = [];
    for (let i = 0; i < n; i++) {
      this.emberSeed.push({ t: Math.random(), sp: 0.25 + Math.random() * 0.5, a: Math.random() * 6.28, r: 0.004 + Math.random() * 0.02 });
      pos[i * 3 + 1] = -10;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.embers = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.0045, map: sparkTex, color: 0xffb066, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, opacity: 0.9,
    }));
    this.embers.frustumCulled = false;
    this.group.add(this.embers);
  }

  /** Point the flame from `from` toward `to`. */
  aim(from, to) {
    this.group.position.copy(from);
    const dir = new THREE.Vector3().subVectors(to, from).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.group.quaternion.copy(q);
  }

  setIntensity(v) { this.intensity = v; }

  update(dt, time) {
    this.time += dt;
    const flick = 0.82 + 0.18 * Math.sin(time * 23.3) * Math.sin(time * 9.1 + 1.3);
    for (const m of this.layers) {
      m.material.uniforms.uTime.value = this.time;
      m.material.uniforms.uIntensity.value = this.intensity * flick;
      m.scale.set(1 + 0.05 * Math.sin(time * 11 + m.renderOrder), 1 + 0.10 * flick, 1 + 0.05 * Math.cos(time * 13 + m.renderOrder));
    }
    this.light.intensity = this.intensity * (0.55 + 0.25 * flick) * 1.7;
    this.glow.material.opacity = this.intensity * (0.22 + 0.13 * flick);
    this.glow.scale.setScalar(0.115 + 0.018 * flick);

    const p = this.embers.geometry.attributes.position.array;
    for (let i = 0; i < this.emberSeed.length; i++) {
      const e = this.emberSeed[i];
      e.t += dt * e.sp;
      if (e.t > 1) { e.t = 0; e.a = Math.random() * 6.28; e.r = 0.004 + Math.random() * 0.02; }
      const h = 0.12 + e.t * 0.30;
      const spread = 0.004 + e.t * 0.045;
      p[i * 3] = Math.cos(e.a + e.t * 3) * spread * (e.r * 30);
      p[i * 3 + 1] = this.intensity > 0.05 ? h : -10;
      p[i * 3 + 2] = Math.sin(e.a + e.t * 3) * spread * (e.r * 30);
    }
    this.embers.geometry.attributes.position.needsUpdate = true;
    this.embers.material.opacity = 0.75 * this.intensity;
  }
}
