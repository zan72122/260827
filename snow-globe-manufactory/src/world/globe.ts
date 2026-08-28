import * as THREE from 'three'
import { Glass } from './glass'
import { Liquid } from './liquid'
import { PourFx, SnowSystem } from './snow'
import { Town } from './town'
import type { MatKit } from './materials'
import { GROUND_Y, MOUTH_Y, PLOT_R, R_OUT } from './dims'
import type { Quality } from '../core/quality'

/**
 * Binds the glass, the liquid, the snow and the town into one object with a
 * single set of handles: how far the plug is lifted, how deep the gasket is
 * seated, how far the collar is turned, and how far through its 180 degree
 * turn the whole assembly is. Everything downstream just moves those numbers.
 */

export class GlobeRig {
  /** World placement of the globe. */
  readonly root = new THREE.Group()
  /** Turns 180 degrees between the filling posture and the finished one. */
  readonly assembly = new THREE.Group()
  /** Things that must stay level with gravity, so they live outside the flip. */
  readonly worldFx = new THREE.Group()

  readonly glass: Glass
  readonly town: Town
  readonly liquid: Liquid
  readonly snow: SnowSystem
  readonly pour: PourFx

  /** 0 = mouth up for filling, 1 = finished and upright. */
  flip = 1
  /** How far the plug hovers clear of the mouth, in metres. */
  plateLift = 0
  /** 0..1 gasket compression. */
  gasketSeat = 0
  /** 0..1 collar tightened. */
  collarTurn = 0
  /** Small handling tilt, radians, applied above the flip. */
  tilt = new THREE.Vector2()
  /** Fired when a bubble reaches the surface, so the audio can answer it. */
  onBubblePop: (() => void) | null = null

  private worldQuat = new THREE.Quaternion()
  private invQuat = new THREE.Quaternion()
  private plane = new THREE.Plane()
  private sphere = new THREE.Sphere()
  private up = new THREE.Vector3()
  private center = new THREE.Vector3()
  private localUp = new THREE.Vector3()
  private tmp = new THREE.Vector3()

  constructor(mats: MatKit, quality: Quality, seed: number) {
    this.glass = new Glass({ backPass: quality.glassBackPass })
    this.town = new Town(mats, seed)
    this.liquid = new Liquid(quality.bubbleCount, quality.liquidBackFace)
    this.snow = new SnowSystem(quality.snowCount)
    this.pour = new PourFx(quality.pourCount)

    this.snow.setHeightField(this.town.field)

    this.assembly.add(this.glass.group)
    this.assembly.add(this.town.plate)
    this.assembly.add(this.liquid.volume)
    this.assembly.add(this.snow.points)
    this.root.add(this.assembly)

    this.worldFx.add(this.liquid.surface, this.liquid.bubbles, this.pour.points)
  }

  /** World-space centre of the glass sphere. */
  get centerWorld(): THREE.Vector3 {
    return this.center
  }

  get orientation(): THREE.Quaternion {
    return this.worldQuat
  }

  /** Converts a world point into the assembly's local frame. */
  toLocal(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(p).applyMatrix4(this.tmpInverse())
  }

  private inv = new THREE.Matrix4()
  private tmpInverse(): THREE.Matrix4 {
    return this.inv.copy(this.assembly.matrixWorld).invert()
  }

  /** Rotates a world-space direction into the assembly's local frame. */
  toLocalDirection(dir: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(dir).applyQuaternion(this.invQuat.copy(this.worldQuat).invert())
  }

  /** Local point on the ground plane under a world ray, if it hits. */
  groundHit(ray: THREE.Ray, out: THREE.Vector3): boolean {
    this.plane.set(this.up.set(0, 1, 0), -GROUND_Y).applyMatrix4(this.assembly.matrixWorld)
    const hit = ray.intersectPlane(this.plane, this.tmp)
    if (!hit) return false
    this.toLocal(hit, out)
    return Math.hypot(out.x, out.z) < PLOT_R * 1.7
  }

  /** True when a world ray meets the glass shell. */
  glassHit(ray: THREE.Ray): boolean {
    return ray.intersectsSphere(this.sphere.set(this.center, R_OUT))
  }

  applyTransforms() {
    this.root.rotation.set(this.tilt.x, 0, this.tilt.y)
    this.assembly.rotation.set(0, 0, Math.PI * (1 - this.flip))
    this.town.plate.position.y = -this.plateLift
    this.town.gasket.scale.set(1 + this.gasketSeat * 0.1, 1 - this.gasketSeat * 0.45, 1 + this.gasketSeat * 0.1)
    this.town.collar.rotation.y = -this.collarTurn * 2.6
    this.town.collar.position.y = MOUTH_Y - 0.006 + this.collarTurn * 0.014

    this.root.updateMatrixWorld(true)
    this.assembly.getWorldQuaternion(this.worldQuat)
    this.assembly.getWorldPosition(this.center)
    this.localUp.set(0, 1, 0).applyQuaternion(this.worldQuat)
  }

  update(dt: number, submerged: number) {
    this.applyTransforms()
    this.liquid.setCenter(this.center)
    this.liquid.setOrientation(this.worldQuat)
    this.liquid.update(dt, true, this.onBubblePop ?? undefined)
    this.snow.update(dt, this.worldQuat, submerged)
    this.pour.update(dt)
    this.town.setSnowAccumulation(this.snow.accumulation)
  }

  /** Local point just inside the mouth, where poured material enters. */
  mouthEntry(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, MOUTH_Y + 0.06, 0)
  }

  setPointScale(px: number) {
    this.snow.setPointScale(px)
    this.pour.setPointScale(px)
    this.liquid.setPointScale(px)
  }

  dispose() {
    this.glass.dispose()
    this.town.dispose()
    this.liquid.dispose()
    this.snow.dispose()
    this.pour.dispose()
    this.assembly.clear()
    this.root.clear()
    this.worldFx.clear()
  }
}
