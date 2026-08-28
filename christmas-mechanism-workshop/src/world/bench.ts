import * as THREE from 'three';
import { M } from '../mat/materials';
import { bevelBox, contactShadow, hitBox, lathe, setShadow } from './geo';
import { BENCH_D, BENCH_TOP, BENCH_TOP_THICK, BENCH_W, LIGHTER_HOME,
         TRAY_DX_LANDSCAPE, TRAY_DX_PORTRAIT, TRAY_MAX_X, TRAY_Z } from './layout';
import { Rng, damp } from '../util/math';
import type { Orientation } from '../core/engine';

/* ------------------------------------------------------------------ *
 * The workbench and the near field: the slab, the vice, curled shavings,
 * brass offcuts, the parts tray, and the adult's long gas lighter.
 * ------------------------------------------------------------------ */

export class Bench {
  readonly group = new THREE.Group();

  constructor(shadows: boolean) {
    const m = M();
    const g = this.group;
    const topY = BENCH_TOP - BENCH_TOP_THICK / 2;

    // the top is four laid boards, not one slab: the seams catch the light
    const boards = 4;
    const gap = 0.0042;
    const bw = (BENCH_D - gap * (boards - 1)) / boards;
    const slabGeo = bevelBox(BENCH_W, BENCH_TOP_THICK, bw, 0.0032, 2);
    for (let i = 0; i < boards; i++) {
      const board = new THREE.Mesh(slabGeo, m.benchTop);
      board.position.set(0, topY, -BENCH_D / 2 + bw / 2 + i * (bw + gap));
      board.receiveShadow = shadows;
      board.castShadow = shadows;
      g.add(board);
    }
    // a dark ledger under the seams so the gaps read as gaps
    const under = new THREE.Mesh(
      bevelBox(BENCH_W, 0.012, BENCH_D, 0.002), m.benchFrame);
    under.position.set(0, topY - BENCH_TOP_THICK / 2 - 0.005, 0);
    g.add(under);

    // an apron rail and four legs: it has to look like it could take weight
    const apron = new THREE.Mesh(bevelBox(BENCH_W - 0.12, 0.09, 0.03, 0.002), m.benchFrame);
    apron.position.set(0, BENCH_TOP - 0.12, BENCH_D / 2 - 0.05);
    g.add(apron);
    const apronB = apron.clone();
    apronB.position.z = -BENCH_D / 2 + 0.05;
    g.add(apronB);
    for (const lx of [-BENCH_W / 2 + 0.10, BENCH_W / 2 - 0.10])
      for (const lz of [-BENCH_D / 2 + 0.09, BENCH_D / 2 - 0.09]) {
        const leg = new THREE.Mesh(
          bevelBox(0.075, BENCH_TOP - BENCH_TOP_THICK, 0.075, 0.003), m.benchFrame);
        leg.position.set(lx, (BENCH_TOP - BENCH_TOP_THICK) / 2, lz);
        leg.castShadow = shadows;
        g.add(leg);
      }
    const stretcher = new THREE.Mesh(bevelBox(BENCH_W - 0.3, 0.05, 0.04, 0.002), m.benchFrame);
    stretcher.position.set(0, 0.26, BENCH_D / 2 - 0.09);
    g.add(stretcher);
    const stretcherB = stretcher.clone();
    stretcherB.position.z = -BENCH_D / 2 + 0.09;
    g.add(stretcherB);

    // vice at the left end - the shop tool a child will recognise as "grip"
    const viceJaw = new THREE.Mesh(bevelBox(0.20, 0.10, 0.035, 0.003), m.walnut);
    viceJaw.position.set(-BENCH_W / 2 + 0.20, BENCH_TOP - 0.085, BENCH_D / 2 - 0.02);
    g.add(viceJaw);
    const viceScrew = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.14, 10), m.steel);
    viceScrew.rotation.x = Math.PI / 2;
    viceScrew.position.set(-BENCH_W / 2 + 0.20, BENCH_TOP - 0.085, BENCH_D / 2 + 0.05);
    g.add(viceScrew);
    const viceHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.13, 8), m.steel);
    viceHandle.position.set(-BENCH_W / 2 + 0.20, BENCH_TOP - 0.085, BENCH_D / 2 + 0.115);
    g.add(viceHandle);

    g.add(this.buildShavings(shadows));
    g.add(this.buildOffcuts());
  }

  /** Curled shavings: one ribbon geometry, many instances, near the front edge. */
  private buildShavings(shadows: boolean) {
    const m = M();
    const rng = new Rng(511);
    const count = 20;
    // a shaving is a ribbon that curled off the tool, not a wire loop
    const geo = new THREE.TorusGeometry(0.019, 0.0125, 3, 22, Math.PI * 2.1);
    geo.scale(1, 0.17, 1);
    const mesh = new THREE.InstancedMesh(geo, m.maple, count);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      // shavings gather where the work happens: by the vice and the front edge
      const x = rng.range(-1.15, 0.35) + (rng.next() < 0.3 ? 0.95 : 0);
      const z = rng.range(0.17, BENCH_D / 2 - 0.02);
      e.set(Math.PI / 2 + rng.range(-0.5, 0.5), rng.range(0, Math.PI * 2), rng.range(-0.4, 0.4));
      q.setFromEuler(e);
      const sc = rng.range(0.75, 1.9);
      s.set(sc, sc, sc);
      mtx.compose(new THREE.Vector3(x, BENCH_TOP + 0.007 * sc, z), q, s);
      mesh.setMatrixAt(i, mtx);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    return mesh;
  }

  /** Brass offcuts and pins scattered where brass work was last done. */
  private buildOffcuts() {
    const m = M();
    const grp = new THREE.Group();
    const rng = new Rng(733);
    const pin = new THREE.CylinderGeometry(0.0016, 0.0016, 0.019, 6);
    const pins = new THREE.InstancedMesh(pin, m.brass, 9);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < 9; i++) {
      q.setFromEuler(new THREE.Euler(Math.PI / 2, rng.range(0, 6.28), 0));
      mtx.compose(
        new THREE.Vector3(rng.range(0.80, 1.14), BENCH_TOP + 0.0016, rng.range(0.10, 0.32)),
        q, new THREE.Vector3(1, 1, 1));
      pins.setMatrixAt(i, mtx);
    }
    pins.instanceMatrix.needsUpdate = true;
    grp.add(pins);

    const washer = new THREE.TorusGeometry(0.005, 0.0016, 4, 12);
    const washers = new THREE.InstancedMesh(washer, m.brassDark, 5);
    for (let i = 0; i < 5; i++) {
      q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, rng.range(0, 6.28)));
      mtx.compose(
        new THREE.Vector3(rng.range(-1.16, -0.86), BENCH_TOP + 0.0018, rng.range(0.05, 0.30)),
        q, new THREE.Vector3(1, 1, 1));
      washers.setMatrixAt(i, mtx);
    }
    washers.instanceMatrix.needsUpdate = true;
    grp.add(washers);

    // a small brass-lidded tin of incense cones, sitting where it lives
    const tin = new THREE.Mesh(lathe([
      [0, 0], [0.028, 0], [0.030, 0.004], [0.030, 0.026],
      [0.032, 0.028], [0.030, 0.031], [0, 0.031],
    ], 18), m.brassDark);
    tin.position.set(-0.86, BENCH_TOP, -0.10);
    grp.add(tin);
    return grp;
  }
}

