/**
 * workshop.ts — a small Christmas-toy workshop: bench in front, the work in
 * the middle, crates and a few turned blanks behind.  Nothing here is a prop
 * for its own sake; every object is something the bench would actually hold.
 */

import * as THREE from 'three'
import { R_INNER, R_OUTER } from '../core/profile'
import { RING_TOP, SUPPORT_TOP, TRAY_HALF_DEG, TRAY_R0, TRAY_R1, TRAY_TOP } from '../core/layout'
import { THETA1 } from '../core/blank'
import { annularSector, box } from './geom'

const BENCH_X0 = -0.78
const BENCH_X1 = 0.70
const BENCH_Z0 = -0.66
const BENCH_Z1 = 0.66

export type Workshop = {
  root: THREE.Group
  /** Everything except the jig, the tray and the ground shadow catcher. */
  scenery: THREE.Group
  dispose(): void
}

export function makeWorkshop(): Workshop {
  const root = new THREE.Group()
  const scenery = new THREE.Group()
  const disposables: Array<{ dispose(): void }> = []
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x)

  const benchMat = keep(
    new THREE.MeshStandardMaterial({ color: 0xa38260, roughness: 0.80, metalness: 0 }),
  )
  const benchDark = keep(
    new THREE.MeshStandardMaterial({ color: 0x7d6142, roughness: 0.85, metalness: 0 }),
  )
  const steel = keep(
    new THREE.MeshStandardMaterial({ color: 0x8e949a, roughness: 0.38, metalness: 0.9 }),
  )
  const crateMat = keep(
    new THREE.MeshStandardMaterial({ color: 0x8d7150, roughness: 0.92, metalness: 0 }),
  )

  // ---- bench --------------------------------------------------------------
  const topGeo = keep(
    box(
      BENCH_X1 - BENCH_X0,
      0.048,
      BENCH_Z1 - BENCH_Z0,
      (BENCH_X0 + BENCH_X1) / 2,
      -0.024,
      (BENCH_Z0 + BENCH_Z1) / 2,
    ),
  )
  const bench = new THREE.Mesh(topGeo, benchMat)
  bench.receiveShadow = true
  root.add(bench)

  // plank seams, so the top does not read as one plastic slab
  for (const z of [-0.40, -0.14, 0.14, 0.40]) {
    const seam = new THREE.Mesh(
      keep(box(BENCH_X1 - BENCH_X0, 0.0035, 0.004, (BENCH_X0 + BENCH_X1) / 2, -0.0012, z)),
      benchDark,
    )
    root.add(seam)
  }
  const apron = new THREE.Mesh(
    keep(box(0.03, 0.11, BENCH_Z1 - BENCH_Z0, BENCH_X1 - 0.015, -0.075, (BENCH_Z0 + BENCH_Z1) / 2)),
    benchDark,
  )
  apron.receiveShadow = true
  root.add(apron)

  // ---- jig: a slotted plate the ring is clamped to ------------------------
  // The slot is the saw's relief cut, so the blade can pass fully through.
  const slotHalf = 0.004 / R_INNER
  const jig = new THREE.Mesh(
    keep(
      annularSector(
        R_INNER - 0.016,
        R_OUTER + 0.014,
        THETA1 + slotHalf,
        THETA1 + Math.PI * 2 - slotHalf,
        0,
        SUPPORT_TOP,
        128,
      ),
    ),
    benchDark,
  )
  jig.receiveShadow = true
  jig.castShadow = true
  root.add(jig)

  // ---- hold-down clamps ---------------------------------------------------
  // Placed well away from the wedge being taken out, so the ring stays put
  // while the wedge alone moves.
  for (const deg of [104, 180, 256]) {
    const t = (deg * Math.PI) / 180
    const g = new THREE.Group()
    g.rotation.y = t
    const post = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(0.0085, 0.010, 0.115, 14)),
      steel,
    )
    post.position.set(R_OUTER + 0.030, 0.0575, 0)
    post.castShadow = true
    const arm = new THREE.Mesh(keep(box(0.098, 0.008, 0.014, 0, 0, 0)), steel)
    arm.position.set(R_OUTER + 0.030 - 0.049, 0.104, 0)
    arm.castShadow = true
    const pad = new THREE.Mesh(keep(box(0.024, 0.016, 0.020, 0, 0, 0)), benchMat)
    pad.position.set(R_OUTER - 0.052, RING_TOP + 0.0015, 0)
    pad.castShadow = true
    const screw = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.004, 0.004, 0.026, 10)), steel)
    screw.position.set(R_OUTER - 0.052, RING_TOP + 0.014, 0)
    g.add(post, arm, pad, screw)
    root.add(g)
  }

  // ---- receiving table ----------------------------------------------------
  const trayHalf = (TRAY_HALF_DEG * Math.PI) / 180
  const trayMat = keep(
    new THREE.MeshStandardMaterial({ color: 0xb99a72, roughness: 0.74, metalness: 0 }),
  )
  const tray = new THREE.Mesh(
    keep(annularSector(TRAY_R0, TRAY_R1, -trayHalf, trayHalf, 0, TRAY_TOP, 96)),
    trayMat,
  )
  tray.receiveShadow = true
  tray.castShadow = true
  root.add(tray)
  const lip = new THREE.Mesh(
    keep(annularSector(TRAY_R1 - 0.012, TRAY_R1, -trayHalf, trayHalf, TRAY_TOP, TRAY_TOP + 0.012, 64)),
    benchDark,
  )
  lip.castShadow = true
  lip.receiveShadow = true
  root.add(lip)

  // ---- scenery: crates, shavings, a few turned blanks ---------------------
  const propWood = keep(
    new THREE.MeshStandardMaterial({ color: 0xc0a071, roughness: 0.88, metalness: 0 }),
  )

  const crate = (x: number, z: number, w: number, h: number, d: number, ry: number) => {
    const g = new THREE.Group()
    g.position.set(x, h / 2, z)
    g.rotation.y = ry
    const body = new THREE.Mesh(keep(box(w, h, d)), crateMat)
    body.castShadow = true
    body.receiveShadow = true
    g.add(body)
    for (const sy of [-h / 2 + 0.012, h / 2 - 0.012]) {
      const band = new THREE.Mesh(keep(box(w + 0.004, 0.012, d + 0.004, 0, sy, 0)), benchDark)
      g.add(band)
    }
    scenery.add(g)
  }
  crate(-0.60, -0.50, 0.24, 0.16, 0.19, 0.16)
  crate(-0.33, -0.56, 0.18, 0.115, 0.16, -0.30)
  crate(-0.70, -0.24, 0.16, 0.095, 0.14, 0.52)

  // a short stack of turned ring blanks waiting their turn, lying flat
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(
      keep(new THREE.TorusGeometry(0.085, 0.014, 8, 44)),
      propWood,
    )
    r.position.set(-0.40 + i * 0.006, 0.014 + i * 0.026, -0.34 + i * 0.004)
    r.rotation.set(Math.PI / 2, 0, 0.1 * i)
    r.scale.set(1, 1, 0.9)
    r.castShadow = true
    r.receiveShadow = true
    scenery.add(r)
  }

  // a shallow tub of shavings
  const tub = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(0.085, 0.075, 0.055, 22, 1, true)),
    crateMat,
  )
  tub.position.set(0.34, 0.0275, -0.44)
  tub.castShadow = true
  tub.receiveShadow = true
  tub.material = crateMat
  scenery.add(tub)
  const shav = new THREE.Mesh(
    keep(new THREE.SphereGeometry(0.078, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.6)),
    keep(new THREE.MeshStandardMaterial({ color: 0xcfae7c, roughness: 0.95 })),
  )
  shav.position.set(0.34, 0.040, -0.44)
  shav.scale.set(1, 0.42, 1)
  shav.castShadow = true
  scenery.add(shav)

  // a chisel and a rule lying on the bench, out of the way
  const chisel = new THREE.Group()
  chisel.position.set(0.16, 0.008, 0.50)
  chisel.rotation.y = -0.42
  const cb = new THREE.Mesh(keep(box(0.13, 0.006, 0.014)), steel)
  const ch = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.011, 0.014, 0.09, 14)), benchDark)
  ch.rotation.z = Math.PI / 2
  ch.position.x = -0.105
  cb.castShadow = true
  ch.castShadow = true
  chisel.add(cb, ch)
  scenery.add(chisel)

  // ---- room ---------------------------------------------------------------
  const roomMat = keep(
    new THREE.MeshStandardMaterial({ color: 0x5d4a37, roughness: 0.95, metalness: 0 }),
  )
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(7, 7)), roomMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.80
  scenery.add(floor)
  const wallA = new THREE.Mesh(keep(new THREE.PlaneGeometry(7, 4)), roomMat)
  wallA.position.set(0, 1.1, -1.35)
  scenery.add(wallA)
  const wallB = new THREE.Mesh(keep(new THREE.PlaneGeometry(7, 4)), roomMat)
  wallB.rotation.y = Math.PI / 2
  wallB.position.set(-1.5, 1.1, 0)
  scenery.add(wallB)

  // the window that lights the bench, seen edge-on behind the work
  const winMat = keep(new THREE.MeshBasicMaterial({ color: 0xcdc7b6 }))
  const win = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.10, 0.86)), winMat)
  win.position.set(-1.49, 0.66, -0.30)
  win.rotation.y = Math.PI / 2
  scenery.add(win)
  const barMat = keep(new THREE.MeshStandardMaterial({ color: 0x35291e, roughness: 0.92 }))
  scenery.add(new THREE.Mesh(keep(box(0.012, 0.90, 0.016, -1.484, 0.66, -0.30)), barMat))
  scenery.add(new THREE.Mesh(keep(box(0.012, 0.016, 1.14, -1.484, 0.66, -0.30)), barMat))
  scenery.add(
    new THREE.Mesh(
      keep(box(0.026, 0.98, 1.22, -1.476, 0.66, -0.30)),
      keep(new THREE.MeshStandardMaterial({ color: 0x4b3a2a, roughness: 0.9 })),
    ),
  )

  root.add(scenery)

  return {
    root,
    scenery,
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}
