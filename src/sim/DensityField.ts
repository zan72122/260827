/**
 * Low resolution scalar field of bait concentration. It is the only
 * thing the fish read: particles write into it, fish steer up its
 * gradient. That indirection is what makes the causality hold -- move
 * where the krill falls and the school's path follows, with no direct
 * link between the rig and the fish.
 */
export class DensityField {
  readonly nx = 18
  readonly ny = 20
  readonly nz = 14
  readonly min = { x: -4.2, y: -11.0, z: -6.6 }
  readonly max = { x: 4.2, y: -1.2, z: 1.2 }
  private cur: Float32Array
  private acc: Float32Array
  private dx: number
  private dy: number
  private dz: number
  peak = { x: 0, y: -4.5, z: -2.5, v: 0 }

  constructor() {
    const n = this.nx * this.ny * this.nz
    this.cur = new Float32Array(n)
    this.acc = new Float32Array(n)
    this.dx = (this.max.x - this.min.x) / this.nx
    this.dy = (this.max.y - this.min.y) / this.ny
    this.dz = (this.max.z - this.min.z) / this.nz
  }

  private idx(i: number, j: number, k: number) {
    return (k * this.ny + j) * this.nx + i
  }

  clearAccum() { this.acc.fill(0) }

  /** Deposit one particle's contribution, spread over the 8 nearest cells. */
  splat(x: number, y: number, z: number, w: number) {
    const fx = (x - this.min.x) / this.dx - 0.5
    const fy = (y - this.min.y) / this.dy - 0.5
    const fz = (z - this.min.z) / this.dz - 0.5
    const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz)
    if (i0 < 0 || j0 < 0 || k0 < 0 || i0 + 1 >= this.nx || j0 + 1 >= this.ny || k0 + 1 >= this.nz) return
    const tx = fx - i0, ty = fy - j0, tz = fz - k0
    for (let k = 0; k < 2; k++) {
      const wz = k ? tz : 1 - tz
      for (let j = 0; j < 2; j++) {
        const wy = j ? ty : 1 - ty
        for (let i = 0; i < 2; i++) {
          const wx = i ? tx : 1 - tx
          this.acc[this.idx(i0 + i, j0 + j, k0 + k)] += w * wx * wy * wz
        }
      }
    }
  }

  /** Blend the new deposit in; scent lingers a little after the grains go. */
  commit(dt: number) {
    const k = Math.min(1, dt * 2.2)
    let best = 0, bi = 0, bj = 0, bk = 0
    for (let i = 0; i < this.cur.length; i++) {
      const v = this.cur[i] + (this.acc[i] - this.cur[i]) * k
      this.cur[i] = v < 1e-4 ? 0 : v
      if (v > best) { best = v; const t = i; bi = t % this.nx; bj = ((t / this.nx) | 0) % this.ny; bk = (t / (this.nx * this.ny)) | 0 }
    }
    this.peak.v = best
    if (best > 0) {
      this.peak.x = this.min.x + (bi + 0.5) * this.dx
      this.peak.y = this.min.y + (bj + 0.5) * this.dy
      this.peak.z = this.min.z + (bk + 0.5) * this.dz
    }
  }

  sample(x: number, y: number, z: number) {
    const fx = (x - this.min.x) / this.dx - 0.5
    const fy = (y - this.min.y) / this.dy - 0.5
    const fz = (z - this.min.z) / this.dz - 0.5
    let i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz)
    if (i0 < 0 || j0 < 0 || k0 < 0 || i0 + 1 >= this.nx || j0 + 1 >= this.ny || k0 + 1 >= this.nz) return 0
    const tx = fx - i0, ty = fy - j0, tz = fz - k0
    let s = 0
    for (let k = 0; k < 2; k++) {
      const wz = k ? tz : 1 - tz
      for (let j = 0; j < 2; j++) {
        const wy = j ? ty : 1 - ty
        for (let i = 0; i < 2; i++) {
          const wx = i ? tx : 1 - tx
          s += this.cur[this.idx(i0 + i, j0 + j, k0 + k)] * wx * wy * wz
        }
      }
    }
    return s
  }

  gradient(x: number, y: number, z: number, out: { x: number; y: number; z: number }) {
    const h = 0.55
    out.x = this.sample(x + h, y, z) - this.sample(x - h, y, z)
    out.y = this.sample(x, y + h, z) - this.sample(x, y - h, z)
    out.z = this.sample(x, y, z + h) - this.sample(x, y, z - h)
    return out
  }

  reset() { this.cur.fill(0); this.acc.fill(0); this.peak.v = 0 }
}
