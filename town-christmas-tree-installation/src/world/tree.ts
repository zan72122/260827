import * as THREE from 'three';
import { Rng } from '../core/rng';
import { Spring, mergeSimple, taperedTube } from '../game/geom';

export interface TreeSpec {
  height: number;
  buttRadius: number;
  crownRadius: number;
  whorls: number;
  lean: number;
  gapAzimuth: number;
  palette: [number, number, number];
}

interface Band {
  group: THREE.Group;
  pitch: Spring;
  roll: Spring;
  weight: number;
  phase: number;
}

/**
 * A procedurally grown natural conifer: swept trunk, whorled branches with
 * asymmetric length and a wind-thinned side, foliage split into vertical
 * bands so the crown can lag behind the trunk when the crane moves it.
 */
export class ConiferTree {
  readonly root = new THREE.Group();
  readonly spec: TreeSpec;
  readonly lod = new THREE.LOD();

  private bands: Band[] = [];
  private spine: THREE.Vector3[] = [];
  private trunkRadii: number[] = [];
  private needleMat: THREE.MeshStandardMaterial;
  readonly trunkMesh: THREE.Mesh;
  private wind = 0;
  private disposed: THREE.BufferGeometry[] = [];

  constructor(rng: Rng, barkMaterial: THREE.Material, lodBias: number) {
    const height = rng.range(12.5, 17.8);
    const spec: TreeSpec = {
      height,
      buttRadius: height * rng.range(0.0155, 0.019),
      crownRadius: height * rng.range(0.205, 0.245),
      whorls: Math.round(height * rng.range(1.7, 2.05)),
      lean: rng.range(-0.035, 0.035),
      gapAzimuth: rng.range(0, Math.PI * 2),
      palette: [
        new THREE.Color(0x1b3122).offsetHSL(rng.jitter(0.02), rng.jitter(0.05), rng.jitter(0.02)).getHex(),
        new THREE.Color(0x2d4a2f).offsetHSL(rng.jitter(0.02), rng.jitter(0.05), rng.jitter(0.02)).getHex(),
        new THREE.Color(0x436a3c).offsetHSL(rng.jitter(0.02), rng.jitter(0.05), rng.jitter(0.03)).getHex(),
      ],
    };
    this.spec = spec;

    // ---- trunk spine: a real tree is never straight ----------------------
    const segs = 40;
    const sweepA = rng.range(0.2, 0.6);
    const sweepPhase = rng.range(0, Math.PI * 2);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const y = t * spec.height;
      const x =
        Math.sin(t * Math.PI * sweepA + sweepPhase) * spec.height * 0.012 +
        spec.lean * y +
        Math.sin(t * 11.3 + sweepPhase) * 0.035;
      const z = Math.cos(t * Math.PI * 0.8 + sweepPhase * 1.7) * spec.height * 0.008;
      this.spine.push(new THREE.Vector3(x, y, z));
      this.trunkRadii.push(spec.buttRadius * Math.pow(1 - t, 1.18) + 0.019 + Math.sin(t * 23) * 0.004);
    }

    const trunkGeom = taperedTube(this.spine, this.trunkRadii, 12);
    this.disposed.push(trunkGeom);
    this.trunkMesh = new THREE.Mesh(trunkGeom, barkMaterial);
    this.trunkMesh.castShadow = true;
    this.trunkMesh.receiveShadow = true;
    this.root.add(this.trunkMesh);

