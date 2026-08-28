import * as THREE from 'three';
import { M } from '../mat/materials';
import { bevelBox, contactShadow, hitBox, hitProxy, lathe, setShadow, vaneGeometry } from '../world/geo';
import { PYRAMID_POS } from '../world/layout';
import { SlotSet, candleGeometries } from './parts';
import { clamp, damp, TAU } from '../util/math';
import { audio } from '../audio/audio';
import type { FlameField } from '../fx/flame';

/* ------------------------------------------------------------------ *
 * Module two: the Christmas pyramid.
 *
 * Shaft in a bearing, turntable on a collar, figures in sockets, rotor on
 * the shaft top, angled vanes in the rotor, candles in the holders.  The
 * warm air off four flames drives the vanes; the whole assembly is rigid,
 * so the figures turn because the vanes do.
 *
 * The start-up is deliberately physical: torque has to beat stiction, so
 * the rotor trembles, breaks free, takes one slow turn and only then
 * settles.  Vane pitch changes the speed and can reverse it, but the
 * torque curve never reaches zero - it cannot be put into a dead state.
 * ------------------------------------------------------------------ */

export const VANE_COUNT = 6;
export const PY_CANDLES = 4;

const BASE_TOP = 0.028;
const COLLAR_Y = 0.148;
const TABLE_TOP = COLLAR_Y + 0.009;
const HUB_Y = 0.452;
const HOLDER_R = 0.093;
const CANDLE_H = 0.070;
const CANDLE_BASE = 0.038;

export class Pyramid {
  readonly group = new THREE.Group();
  readonly spinner = new THREE.Group();
  readonly hub = new THREE.Group();
  readonly table = new THREE.Group();
  readonly bodyHit: THREE.Object3D;

  readonly vaneSet: SlotSet;
  readonly waxSet: SlotSet;
  readonly wickSet: SlotSet;

  /** loose parts, shown until they are fitted */
  shaftMesh!: THREE.Mesh;
  tableMesh!: THREE.Mesh;
  figureMeshes: THREE.Mesh[] = [];
  hubMesh!: THREE.Mesh;
  vaneMeshes: THREE.Mesh[] = [];
  candleMeshes: THREE.Group[] = [];

  shaftIn = false;
  tableIn = false;
  hubIn = false;
  figuresIn = [false, false, false];
  vanesIn = new Array(VANE_COUNT).fill(false);
  candlesIn = new Array(PY_CANDLES).fill(false);

  pitch = 0.20;                 // radians, + = clockwise seen from above
  angle = 0;
  omega = 0;
  heat = 0;
  private litCount = 0;
  private lastRev = 0;
  private tremble = 0;
  private flameBase = 0;
  private clusterLight: THREE.PointLight;
  private mtx = new THREE.Matrix4();

