import * as THREE from 'three'
import { LIQUID_BOTTOM, LIQUID_TOP, MOUTH_R, MOUTH_Y, R_IN } from './dims'

/**
 * The liquid is solved analytically rather than simulated: gravity is world +Y,
 * so a horizontal plane through the sphere is always a circle centred on the
 * vertical axis. That single fact gives a correct waterline, a correct air
 * pocket, and a bubble that slides to the raised side when the globe is tilted,
 * for the cost of one uniform.
 */

const VOL_VERT = /* glsl */ `
  varying vec3 vW;
  varying vec3 vN;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const VOL_FRAG = /* glsl */ `
  precision highp float;
  uniform float uLevel;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform float uOpacity;
  varying vec3 vW;
  varying vec3 vN;

  void main() {
    if (vW.y > uLevel) discard;
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.6);
    float depth = clamp((uLevel - vW.y) / 0.85, 0.0, 1.0);
    vec3 col = mix(uShallow, uDeep, depth);
    float a = (0.15 + fres * 0.42 + depth * 0.18) * uOpacity;
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const SURF_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vW;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const SURF_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uRipple;
  uniform vec3 uSky;
  uniform vec3 uTint;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vW;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    // Concentric ripple, strongest just after the surface has been disturbed.
    float w = sin(r * 26.0 - uTime * 5.0) * 0.5 + 0.5;
    float ripple = w * uRipple * (0.35 + 0.65 * r);

    vec3 V = normalize(cameraPosition - vW);
    float grazing = 1.0 - clamp(abs(V.y), 0.0, 1.0);
    // The waterline is what says "there is liquid in here", so the meniscus
    // where the surface climbs the glass is drawn as a distinct bright band
    // while the body of the surface stays nearly clear.
    float rim = smoothstep(0.74, 0.985, r);
    float line = smoothstep(0.9, 0.995, r) * (1.0 - smoothstep(0.995, 1.0, r));

    vec3 col = mix(uTint, uSky, 0.22 + grazing * 0.3 + ripple * 0.22 + line * 0.55);
    float a = (0.055 + grazing * 0.11 + rim * 0.32 + line * 0.55 + ripple * 0.1) * uOpacity;
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.78));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const BUB_VERT = /* glsl */ `
  attribute float aSize;
  uniform float uScale;
  varying float vFade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFade = 1.0;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.05, -mv.z);
  }
`

const BUB_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0) discard;
    // A bubble is a ring: bright edge, near-empty middle.
    float shell = smoothstep(0.55, 1.0, r) * (1.0 - smoothstep(0.94, 1.0, r));
    float glint = smoothstep(0.6, 0.0, length(c - vec2(-0.13, 0.13)) * 3.4);
    float a = shell * 0.85 + glint * 0.5;
    if (a < 0.02) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

export class Liquid {
  /** Belongs to the assembly: it rides along when the globe turns. */
  readonly volume: THREE.Mesh
  /** Belongs to the world: gravity keeps it level however the globe is held. */
  readonly surface: THREE.Mesh
  readonly bubbles: THREE.Points

  /** 0..1 of the fillable interior. */
  fill = 0
  /** World Y of the waterline. */
  levelY = 0

  private volMat: THREE.ShaderMaterial
  private surfMat: THREE.ShaderMaterial
  private bubMat: THREE.ShaderMaterial
  private volGeo: THREE.SphereGeometry
  private surfGeo: THREE.CircleGeometry
  private bubGeo: THREE.BufferGeometry
  private bubPos: Float32Array
  private bubVel: Float32Array
  private bubLive: Float32Array
  private count: number
  private ripple = 0
  private time = 0
  private center = new THREE.Vector3()
  private tmp = new THREE.Vector3()
  private localUp = new THREE.Vector3(0, 1, 0)
  private invQ = new THREE.Quaternion()

