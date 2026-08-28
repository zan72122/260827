import * as THREE from 'three';
import { M } from '../mat/materials';
import { bevelBox, contactShadow, hitBox, hitProxy, lathe, setShadow, vaneGeometry } from '../world/geo';
import { CHIMES_POS } from '../world/layout';
import { SlotSet, candleGeometries } from './parts';
import { angleDelta, clamp, damp, TAU } from '../util/math';
import { audio } from '../audio/audio';
import type { FlameField } from '../fx/flame';

/* ------------------------------------------------------------------ *
 * Module three: the angel chime.
 *
 * Three angels hang from a rotor above five brass bells of slightly
 * different size.  Nothing here plays a sound file on a timer: every ring
 * is emitted when an angel's striker actually crosses a bell's angle, so
 * when the rotor speeds up the chiming crowds together, and when it slows
 * the ringing thins out.  The bells sit at irregular angles, so the
 * pattern never settles into a beat.
 * ------------------------------------------------------------------ */

export const ANGEL_COUNT = 3;
export const BELL_COUNT = 5;
export const CH_CANDLES = 4;

const BASE_TOP = 0.010;
const ROTOR_Y = 0.248;
const HOOK_Y = 0.2405;
const HOOK_R = 0.0345;
const STRIKER_REACH = 0.0173;   // hook radius + this = striker sweep radius
const CONTACT_R = 0.0510;
const BELL_Y = 0.1850;
const CANDLE_R = 0.036;
const CANDLE_H = 0.070;
const CANDLE_BASE = 0.0165;

interface BellSpec { ang: number; r: number; f: number; }
const BELLS: BellSpec[] = [
  { ang: 0.00, r: 0.0138, f: 1046.5 },
  { ang: 1.15, r: 0.0130, f: 1174.7 },
  { ang: 2.05, r: 0.0125, f: 1318.5 },
  { ang: 3.45, r: 0.0118, f: 1396.9 },
  { ang: 4.85, r: 0.0108, f: 1568.0 },
];
const bellRadius = (b: BellSpec) => CONTACT_R + b.r;

export class Chimes {
  readonly group = new THREE.Group();
  readonly spinner = new THREE.Group();
  readonly bodyHit: THREE.Object3D;

  readonly waxSet: SlotSet;
  readonly wickSet: SlotSet;

  angelMeshes: THREE.Group[] = [];
  bellMeshes: THREE.Mesh[] = [];
  candleMeshes: THREE.Group[] = [];

  angelsIn = new Array(ANGEL_COUNT).fill(false);
  bellsIn = new Array(BELL_COUNT).fill(false);
  candlesIn = new Array(CH_CANDLES).fill(false);

  /** wire length; sets how high the strikers ride against the bells */
  wire = 0.0625;
  angle = 0;
  omega = 0;
  heat = 0;

  private hangers: THREE.Group[] = [];
  private holders: THREE.Object3D[] = [];
  private deflect = new Float32Array(ANGEL_COUNT);
  private deflectVel = new Float32Array(ANGEL_COUNT);
  private prevDelta = new Float32Array(ANGEL_COUNT * BELL_COUNT).fill(9);
  private bellRing = new Float32Array(BELL_COUNT);
  private litCount = 0;
  private lastRev = 0;
  private tremble = 0;
  private flameBase: number;
  private clusterLight: THREE.PointLight;
  private strikes = 0;

