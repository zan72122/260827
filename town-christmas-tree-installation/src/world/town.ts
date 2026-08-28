import * as THREE from 'three';
import { Rng } from '../core/rng';
import { Materials } from './materials';
import { mergeSimple } from '../game/geom';
import type { QualitySettings } from '../core/quality';

/** Collects geometry per material so a whole building is a handful of draws. */
class PartBin {
  private bins = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(mat: THREE.Material, geo: THREE.BufferGeometry, matrix?: THREE.Matrix4): void {
    if (matrix) geo.applyMatrix4(matrix);
    const list = this.bins.get(mat) ?? [];
    list.push(geo);
    this.bins.set(mat, list);
  }

  flush(parent: THREE.Object3D, castShadow = true, receiveShadow = true): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, list] of this.bins) {
      if (!list.length) continue;
      const merged = mergeSimple(list);
      merged.computeVertexNormals();
      for (const g of list) g.dispose();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      parent.add(mesh);
      out.push(mesh);
    }
    this.bins.clear();
    return out;
  }
}

interface WindowSlot {
  position: THREE.Vector3;
  rotationY: number;
  width: number;
  height: number;
  order: number;
}

/**
 * One coherent architectural culture: rendered lime façades, steep pantile
 * gables facing the square, timber shutters and shopfronts, an arcaded town
 * hall with a clock tower. No mixed idioms, no flat backdrop cards.
 */
export class Town {
  readonly root = new THREE.Group();
  readonly socket = new THREE.Group();
  readonly barriers = new THREE.Group();
  readonly socketPosition = new THREE.Vector3(0, 0, 0);

  private litWindows!: THREE.InstancedMesh;
  private lanterns!: THREE.InstancedMesh;
  private windowSlots: WindowSlot[] = [];
  private lanternPositions: THREE.Vector3[] = [];
  private windowMat: THREE.MeshStandardMaterial;
  private lanternMat: THREE.MeshStandardMaterial;
  readonly groundY = 0;

  constructor(
    private m: Materials,
    rng: Rng,
    quality: QualitySettings,
  ) {
    this.windowMat = new THREE.MeshStandardMaterial({
      color: 0x120d07,
      emissive: 0xf0ad63,
      emissiveIntensity: 0.8,
      roughness: 0.6,
      metalness: 0,
      transparent: true,
      opacity: 1,
    });
    this.lanternMat = new THREE.MeshStandardMaterial({
      color: 0x1a1408,
      emissive: 0xffd79a,
      emissiveIntensity: 1.6,
      roughness: 0.5,
      metalness: 0,
    });

    this.buildGround(rng);
    this.buildBuildings(rng);
    this.buildTownHall(rng);
    this.buildStreetFurniture(rng);
    this.buildSocket();
    this.buildBarriers(rng);
    this.buildMountains(rng);
    this.buildWindowInstances();
    void quality;
  }

  // -------------------------------------------------------------- ground --
  private buildGround(rng: Rng): void {
    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(66, 66, 1, 1), this.m.cobble);
    plaza.rotation.x = -Math.PI / 2;
    plaza.receiveShadow = true;
    this.root.add(plaza);

