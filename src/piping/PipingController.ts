import * as THREE from 'three';
import { ExtrusionBuilder, type RingSample } from './ExtrusionBuilder';
import type { NozzleSpec } from './NozzleProfile';
import type { CakeSurfaceContact } from '../scene/CakeSurfaceContact';
import { classifyGesture, type GestureKind, type PathPoint } from './GestureClassifier';
import { buildRosette, type GenContext } from './RosetteGenerator';
import { buildShell } from './ShellGenerator';
import { CreamMaterial } from '../render/CreamMaterial';
import { clamp, damp, lerp, smoothstep } from '../util/math';
import type { Decoration } from '../state/DecorationHistory';

export type PipingPhase = 'idle' | 'flow' | 'release';

/** linear speed the cream leaves the tip at, in m/s */
const FLOW_SPEED = 0.0305;
const RAMP = 0.115;
const RELEASE = 0.215;
const RELEASE_LIFT = 0.0042;
const MAX_HEIGHT = 0.0305;
const SEG_MIN = 0.0011;
const SEG_DT = 0.045;

const _up = new THREE.Vector3(0, 1, 0);

export class PipingController {
  readonly liveMesh: THREE.Mesh;
  readonly tip = new THREE.Vector3(0, 0.085, 0);
  readonly nozzleAxis = new THREE.Vector3(0, 1, 0);

  phase: PipingPhase = 'idle';
  flow = 0;
  /** 0..1, how much the stroke currently reads as a side-to-side ribbon */
  ribbon = 0;
  /** live guess at what is being drawn, for the camera director */
  liveKind: GestureKind = 'star';

  onFinish: ((d: Decoration, kind: GestureKind) => void) | null = null;
  onVolume: ((v: number) => void) | null = null;

  private builder: ExtrusionBuilder;
  private material: CreamMaterial;
  private spec: NozzleSpec;

  private h = 0;
  private scale = 1;
  private cx = 0;
  private cz = 0;
  private releaseT = 0;
  private lastCommit = new THREE.Vector3();
  private lastCommitTime = 0;
  private lastTangent = new THREE.Vector3(0, 1, 0);
  private path: PathPoint[] = [];
  private pathGround: number[] = [];
  private lastPathT = 0;

  private dirLP = new THREE.Vector2(1, 0);
  private prevX = 0;
  private prevZ = 0;
  private latSign = 0;
  private turnLP = 0;
  private velX = 0;
  private pvX = 0;
  private pvZ = 0;
  private velZ = 0;
  private latSmooth = 0;
  private crossings: number[] = [];
  /** every reversal in this stroke, not just the recent ones */
  private oscTotal = 0;
  private startTime = 0;

  constructor(
    private contact: CakeSurfaceContact,
    specs: NozzleSpec,
    bubble: number,
    maxProfilePoints: number,
  ) {
    this.spec = specs;
    this.builder = new ExtrusionBuilder(660, maxProfilePoints);
    this.material = new CreamMaterial({ bubble, settle: false });
    this.liveMesh = new THREE.Mesh(this.builder.geometry, this.material);
    this.liveMesh.castShadow = true;
    this.liveMesh.receiveShadow = true;
    this.liveMesh.frustumCulled = false;
    this.liveMesh.visible = false;
    this.liveMesh.renderOrder = 1;
  }