  constructor(shadows: boolean, flameBase: number) {
    const m = M();
    this.flameBase = flameBase;
    this.group.position.copy(PYRAMID_POS);
    this.group.rotation.y = -0.10;
    this.group.add(this.spinner);

    /* ---------- base ---------- */
    const base = new THREE.Mesh(lathe([
      [0, 0], [0.120, 0], [0.1225, 0.005], [0.1205, 0.014],
      [0.1235, 0.018], [0.1190, 0.024], [0.1150, BASE_TOP],
      [0.030, BASE_TOP], [0.026, 0.024], [0, 0.024],
    ], 44), m.walnutTurned);
    this.group.add(base);
    // a beaded moulding: turned work always has one
    const bead = new THREE.Mesh(
      new THREE.TorusGeometry(0.1205, 0.0042, 6, 44), m.walnutTurned);
    bead.rotation.x = Math.PI / 2;
    bead.position.y = 0.0165;
    this.group.add(bead);

    // brass bearing cup - the big socket the shaft drops into
    const bearing = new THREE.Mesh(lathe([
      [0, 0.0225], [0.0255, 0.0235], [0.0265, BASE_TOP + 0.004],
      [0.0215, BASE_TOP + 0.005], [0.0205, BASE_TOP + 0.001],
      [0.0075, 0.0215], [0.0032, 0.0175], [0, 0.017],
    ], 26), m.brass);
    this.group.add(bearing);

    /* ---------- candle holders on the rim ---------- */
    const holderGeo = lathe([
      [0, 0.026], [0.0175, 0.027], [0.0185, 0.0315], [0.0165, 0.0325],
      [0.0105, 0.0345], [0.0105, CANDLE_BASE + 0.004],
      [0.0082, CANDLE_BASE + 0.004], [0.0082, 0.0335], [0.0072, 0.032], [0, 0.031],
    ], 20);
    for (let i = 0; i < PY_CANDLES; i++) {
      const a = (i / PY_CANDLES) * TAU + Math.PI / 4;
      const holder = new THREE.Mesh(holderGeo, m.brassDark);
      holder.position.set(Math.cos(a) * HOLDER_R, 0, Math.sin(a) * HOLDER_R);
      this.group.add(holder);
    }

    /* ---------- loose parts ---------- */
    this.shaftMesh = new THREE.Mesh(lathe([
      [0, 0], [0.0038, 0.005], [0.0044, 0.014], [0.0042, 0.398],
      [0.0056, 0.403], [0.0056, 0.412], [0.0034, 0.419], [0, 0.4235],
    ], 14), m.brass);
    this.shaftMesh.add(hitProxy(0.05, 'py_shaft'));
    (this.shaftMesh.children[0] as THREE.Object3D).position.y = 0.21;

    this.tableMesh = new THREE.Mesh(lathe([
      [0, 0], [0.0125, 0], [0.0130, 0.004], [0.0145, 0.0055],
      [0.0765, 0.0055], [0.0780, 0.0075], [0.0760, 0.0090],
      [0.0140, 0.0090], [0.0125, 0.0200], [0.0075, 0.0205], [0, 0.0205],
    ], 40), m.mapleTurned);
    this.tableMesh.add(hitProxy(0.06, 'py_table'));

    this.figureMeshes = [this.buildTree(), this.buildAngel(), this.buildDeer()];
    this.figureMeshes.forEach((f, i) => {
      const h = hitProxy(0.042, `py_fig${i}`);
      h.position.y = 0.028;
      f.add(h);
    });

    this.hubMesh = new THREE.Mesh(lathe([
      [0, 0], [0.0110, 0], [0.0116, 0.0040], [0.0300, 0.0052],
      [0.0314, 0.0088], [0.0302, 0.0158], [0.0130, 0.0170],
      [0.0118, 0.0205], [0.0056, 0.0210], [0.0056, 0.0040], [0, 0.0034],
    ], 26), m.mapleTurned);
    this.hubMesh.add(hitProxy(0.05, 'py_hub'));

    const vgeo = vaneGeometry(0.092, 0.058, 0.0030, 0.22);
    vgeo.rotateX(Math.PI / 2);
    for (let i = 0; i < VANE_COUNT; i++) {
      const v = new THREE.Mesh(vgeo, m.vaneWood);
      v.add(hitProxy(0.042, `py_vane${i}`));
      (v.children[0] as THREE.Object3D).position.x = 0.042;
      this.vaneMeshes.push(v);
    }
    this.vaneSet = new SlotSet(vgeo, m.vaneWood, VANE_COUNT, shadows);
    this.hub.add(this.vaneSet.mesh);

    const { wax, wick } = candleGeometries(CANDLE_H);
    this.waxSet = new SlotSet(wax, m.wax, PY_CANDLES, shadows);
    this.wickSet = new SlotSet(wick, m.wick, PY_CANDLES, false);
    this.group.add(this.waxSet.mesh, this.wickSet.mesh);
    for (let i = 0; i < PY_CANDLES; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(wax, m.wax));
      g.add(new THREE.Mesh(wick, m.wick));
      const h = hitProxy(0.045, `py_candle${i}`);
      h.position.y = 0.045;
      g.add(h);
      this.candleMeshes.push(g);
    }

    /* ---------- the rotating assembly ---------- */
    this.spinner.add(this.table);
    this.spinner.add(this.hub);
    this.hub.position.y = HUB_Y;
    this.table.position.y = COLLAR_Y;

