import * as THREE from 'three'
import { MOUTH_Y, R_IN, R_OUT } from './dims'

/**
 * The glass shell.
 *
 * Two single-pass draws, no render targets: a back-face draw that shows the far
 * wall of the sphere, and a front-face draw for the near wall. Depth testing
 * against the opaque town does the occlusion, so the town always stays readable
 * through it. Reflections are evaluated from a world-space reflection vector
 * against an analytic room, which is what stops the highlight from sticking to
 * the camera when the globe turns.
 */

const VERT = /* glsl */ `
  varying vec3 vW;
  varying vec3 vN;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec3 uSkyCol;      // cold light spilling from the window
  uniform vec3 uFloorCol;    // the bench, seen in the lower half of the reflection
  uniform vec3 uWindowDir;
  uniform vec3 uWindowCol;
  uniform vec3 uLampDir;
  uniform vec3 uLampCol;
  uniform vec3 uEdgeTint;    // soda-lime glass reads faintly green at the rim
  uniform float uBaseAlpha;
  uniform float uRimAlpha;
  uniform float uReflect;
  uniform float uOpacity;
  uniform float uBackFace;   // 1.0 on the far-wall pass

  varying vec3 vW;
  varying vec3 vN;

  vec3 room(vec3 d) {
    float up = d.y * 0.5 + 0.5;
    vec3 c = mix(uFloorCol, uSkyCol, smoothstep(0.3, 0.92, up));
    c += uWindowCol * pow(max(dot(d, uWindowDir), 0.0), 20.0) * 1.15;
    c += uLampCol * pow(max(dot(d, uLampDir), 0.0), 46.0) * 1.5;
    return c;
  }

  void main() {
    vec3 N = normalize(vN) * (uBackFace > 0.5 ? -1.0 : 1.0);
    vec3 V = normalize(cameraPosition - vW);
    float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 3.0);

    vec3 R = reflect(-V, N);
    vec3 env = room(R) * uReflect;

    // A tight, physically-placed window highlight: the single cue that reads
    // most strongly as "this is glass".
    float spec = pow(max(dot(R, uWindowDir), 0.0), 640.0) * 2.6
               + pow(max(dot(R, uLampDir), 0.0), 320.0) * 1.1;

    // The extreme grazing band is the thick edge of the shell.
    float edge = smoothstep(0.78, 0.995, 1.0 - ndv);
    vec3 col = env * (0.3 + 0.7 * fres) + vec3(spec);
    col = mix(col, col * 0.55 + uEdgeTint, edge * 0.75);

    float a = uBaseAlpha + fres * uRimAlpha + edge * 0.28;
    if (uBackFace > 0.5) a *= 0.55;   // the far wall must never bury the town
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.94) * uOpacity);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface GlassOptions {
  backPass: boolean
}

export class Glass {
  readonly group = new THREE.Group()
  readonly front: THREE.Mesh
  readonly back: THREE.Mesh | null = null

  private frontMat: THREE.ShaderMaterial
  private backMat: THREE.ShaderMaterial | null = null
  private geoOut: THREE.SphereGeometry
  private geoIn: THREE.SphereGeometry

  constructor(opts: GlassOptions) {
    const uniforms = () => ({
      uSkyCol: { value: new THREE.Color(0x7c93a6) },
      uFloorCol: { value: new THREE.Color(0x2a2119) },
      uWindowDir: { value: new THREE.Vector3(-0.42, 0.62, 0.66).normalize() },
      uWindowCol: { value: new THREE.Color(0xc7dcec) },
      uLampDir: { value: new THREE.Vector3(0.78, 0.44, 0.44).normalize() },
      uLampCol: { value: new THREE.Color(0xffc98a) },
      uEdgeTint: { value: new THREE.Color(0x2f4a44) },
      uBaseAlpha: { value: 0.055 },
      uRimAlpha: { value: 0.72 },
      uReflect: { value: 0.85 },
      uOpacity: { value: 1 },
      uBackFace: { value: 0 },
    })

    // Cut at the mouth plane: the shell is a dome the plug closes, which is
    // what lets the finished globe sit flat on a pedestal instead of hovering.
    this.geoOut = new THREE.SphereGeometry(
      R_OUT, 64, 44, 0, Math.PI * 2, 0, Math.acos(MOUTH_Y / R_OUT),
    )
    this.geoIn = new THREE.SphereGeometry(
      R_IN, 48, 34, 0, Math.PI * 2, 0, Math.acos(MOUTH_Y / R_IN),
    )

    this.frontMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: uniforms(),
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    })
    this.front = new THREE.Mesh(this.geoOut, this.frontMat)
    this.front.renderOrder = 30
    this.front.name = 'glassFront'
    this.group.add(this.front)

    if (opts.backPass) {
      const u = uniforms()
      u.uBackFace.value = 1
      this.backMat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: u,
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
      })
      this.back = new THREE.Mesh(this.geoIn, this.backMat)
      this.back.renderOrder = 1
      this.back.name = 'glassBack'
      this.group.add(this.back)
    }
  }

  /** 0 hides the shell entirely; used while the camera is inside the globe. */
  setOpacity(v: number) {
    this.frontMat.uniforms.uOpacity.value = v
    if (this.backMat) this.backMat.uniforms.uOpacity.value = v
    this.group.visible = v > 0.002
  }

  /** Points the analytic room at the real window and lamp of the atelier. */
  setEnvironment(windowDir: THREE.Vector3, lampDir: THREE.Vector3) {
    for (const m of [this.frontMat, this.backMat]) {
      if (!m) continue
      ;(m.uniforms.uWindowDir.value as THREE.Vector3).copy(windowDir)
      ;(m.uniforms.uLampDir.value as THREE.Vector3).copy(lampDir)
    }
  }

  /** Dials the reflection down so the interior stays legible on small screens. */
  setInterior(k: number) {
    const t = 1 - k
    this.frontMat.uniforms.uReflect.value = 0.85 * t + 0.12
    this.frontMat.uniforms.uRimAlpha.value = 0.72 * t + 0.05
    if (this.backMat) {
      this.backMat.uniforms.uReflect.value = 0.85 * t + 0.3
      this.backMat.uniforms.uRimAlpha.value = 0.72 * t + 0.12
    }
  }

  dispose() {
    this.geoOut.dispose()
    this.geoIn.dispose()
    this.frontMat.dispose()
    this.backMat?.dispose()
  }
}
