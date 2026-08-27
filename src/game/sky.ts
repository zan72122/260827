// Cold overcast sky: gradient dome, low cloud bank sprites near the horizon,
// light drifting snow near the camera, and the scene lighting (low warm sun
// against a blue-grey ambience).

import * as THREE from 'three';
import { mulberry32 } from './const';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // pin to far plane
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunGlow;
void main() {
  float h = clamp(vDir.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.62));
  float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
  col += uSunGlow * (pow(s, 18.0) * 0.35 + pow(s, 90.0) * 0.4);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  snow: THREE.Points;
  dome!: THREE.Mesh;
  farIce!: THREE.Mesh;
  private snowVel: Float32Array;

  constructor(scene: THREE.Scene, sunDir: THREE.Vector3) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          uZenith: { value: new THREE.Color(0.52, 0.60, 0.70) },
          uHorizon: { value: new THREE.Color(0.775, 0.805, 0.845) },
          uSunDir: { value: sunDir.clone().negate() },
          uSunGlow: { value: new THREE.Color(0.55, 0.45, 0.32) },
        },
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    dome.frustumCulled = false;
    scene.add(dome);
    this.dome = dome;

    // matte "far pack ice" disc so the playfield never ends in a hard line
    const farIce = new THREE.Mesh(
      new THREE.CircleGeometry(3200, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.765, 0.80, 0.845), toneMapped: false }),
    );
    farIce.rotation.x = -Math.PI / 2;
    farIce.position.y = -0.95; // below the carved-lane water level
    scene.add(farIce);
    this.farIce = farIce;

    // lighting
    const sun = new THREE.DirectionalLight(0xfff0dd, 2.4);
    sun.position.copy(sunDir.clone().negate().multiplyScalar(300));
    scene.add(sun);
    const hemi = new THREE.HemisphereLight(0xbcccdd, 0x53616e, 1.1);
    scene.add(hemi);

    // low cloud bank sprites around the horizon
    const cloudTex = Sky.makeCloudTexture();
    const rng = mulberry32(7);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rng() * 0.4;
      const r = 640 + rng() * 160;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: cloudTex, transparent: true, depthWrite: false,
        color: new THREE.Color().setHSL(0.58, 0.05, 0.72 + rng() * 0.1),
        opacity: 0.5 + rng() * 0.3,
      }));
      sp.position.set(Math.cos(a) * r, 30 + rng() * 70, Math.sin(a) * r);
      sp.scale.set(340 + rng() * 260, 90 + rng() * 60, 1);
      scene.add(sp);
    }

    // drifting snow near the camera
    const N = 420;
    const posArr = new Float32Array(N * 3);
    this.snowVel = new Float32Array(N);
    const srng = mulberry32(3);
    for (let i = 0; i < N; i++) {
      posArr[i * 3] = (srng() - 0.5) * 160;
      posArr[i * 3 + 1] = srng() * 70;
      posArr[i * 3 + 2] = (srng() - 0.5) * 160;
      this.snowVel[i] = 1.6 + srng() * 2.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    const flakeC = document.createElement('canvas');
    flakeC.width = flakeC.height = 32;
    const fctx = flakeC.getContext('2d')!;
    const fg = fctx.createRadialGradient(16, 16, 1, 16, 16, 15);
    fg.addColorStop(0, 'rgba(255,255,255,0.9)');
    fg.addColorStop(1, 'rgba(255,255,255,0)');
    fctx.fillStyle = fg;
    fctx.fillRect(0, 0, 32, 32);
    this.snow = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xf2f5f8, size: 0.4, transparent: true, opacity: 0.55,
      map: new THREE.CanvasTexture(flakeC), alphaTest: 0.02,
      sizeAttenuation: true, depthWrite: false,
    }));
    this.snow.frustumCulled = false;
    scene.add(this.snow);
  }

  private static makeCloudTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const ctx = c.getContext('2d')!;
    const rng = mulberry32(17);
    for (let i = 0; i < 26; i++) {
      const x = 30 + rng() * 196, y = 40 + rng() * 50, r = 18 + rng() * 34;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 128);
    }
    return new THREE.CanvasTexture(c);
  }

  update(dt: number, camPos: THREE.Vector3): void {
    const pos = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const n = this.snowVel.length;
    for (let i = 0; i < n; i++) {
      arr[i * 3 + 1] -= this.snowVel[i] * dt;
      arr[i * 3] += Math.sin(arr[i * 3 + 1] * 0.5 + i) * dt * 0.6;
      // snow lives near the sea surface, not around a high camera
      if (arr[i * 3 + 1] < -2) arr[i * 3 + 1] += 72;
      // keep the box around the camera
      if (arr[i * 3] < camPos.x - 85) arr[i * 3] += 170;
      if (arr[i * 3] > camPos.x + 85) arr[i * 3] -= 170;
      if (arr[i * 3 + 2] < camPos.z - 85) arr[i * 3 + 2] += 170;
      if (arr[i * 3 + 2] > camPos.z + 85) arr[i * 3 + 2] -= 170;
    }
    pos.needsUpdate = true;
  }
}