/* ------------------------------------------------------------------ */

/** A shallow tray that holds the parts of whichever machine is being built. */
export class PartsTray {
  readonly group = new THREE.Group();
  private targetPos = new THREE.Vector3();
  private targetRot = 0;
  private anchor = new THREE.Vector3();
  private orientation: Orientation = 'landscape';

  constructor(shadows: boolean) {
    const m = M();
    const w = 0.38, d = 0.19, h = 0.019;
    const base = new THREE.Mesh(bevelBox(w, 0.012, d, 0.002), m.walnut);
    base.position.y = 0.006;
    this.group.add(base);
    const rimLong = bevelBox(w, h, 0.011, 0.0015);
    const rimShort = bevelBox(0.011, h, d - 0.022, 0.0015);
    for (const z of [-d / 2 + 0.0055, d / 2 - 0.0055]) {
      const r = new THREE.Mesh(rimLong, m.walnut);
      r.position.set(0, h / 2, z);
      this.group.add(r);
    }
    for (const x of [-w / 2 + 0.0055, w / 2 - 0.0055]) {
      const r = new THREE.Mesh(rimShort, m.walnut);
      r.position.set(x, h / 2, 0);
      this.group.add(r);
    }
    // two divider strips: it reads as a tray, not a plank
    for (const x of [-w / 5, w / 5]) {
      const div = new THREE.Mesh(bevelBox(0.008, h * 0.7, d - 0.022, 0.001), m.walnut);
      div.position.set(x, h * 0.35, 0);
      this.group.add(div);
    }
    const shadow = contactShadow(0.29, 0.42);
    shadow.position.y = 0.0015;
    shadow.scale.set(1.0, 1, 0.55);
    this.group.add(shadow);
    setShadow(this.group, shadows, shadows);

    this.anchor.set(0, BENCH_TOP, 0);
    this.recompute();
    this.group.position.copy(this.targetPos);
  }

  /** Follow whichever machine is being built. `dx` clears the machine itself. */
  setAnchor(p: THREE.Vector3, dx = TRAY_DX_LANDSCAPE) {
    this.anchor.set(p.x, BENCH_TOP, p.z);
    this.dxLandscape = dx;
    this.recompute();
  }
  private dxLandscape = TRAY_DX_LANDSCAPE;

