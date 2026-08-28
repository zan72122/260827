import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Path,
  Shape,
  TorusGeometry,
} from 'three'
import { DECK_THICK, DECK_TOP } from '../world'
import { deckMaps, metalMaps, windowGlow } from './textures'
import { hookMaterial, srgb } from './shaderlib'

/**
 * The boat is authored in a frame where local +X points at the viewer and
 * local +Z runs across the screen, so the section plane through the fishing
 * station is simply local x = 0.
 */
export const NEAR_EDGE = 0.88
export const HOLE_X = 0.5
export const HOLE_Z = 0.38

function rect(path: Shape | Path, x0: number, x1: number, y0: number, y1: number, r: number) {
  path.moveTo(x0 + r, y0)
  path.lineTo(x1 - r, y0)
  path.quadraticCurveTo(x1, y0, x1, y0 + r)
  path.lineTo(x1, y1 - r)
  path.quadraticCurveTo(x1, y1, x1 - r, y1)
  path.lineTo(x0 + r, y1)
  path.quadraticCurveTo(x0, y1, x0, y1 - r)
  path.lineTo(x0, y0 + r)
  path.quadraticCurveTo(x0, y0, x0 + r, y0)
  return path
}

/** the deck plate is a real solid with a real opening cut through it */
function deckGeometry(): BufferGeometry {
  const shape = new Shape()
  rect(shape, -2.3, NEAR_EDGE, -1.5, 1.5, 0.07)
  const hole = new Path()
  rect(hole, -HOLE_X / 2, HOLE_X / 2, -HOLE_Z / 2, HOLE_Z / 2, 0.08)
  shape.holes.push(hole)
  const g = new ExtrudeGeometry(shape, { depth: DECK_THICK, bevelEnabled: false, curveSegments: 8 })
  g.rotateX(-Math.PI / 2)
  g.translate(0, DECK_TOP, 0)
  g.computeVertexNormals()
  const pos = g.attributes.position
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * 0.62
    uv[i * 2 + 1] = pos.getZ(i) * 0.62
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2))
  return g
}

export interface BoatParts {
  /** fixed yaw so local +X faces the camera */
  group: Group
  /** everything that rolls with the hull */
  tilt: Group
  lamp: Group
}