  get nozzle(): NozzleSpec {
    return this.spec;
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** direction reversals counted in the last 1.4 s — the live ribbon signal */
  get oscillations(): number {
    return this.crossings.length;
  }

  /** every reversal since the stroke began — what the classifier judges on */
  get oscillationsTotal(): number {
    return this.oscTotal;
  }

  setNozzle(spec: NozzleSpec): void {
    if (this.phase !== 'idle') return;
    this.spec = spec;
  }

  setBubble(v: number): void {
    this.material.setBubble(v);
  }

  updateTime(t: number): void {
    this.material.uTime.value = t;
  }

  /** Hover the tip over a point without extruding. */
  hover(x: number, z: number, height: number, dt: number): void {
    if (this.phase !== 'idle') return;
    this.cx = damp(this.cx, x, 0.12, dt);
    this.cz = damp(this.cz, z, 0.12, dt);
    const g = this.contact.surfaceY(this.cx, this.cz) + this.contact.creamHeight(this.cx, this.cz);
    this.tip.set(this.cx, g + height, this.cz);
  }

  begin(x: number, z: number, now: number): void {
    if (this.phase !== 'idle') return;
    this.phase = 'flow';
    this.flow = 0;
    this.releaseT = 0;
    this.scale = 0.82;
    this.cx = x;
    this.cz = z;
    this.prevX = x;
    this.prevZ = z;
    this.latSign = 0;
    this.turnLP = 0;
    this.latSmooth = 0;
    this.velX = 0;
    this.velZ = 0;
    this.pvX = 0;
    this.pvZ = 0;
    this.dirLP.set(1, 0);
    this.crossings.length = 0;
    this.oscTotal = 0;
    this.ribbon = 0;
    this.liveKind = 'star';
    this.startTime = now;
    this.path = [{ x, z, t: now }];
    this.pathGround = [];
    this.lastPathT = now;

    this.contact.beginStroke();
    const surf = this.contact.surfaceY(x, z);
    const ground = surf + this.contact.creamHeightBase(x, z) * 0.86;
    this.pathGround.push(ground);
    this.h = this.spec.cream.maxR * 0.82 + 0.0016;
    this.tip.set(x, ground + this.h, z);

    this.builder.begin(this.spec.cream);
    this.liveMesh.visible = true;

    // seed the foot so cream never appears out of thin air
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const y = lerp(ground - 0.0004, this.tip.y, u);
      this.builder.commit(
        {
          c: new THREE.Vector3(x, y, z),
          t: _up,
          su: lerp(0.94, 1.0, u),
          sv: lerp(0.94, 1.0, u),
          roll: 0,
          flare: Math.pow(1 - u, 1.3) * 0.0023,
          lift: u * 0.15,
          time: now,
        },
        this.spec.rollLock,
      );
    }
    this.lastCommit.copy(this.tip);
    this.lastCommitTime = now;
    this.lastTangent.set(0, 1, 0);
    this.contact.addPress(x, z, this.spec.cream.maxR * 2.0, 0.0006);
  }

  requestEnd(now: number): void {
    if (this.phase !== 'flow') return;
    this.phase = 'release';
    this.releaseT = 0;
    this.lastCommitTime = now;
  }

  update(dt: number, now: number, targetX: number, targetZ: number, speed: number): void {
    if (this.phase === 'idle') return;

    if (this.phase === 'flow') {
      this.flow = Math.min(1, this.flow + dt / RAMP);
      this.cx = damp(this.cx, targetX, 0.028, dt);
      this.cz = damp(this.cz, targetZ, 0.028, dt);
      this.trackOscillation(dt, now);
      if (now - this.lastPathT > 0.018) {
        this.lastPathT = now;
        this.path.push({ x: this.cx, z: this.cz, t: now });
        this.pathGround.push(
          this.contact.surfaceY(this.cx, this.cz) +
            this.contact.creamHeightBase(this.cx, this.cz) * 0.86,
        );
        this.updateLiveKind();
      }
    } else {
      this.releaseT += dt;
      this.flow = Math.max(0, 1 - this.releaseT / RELEASE);
    }

    const vE = FLOW_SPEED * this.spec.flowScale * Math.max(this.flow, 0.001);
    const s = this.phase === 'flow' ? speed : 0;

    // faster finger -> less cream per unit length; slower -> thicker, then taller
    let targetScale = s > vE ? clamp(Math.sqrt(vE / s), 0.55, 1.0) : 1.0;
    if (this.phase === 'release') {
      const r = clamp(this.releaseT / RELEASE, 0, 1);
      targetScale = Math.min(targetScale, lerp(1, this.spec.tipScale, Math.pow(r, 0.7)));
    }
    this.scale = damp(this.scale, targetScale, 0.065, dt);

    const ground =
      this.contact.surfaceY(this.cx, this.cz) +
      this.contact.creamHeightBase(this.cx, this.cz) * 0.86;
    const sectionR = this.spec.cream.maxR * this.scale;
    const hMin = sectionR * 0.80;

    if (this.phase === 'flow') {
      const cap = smoothstep(MAX_HEIGHT, MAX_HEIGHT * 0.5, this.h);
      this.h += Math.max(0, vE - s) * 0.93 * cap * dt;
      if (s > vE * 0.5) this.h = damp(this.h, hMin, 0.11, dt);
      this.h = Math.max(this.h, hMin);
    } else {
      this.h += (RELEASE_LIFT / RELEASE) * dt;
    }

    this.tip.set(this.cx, ground + this.h, this.cz);
    this.updateAxis(dt, s);

    const moved = this.tip.distanceTo(this.lastCommit);
    const since = now - this.lastCommitTime;
    const wantRing =
      moved >= SEG_MIN || since >= SEG_DT || (this.phase === 'release' && since >= 0.013);

    const sample = this.makeSample(now, ground);
    if (wantRing && (moved > 1e-5 || this.phase === 'release')) {
      this.builder.commit(sample, this.spec.rollLock);
      this.lastCommit.copy(sample.c);
      this.lastCommitTime = now;
      this.contact.addDeposit(
        this.cx,
        this.cz,
        sectionR * 1.2,
        this.tip.y - this.contact.surfaceY(this.cx, this.cz),
      );
      if (this.h < 0.007) {
        this.contact.addPress(this.cx, this.cz, sectionR * 2.1, 0.00062 * this.flow);
      }
      if (this.onVolume) this.onVolume(this.spec.cream.area * Math.max(moved, vE * dt));
    } else {
      this.builder.setPreview(sample, this.spec.rollLock);
    }

    if (this.phase === 'release' && this.releaseT >= RELEASE) this.finish(now);
  }

