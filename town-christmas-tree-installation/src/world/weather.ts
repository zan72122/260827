import * as THREE from 'three';
import { Rng } from '../core/rng';

interface SkyKey {
  t: number;
  zenith: number;
  horizon: number;
  ground: number;
  sun: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  ambient: number;
  elevation: number;
  azimuth: number;
  fog: number;
  fogDensity: number;
  exposure: number;
}

/** Winter morning → afternoon → blue hour → night. */
const KEYS: SkyKey[] = [
  {
    t: 0,
    zenith: 0x7fa7cf,
    horizon: 0xdae4ec,
    ground: 0xb8b4ac,
    sun: 0xffeacd,
    sunIntensity: 2.1,
    hemiSky: 0xbdd6ef,
    hemiGround: 0xa9a49c,
    hemiIntensity: 0.9,
    ambient: 0.28,
    elevation: 0.36,
    azimuth: 2.35,
    fog: 0xdae4ec,
    fogDensity: 0.0042,
    exposure: 1.0,
  },
  {
    t: 0.42,
    zenith: 0x6d9bcb,
    horizon: 0xe6dccb,
    ground: 0xb3aea4,
    sun: 0xffdcae,
    sunIntensity: 2.3,
    hemiSky: 0xb3cde8,
    hemiGround: 0xa8a29a,
    hemiIntensity: 0.85,
    ambient: 0.26,
    elevation: 0.52,
    azimuth: 1.15,
    fog: 0xe4dccd,
    fogDensity: 0.0044,
    exposure: 1.02,
  },
  {
    t: 0.72,
    zenith: 0x24365e,
    horizon: 0xc9825a,
    ground: 0x5c5a5c,
    sun: 0xffb070,
    sunIntensity: 0.85,
    hemiSky: 0x4a6390,
    hemiGround: 0x4c4a4a,
    hemiIntensity: 0.6,
    ambient: 0.2,
    elevation: 0.055,
    azimuth: 0.42,
    fog: 0x8d7d84,
    fogDensity: 0.0062,
    exposure: 1.06,
  },
  {
    t: 0.88,
    zenith: 0x121f3c,
    horizon: 0x4a5476,
    ground: 0x2e3346,
    sun: 0xa8b6d8,
    sunIntensity: 0.3,
    hemiSky: 0x2b3b60,
    hemiGround: 0x2a2c34,
    hemiIntensity: 0.42,
    ambient: 0.16,
    elevation: -0.06,
    azimuth: 0.1,
    fog: 0x39415c,
    fogDensity: 0.0072,
    exposure: 1.1,
  },
  {
    t: 1,
    zenith: 0x080e1e,
    horizon: 0x1b2740,
    ground: 0x161a24,
    sun: 0x9fb0d4,
    sunIntensity: 0.16,
    hemiSky: 0x1b2846,
    hemiGround: 0x1a1c22,
    hemiIntensity: 0.3,
    ambient: 0.12,
    elevation: 0.4,
    azimuth: -0.9,
    fog: 0x1b2338,
    fogDensity: 0.0078,
    exposure: 1.14,
  },
];

