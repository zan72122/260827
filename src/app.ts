/**
 * The game loop and everything the finger is allowed to do at each step.
 *
 * One finger, four grab targets, no camera control. Each stage exposes only
 * the targets that belong to it, and every drag changes a physical quantity --
 * where the counterweight sits, how far the head has gone into the body, how
 * much thread has been drawn in, how hard the head was pushed. Nothing here
 * plays a canned animation on a success flag.
 */
import { Vector3 } from 'three';
import { StepClock, FIXED_DT } from './core/clock';
import { PointerRouter, type Touch } from './core/input';
import { Sfx } from './core/audio';
import { Workshop, type PickName } from './render/scene';
import { HeadRig, rotLocal } from './sim/rig';
import {
  advance,
  initialState,
  insertGuide,
  insertPoint,
  pullFraction,
  tieOff,
  type StageState,
} from './sim/stages';
import { CHIN_REST, GRIP, HEAD, JIG, MM, THREAD_LEN, THREAD_PEGS, WEIGHT_RAIL } from './sim/dims';

/** CSS pixels of drag that move the counterweight over its whole rail. */
const WEIGHT_TRAVEL_PX = 190;
/** Radians of head tilt per CSS pixel of vertical drag. */
const PRESS_PER_PX = 0.0042;

const HINTS: Record<string, string> = {
  balance: 'つまみを うごかしてね',
  insert: 'あたまを どうたいへ',
  thread: 'いとを ひいてね',
  tie: '',
  firstNod: 'あたまを ちょんと',
  play: 'ちょんと さわってね',
};

interface Grab {
  what: PickName;
  startS: number;
  startT: number;
  startPitch: number;
  lastPitch: number;
  lastAt: number;
  vel: number;
  axis: { x: number; y: number };
  lenPx: number;
}

export class Game {
  private shop: Workshop;
  private rig = new HeadRig();
  private state: StageState = initialState();
  private clock: StepClock;
  private router: PointerRouter;
  private sfx = new Sfx();
  private grab: Grab | null = null;
  private cut = 0;
  private cutWant = 0;
  private idle = 0;
  private variant = 0;
  private frameAvg = 1 / 60;
  private dprCap = 1.5;
  private shadowsOn = true;
  private running = false;
  private raf = 0;
  private hintEl: HTMLElement;
  private soundBtn: HTMLElement;
  private nextBtn: HTMLElement;
  private lastThreadLen = THREAD_LEN.start;

  constructor(host: HTMLElement, now?: () => number) {
    this.shop = new Workshop(host);
    this.clock = new StepClock(now);
    this.router = new PointerRouter(now);
    this.hintEl = document.getElementById('hint')!;
    this.soundBtn = document.getElementById('btn-sound')!;
    this.nextBtn = document.getElementById('btn-next')!;

    this.resetDoll(0);
    this.resize();

    this.router.onDown = this.down;
    this.router.onMove = this.move;
    this.router.onUp = this.up;
    this.router.onCancel = this.cancel;
    this.router.attach(this.shop.renderer.domElement);

    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.visibility);