export function buildBoat(): BoatParts {
  const group = new Group()
  const tilt = new Group()
  group.add(tilt)

  const deckTex = deckMaps()
  const alloy = metalMaps(256, [0.6, 0.61, 0.63])

  const deckMat = hookMaterial(
    new MeshStandardMaterial({
      map: deckTex.map,
      roughnessMap: deckTex.roughnessMap,
      bumpMap: deckTex.bumpMap,
      bumpScale: 0.3,
      roughness: 1,
      metalness: 0,
      side: DoubleSide,
    }),
    {
      deckCut: true,
      extraFragment: `if ( !gl_FrontFacing ) gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 0.135, 0.105, 0.072 ), 0.92 );`,
    }
  ) as MeshStandardMaterial
  const deck = new Mesh(deckGeometry(), deckMat)
  deck.receiveShadow = true
  deck.castShadow = true
  tilt.add(deck)

  // wet liner around the opening
  const linerShape = new Shape()
  rect(linerShape, -HOLE_X / 2 - 0.05, HOLE_X / 2 + 0.05, -HOLE_Z / 2 - 0.05, HOLE_Z / 2 + 0.05, 0.1)
  const linerHole = new Path()
  rect(linerHole, -HOLE_X / 2, HOLE_X / 2, -HOLE_Z / 2, HOLE_Z / 2, 0.08)
  linerShape.holes.push(linerHole)
  const linerGeo = new ExtrudeGeometry(linerShape, { depth: 0.014, bevelEnabled: false, curveSegments: 8 })
  linerGeo.rotateX(-Math.PI / 2)
  linerGeo.translate(0, DECK_TOP + 0.014, 0)
  const linerMat = hookMaterial(
    new MeshStandardMaterial({ color: srgb(0x30322f), roughness: 0.3, metalness: 0.1, side: DoubleSide }),
    { deckCut: true }
  )
  const liner = new Mesh(linerGeo, linerMat)
  liner.castShadow = true
  liner.receiveShadow = true
  tilt.add(liner)

  // joists under the deck, seen in the section
  const joistMat = hookMaterial(
    new MeshStandardMaterial({ color: srgb(0x3b352c), roughness: 0.95, metalness: 0 }),
    { deckCut: true, underwater: true }
  )
  for (const z of [-0.62, 0.62]) {
    const j = new Mesh(new BoxGeometry(1.94, 0.085, 0.062), joistMat)
    j.position.set(-1.31, DECK_TOP - DECK_THICK - 0.043, z)
    j.castShadow = true
    tilt.add(j)
  }
  const cross = new Mesh(new BoxGeometry(0.062, 0.085, 2.9), joistMat)
  cross.position.set(-1.75, DECK_TOP - DECK_THICK - 0.043, 0)
  tilt.add(cross)

  // hull: painted topsides, a stained waterline, and a real draft
  const hullMat = hookMaterial(
    new MeshStandardMaterial({ color: srgb(0x6b6e6a), roughness: 0.76, metalness: 0.06, side: DoubleSide }),
    { deckCut: true, underwater: true }
  )
  const boot = hookMaterial(
    new MeshStandardMaterial({ color: srgb(0x3b3d3a), roughness: 0.5, metalness: 0.05, side: DoubleSide }),
    { deckCut: true, underwater: true }
  )
  const nearHull = new Mesh(new BoxGeometry(0.07, 0.72, 3.02), hullMat)
  nearHull.position.set(NEAR_EDGE + 0.035, DECK_TOP - 0.31, 0)
  nearHull.castShadow = true
  tilt.add(nearHull)
  const nearBoot = new Mesh(new BoxGeometry(0.078, 0.12, 3.02), boot)
  nearBoot.position.set(NEAR_EDGE + 0.035, 0.02, 0)
  tilt.add(nearBoot)
  const gunwale = new Mesh(new BoxGeometry(0.115, 0.05, 3.02), hullMat)
  gunwale.position.set(NEAR_EDGE + 0.035, DECK_TOP + 0.06, 0)
  gunwale.castShadow = true
  tilt.add(gunwale)

  for (const z of [-1.5, 1.5]) {
    const w = new Mesh(new BoxGeometry(3.25, 0.9, 0.07), hullMat)
    w.position.set(-0.71, DECK_TOP - 0.4, z + Math.sign(z) * 0.035)
    tilt.add(w)
    const b = new Mesh(new BoxGeometry(3.25, 0.12, 0.078), boot)
    b.position.set(-0.71, 0.02, z + Math.sign(z) * 0.035)
    tilt.add(b)
  }
  const farHull = new Mesh(new BoxGeometry(0.07, 0.9, 3.02), hullMat)
  farHull.position.set(-2.335, DECK_TOP - 0.4, 0)
  tilt.add(farHull)

  // cabin: walls with real window openings, so the cold outside light
  // actually falls through them onto the deck
  const wallMat = hookMaterial(
    new MeshStandardMaterial({ color: srgb(0x8a8c87), roughness: 0.88, metalness: 0.02, side: DoubleSide })
  )
  const glassMat = new MeshStandardMaterial({
    color: srgb(0xdde7ee),
    map: windowGlow(),
    roughness: 0.7,
    metalness: 0,
    emissive: srgb(0xbdd0dd),
    emissiveIntensity: 0.95,
    transparent: true,
    opacity: 0.55,
  })
  const SILL = DECK_TOP + 0.6
  const HEAD = DECK_TOP + 1.24
  const TOP = DECK_TOP + 1.5

  // far wall, opening between z = -0.9 .. 1.0
  const farPieces: [number, number, number, number][] = [
    [DECK_TOP + (SILL - DECK_TOP) / 2, SILL - DECK_TOP, 0, 3.02],
    [(HEAD + TOP) / 2, TOP - HEAD, 0, 3.02],
    [(SILL + HEAD) / 2, HEAD - SILL, -1.255, 0.51],
    [(SILL + HEAD) / 2, HEAD - SILL, 1.255, 0.51],
  ]
  for (const [cy, h, cz, d] of farPieces) {
    const m = new Mesh(new BoxGeometry(0.06, h, d), wallMat)
    m.position.set(-2.33, cy, cz)
    m.castShadow = true
    m.receiveShadow = true
    tilt.add(m)
  }
  const farGlass = new Mesh(new BoxGeometry(0.014, HEAD - SILL, 2.0), glassMat)
  farGlass.position.set(-2.33, (SILL + HEAD) / 2, 0)
  tilt.add(farGlass)

  // side walls, opening in the one the light comes through
  for (const z of [-1.5, 1.5]) {
    const zz = z + Math.sign(z) * 0.03
    if (z < 0) {
      const pieces: [number, number, number, number][] = [
        [DECK_TOP + (SILL - DECK_TOP) / 2, SILL - DECK_TOP, -0.71, 3.25],
        [(HEAD + TOP) / 2, TOP - HEAD, -0.71, 3.25],
        [(SILL + HEAD) / 2, HEAD - SILL, -2.06, 0.55],
        [(SILL + HEAD) / 2, HEAD - SILL, 0.34, 1.15],
      ]
      for (const [cy, h, cx, w] of pieces) {
        const m = new Mesh(new BoxGeometry(w, h, 0.06), wallMat)
        m.position.set(cx, cy, zz)
        m.castShadow = true
        m.receiveShadow = true
        tilt.add(m)
      }
      const g = new Mesh(new BoxGeometry(1.7, HEAD - SILL, 0.014), glassMat)
      g.position.set(-1.06, (SILL + HEAD) / 2, zz)
      tilt.add(g)
    } else {
      const m = new Mesh(new BoxGeometry(3.25, TOP - DECK_TOP, 0.06), wallMat)
      m.position.set(-0.71, (DECK_TOP + TOP) / 2, zz)
      m.receiveShadow = true
      m.castShadow = true
      tilt.add(m)
    }
  }
  const roof = new Mesh(new BoxGeometry(1.85, 0.05, 3.05), wallMat)
  roof.position.set(-1.42, TOP + 0.025, 0)
  roof.castShadow = true
  tilt.add(roof)

  // bench, rod stand, bucket — placed where a person would actually put them
  const benchMat = hookMaterial(new MeshStandardMaterial({ color: srgb(0x6d675c), roughness: 0.9, metalness: 0.03 }))
  const bench = new Mesh(new BoxGeometry(0.44, 0.05, 1.15), benchMat)
  bench.position.set(-0.62, DECK_TOP + 0.34, -0.82)
  bench.castShadow = true
  bench.receiveShadow = true
  tilt.add(bench)
  for (const dz of [-0.46, 0.46]) {
    const leg = new Mesh(new BoxGeometry(0.05, 0.34, 0.05), benchMat)
    leg.position.set(-0.62, DECK_TOP + 0.17, -0.82 + dz)
    leg.castShadow = true
    tilt.add(leg)
  }

  const standMat = hookMaterial(
    new MeshStandardMaterial({
      map: alloy.map,
      roughnessMap: alloy.roughnessMap,
      bumpMap: alloy.bumpMap,
      bumpScale: 0.1,
      roughness: 0.5,
      metalness: 0.75,
    }),
    { deckCut: true }
  )
  const standX = -0.06
  const standZ = -0.4
  const post = new Mesh(new CylinderGeometry(0.016, 0.02, 0.3, 12), standMat)
  post.position.set(standX, DECK_TOP + 0.15, standZ)
  post.castShadow = true
  tilt.add(post)
  const foot = new Mesh(new CylinderGeometry(0.07, 0.08, 0.02, 16), standMat)
  foot.position.set(standX, DECK_TOP + 0.01, standZ)
  foot.castShadow = true
  foot.receiveShadow = true
  tilt.add(foot)

  const bucketMat = hookMaterial(
    new MeshStandardMaterial({ color: srgb(0x2f4a51), roughness: 0.75, metalness: 0.02, side: DoubleSide })
  )
  const bucket = new Mesh(new CylinderGeometry(0.125, 0.105, 0.23, 20, 1, true), bucketMat)
  bucket.position.set(-0.95, DECK_TOP + 0.115, 0.72)
  bucket.castShadow = true
  tilt.add(bucket)
  const bucketBottom = new Mesh(new CylinderGeometry(0.105, 0.105, 0.012, 20), bucketMat)
  bucketBottom.position.set(-0.95, DECK_TOP + 0.006, 0.72)
  tilt.add(bucketBottom)
  const handle = new Mesh(new TorusGeometry(0.12, 0.0035, 6, 20, Math.PI), standMat)
  handle.position.set(-0.95, DECK_TOP + 0.23, 0.72)
  handle.rotation.y = Math.PI / 2
  tilt.add(handle)

  // hanging lamp: moves with the hull, but a beat late
  const lamp = new Group()
  lamp.position.set(-0.78, DECK_TOP + 0.82, -0.26)
  const cordMat = new MeshStandardMaterial({ color: srgb(0x23211e), roughness: 0.9 })
  const cord = new Mesh(new CylinderGeometry(0.0035, 0.0035, 0.2, 6), cordMat)
  cord.position.y = -0.1
  lamp.add(cord)
  const shade = new Mesh(
    new CylinderGeometry(0.05, 0.1, 0.095, 20, 1, true),
    new MeshStandardMaterial({ color: srgb(0xb5aa99), roughness: 0.62, metalness: 0.22, side: DoubleSide })
  )
  shade.position.y = -0.245
  lamp.add(shade)
  const bulb = new Mesh(
    new CylinderGeometry(0.02, 0.02, 0.045, 12),
    new MeshStandardMaterial({ color: srgb(0xffe9c4), emissive: srgb(0xffd39c), emissiveIntensity: 3, roughness: 0.5 })
  )
  bulb.position.y = -0.275
  lamp.add(bulb)
  tilt.add(lamp)

  return { group, tilt, lamp }
}