const skyVert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const skyFrag = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float sunStrength;
varying vec3 vWorld;
void main() {
  vec3 dir = normalize(vWorld);
  float h = dir.y;
  vec3 col = mix(horizon, zenith, clamp(pow(max(h, 0.0), 0.62), 0.0, 1.0));
  col = mix(col, ground, clamp(-h * 3.0, 0.0, 1.0));
  // A broad, soft solar glow — no lens flare, no hard disc.
  float d = max(dot(dir, normalize(sunDir)), 0.0);
  col += sunColor * pow(d, 22.0) * 0.5 * sunStrength;
  col += sunColor * pow(d, 4.0) * 0.09 * sunStrength;
  gl_FragColor = vec4(col, 1.0);
}`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private envMesh: THREE.Mesh | null = null;
  private envScene: THREE.Scene | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private lastEnvTod = -1;
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
  readonly ambient = new THREE.AmbientLight(0xffffff, 0.2);
  readonly fog = new THREE.FogExp2(0xdae4ec, 0.004);
  private uniforms: Record<string, THREE.IUniform>;
  private current = 0;

  constructor(shadowMapSize: number) {
    this.uniforms = {
      zenith: { value: new THREE.Color(0x7fa7cf) },
      horizon: { value: new THREE.Color(0xdae4ec) },
      ground: { value: new THREE.Color(0xb8b4ac) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color(0xffeacd) },
      sunStrength: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: true,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 16), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 160;
    const s = 46;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.045;
    this.sun.target.position.set(0, 4, 0);
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.mesh, this.sun, this.sun.target, this.hemi, this.ambient);
    scene.fog = this.fog;
  }

  get timeOfDay(): number {
    return this.current;
  }

  /** Returns the tone-mapping exposure the renderer should use. */
  setTimeOfDay(t: number): number {
    this.current = THREE.MathUtils.clamp(t, 0, 1);
    let i = 0;
    while (i < KEYS.length - 2 && this.current > KEYS[i + 1].t) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const f = THREE.MathUtils.clamp((this.current - a.t) / (b.t - a.t), 0, 1);
    const lerpC = (x: number, y: number) => new THREE.Color(x).lerp(new THREE.Color(y), f);
    const n = (x: number, y: number) => THREE.MathUtils.lerp(x, y, f);

    (this.uniforms.zenith.value as THREE.Color).copy(lerpC(a.zenith, b.zenith));
    (this.uniforms.horizon.value as THREE.Color).copy(lerpC(a.horizon, b.horizon));
    (this.uniforms.ground.value as THREE.Color).copy(lerpC(a.ground, b.ground));
    (this.uniforms.sunColor.value as THREE.Color).copy(lerpC(a.sun, b.sun));
    this.uniforms.sunStrength.value = n(a.sunIntensity, b.sunIntensity) / 2.2;

    const elev = n(a.elevation, b.elevation);
    const azim = n(a.azimuth, b.azimuth);
    const dir = new THREE.Vector3(Math.cos(azim) * Math.cos(elev), Math.sin(elev), Math.sin(azim) * Math.cos(elev));
    (this.uniforms.sunDir.value as THREE.Vector3).copy(dir);
    this.sun.position.copy(dir).multiplyScalar(70).add(new THREE.Vector3(0, 0, 0));
    this.sun.color.copy(lerpC(a.sun, b.sun));
    this.sun.intensity = n(a.sunIntensity, b.sunIntensity);

    this.hemi.color.copy(lerpC(a.hemiSky, b.hemiSky));
    this.hemi.groundColor.copy(lerpC(a.hemiGround, b.hemiGround));
    this.hemi.intensity = n(a.hemiIntensity, b.hemiIntensity);
    this.ambient.intensity = n(a.ambient, b.ambient);

    this.fog.color.copy(lerpC(a.fog, b.fog));
    this.fog.density = n(a.fogDensity, b.fogDensity);
    return n(a.exposure, b.exposure);
  }

  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }

  /**
   * Metals need something to reflect. A small PMREM of this same sky gives
   * chrome, steel and the star a believable environment, refreshed only when
   * the time of day has actually moved.
   */
  refreshEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, force = false): void {
    if (!force && Math.abs(this.current - this.lastEnvTod) < 0.05) return;
    this.lastEnvTod = this.current;
    if (!this.pmrem) {
      this.pmrem = new THREE.PMREMGenerator(renderer);
      this.pmrem.compileEquirectangularShader();
      this.envScene = new THREE.Scene();
      this.envMesh = new THREE.Mesh(new THREE.SphereGeometry(80, 20, 14), this.mesh.material);
      this.envScene.add(this.envMesh);
      // A pale ground disc so downward reflections are not black.
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(200, 16),
        new THREE.MeshBasicMaterial({ color: 0x8d949c, side: THREE.DoubleSide }),
      );
      ground.rotation.x = Math.PI / 2;
      ground.position.y = -20;
      this.envScene.add(ground);
    }
    const prev = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene as THREE.Scene, 0, 1, 400);
    scene.environment = this.envTarget.texture;
    prev?.dispose();
  }

  disposeEnvironment(): void {
    this.envTarget?.dispose();
    this.pmrem?.dispose();
    this.envTarget = null;
    this.pmrem = null;
  }
}

/** Cheap snowfall: a wrapping point cloud that follows the camera. */
export class Snowfall {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private velocities: Float32Array;
  private count: number;
  private box = 70;
  private strength: number;

  constructor(count: number, rng: Rng, strength: number) {
    this.count = count;
    this.strength = strength;
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.positions[i * 3] = rng.range(-this.box / 2, this.box / 2);
      this.positions[i * 3 + 1] = rng.range(0, 42);
      this.positions[i * 3 + 2] = rng.range(-this.box / 2, this.box / 2);
      this.velocities[i * 3] = rng.range(-0.35, 0.35);
      this.velocities[i * 3 + 1] = -rng.range(0.5, 1.5);
      this.velocities[i * 3 + 2] = rng.range(-0.35, 0.35);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const g = c.getContext('2d');
    if (g) {
      const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.4, 'rgba(255,255,255,0.65)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
    }
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.PointsMaterial({
      size: 0.14,
      map: tex,
      transparent: true,
      opacity: 0.72 * strength,
      depthWrite: false,
      sizeAttenuation: true,
      color: 0xffffff,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = strength > 0.02;
  }

  update(dt: number, camera: THREE.Camera, time: number): void {
    if (!this.points.visible) return;
    const cx = camera.position.x;
    const cz = camera.position.z;
    const half = this.box / 2;
    const drift = Math.sin(time * 0.25) * 0.5;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      this.positions[j] += (this.velocities[j] + drift) * dt * this.strength;
      this.positions[j + 1] += this.velocities[j + 1] * dt;
      this.positions[j + 2] += this.velocities[j + 2] * dt * this.strength;
      if (this.positions[j + 1] < -0.5) {
        this.positions[j + 1] = 40;
        this.positions[j] = cx + (Math.random() - 0.5) * this.box;
        this.positions[j + 2] = cz + (Math.random() - 0.5) * this.box;
      }
      // Wrap horizontally around the camera so the volume always surrounds it.
      if (this.positions[j] - cx > half) this.positions[j] -= this.box;
      if (this.positions[j] - cx < -half) this.positions[j] += this.box;
      if (this.positions[j + 2] - cz > half) this.positions[j + 2] -= this.box;
      if (this.positions[j + 2] - cz < -half) this.positions[j + 2] += this.box;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
