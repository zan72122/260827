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
      new THREE.MeshStandardMaterial({ color: 0x70757b, roughness: 0.48, metalness: 0.85 }),
    )
    const wood = keep(
      new THREE.MeshStandardMaterial({ color: 0x92643b, roughness: 0.62, metalness: 0 }),
    )

    // ---- rail, entirely outboard of the ring --------------------------------
    const railLen = SAW_RAIL_R1 - SAW_RAIL_R0
    const rail = new THREE.Mesh(
      keep(box(railLen, 0.014, 0.014, (SAW_RAIL_R0 + SAW_RAIL_R1) / 2, SAW_RAIL_Y, SAW_RAIL_SIDE)),
      steel,
    )
    rail.castShadow = true
    this.root.add(rail)
    const postGeo = keep(new THREE.CylinderGeometry(0.0085, 0.011, SAW_RAIL_Y, 12))
    for (const r of [SAW_RAIL_R0 + 0.022, SAW_RAIL_R1 - 0.012]) {
      const p = new THREE.Mesh(postGeo, dark)
      p.position.set(r, SAW_RAIL_Y / 2, SAW_RAIL_SIDE)
      p.castShadow = true
      this.root.add(p)
    }

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

    this.handle = new THREE.Mesh(keep(new THREE.SphereGeometry(0.024, 20, 14)), wood)
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

    this.carriage.add(blade, spine, post, arm, block, neck, this.handle, this.grab)
    this.root.add(this.carriage)
  }

  setCarriage(carriageR: number) {
    this.carriage.position.x = carriageR
  }

  handleWorld(target = new THREE.Vector3()) {
    return this.handle.getWorldPosition(target)
  }

  dispose() {
    for (const d of this.disposables) d.dispose()
  }
}