  constructor(shadows: boolean, flameBase: number) {
    const m = M();
    this.flameBase = flameBase;
    this.group.position.copy(CHIMES_POS);
    this.group.rotation.y = 0.24;
    this.group.add(this.spinner);

    /* ---------- base ---------- */
    const base = new THREE.Mesh(lathe([
      [0, 0], [0.0860, 0], [0.0875, 0.0028], [0.0855, 0.0072],
      [0.0820, BASE_TOP], [0.0180, BASE_TOP], [0.0160, 0.0075], [0, 0.0072],
    ], 42), m.brass);
    this.group.add(base);
    const boss = new THREE.Mesh(lathe([
      [0, BASE_TOP], [0.0175, BASE_TOP], [0.0180, 0.0155], [0.0125, 0.0185],
      [0.0060, 0.0195], [0.0028, 0.0165], [0, 0.0160],
    ], 22), m.brass);
    this.group.add(boss);

    /* ---------- shaft ---------- */
    const shaft = new THREE.Mesh(lathe([
      [0, 0.016], [0.0034, 0.020], [0.0038, 0.230], [0.0050, 0.234],
      [0.0040, 0.240], [0.0016, 0.2455], [0, 0.2465],
    ], 12), m.brass);
    this.group.add(shaft);

    /* ---------- bell posts (installed with the base; the bells come later) ---------- */
    for (const b of BELLS) {
      const R = bellRadius(b);
      const post = new THREE.Mesh(lathe([
        [0, 0.008], [0.0055, 0.010], [0.0044, 0.017],
        [0.0032, 0.150], [0.0036, 0.2035], [0.0024, 0.2065], [0, 0.207],
      ], 10), m.brass);
      post.position.set(Math.cos(b.ang) * R, 0, Math.sin(b.ang) * R);
      this.group.add(post);
      // the arm the bell hangs from, and a collar marking the right height
      const arm = new THREE.Mesh(bevelBox(0.0165, 0.0030, 0.0030, 0.0005), m.brass);
      arm.position.set(
        Math.cos(b.ang) * (R - 0.0082), 0.2055, Math.sin(b.ang) * (R - 0.0082));
      arm.rotation.y = -b.ang;
      this.group.add(arm);
      // a turned collar at the height the striker should ride: the mark the
      // child lines the angels up against
      const collar = new THREE.Mesh(
        new THREE.TorusGeometry(0.0048, 0.0012, 5, 12), m.brassBell);
      collar.position.set(Math.cos(b.ang) * R, BELL_Y, Math.sin(b.ang) * R);
      collar.rotation.x = Math.PI / 2;
      this.group.add(collar);
    }

    /* ---------- candle holders ---------- */
    const holderGeo = lathe([
      [0, 0.009], [0.0155, 0.0098], [0.0162, 0.0128], [0.0145, 0.0138],
      [0.0098, 0.0155], [0.0098, CANDLE_BASE + 0.004],
      [0.0078, CANDLE_BASE + 0.004], [0.0078, 0.0148], [0.0068, 0.0138], [0, 0.0132],
    ], 18);
    for (let i = 0; i < CH_CANDLES; i++) {
      const a = (i / CH_CANDLES) * TAU + 0.6;
      const h = new THREE.Mesh(holderGeo, m.brassDark);
      h.position.set(Math.cos(a) * CANDLE_R, 0, Math.sin(a) * CANDLE_R);
      this.group.add(h);
    }

    /* ---------- rotor: brass fan, part of the machine from the start ---------- */
    const rotorHub = new THREE.Mesh(lathe([
      [0, 0.238], [0.0105, 0.2385], [0.0112, 0.2425], [0.0105, 0.2525],
      [0.0042, 0.2545], [0.0032, 0.2395], [0, 0.2385],
    ], 18), m.brass);
    this.spinner.add(rotorHub);
    const rvane = vaneGeometry(0.042, 0.030, 0.0011, 0.30);
    rvane.rotateX(Math.PI / 2);
    const rotorVanes = new SlotSet(rvane, m.brass, 6, shadows);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      mtx.makeRotationY(-a);
      mtx.multiply(new THREE.Matrix4().makeTranslation(0.0105, ROTOR_Y - 0.002, 0)
        .multiply(new THREE.Matrix4().makeRotationX(0.62)));
      rotorVanes.setMatrix(i, mtx);
    }
    this.spinner.add(rotorVanes.mesh);

