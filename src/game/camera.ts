import * as THREE from 'three'

export type ShotSpec = {
  /** Where the camera looks. */
  target: THREE.Vector3
  /** Horizontal angle measured from +X, in the XZ plane, in degrees.
   *  0 puts the camera on the +X side, i.e. straight down the pull axis. */
  azimuthDeg: number
  elevationDeg: number
  /** Extra margin as a fraction of the fitted distance. */
  pad: number
}

const _a = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _back = new THREE.Vector3()
const WORLD_UP = new THREE.Vector3(0, 1, 0)

/** Distance at which every point in `pts` is inside the frustum. */
export function fitDistance(camera: THREE.PerspectiveCamera, shot: ShotSpec, pts: THREE.Vector3[]) {
  const az = (shot.azimuthDeg * Math.PI) / 180
  const el = (shot.elevationDeg * Math.PI) / 180
  _back.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize()
  _right.crossVectors(WORLD_UP, _back).normalize()
  _up.crossVectors(_back, _right).normalize()

  const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
  const th = tv * camera.aspect
  let d = 0.05
  for (const p of pts) {
    _a.copy(p).sub(shot.target)
    const x = Math.abs(_a.dot(_right))
    const y = Math.abs(_a.dot(_up))
    const z = _a.dot(_back)
    d = Math.max(d, z + x / th, z + y / tv)
  }
  return d * (1 + shot.pad)
}

export function placeCamera(
  camera: THREE.PerspectiveCamera,
  shot: ShotSpec,
  distance: number,
  out = new THREE.Vector3(),
) {
  const az = (shot.azimuthDeg * Math.PI) / 180
  const el = (shot.elevationDeg * Math.PI) / 180
  out
    .set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az))
    .multiplyScalar(distance)
    .add(shot.target)
  camera.position.copy(out)
  camera.up.set(0, 1, 0)
  camera.lookAt(shot.target)
  return out
}

/** Smoothly chase a shot. Critically damped, frame-rate independent. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  private target = new THREE.Vector3()
  private az = 0
  private el = 40
  private dist = 1
  private started = false

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
  }

  update(shot: ShotSpec, pts: THREE.Vector3[], dt: number) {
    const wantDist = fitDistance(this.camera, shot, pts)
    if (!this.started) {
      this.started = true
      this.target.copy(shot.target)
      this.az = shot.azimuthDeg
      this.el = shot.elevationDeg
      this.dist = wantDist
    } else {
      const k = 1 - Math.exp(-dt * 4.2)
      this.target.lerp(shot.target, k)
      this.az += (shot.azimuthDeg - this.az) * k
      this.el += (shot.elevationDeg - this.el) * k
      this.dist += (wantDist - this.dist) * k
    }
    placeCamera(
      this.camera,
      { target: this.target, azimuthDeg: this.az, elevationDeg: this.el, pad: 0 },
      this.dist,
    )
  }

  snap() {
    this.started = false
  }
}
