import * as THREE from 'three'

interface Framing {
  pos: THREE.Vector3
  target: THREE.Vector3
  fov: number
}

const f = (px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov: number): Framing => ({
  pos: new THREE.Vector3(px, py, pz),
  target: new THREE.Vector3(tx, ty, tz),
  fov,
})

/**
 * 作業カメラ。通常プレイでは自由回転しない斜め俯瞰の固定カメラで、
 * 端台紙と複数のセルが同時に見える位置に置く。
 * 縦画面では高さと手前の操作帯、横画面では開いた厚みと束の側面を使って組み直す。
 * 画面の切り替えはカットせず、短く連続して動かす。
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  private readonly target = new THREE.Vector3()
  private want: Framing
  private wantTarget = new THREE.Vector3()
  private portrait = true
  private pulled = false
  private first = true

  constructor() {
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 14)
    this.want = this.framing()
    this.camera.position.copy(this.want.pos)
    this.target.copy(this.want.target)
    this.wantTarget.copy(this.want.target)
    this.camera.lookAt(this.target)
  }

  private framing(): Framing {
    const base = this.portrait
      ? f(0.275, 0.455, -0.705, 0, 0.126, 0.02, 37)
      : f(0.330, 0.345, -0.545, 0.012, 0.098, 0.035, 33)
    if (this.pulled) {
      // 留めたあとにだけ少し引く。完成したツリーと元の平たい材料を同じ机の上で見せる。
      const back = this.portrait ? 1.32 : 1.15
      base.pos.multiplyScalar(back)
      base.pos.x -= this.portrait ? 0.05 : 0.02
      base.target.x -= this.portrait ? 0.055 : 0.045
      base.target.y += 0.012
    }
    return base
  }

  setViewport(w: number, h: number): void {
    const portrait = h >= w
    if (portrait !== this.portrait || this.first) {
      this.portrait = portrait
      this.want = this.framing()
      this.wantTarget.copy(this.want.target)
    }
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  setPulledBack(v: boolean): void {
    if (v === this.pulled) return
    this.pulled = v
    this.want = this.framing()
    this.wantTarget.copy(this.want.target)
  }

  update(dt: number): void {
    const k = this.first ? 1 : 1 - Math.exp(-dt / 0.42)
    this.first = false
    this.camera.position.lerp(this.want.pos, k)
    this.target.lerp(this.wantTarget, k)
    this.camera.fov += (this.want.fov - this.camera.fov) * k
    this.camera.updateProjectionMatrix()
    this.camera.lookAt(this.target)
  }

  /** 開発用の視点確認（通常プレイでは使わない） */
  snapTo(pos: THREE.Vector3, target: THREE.Vector3): void {
    this.camera.position.copy(pos)
    this.target.copy(target)
    this.wantTarget.copy(target)
    this.want = { pos: pos.clone(), target: target.clone(), fov: this.camera.fov }
    this.camera.lookAt(target)
  }
}