    this.soundBtn.classList.add('on');
    this.soundBtn.addEventListener('click', () => {
      this.sfx.start();
      this.sfx.setMuted(!this.sfx.muted);
      this.soundBtn.textContent = this.sfx.muted ? '🔇' : '🔈';
    });
    this.nextBtn.addEventListener('click', () => this.resetDoll(this.variant + 1));
  }

  /* --------------------------------------------------------------- setup --- */

  /** Start a fresh head. Nothing is rebuilt: only the balance is different. */
  private resetDoll(variant: number): void {
    this.variant = variant;
    const scales = [1, 0.9, 1.1, 0.96];
    const starts = [0.15, 0.08, 0.2, 0.12];
    this.rig = new HeadRig();
    this.rig.shellMassScale = scales[variant % scales.length]!;
    this.rig.weightT = starts[variant % starts.length]!;
    this.rig.supportKind = 'jig';
    this.rig.supportPos = { x: JIG.hookX, y: JIG.hookY, z: JIG.hookZ };
    this.rig.pitch = this.rig.restPitch();
    this.rig.pitchVel = 0;
    this.rig.yaw = 0;
    this.rig.yawVel = 0;
    this.rig.threadLen = THREAD_LEN.start;
    this.lastThreadLen = THREAD_LEN.start;
    this.state = initialState();
    this.grab = null;
    this.cut = 0;
    this.cutWant = 0;
    this.idle = 0;
    this.nextBtn.classList.remove('on');
    this.shop.rig.set('balance', this.shop.aspect, this.framePoints());
    this.shop.rig.snap();
  }

  private resize = (): void => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.shop.resize(w, h, this.dprCap);
    // Keep the state, re-lay the shot for the new shape of screen.
    this.shop.rig.set(this.cameraStage(), this.shop.aspect, this.framePoints());
    this.shop.rig.snap();
    this.grab = null;
  };

  private visibility = (): void => {
    if (document.hidden) {
      this.router.abort();
      this.sfx.suspend();
    } else {
      // Never hand the head the time the tab spent asleep.
      this.clock.resync();
      this.sfx.resume();
    }
  };

  /* ---------------------------------------------------------------- input --- */

  private allowed(): PickName[] {
    switch (this.state.stage) {
      case 'balance':
        return ['grip'];
      case 'insert':
        return ['head'];
      case 'thread':
        return this.state.tieOffered ? ['toggle', 'tie'] : ['toggle'];
      case 'tie':
        return [];
      case 'firstNod':
      case 'play':
        return ['head'];
    }
  }

  /** Screen direction, in CSS pixels, of a world-space segment. */
  private screenAxis(a: Vector3, b: Vector3): { x: number; y: number; lenPx: number } {
    const h = window.innerHeight;
    const w = window.innerWidth;
    const pa = this.shop.project(a);
    const pb = this.shop.project(b);
    const dx = ((pb.nx - pa.nx) * w) / 2;
    const dy = (-(pb.ny - pa.ny) * h) / 2;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len, lenPx: len };
  }

  private down = (t: Touch): void => {
    this.sfx.start();
    this.idle = 0;
    const what = this.shop.pick(t.nx, t.ny, this.allowed());
    if (!what) return;

    if (what === 'tie') {
      tieOff(this.state, this.rig);
      this.sfx.knock(1.5, 0.16);
      return;
    }

    let axis = { x: 1, y: 0 };
    let lenPx = WEIGHT_TRAVEL_PX;
    if (what === 'grip') {
      // along the rail, as it actually appears on screen right now
      const a = this.headLocalToWorld(WEIGHT_RAIL.x0, WEIGHT_RAIL.y0, GRIP.z);
      const b = this.headLocalToWorld(WEIGHT_RAIL.x1, WEIGHT_RAIL.y1, GRIP.z);
      const s = this.screenAxis(a, b);
      axis = { x: s.x, y: s.y };
      lenPx = WEIGHT_TRAVEL_PX;
      this.sfx.knock(1.8, 0.1);
    } else if (what === 'head' && this.state.stage === 'insert') {
      const s = this.pathAxis(this.state.insertS);
      axis = { x: s.x, y: s.y };
      lenPx = s.lenPx;
      this.sfx.knock(0.8, 0.15);
    } else if (what === 'toggle') {
      const s = this.screenAxis(this.shop.togglePoint(0), this.shop.togglePoint(1));
      axis = { x: s.x, y: s.y };
      lenPx = Math.max(60, s.lenPx);
    } else if (what === 'head') {
      this.rig.held = true;
      this.rig.heldPitch = this.rig.pitch;
    }

    this.grab = {
      what,
      startS: this.state.insertS,
      startT: this.rig.weightT,
      startPitch: this.rig.pitch,
      lastPitch: this.rig.pitch,
      lastAt: this.clock.simTime,
      vel: 0,
      axis,
      lenPx,
    };
  };

  private move = (t: Touch): void => {
    const g = this.grab;
    if (!g) return;
    this.idle = 0;
    const along = t.dx * g.axis.x + t.dy * g.axis.y;

    switch (g.what) {
      case 'grip': {
        const before = this.rig.weightT;
        this.rig.weightT = clamp01(this.rig.weightT + along / g.lenPx);
        if (Math.abs(this.rig.weightT - before) > 0.004) this.sfx.rub(0.35);
        break;
      }
      case 'head': {
        if (this.state.stage === 'insert') {
          const s = clamp01(this.state.insertS + along / g.lenPx);
          this.state.insertS = s;
          const a = this.pathAxis(s);
          g.axis = { x: a.x, y: a.y };
          g.lenPx = a.lenPx;
          if (s > 0.985) this.state.insertS = 1;
          this.applyInsertPose();
        } else {
          // pressing: the head is held where the finger puts it
          this.rig.held = true;
          this.rig.heldPitch = clampAround(
            this.rig.heldPitch + t.dy * PRESS_PER_PX,
            this.rig.restPitch(),
            0.34,
          );
          this.rig.yawVel += t.dx * 0.0016;
          const now = this.clock.simTime;
          const dt = Math.max(1 / 240, now - g.lastAt);
          g.vel = (this.rig.heldPitch - g.lastPitch) / dt;
          g.lastPitch = this.rig.heldPitch;
          g.lastAt = now;
        }
        break;
      }
      case 'toggle': {
        const p = clamp01(pullFraction(this.rig) + along / g.lenPx);
        this.rig.threadLen = THREAD_LEN.max + (THREAD_LEN.min - THREAD_LEN.max) * p;
        if (Math.abs(this.rig.threadLen - this.lastThreadLen) > 0.25) {
          this.sfx.rub(0.5);
          this.lastThreadLen = this.rig.threadLen;
        }
        break;
      }
      case 'tie':
        break;
    }
  };

  private up = (t: Touch): void => {
    const g = this.grab;
    this.grab = null;
    if (!g) return;
    if (g.what === 'head' && this.state.stage !== 'insert') {
      // A light touch is a small nod; a long drag is a big one. Both are the
      // same release of the same body, only with different starting states.
      const tap = t.travel < 10 && t.age < 0.4;
      const vel = tap ? 1.5 : clampMag(g.vel, 7);
      this.rig.release(vel);
      if (tap) this.rig.yawVel += (t.nx > 0 ? -1 : 1) * 0.25;
      this.state.nodded = true;
      this.sfx.knock(1.25, 0.13);
    }
    if (g.what === 'head' && this.state.stage === 'insert' && this.state.insertS >= 1) {
      this.sfx.knock(0.7, 0.2);
    }
    if (g.what === 'grip') this.sfx.knock(1.9, 0.07);
  };

  private cancel = (): void => {
    // Whatever was being held is simply let go of, with no impulse.
    if (this.grab?.what === 'head' && this.state.stage !== 'insert') this.rig.release(0);
    this.grab = null;
  };

  /* ------------------------------------------------------------- helpers --- */

  private headLocalToWorld(x: number, y: number, z: number): Vector3 {
    const c = Math.cos(-this.rig.pitch);
    const s = Math.sin(-this.rig.pitch);
    const sup = this.rig.supportWorld();
    return new Vector3(
      (sup.x + x * c - y * s) * MM,
      (sup.y + x * s + y * c) * MM,
      (sup.z + z) * MM,
    );
  }

  /** Screen direction of the insertion route at `s`, and its length in pixels. */
  private pathAxis(s: number): { x: number; y: number; lenPx: number } {
    const a = insertPoint(Math.max(0, s - 0.06));
    const b = insertPoint(Math.min(1, s + 0.06));
    const axis = this.screenAxis(
      new Vector3(a.x * MM, a.y * MM, a.z * MM),
      new Vector3(b.x * MM, b.y * MM, b.z * MM),
    );
    // total route length on screen, so a full drag equals a full insertion
    let total = 0;
    let prev = insertPoint(0);
    for (let i = 1; i <= 12; i++) {
      const p = insertPoint(i / 12);
      total += this.screenAxis(
        new Vector3(prev.x * MM, prev.y * MM, prev.z * MM),
        new Vector3(p.x * MM, p.y * MM, p.z * MM),
      ).lenPx;
      prev = p;
    }
    return { x: axis.x, y: axis.y, lenPx: Math.max(120, total) };
  }

  /** Put the head on the route, guided towards the angle the opening needs. */
  private applyInsertPose(): void {
    const s = this.state.insertS;
    const p = insertPoint(s);
    this.rig.supportKind = 'carry';
    this.rig.supportPos = p;
    const g = insertGuide(s);
    const want = this.rig.restPitch() * (1 - g) + 0.08 * g;
    this.rig.pitch += (want - this.rig.pitch) * Math.min(1, g * 0.6 + 0.08);
    this.rig.pitchVel = 0;
  }

  /**
   * The things that must be on screen at this step.
   *
   * Deliberately built from the rest pose and from fixed positions rather than
   * the live ones, so the framing does not breathe with the nod. The thread,
   * tie and first-nod steps share one set on purpose: the camera then does not
   * move at all between the head lifting and the head first nodding.
   */
  private framePoints(): Vector3[] {
    const st = this.state.stage;
    const pitch = this.rig.restPitch();
    const P: Vector3[] = [];
    const add = (x: number, y: number, z = 0): void => {
      P.push(new Vector3(x * MM, y * MM, z * MM));
    };
    const head = (lx: number, ly: number, lz = 0, sup = this.rig.supportWorld()): void => {
      const r = rotLocal({ x: lx, y: ly }, pitch);
      add(sup.x + r.x, sup.y + r.y, sup.z + lz);
    };
    const headBox = (sup?: { x: number; y: number; z: number }): void => {
      const w = this.rig.weightPos();
      head(HEAD.muzzle.x, HEAD.muzzle.y, 0, sup);
      head(HEAD.cx, HEAD.cy + HEAD.hy + 14, 0, sup); // horns and ears
      head(-4, HEAD.cy, HEAD.hz, sup);
      head(-4, HEAD.cy, -HEAD.hz, sup);
      head(HEAD.armTip.x, HEAD.armTip.y, 0, sup);
      head(w.x, w.y, 0, sup);
    };

    if (st === 'balance') {
      const sup = { x: JIG.hookX, y: JIG.hookY, z: JIG.hookZ };
      headBox(sup);
      const w = this.rig.weightPos();
      head(w.x, w.y, GRIP.z + GRIP.r, sup);
      head(w.x, w.y, -WEIGHT_RAIL.r, sup);
      return P;
    }
    if (st === 'insert') {
      for (const s of [0, 0.35, 0.7, 1]) {
        const p = insertPoint(s);
        headBox(p);
      }
      add(-73, 20, 0);
      add(56, 74, 0);
      return P;
    }
    if (st === 'play') {
      headBox();
      add(-74, 30, 0);
      add(-40, 0, 20);
      add(20, 0, -20);
      add(0, 70, 0);
      return P;
    }
    // thread, tie and the first nod: one framing, held still
    headBox({ x: THREAD_PEGS.x, y: THREAD_PEGS.y - 4, z: 0 });
    add(THREAD_PEGS.x, THREAD_PEGS.y + 6, THREAD_PEGS.hz);
    add(12, 28, 0); // the inside of the belly, where the arm and weight hang
    add(12, 66, 0);
    add(CHIN_REST.x + 12, 24, 0);
    const tg = this.shop.togglePoint(0.5);
    P.push(tg);
    return P;
  }

  private cameraStage(): StageState['stage'] {
    return this.state.stage === 'firstNod' ? 'tie' : this.state.stage;
  }

  /* ---------------------------------------------------------------- frame --- */

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = (): void => {
      this.raf = requestAnimationFrame(tick);
      this.frame();
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame(): void {
    const { steps, frameDt } = this.clock.frame();
    if (frameDt > 0) this.frameAvg = this.frameAvg * 0.92 + frameDt * 0.08;

    for (let i = 0; i < steps; i++) {
      this.rig.step(FIXED_DT);
      const ev = advance(this.state, this.rig, FIXED_DT, { grabbing: this.grab !== null });
      if (ev) this.onStageEvent(ev);
      this.stageWork(FIXED_DT);
    }

    // the section slides in and out; it never jumps
    this.cut += (this.cutWant - this.cut) * Math.min(1, frameDt * 2.0);
    this.idle += frameDt;

    this.shop.rig.set(this.cameraStage(), this.shop.aspect, this.framePoints());
    this.shop.rig.update(frameDt);
    this.shop.update(this.rig, this.state.stage, {
      cut: this.cut,
      gripVisible: this.state.stage === 'balance',
      jigVisible: this.state.stage !== 'play',
      viewportH: window.innerHeight,
    });
    this.shop.render();
    this.updateHud();
    this.adapt();
  }

  /** Stage-driven changes that are not the child's doing. */
  private stageWork(dt: number): void {
    switch (this.state.stage) {
      case 'balance':
        this.cutWant = 0;
        this.rig.supportPos = { x: JIG.hookX, y: JIG.hookY, z: JIG.hookZ };
        break;
      case 'insert':
        // the section opens as the head goes in, so the arm can be followed
        this.cutWant = Math.max(0, Math.min(1, (this.state.insertS - 0.5) / 0.32));
        break;
      case 'thread':
        this.cutWant = 1;
        break;
      case 'tie':
        this.cutWant = 1;
        if (this.state.elapsed > 1.1) {
          this.state.stage = 'firstNod';
          this.state.elapsed = 0;
          this.sfx.settle();
        }
        break;
      case 'firstNod':
        // back to the whole doll before the first nod, without a cut
        this.cutWant = this.state.elapsed > 0.2 ? 0 : 1;
        break;
      case 'play':
        this.cutWant = 0;
        break;
    }
    void dt;
  }

  private onStageEvent(ev: string): void {
    if (ev === 'balanced') {
      this.sfx.settle();
      this.state.insertS = 0;
      this.applyInsertPose();
    } else if (ev === 'seated') {
      this.rig.supportKind = 'thread';
      this.rig.restPresent = true;
      this.sfx.knock(0.65, 0.24);
    } else if (ev === 'finished') {
      this.nextBtn.classList.add('on');
    }
  }

  private updateHud(): void {
    const text = HINTS[this.state.stage] ?? '';
    const show = text.length > 0 && this.idle > 7 && !this.grab;
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('on', show);
  }

  /**
   * Give ground on the background and the shadow before anything that matters:
   * the head's outline, its support and how fast it answers a finger.
   */
  private adapt(): void {
    if (this.frameAvg > 1 / 34 && this.dprCap > 1.0) {
      this.dprCap = 1.0;
      this.shop.resize(window.innerWidth, window.innerHeight, this.dprCap);
    } else if (this.frameAvg > 1 / 28 && this.shadowsOn) {
      this.shadowsOn = false;
      this.shop.renderer.shadowMap.enabled = false;
    }
  }

  stats(): { triangles: number; drawCalls: number; fps: number } {
    const s = this.shop.stats();
    return { ...s, fps: 1 / Math.max(1e-3, this.frameAvg) };
  }

  /**
   * Where a grab target is on screen and which way to drag it.
   *
   * Used by the capture script so that the evidence is produced by real
   * presses and drags at real screen positions rather than by reaching in and
   * setting values.
   */
  spotOf(name: PickName): { x: number; y: number; ax: number; ay: number } | null {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const p = this.shop.spotOf(name);
    if (!p) return null;
    const n = this.shop.project(p);
    let axis = { x: 1, y: 0 };
    if (name === 'grip') {
      axis = this.screenAxis(
        this.headLocalToWorld(WEIGHT_RAIL.x0, WEIGHT_RAIL.y0, GRIP.z),
        this.headLocalToWorld(WEIGHT_RAIL.x1, WEIGHT_RAIL.y1, GRIP.z),
      );
    } else if (name === 'head' && this.state.stage === 'insert') {
      axis = this.pathAxis(this.state.insertS);
    } else if (name === 'toggle') {
      axis = this.screenAxis(this.shop.togglePoint(0), this.shop.togglePoint(1));
    } else if (name === 'head') {
      axis = { x: 0, y: 1 };
    }
    return {
      x: ((n.nx + 1) / 2) * w,
      y: ((1 - n.ny) / 2) * h,
      ax: axis.x,
      ay: axis.y,
    };
  }

  /** Test and capture hook: the live state, without reaching into privates. */
  debug(): {
    stage: string;
    weightT: number;
    restPitchDeg: number;
    pitchDeg: number;
    rimGap: number;
    lift: number;
    insertS: number;
    triangles: number;
    drawCalls: number;
  } {
    const s = this.shop.stats();
    return {
      stage: this.state.stage,
      weightT: this.rig.weightT,
      restPitchDeg: (this.rig.restPitch() * 180) / Math.PI,
      pitchDeg: (this.rig.pitch * 180) / Math.PI,
      rimGap: this.rig.rimGap(),
      lift: this.rig.liftOffRest(),
      insertS: this.state.insertS,
      triangles: s.triangles,
      drawCalls: s.drawCalls,
    };
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function clampMag(x: number, m: number): number {
  return x > m ? m : x < -m ? -m : x;
}
function clampAround(x: number, c: number, r: number): number {
  return x < c - r ? c - r : x > c + r ? c + r : x;
}
