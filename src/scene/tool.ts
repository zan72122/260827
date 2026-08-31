/**
 * tool.ts — the guided parting saw.
 *
 * A straight blade standing in the cut plane, hung from an arm that rides a
 * rail set to one side of the work.  The child's finger goes on the big wooden
 * knob at the outboard end — always outside the ring, always well away from
 * the wood that is opening.  The carriage can only travel along the rail, so
 * there is no thin line to trace: grab the knob and push.
 */

import * as THREE from 'three'
import { KERF } from '../core/profile'
import {
  BLADE_BOTTOM,
  BLADE_TOP,
  HANDLE_Y,
  SAW_LEAD,
  SAW_RAIL_R0,
  SAW_RAIL_R1,
  SAW_RAIL_SIDE,
  SAW_RAIL_Y,
} from '../core/layout'
import { THETA1 } from '../core/blank'
import { box } from './geom'

export class Saw {
  readonly root = new THREE.Group()
  readonly carriage = new THREE.Group()
  /** The hinged part: blade, its post and the arm. Swings up clear of the
   *  work once the cut is finished, the way you would flip a saw out of a
   *  kerf before lifting the piece out. */
  readonly swing = new THREE.Group()
  readonly handle: THREE.Mesh
  readonly grab: THREE.Mesh
  private disposables: Array<{ dispose(): void }> = []

  constructor() {
    this.root.rotation.y = THETA1
    const keep = <T extends { dispose(): void }>(x: T) => (this.disposables.push(x), x)

    const steel = keep(
      new THREE.MeshStandardMaterial({ color: 0xa8adb3, roughness: 0.32, metalness: 0.92 }),
    )
    const dark = keep(
      new THREE.MeshStandardMaterial({ color: 0x5f6469, roughness: 0.55, metalness: 0.8 }),
    )
    const wood = keep(
      new THREE.MeshStandardMaterial({ color: 0x92643b, roughness: 0.62, metalness: 0 }),
    )

    // ---- rail, entirely outboard of the ring --------------------------------
    const railLen = SAW_RAIL_R1 - SAW_RAIL_R0
    const rail = new THREE.Mesh(
      keep(box(railLen, 0.013, 0.013, (SAW_RAIL_R0 + SAW_RAIL_R1) / 2, SAW_RAIL_Y, SAW_RAIL_SIDE)),
      dark,
    )
    rail.castShadow = true
    this.root.add(rail)
    // One post, at the outboard end only: a second one beside the ring would
    // stand straight through the child's view of the work.
    const post0 = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(0.010, 0.013, SAW_RAIL_Y, 12)),
      dark,
    )
    post0.position.set(SAW_RAIL_R1 - 0.014, SAW_RAIL_Y / 2, SAW_RAIL_SIDE)
    post0.castShadow = true
    const base = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(0.030, 0.034, 0.010, 18)),
      dark,
    )
    base.position.set(SAW_RAIL_R1 - 0.014, 0.005, SAW_RAIL_SIDE)
    base.castShadow = true
    const brace = new THREE.Mesh(keep(box(0.115, 0.010, 0.010, 0, 0, 0)), dark)
    brace.position.set(SAW_RAIL_R1 - 0.070, SAW_RAIL_Y - 0.052, SAW_RAIL_SIDE)
    brace.rotation.z = 0.72
    this.root.add(post0, base, brace)

    // ---- the moving part ----------------------------------------------------
    // blade: a plate exactly as thick as the kerf it leaves behind, standing in
    // the cut plane, its inner edge SAW_LEAD inboard of the carriage.
    const bladeH = BLADE_TOP - BLADE_BOTTOM
    const blade = new THREE.Mesh(
      keep(box(SAW_LEAD, bladeH, KERF, -SAW_LEAD / 2, (BLADE_TOP + BLADE_BOTTOM) / 2, 0)),
      steel,
    )
    blade.castShadow = true
    // the stiffened back of the blade
    const spine = new THREE.Mesh(
      keep(box(SAW_LEAD, 0.006, KERF * 3.0, -SAW_LEAD / 2, BLADE_TOP - 0.003, 0)),
      dark,
    )
    // post from the blade up to the arm
    const post = new THREE.Mesh(
      keep(box(0.016, SAW_RAIL_Y - BLADE_TOP + 0.014, 0.010, 0, (SAW_RAIL_Y + BLADE_TOP) / 2, 0)),
      dark,
    )
    post.castShadow = true
    // arm across to the rail
    const arm = new THREE.Mesh(
      keep(box(0.020, 0.012, SAW_RAIL_SIDE, 0, SAW_RAIL_Y, SAW_RAIL_SIDE / 2)),
      dark,
    )
    arm.castShadow = true
    const block = new THREE.Mesh(
      keep(box(0.062, 0.036, 0.044, 0, SAW_RAIL_Y + 0.005, SAW_RAIL_SIDE)),
      wood,
    )
    block.castShadow = true

    this.handle = new THREE.Mesh(keep(new THREE.SphereGeometry(0.021, 20, 14)), wood)
    this.handle.position.set(0, HANDLE_Y, SAW_RAIL_SIDE)
    this.handle.scale.set(1, 0.88, 1)
    this.handle.castShadow = true
    const neck = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.009, 0.012, 0.028, 12)), wood)
    neck.position.set(0, HANDLE_Y - 0.020, SAW_RAIL_SIDE)

    this.grab = new THREE.Mesh(
      keep(new THREE.SphereGeometry(0.070, 8, 6)),
      keep(new THREE.MeshBasicMaterial({ visible: false })),
    )
    this.grab.position.set(0, HANDLE_Y - 0.010, SAW_RAIL_SIDE)

    const inner = new THREE.Group()
    inner.position.set(0, -SAW_RAIL_Y, -SAW_RAIL_SIDE)
    inner.add(blade, spine, post, arm)
    this.swing.position.set(0, SAW_RAIL_Y, SAW_RAIL_SIDE)
    this.swing.add(inner)

    this.carriage.add(this.swing, block, neck, this.handle, this.grab)
    this.root.add(this.carriage)
  }

  setPose(carriageR: number, tilt: number) {
    this.carriage.position.x = carriageR
    this.swing.rotation.x = tilt
  }

  handleWorld(target = new THREE.Vector3()) {
    return this.handle.getWorldPosition(target)
  }

  dispose() {
    for (const d of this.disposables) d.dispose()
  }
}