    /* ---------- hooks ---------- */
    for (let i = 0; i < ANGEL_COUNT; i++) {
      const a = (i / ANGEL_COUNT) * TAU;
      const hookArm = new THREE.Mesh(bevelBox(HOOK_R + 0.004, 0.0018, 0.0018, 0.0004), m.brass);
      hookArm.position.set(Math.cos(a) * (HOOK_R / 2), HOOK_Y + 0.0025, Math.sin(a) * (HOOK_R / 2));
      hookArm.rotation.y = -a;
      this.spinner.add(hookArm);
      const hook = new THREE.Mesh(
        new THREE.TorusGeometry(0.0026, 0.0006, 4, 10, Math.PI * 1.5), m.brass);
      hook.position.set(Math.cos(a) * HOOK_R, HOOK_Y, Math.sin(a) * HOOK_R);
      hook.rotation.set(Math.PI / 2, 0, -a);
      this.spinner.add(hook);

      // the hanger pivots at the hook; the angel rides at the end of the wire
      const hanger = new THREE.Group();
      hanger.position.set(Math.cos(a) * HOOK_R, HOOK_Y, Math.sin(a) * HOOK_R);
      hanger.rotation.y = -a;
      hanger.visible = false;
      const wireMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.00042, 0.00042, 1, 5), M().brass);
      wireMesh.name = 'wire';
      hanger.add(wireMesh);
      const holder = new THREE.Object3D();
      holder.name = 'holder';
      hanger.add(holder);
      this.spinner.add(hanger);
      this.hangers.push(hanger);
      this.holders.push(holder);
    }

    /* ---------- loose parts ---------- */
    for (let i = 0; i < ANGEL_COUNT; i++) this.angelMeshes.push(this.buildAngel(i));
    for (let i = 0; i < BELL_COUNT; i++) this.bellMeshes.push(this.buildBell(i));

    const { wax, wick } = candleGeometries(CANDLE_H);
    this.waxSet = new SlotSet(wax, m.wax, CH_CANDLES, shadows);
    this.wickSet = new SlotSet(wick, m.wick, CH_CANDLES, false);
    this.group.add(this.waxSet.mesh, this.wickSet.mesh);
    for (let i = 0; i < CH_CANDLES; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(wax, m.wax));
      g.add(new THREE.Mesh(wick, m.wick));
      const h = hitProxy(0.042, `ch_candle${i}`);
      h.position.y = 0.038;
      g.add(h);
      this.candleMeshes.push(g);
    }

    this.clusterLight = new THREE.PointLight(0xffa254, 0, 1.15, 2.4);
    this.clusterLight.position.set(0, CANDLE_BASE + CANDLE_H + 0.02, 0);
    this.group.add(this.clusterLight);

    this.bodyHit = hitBox(0.20, 0.30, 0.20, 'chimes');
    this.bodyHit.position.y = 0.15;
    this.group.add(this.bodyHit);

    const shadow = contactShadow(0.125, 0.55);
    shadow.position.y = 0.0012;
    this.group.add(shadow);

    setShadow(this.group, shadows, true);
  }

  /* ---------------- parts ---------------- */

  private buildAngel(i: number) {
    const m = M();
    const g = new THREE.Group();
    const robe = new THREE.Mesh(lathe([
      [0, 0], [0.0110, 0.0015], [0.0118, 0.006], [0.0105, 0.020],
      [0.0072, 0.026], [0.0048, 0.029], [0.0055, 0.032],
      [0.0082, 0.038], [0.0070, 0.043], [0.0030, 0.046], [0, 0.0465],
    ], 18), i === 1 ? m.paintCream : m.paintOchre);
    robe.position.y = -0.046;
    g.add(robe);
    const wing = bevelBox(0.0016, 0.021, 0.014, 0.0005);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(wing, m.brass);
      w.position.set(s * 0.0088, -0.0155, -0.0045);
      w.rotation.set(0.1, s * 0.55, s * 0.2);
      g.add(w);
    }
    // the striker: a light brass wand reaching outward to the bell circle
    const armLen = STRIKER_REACH - 0.005;
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.00075, 0.00065, armLen, 6), m.brass);
    arm.rotation.z = -Math.PI / 2;
    arm.position.set(0.005 + armLen / 2, -0.0225, 0);
    g.add(arm);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.0021, 8, 6), m.brassBell);
    head.position.set(STRIKER_REACH, -0.0225, 0);
    g.add(head);

    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.0058, 0.0009, 4, 10), m.brass);
    halo.position.set(0, 0.0015, -0.002);
    halo.rotation.x = 0.55;
    g.add(halo);

    const hit = hitProxy(0.040, `ch_angel${i}`);
    hit.position.y = -0.022;
    g.add(hit);
    return g;
  }

  private buildBell(i: number) {
    const m = M();
    const b = BELLS[i];
    const r = b.r;
    const bell = new THREE.Mesh(lathe([
      [0, 0.0215], [0.0032, 0.0212], [0.0036, 0.0196],
      [0.0048, 0.0185], [r * 0.42, 0.0155], [r * 0.78, 0.0095],
      [r * 0.97, 0.0035], [r, 0.0008], [r, 0],
      [r * 0.90, 0.0006], [r * 0.86, 0.0038], [r * 0.68, 0.0098],
      [r * 0.34, 0.0158], [0.0026, 0.0192], [0, 0.0195],
    ], 26), m.brassBell);
    // clapper: a small bead on a wire inside the mouth
    const clapper = new THREE.Mesh(new THREE.SphereGeometry(r * 0.20, 8, 6), m.brassDark);
    clapper.position.y = 0.0045;
    bell.add(clapper);
    const hit = hitProxy(0.038, `ch_bell${i}`);
    hit.position.y = 0.010;
    bell.add(hit);
    bell.userData.hit = `ch_bell${i}`;
    return bell;
  }

  /* ---------------- world anchors ---------------- */

  private world(local: THREE.Vector3, out: THREE.Vector3) {
    this.group.updateWorldMatrix(true, false);
    return out.copy(local).applyMatrix4(this.group.matrixWorld);
  }
  hookLocal(i: number) {
    const a = (i / ANGEL_COUNT) * TAU + this.angle;
    return new THREE.Vector3(Math.cos(a) * HOOK_R, HOOK_Y - this.wire, Math.sin(a) * HOOK_R);
  }
  hookWorld(i: number, out = new THREE.Vector3()) { return this.world(this.hookLocal(i), out); }
  bellLocal(i: number) {
    const b = BELLS[i];
    const R = bellRadius(b);
    return new THREE.Vector3(Math.cos(b.ang) * R, BELL_Y - 0.0195, Math.sin(b.ang) * R);
  }
  bellWorld(i: number, out = new THREE.Vector3()) { return this.world(this.bellLocal(i), out); }
  candleLocal(i: number) {
    const a = (i / CH_CANDLES) * TAU + 0.6;
    return new THREE.Vector3(Math.cos(a) * CANDLE_R, CANDLE_BASE, Math.sin(a) * CANDLE_R);
  }
  candleWorld(i: number, out = new THREE.Vector3()) { return this.world(this.candleLocal(i), out); }
  wickWorld(i: number, out = new THREE.Vector3()) {
    const l = this.candleLocal(i); l.y += CANDLE_H + 0.006;
    return this.world(l, out);
  }
  flameWorld(i: number, out = new THREE.Vector3()) {
    const l = this.candleLocal(i); l.y += CANDLE_H + 0.0045;
    return this.world(l, out);
  }
  rotorWorld(out = new THREE.Vector3()) { return this.world(new THREE.Vector3(0, ROTOR_Y, 0), out); }
  thermalWorld(out = new THREE.Vector3()) {
    return this.world(new THREE.Vector3(0, CANDLE_BASE + CANDLE_H + 0.02, 0), out);
  }
  wireHandleWorld(out = new THREE.Vector3()) {
    return this.world(new THREE.Vector3(0, HOOK_Y - this.wire + 0.02, 0), out);
  }

  /* ---------------- fitting ---------------- */

  fitAngel(i: number) {
    this.angelsIn[i] = true;
    const g = this.angelMeshes[i];
    g.position.set(0, 0, 0);
    g.rotation.set(0, 0, 0);
    this.holders[i].add(g);
    this.hangers[i].visible = true;
    audio.metalSeat(0.55);
    this.applyWire();
  }
  fitBell(i: number) {
    this.bellsIn[i] = true;
    const b = BELLS[i];
    const R = bellRadius(b);
    const mesh = this.bellMeshes[i];
    mesh.position.set(Math.cos(b.ang) * R, BELL_Y - 0.0195, Math.sin(b.ang) * R);
    mesh.rotation.set(0, -b.ang, 0);
    this.group.add(mesh);
    audio.bell(b.f, 0.35, i / BELL_COUNT);
  }
  fitCandle(i: number) {
    this.candlesIn[i] = true;
    this.candleMeshes[i].visible = false;
    const l = this.candleLocal(i);
    this.waxSet.place(i, l, new THREE.Quaternion());
    this.wickSet.place(i, l, new THREE.Quaternion());
    audio.woodPlace(0.3, 540);
  }

  setWire(v: number) {
    this.wire = clamp(v, 0.038, 0.064);
    this.applyWire();
  }
  private applyWire() {
    for (let i = 0; i < ANGEL_COUNT; i++) {
      const wireMesh = this.hangers[i].getObjectByName('wire') as THREE.Mesh;
      wireMesh.scale.y = this.wire;
      wireMesh.position.y = -this.wire / 2;
      this.holders[i].position.y = -this.wire;
    }
  }

  /** how well the strikers line up with the bells: 1 = dead on */
  get alignment() {
    return 1 - clamp(Math.abs(this.wire - 0.050) / 0.014, 0, 1);
  }
  get angelsPlaced() { return this.angelsIn.filter(Boolean).length; }
  get bellsPlaced() { return this.bellsIn.filter(Boolean).length; }
  get candlesPlaced() { return this.candlesIn.filter(Boolean).length; }
  get strikeCount() { return this.strikes; }

  setLitCount(n: number) { this.litCount = n; }

  /** Swap which bell hangs on which post - the free-play "change the tune". */
  rotateBellSet() {
    const order = BELLS.map((b) => b.f);
    const first = order.shift()!;
    order.push(first);
    BELLS.forEach((b, i) => { b.f = order[i]; });
    for (let i = 0; i < BELL_COUNT; i++) if (this.bellsIn[i]) audio.bell(BELLS[i].f, 0.3, i / BELL_COUNT);
  }

  update(dt: number, time: number, flames: FlameField) {
    const targetHeat = this.litCount / CH_CANDLES;
    this.heat = damp(this.heat, targetHeat, 0.7, dt);

    const torque = 0.95 * this.heat * (0.35 + 0.65 * (this.angelsPlaced / ANGEL_COUNT));
    const stiction = 0.22, drag = 0.36, inertia = 0.95;

    if (Math.abs(this.omega) < 0.012 && torque < stiction) {
      this.omega = 0;
      const want = clamp((torque / stiction - 0.25) / 0.75, 0, 1);
      this.tremble = damp(this.tremble, want, 1.8, dt);
    } else {
      const net = torque - Math.sign(this.omega || torque) * stiction * 0.3 - drag * this.omega;
      this.omega += (net / inertia) * dt;
      this.tremble = damp(this.tremble, 0, 2.4, dt);
    }
    this.angle += this.omega * dt;
    const wob = this.tremble * 0.026 * Math.sin(time * 11.3);
    this.spinner.rotation.y = this.angle + wob;

    const rev = Math.floor(Math.abs(this.angle) / TAU);
    if (rev !== this.lastRev) {
      this.lastRev = rev;
      audio.bearingTick(clamp(Math.abs(this.omega) * 0.22, 0.06, 0.3), 320);
    }
    audio.setRotor(1, this.omega * 1.2);

    /* ---- angels: hang, swing out with speed, and get knocked back by bells ---- */
    // the angels lean out as they gather speed, but only by a millimetre or
    // two: any more and the strikers would cut through the bells
    const swing = clamp(Math.abs(this.omega) * 0.011, 0, 0.026);
    const strikerY = HOOK_Y - this.wire - 0.0225;
    const heightFit = 1 - clamp(Math.abs(strikerY - BELL_Y) / 0.016, 0, 1) * 0.62;

    for (let a = 0; a < ANGEL_COUNT; a++) {
      if (!this.angelsIn[a]) continue;
      const hanger = this.hangers[a];
      // spring-back of the striker after it drags across a bell
      this.deflectVel[a] += (-56 * this.deflect[a] - 7.5 * this.deflectVel[a]) * dt;
      this.deflect[a] += this.deflectVel[a] * dt;

      const angelAngle = this.angle + (a / ANGEL_COUNT) * TAU;
      let contact = 0;
      for (let b = 0; b < BELL_COUNT; b++) {
        if (!this.bellsIn[b]) continue;
        const d = angleDelta(angelAngle, BELLS[b].ang);
        const idx = a * BELL_COUNT + b;
        const prev = this.prevDelta[idx];
        const near = 1 - clamp(Math.abs(d) / 0.16, 0, 1);
        if (near > contact) contact = near;
        // the strike happens the instant the striker crosses the bell's angle
        if (prev < 9 && Math.abs(prev) < 0.5 && Math.abs(d) < 0.5 &&
            Math.sign(prev) !== Math.sign(d) && Math.abs(this.omega) > 0.10) {
          const strength = clamp(Math.abs(this.omega) * 0.42, 0.14, 1) * heightFit;
          audio.bell(BELLS[b].f, strength, b / BELL_COUNT);
          this.bellRing[b] = 1;
          this.deflectVel[a] -= Math.sign(this.omega) * 3.4 * strength;
          this.strikes++;
        }
        this.prevDelta[idx] = d;
      }
      // while touching, the striker is pressed back against the bell skin
      const press = contact * heightFit;
      hanger.rotation.z = swing - press * 0.045;
      hanger.rotation.y = -(a / ANGEL_COUNT) * TAU + this.deflect[a];
    }

    // bells rock a little after being struck
    for (let b = 0; b < BELL_COUNT; b++) {
      if (!this.bellsIn[b]) continue;
      this.bellRing[b] = damp(this.bellRing[b], 0, 4.2, dt);
      const mesh = this.bellMeshes[b];
      mesh.rotation.z = Math.sin(time * 26 + b) * this.bellRing[b] * 0.05;
      mesh.rotation.x = Math.cos(time * 24 + b * 2) * this.bellRing[b] * 0.035;
    }

    let lit = 0;
    for (let i = 0; i < CH_CANDLES; i++) lit += flames.brightness(this.flameBase + i);
    this.clusterLight.intensity = lit * 0.26;
  }

  get running() { return Math.abs(this.omega) > 0.06; }
}
