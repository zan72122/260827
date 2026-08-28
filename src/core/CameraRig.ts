import * as THREE from 'three'

export interface ShotView {
  pos: THREE.Vector3
  target: THREE.Vector3
  fov: number
}

/**
 * Camera chain. Shots are described as a position/target/fov the game
 * recomputes every frame (so a shot can follow the rig), and the rig
 * eases toward it. Moves, not cuts: the child keeps the thread from the
 * bucket to the water to the shoal.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  private curPos = new THREE.Vector3()
  private curTarget = new THREE.Vector3()
  private curFov = 45
  private rate = 2.0

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.02, 1400)
    this.curPos.set(6, 3, 7)
    this.curTarget.set(0, 0, -6)
  }

  setRate(r: number) { this.rate = r }

  snapTo(view: ShotView) {
    this.curPos.copy(view.pos)
    this.curTarget.copy(view.target)
    this.curFov = view.fov
    this.apply()
  }

  update(dt: number, view: ShotView) {
    const k = 1 - Math.exp(-this.rate * dt)
    this.curPos.lerp(view.pos, k)
    this.curTarget.lerp(view.target, k)
    this.curFov += (view.fov - this.curFov) * k
    this.apply()
  }

  private apply() {
    this.camera.position.copy(this.curPos)
    this.camera.lookAt(this.curTarget)
    if (Math.abs(this.camera.fov - this.curFov) > 0.001) {
      this.camera.fov = this.curFov
      this.camera.updateProjectionMatrix()
    }
  }

  get position() { return this.curPos }

  resize(aspect: number) {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }
}
