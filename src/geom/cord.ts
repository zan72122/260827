/**
 * A thread that can be redrawn every frame.
 *
 * The support thread changes shape constantly -- it sags, it tightens, it is
 * pulled through the peg -- so its tube is built once with a fixed topology and
 * only its vertex positions are rewritten. No allocation per frame.
 */
import { BufferGeometry, BufferAttribute, Vector3 } from 'three';

export class Cord {
  readonly geometry: BufferGeometry;
  private readonly seg: number;
  private readonly sides: number;
  private readonly radius: number;
  private readonly pos: Float32Array;
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tan = new Vector3();
  private readonly nrm = new Vector3();
  private readonly bin = new Vector3();
  private readonly up = new Vector3(0, 1, 0);

  constructor(seg = 36, sides = 6, radius = 0.00042) {
    this.seg = seg;
    this.sides = sides;
    this.radius = radius;
    const count = (seg + 1) * (sides + 1);
    this.pos = new Float32Array(count * 3);
    const idx: number[] = [];
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < sides; j++) {
        const a = i * (sides + 1) + j;
        const b = a + 1;
        const c = a + sides + 2;
        const d = a + sides + 1;
        idx.push(a, b, c, a, c, d);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.geometry = g;
  }

  /** Rewrite the tube along `path` (world metres), resampled to the segments. */
  update(path: Vector3[]): void {
    if (path.length < 2) return;
    const lens: number[] = [0];
    for (let i = 1; i < path.length; i++) {
      lens.push(lens[i - 1]! + path[i]!.distanceTo(path[i - 1]!));
    }
    const total = lens[lens.length - 1]! || 1e-6;
    let k = 0;
    for (let i = 0; i <= this.seg; i++) {
      const s = (i / this.seg) * total;
      while (k < lens.length - 2 && lens[k + 1]! < s) k++;
      const t = (s - lens[k]!) / Math.max(1e-9, lens[k + 1]! - lens[k]!);
      this.tmpA.copy(path[k]!).lerp(path[k + 1]!, t);
      this.tan.copy(path[k + 1]!).sub(path[k]!);
      if (this.tan.lengthSq() < 1e-12) this.tan.set(0, 1, 0);
      this.tan.normalize();
      this.nrm.copy(this.up);
      if (Math.abs(this.nrm.dot(this.tan)) > 0.95) this.nrm.set(1, 0, 0);
      this.bin.crossVectors(this.tan, this.nrm).normalize();
      this.nrm.crossVectors(this.bin, this.tan).normalize();
      for (let j = 0; j <= this.sides; j++) {
        const a = (j / this.sides) * Math.PI * 2;
        const ca = Math.cos(a) * this.radius;
        const sa = Math.sin(a) * this.radius;
        this.tmpB
          .copy(this.tmpA)
          .addScaledVector(this.nrm, ca)
          .addScaledVector(this.bin, sa);
        const o = (i * (this.sides + 1) + j) * 3;
        this.pos[o] = this.tmpB.x;
        this.pos[o + 1] = this.tmpB.y;
        this.pos[o + 2] = this.tmpB.z;
      }
    }
    const attr = this.geometry.getAttribute('position') as BufferAttribute;
    attr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }
}
