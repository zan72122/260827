import * as THREE from 'three';
import type { QualitySettings } from '../core/quality';

/** Colour keys for afternoon -> blue dusk -> night. */
interface TimeKey {
  t: number;
  skyTop: number;
  skyMid: number;
  skyLow: number;
  ground: number;
  sun: number;
  sunI: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  fog: number;
  fogD: number;
  exposure: number;
  sunDir: THREE.Vector3;
}

const KEYS: TimeKey[] = [
  {
    t: 0,
    skyTop: 0x4a76a6,
    skyMid: 0x9cbcd6,
    skyLow: 0xd6dee2,
    ground: 0xbccbd6,
    sun: 0xffe6c6,
    sunI: 2.6,
    hemiSky: 0x9cc0de,
    hemiGround: 0xb3c6d4,
    hemiI: 1.35,
    fog: 0xbccdda,
    fogD: 0.03,
    exposure: 0.94,
    sunDir: new THREE.Vector3(-0.5, 0.68, -0.5),
  },
  {
    t: 0.55,
    skyTop: 0x1e3a58,
    skyMid: 0x466b8e,
    skyLow: 0x9d7f76,
    ground: 0x54697e,
    sun: 0xffb277,
    sunI: 0.85,
    hemiSky: 0x3d6088,
    hemiGround: 0x394d63,
    hemiI: 0.72,
    fog: 0x35506f,
    fogD: 0.034,
    exposure: 1.06,
    sunDir: new THREE.Vector3(-0.62, 0.24, -0.55),
  },
  {
    t: 1,
    skyTop: 0x0a1626,
    skyMid: 0x15293e,
    skyLow: 0x22384e,
    ground: 0x22334a,
    sun: 0xa9c6ea,
    sunI: 0.5,
    hemiSky: 0x243d5c,
    hemiGround: 0x1e2a38,
    hemiI: 0.5,
    fog: 0x101d2e,
    fogD: 0.04,
    exposure: 1.06,
    sunDir: new THREE.Vector3(0.5, 0.66, -0.45),
  },
];

const _cA = new THREE.Color();
const _cB = new THREE.Color();