  private makeSample(now: number, ground: number): RingSample {
    const dir = _tmp.copy(this.tip).sub(this.lastCommit);
    if (dir.lengthSq() > 1e-9) {
      dir.normalize();
      this.lastTangent.lerp(dir, 0.55).normalize();
    }
    const near = clamp((this.tip.y - ground) / 0.0060, 0, 1);
    const ribbonRoll = this.ribbon * 0.55 * clamp(this.latSmooth / 0.06, -1, 1);
    // a ribbon flattens the section into a band as well as rolling it
    const su = this.scale * (1 + this.ribbon * 0.34);
    const sv = this.scale * (1 - this.ribbon * 0.20);
    return {
      c: _tmpC.copy(this.tip),
      t: this.lastTangent,
      su,
      sv,
      roll: ribbonRoll,
      flare: Math.pow(1 - near, 1.6) * 0.0021 * (0.5 + 0.5 * this.flow),
      lift: clamp((this.tip.y - ground) / 0.012, 0, 1),
      time: now,
    };
  }

  private updateAxis(dt: number, speed: number): void {
    // the tip leans back out of the direction of travel, like a real hand
    const vx = this.velX;
    const vz = this.velZ;
    const l = Math.hypot(vx, vz);
    const lean = clamp(speed / 0.055, 0, 1) * 0.5;
    _axisTarget.copy(_up);
    if (l > 1e-6) _axisTarget.add(_tmp.set(-vx / l, 0, -vz / l).multiplyScalar(lean));
    _axisTarget.add(_tmp.copy(this.bagLean).multiplyScalar(0.34));
    _axisTarget.normalize();
    this.nozzleAxis.lerp(_axisTarget, clamp(dt * 7, 0, 1)).normalize();
  }

  /** horizontal direction the bag body should lean toward (set by the camera) */
  readonly bagLean = new THREE.Vector3(0, 0, -1);

  private trackOscillation(dt: number, now: number): void {
    const vx = (this.cx - this.prevX) / Math.max(dt, 1e-4);
    const vz = (this.cz - this.prevZ) / Math.max(dt, 1e-4);
    this.prevX = this.cx;
    this.prevZ = this.cz;
    this.velX = damp(this.velX, vx, 0.06, dt);
    this.velZ = damp(this.velZ, vz, 0.06, dt);
    // work from the smoothed velocity: touch events arrive unevenly and a raw
    // frame-to-frame difference is mostly noise
    const svx = this.velX;
    const svz = this.velZ;
    const sp = Math.hypot(svx, svz);
    if (sp > 0.004) {
      const k = clamp(dt / 0.28, 0, 1);
      this.dirLP.x += (svx / sp - this.dirLP.x) * k;
      this.dirLP.y += (svz / sp - this.dirLP.y) * k;
      const dl = Math.hypot(this.dirLP.x, this.dirLP.y) || 1;
      const px = -this.dirLP.y / dl;
      const pz = this.dirLP.x / dl;
      this.latSmooth += (svx * px + svz * pz - this.latSmooth) * clamp(dt / 0.05, 0, 1);

      // A ribbon reverses its turn direction again and again; a loop turns one
      // way the whole time. Smooth the signed turn rate, then count its sign
      // changes: sampling jitter inside a loop never survives the filter.
      const pl = Math.hypot(this.pvX, this.pvZ);
      if (pl > 0.004) {
        const cross = this.pvX * svz - this.pvZ * svx;
        const dot = this.pvX * svx + this.pvZ * svz;
        const rate = Math.atan2(cross, dot) / Math.max(dt, 1e-4);
        this.turnLP = damp(this.turnLP, clamp(rate, -24, 24), 0.13, dt);
        if (Math.abs(this.turnLP) > 1.2) {
          const sign = Math.sign(this.turnLP);
          if (this.latSign !== 0 && sign !== this.latSign) {
            this.crossings.push(now);
            this.oscTotal++;
          }
          this.latSign = sign;
        }
      }
      this.pvX = svx;
      this.pvZ = svz;
    }
    while (this.crossings.length && now - this.crossings[0] > 1.4) this.crossings.shift();
    const target = smoothstep(1.2, 3.0, this.crossings.length);
    this.ribbon = damp(this.ribbon, target, 0.16, dt);
  }

