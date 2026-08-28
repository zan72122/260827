import * as THREE from 'three';
import type { Workshop } from './workshop';
import { F_CH, F_LIGHTER, F_PY } from './workshop';
import type { CameraRig, Pose } from '../core/cameraRig';
import type { Hud } from '../ui/hud';
import type { Hint } from './types';
import { type Draggable } from './interaction';
import { PY_CANDLES, VANE_COUNT } from '../machines/pyramid';
import { ANGEL_COUNT, BELL_COUNT, CH_CANDLES } from '../machines/chimes';
import { audio } from '../audio/audio';
import { clamp } from '../util/math';
import { BENCH_TOP } from '../world/layout';

/* ------------------------------------------------------------------ *
 * The through-line.  One room, three machines, one continuous chain of
 * shots: wide -> structure -> tool -> close on the motion -> a step back
 * where the cause is visible -> the finished object.  Nothing here is a
 * menu, and nothing cuts.
 * ------------------------------------------------------------------ */

interface Step {
  id: string;
  enter(): void;
  update?(dt: number): void;
  hint?(): Hint;
  done(): boolean;
  exit?(): void;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export class Director {
  private w: Workshop;
  private rig: CameraRig;
  private hud: Hud;
  private steps: Step[] = [];
  private idx = -1;
  private t = 0;

  /** free-play state, entered once all three machines run */
  free = false;
  private freeMode: 'idle' | 'smoker' | 'pyramid' | 'chimes' = 'idle';
  private freeT = 0;
  private smokerReopen = 0;

  private dwell: number[] = [];
  private drags: Draggable[] = [];

  constructor(w: Workshop, rig: CameraRig, hud: Hud) {
    this.w = w;
    this.rig = rig;
    this.hud = hud;
    this.buildSteps();
  }

  /* ---------------- helpers ---------------- */

  private pose(name: string, target: THREE.Vector3, dist: number, yaw: number,
               pitch: number, extra: Partial<Pose> = {}): Pose {
    return { name, target, dist, yaw, pitch, ...extra };
  }

  private look(p: THREE.Vector3) { this.w.focus.copy(p); }

  /**
   * A shot for fitting a part: the socket and the parts tray must both be
   * legible, so the framing is derived from how far apart they are rather
   * than hand-picked per step.
   */
  private fitPose(name: string, socket: THREE.Vector3, yaw: number, pitch: number,
                  minDist = 0.42): Pose {
    const tray = this.w.tray.targetCenter();
    const half = this.w.tray.partsHalfWidth;
    const dz = Math.abs(socket.z - tray.z);
    const spanH = Math.max(Math.abs(socket.x - tray.x) + half, half * 2) + dz * 0.30;
    const spanV = Math.abs(socket.y - tray.y) + 0.09 + dz * 0.30;
    // 0.344 = tan(fov/2); 0.294 is the same after the portrait aspect and its
    // wider standoff - portrait is the tighter axis horizontally, so size for it
    const dv = (spanV * 0.5 + 0.05) / 0.344;
    const dh = (spanH * 0.5 + 0.05) / 0.294;
    const dist = clamp(Math.max(dv, dh), minDist, 1.30);
    const target = socket.clone().lerp(tray, 0.45);
    return this.pose(name, target, dist, yaw, pitch, { pDist: dist * 1.22 });
  }

  private mkDrag(
    id: string, root: THREE.Object3D, target: THREE.Vector3, quat: THREE.Quaternion,
    snap: number, onPlace: () => void,
  ): Draggable {
    const d: Draggable = {
      id, root, proxy: root,
      targetPos: target.clone(), targetQuat: quat.clone(),
      homeParent: this.w.tray.group,
      homeLocal: root.position.clone(),
      homeQuatLocal: root.quaternion.clone(),
      snapRadius: snap, placed: false,
      onPlace, destParent: this.w.scene,
    };
    return d;
  }

  /** Put a set of loose parts in the tray and build their drag records. */
  private stage(
    parts: THREE.Object3D[], euler: THREE.Euler,
    target: (i: number) => THREE.Vector3, place: (i: number) => void,
    snap = 0.075, targetQuat?: (i: number) => THREE.Quaternion,
  ) {
    this.clearTray();
    parts.forEach((p) => {
      p.visible = true;
      p.quaternion.setFromEuler(euler);
      this.w.tray.group.add(p);
    });
    this.w.tray.layout(parts);
    const q = new THREE.Quaternion();
    this.drags = parts.map((p, i) =>
      this.mkDrag(`p${i}`, p, target(i), targetQuat ? targetQuat(i) : q, snap, () => place(i)));
    this.w.interaction.mode = { kind: 'drag', items: this.drags };
  }

  private clearTray() {
    for (const d of this.drags)
      if (!d.placed && d.root.parent === this.w.tray.group) this.w.tray.group.remove(d.root);
    this.drags = [];
  }

  private allPlaced() {
    return this.drags.every((d) => d.placed) && !this.w.interaction.busy;
  }

  private dragHint(): Hint {
    const next = this.drags.find((d) => !d.placed);
    if (!next) return null;
    return { kind: 'drag', from: next.root.getWorldPosition(new THREE.Vector3()),
             to: next.targetPos.clone() };
  }

  /* ---------------- ignition ---------------- */

  private beginIgnition(count: number, firstWick: THREE.Vector3) {
    this.dwell = new Array(count).fill(0);
    this.w.interaction.mode = { kind: 'trace' };
    this.w.interaction.traceAnchor = firstWick.clone();
    this.w.interaction.onLighterDrop = () => { /* the adult keeps hold of it */ };
    // the wand arrives in shot, tip just clear of the first wick
    this.w.presentLighter(firstWick.clone().add(V(0.052, 0.052, 0.036)));
  }

  /**
   * Guide the wand near a wick and hold: the tip is pulled the last few
   * millimetres so no fine aim is needed, then the wick catches.
   */
  private runIgnition(
    dt: number, wicks: THREE.Vector3[], isLit: (i: number) => boolean, light: (i: number) => void,
  ) {
    const tip = this.w.lighter.tipWorld(new THREE.Vector3());
    const flameOn = this.w.flames.isLit(F_LIGHTER);
    let nearest = -1, nd = Infinity;
    for (let i = 0; i < wicks.length; i++) {
      if (isLit(i)) continue;
      const d = tip.distanceTo(wicks[i]);
      if (d < nd) { nd = d; nearest = i; }
    }
    if (nearest < 0) { this.w.interaction.traceAnchor = null; return; }
    // the wand travels in the plane of the wick it is aiming at
    this.w.interaction.traceAnchor = wicks[nearest];
    if (nd < 0.090 && this.w.lighterHeld) {
      // magnetism toward the wick, so a small hand still lands it
      const g = this.w.lighter.group;
      const offset = tip.clone().sub(g.position);
      const want = wicks[nearest].clone().sub(offset);
      want.y += 0.004;
      g.position.lerp(want, clamp(dt * 6.5, 0, 0.4));
    }
    if (nd < 0.055 && flameOn) {
      this.dwell[nearest] += dt;
      if (this.dwell[nearest] > 0.24) { light(nearest); this.dwell[nearest] = -99; }
    } else if (this.dwell[nearest] > 0) {
      this.dwell[nearest] = Math.max(0, this.dwell[nearest] - dt * 2);
    }
  }

  private igniteHint(wicks: THREE.Vector3[], isLit: (i: number) => boolean): Hint {
    const i = wicks.findIndex((_, k) => !isLit(k));
    if (i < 0) return null;
    const from = this.w.lighter.tipWorld(new THREE.Vector3());
    return { kind: 'trace', from, to: wicks[i].clone() };
  }

  /* ---------------- the sequence ---------------- */

  private buildSteps() {
    const w = this.w;
    const sm = w.smoker, py = w.pyramid, ch = w.chimes;
    const S = (s: Step) => this.steps.push(s);

    const overview = () => this.pose('overview', V(0.05, BENCH_TOP + 0.13, 0.0), 1.92, 0.05, 0.20,
      { fov: 40, pDist: 2.42, pFov: 43, pTargetY: 0.05 });

    /* ---------- opening ---------- */
    S({
      id: 'intro',
      enter: () => {
        w.setLamp(0.5);
        w.setEvening(0.35);
        this.rig.go(this.pose('introWide', V(0.05, BENCH_TOP + 0.20, -0.05), 2.5, -0.12, 0.16,
          { fov: 42, pDist: 3.0, pFov: 45 }), 0.01);
        this.look(V(0.05, BENCH_TOP + 0.1, 0));
      },
      update: () => {
        if (this.t > 0.4) this.rig.go(overview(), 3.4);
        w.setLamp(0.5 + clamp((this.t - 1.2) / 2.4, 0, 1) * 0.5);
        w.setEvening(0.35 + clamp(this.t / 6, 0, 1) * 0.2);
      },
      done: () => this.t > 4.0,
    });

    /* ================= MODULE 1 : the smoker ================= */
    S({
      id: 'sm_wide',
      enter: () => {
        this.hud.setPip(0, 'active');
        this.rig.go(this.pose('smWide', sm.upperHandleWorld().add(V(0, -0.04, 0)), 0.62,
          -0.30, 0.20, { pDist: 0.80, pTargetY: 0.0 }), 2.0);
        this.look(sm.upperHandleWorld());
        w.interaction.mode = { kind: 'swipe', dir: 1,
          onDone: () => { sm.open(); audio.slide(0.42); audio.woodPlace(0.5, 180); this.advance(); } };
      },
      hint: () => ({ kind: 'swipe', at: sm.upperHandleWorld(), dir: 'up' }),
      done: () => false,
    });

    S({
      id: 'sm_section',
      enter: () => {
        // both halves side by side on the bench: the cavity in one, the duct
        // and the mouth in the other
        this.rig.go(this.pose('smDuct', sm.group.position.clone().add(V(0.055, 0.100, 0.0)),
          0.38, -0.52, 0.20, { pDist: 0.50 }), 1.6);
        w.interaction.mode = { kind: 'none' };
      },
      update: () => {
        // the cut sweeps open once the camera is on it, then the camera drifts
        // around the pair so the cavity and the duct are read in three dimensions
        if (this.t > 1.4) sm.showSection(true);
        if (this.t > 2.6) {
          this.rig.go(this.pose('smDuct2', sm.group.position.clone().add(V(0.055, 0.100, 0.0)),
            0.38, 0.10, 0.24, { pDist: 0.50 }), 3.6);
        }
      },
      done: () => this.t > 7.2,
      exit: () => sm.showSection(false),
    });

    S({
      id: 'sm_cone',
      enter: () => {
        w.tray.setAnchor(sm.group.position, -0.26);
        this.stage([sm.cone], new THREE.Euler(0, 0, 0),
          () => sm.dishWorld(), () => {
            sm.lower.attach(sm.cone);
            audio.woodPlace(0.3, 620);
          }, 0.07);
        this.rig.go(this.fitPose('smDish', sm.dishWorld().add(V(0, 0.06, 0)),
          -0.16, 0.42, 0.46), 1.6);
        this.look(sm.dishWorld());
      },
      hint: () => this.dragHint(),
      done: () => this.allPlaced(),
    });

    S({
      id: 'sm_light',
      enter: () => {
        this.rig.go(this.pose('smLight', sm.dishWorld().add(V(0, 0.080, 0)), 0.66, -0.26, 0.32,
          { pDist: 0.86 }), 1.6);
        this.beginIgnition(1, sm.coneTipWorld(new THREE.Vector3()));
      },
      update: (dt) => this.runIgnition(dt, [sm.coneTipWorld(new THREE.Vector3())],
        () => sm.lit, () => sm.ignite()),
      hint: () => this.igniteHint([sm.coneTipWorld(new THREE.Vector3())], () => sm.lit),
      done: () => sm.lit && this.t > 1.4,
      exit: () => { w.stowLighter(); w.interaction.traceAnchor = null; },
    });

    S({
      id: 'sm_close',
      enter: () => {
        this.rig.go(this.pose('smClose', sm.group.position.clone().add(V(0.05, 0.115, 0)), 0.44,
          -0.30, 0.20, { pDist: 0.56 }), 1.5);
        w.interaction.mode = { kind: 'swipe', dir: -1,
          onDone: () => { sm.close(); audio.woodPlace(0.75, 150); this.advance(); } };
      },
      hint: () => ({ kind: 'swipe', at: sm.upperHandleWorld(), dir: 'down' }),
      done: () => false,
    });

    S({
      id: 'sm_mouth',
      enter: () => {
        w.interaction.mode = { kind: 'none' };
        this.rig.go(this.pose('smMouth', sm.mouthClosedWorld().add(V(0, 0.010, 0.004)),
          0.255, -0.22, 0.06, { pDist: 0.330 }), 2.4);
        this.look(sm.mouthClosedWorld());
      },
      done: () => sm.puffing && this.t > 4.6,
    });

    S({
      id: 'sm_done',
      enter: () => {
        audio.chime(0);
        this.hud.setPip(0, 'done');
        this.rig.go(this.pose('smProud', sm.group.position.clone().add(V(0, 0.165, 0)), 0.56,
          -0.34, 0.16, { pDist: 0.72 }), 2.2);
      },
      done: () => this.t > 2.6,
    });

    /* ================= MODULE 2 : the pyramid ================= */
    S({
      id: 'py_intro',
      enter: () => {
        this.hud.setPip(1, 'active');
        w.tray.setAnchor(py.group.position);
        this.rig.go(this.pose('pyIntro', py.group.position.clone().add(V(0, 0.14, 0)), 0.78,
          0.12, 0.22, { pDist: 0.98 }), 2.4);
        this.look(py.group.position.clone().add(V(0, 0.1, 0)));
      },
      done: () => this.t > 1.9,
    });

    S({
      id: 'py_shaft',
      enter: () => {
        py.shaftMesh.visible = true;
        this.stage([py.shaftMesh], new THREE.Euler(0, 0, -Math.PI / 2),
          () => py.shaftSocketWorld(), () => py.fitShaft(), 0.09);
        // the shaft is longer than the tray: lay it across, and tell the shot
        // how far it reaches so the framing takes it in
        py.shaftMesh.position.set(-0.19, 0.02, 0.0);
        this.drags[0].homeLocal.copy(py.shaftMesh.position);
        w.tray.partsHalfWidth = 0.215;
        this.rig.go(this.fitPose('pyBase', py.shaftSocketWorld().add(V(0, 0.10, 0)),
          0.14, 0.30, 0.50), 1.8);
      },
      hint: () => this.dragHint(),
      done: () => this.allPlaced(),
    });

    S({
      id: 'py_table',
      enter: () => {
        this.stage([py.tableMesh], new THREE.Euler(0, 0, 0),
          () => py.tableSocketWorld(), () => py.fitTable(), 0.085);
        this.rig.go(this.fitPose('pyTable', py.tableSocketWorld(), 0.16, 0.26, 0.48), 1.6);
      },
      hint: () => this.dragHint(),
      done: () => this.allPlaced(),
    });

    S({
      id: 'py_figures',
      enter: () => {
        this.stage(py.figureMeshes, new THREE.Euler(0, 0, 0),
          (i) => py.figureSocketWorld(i), (i) => py.fitFigure(i), 0.055);
        this.rig.go(this.fitPose('pyFigs', py.tableSocketWorld().add(V(0, 0.035, 0)),
          0.20, 0.28, 0.46), 1.6);
      },
      hint: () => this.dragHint(),
      done: () => this.allPlaced(),
    });

    S({
      id: 'py_hub',
      enter: () => {
        this.stage([py.hubMesh], new THREE.Euler(0, 0, 0),
          () => py.hubSocketWorld(), () => py.fitHub(), 0.075);
        this.rig.go(this.fitPose('pyTop', py.hubSocketWorld(), 0.18, 0.16, 0.55), 1.8);
        this.look(py.hubSocketWorld());
      },
      hint: () => this.dragHint(),
      done: () => this.allPlaced(),
    });

    S({
      id: 'py_vanes',
      enter: () => {
        // a vane arrives already turned into its slot and pitched to match
        this.stage(py.vaneMeshes, new THREE.Euler(-0.62, 0, 0),
          (i) => py.vaneSocketWorld(i), (i) => py.fitVane(i), 0.05,
          (i) => py.vaneWorldQuat(i));
        this.rig.go(this.fitPose('pyVanes', py.hubSocketWorld().add(V(0, 0.012, 0)),
          0.30, 0.20, 0.55), 1.6);
      },
      hint: () => this.dragHint(),
      done: () => this.allPlaced(),
    });

    S({
      id: 'py_pitch',
      enter: () => {
        this.clearTray();
        this.rig.go(this.pose('pyPitch', py.hubSocketWorld().add(V(0, 0.008, 0)), 0.28,
          0.28, 0.34, { pDist: 0.36 }), 1.4);
        w.interaction.mode = {
          kind: 'arc',
          onChange: (d) => { py.setPitch(py.pitch + d * 1.9); audio.tick(520 + py.pitch * 260); },
          onDone: () => this.advance(),
        };
      },
      hint: () => {
        const c = py.rotorWorld(new THREE.Vector3());
        return { kind: 'arc', from: c.clone().add(V(-0.075, 0.004, 0.03)),
                 to: c.clone().add(V(0.075, 0.004, -0.03)) };
      },
      done: () => false,
    });

    S({
      id: 'py_candles',
      enter: () => {
        this.stage(py.candleMeshes, new THREE.Euler(0, 0, 0),
          (i) => py.candleSocketWorld(i), (i) => { py.fitCandle(i); w.syncFlamePositions(); }, 0.06);
        this.rig.go(this.fitPose('pyCandles', py.group.position.clone().add(V(0, 0.075, 0)),
          0.06, 0.28, 0.50), 2.0);
      },
      hint: () => this.dragHint(),
      done: () => this.allPlaced(),
    });

    S({
      id: 'py_light',
      enter: () => {
        this.clearTray();
        w.syncFlamePositions();
        this.rig.go(this.pose('pyLight', py.group.position.clone().add(V(0, 0.140, 0)), 0.68,
          0.10, 0.22, { pDist: 0.90 }), 1.8);
        this.beginIgnition(PY_CANDLES, py.wickWorld(0, new THREE.Vector3()));
      },
      update: (dt) => {
        const wicks = Array.from({ length: PY_CANDLES }, (_, i) => py.wickWorld(i, new THREE.Vector3()));
        this.runIgnition(dt, wicks, (i) => w.flames.isLit(F_PY + i), (i) => {
          w.flames.setLit(F_PY + i, true);
          audio.igniteWhoosh();
          py.setLitCount(py.candlesIn.filter((_, k) => w.flames.isLit(F_PY + k)).length);
        });
      },
      hint: () => this.igniteHint(
        Array.from({ length: PY_CANDLES }, (_, i) => py.wickWorld(i, new THREE.Vector3())),
        (i) => w.flames.isLit(F_PY + i)),
      done: () => {
        let n = 0;
        for (let i = 0; i < PY_CANDLES; i++) if (w.flames.isLit(F_PY + i)) n++;
        return n >= PY_CANDLES;
      },
      exit: () => { w.stowLighter(); w.interaction.traceAnchor = null; },
    });

    /* the one shot that has to be unbroken: flame, then up to the vanes */
    S({
      id: 'py_rise',
      enter: () => {
        w.interaction.mode = { kind: 'none' };
        this.rig.go(this.pose('pyFlameLow', py.flameWorld(0, new THREE.Vector3()).add(V(0, 0.012, 0)),
          0.235, 0.06, 0.03, { pDist: 0.30 }), 2.2);
        this.look(py.flameWorld(0, new THREE.Vector3()));
      },
      update: () => {
        // same yaw, same pitch, same distance: only the target climbs, so the
        // flame and the vanes stay in one continuous move
        if (this.t > 2.6) {
          this.rig.go(this.pose('pyRotorHigh', py.rotorWorld(new THREE.Vector3()).add(V(0, -0.01, 0)),
            0.235, 0.06, 0.03, { pDist: 0.30 }), 4.6);
          this.look(py.rotorWorld(new THREE.Vector3()));
        }
      },
      done: () => this.t > 8.0 && py.running,
    });

    S({
      id: 'py_settle',
      enter: () => {
        this.rig.go(this.pose('pyWhole', py.group.position.clone().add(V(0, 0.255, 0)), 0.94,
          0.10, 0.15, { pDist: 1.18 }), 3.0);
      },
      done: () => this.t > 3.6 && py.speedRatio > 0.45,
    });

    S({
      id: 'py_done',
      enter: () => { audio.chime(1); this.hud.setPip(1, 'done'); },
      done: () => this.t > 1.4,
    });

    /* ================= MODULE 3 : the angel chime ================= */
    S({
      id: 'ch_intro',
      enter: () => {
        this.hud.setPip(2, 'active');
        w.tray.setAnchor(ch.group.position);
        this.rig.go(this.pose('chIntro', ch.group.position.clone().add(V(0, 0.13, 0)), 0.56,
          -0.22, 0.20, { pDist: 0.72 }), 2.4);
        this.look(ch.group.position.clone().add(V(0, 0.12, 0)));
      },
      done: () => this.t > 1.9,
    });

    S({
      id: 'ch_angels',
      enter: () => {
        this.stage(ch.angelMeshes, new THREE.Euler(0, 0, 0),
          (i) => ch.hookWorld(i), (i) => ch.fitAngel(i), 0.06);
        ch.angelMeshes.forEach((a) => { a.position.y += 0.05; });
        this.drags.forEach((d, i) => {
          d.homeLocal.copy(ch.angelMeshes[i].position);
        });
        this.rig.go(this.fitPose('chHooks', ch.rotorWorld(new THREE.Vector3()).add(V(0, -0.03, 0)),
          -0.20, 0.14, 0.46), 1.8);
      },
      hint: () => this.dragHint(),
      done: () => this.allPlaced(),
    });

    S({
      id: 'ch_wire',
      enter: () => {
        this.clearTray();
        this.rig.go(this.pose('chWire', ch.group.position.clone().add(V(0, 0.20, 0)), 0.27,
          -0.16, 0.06, { pDist: 0.34 }), 1.6);
        w.interaction.mode = {
          kind: 'arc',
          onChange: (d) => { ch.setWire(ch.wire - d * 0.10); audio.tick(700 + ch.alignment * 300); },
          onDone: () => this.advance(),
        };
      },
      hint: () => {
        const c = ch.wireHandleWorld(new THREE.Vector3());
        // the angels start hanging too low: lift them to the collar mark
        return { kind: 'arc', from: c.clone().add(V(0, -0.045, 0)), to: c.clone().add(V(0, 0.045, 0)) };
      },
      done: () => false,
    });

    S({
      id: 'ch_bells',
      enter: () => {
        this.stage(ch.bellMeshes, new THREE.Euler(0, 0, 0),
          (i) => ch.bellWorld(i), (i) => ch.fitBell(i), 0.05);
        this.rig.go(this.fitPose('chBells', ch.group.position.clone().add(V(0, 0.17, 0)),
          -0.30, 0.22, 0.44), 1.8);
      },
      hint: () => this.dragHint(),
      done: () => this.allPlaced(),
    });

    S({
      id: 'ch_candles',
      enter: () => {
        this.stage(ch.candleMeshes, new THREE.Euler(0, 0, 0),
          (i) => ch.candleWorld(i), (i) => { ch.fitCandle(i); w.syncFlamePositions(); }, 0.055);
        this.rig.go(this.fitPose('chCandles', ch.group.position.clone().add(V(0, 0.055, 0)),
          -0.10, 0.28, 0.42), 1.8);
      },
      hint: () => this.dragHint(),
      done: () => this.allPlaced(),
    });

    S({
      id: 'ch_light',
      enter: () => {
        this.clearTray();
        w.syncFlamePositions();
        this.rig.go(this.pose('chLight', ch.group.position.clone().add(V(0, 0.120, 0)), 0.64,
          -0.10, 0.20, { pDist: 0.84 }), 1.8);
        this.beginIgnition(CH_CANDLES, ch.wickWorld(0, new THREE.Vector3()));
      },
      update: (dt) => {
        const wicks = Array.from({ length: CH_CANDLES }, (_, i) => ch.wickWorld(i, new THREE.Vector3()));
        this.runIgnition(dt, wicks, (i) => w.flames.isLit(F_CH + i), (i) => {
          w.flames.setLit(F_CH + i, true);
          audio.igniteWhoosh();
          ch.setLitCount(ch.candlesIn.filter((_, k) => w.flames.isLit(F_CH + k)).length);
        });
      },
      hint: () => this.igniteHint(
        Array.from({ length: CH_CANDLES }, (_, i) => ch.wickWorld(i, new THREE.Vector3())),
        (i) => w.flames.isLit(F_CH + i)),
      done: () => {
        let n = 0;
        for (let i = 0; i < CH_CANDLES; i++) if (w.flames.isLit(F_CH + i)) n++;
        return n >= CH_CANDLES;
      },
      exit: () => { w.stowLighter(); w.interaction.traceAnchor = null; },
    });

    S({
      id: 'ch_rise',
      enter: () => {
        w.interaction.mode = { kind: 'none' };
        this.rig.go(this.pose('chFlameLow', ch.group.position.clone().add(V(0, 0.058, 0)),
          0.34, -0.10, 0.03, { pDist: 0.44 }), 2.0);
      },
      update: () => {
        if (this.t > 2.4) {
          // same lens, same standoff: only the aim climbs, so the flames and
          // the ringing bells stay in one unbroken move
          this.rig.go(this.pose('chBellRun', ch.group.position.clone().add(V(0, 0.168, 0)),
            0.34, -0.10, 0.03, { pDist: 0.44 }), 4.2);
          this.look(ch.group.position.clone().add(V(0, 0.19, 0)));
        }
      },
      done: () => this.t > 7.5 && ch.strikeCount > 2,
    });

    S({
      id: 'ch_done',
      enter: () => {
        audio.chime(2);
        this.hud.setPip(2, 'done');
        this.rig.go(this.pose('chWhole', ch.group.position.clone().add(V(0, 0.15, 0)), 0.54,
          -0.18, 0.16, { pDist: 0.68 }), 2.6);
      },
      done: () => this.t > 3.0,
    });

    /* ================= the finished room ================= */
    S({
      id: 'final_macro',
      enter: () => {
        // the empty tray is cleared to the end of the bench: the finished room
        // should read as three machines, not three machines and a tray
        w.tray.setAnchor(V(1.10, 0, 0));
        this.rig.go(this.pose('finalMacro', w.smoker.mouthClosedWorld().add(V(0, 0.045, 0.01)),
          0.30, -0.18, 0.06, { pDist: 0.38 }), 3.0);
        this.look(w.smoker.mouthClosedWorld());
      },
      done: () => this.t > 3.2,
    });

    S({
      id: 'final_pull',
      enter: () => {
        this.rig.go(overview(), 6.5);
        this.look(V(0.1, BENCH_TOP + 0.15, 0));
      },
      update: () => {
        const k = clamp((this.t - 1.6) / 3.2, 0, 1);
        w.setLamp(1 - k * 0.70);          // the shop light drops one notch
        w.setEvening(0.55 + k * 0.45);    // and the village lamps take over
      },
      done: () => this.t > 7.0,
    });

    S({
      id: 'freeplay',
      enter: () => {
        this.free = true;
        this.hud.setPipsInteractive(true);
        this.enterFreeIdle();
      },
      update: (dt) => this.updateFree(dt),
      hint: () => this.freeHint(),
      done: () => false,
    });
  }

  /* ---------------- free play ---------------- */

  private enterFreeIdle() {
    this.freeMode = 'idle';
    this.freeT = 0;
    const w = this.w;
    this.rig.go(this.pose('overview', V(0.05, BENCH_TOP + 0.13, 0.0), 1.92, 0.05, 0.20,
      { fov: 40, pDist: 2.42, pFov: 43, pTargetY: 0.05 }), 2.6);
    this.look(V(0.1, BENCH_TOP + 0.15, 0));
    w.interaction.mode = {
      kind: 'tap',
      proxies: [w.smoker.bodyHit, w.pyramid.bodyHit, w.chimes.bodyHit],
      onTap: (id) => {
        if (id === 'smoker') this.enterFree(0);
        else if (id === 'pyramid') this.enterFree(1);
        else if (id === 'chimes') this.enterFree(2);
      },
    };
  }

  /** Tap a machine (or its mark) to work on it again, without replaying. */
  enterFree(machine: number) {
    if (!this.free) return;
    const w = this.w;
    this.freeT = 0;
    if (machine === 0) {
      this.freeMode = 'smoker';
      this.smokerReopen = 0;
      this.rig.go(this.pose('freeSm', w.smoker.group.position.clone().add(V(0.05, 0.115, 0)), 0.46,
        -0.30, 0.20, { pDist: 0.58 }), 1.8);
      this.look(w.smoker.upperHandleWorld());
      w.interaction.mode = { kind: 'swipe', dir: 1,
        onDone: () => {
          w.smoker.open();
          w.smoker.showSection(true);
          audio.slide(0.4);
          this.smokerReopen = 1;
          this.sectionHold = 2.4;
          w.interaction.mode = { kind: 'swipe', dir: -1,
            onDone: () => {
              w.smoker.close();
              audio.woodPlace(0.7, 150);
              this.smokerReopen = 2;
              this.freeT = 0;
            } };
        } };
    } else if (machine === 1) {
      this.freeMode = 'pyramid';
      this.rig.go(this.pose('freePy', w.pyramid.rotorWorld(new THREE.Vector3()).add(V(0, 0.005, 0)),
        0.30, 0.28, 0.30, { pDist: 0.38 }), 1.8);
      this.look(w.pyramid.rotorWorld(new THREE.Vector3()));
      const arcAgain = () => {
        w.interaction.mode = {
          kind: 'arc',
          onChange: (d) => { w.pyramid.setPitch(w.pyramid.pitch + d * 1.9); },
          onDone: () => { this.freeT = 0; arcAgain(); },
        };
      };
      arcAgain();
    } else {
      this.freeMode = 'chimes';
      this.rig.go(this.pose('freeCh', w.chimes.group.position.clone().add(V(0, 0.17, 0)), 0.32,
        -0.28, 0.22, { pDist: 0.41 }), 1.8);
      this.look(w.chimes.group.position.clone().add(V(0, 0.18, 0)));
      w.interaction.mode = {
        kind: 'tap',
        proxies: w.chimes.bellMeshes,
        onTap: () => { w.chimes.rotateBellSet(); this.freeT = 0; },
      };
    }
  }

  private sectionHold = 0;

  private updateFree(dt: number) {
    this.freeT += dt;
    if (this.sectionHold > 0) {
      this.sectionHold -= dt;
      if (this.sectionHold <= 0) this.w.smoker.showSection(false);
    }
    const timeout = this.freeMode === 'idle' ? Infinity
      : this.freeMode === 'smoker' ? (this.smokerReopen === 2 ? 4.5 : Infinity)
      : 9.0;
    if (this.freeT > timeout) this.enterFreeIdle();
  }

  private freeHint(): Hint {
    const w = this.w;
    if (this.freeMode === 'idle')
      return { kind: 'tap', at: w.pyramid.group.position.clone().add(V(0, 0.30, 0)) };
    if (this.freeMode === 'smoker')
      return this.smokerReopen === 0
        ? { kind: 'swipe', at: w.smoker.upperHandleWorld(), dir: 'up' }
        : this.smokerReopen === 1
          ? { kind: 'swipe', at: w.smoker.upperHandleWorld(), dir: 'down' }
          : null;
    if (this.freeMode === 'pyramid') {
      const c = w.pyramid.rotorWorld(new THREE.Vector3());
      return { kind: 'arc', from: c.clone().add(V(-0.075, 0.004, 0.03)),
               to: c.clone().add(V(0.075, 0.004, -0.03)) };
    }
    const b = w.chimes.bellWorld(0, new THREE.Vector3());
    return { kind: 'tap', at: b };
  }

  /* ---------------- driving ---------------- */

  private advance() {
    this.steps[this.idx]?.exit?.();
    this.idx++;
    this.t = 0;
    this.steps[this.idx]?.enter();
  }

  start() {
    this.idx = 0;
    this.t = 0;
    this.steps[0].enter();
  }

  update(dt: number) {
    if (this.idx < 0) return;
    this.t += dt;
    const s = this.steps[this.idx];
    if (!s) return;
    s.update?.(dt);
    if (s.done() && this.idx < this.steps.length - 1) this.advance();

    // the ring that says "it goes here"
    const h = this.hintNow();
    if (h && (h.kind === 'drag')) this.w.indicator.show(h.to, 0.055);
    else if (h && h.kind === 'trace') this.w.indicator.show(h.to, 0.030);
    else if (h && h.kind === 'tap') this.w.indicator.show(h.at, 0.09);
    else this.w.indicator.hide();
  }

  hintNow(): Hint {
    const s = this.steps[this.idx];
    return s?.hint ? s.hint() : null;
  }

  get stepId() { return this.steps[this.idx]?.id ?? 'none'; }
  get progress() { return `${this.idx + 1}/${this.steps.length}`; }
  get machinesRunning() {
    return [this.w.smoker.puffing, this.w.pyramid.running, this.w.chimes.running];
  }
  get counts() {
    return {
      vanes: this.w.pyramid.vanesPlaced, vaneTotal: VANE_COUNT,
      angels: this.w.chimes.angelsPlaced, angelTotal: ANGEL_COUNT,
      bells: this.w.chimes.bellsPlaced, bellTotal: BELL_COUNT,
      strikes: this.w.chimes.strikeCount,
    };
  }
}
