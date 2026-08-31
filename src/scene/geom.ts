import * as THREE from 'three'

/** A flat annular sector: r0..r1, theta0..theta1, from y0 to y1. */
export function annularSector(
  r0: number,
  r1: number,
  t0: number,
  t1: number,
  y0: number,
  y1: number,
  seg = 96,
) {
  const pos: number[] = []
  const nor: number[] = []
  const idx: number[] = []
  const n = Math.max(2, Math.ceil((seg * Math.abs(t1 - t0)) / (Math.PI * 2)))
  const ring = (r: number, y: number, ny: number, nr: number) => {
    const base = pos.length / 3
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n
      pos.push(r * Math.cos(t), y, r * Math.sin(t))
      nor.push(nr * Math.cos(t), ny, nr * Math.sin(t))
    }
    return base
  }
  const strip = (a: number, b: number) => {
    for (let i = 0; i < n; i++) idx.push(a + i, b + i, a + i + 1, a + i + 1, b + i, b + i + 1)
  }
  // top
  strip(ring(r0, y1, 1, 0), ring(r1, y1, 1, 0))
  // bottom
  strip(ring(r1, y0, -1, 0), ring(r0, y0, -1, 0))
  // outer wall
  strip(ring(r1, y1, 0, 1), ring(r1, y0, 0, 1))
  // inner wall
  strip(ring(r0, y0, 0, -1), ring(r0, y1, 0, -1))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setIndex(idx)
  // end caps
  const caps: number[] = []
  const capNor: number[] = []
  for (const [t, s] of [
    [t0, -1],
    [t1, 1],
  ] as const) {
    const c = Math.cos(t)
    const si = Math.sin(t)
    const base = pos.length / 3
    for (const [r, y] of [
      [r0, y0],
      [r1, y0],
      [r1, y1],
      [r0, y1],
    ] as const) {
      caps.push(r * c, y, r * si)
      capNor.push(-si * s, 0, c * s)
    }
    if (s > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2)
    pos.push(...caps.splice(0))
    nor.push(...capNor.splice(0))
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setIndex(idx)
  return g
}

/** Box centred on (cx, cy, cz) with slightly rounded look via bevelled normals
 *  is overkill here; a plain box with tiny chamfer segments reads fine. */
export function box(w: number, h: number, d: number, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}
