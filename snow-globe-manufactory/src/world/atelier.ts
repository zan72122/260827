import * as THREE from 'three'
import type { MatKit } from './materials'
import { enamel } from './materials'
import { blobTexture, paintTexture, skyTexture, woodTexture } from './textures'
import { CRADLE_CENTER_Y, PEDESTAL_TOP_Y, R_OUT } from './dims'
import { Rng } from '../core/random'
import type { PedestalKind } from '../core/state'

/**
 * The workshop around the globe. Depth here comes from real distance and from
 * material contrast — oiled oak, cold painted steel, brass, frosted glass —
 * rather than from a blurred background.
 */

export const WINDOW_DIR = new THREE.Vector3(-0.55, 0.52, -0.66).normalize()
export const LAMP_DIR = new THREE.Vector3(0.7, 0.58, 0.42).normalize()

export interface AtelierTools {
  scoop: THREE.Group
  pump: THREE.Group
  pumpHandle: THREE.Group
  gasketTray: THREE.Group
  cradle: THREE.Group
  pedestal: THREE.Group
}

export class Atelier {
  readonly group = new THREE.Group()
  readonly tools: AtelierTools
  readonly keyLight: THREE.DirectionalLight
  readonly lampLight: THREE.PointLight
  readonly contact: THREE.Mesh

  private owned: Array<THREE.BufferGeometry | THREE.Material> = []
  private ambient: THREE.HemisphereLight
  private fill: THREE.DirectionalLight
  private lampBulb: THREE.MeshStandardMaterial