  private recompute() {
    const dx = this.orientation === 'portrait' ? TRAY_DX_PORTRAIT : this.dxLandscape;
    this.targetPos.set(
      THREE.MathUtils.clamp(this.anchor.x + dx, -TRAY_MAX_X, TRAY_MAX_X),
      BENCH_TOP,
      TRAY_Z,
    );
    this.targetRot = this.orientation === 'portrait' ? 0 : 0.06;
  }

  /** Where the tray will be, without waiting for it to glide there. */
  targetCenter(out = new THREE.Vector3()) {
    return out.copy(this.targetPos).setY(BENCH_TOP + 0.02);
  }

  /**
   * Lay out only the parts the current step needs: one row up to three, two
   * rows beyond that, so the tray never grows wider than a shot can hold.
   */
  layout(objects: THREE.Object3D[], y = 0.013) {
    const n = objects.length;
    const perRow = n > 3 ? Math.ceil(n / 2) : n;
    const rows = Math.ceil(n / perRow);
    const span = Math.min(0.30, (perRow - 1) * 0.082);
    objects.forEach((o, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const inRow = Math.min(perRow, n - row * perRow);
      const s2 = Math.min(0.30, (inRow - 1) * 0.082);
      const x = inRow === 1 ? 0 : -s2 / 2 + (s2 / (inRow - 1)) * col;
      const z = rows === 1 ? 0 : -0.040 + row * 0.080;
      o.position.set(x, y, z);
    });
    this.layoutHalf = Math.max(0.055, span / 2);
  }

  private layoutHalf = 0.055;
  /** How far the laid-out parts reach from the tray centre. */
  get partsHalfWidth() { return this.layoutHalf; }
  set partsHalfWidth(v: number) { this.layoutHalf = v; }
  setOrientation(o: Orientation) {
    this.orientation = o;
    this.recompute();
  }

  update(dt: number) {
    this.group.position.x = damp(this.group.position.x, this.targetPos.x, 5, dt);
    this.group.position.y = damp(this.group.position.y, this.targetPos.y, 5, dt);
    this.group.position.z = damp(this.group.position.z, this.targetPos.z, 5, dt);
    this.group.rotation.y = damp(this.group.rotation.y, this.targetRot, 5, dt);
  }
}

/* ------------------------------------------------------------------ */

/**
 * The adult's long gas lighter.  A child never handles a match here: this
 * is a 30 cm wand with a steel neck, and its flame only exists while it is
 * in hand.  `tip` is where the fire actually is.
 */
export class Lighter {
  readonly group = new THREE.Group();
  readonly tip = new THREE.Object3D();
  readonly hit: THREE.Mesh;
  readonly home = new THREE.Vector3();
  readonly homeQuat = new THREE.Quaternion();
  held = false;

  constructor(shadows: boolean) {
    const m = M();
    const g = this.group;
    // body: moulded grip, slight taper, a worn thumb pad
    const body = new THREE.Mesh(lathe([
      [0, 0], [0.011, 0.002], [0.013, 0.012], [0.0135, 0.052],
      [0.011, 0.070], [0.0085, 0.078], [0.006, 0.082], [0, 0.083],
    ], 16), m.paintTeal);
    g.add(body);
    const guard = new THREE.Mesh(lathe([
      [0, 0], [0.010, 0], [0.011, 0.006], [0.008, 0.012], [0, 0.013],
    ], 14), m.steelDark);
    guard.position.y = 0.082;
    g.add(guard);
    const trigger = new THREE.Mesh(bevelBox(0.016, 0.012, 0.006, 0.001), m.steelDark);
    trigger.position.set(0, 0.062, 0.012);
    g.add(trigger);
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0034, 0.0040, 0.148, 8), m.steel);
    neck.position.y = 0.095 + 0.074;
    g.add(neck);
    const nozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0044, 0.0036, 0.015, 8), m.steelDark);
    nozzle.position.y = 0.095 + 0.148 + 0.006;
    g.add(nozzle);
    this.tip.position.set(0, 0.095 + 0.148 + 0.0155, 0);
    g.add(this.tip);

    this.hit = hitBox(0.09, 0.13, 0.09, 'lighter');
    this.hit.position.y = 0.05;
    g.add(this.hit);

    const shadow = contactShadow(0.055, 0.4);
    shadow.position.y = 0.001;
    g.add(shadow);
    setShadow(g, shadows, false);

    // resting on the bench, lying on its side with the wand pointing away
    this.home.copy(LIGHTER_HOME);
    this.homeQuat.setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.12, 0, -0.35, 'XYZ'));
    g.position.copy(this.home);
    g.quaternion.copy(this.homeQuat);
  }

  tipWorld(out = new THREE.Vector3()) {
    this.tip.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.tip.matrixWorld);
  }
}