  constructor(bubbleCount: number, backFace: boolean) {
    this.count = bubbleCount

    const rv = R_IN * 0.996
    this.volGeo = new THREE.SphereGeometry(
      rv, 40, 28, 0, Math.PI * 2, 0, Math.acos(MOUTH_Y / rv),
    )
    this.volMat = new THREE.ShaderMaterial({
      vertexShader: VOL_VERT,
      fragmentShader: VOL_FRAG,
      uniforms: {
        uLevel: { value: -999 },
        uShallow: { value: new THREE.Color(0xcae6f0) },
        uDeep: { value: new THREE.Color(0x5d95ac) },
        uOpacity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      side: backFace ? THREE.DoubleSide : THREE.FrontSide,
    })
    this.volume = new THREE.Mesh(this.volGeo, this.volMat)
    this.volume.renderOrder = 12
    this.volume.visible = false

    this.surfGeo = new THREE.CircleGeometry(1, 56)
    this.surfGeo.rotateX(-Math.PI / 2)
    this.surfMat = new THREE.ShaderMaterial({
      vertexShader: SURF_VERT,
      fragmentShader: SURF_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uRipple: { value: 0 },
        uSky: { value: new THREE.Color(0xb6c8d4) },
        uTint: { value: new THREE.Color(0x9dc0cc) },
        uOpacity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.surface = new THREE.Mesh(this.surfGeo, this.surfMat)
    this.surface.renderOrder = 14
    this.surface.visible = false

    this.bubPos = new Float32Array(this.count * 3)
    this.bubVel = new Float32Array(this.count)
    this.bubLive = new Float32Array(this.count)
    const sizes = new Float32Array(this.count)
    for (let i = 0; i < this.count; i++) {
      sizes[i] = 3 + Math.random() * 7
      this.bubPos[i * 3 + 1] = -999
    }
    this.bubGeo = new THREE.BufferGeometry()
    this.bubGeo.setAttribute('position', new THREE.BufferAttribute(this.bubPos, 3))
    this.bubGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    this.bubMat = new THREE.ShaderMaterial({
      vertexShader: BUB_VERT,
      fragmentShader: BUB_FRAG,
      uniforms: {
        uScale: { value: 300 },
        uColor: { value: new THREE.Color(0xe8f6ff) },
      },
      transparent: true,
      depthWrite: false,
    })
    this.bubbles = new THREE.Points(this.bubGeo, this.bubMat)
    this.bubbles.renderOrder = 13
    this.bubbles.frustumCulled = false
  }

  /** World-space centre of the glass sphere, refreshed each frame. */
  setCenter(c: THREE.Vector3) {
    this.center.copy(c)
  }

  /**
   * Highest world Y the container can actually hold, given how it is being
   * held. Solved exactly for a sphere cut by the mouth plane: either the
   * sphere's own high point, or — once the mouth has tipped upward — the
   * highest point of the rim circle.
   */
  private capLimit(localUp: THREE.Vector3): number {
    if (R_IN * localUp.y >= MOUTH_Y) return R_IN
    const horiz = Math.hypot(localUp.x, localUp.z)
    return MOUTH_Y * localUp.y + MOUTH_R * horiz
  }

  /** World up expressed in assembly-local space; drives the container cap. */
  setOrientation(q: THREE.Quaternion) {
    this.localUp.set(0, 1, 0).applyQuaternion(this.invQ.copy(q).invert())
  }

  setFill(v: number) {
    const next = THREE.MathUtils.clamp(v, 0, 1)
    if (next > this.fill) this.ripple = Math.min(1, this.ripple + (next - this.fill) * 5)
    this.fill = next
  }

  /** A disturbance that shows on the surface — pouring, seating, shaking. */
  disturb(amount: number) {
    this.ripple = Math.min(1.4, this.ripple + amount)
  }

  /** Releases a burst of bubbles near the given world point. */
  spawnBubbles(n: number, at: THREE.Vector3, spread = 0.1) {
    let made = 0
    for (let i = 0; i < this.count && made < n; i++) {
      if (this.bubLive[i] > 0) continue
      this.bubPos[i * 3] = at.x + (Math.random() - 0.5) * spread
      this.bubPos[i * 3 + 1] = at.y + (Math.random() - 0.5) * spread * 0.5
      this.bubPos[i * 3 + 2] = at.z + (Math.random() - 0.5) * spread
      this.bubVel[i] = 0.09 + Math.random() * 0.16
      this.bubLive[i] = 1
      made++
    }
  }

  update(dt: number, visible: boolean, onPop?: () => void) {
    this.time += dt
    this.ripple = Math.max(0, this.ripple - dt * 0.85)

    const raw = THREE.MathUtils.lerp(
      this.center.y + LIQUID_BOTTOM,
      this.center.y + LIQUID_TOP,
      this.fill,
    )
    // Water cannot stand above the rim while the mouth is still open.
    const level = Math.min(raw, this.center.y + this.capLimit(this.localUp) - 0.004)
    this.levelY = level

    const show = visible && this.fill > 0.004
    this.volume.visible = show
    this.surface.visible = show
    this.bubbles.visible = show
    this.volMat.uniforms.uLevel.value = level
    this.surfMat.uniforms.uTime.value = this.time
    this.surfMat.uniforms.uRipple.value = this.ripple

    if (show) {
      const d = level - this.center.y
      const r = Math.sqrt(Math.max(0.0004, R_IN * R_IN - d * d)) * 0.995
      this.surface.position.set(this.center.x, level, this.center.z)
      this.surface.scale.setScalar(r)
    }

    // Bubbles rise straight up and pop at the waterline.
    const pos = this.bubPos
    let popped = 0
    for (let i = 0; i < this.count; i++) {
      if (this.bubLive[i] <= 0) continue
      const k = i * 3
      pos[k + 1] += this.bubVel[i] * dt
      pos[k] += Math.sin(this.time * 3 + i) * dt * 0.012
      this.tmp.set(pos[k], pos[k + 1], pos[k + 2]).sub(this.center)
      if (pos[k + 1] >= level - 0.006 || this.tmp.length() > R_IN * 0.985) {
        this.bubLive[i] = 0
        pos[k + 1] = -999
        popped++
      }
    }
    if (popped > 0) {
      this.ripple = Math.min(1.2, this.ripple + popped * 0.05)
      if (onPop && Math.random() < 0.5) onPop()
    }
    this.bubGeo.attributes.position.needsUpdate = true
  }

  setPointScale(px: number) {
    this.bubMat.uniforms.uScale.value = px
  }

  setOpacity(v: number) {
    this.volMat.uniforms.uOpacity.value = v
    this.surfMat.uniforms.uOpacity.value = v
  }

  dispose() {
    this.volGeo.dispose()
    this.surfGeo.dispose()
    this.bubGeo.dispose()
    this.volMat.dispose()
    this.surfMat.dispose()
    this.bubMat.dispose()
  }
}
