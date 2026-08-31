/**
 * tool.ts — the parting saw.
 *
 * A stiff-backed hand saw standing in the cut plane.  The child's finger goes
 * on the big wooden grip at the outboard end, 20 cm of radius away from where
 * the wood is opening, and the drag is constrained to the feed axis, so there
 * is no thin line to trace: grab the grip and push.
 *
 * There is deliberately no bench gantry over the work.  An overhead rail is
 * the obvious way to "support" a guided tool, but whatever height it is put
 * at, it ends up lying across the finished blank at the very moment the child
 * is meant to be reading it.  Once the wedge is parted the saw is drawn back
 * and then laid down flat on the bench, out of the way, as a person would.
 */

import * as THREE from 'three'
import { KERF } from '../core/profile'
import { BLADE_BOTTOM, BLADE_TOP, HANDLE_Y, SAW_LEAD } from '../core/layout'
import { THETA1 } from '../core/blank'
import { box } from './geom'

/** Where the saw ends up when it is put down: flat on the bench, behind and
 *  to the left of the work, clear of the ring and of the receiving table. */
const STOW_POS = new THREE.Vector3(-0.115, 0.013, -0.30)
const USE_QUAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, THETA1, 0))
const STOW_QUAT = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(Math.PI / 2, -2.05, 0, 'YXZ'),
)
const ORIGIN = new THREE.Vector3()

export class Saw {
  readonly root = new THREE.Group()
  readonly carriage = new THREE.Group()
  readonly handle: THREE.Mesh
  readonly grab: THREE.Mesh
  private disposables: Array<{ dispose(): void }> = []

  constructor() {
    this.root.quaternion.copy(USE_QUAT)
    const keep = <T extends { dispose(): void }>(x: T) => (this.disposables.push(x), x)

    const steel = keep(
      new THREE.MeshStandardMaterial({ color: 0xb0b5ba, roughness: 0.30, metalness: 0.93 }),
    )
    const brass = keep(
      new THREE.MeshStandardMaterial({ color: 0x9a8250, roughness: 0.38, metalness: 0.88 }),
    )
    const wood = keep(
      new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.58, metalness: 0 }),
    )

    // ---- blade: exactly as thick as the kerf it leaves behind --------------
    const h = BLADE_TOP - BLADE_BOTTOM
    const blade = new THREE.Mesh(
      keep(box(SAW_LEAD, h, KERF, -SAW_LEAD / 2, (BLADE_TOP + BLADE_BOTTOM) / 2, 0)),
      steel,
    )
    blade.castShadow = true
    // stiffened back, the way a tenon saw is made
    const back = new THREE.Mesh(
      keep(box(SAW_LEAD * 0.99, 0.011, KERF * 3.4, -SAW_LEAD / 2, BLADE_TOP + 0.005, 0)),
      brass,
    )
    back.castShadow = true

    // ---- grip, outboard, well clear of the ring ----------------------------
    // A closed grip, so it reads as a saw handle at a glance and gives the
    // finger something obviously grabbable.
    const grip = new THREE.Group()
    grip.position.set(0.040, HANDLE_Y, 0)
    const loop = new THREE.Mesh(
      keep(new THREE.TorusGeometry(0.030, 0.0115, 10, 26)),
      wood,
    )
    loop.scale.set(1.0, 1.28, 0.62)
    const cheek = new THREE.Mesh(keep(box(0.030, 0.024, 0.021, 0.016, 0.030, 0)), wood)
    const horn = new THREE.Mesh(keep(new THREE.SphereGeometry(0.014, 16, 12)), wood)
    horn.position.set(-0.020, 0.045, 0)
    horn.scale.set(1.5, 0.9, 0.9)
    const shoulder = new THREE.Mesh(keep(box(0.042, 0.026, 0.021, -0.044, -0.014, 0)), wood)
    const bolt = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.0048, 0.0048, 0.024, 10)), brass)
    bolt.rotation.x = Math.PI / 2
    bolt.position.set(-0.036, -0.014, 0)
    for (const m of [loop, cheek, horn, shoulder]) m.castShadow = true
    grip.add(loop, cheek, horn, shoulder, bolt)

    this.handle = loop
    this.grab = new THREE.Mesh(
      keep(new THREE.SphereGeometry(0.078, 8, 6)),
      keep(new THREE.MeshBasicMaterial({ visible: false })),
    )
    this.grab.position.copy(grip.position)

    this.carriage.add(blade, back, grip, this.grab)
    this.root.add(this.carriage)
  }

  /** carriageR: radius of the blade's outboard end. The cutting edge sits
   *  SAW_LEAD inboard of it. stow: 0 = in the cut, 1 = laid on the bench. */
  setPose(carriageR: number, stow: number) {
    this.carriage.position.x = carriageR
    this.root.quaternion.slerpQuaternions(USE_QUAT, STOW_QUAT, stow)
    this.root.position.lerpVectors(ORIGIN, STOW_POS, stow)
  }

  handleWorld(target = new THREE.Vector3()) {
    return this.grab.getWorldPosition(target)
  }

  dispose() {
    for (const d of this.disposables) d.dispose()
  }
}
