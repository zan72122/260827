import * as THREE from 'three'
import { PAPER_COLORS, type PaperColor } from '../state/store'

/** 二回目以降に選べる紙見本。新しい収集要素は作らない。 */
export class Swatches {
  readonly group = new THREE.Group()
  readonly tiles: THREE.Mesh[] = []
  private readonly mats: THREE.MeshStandardMaterial[] = []
  private readonly geo: THREE.BufferGeometry

  constructor() {
    this.geo = new THREE.BoxGeometry(0.052, 0.0022, 0.052)
    PAPER_COLORS.forEach((c, i) => {
      const m = new THREE.MeshStandardMaterial({ color: c.hex, roughness: 0.9, metalness: 0 })
      this.mats.push(m)
      const t = new THREE.Mesh(this.geo, m)
      t.position.set(0.115 - i * 0.056, 0.0012, -0.1)
      t.rotation.y = -0.24 + i * 0.05
      t.receiveShadow = true
      t.castShadow = true
      t.userData.colorIndex = i as PaperColor
      this.tiles.push(t)
      this.group.add(t)
    })
    this.group.visible = false
  }

  setSelected(i: PaperColor): void {
    this.tiles.forEach((t, k) => {
      t.position.y = k === i ? 0.004 : 0.0012
    })
  }

  dispose(): void {
    this.geo.dispose()
    for (const m of this.mats) m.dispose()
  }
}
