/**
 * overlay.ts — development diagnostics. Never shown during normal play.
 *
 *   ?debug=1   numbers + the profile outline, the cut boundary and the
 *              wedge's home position drawn as wireframes
 *   ?orbit=1   free camera, for checking the sides and the back
 *   ?plain=1   bare turntable: ring, wedge, no workshop
 */

import * as THREE from 'three'
import { lambProfile } from '../core/profile'
import { THETA0, THETA1, buildPieceBulk, buildPieceCollar } from '../core/blank'
import { JIG_TOP } from '../core/layout'

export function makeDiagnostics() {
  const g = new THREE.Group()
  g.visible = false
  g.position.y = JIG_TOP

  const poly = lambProfile()
  const outline = (theta: number, color: number) => {
    const pts: THREE.Vector3[] = []
    for (const p of poly.concat([poly[0]])) {
      pts.push(new THREE.Vector3(p.x * Math.cos(theta), p.y, p.x * Math.sin(theta)))
    }
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, depthTest: false }),
    )
  }
  g.add(outline(THETA0, 0x49d1ff), outline(THETA1, 0xff6a4d))

  // the wedge's home position, as a wireframe that never moves
  const home = new THREE.Group()
  for (const m of [buildPieceBulk(), buildPieceCollar(0)]) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3))
    geo.setIndex(new THREE.BufferAttribute(m.index, 1))
    home.add(
      new THREE.LineSegments(
        new THREE.WireframeGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0x8bff9a, transparent: true, opacity: 0.28 }),
      ),
    )
  }
  g.add(home)

  return g
}

export class DiagText {
  private el = document.getElementById('diag') as HTMLDivElement
  enabled = false
  private acc = 0
  private frames = 0
  fps = 0
  worstFrame = 0

  show(on: boolean) {
    this.enabled = on
    this.el.style.display = on ? 'block' : 'none'
  }

  frame(dt: number) {
    this.acc += dt
    this.frames++
    this.worstFrame = Math.max(this.worstFrame, dt)
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc
      this.acc = 0
      this.frames = 0
    }
  }

  set(lines: string[]) {
    if (this.enabled) this.el.textContent = lines.join('\n')
  }
}
