import * as THREE from 'three';
import { BagMorphController } from './BagMorphController';
import { lerp } from '../util/math';

const RINGS = 30;
const SEGS = 26;
const LENGTH = 0.205;
const R_TIP = 0.0104;
const R_TOP = 0.0395;

/**
 * A disposable piping bag: slightly milky polyethylene, cream visible through
 * it, gathered and twisted at the top. Held by an adult — the player never
 * handles the tool itself.
 */
export class PipingBag {
  readonly group = new THREE.Group();
  readonly morph = new BagMorphController();
  /** local Y at which the nozzle socket ends */
  readonly tipY = 0;

  private geo = new THREE.BufferGeometry();
  private pos: THREE.BufferAttribute;
  private creamGeo = new THREE.BufferGeometry();
  private creamPos: THREE.BufferAttribute;
  private lastKey = -1;

  constructor() {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= RINGS; j++) {
      for (let i = 0; i <= SEGS; i++) {
        pos.push(0, 0, 0);
        uv.push(i / SEGS, j / RINGS);
      }
    }
    for (let j = 0; j < RINGS; j++) {
      for (let i = 0; i < SEGS; i++) {
        const a = j * (SEGS + 1) + i;
        const b = a + 1;
        const c = (j + 1) * (SEGS + 1) + i + 1;
        const d = (j + 1) * (SEGS + 1) + i;
        idx.push(a, b, c, a, c, d);
      }
    }
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    this.pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    this.pos.setUsage(THREE.DynamicDrawUsage);

    this.creamGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos.slice(), 3));
    this.creamGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv.slice(), 2));
    this.creamGeo.setIndex(idx.slice());
    this.creamPos = this.creamGeo.getAttribute('position') as THREE.BufferAttribute;
    this.creamPos.setUsage(THREE.DynamicDrawUsage);

    const film = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0.93, 0.93, 0.925),
      roughness: 0.30,
      metalness: 0,
      clearcoat: 0.34,
      clearcoatRoughness: 0.3,
      transparent: true,
      opacity: 0.80,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const creamMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0.955, 0.935, 0.9),
      roughness: 0.7,
      metalness: 0,
      sheen: 0.4,
      sheenRoughness: 0.9,
    });

    const bagMesh = new THREE.Mesh(this.geo, film);
    bagMesh.castShadow = true;
    bagMesh.renderOrder = 3;
    const creamMesh = new THREE.Mesh(this.creamGeo, creamMat);
    creamMesh.castShadow = true;
    this.group.add(creamMesh, bagMesh);

    this.rebuild(true);
  }

  update(dt: number): void {
    this.morph.update(dt);
    this.rebuild(false);
  }

  private rebuild(force: boolean): void {
    const key = Math.round(this.morph.fill * 220) * 1000 + Math.round(this.morph.squeeze * 160);
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    const line = this.morph.creamLine;
    for (let j = 0; j <= RINGS; j++) {
      const s = j / RINGS;
      const y = LENGTH * s;
      const base = lerp(R_TIP, R_TOP, Math.pow(s, 0.82));
      for (let i = 0; i <= SEGS; i++) {
        const th = (i / SEGS) * Math.PI * 2;
        const r = base * this.morph.radiusAt(s, th);
        const k = j * (SEGS + 1) + i;
        // the grip flattens the bag a little into an oval
        const flat = 1 - 0.11 * Math.exp(-Math.pow((s - 0.55) / 0.17, 2)) * (0.4 + this.morph.squeeze);
        const x = Math.cos(th) * r;
        const z = Math.sin(th) * r * flat;
        this.pos.setXYZ(k, x, y, z);
        const inner = 0.965;
        const capY = s > line ? LENGTH * line : y;
        const shrink = s > line ? 0.25 : 1;
        this.creamPos.setXYZ(
          k,
          x * inner * shrink,
          capY,
          z * inner * shrink,
        );
      }
    }
    this.pos.needsUpdate = true;
    this.creamPos.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.creamGeo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    this.creamGeo.computeBoundingSphere();
  }

  /** World-space length used to place the hand. */
  static get length(): number {
    return LENGTH;
  }
}
