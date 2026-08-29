import {
  BackSide,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { QualityProfile } from '../core/AdaptiveQuality';
import { clamp, lerp, smoothstep } from '../core/math';

const KEYS = [
  // t, zenith, horizon, sunColor, sunIntensity, hemiIntensity, fogDensity
  { t: 0.0, zenith: 0x2a3c58, horizon: 0x8b93a4, sun: 0xb9c6dc, intensity: 1.35, hemi: 1.05, fog: 0.0072 },
  { t: 0.18, zenith: 0x40608c, horizon: 0xccae90, sun: 0xffcda4, intensity: 2.4, hemi: 1.0, fog: 0.006 },
  { t: 0.42, zenith: 0x4a76ad, horizon: 0xc7cfd8, sun: 0xfff3e0, intensity: 2.9, hemi: 1.0, fog: 0.0042 },
  { t: 0.66, zenith: 0x3c689e, horizon: 0xd7a878, sun: 0xffc07a, intensity: 2.2, hemi: 0.85, fog: 0.005 },
  { t: 0.82, zenith: 0x1f3560, horizon: 0x9b6f74, sun: 0xd08d72, intensity: 0.85, hemi: 0.5, fog: 0.0068 },
  { t: 1.0, zenith: 0x080e1e, horizon: 0x1d2740, sun: 0x2a3550, intensity: 0.1, hemi: 0.42, fog: 0.0092 },
];

const vertexShader = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uSunSize;
uniform float uCityGlow;
varying vec3 vWorld;
void main() {
  vec3 dir = normalize(vWorld);
  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  // Cold winter sky: a long horizon band, not a two-colour ramp.
  float band = pow(1.0 - abs(dir.y), 2.4);
  vec3 col = mix(uZenith, uHorizon, band);
  float sun = max(dot(dir, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sun, uSunSize) * 0.55;
  col += uSunColor * pow(sun, 3.0) * 0.06;
  // City light bounced back into the low sky once the streets are on.
  col += vec3(0.42, 0.31, 0.2) * uCityGlow * pow(1.0 - h, 5.0);
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * Continuous winter afternoon.
 *
 * Time never jumps: the sun elevation, its colour, the sky gradient, the fog
 * and the ambient all interpolate through keyframes, so the plaza slides from
 * an overcast morning into blue hour while the work goes on.
 */
export class Sky {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly dome: Mesh;
  readonly sunDir = new Vector3();

  private readonly material: ShaderMaterial;
  private readonly pmrem: PMREMGenerator;
  private readonly envScene = new Scene();
  private env: Texture | null = null;
  private envTimer = 0;
  private time = 0;

  constructor(
    private readonly scene: Scene,
    renderer: WebGLRenderer,
    profile: QualityProfile,
  ) {
    this.material = new ShaderMaterial({
      uniforms: {
        uZenith: { value: new Color(0x1d2b44) },
        uHorizon: { value: new Color(0x6f7789) },
        uSunColor: { value: new Color(0x9fb0cc) },
        uSunDir: { value: new Vector3(0.4, 0.3, 1) },
        uSunSize: { value: 160 },
        uCityGlow: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new Mesh(new SphereGeometry(320, 24, 16), this.material);
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.sun = new DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = profile.shadows;
    if (profile.shadows) {
      this.sun.shadow.mapSize.setScalar(profile.shadowMapSize);
      const cam = this.sun.shadow.camera;
      cam.left = -34;
      cam.right = 34;
      cam.top = 40;
      cam.bottom = -14;
      cam.near = 1;
      cam.far = 140;
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.04;
    }
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new HemisphereLight(0xb9c9e0, 0x2f2c28, 1);
    scene.add(this.hemi);

    scene.fog = new FogExp2(0x8a93a3, 0.006);

    this.pmrem = new PMREMGenerator(renderer);
    this.envScene.add(new Mesh(new SphereGeometry(50, 16, 12), this.material.clone()));
    this.setTime(0);
    this.refreshEnvironment();
  }

  /** 0 = early morning, 1 = night. */
  setTime(t: number): void {
    this.time = clamp(t, 0, 1);
    let a = KEYS[0];
    let b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (this.time >= KEYS[i].t && this.time <= KEYS[i + 1].t) {
        a = KEYS[i];
        b = KEYS[i + 1];
        break;
      }
    }
    const f = smoothstep((this.time - a.t) / Math.max(1e-5, b.t - a.t));
    const zenith = new Color(a.zenith).lerp(new Color(b.zenith), f);
    const horizon = new Color(a.horizon).lerp(new Color(b.horizon), f);
    const sunColor = new Color(a.sun).lerp(new Color(b.sun), f);
    const intensity = lerp(a.intensity, b.intensity, f);
    const hemi = lerp(a.hemi, b.hemi, f);
    const fog = lerp(a.fog, b.fog, f);

    // The sun tracks from low in the east to below the western rooftops.
    const elevation = Math.sin(clamp(this.time, 0, 1) * Math.PI * 0.92) * 0.72 - this.time * 0.24;
    const azimuth = lerp(-2.1, 0.7, this.time);
    this.sunDir.set(Math.cos(azimuth) * 0.9, Math.max(-0.12, elevation), Math.sin(azimuth) * 0.9).normalize();

    this.material.uniforms.uZenith.value.copy(zenith);
    this.material.uniforms.uHorizon.value.copy(horizon);
    this.material.uniforms.uSunColor.value.copy(sunColor);
    this.material.uniforms.uSunDir.value.copy(this.sunDir);
    this.material.uniforms.uSunSize.value = lerp(220, 60, this.time);
    this.material.uniforms.uCityGlow.value = smoothstep((this.time - 0.55) / 0.45);

    this.sun.position.copy(this.sunDir).multiplyScalar(90);
    this.sun.color.copy(sunColor);
    this.sun.intensity = intensity;
    this.hemi.intensity = hemi;
    this.hemi.color.copy(horizon).lerp(new Color(0xffffff), 0.25);
    (this.scene.fog as FogExp2).density = fog;
    (this.scene.fog as FogExp2).color.copy(horizon).multiplyScalar(0.75);
  }

  get timeOfDay(): number {
    return this.time;
  }

  /** Ambient level used to grade material env intensity and window lights. */
  get daylight(): number {
    return clamp(1 - smoothstep((this.time - 0.6) / 0.35), 0, 1);
  }

  update(dt: number): void {
    // The image-based lighting only needs to keep up with the sky slowly.
    this.envTimer -= dt;
    if (this.envTimer <= 0) {
      this.envTimer = 3;
      this.refreshEnvironment();
    }
  }

  private refreshEnvironment(): void {
    const child = this.envScene.children[0] as Mesh;
    const mat = child.material as ShaderMaterial;
    for (const key of Object.keys(this.material.uniforms)) {
      const src = this.material.uniforms[key].value;
      mat.uniforms[key].value = typeof src === 'number' ? src : src.clone();
    }
    const next = this.pmrem.fromScene(this.envScene, 0.04);
    this.env?.dispose();
    this.env = next.texture;
    this.scene.environment = this.env;
  }

  dispose(): void {
    this.pmrem.dispose();
    this.env?.dispose();
  }
}