    /* ---------- lights and picking ---------- */
    // one warm light for the whole candle ring; the rest is emissive + env
    this.clusterLight = new THREE.PointLight(0xff9a48, 0, 1.35, 2.4);
    this.clusterLight.position.set(0, CANDLE_BASE + CANDLE_H + 0.02, 0);
    this.group.add(this.clusterLight);

    this.bodyHit = hitBox(0.26, 0.50, 0.26, 'pyramid');
    this.bodyHit.position.y = 0.25;
    this.group.add(this.bodyHit);

    const shadow = contactShadow(0.17, 0.55);
    shadow.position.y = 0.0012;
    this.group.add(shadow);

    setShadow(this.group, shadows, true);
  }

  /* ---------------- carved figures ---------------- */

  private buildTree() {
    const m = M();
    const g = new THREE.Mesh(lathe([
      [0, 0], [0.010, 0], [0.010, 0.008], [0.0045, 0.010], [0.0045, 0.018],
      [0.019, 0.020], [0.0155, 0.022], [0.0060, 0.026],
      [0.0165, 0.030], [0.0130, 0.032], [0.0050, 0.038],
      [0.0130, 0.042], [0.0100, 0.044], [0.0038, 0.050],
      [0.0085, 0.053], [0.0060, 0.055], [0, 0.066],
    ], 20), m.paintTeal);
    return g;
  }

  private buildAngel() {
    const m = M();
    const g = new THREE.Mesh(lathe([
      [0, 0], [0.0125, 0], [0.0135, 0.006], [0.0125, 0.030],
      [0.0092, 0.038], [0.0060, 0.042], [0.0068, 0.045],
      [0.0105, 0.052], [0.0092, 0.058], [0.0040, 0.061], [0, 0.062],
    ], 20), m.paintCream);
    const wingGeo = bevelBox(0.0022, 0.026, 0.017, 0.0006);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(wingGeo, m.paintOchre);
      w.position.set(s * 0.011, 0.034, -0.005);
      w.rotation.set(0.12, s * 0.5, s * 0.22);
      g.add(w);
    }
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.0072, 0.0011, 5, 12), m.brass);
    halo.position.set(0, 0.0625, -0.002);
    halo.rotation.x = 0.5;
    g.add(halo);
    return g;
  }

  private buildDeer() {
    const m = M();
    const hide = m.paintOchre;
    const body = new THREE.Mesh(lathe([
      [0, 0], [0.0115, 0.002], [0.0125, 0.012], [0.0105, 0.024], [0, 0.028],
    ], 16), hide);
    body.scale.set(1, 1, 1.7);
    body.position.y = 0.024;
    const g = new THREE.Mesh(new THREE.BufferGeometry(), hide);
    g.add(body);
    const legGeo = new THREE.CylinderGeometry(0.0022, 0.0018, 0.024, 6);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, hide);
        leg.position.set(sx * 0.0068, 0.012, sz * 0.013);
        g.add(leg);
      }
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0048, 0.0060, 0.020, 8), hide);
    neck.position.set(0, 0.042, -0.014);
    neck.rotation.x = -0.42;
    g.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 10, 8), hide);
    head.scale.set(0.9, 0.85, 1.4);
    head.position.set(0, 0.0505, -0.020);
    g.add(head);
    const antler = new THREE.CylinderGeometry(0.0009, 0.0007, 0.014, 4);
    for (const s of [-1, 1]) {
      const a = new THREE.Mesh(antler, m.paintCream);
      a.position.set(s * 0.0035, 0.0575, -0.019);
      a.rotation.z = s * 0.3;
      g.add(a);
    }
    return g;
  }

  /* ---------------- world anchors ---------------- */

  private world(local: THREE.Vector3, out: THREE.Vector3) {
    this.group.updateWorldMatrix(true, false);
    return out.copy(local).applyMatrix4(this.group.matrixWorld);
  }
  shaftSocketWorld(out = new THREE.Vector3()) { return this.world(new THREE.Vector3(0, 0.0175, 0), out); }
  tableSocketWorld(out = new THREE.Vector3()) { return this.world(new THREE.Vector3(0, COLLAR_Y, 0), out); }
  hubSocketWorld(out = new THREE.Vector3()) { return this.world(new THREE.Vector3(0, HUB_Y, 0), out); }
  figureSocketLocal(i: number) {
    const a = (i / 3) * TAU + 0.5;
    return new THREE.Vector3(Math.cos(a) * 0.046, TABLE_TOP, Math.sin(a) * 0.046);
  }
  figureSocketWorld(i: number, out = new THREE.Vector3()) {
    return this.world(this.figureSocketLocal(i), out);
  }
  vaneSocketLocal(i: number) {
    const a = (i / VANE_COUNT) * TAU;
    return new THREE.Vector3(Math.cos(a) * 0.034, HUB_Y + 0.011, Math.sin(a) * 0.034);
  }
  vaneSocketWorld(i: number, out = new THREE.Vector3()) {
    return this.world(this.vaneSocketLocal(i), out);
  }
  /** Orientation a vane ends up in once it is seated, in world space. */
  vaneWorldQuat(i: number) {
    const a = (i / VANE_COUNT) * TAU;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, -a, 0, 'YXZ'));
    return this.group.getWorldQuaternion(new THREE.Quaternion()).multiply(q);
  }
  candleSocketLocal(i: number) {
    const a = (i / PY_CANDLES) * TAU + Math.PI / 4;
    return new THREE.Vector3(Math.cos(a) * HOLDER_R, CANDLE_BASE, Math.sin(a) * HOLDER_R);
  }
  candleSocketWorld(i: number, out = new THREE.Vector3()) {
    return this.world(this.candleSocketLocal(i), out);
  }
  wickWorld(i: number, out = new THREE.Vector3()) {
    const l = this.candleSocketLocal(i);
    l.y += CANDLE_H + 0.006;
    return this.world(l, out);
  }
  flameWorld(i: number, out = new THREE.Vector3()) {
    const l = this.candleSocketLocal(i);
    l.y += CANDLE_H + 0.0045;
    return this.world(l, out);
  }
  rotorWorld(out = new THREE.Vector3()) { return this.world(new THREE.Vector3(0, HUB_Y + 0.01, 0), out); }
  thermalWorld(out = new THREE.Vector3()) {
    return this.world(new THREE.Vector3(0, CANDLE_BASE + CANDLE_H + 0.02, 0), out);
  }

  /* ---------------- fitting ---------------- */

  fitShaft() {
    this.shaftIn = true;
    this.shaftMesh.position.set(0, 0.0175, 0);
    this.shaftMesh.rotation.set(0, 0, 0);
    this.spinner.add(this.shaftMesh);
    // the collar the turntable will rest on
    const collar = new THREE.Mesh(lathe([
      [0, COLLAR_Y - 0.0495], [0.0118, COLLAR_Y - 0.0490],
      [0.0124, COLLAR_Y - 0.0465], [0.0056, COLLAR_Y - 0.0460],
    ], 16), M().brass);
    this.spinner.add(collar);
    audio.metalSeat(0.8);
  }
  fitTable() {
    this.tableIn = true;
    this.tableMesh.position.set(0, 0, 0);
    this.table.add(this.tableMesh);
    audio.slide(0.3);
    audio.woodPlace(0.55, 240);
  }
  fitFigure(i: number) {
    this.figuresIn[i] = true;
    const l = this.figureSocketLocal(i);
    const f = this.figureMeshes[i];
    f.position.set(l.x, l.y - COLLAR_Y, l.z);
    f.rotation.y = (i / 3) * TAU + 2.1;
    this.table.add(f);
    audio.woodPlace(0.5, 300 + i * 40);
  }
  fitHub() {
    this.hubIn = true;
    this.hubMesh.position.set(0, 0, 0);
    this.hub.add(this.hubMesh);
    audio.woodPlace(0.6, 210);
  }
  fitVane(i: number) {
    this.vanesIn[i] = true;
    this.vaneMeshes[i].visible = false;
    this.applyVaneMatrices();
    audio.woodPlace(0.42, 380 + i * 22);
  }
  fitCandle(i: number) {
    this.candlesIn[i] = true;
    this.candleMeshes[i].visible = false;
    const l = this.candleSocketLocal(i);
    const q = new THREE.Quaternion();
    this.waxSet.place(i, l, q);
    this.wickSet.place(i, l, q);
    audio.woodPlace(0.34, 520);
  }

  applyVaneMatrices() {
    const t = new THREE.Vector3(0.034, 0.011, 0);
    for (let i = 0; i < VANE_COUNT; i++) {
      if (!this.vanesIn[i]) { this.vaneSet.hide(i); continue; }
      const a = (i / VANE_COUNT) * TAU;
      this.mtx.makeRotationY(-a);
      const inner = new THREE.Matrix4().makeTranslation(t.x, t.y, t.z)
        .multiply(new THREE.Matrix4().makeRotationX(this.pitch));
      this.mtx.multiply(inner);
      this.vaneSet.setMatrix(i, this.mtx);
    }
  }

  get vanesPlaced() { return this.vanesIn.filter(Boolean).length; }
  get candlesPlaced() { return this.candlesIn.filter(Boolean).length; }

  setPitch(p: number) {
    this.pitch = clamp(p, -0.62, 0.62);
    this.applyVaneMatrices();
  }

  /** Torque per unit heat. Never zero: a flat vane still cups a little air. */
  private vaneFactor() {
    const s = Math.sin(Math.abs(this.pitch)) / Math.sin(0.62);
    const mag = 0.30 + 0.70 * s;
    const dir = this.pitch >= 0 ? 1 : -1;
    return mag * dir * (this.vanesPlaced / VANE_COUNT);
  }

  setLitCount(n: number) { this.litCount = n; }

  update(dt: number, time: number, flames: FlameField) {
    // heat builds after the wicks catch, it does not appear instantly
    const targetHeat = this.litCount / PY_CANDLES;
    this.heat = damp(this.heat, targetHeat, 0.55, dt);

    const torque = 1.25 * this.heat * this.vaneFactor();
    const stiction = 0.42;
    const drag = 0.60;
    const inertia = 2.2;

    if (Math.abs(this.omega) < 0.012 && Math.abs(torque) < stiction) {
      // not enough lift yet: the rotor only rocks against its bearing
      this.omega = 0;
      const want = clamp((Math.abs(torque) / stiction - 0.25) / 0.75, 0, 1);
      this.tremble = damp(this.tremble, want, 1.6, dt);
    } else {
      const net = torque - Math.sign(this.omega || torque) * stiction * 0.35 - drag * this.omega;
      this.omega += (net / inertia) * dt;
      this.tremble = damp(this.tremble, 0, 2.4, dt);
    }

    this.angle += this.omega * dt;
    const wob = this.tremble * 0.030 * Math.sin(time * 9.2) +
                this.tremble * 0.012 * Math.sin(time * 15.7);
    this.spinner.rotation.y = this.angle + wob;
    // a turned shaft is never perfectly true: a hair of runout sells the weight
    this.spinner.rotation.x = Math.sin(this.angle * 1.0 + 0.7) * 0.0022;
    this.spinner.rotation.z = Math.cos(this.angle * 1.0) * 0.0022;

    const rev = Math.floor(Math.abs(this.angle) / TAU);
    if (rev !== this.lastRev) {
      this.lastRev = rev;
      audio.bearingTick(clamp(Math.abs(this.omega) * 0.4, 0.12, 0.7), 138);
    }
    audio.setRotor(0, this.omega);

    // candle light: one shared source, flicker-modulated by its flames
    let lit = 0;
    for (let i = 0; i < PY_CANDLES; i++) lit += flames.brightness(this.flameBase + i);
    this.clusterLight.intensity = lit * 0.30;
    this.clusterLight.color.setRGB(1.0, 0.62 + 0.05 * Math.sin(time * 6.1), 0.30);
  }

  get running() { return Math.abs(this.omega) > 0.06; }
  get speedRatio() { return clamp(Math.abs(this.omega) / 2.1, 0, 1); }
}
