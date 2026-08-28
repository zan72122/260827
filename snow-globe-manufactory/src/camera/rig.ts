import * as THREE from 'three'

/**
 * Camera control. Two modes only: an eased orbit framing for the workbench
 * steps, and a scripted path for the trip into the globe. There is no free
 * flight — the player never has to aim a camera.
 */

export interface Framing {
  target: THREE.Vector3
  /** Radius of the thing being framed; the distance is solved from the FOV. */
  radius: number
  yaw: number
  pitch: number
  fov: number
  /** Extra breathing room beyond a tight fit. */
  margin: number
}

export interface PathKey {
  pos: THREE.Vector3
  look: THREE.Vector3
}

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera

  /** Scales every camera move; the calm-camera setting drops it. */
  travel = 1

  private desired: Framing = {
    target: new THREE.Vector3(),
    radius: 0.6,
    yaw: 0,
    pitch: -0.2,
    fov: 50,
    margin: 1.25,
  }
  private curTarget = new THREE.Vector3()
  private curRadius = 0.6
  private curYaw = 0
  private curPitch = -0.2
  private curFov = 50
  private aspect = 1

  private path: { pos: THREE.CatmullRomCurve3; look: THREE.CatmullRomCurve3 } | null = null
  private pathT = 0
  private pathDur = 1
  private pathDone: (() => void) | null = null
  private lookAt = new THREE.Vector3()
  private tmp = new THREE.Vector3()
  private snapNext = false

  constructor() {
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 40)
    this.camera.position.set(0, 0.8, 2.2)
  }

  setAspect(a: number) {
    this.aspect = a
    this.camera.aspect = a
    this.camera.updateProjectionMatrix()
  }

  /** Distance at which a sphere of `radius` fits both screen axes. */
  private fitDistance(radius: number, fovDeg: number, margin: number): number {
    const fovY = THREE.MathUtils.degToRad(fovDeg)
    const dy = radius / Math.sin(fovY / 2)
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * this.aspect)
    const dx = radius / Math.sin(fovX / 2)
    return Math.max(dx, dy) * margin
  }

  frame(f: Partial<Framing> & { target: THREE.Vector3 }) {
    this.desired.target.copy(f.target)
    if (f.radius !== undefined) this.desired.radius = f.radius
    if (f.yaw !== undefined) this.desired.yaw = f.yaw
    if (f.pitch !== undefined) this.desired.pitch = f.pitch
    if (f.fov !== undefined) this.desired.fov = f.fov
    if (f.margin !== undefined) this.desired.margin = f.margin
  }

  /** Jumps straight to the pending framing — used on the first frame only. */
  snap() {
    this.snapNext = true
  }

  /**
   * Sets the lens directly. Used to widen it on the way into the globe: the
   * interior is only half a metre across, and in portrait a 46 degree lens
   * leaves a horizontal field of barely 22 degrees, which one tree fills.
   */
  setFov(v: number) {
    this.curFov = v
    this.camera.fov = v
    this.camera.updateProjectionMatrix()
  }

  get inPath(): boolean {
    return this.path !== null
  }

  playPath(keys: PathKey[], duration: number, onDone?: () => void) {
    this.path = {
      pos: new THREE.CatmullRomCurve3(keys.map((k) => k.pos.clone()), false, 'catmullrom', 0.4),
      look: new THREE.CatmullRomCurve3(keys.map((k) => k.look.clone()), false, 'catmullrom', 0.4),
    }
    this.pathT = 0
    this.pathDur = Math.max(0.2, duration)
    this.pathDone = onDone ?? null
  }

  cancelPath() {
    this.path = null
    this.pathDone = null
  }

  /** Where the eased orbit would place the camera right now. */
  restingPosition(out: THREE.Vector3): THREE.Vector3 {
    const d = this.fitDistance(this.desired.radius, this.desired.fov, this.desired.margin)
    const { yaw, pitch } = this.desired
    return out.set(
      this.desired.target.x + Math.sin(yaw) * Math.cos(pitch) * d,
      this.desired.target.y - Math.sin(pitch) * d,
      this.desired.target.z + Math.cos(yaw) * Math.cos(pitch) * d,
    )
  }

  update(dt: number) {
    if (this.path) {
      this.pathT += dt / this.pathDur
      const t = Math.min(1, this.pathT)
      const e = ease(t)
      this.path.pos.getPoint(e, this.tmp)
      this.camera.position.copy(this.tmp)
      this.path.look.getPoint(e, this.lookAt)
      this.camera.lookAt(this.lookAt)
      if (t >= 1) {
        const cb = this.pathDone
        this.path = null
        this.pathDone = null
        cb?.()
      }
      return
    }

    const k = this.snapNext ? 1 : 1 - Math.exp(-dt * (3.2 * (0.55 + 0.45 * this.travel)))
    this.snapNext = false
    this.curTarget.lerp(this.desired.target, k)
    this.curRadius += (this.desired.radius - this.curRadius) * k
    this.curYaw += (this.desired.yaw - this.curYaw) * k
    this.curPitch += (this.desired.pitch - this.curPitch) * k
    this.curFov += (this.desired.fov - this.curFov) * k

    const d = this.fitDistance(this.curRadius, this.curFov, this.desired.margin)
    this.camera.position.set(
      this.curTarget.x + Math.sin(this.curYaw) * Math.cos(this.curPitch) * d,
      this.curTarget.y - Math.sin(this.curPitch) * d,
      this.curTarget.z + Math.cos(this.curYaw) * Math.cos(this.curPitch) * d,
    )
    this.camera.lookAt(this.curTarget)
    if (Math.abs(this.camera.fov - this.curFov) > 0.01) {
      this.camera.fov = this.curFov
      this.camera.updateProjectionMatrix()
    }
  }

  /** Screen-space projection of a world point, in normalised device coords. */
  project(p: THREE.Vector3, out: THREE.Vector2): THREE.Vector2 {
    this.tmp.copy(p).project(this.camera)
    return out.set(this.tmp.x, this.tmp.y)
  }
}