  constructor(mats: MatKit, opts: { shadows: boolean; shadowMapSize: number; shelfGeometry: boolean }) {
    const rng = new Rng(0x51c0be)

    // --- bench -------------------------------------------------------------
    const slabGeo = new THREE.BoxGeometry(3.4, 0.1, 1.9)
    const slab = new THREE.Mesh(slabGeo, mats.benchWood)
    slab.position.set(0, -0.05, 0.25)
    slab.receiveShadow = true
    this.group.add(slab)
    this.owned.push(slabGeo)

    const lipGeo = new THREE.BoxGeometry(3.4, 0.05, 0.06)
    const lip = new THREE.Mesh(lipGeo, mats.darkWood)
    lip.position.set(0, -0.075, 1.2)
    lip.receiveShadow = true
    this.group.add(lip)
    this.owned.push(lipGeo)

    const legGeo = new THREE.BoxGeometry(0.12, 1.4, 0.12)
    this.owned.push(legGeo)
    for (const x of [-1.5, 1.5]) {
      for (const z of [-0.5, 0.95]) {
        const leg = new THREE.Mesh(legGeo, mats.darkWood)
        leg.position.set(x, -0.8, z)
        this.group.add(leg)
      }
    }

    // Apron and floor: without them the frame below the bench is a black void,
    // which reads as nothing rather than as a room.
    const apronGeo = new THREE.BoxGeometry(3.4, 0.26, 0.05)
    const apron = new THREE.Mesh(apronGeo, mats.darkWood)
    apron.position.set(0, -0.24, 1.14)
    apron.receiveShadow = true
    this.group.add(apron)
    this.owned.push(apronGeo)

    const drawerGeo = new THREE.BoxGeometry(0.62, 0.19, 0.03)
    const knobGeo = new THREE.SphereGeometry(0.026, 10, 8)
    this.owned.push(drawerGeo, knobGeo)
    for (const x of [-0.72, 0.72]) {
      const dr = new THREE.Mesh(drawerGeo, mats.benchWood)
      dr.position.set(x, -0.24, 1.166)
      this.group.add(dr)
      const kn = new THREE.Mesh(knobGeo, mats.brass)
      kn.position.set(x, -0.24, 1.195)
      this.group.add(kn)
    }

    const floorGeo = new THREE.PlaneGeometry(9, 7)
    floorGeo.rotateX(-Math.PI / 2)
    const floorMat = new THREE.MeshStandardMaterial({
      map: woodTexture(), color: 0x63503f, roughness: 0.9,
    })
    floorMat.map!.repeat.set(4, 4)
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.position.set(0, -1.52, 0.4)
    floor.receiveShadow = true
    this.group.add(floor)
    this.owned.push(floorGeo, floorMat)

    // --- walls & window -----------------------------------------------------
    const wallGeo = new THREE.PlaneGeometry(7.4, 5)
    const wall = new THREE.Mesh(wallGeo, mats.wall)
    wall.position.set(0, 1.3, -1.62)
    wall.receiveShadow = true
    this.group.add(wall)
    this.owned.push(wallGeo)

    // A chair rail and wainscot: the back wall is a large flat field otherwise.
    const railGeo2 = new THREE.BoxGeometry(7.4, 0.06, 0.04)
    const rail2 = new THREE.Mesh(railGeo2, mats.darkWood)
    rail2.position.set(0, 0.42, -1.6)
    this.group.add(rail2)
    this.owned.push(railGeo2)
    const wainGeo = new THREE.PlaneGeometry(7.4, 2.1)
    const wainMat = new THREE.MeshStandardMaterial({
      map: paintTexture(), color: 0x6f6152, roughness: 0.9,
    })
    wainMat.map!.repeat.set(6, 2)
    const wain = new THREE.Mesh(wainGeo, wainMat)
    wain.position.set(0, -0.66, -1.6)
    wain.receiveShadow = true
    this.group.add(wain)
    this.owned.push(wainGeo, wainMat)

    const sideGeo = new THREE.PlaneGeometry(3.4, 5)
    const side = new THREE.Mesh(sideGeo, mats.wall)
    side.position.set(-2.1, 1.3, 0.1)
    side.rotation.y = Math.PI / 2
    this.group.add(side)
    this.owned.push(sideGeo)

    // Winter beyond the pane: a cold gradient with a low ridge of conifers.
    const outsideGeo = new THREE.PlaneGeometry(1.9, 1.35)
    const outsideMat = new THREE.MeshBasicMaterial({ map: skyTexture() })
    const outside = new THREE.Mesh(outsideGeo, outsideMat)
    outside.position.set(-0.92, 0.86, -1.59)
    this.group.add(outside)
    this.owned.push(outsideGeo, outsideMat)

    const treeMat = new THREE.MeshBasicMaterial({ color: 0x4a5763 })
    this.owned.push(treeMat)
    const farTreeGeo = new THREE.ConeGeometry(0.07, 0.24, 5)
    this.owned.push(farTreeGeo)
    for (let i = 0; i < 9; i++) {
      const t = new THREE.Mesh(farTreeGeo, treeMat)
      const s = rng.range(0.55, 1.15)
      t.position.set(-1.72 + i * 0.19 + rng.range(-0.03, 0.03), 0.36 + s * 0.1, -1.585)
      t.scale.setScalar(s)
      this.group.add(t)
    }

    const paneGeo = new THREE.PlaneGeometry(1.9, 1.35)
    const paneMat = mats.frost.clone()
    paneMat.transparent = true
    paneMat.opacity = 0.52
    const pane = new THREE.Mesh(paneGeo, paneMat)
    pane.position.set(-0.92, 0.86, -1.575)
    this.group.add(pane)
    this.owned.push(paneGeo, paneMat)

    const frameMat = mats.darkWood
    const barH = new THREE.BoxGeometry(2.06, 0.07, 0.05)
    const barV = new THREE.BoxGeometry(0.07, 1.49, 0.05)
    const mull = new THREE.BoxGeometry(1.9, 0.028, 0.035)
    const mullV = new THREE.BoxGeometry(0.028, 1.35, 0.035)
    this.owned.push(barH, barV, mull, mullV)
    for (const y of [1.57, 0.15]) {
      const m = new THREE.Mesh(barH, frameMat)
      m.position.set(-0.92, y, -1.56)
      this.group.add(m)
    }
    for (const x of [-1.915, 0.075]) {
      const m = new THREE.Mesh(barV, frameMat)
      m.position.set(x, 0.86, -1.56)
      this.group.add(m)
    }
    const mh = new THREE.Mesh(mull, frameMat)
    mh.position.set(-0.92, 0.86, -1.55)
    this.group.add(mh)
    const mv = new THREE.Mesh(mullV, frameMat)
    mv.position.set(-0.92, 0.86, -1.55)
    this.group.add(mv)

    // --- shelf of finished globes ------------------------------------------
    const shelfGeo = new THREE.BoxGeometry(1.5, 0.05, 0.32)
    const shelf = new THREE.Mesh(shelfGeo, mats.darkWood)
    shelf.position.set(1.3, 0.86, -1.4)
    shelf.receiveShadow = true
    this.group.add(shelf)
    this.owned.push(shelfGeo)
    // Brackets reach back to the wall; free-floating ones read as stray boxes
    // when the camera looks up at the shelf from inside the globe.
    const bracketGeo = new THREE.BoxGeometry(0.035, 0.14, 0.3)
    this.owned.push(bracketGeo)
    for (const x of [0.68, 1.92]) {
      const br = new THREE.Mesh(bracketGeo, mats.darkWood)
      br.position.set(x, 0.79, -1.47)
      this.group.add(br)
    }

    const segs = opts.shelfGeometry ? 20 : 10
    const shelfGlassGeo = new THREE.SphereGeometry(0.11, segs, Math.max(6, segs / 2))
    const shelfBaseGeo = new THREE.CylinderGeometry(0.085, 0.1, 0.05, opts.shelfGeometry ? 16 : 8)
        this.owned.push(shelfGlassGeo, shelfBaseGeo)
    const shelfGlassMat = new THREE.MeshStandardMaterial({
      color: 0xa9c3d2, roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0.34,
    })
    this.owned.push(shelfGlassMat)
    const shelfTreeGeo = new THREE.ConeGeometry(0.03, 0.075, 7)
    const shelfHouseGeo = new THREE.BoxGeometry(0.045, 0.03, 0.035)
    const shelfGroundGeo = new THREE.SphereGeometry(0.072, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5)
    this.owned.push(shelfTreeGeo, shelfHouseGeo, shelfGroundGeo)
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group()
      const ground = new THREE.Mesh(shelfGroundGeo, mats.snow)
      ground.position.y = 0.058
      ground.scale.set(1, 0.34, 1)
      const tree = new THREE.Mesh(shelfTreeGeo, new THREE.MeshStandardMaterial({
        color: 0x2f5a3f, roughness: 0.8,
      }))
      tree.position.set(-0.022, 0.1, 0.012)
      const core = new THREE.Mesh(shelfHouseGeo, new THREE.MeshStandardMaterial({
        color: 0xd6cbb4, emissive: new THREE.Color(0xffb872), emissiveIntensity: 0.5, roughness: 0.7,
      }))
      core.position.set(0.026, 0.078, -0.008)
      core.rotation.y = 0.5
      const glass = new THREE.Mesh(shelfGlassGeo, shelfGlassMat)
      glass.position.y = 0.12
      const base = new THREE.Mesh(shelfBaseGeo, i % 2 ? mats.ceramic : mats.darkWood)
      base.position.y = 0.025
      this.owned.push(core.material as THREE.Material, tree.material as THREE.Material)
      g.add(ground, tree, core, glass, base)
      g.position.set(0.78 + i * 0.35, 0.885, -1.4 + rng.range(-0.03, 0.03))
      g.scale.setScalar(rng.range(0.86, 1.06))
      this.group.add(g)
    }