  private updateLiveKind(): void {
    if (this.path.length < 4) return;
    const g = classifyGesture(this.path, this.oscTotal);
    this.liveKind = g.kind;
  }

  /**
   * Close the strand off. A star tip is already down to a peak by now, so this
   * is a whisker; a round tip is still fat, so the same code rounds it into the
   * dome a real dot ends with.
   */
  private appendCap(last: RingSample, now: number): void {
    const steps = 4;
    const reach = this.spec.cream.maxR * last.su * 0.85;
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const k = Math.pow(Math.cos((u * Math.PI) / 2), 0.62);
      _capC.copy(last.c).addScaledVector(last.t, reach * Math.sin((u * Math.PI) / 2));
      this.builder.commit(
        {
          c: _capC,
          t: last.t,
          su: Math.max(0.02, last.su * k),
          sv: Math.max(0.02, last.sv * k),
          roll: last.roll,
          flare: 0,
          lift: last.lift,
          time: now,
        },
        this.spec.rollLock,
      );
    }
  }

  private finish(now: number): void {
    const g = classifyGesture(this.path, this.oscTotal);
    const groundLookup = this.makeGroundLookup();
    const ctx: GenContext = {
      groundY: groundLookup,
      sectionR: this.spec.cream.maxR,
      now,
    };

    let rebuilt: RingSample[] | null = null;
    if (g.kind === 'rosette' && this.path.length > 8) rebuilt = buildRosette(this.path, g, ctx);
    else if (g.kind === 'shell' && this.path.length > 4) rebuilt = buildShell(this.path, g, ctx);

    if (rebuilt && rebuilt.length > 6) {
      this.builder.begin(this.spec.cream);
      for (const r of rebuilt) this.builder.commit(r, this.spec.rollLock);
      this.appendCap(rebuilt[rebuilt.length - 1], now);
      for (const r of rebuilt) {
        this.contact.addDeposit(
          r.c.x,
          r.c.z,
          this.spec.cream.maxR * r.su * 1.2,
          r.c.y - this.contact.surfaceY(r.c.x, r.c.z),
        );
      }
    }

    if (!rebuilt) {
      this.appendCap(
        {
          c: _capLast.copy(this.lastCommit),
          t: this.lastTangent,
          su: this.scale,
          sv: this.scale,
          roll: 0,
          flare: 0,
          lift: 1,
          time: now,
        },
        now,
      );
    }

    const geo = this.builder.finalize(now);
    this.liveMesh.visible = false;
    this.builder.clear();
    this.phase = 'idle';
    this.flow = 0;
    this.ribbon = 0;

    if (geo && this.onFinish) {
      const traj = new Float32Array(this.path.length * 3);
      for (let i = 0; i < this.path.length; i++) {
        traj[i * 3] = this.path[i].x;
        traj[i * 3 + 1] = this.path[i].t - this.startTime;
        traj[i * 3 + 2] = this.path[i].z;
      }
      this.onFinish(
        {
          kind: g.kind,
          nozzle: this.spec.id,
          trajectory: traj,
          centreX: g.cx,
          centreZ: g.cz,
          radius: Math.max(g.radius, this.spec.cream.maxR * 1.5),
          geometry: geo,
        },
        g.kind,
      );
    } else if (geo) {
      geo.dispose();
    }
  }

  private makeGroundLookup(): (x: number, z: number) => number {
    const pts = this.path;
    const gs = this.pathGround;
    return (x: number, z: number): number => {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const d = (pts[i].x - x) * (pts[i].x - x) + (pts[i].z - z) * (pts[i].z - z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      const recorded = gs[Math.min(best, gs.length - 1)] ?? this.contact.surfaceY(x, z);
      return Math.max(recorded, this.contact.surfaceY(x, z));
    };
  }
}

const _tmp = new THREE.Vector3();
const _tmpC = new THREE.Vector3();
const _axisTarget = new THREE.Vector3();
const _capC = new THREE.Vector3();
const _capLast = new THREE.Vector3();