    // ---- foliage --------------------------------------------------------
    this.needleMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0,
      side: THREE.DoubleSide,
    });

    const bandCount = 7;
    const bandGeoms: THREE.BufferGeometry[][] = Array.from({ length: bandCount }, () => []);
    const coarseGeoms: THREE.BufferGeometry[] = [];
    const bandY: number[] = [];
    for (let b = 0; b < bandCount; b++) bandY.push(0.19 * spec.height + (b / bandCount) * 0.8 * spec.height);

    const detail = Math.max(0.55, Math.min(1.3, lodBias));
    for (let w = 0; w < spec.whorls; w++) {
      // Whorls crowd toward the leader, as they do on a real spruce.
      const t = 0.19 + Math.pow(w / (spec.whorls - 1), 0.82) * 0.79;
      const y = t * spec.height;
      const base = this.trunkPointLocal(y);
      const bandIndex = Math.min(bandCount - 1, Math.max(0, Math.floor(((y - bandY[0]) / (spec.height * 0.8)) * bandCount)));
      const pivot = new THREE.Vector3(0, bandY[bandIndex], 0);

      const perWhorl = Math.max(5, Math.round(9.4 - t * 3.0 + rng.jitter(0.9)));
      const az0 = rng.range(0, Math.PI * 2);
      for (let i = 0; i < perWhorl; i++) {
        const az = az0 + (i / perWhorl) * Math.PI * 2 + rng.jitter(0.28);
        // The wind-shadowed side grows thinner; leave a believable gap.
        const gap = Math.cos(az - spec.gapAzimuth);
        if (gap > 0.9 && rng.bool(0.45)) continue;
        const asym = 1 + 0.2 * Math.cos(az - spec.gapAzimuth + Math.PI) + rng.jitter(0.17);
        const len = Math.max(0.55, spec.crownRadius * Math.pow(1 - t, 0.55)) * asym * rng.range(0.84, 1.14);
        if (len < 0.3) continue;
        const droop = THREE.MathUtils.lerp(-0.4, 0.26, t) + rng.jitter(0.12);
        const geo = this.buildBranch(rng, base, pivot, az, droop, len, t, detail);
        bandGeoms[bandIndex].push(geo);
        if (rng.bool(0.4)) {
          coarseGeoms.push(this.buildBranch(rng, base, new THREE.Vector3(), az, droop, len * 1.12, t, 0.4));
        }
      }
    }

    // Leader / top shoot.
    {
      const top = this.trunkPointLocal(spec.height * 0.985);
      const g = this.buildBranch(rng, top, new THREE.Vector3(0, bandY[bandCount - 1], 0), rng.range(0, 6.28), 1.2, spec.height * 0.05, 0.99, detail);
      bandGeoms[bandCount - 1].push(g);
    }

    const high = new THREE.Group();
    for (let b = 0; b < bandCount; b++) {
      const g = new THREE.Group();
      g.position.set(0, bandY[b], 0);
      if (bandGeoms[b].length) {
        const merged = mergeSimple(bandGeoms[b]);
        merged.computeVertexNormals();
        this.disposed.push(merged);
        const mesh = new THREE.Mesh(merged, this.needleMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        g.add(mesh);
      }
      for (const geo of bandGeoms[b]) geo.dispose();
      high.add(g);
      this.bands.push({
        group: g,
        pitch: new Spring(0, 34, 7.4),
        roll: new Spring(0, 34, 7.4),
        weight: 0.22 + (b / (bandCount - 1)) * 1.0,
        phase: rng.range(0, Math.PI * 2),
      });
    }

    const coarse = new THREE.Group();
    if (coarseGeoms.length) {
      const merged = mergeSimple(coarseGeoms);
      merged.computeVertexNormals();
      this.disposed.push(merged);
      coarse.add(new THREE.Mesh(merged, this.needleMat));
      for (const geo of coarseGeoms) geo.dispose();
    }

    this.lod.addLevel(high, 0);
    this.lod.addLevel(coarse, 62);
    this.root.add(this.lod);
  }

  /** Point on the (curved) trunk axis at local height y. */
  trunkPointLocal(y: number): THREE.Vector3 {
    const t = THREE.MathUtils.clamp(y / this.spec.height, 0, 1);
    const f = t * (this.spine.length - 1);
    const i = Math.min(this.spine.length - 2, Math.floor(f));
    return this.spine[i].clone().lerp(this.spine[i + 1], f - i);
  }

  trunkRadiusAt(y: number): number {
    const t = THREE.MathUtils.clamp(y / this.spec.height, 0, 1);
    const f = t * (this.trunkRadii.length - 1);
    const i = Math.min(this.trunkRadii.length - 2, Math.floor(f));
    return THREE.MathUtils.lerp(this.trunkRadii[i], this.trunkRadii[i + 1], f - i);
  }

  /** Approximate outer foliage radius, used for cords and guy wires. */
  crownRadiusAt(y: number): number {
    const t = THREE.MathUtils.clamp(y / this.spec.height, 0, 1);
    return Math.max(0.3, this.spec.crownRadius * Math.pow(1 - t, 0.55));
  }

  worldTrunkPoint(y: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.trunkPointLocal(y)).applyMatrix4(this.root.matrixWorld);
  }

  /** The two wide, forgiving zones where the slings belong. */
  get slingHeights(): [number, number] {
    return [this.spec.height * 0.3, this.spec.height * 0.56];
  }

  get tagLineHeight(): number {
    return this.spec.height * 0.84;
  }

  private buildBranch(
    rng: Rng,
    base: THREE.Vector3,
    pivot: THREE.Vector3,
    az: number,
    droop: number,
    len: number,
    t: number,
    detail: number,
  ): THREE.BufferGeometry {
    const segs = Math.max(3, Math.round(THREE.MathUtils.lerp(7, 4, t) * detail));
    const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const spine: THREE.Vector3[] = [];
    const radii: number[] = [];
    const curl = droop - rng.range(0.25, 0.55);
    for (let i = 0; i <= segs; i++) {
      const s = i / segs;
      const rise = THREE.MathUtils.lerp(droop, curl, s * s) * len * s;
      const p = base
        .clone()
        .addScaledVector(dir, len * s)
        .add(new THREE.Vector3(0, rise, 0))
        .sub(pivot);
      p.x += Math.sin(s * 6 + az) * len * 0.02;
      p.z += Math.cos(s * 5.3 + az) * len * 0.02;
      spine.push(p);
      radii.push(Math.max(0.006, Math.min(0.07, len * 0.022) * (1 - s * 0.82)));
    }

    const stick = taperedTube(spine, radii, 5, false);
    const brown = new THREE.Color(0x5a4530);
    const scol: number[] = [];
    const scount = (stick.getAttribute('position') as THREE.BufferAttribute).count;
    for (let i = 0; i < scount; i++) scol.push(brown.r, brown.g, brown.b);
    stick.setAttribute('color', new THREE.Float32BufferAttribute(scol, 3));

    const needles = this.buildNeedles(rng, spine, len, t, detail);
    const out = mergeSimple([stick, needles]);
    stick.dispose();
    needles.dispose();
    return out;
  }

  /**
   * Needle mass as alternating tufts on three planes around the branch axis.
   * Individual needles are never modelled — this is a few dozen triangles that
   * silhouette correctly from every angle.
   */
  private buildNeedles(
    rng: Rng,
    spine: THREE.Vector3[],
    len: number,
    t: number,
    detail: number,
  ): THREE.BufferGeometry {
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const pal = this.spec.palette.map((h) => new THREE.Color(h));
    const snowy = new THREE.Color(0xdfe8ef);
    const planes = detail > 0.6 ? 3 : 2;
    const perSeg = detail > 0.6 ? 6 : 3;
    const tangent = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const bnm = new THREE.Vector3();
    const start = Math.max(0, Math.floor(spine.length * 0.06));

    for (let i = start; i < spine.length - 1; i++) {
      const a = spine[i];
      const b = spine[i + 1];
      tangent.copy(b).sub(a).normalize();
      nrm.set(0, 1, 0).cross(tangent);
      if (nrm.lengthSq() < 1e-6) nrm.set(1, 0, 0);
      nrm.normalize();
      bnm.crossVectors(tangent, nrm).normalize();
      const s = i / (spine.length - 1);
      // Needle sprays get finer toward the tip of the branch.
      const w = len * (0.185 - 0.075 * s) * (1 - t * 0.18);

      for (let k = 0; k < perSeg; k++) {
        const along = (k + 0.5) / perSeg;
        const root = a.clone().lerp(b, along);
        const seg = a.clone().lerp(b, Math.min(1, along + 0.34 / perSeg));
        for (let p = 0; p < planes; p++) {
          const ang = (p / planes) * Math.PI + rng.jitter(0.3) + i * 0.5;
          const d = nrm.clone().multiplyScalar(Math.cos(ang)).addScaledVector(bnm, Math.sin(ang));
          for (const sign of [1, -1]) {
            const width = w * rng.range(0.7, 1.35);
            // Apex sweeps outward and back along the branch, like real needles.
            const tip = root
              .clone()
              .addScaledVector(d, width * sign)
              .addScaledVector(tangent, -len * rng.range(0.012, 0.042))
              .add(new THREE.Vector3(0, -width * 0.3, 0));
            const shade = pal[rng.int(0, 2)].clone();
            shade.offsetHSL(rng.jitter(0.012), rng.jitter(0.06), rng.jitter(0.05) + s * 0.04);
            const up = d.y * sign;
            if (up > 0.4 && rng.bool(0.18)) shade.lerp(snowy, rng.range(0.15, 0.5));
            for (const v of [root, seg, tip]) {
              pos.push(v.x, v.y, v.z);
              col.push(shade.r, shade.g, shade.b);
              uv.push(0, 0);
            }
          }
        }
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }

  /**
   * Drive the crown lag. `angAccel` is the trunk's angular acceleration and
   * `linAccel` its vertical acceleration; both make the branches trail.
   */
  setDynamics(angAccel: number, linAccel: number): void {
    for (const band of this.bands) {
      band.pitch.velocity += -angAccel * band.weight * 0.0016;
      band.roll.velocity += -linAccel * band.weight * 0.0011;
    }
  }

  /** A knock: ground contact, socket landing, a sling snapping tight. */
  impulse(strength: number): void {
    for (const band of this.bands) {
      band.pitch.velocity += strength * band.weight * (0.6 + Math.random() * 0.8);
      band.roll.velocity += strength * band.weight * (Math.random() - 0.5) * 1.2;
    }
  }

  update(dt: number, time: number, windStrength: number): void {
    this.wind = windStrength;
    for (const band of this.bands) {
      const breeze = Math.sin(time * 0.9 + band.phase) * this.wind * 0.012 * band.weight;
      band.pitch.step(breeze, dt);
      band.roll.step(Math.cos(time * 0.7 + band.phase * 1.3) * this.wind * 0.01 * band.weight, dt);
      band.group.rotation.set(band.pitch.value, 0, band.roll.value);
    }
  }

  updateLod(camera: THREE.Camera): void {
    this.lod.update(camera);
  }

  dispose(): void {
    for (const g of this.disposed) g.dispose();
    this.needleMat.dispose();
  }
}
