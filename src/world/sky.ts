import * as THREE from 'three';

// Sky dome + lighting rig + a tiny generated equirect environment for
// metallic deck hardware reflections.
export class Sky {
  readonly group = new THREE.Group();
  readonly sunDir = new THREE.Vector3(0.35, 0.8, 0.3).normalize();
  readonly sunLight: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;

  constructor() {
    const geo = new THREE.SphereGeometry(900, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uHorizon: { value: new THREE.Color(0xd7e8f0) },
        uZenith: { value: new THREE.Color(0x3f7fc2) }
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(h, 0.6));
          float sun = pow(max(dot(normalize(vDir), uSunDir), 0.0), 900.0);
          float halo = pow(max(dot(normalize(vDir), uSunDir), 0.0), 12.0);
          col += vec3(1.0, 0.95, 0.85) * sun * 4.0 + vec3(1.0, 0.9, 0.7) * halo * 0.22;
          // Soft distant cloud band near the horizon.
          float band = smoothstep(0.02, 0.1, vDir.y) * (1.0 - smoothstep(0.12, 0.3, vDir.y));
          float wisp = sin(atan(vDir.z, vDir.x) * 9.0) * 0.5 + 0.5;
          col = mix(col, vec3(0.96), band * wisp * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    const dome = new THREE.Mesh(geo, mat);
    dome.name = 'sky';
    this.group.add(dome);

    this.sunLight = new THREE.DirectionalLight(0xfff2dd, 2.6);
    this.sunLight.position.copy(this.sunDir).multiplyScalar(300);
    this.group.add(this.sunLight);

    this.hemi = new THREE.HemisphereLight(0xbfd8e8, 0x27424d, 0.9);
    this.group.add(this.hemi);
  }

  /** Small equirect env map for PBR reflections on wet steel. */
  buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, '#6ba6d8');
    g.addColorStop(0.48, '#d7e8f0');
    g.addColorStop(0.52, '#3a708f');
    g.addColorStop(1, '#0b2c40');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 64);
    // Sun blob.
    ctx.fillStyle = 'rgba(255,244,214,0.95)';
    ctx.beginPath();
    ctx.arc(40, 14, 5, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    tex.dispose();
    pmrem.dispose();
    return env;
  }

  /** Dim lights as the camera goes underwater. */
  setUnderwater(depth01: number): void {
    this.sunLight.intensity = THREE.MathUtils.lerp(2.6, 0.5, depth01);
    this.hemi.intensity = THREE.MathUtils.lerp(0.9, 0.32, depth01);
  }
}
