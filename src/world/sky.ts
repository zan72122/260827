import {
  BackSide,
  CanvasTexture,
  Color,
  EquirectangularReflectionMapping,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  type Texture,
  type WebGLRenderer,
} from 'three';

/**
 * Sky and environment.
 *
 * The reflections on the brass come from a small procedurally painted
 * equirectangular map rather than a downloaded HDRI, which keeps the first
 * load light and lets the indoor and outdoor spaces be tuned separately.
 */

function paintEquirect(kind: 'room' | 'outdoor'): CanvasTexture {
  const w = 256;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;

  if (kind === 'outdoor') {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2c4b7a');
    g.addColorStop(0.34, '#82a3c4');
    g.addColorStop(0.47, '#d3d5d4');
    g.addColorStop(0.5, '#e8ddc9'); // low sun warming the horizon
    g.addColorStop(0.53, '#e7ecf1');
    g.addColorStop(1, '#c0c9d2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // low winter sun, warm but not orange
    const sx = w * 0.68;
    const sy = h * 0.38;
    const s = ctx.createRadialGradient(sx, sy, 0, sx, sy, 34);
    s.addColorStop(0, 'rgba(255,241,214,1)');
    s.addColorStop(0.35, 'rgba(255,226,186,0.55)');
    s.addColorStop(1, 'rgba(255,226,186,0)');
    ctx.fillStyle = s;
    ctx.fillRect(sx - 40, sy - 40, 80, 80);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#4a4136');
    g.addColorStop(0.45, '#7d6a52');
    g.addColorStop(0.6, '#655749');
    g.addColorStop(1, '#3c332b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // the cold window, the one bright thing in the room
    const wx = w * 0.2;
    const wg = ctx.createRadialGradient(wx, h * 0.44, 2, wx, h * 0.44, 26);
    wg.addColorStop(0, 'rgba(196,219,240,1)');
    wg.addColorStop(1, 'rgba(120,150,180,0)');
    ctx.fillStyle = wg;
    ctx.fillRect(wx - 30, h * 0.44 - 30, 60, 60);
    // the lantern above the bench
    const lx = w * 0.72;
    const lg = ctx.createRadialGradient(lx, h * 0.3, 1, lx, h * 0.3, 20);
    lg.addColorStop(0, 'rgba(255,206,138,1)');
    lg.addColorStop(1, 'rgba(255,180,110,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(lx - 24, h * 0.3 - 24, 48, 48);
  }

  const t = new CanvasTexture(c);
  t.mapping = EquirectangularReflectionMapping;
  t.needsUpdate = true;
  return t;
}

export interface Environments {
  room: Texture;
  outdoor: Texture;
  dispose(): void;
}

export function buildEnvironments(renderer: WebGLRenderer): Environments {
  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const roomSrc = paintEquirect('room');
  const outSrc = paintEquirect('outdoor');
  const room = pmrem.fromEquirectangular(roomSrc).texture;
  const outdoor = pmrem.fromEquirectangular(outSrc).texture;
  roomSrc.dispose();
  outSrc.dispose();
  return {
    room,
    outdoor,
    dispose() {
      room.dispose();
      outdoor.dispose();
      pmrem.dispose();
    },
  };
}

const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * The sky keeps its gradient all the way to the horizon and adds a thin band
 * of aerial haze there, so distant hills stay readable instead of dissolving.
 */
const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uHaze;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  varying vec3 vWorld;

  void main() {
    vec3 dir = normalize(vWorld);
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    float t = pow(clamp(dir.y, 0.0, 1.0), 0.55);
    vec3 col = mix(uHorizon, uZenith, t);
    float band = exp(-abs(dir.y) * 14.0);
    col = mix(col, uHaze, band * 0.7);
    float sun = pow(max(dot(dir, normalize(uSunDir)), 0.0), 260.0);
    float glow = pow(max(dot(dir, normalize(uSunDir)), 0.0), 8.0);
    col += uSunColor * (sun * 1.4 + glow * 0.16);
    // below the horizon the dome is only ever seen as a faint ground haze
    col = mix(col * 0.86, col, smoothstep(-0.08, 0.02, dir.y));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class SkyDome {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;

  constructor(radius = 900) {
    this.material = new ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: new Color(0x2f5590) },
        uHorizon: { value: new Color(0xb5c4d2) },
        uHaze: { value: new Color(0xe4e2da) },
        uSunDir: { value: new Color(0.42, 0.34, -0.84) },
        uSunColor: { value: new Color(0xffe6bd) },
      },
    });
    this.mesh = new Mesh(new SphereGeometry(radius, 24, 16), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  addTo(scene: Scene): void {
    scene.add(this.mesh);
  }

  setSun(x: number, y: number, z: number): void {
    (this.material.uniforms.uSunDir.value as Color).setRGB(x, y, z);
  }
}
