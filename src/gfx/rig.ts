import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3 } from 'three'
import { Ribbon } from './ribbon'
import { hookMaterial, srgb } from './shaderlib'
import type { World } from '../world'

const MAIN_NODES = 52
const ROD_NODES = 6
/** three simplified droppers above the sinker */
export const BRANCH_UP = [0.0, 0.135, 0.27]

export class Rig {
  group = new Group()
  main = new Ribbon(MAIN_NODES, 0.00016, [0.42, 0.44, 0.43], 1.05)
  branches: Ribbon[] = []
  private baits: Group[] = []
  private weight: Mesh
  private pts: Vector3[] = []

  constructor() {
    for (let i = 0; i < MAIN_NODES; i++) this.pts.push(new Vector3())
    this.group.add(this.main.mesh)

    const baitBody = new SphereGeometry(0.0075, 10, 8)
    const baitMat = hookMaterial(new MeshStandardMaterial({ color: srgb(0xdfd3bd), roughness: 0.44, metalness: 0 }), {
      underwater: true,
    })
    const tipMat = hookMaterial(new MeshStandardMaterial({ color: srgb(0x8d3a34), roughness: 0.5, metalness: 0 }), {
      underwater: true,
    })
    const hookMat = hookMaterial(new MeshStandardMaterial({ color: srgb(0x2a2a2c), roughness: 0.35, metalness: 0.9 }), {
      underwater: true,
    })
    for (let i = 0; i < 3; i++) {
      const g = new Group()
      const body = new Mesh(baitBody, baitMat)
      body.scale.set(0.85, 0.85, 1.9)
      body.castShadow = true
      g.add(body)
      const tip = new Mesh(new SphereGeometry(0.0042, 8, 6), tipMat)
      tip.position.set(0, 0, 0.0125)
      g.add(tip)
      const hook = new Mesh(new TorusGeometry(0.0042, 0.00045, 4, 10, Math.PI * 1.5), hookMat)
      hook.position.set(0, 0.004, -0.006)
      hook.rotation.set(Math.PI / 2, 0, 0.5)
      g.add(hook)
      this.baits.push(g)
      this.group.add(g)
      const br = new Ribbon(6, 0.00013, [0.4, 0.42, 0.41], 0.95)
      this.branches.push(br)
      this.group.add(br.mesh)
    }

    const leadMat = hookMaterial(
      new MeshStandardMaterial({ color: srgb(0x54565a), roughness: 0.62, metalness: 0.55 }),
      { underwater: true }
    )
    this.weight = new Mesh(new CylinderGeometry(0.0092, 0.0062, 0.034, 12), leadMat)
    this.weight.castShadow = true
    this.group.add(this.weight)
  }

  setPixelScale(v: number) {
    this.main.setPixelScale(v)
    for (const b of this.branches) b.setPixelScale(v)
  }

  /** the whole filament, from spool to sinker, driven only by world state */
  update(w: World, spool: Vector3, guides: Vector3[], tip: Vector3) {
    const bait = w.lurePosition
    const weightY = bait.y - 0.115
    const slack = 1 - w.lineTension
    const wavePos = w.tensionPulse >= 0 ? (w.tensionPulse - 0.05) * 6 : -99
    const amp = w.tensionPulseAmp

    this.pts[0].copy(spool)
    for (let i = 0; i < 4; i++) this.pts[1 + i].copy(guides[i])
    this.pts[5].copy(tip)

    const below = MAIN_NODES - ROD_NODES
    const topY = tip.y
    for (let i = 0; i < below; i++) {
      const t = i / (below - 1)
      const p = this.pts[ROD_NODES + i]
      const y = topY + (weightY - topY) * t
      // the rig hangs under the tip; a little drift while slack, straight under load
      const distUp = y - weightY
      const wave = amp * 0.0135 * Math.exp(-Math.pow((distUp - wavePos) / 0.2, 2))
      const drift = 0.0075 * slack * Math.sin(y * 2.3 + w.time * 0.8) * Math.min(1, t * 3)
      const lead = Math.min(1, Math.max(0, (y - 0) / -1)) // 0 above water
      const x = tip.x + (bait.x - tip.x) * t + drift * (y < 0 ? 1 : 0.2) + wave
      const z = tip.z + (bait.z - tip.z) * t + drift * 0.4 * lead
      p.set(x, y, z)
    }
    this.main.setPoints(this.pts)

    const axis = this.pts[MAIN_NODES - 1]
    for (let i = 0; i < 3; i++) {
      const y = weightY + 0.115 + BRANCH_UP[i]
      const t = (y - weightY) / (topY - weightY)
      const bx = tip.x + (bait.x - tip.x) * t
      const bz = tip.z + (bait.z - tip.z) * t
      const swing = Math.sin(w.time * (0.9 + i * 0.23) + i * 2.1) * 0.012 * (0.35 + slack)
      const kick = i === 0 && w.fishContact > 0.01 ? w.fishContact * 0.02 : 0
      const ex = bx + 0.043 + swing + kick
      const ez = bz + swing * 0.6
      const ey = y - 0.016 - Math.abs(swing) * 0.4 - kick * 0.5
      const pts: Vector3[] = []
      for (let k = 0; k < 6; k++) {
        const s = k / 5
        pts.push(new Vector3(bx + (ex - bx) * s, y + (ey - y) * s - Math.sin(s * Math.PI) * 0.004, bz + (ez - bz) * s))
      }
      this.branches[i].setPoints(pts)
      this.baits[i].position.set(ex, ey, ez)
      this.baits[i].rotation.set(0.3 + swing * 6, 0.7 + i, swing * 3)
    }

    this.weight.position.set(axis.x, weightY + 0.017, axis.z)
    this.weight.rotation.z = (axis.x - tip.x) * 0.4
  }

  /** world position of the bait a fish actually goes for */
  targetBait(out: Vector3) {
    return out.copy(this.baits[0].position)
  }
}
