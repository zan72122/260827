import * as THREE from 'three'
import { applyUnderwater, WATER_Y } from './Water'

/**
 * Far field: breakwater arm, moored boats, port hardware. Low detail,
 * no shadow casting -- separation comes from sea haze and aerial
 * perspective, not from blurring the background.
 */
export function buildHarbor(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'harbor'
  // far structures are flat-shaded low LOD: at 60-120 m the aggregate in
  // the deck texture would read as boulders
  const conc = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x9d9b91, roughness: 1, metalness: 0 }))
  const conc2 = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x8b8a80, roughness: 1, metalness: 0 }))

  // far quay across the basin: the shed and crane stand on land, not on
  // the water
  const farQuay = new THREE.Mesh(new THREE.BoxGeometry(150, 6, 34), conc2)
  farQuay.position.set(-40, -2.4, -118)
  g.add(farQuay)
  const farFace = new THREE.Mesh(new THREE.BoxGeometry(150, 1.1, 0.6), applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x4b4f43, roughness: 1 })))
  farFace.position.set(-40, WATER_Y + 0.2, -101.1)
  g.add(farFace)
  // the near shore continues to the right of the station
  const rightQuay = new THREE.Mesh(new THREE.BoxGeometry(60, 6, 26), conc)
  rightQuay.position.set(56, -2.6, -22)
  g.add(rightQuay)

  // breakwater arm running across the mouth of the basin
  const bw = new THREE.Mesh(new THREE.BoxGeometry(150, 3.4, 7), conc)
  bw.position.set(-8, WATER_Y + 0.9, -158)
  g.add(bw)
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(150, 1.5, 1.1), conc)
  parapet.position.set(-8, WATER_Y + 3.1, -160.4)
  g.add(parapet)
  // wave dissipating blocks along the seaward toe
  const blockMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x9d9b92, roughness: 1 }))
  const blockGeo = new THREE.BoxGeometry(2.2, 2.2, 2.2)
  const blocks = new THREE.InstancedMesh(blockGeo, blockMat, 90)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const s = new THREE.Vector3()
  for (let i = 0; i < 90; i++) {
    e.set(Math.random() * 1.2, Math.random() * 3.14, Math.random() * 1.2)
    q.setFromEuler(e)
    s.setScalar(0.7 + Math.random() * 0.7)
    m4.compose(new THREE.Vector3(-78 + i * 1.75, WATER_Y - 0.15 + Math.random() * 1.0, -153.4 + Math.random() * 1.8), q, s)
    blocks.setMatrixAt(i, m4)
  }
  blocks.instanceMatrix.needsUpdate = true
  g.add(blocks)

  // navigation beacon at the head of the arm
  const beaconMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0xb04a3a, roughness: 0.8 }))
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.35, 7.5, 12), beaconMat)
  beacon.position.set(60, WATER_Y + 4.4, -158)
  g.add(beacon)
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.1, 10), applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x2f3335, roughness: 0.6, metalness: 0.4 })))
  lamp.position.set(60, WATER_Y + 8.6, -158)
  g.add(lamp)

  // moored working boats along the far quay
  // far field carries no detail maps: at 60 m a paint-flake texture reads
  // as metre-wide blotches
  const hullMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x8d9490, roughness: 0.72, metalness: 0.12 }))
  const cabinMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0xcfc9b8, roughness: 0.68 }))
  const boats: { x: number; z: number; l: number; rot: number }[] = [
    { x: -30, z: -78, l: 9, rot: 0.06 },
    { x: -17, z: -84, l: 12, rot: -0.03 },
    { x: 22, z: -86, l: 8, rot: 0.11 },
    { x: 38, z: -80, l: 14, rot: -0.08 },
  ]
  for (const b of boats) {
    const hull = new THREE.Mesh(new THREE.BoxGeometry(b.l, 1.6, b.l * 0.28), hullMat)
    hull.position.set(b.x, WATER_Y + 0.22, b.z)
    hull.rotation.y = b.rot
    const bow = new THREE.Mesh(new THREE.ConeGeometry(b.l * 0.14, b.l * 0.34, 4), hullMat)
    bow.rotation.set(0, Math.PI / 4, -Math.PI / 2)
    bow.position.set(b.x - b.l * 0.6, WATER_Y + 0.28, b.z)
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(b.l * 0.28, 1.5, b.l * 0.24), cabinMat)
    cabin.position.set(b.x + b.l * 0.2, WATER_Y + 1.62, b.z)
    cabin.rotation.y = b.rot
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.5, 6), cabinMat)
    mast.position.set(b.x + b.l * 0.18, WATER_Y + 3.9, b.z)
    g.add(hull, bow, cabin, mast)
  }

  // shed and gantry on the opposite quay
  const shed = new THREE.Mesh(new THREE.BoxGeometry(26, 8, 14), applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x9aa099, roughness: 0.9 })))
  shed.position.set(-44, 3.6, -112)
  g.add(shed)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(27, 0.5, 15), applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x6f7570, roughness: 0.9 })))
  roof.position.set(-44, 7.9, -112)
  g.add(roof)
  const craneMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0xa08a4d, roughness: 0.85, metalness: 0.15 }))
  const tower = new THREE.Mesh(new THREE.BoxGeometry(2.6, 14, 2.6), craneMat)
  tower.position.set(-64, 7.6, -118)
  const towerBase = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.2, 5.2), conc)
  towerBase.position.set(-64, 1.1, -118)
  const jib = new THREE.Mesh(new THREE.BoxGeometry(17, 0.8, 0.8), craneMat)
  jib.position.set(-57, 14.2, -118)
  const stay = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.4, 0.3), craneMat)
  stay.position.set(-59.5, 16.4, -118)
  stay.rotation.z = 0.42
  g.add(tower, towerBase, jib, stay)

  // light poles along this quay, receding
  const poleMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x8d918c, roughness: 0.7, metalness: 0.4 }))
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 6.5, 8), poleMat)
    p.position.set(-9 - i * 7.5, 3.25, 6.5)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.28), poleMat)
    head.position.set(-9 - i * 7.5 - 0.3, 6.5, 6.5)
    g.add(p, head)
  }

  g.traverse((o) => { o.castShadow = false; o.receiveShadow = false })
  return g
}