function lerpKeys(t: number) {
  let i = 0;
  while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const f = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1);
  const col = (ka: number, kb: number) => _cA.setHex(ka, THREE.SRGBColorSpace).lerp(_cB.setHex(kb, THREE.SRGBColorSpace), f).clone();
  return {
    skyTop: col(a.skyTop, b.skyTop),
    skyMid: col(a.skyMid, b.skyMid),
    skyLow: col(a.skyLow, b.skyLow),
    ground: col(a.ground, b.ground),
    sun: col(a.sun, b.sun),
    sunI: THREE.MathUtils.lerp(a.sunI, b.sunI, f),
    hemiSky: col(a.hemiSky, b.hemiSky),
    hemiGround: col(a.hemiGround, b.hemiGround),
    hemiI: THREE.MathUtils.lerp(a.hemiI, b.hemiI, f),
    fog: col(a.fog, b.fog),
    fogD: THREE.MathUtils.lerp(a.fogD, b.fogD, f),
    exposure: THREE.MathUtils.lerp(a.exposure, b.exposure, f),
    sunDir: a.sunDir.clone().lerp(b.sunDir, f).normalize(),
    night: THREE.MathUtils.smoothstep(t, 0.5, 0.95),
  };
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uLow; uniform vec3 uGround;
uniform float uNight; uniform vec3 uSunDir;
varying vec3 vDir;
float h21(vec2 p){ p = fract(p*vec2(443.897,441.423)); p += dot(p,p+19.19); return fract(p.x*p.y); }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 c;
  if (y >= 0.0) {
    float a = smoothstep(0.0, 0.34, y);
    float b = smoothstep(0.16, 0.75, y);
    c = mix(uLow, uMid, a);
    c = mix(c, uTop, b);
  } else {
    c = mix(uLow, uGround, smoothstep(0.0, -0.28, y));
  }
  // low warm band where the sun sits, never a full-screen golden wash
  float sunAmt = max(0.0, dot(d, normalize(uSunDir)));
  c += uLow * pow(sunAmt, 8.0) * 0.28 * (1.0 - uNight * 0.7);
  // sparse stars, only at night
  if (uNight > 0.02 && y > 0.02) {
    vec2 g = floor(d.xz / max(0.08, 0.08) * 24.0 + d.y * 13.0);
    float s = h21(g);
    float star = smoothstep(0.9975, 0.9999, s) * uNight * smoothstep(0.02, 0.45, y);
    c += vec3(star) * 0.9;
  }
  gl_FragColor = vec4(c, 1.0);
}`;

function snowSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Environment {
  group = new THREE.Group();
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private envScene = new THREE.Scene();
  private envSky: THREE.Mesh;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private snow: THREE.Points;
  private snowVel: Float32Array;
  private snowBase: Float32Array;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private bakeTimer = 0;
  private bakeDirty = true;
  private bakedTime = -1;
  private capacity: number;
  private envRes = 256;
  private reflections = 1;
  time = 0;
  night = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, q: QualitySettings) {
    this.renderer = renderer;
    this.scene = scene;
    this.pmrem = new THREE.PMREMGenerator(renderer);

    const uniforms = {
      uTop: { value: new THREE.Color(0x5d87b3) },
      uMid: { value: new THREE.Color(0xa8c3d8) },
      uLow: { value: new THREE.Color(0xdfe4e4) },
      uGround: { value: new THREE.Color(0xc6d3dd) },
      uNight: { value: 0 },
      uSunDir: { value: new THREE.Vector3(-0.5, 0.6, 0.5) },
    };
    this.skyMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(70, 32, 20), this.skyMat);
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    // A second, tiny dome used only to bake the environment map.
    this.envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), this.skyMat);
    this.envScene.add(this.envSky);

    this.hemi = new THREE.HemisphereLight(0x9fc0dd, 0xb9c8d2, 0.85);
    this.group.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffe3bd, 2.5);
    this.sun.position.set(-4, 5, 4);
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 14;
    this.sun.shadow.camera.left = -3.2;
    this.sun.shadow.camera.right = 3.2;
    this.sun.shadow.camera.top = 3.2;
    this.sun.shadow.camera.bottom = -3.2;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.02;
    this.sun.target.position.set(0, 0.8, -0.3);
    this.group.add(this.sun, this.sun.target);

    scene.fog = new THREE.FogExp2(0xc4d2de, 0.026);

    // Fixed particle pool. Only the count in use changes with quality.
    this.envRes = q.envRes;
    this.reflections = q.reflections;
    this.capacity = 900;
    const pos = new Float32Array(this.capacity * 3);
    this.snowBase = new Float32Array(this.capacity * 3);
    this.snowVel = new Float32Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) {
      pos[i * 3] = this.snowBase[i * 3] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 1] = this.snowBase[i * 3 + 1] = Math.random() * 7;
      pos[i * 3 + 2] = this.snowBase[i * 3 + 2] = (Math.random() - 0.5) * 16;
      this.snowVel[i] = 0.12 + Math.random() * 0.22;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setDrawRange(0, q.snowCount);
    const mat = new THREE.PointsMaterial({
      size: 0.028,
      map: snowSprite(),
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.NormalBlending,
      color: 0xffffff,
      fog: true,
    });
    this.snow = new THREE.Points(geo, mat);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 30;
    this.group.add(this.snow);

    this.setTime(0);
  }

  applyQuality(q: QualitySettings) {
    this.envRes = q.envRes;
    this.reflections = q.reflections;
    this.snow.geometry.setDrawRange(0, Math.min(this.capacity, q.snowCount));
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.bakeDirty = true;
  }

  setTime(t: number) {
    this.time = THREE.MathUtils.clamp(t, 0, 1);
    const k = lerpKeys(this.time);
    this.night = k.night;
    const u = this.skyMat.uniforms;
    u.uTop.value.copy(k.skyTop);
    u.uMid.value.copy(k.skyMid);
    u.uLow.value.copy(k.skyLow);
    u.uGround.value.copy(k.ground);
    u.uNight.value = k.night;
    u.uSunDir.value.copy(k.sunDir);
    this.sun.color.copy(k.sun);
    this.sun.intensity = k.sunI;
    this.sun.position.copy(k.sunDir).multiplyScalar(7).add(new THREE.Vector3(0, 0.8, -0.3));
    this.hemi.color.copy(k.hemiSky);
    this.hemi.groundColor.copy(k.hemiGround);
    this.hemi.intensity = k.hemiI;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(k.fog);
    fog.density = k.fogD;
    this.renderer.toneMappingExposure = k.exposure;
    // rebaking the environment every frame of the freeze lapse is wasteful;
    // the light only needs to step every few percent of the day
    if (Math.abs(this.time - this.bakedTime) > 0.1) this.bakeDirty = true;
  }

  /** Follows the camera so the snow volume is always around the viewer. */
  update(dt: number, camera: THREE.Camera) {
    this.sky.position.set(camera.position.x, 0, camera.position.z);
    const p = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    const n = this.snow.geometry.drawRange.count;
    const t = performance.now() * 0.001;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      arr[i3 + 1] -= this.snowVel[i] * dt;
      if (arr[i3 + 1] < -0.4) {
        arr[i3 + 1] = 6.5;
        arr[i3] = camera.position.x + (Math.random() - 0.5) * 15;
        arr[i3 + 2] = camera.position.z + (Math.random() - 0.5) * 15;
        this.snowBase[i3] = arr[i3];
        this.snowBase[i3 + 2] = arr[i3 + 2];
      }
      arr[i3] = this.snowBase[i3] + Math.sin(t * 0.7 + i) * 0.11;
      arr[i3 + 2] = this.snowBase[i3 + 2] + Math.cos(t * 0.55 + i * 1.7) * 0.09;
    }
    p.needsUpdate = true;

    this.bakeTimer -= dt;
    if (this.bakeDirty && this.bakeTimer <= 0) {
      this.bakeEnv();
      this.bakeDirty = false;
      this.bakedTime = this.time;
      this.bakeTimer = 0.5;
    }
  }

  private bakeEnv() {
    const prev = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0.04, 0.1, 30, { size: this.envRes });
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = this.reflections;
    prev?.dispose();
  }

  dispose() {
    this.envRT?.dispose();
    this.pmrem.dispose();
  }
}