    // --- the workshop lamp ---------------------------------------------------
    // A bench lamp that reads as one: weighted foot, post, elbow, shade.
    // Set forward of the shelf so its shade reads as a lamp in the foreground
    // rather than a dark wedge sitting on the shelf behind it.
    const lampX = 1.74
    const lampZ = -0.24
    const footGeo2 = new THREE.CylinderGeometry(0.13, 0.15, 0.035, 20)
    const foot2 = new THREE.Mesh(footGeo2, mats.paintedMetal)
    foot2.position.set(lampX, 0.018, lampZ)
    foot2.castShadow = true
    foot2.receiveShadow = true
    this.group.add(foot2)
    this.owned.push(footGeo2)

    const postGeo = new THREE.CylinderGeometry(0.017, 0.021, 0.8, 10)
    const post = new THREE.Mesh(postGeo, mats.steel)
    post.position.set(lampX, 0.42, lampZ)
    this.group.add(post)
    this.owned.push(postGeo)

    const armGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.42, 8)
    const arm = new THREE.Mesh(armGeo, mats.steel)
    arm.position.set(lampX - 0.19, 0.8, lampZ + 0.05)
    arm.rotation.z = Math.PI / 2 - 0.22
    this.group.add(arm)
    this.owned.push(armGeo)

    const shadeGeo = new THREE.ConeGeometry(0.12, 0.15, 20, 1, true)
    const shadeMat = new THREE.MeshStandardMaterial({
      color: 0x74838f, roughness: 0.5, metalness: 0.22, side: THREE.DoubleSide,
    })
    const shade = new THREE.Mesh(shadeGeo, shadeMat)
    shade.position.set(lampX - 0.38, 0.72, lampZ + 0.1)
    shade.rotation.set(0, 0, Math.PI - 0.34)
    this.group.add(shade)
    this.owned.push(shadeGeo, shadeMat)

    this.lampBulb = new THREE.MeshStandardMaterial({
      color: 0x40382c, emissive: new THREE.Color(0xffd7a1), emissiveIntensity: 2.4, roughness: 0.4,
    })
    const bulbGeo = new THREE.SphereGeometry(0.04, 10, 8)
    const bulb = new THREE.Mesh(bulbGeo, this.lampBulb)
    bulb.position.set(lampX - 0.4, 0.68, lampZ + 0.11)
    this.group.add(bulb)
    this.owned.push(bulbGeo, this.lampBulb)

    // --- tools ---------------------------------------------------------------
    this.tools = {
      scoop: this.buildScoop(mats),
      pump: new THREE.Group(),
      pumpHandle: new THREE.Group(),
      gasketTray: this.buildTray(mats),
      cradle: this.buildCradle(mats),
      pedestal: this.buildPedestal(mats),
    }
    this.buildPump(mats)
    this.group.add(
      this.tools.scoop, this.tools.pump,
      this.tools.gasketTray, this.tools.cradle, this.tools.pedestal,
    )

    // --- contact shadow -------------------------------------------------------
    const contactGeo = new THREE.PlaneGeometry(1.1, 1.1)
    contactGeo.rotateX(-Math.PI / 2)
    const contactMat = new THREE.MeshBasicMaterial({
      map: blobTexture(0.42),
      color: 0x0d0a07,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    })
    this.contact = new THREE.Mesh(contactGeo, contactMat)
    this.contact.position.set(0, 0.004, 0)
    this.contact.renderOrder = -1
    this.group.add(this.contact)
    this.owned.push(contactGeo, contactMat)

    // --- lighting -------------------------------------------------------------
    this.ambient = new THREE.HemisphereLight(0xa8c0d2, 0x5b4a38, 1.15)
    this.group.add(this.ambient)

    this.keyLight = new THREE.DirectionalLight(0xd3e4f2, 2.5)
    this.keyLight.position.copy(WINDOW_DIR).multiplyScalar(4).add(new THREE.Vector3(0, 0.4, 0))
    this.keyLight.target.position.set(0, 0.45, 0)
    this.group.add(this.keyLight, this.keyLight.target)
    if (opts.shadows) {
      this.keyLight.castShadow = true
      this.keyLight.shadow.mapSize.set(opts.shadowMapSize, opts.shadowMapSize)
      const c = this.keyLight.shadow.camera
      c.near = 0.5
      c.far = 8
      c.left = -1.25
      c.right = 1.25
      c.top = 1.25
      c.bottom = -1.25
      c.updateProjectionMatrix()
      this.keyLight.shadow.bias = -0.0012
      this.keyLight.shadow.normalBias = 0.012
    }

    this.lampLight = new THREE.PointLight(0xffbe7d, 3.4, 5.6, 2)
    this.lampLight.position.set(1.34, 0.66, -0.13)
    this.group.add(this.lampLight)

    this.fill = new THREE.DirectionalLight(0x9db4c8, 0.6)
    this.fill.position.set(0.6, 0.9, 2.4)
    this.group.add(this.fill)
  }

  private buildScoop(mats: MatKit): THREE.Group {
    const g = new THREE.Group()
    const bowl = new THREE.SphereGeometry(0.085, 18, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58)
    const bowlMesh = new THREE.Mesh(bowl, mats.brass)
    bowlMesh.castShadow = true
    const handleGeo = new THREE.CylinderGeometry(0.012, 0.014, 0.24, 8)
    const handle = new THREE.Mesh(handleGeo, mats.darkWood)
    handle.position.set(0.15, 0.03, 0)
    handle.rotation.z = Math.PI / 2 - 0.25
    handle.castShadow = true
    // The snow already loaded in the scoop; hidden once it has been poured.
    const loadGeo = new THREE.SphereGeometry(0.072, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)
    const load = new THREE.Mesh(loadGeo, mats.snow)
    load.position.y = -0.012
    load.name = 'scoopLoad'
    g.add(bowlMesh, handle, load)
    this.owned.push(bowl, handleGeo, loadGeo)
    g.position.set(-0.72, 0.09, 0.44)
    g.rotation.y = 0.5
    return g
  }


  private buildPump(mats: MatKit) {
    const g = this.tools.pump
    const bodyGeo = new THREE.CylinderGeometry(0.1, 0.115, 0.34, 20)
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xbcd2dc, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.36,
    })
    const body = new THREE.Mesh(bodyGeo, glassMat)
    body.position.y = 0.17
    const waterGeo = new THREE.CylinderGeometry(0.092, 0.106, 0.26, 20)
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x9fc6d4, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.6,
    })
    const water = new THREE.Mesh(waterGeo, waterMat)
    water.position.y = 0.14
    water.name = 'pumpWater'
    const collarGeo = new THREE.CylinderGeometry(0.078, 0.086, 0.05, 16)
    const collar = new THREE.Mesh(collarGeo, mats.brass)
    collar.position.y = 0.36
    g.add(body, water, collar)
    this.owned.push(bodyGeo, glassMat, waterGeo, waterMat, collarGeo)

    const h = this.tools.pumpHandle
    const capGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.045, 16)
    const cap = new THREE.Mesh(capGeo, mats.paintedMetal)
    const stemGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.09, 10)
    const stem = new THREE.Mesh(stemGeo, mats.steel)
    stem.position.y = -0.06
    h.add(cap, stem)
    h.position.y = 0.42
    g.add(h)
    this.owned.push(capGeo, stemGeo)

    const nozzleGeo = new THREE.CylinderGeometry(0.012, 0.014, 0.2, 10)
    const nozzle = new THREE.Mesh(nozzleGeo, mats.brass)
    nozzle.position.set(0.1, 0.36, 0)
    nozzle.rotation.z = -0.9
    g.add(nozzle)
    this.owned.push(nozzleGeo)

    g.position.set(0.76, 0.0, 0.42)
    g.rotation.y = -0.4
    for (const o of g.children) o.castShadow = true
  }

  private buildTray(mats: MatKit): THREE.Group {
    const g = new THREE.Group()
    const trayGeo = new THREE.CylinderGeometry(0.15, 0.14, 0.022, 22)
    const tray = new THREE.Mesh(trayGeo, mats.steel)
    tray.receiveShadow = true
    tray.castShadow = true
    g.add(tray)
    this.owned.push(trayGeo)
    const ringGeo = new THREE.TorusGeometry(0.062, 0.013, 8, 26)
    ringGeo.rotateX(Math.PI / 2)
    for (let i = 0; i < 2; i++) {
      const r = new THREE.Mesh(ringGeo, mats.rubber)
      r.position.set(i ? 0.055 : -0.05, 0.016 + i * 0.004, i ? 0.03 : -0.02)
      r.castShadow = true
      g.add(r)
    }
    this.owned.push(ringGeo)
    g.position.set(-0.72, 0.011, -0.34)
    return g
  }

  private buildCradle(mats: MatKit): THREE.Group {
    const g = new THREE.Group()
    // Ring radius is the sphere's own cross-section at this height, so the
    // glass rests in it instead of intersecting it.
    const ringY = 0.3
    const ringR = Math.sqrt(Math.max(0.01, R_OUT * R_OUT - (CRADLE_CENTER_Y - ringY) ** 2))
    const ringGeo = new THREE.TorusGeometry(ringR, 0.022, 8, 44)
    ringGeo.rotateX(Math.PI / 2)
    const ring = new THREE.Mesh(ringGeo, mats.brass)
    ring.position.y = ringY
    ring.castShadow = true
    g.add(ring)
    this.owned.push(ringGeo)
    const legGeo = new THREE.CylinderGeometry(0.014, 0.02, ringY, 8)
    this.owned.push(legGeo)
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4
      const l = new THREE.Mesh(legGeo, mats.brass)
      l.position.set(Math.cos(a) * (ringR - 0.02), ringY / 2, Math.sin(a) * (ringR - 0.02))
      l.castShadow = true
      g.add(l)
    }
    const footGeo = new THREE.TorusGeometry(ringR - 0.01, 0.016, 6, 32)
    footGeo.rotateX(Math.PI / 2)
    const foot = new THREE.Mesh(footGeo, mats.brass)
    foot.position.y = 0.014
    foot.receiveShadow = true
    g.add(foot)
    this.owned.push(footGeo)
    return g
  }

  private buildPedestal(mats: MatKit): THREE.Group {
    const g = new THREE.Group()
    // A turned profile that could really carry the weight: broad foot,
    // waisted stem, flat seat.
    const pts: THREE.Vector2[] = [
      new THREE.Vector2(0.0, 0),
      new THREE.Vector2(0.44, 0),
      new THREE.Vector2(0.445, 0.024),
      new THREE.Vector2(0.415, 0.05),
      new THREE.Vector2(0.355, 0.068),
      new THREE.Vector2(0.348, 0.098),
      new THREE.Vector2(0.382, 0.128),
      new THREE.Vector2(0.404, 0.156),
      new THREE.Vector2(0.404, PEDESTAL_TOP_Y),
      new THREE.Vector2(0.0, PEDESTAL_TOP_Y),
    ]
    const latheGeo = new THREE.LatheGeometry(pts, 40)
    latheGeo.computeVertexNormals()
    const body = new THREE.Mesh(latheGeo, mats.darkWood)
    body.name = 'pedestalBody'
    body.castShadow = true
    body.receiveShadow = true
    g.add(body)
    this.owned.push(latheGeo)

    const bandGeo = new THREE.TorusGeometry(0.352, 0.012, 8, 40)
    bandGeo.rotateX(Math.PI / 2)
    const band = new THREE.Mesh(bandGeo, mats.brass)
    band.position.y = 0.098
    band.name = 'pedestalBand'
    g.add(band)
    this.owned.push(bandGeo)

    const feltGeo = new THREE.CylinderGeometry(0.396, 0.396, 0.004, 34)
    const feltMat = enamel(0x4a3b3a, 0.95)
    const felt = new THREE.Mesh(feltGeo, feltMat)
    felt.position.y = PEDESTAL_TOP_Y - 0.001
    g.add(felt)
    this.owned.push(feltGeo, feltMat)

    g.visible = false
    return g
  }

  setPedestalKind(kind: PedestalKind, mats: MatKit) {
    const body = this.tools.pedestal.getObjectByName('pedestalBody') as THREE.Mesh | undefined
    if (!body) return
    body.material =
      kind === 'ceramic' ? mats.ceramic : kind === 'brass' ? mats.brass : mats.darkWood
  }

  /**
   * Keeps the globe visually planted. The glass itself is not a shadow caster
   * (it would darken its own interior), so this decal stands in for its cast
   * shadow: offset along the key light and stretched by the light's elevation,
   * exactly where a real one would land.
   */
  setContact(x: number, z: number, height: number, radius: number, strength: number) {
    const horiz = Math.hypot(WINDOW_DIR.x, WINDOW_DIR.z)
    const run = (height * horiz) / Math.max(0.1, WINDOW_DIR.y)
    this.contact.position.set(
      x - (WINDOW_DIR.x / horiz) * run,
      0.004,
      z - (WINDOW_DIR.z / horiz) * run,
    )
    const stretch = 1 + run / Math.max(0.12, radius) * 0.34
    this.contact.scale.set(radius * stretch, 1, radius * stretch * 0.92)
    this.contact.rotation.y = Math.atan2(-WINDOW_DIR.x, -WINDOW_DIR.z)
    ;(this.contact.material as THREE.MeshBasicMaterial).opacity =
      strength / (1 + height * 0.9)
    this.contact.visible = strength > 0.01
  }

  /** Dims the workshop while the camera lives inside the globe. */
  setExposure(k: number) {
    this.ambient.intensity = 1.15 * k
    this.keyLight.intensity = 2.5 * k
    this.lampLight.intensity = 3.4 * (0.12 + 0.88 * k)
    this.fill.intensity = 0.6 * k
    this.lampBulb.emissiveIntensity = 2.4 * (0.35 + 0.65 * k)
  }

  dispose() {
    for (const o of this.owned) o.dispose()
    this.owned.length = 0
    this.group.clear()
  }
}