    const outer = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), this.m.snow);
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.05;
    outer.receiveShadow = true;
    this.root.add(outer);

    // Ploughed snow along the plaza edges — irregular, never mirrored.
    const bin = new PartBin();
    for (let i = 0; i < 44; i++) {
      const edge = i % 4;
      const t = rng.range(-30, 30);
      const off = 30 - rng.range(0.4, 2.6);
      const p =
        edge === 0
          ? new THREE.Vector3(t, 0, -off)
          : edge === 1
            ? new THREE.Vector3(t, 0, off)
            : edge === 2
              ? new THREE.Vector3(-off, 0, t)
              : new THREE.Vector3(off, 0, t);
      const g = new THREE.SphereGeometry(rng.range(0.7, 2.1), 8, 5);
      g.scale(rng.range(1.2, 3.0), rng.range(0.22, 0.42), rng.range(0.7, 1.3));
      g.translate(p.x, 0.02, p.z);
      bin.add(this.m.snow, g);
    }
    // Snow crust in the corners of the square where nobody walks.
    for (let i = 0; i < 26; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(15, 28);
      const g = new THREE.CircleGeometry(rng.range(1.4, 4.2), 10);
      g.rotateX(-Math.PI / 2);
      g.scale(1, 1, rng.range(0.5, 1.4));
      g.translate(Math.cos(a) * r, 0.012, Math.sin(a) * r);
      bin.add(this.m.snow, g);
    }
    bin.flush(this.root, false, true);
  }

  // ----------------------------------------------------------- buildings --
  private addWindowRow(
    bin: PartBin,
    rng: Rng,
    origin: THREE.Vector3,
    rotationY: number,
    count: number,
    spacing: number,
    y: number,
    w: number,
    h: number,
    shutters: boolean,
  ): void {
    const dir = new THREE.Vector3(Math.cos(rotationY), 0, -Math.sin(rotationY));
    const nrm = new THREE.Vector3(Math.sin(rotationY), 0, Math.cos(rotationY));
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * spacing;
      const p = origin.clone().addScaledVector(dir, off);
      p.y = y;
      // Reveal, sill and dark glass.
      const reveal = new THREE.BoxGeometry(w + 0.16, h + 0.16, 0.1);
      reveal.applyMatrix4(new THREE.Matrix4().makeRotationY(rotationY));
      reveal.translate(p.x + nrm.x * 0.02, p.y, p.z + nrm.z * 0.02);
      bin.add(this.m.stuccoC, reveal);

      const glass = new THREE.BoxGeometry(w, h, 0.06);
      glass.applyMatrix4(new THREE.Matrix4().makeRotationY(rotationY));
      glass.translate(p.x + nrm.x * 0.06, p.y, p.z + nrm.z * 0.06);
      bin.add(this.m.windowGlass, glass);

      // Glazing bars.
      const barV = new THREE.BoxGeometry(0.05, h, 0.09);
      barV.applyMatrix4(new THREE.Matrix4().makeRotationY(rotationY));
      barV.translate(p.x + nrm.x * 0.08, p.y, p.z + nrm.z * 0.08);
      bin.add(this.m.woodTrim, barV);
      const barH = new THREE.BoxGeometry(w, 0.05, 0.09);
      barH.applyMatrix4(new THREE.Matrix4().makeRotationY(rotationY));
      barH.translate(p.x + nrm.x * 0.08, p.y + h * 0.12, p.z + nrm.z * 0.08);
      bin.add(this.m.woodTrim, barH);

      const sill = new THREE.BoxGeometry(w + 0.3, 0.09, 0.26);
      sill.applyMatrix4(new THREE.Matrix4().makeRotationY(rotationY));
      sill.translate(p.x + nrm.x * 0.12, p.y - h / 2 - 0.06, p.z + nrm.z * 0.12);
      bin.add(this.m.stuccoC, sill);

      if (shutters) {
        for (const s of [-1, 1]) {
          if (rng.bool(0.18)) continue;
          const sh = new THREE.BoxGeometry(w * 0.5, h, 0.05);
          sh.applyMatrix4(new THREE.Matrix4().makeRotationY(rotationY));
          const lat = dir.clone().multiplyScalar(s * (w * 0.76));
          sh.translate(p.x + lat.x + nrm.x * 0.13, p.y, p.z + lat.z + nrm.z * 0.13);
          bin.add(this.m.woodTrim, sh);
        }
      }

      this.windowSlots.push({
        position: new THREE.Vector3(p.x + nrm.x * 0.09, p.y, p.z + nrm.z * 0.09),
        rotationY,
        width: w * 0.94,
        height: h * 0.94,
        order: rng.next(),
      });
    }
  }

  private gableRoof(bin: PartBin, rng: Rng, w: number, d: number, wallTop: number, ridge: number, cx: number, cz: number, ry: number): void {
    const half = w / 2 + 0.35;
    const rise = ridge - wallTop;
    const slope = Math.atan2(rise, half);
    const slabLen = Math.hypot(half, rise);
    const rot = new THREE.Matrix4().makeRotationY(ry);
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(slabLen, 0.16, d + 0.7);
      g.translate(0, 0, 0);
      const mat = new THREE.Matrix4()
        .makeRotationZ(-s * slope)
        .setPosition((s * half) / 2, wallTop + rise / 2, 0);
      g.applyMatrix4(mat);
      g.applyMatrix4(rot);
      g.translate(cx, 0, cz);
      bin.add(this.m.roof, g);
    }
    // Gable walls close the prism so the roof is solid from every angle.
    for (const s of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2, 0);
      shape.lineTo(w / 2, 0);
      shape.lineTo(0, rise);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.28, bevelEnabled: false });
      g.translate(0, wallTop, s * (d / 2) - (s > 0 ? 0 : 0.28));
      g.applyMatrix4(rot);
      g.translate(cx, 0, cz);
      bin.add(this.m.stuccoC, g);
    }
    // Ridge cap and a chimney.
    const ridgeCap = new THREE.BoxGeometry(0.3, 0.2, d + 0.7);
    ridgeCap.applyMatrix4(rot);
    ridgeCap.translate(cx, ridge, cz);
    bin.add(this.m.roof, ridgeCap);

    const chx = rng.range(-w * 0.25, w * 0.25);
    const chz = rng.range(-d * 0.3, d * 0.3);
    const chHeight = wallTop + rise * (1 - Math.abs(chx) / half) + rng.range(0.8, 1.6);
    const ch = new THREE.BoxGeometry(0.7, chHeight - wallTop + 1.4, 0.7);
    ch.applyMatrix4(new THREE.Matrix4().makeTranslation(chx, wallTop + (chHeight - wallTop + 1.4) / 2 - 0.7, chz));
    ch.applyMatrix4(rot);
    ch.translate(cx, 0, cz);
    bin.add(this.m.stuccoB, ch);
    const cap = new THREE.BoxGeometry(0.92, 0.14, 0.92);
    cap.applyMatrix4(new THREE.Matrix4().makeTranslation(chx, chHeight + 0.75, chz));
    cap.applyMatrix4(rot);
    cap.translate(cx, 0, cz);
    bin.add(this.m.roof, cap);
  }

  private buildBuildings(rng: Rng): void {
    const stuccos = [this.m.stuccoA, this.m.stuccoB, this.m.stuccoC];
    // Four terraces around the square, with street gaps left open.
    const sides: { ry: number; nx: number; nz: number; along: THREE.Vector3 }[] = [
      { ry: 0, nx: 0, nz: -1, along: new THREE.Vector3(1, 0, 0) },
      { ry: Math.PI, nx: 0, nz: 1, along: new THREE.Vector3(1, 0, 0) },
      { ry: Math.PI / 2, nx: -1, nz: 0, along: new THREE.Vector3(0, 0, 1) },
      { ry: -Math.PI / 2, nx: 1, nz: 0, along: new THREE.Vector3(0, 0, 1) },
    ];

    sides.forEach((side, si) => {
      // The town hall occupies the north side; skip it here.
      let cursor = -33;
      const limit = 33;
      let guard = 0;
      while (cursor < limit && guard++ < 40) {
        const w = rng.range(6.4, 10.6);
        if (si === 1 && Math.abs(cursor + w / 2) < 17) {
          cursor += w + 0.4;
          continue;
        }
        // Street gaps.
        if (rng.bool(0.16)) {
          cursor += rng.range(6.0, 7.6);
          continue;
        }
        const d = rng.range(9.5, 13.5);
        const storeys = rng.int(2, 3);
        const wallTop = 3.2 + storeys * 2.9;
        const ridge = wallTop + rng.range(3.4, 5.2);
        const centreAlong = cursor + w / 2;
        const dist = 30 + d / 2;
        const cx = side.along.x * centreAlong + side.nx * dist;
        const cz = side.along.z * centreAlong + side.nz * dist;

        const bin = new PartBin();
        const wall = stuccos[rng.int(0, 2)];
        const body = new THREE.BoxGeometry(w, wallTop, d);
        body.applyMatrix4(new THREE.Matrix4().makeRotationY(side.ry));
        body.translate(cx, wallTop / 2, cz);
        bin.add(wall, body);

        // Plinth course.
        const plinth = new THREE.BoxGeometry(w + 0.2, 0.75, d + 0.2);
        plinth.applyMatrix4(new THREE.Matrix4().makeRotationY(side.ry));
        plinth.translate(cx, 0.37, cz);
        bin.add(this.m.stuccoC, plinth);

        // Façade toward the square.
        const faceOffset = new THREE.Vector3(-side.nx, 0, -side.nz).multiplyScalar(d / 2 + 0.02);
        const facadeOrigin = new THREE.Vector3(cx + faceOffset.x, 0, cz + faceOffset.z);
        const facadeRot = Math.atan2(-side.nz, -side.nx) + Math.PI / 2;
        const cols = Math.max(2, Math.floor(w / 2.6));
        for (let s = 0; s < storeys; s++) {
          this.addWindowRow(
            bin,
            rng,
            facadeOrigin,
            facadeRot,
            cols,
            w / cols,
            3.7 + s * 2.9,
            1.0,
            1.65,
            true,
          );
        }
        // Shopfront: timber fascia, glazing, sign bracket.
        const fascia = new THREE.BoxGeometry(w * 0.86, 0.55, 0.22);
        fascia.applyMatrix4(new THREE.Matrix4().makeRotationY(facadeRot));
        fascia.translate(facadeOrigin.x - side.nx * 0.12, 3.05, facadeOrigin.z - side.nz * 0.12);
        bin.add(this.m.woodTrim, fascia);
        this.addWindowRow(bin, rng, facadeOrigin, facadeRot, Math.max(2, cols - 1), w / Math.max(2, cols - 1), 1.9, 1.35, 1.9, false);

        this.gableRoof(bin, rng, w, d, wallTop, ridge, cx, cz, side.ry);
        bin.flush(this.root);

        cursor += w + rng.range(0.15, 0.5);
      }
    });
  }

  private buildTownHall(rng: Rng): void {
    const bin = new PartBin();
    const w = 30;
    const d = 15;
    const wallTop = 13.5;
    const cz = 30 + d / 2;
    const body = new THREE.BoxGeometry(w, wallTop, d);
    body.translate(0, wallTop / 2, cz);
    bin.add(this.m.stuccoA, body);
    const plinth = new THREE.BoxGeometry(w + 0.4, 1.0, d + 0.4);
    plinth.translate(0, 0.5, cz);
    bin.add(this.m.stuccoC, plinth);

    // Ground-floor arcade: real piers and arches, not a painted strip.
    const bays = 7;
    for (let i = 0; i <= bays; i++) {
      const x = -w / 2 + 1.4 + (i * (w - 2.8)) / bays;
      const pier = new THREE.BoxGeometry(1.25, 4.6, 2.2);
      pier.translate(x, 2.3, cz - d / 2 - 0.9);
      bin.add(this.m.stuccoC, pier);
    }
    for (let i = 0; i < bays; i++) {
      const x = -w / 2 + 1.4 + ((i + 0.5) * (w - 2.8)) / bays;
      const span = (w - 2.8) / bays - 1.25;
      const arch = new THREE.TorusGeometry(span / 2, 0.34, 8, 14, Math.PI);
      arch.rotateY(Math.PI / 2);
      arch.rotateZ(0);
      const mtx = new THREE.Matrix4().makeRotationY(Math.PI / 2);
      arch.applyMatrix4(mtx);
      arch.translate(x, 4.6, cz - d / 2 - 0.9);
      bin.add(this.m.stuccoC, arch);
      const lintel = new THREE.BoxGeometry(span, 0.5, 2.2);
      lintel.translate(x, 5.35, cz - d / 2 - 0.9);
      bin.add(this.m.stuccoC, lintel);
    }
    const cornice = new THREE.BoxGeometry(w + 0.9, 0.5, d + 0.9);
    cornice.translate(0, wallTop - 0.3, cz);
    bin.add(this.m.stuccoC, cornice);

    const facadeOrigin = new THREE.Vector3(0, 0, cz - d / 2 - 0.02);
    for (let s = 0; s < 2; s++) {
      this.addWindowRow(bin, rng, facadeOrigin, 0, 9, 3.05, 7.6 + s * 3.2, 1.25, 2.1, true);
    }
    // Balcony over the ceremonial doorway.
    const balcony = new THREE.BoxGeometry(6.4, 0.3, 1.5);
    balcony.translate(0, 6.0, cz - d / 2 - 0.7);
    bin.add(this.m.stuccoC, balcony);
    for (let i = -4; i <= 4; i++) {
      const bal = new THREE.CylinderGeometry(0.07, 0.07, 0.8, 6);
      bal.translate(i * 0.72, 6.55, cz - d / 2 - 1.3);
      bin.add(this.m.stuccoC, bal);
    }

    this.gableRoof(bin, rng, w, d, wallTop, wallTop + 5.4, 0, cz, 0);

    // Clock tower.
    const tx = -w / 2 + 3.4;
    const towerH = 26;
    const tower = new THREE.BoxGeometry(5.2, towerH, 5.2);
    tower.translate(tx, towerH / 2, cz + 1.2);
    bin.add(this.m.stuccoA, tower);
    const belfry = new THREE.BoxGeometry(6.0, 3.2, 6.0);
    belfry.translate(tx, towerH + 1.4, cz + 1.2);
    bin.add(this.m.stuccoC, belfry);
    for (const [ox, oz, ry] of [
      [0, -3.05, 0],
      [3.05, 0, Math.PI / 2],
    ] as [number, number, number][]) {
      const face = new THREE.CylinderGeometry(1.35, 1.35, 0.2, 20);
      face.rotateX(Math.PI / 2);
      face.applyMatrix4(new THREE.Matrix4().makeRotationY(ry));
      face.translate(tx + ox, towerH - 2.6, cz + 1.2 + oz);
      bin.add(this.m.stuccoC, face);
      const hand = new THREE.BoxGeometry(0.12, 1.0, 0.1);
      hand.applyMatrix4(new THREE.Matrix4().makeRotationY(ry));
      hand.translate(tx + ox * 1.05, towerH - 2.2, cz + 1.2 + oz * 1.05);
      bin.add(this.m.woodTrim, hand);
      const hand2 = new THREE.BoxGeometry(0.7, 0.1, 0.1);
      hand2.applyMatrix4(new THREE.Matrix4().makeRotationY(ry));
      hand2.translate(tx + ox * 1.05 - 0.25, towerH - 2.6, cz + 1.2 + oz * 1.05);
      bin.add(this.m.woodTrim, hand2);
    }
    // Slender spire.
    const spire = new THREE.ConeGeometry(4.1, 8.5, 4);
    spire.rotateY(Math.PI / 4);
    spire.translate(tx, towerH + 3.0 + 4.25, cz + 1.2);
    bin.add(this.m.roof, spire);
    const finial = new THREE.SphereGeometry(0.34, 10, 8);
    finial.translate(tx, towerH + 7.7, cz + 1.2);
    bin.add(this.m.starMetal, finial);

    bin.flush(this.root);
  }

  private buildStreetFurniture(rng: Rng): void {
    const bin = new PartBin();
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.26;
      const r = 25;
      ring.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    for (const p of ring) {
      const base = new THREE.CylinderGeometry(0.34, 0.42, 0.6, 10);
      base.translate(p.x, 0.3, p.z);
      bin.add(this.m.steelDark, base);
      const pole = new THREE.CylinderGeometry(0.1, 0.14, 4.4, 10);
      pole.translate(p.x, 2.5, p.z);
      bin.add(this.m.steelDark, pole);
      const arm = new THREE.CylinderGeometry(0.07, 0.07, 0.7, 8);
      arm.rotateZ(Math.PI / 2);
      arm.translate(p.x + 0.3, 4.7, p.z);
      bin.add(this.m.steelDark, arm);
      const hood = new THREE.ConeGeometry(0.42, 0.4, 8);
      hood.translate(p.x + 0.6, 5.2, p.z);
      bin.add(this.m.steelDark, hood);
      const cage = new THREE.BoxGeometry(0.5, 0.6, 0.5);
      cage.translate(p.x + 0.6, 4.75, p.z);
      bin.add(this.m.steelDark, cage);
      this.lanternPositions.push(new THREE.Vector3(p.x + 0.6, 4.75, p.z));
    }

    // A row of shuttered market stalls gives the mid-ground depth.
    for (let i = 0; i < 5; i++) {
      const x = -22 + i * 4.4;
      const z = -23 + rng.jitter(1.2);
      const w = 3.2;
      const legs = new THREE.BoxGeometry(w, 1.0, 2.0);
      legs.translate(x, 0.5, z);
      bin.add(this.m.woodTrim, legs);
      const counter = new THREE.BoxGeometry(w + 0.3, 0.12, 2.2);
      counter.translate(x, 1.06, z);
      bin.add(this.m.woodTrim, counter);
      for (const s of [-1, 1]) {
        const post = new THREE.BoxGeometry(0.1, 2.4, 0.1);
        post.translate(x + (s * w) / 2, 1.2, z - 0.9);
        bin.add(this.m.woodTrim, post);
        const post2 = new THREE.BoxGeometry(0.1, 2.4, 0.1);
        post2.translate(x + (s * w) / 2, 1.2, z + 0.9);
        bin.add(this.m.woodTrim, post2);
      }
      for (const s of [-1, 1]) {
        const canopy = new THREE.BoxGeometry(w + 0.5, 0.08, 1.35);
        canopy.applyMatrix4(new THREE.Matrix4().makeRotationX(s * 0.42));
        canopy.translate(x, 2.62, z + s * 0.62);
        bin.add(this.m.roof, canopy);
      }
    }
    bin.flush(this.root);
  }

  // -------------------------------------------------------------- socket --
  private buildSocket(): void {
    const g = this.socket;
    g.position.copy(this.socketPosition);
    this.root.add(g);

    // Reinforced ground socket: collar, ribs, anchor bolts, real depth.
    const apron = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.06, 30), this.m.steelDark);
    apron.position.y = 0.015;
    apron.receiveShadow = true;
    g.add(apron);

    const pit = new THREE.Mesh(new THREE.CylinderGeometry(1.16, 1.16, 0.1, 28), this.m.steelDark);
    pit.position.y = 0.04;
    pit.receiveShadow = true;
    g.add(pit);

    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.02, 0.52, 26, 1, true), this.m.steel);
    collar.position.y = 0.22;
    collar.material.side = THREE.DoubleSide;
    collar.castShadow = true;
    collar.receiveShadow = true;
    g.add(collar);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.08, 8, 30), this.m.steel);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.47;
    rim.castShadow = true;
    g.add(rim);

    // Below-grade tube the butt actually drops into.
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.86, 1.5, 22, 1, true), this.m.steelDark);
    tube.position.y = -0.75;
    tube.material.side = THREE.DoubleSide;
    g.add(tube);
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.14, 20), this.m.steelDark);
    floor.position.y = -1.45;
    g.add(floor);

    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.1), this.m.steel);
      rib.position.set(Math.cos(a) * 1.06, 0.23, Math.sin(a) * 1.06);
      rib.rotation.y = -a;
      rib.castShadow = true;
      g.add(rib);
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 6), this.m.steel);
      bolt.position.set(Math.cos(a) * 1.24, 0.06, Math.sin(a) * 1.24);
      g.add(bolt);
    }
    // Wedge chocks that grip the butt.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const wedge = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.42, 0.5), this.m.steel);
      wedge.position.set(Math.cos(a) * 0.82, 0.28, Math.sin(a) * 0.82);
      wedge.rotation.y = -a;
      g.add(wedge);
    }
    // Guy-wire ground anchors.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.9;
      const anchor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.32, 0.7), this.m.steelDark);
      anchor.position.set(Math.cos(a) * 9.0, 0.16, Math.sin(a) * 9.0);
      anchor.castShadow = true;
      anchor.receiveShadow = true;
      this.root.add(anchor);
      const eye = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 12), this.m.steel);
      eye.position.set(Math.cos(a) * 9.0, 0.42, Math.sin(a) * 9.0);
      eye.rotation.y = -a;
      this.root.add(eye);
      this.anchorPoints.push(new THREE.Vector3(Math.cos(a) * 9.0, 0.42, Math.sin(a) * 9.0));
    }
  }

  readonly anchorPoints: THREE.Vector3[] = [];

  // ------------------------------------------------------------ barriers --
  private buildBarriers(rng: Rng): void {
    this.root.add(this.barriers);
    const bin = new PartBin();
    const panelW = 2.3;
    const path: THREE.Vector3[] = [];
    const rx = 21;
    const rz = 18;
    const steps = 68;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      path.push(new THREE.Vector3(Math.cos(a) * rx, 0, Math.sin(a) * rz));
    }
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      const q = path[(i + 1) % path.length];
      // Leave a gate where the trailer enters.
      const a = Math.atan2(p.z, p.x);
      // Gates: the transport enters from the west, the crane works to the east.
      if (Math.abs(a) < 0.42 || Math.abs(a) > 2.72) continue;
      const mid = p.clone().lerp(q, 0.5);
      const ry = Math.atan2(q.z - p.z, q.x - p.x);
      const len = Math.min(panelW, p.distanceTo(q) * 1.02);
      for (const y of [0.42, 0.86, 1.16]) {
        const bar = new THREE.BoxGeometry(len, 0.06, 0.06);
        bar.applyMatrix4(new THREE.Matrix4().makeRotationY(-ry));
        bar.translate(mid.x, y, mid.z);
        bin.add(this.m.fence, bar);
      }
      for (const s of [-1, 1]) {
        const post = new THREE.BoxGeometry(0.08, 1.2, 0.08);
        const off = new THREE.Vector3(Math.cos(ry), 0, Math.sin(ry)).multiplyScalar((s * len) / 2);
        post.translate(mid.x + off.x, 0.6, mid.z + off.z);
        bin.add(this.m.fence, post);
        const foot = new THREE.BoxGeometry(0.5, 0.09, 0.16);
        foot.applyMatrix4(new THREE.Matrix4().makeRotationY(-ry + Math.PI / 2));
        foot.translate(mid.x + off.x, 0.05, mid.z + off.z);
        bin.add(this.m.fenceFoot, foot);
      }
      if (rng.bool(0.22)) {
        const sign = new THREE.BoxGeometry(0.5, 0.36, 0.03);
        sign.applyMatrix4(new THREE.Matrix4().makeRotationY(-ry));
        sign.translate(mid.x, 0.95, mid.z);
        bin.add(this.m.paintYellow, sign);
      }
    }
    bin.flush(this.barriers, true, false);
  }

  // ------------------------------------------------------------ backdrop --
  private buildMountains(rng: Rng): void {
    const bin = new PartBin();
    for (let i = 0; i < 34; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(170, 320);
      const h = rng.range(38, 95);
      const g = new THREE.ConeGeometry(rng.range(40, 90), h, rng.int(5, 7));
      g.rotateY(rng.range(0, 3));
      g.translate(Math.cos(a) * r, h / 2 - 8, Math.sin(a) * r);
      bin.add(this.m.snow, g);
    }
    const meshes = bin.flush(this.root, false, false);
    for (const mesh of meshes) mesh.renderOrder = -1;
  }

  // ------------------------------------------------------------- windows --
  private buildWindowInstances(): void {
    this.windowSlots.sort((a, b) => a.order - b.order);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.litWindows = new THREE.InstancedMesh(geo, this.windowMat, Math.max(1, this.windowSlots.length));
    this.litWindows.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    this.windowSlots.forEach((w, i) => {
      q.setFromEuler(new THREE.Euler(0, w.rotationY - Math.PI / 2, 0));
      s.set(w.width, w.height, 1);
      mtx.compose(w.position, q, s);
      this.litWindows.setMatrixAt(i, mtx);
    });
    this.litWindows.instanceMatrix.needsUpdate = true;
    this.litWindows.count = 0;
    this.litWindows.frustumCulled = false;
    this.root.add(this.litWindows);

    const lanternGeo = new THREE.SphereGeometry(0.22, 10, 8);
    this.lanterns = new THREE.InstancedMesh(lanternGeo, this.lanternMat, Math.max(1, this.lanternPositions.length));
    this.lanternPositions.forEach((p, i) => {
      mtx.makeTranslation(p.x, p.y, p.z);
      this.lanterns.setMatrixAt(i, mtx);
    });
    this.lanterns.instanceMatrix.needsUpdate = true;
    this.lanterns.count = 0;
    this.lanterns.frustumCulled = false;
    this.root.add(this.lanterns);
  }

  /** 0..1 of façade windows showing warm light. */
  setWindowLit(fraction: number): void {
    const n = Math.round(THREE.MathUtils.clamp(fraction, 0, 1) * this.windowSlots.length);
    this.litWindows.count = n;
  }

  setStreetLit(fraction: number): void {
    this.lanterns.count = Math.round(THREE.MathUtils.clamp(fraction, 0, 1) * this.lanternPositions.length);
  }

  setNightIntensity(t: number): void {
    this.windowMat.emissiveIntensity = 0.35 + t * 1.0;
    this.lanternMat.emissiveIntensity = 0.4 + t * 1.15;
  }
}
