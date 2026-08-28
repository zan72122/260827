import * as THREE from 'three';
import { canvas2d } from '../core/textures';
import { drawDieRelief } from './PostmarkDie';
import type { MaterialLibrary } from './materials';

export type PressPhase = 'sleeping' | 'ready' | 'pulling' | 'striking' | 'returning' | 'spent';

export interface PressEvents {
  onInk?: () => void;
  onContact?: (pressure: number) => void;
  onRelease?: () => void;
  onGateOpen?: () => void;
}

const PAD_X = -0.09;
const ENV_X = 0.14;

/**
 * A hand-pulled cancelling machine: cast base, brass pivot, coil spring,
 * connecting rod, sliding die carrier. The die inks itself on the pad, travels
 * across, bites the sheet, and the belt gate only then releases.
 */
export class PostmarkPress {
  readonly group = new THREE.Group();
  readonly handle: THREE.Mesh;
  readonly handleHit: THREE.Mesh;
  readonly gate: THREE.Group;

  phase: PressPhase = 'sleeping';
  /** 0 = lever up, 1 = fully struck */
  pull = 0;

  private lever: THREE.Group;
  private carrier: THREE.Group;
  private die: THREE.Mesh;
  private dieMat: THREE.MeshStandardMaterial;
  private rod: THREE.Mesh;
  private spring: THREE.Mesh;
  private gateBar: THREE.Group;
  private events: PressEvents;

  private readyLift = 0;
  private inked = 0;
  private struck = false;
  private gateOpen = 0;
  private returnT = 0;
  private strikeT = 0;
  private lastPressure = 1;

  private rodTopWorld = new THREE.Vector3();
  private rodBotWorld = new THREE.Vector3();
  private armTip = new THREE.Object3D();

  constructor(mats: MaterialLibrary, events: PressEvents = {}) {
    this.events = events;

    // --- base: it has to look like it takes load
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.026, 0.26), mats.steelPainted);
    foot.position.set(-0.02, 0.013, 0);
    foot.castShadow = true;
    foot.receiveShadow = true;
    this.group.add(foot);

    for (const x of [-0.32, 0.26]) {
      for (const z of [-0.1, 0.1]) {
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 6), mats.brass);
        bolt.position.set(x, 0.03, z);
        this.group.add(bolt);
      }
    }

    const column = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.11), mats.steelPainted);
    column.position.set(-0.31, 0.15, 0);
    column.castShadow = true;
    this.group.add(column);

    const gusset = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.02, 0.1), mats.steelPainted);
    gusset.position.set(-0.24, 0.045, 0);
    this.group.add(gusset);

    const pivotBoss = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.12, 16), mats.brass);
    pivotBoss.rotation.x = Math.PI / 2;
    pivotBoss.position.set(-0.31, 0.27, 0);
    this.group.add(pivotBoss);

    // --- lever arm
    this.lever = new THREE.Group();
    this.lever.position.set(-0.31, 0.27, 0);
    this.group.add(this.lever);

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.022, 0.034), mats.brass);
    arm.position.set(0.21, 0, 0);
    arm.castShadow = true;
    this.lever.add(arm);

    const armRib = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.03, 0.01), mats.brass);
    armRib.position.set(0.2, -0.018, 0);
    this.lever.add(armRib);

    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.04, 12), mats.steelRaw);
    collar.rotation.z = Math.PI / 2;
    collar.position.set(0.36, 0, 0);
    this.lever.add(collar);

    this.handle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.1, 16), mats.woodDark);
    this.handle.rotation.z = Math.PI / 2;
    this.handle.position.set(0.43, 0, 0);
    this.handle.castShadow = true;
    this.lever.add(this.handle);

    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.031, 14, 10), mats.woodDark);
    knob.position.set(0.48, 0, 0);
    this.lever.add(knob);

    this.handleHit = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.16, 0.16),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.handleHit.position.set(0.43, 0, 0);
    this.lever.add(this.handleHit);

    this.armTip.position.set(0.16, -0.02, 0);
    this.lever.add(this.armTip);

    // --- coil spring pulling the lever back up
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      pts.push(new THREE.Vector3(Math.cos(t * Math.PI * 8) * 0.018, t * 0.11, Math.sin(t * Math.PI * 8) * 0.018));
    }
    this.spring = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.0035, 5, false),
      mats.steelRaw,
    );
    this.spring.position.set(-0.235, 0.135, 0.055);
    this.group.add(this.spring);

    // --- die carrier riding a rail
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.014, 0.018), mats.steelRaw);
    rail.position.set(0.0, 0.305, -0.062);
    this.group.add(rail);
    for (const x of [-0.2, 0.2]) {
      const standard = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.29, 0.018), mats.steelPainted);
      standard.position.set(x, 0.16, -0.062);
      this.group.add(standard);
    }

    this.carrier = new THREE.Group();
    this.carrier.position.set(PAD_X, 0.19, 0);
    this.group.add(this.carrier);

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.03), mats.steelPainted);
    shoe.position.y = 0.045;
    this.carrier.add(shoe);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 10), mats.steelRaw);
    stem.position.y = 0.015;
    this.carrier.add(stem);

    const [relief, rctx] = canvas2d(256, 256);
    drawDieRelief(rctx, 256);
    const reliefTex = new THREE.CanvasTexture(relief);

    this.dieMat = mats.rubberDie.clone();
    this.dieMat.bumpMap = reliefTex;
    this.dieMat.bumpScale = 0.35;

    const dieBody = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.048, 0.028, 24), mats.brass);
    dieBody.position.y = -0.02;
    this.carrier.add(dieBody);

    this.die = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.012, 24), this.dieMat);
    this.die.position.y = -0.04;
    this.die.castShadow = true;
    this.carrier.add(this.die);

    this.rod = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1, 8), mats.steelRaw);
    this.group.add(this.rod);

    // --- ink pad in its brass tray
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.016, 0.11), mats.brass);
    tray.position.set(PAD_X, 0.038, 0);
    this.group.add(tray);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.008, 0.09), mats.inkPad);
    pad.position.set(PAD_X, 0.05, 0);
    this.group.add(pad);

    // --- the plate the letter waits on
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.008, 0.19), mats.steelRaw);
    plate.position.set(ENV_X, 0.032, 0);
    plate.receiveShadow = true;
    this.group.add(plate);

    // --- belt safety gate downstream
    this.gate = new THREE.Group();
    this.gate.position.set(0.35, 0, 0);
    this.group.add(this.gate);
    for (const z of [-0.11, 0.11]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.2, 0.018), mats.steelPainted);
      post.position.set(0, 0.1, z);
      this.gate.add(post);
    }
    this.gateBar = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, 0.23), mats.paintedRed);
    this.gateBar.add(bar);
    for (const z of [-0.06, 0.06]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.03), mats.paintedCream);
      stripe.position.z = z;
      this.gateBar.add(stripe);
    }
    this.gateBar.position.y = 0.055;
    this.gate.add(this.gateBar);

    this.setPull(0);
  }

  /** Called when a letter stops at the gate: the lever lifts a little on its own. */
  wake(): void {
    if (this.phase === 'spent') return;
    this.phase = 'ready';
    this.struck = false;
    this.gateOpen = 0;
    this.pull = 0;
  }

  sleep(): void {
    this.phase = 'sleeping';
  }

  get isInteractive(): boolean {
    return this.phase === 'ready' || this.phase === 'pulling';
  }

  beginPull(): void {
    if (this.phase === 'ready') this.phase = 'pulling';
  }

  /** 0..1 from the child's finger travel. */
  setPull(v: number): void {
    this.pull = THREE.MathUtils.clamp(v, 0, 1);
    this.applyKinematics();
  }

  endPull(): void {
    if (this.phase !== 'pulling') return;
    if (this.pull > 0.82) {
      this.phase = 'striking';
      this.strikeT = 0;
      this.lastPressure = 0.82 + this.pull * 0.18;
    } else {
      this.phase = 'returning';
      this.returnT = 0;
    }
  }

  private applyKinematics(): void {
    const p = this.pull;
    // lever swings from raised to struck
    const restAngle = 0.62 - this.readyLift * 0.1;
    this.lever.rotation.z = restAngle - p * 0.78;

    // die: down to the pad, across the rail, then down on the sheet
    let x: number;
    let y: number;
    if (p < 0.4) {
      const t = p / 0.4;
      x = PAD_X;
      y = 0.19 - 0.088 * ease(t);
    } else if (p < 0.68) {
      const t = (p - 0.4) / 0.28;
      x = PAD_X + (ENV_X - PAD_X) * ease(t);
      y = 0.102 + 0.055 * Math.sin(t * Math.PI);
    } else {
      const t = (p - 0.68) / 0.32;
      x = ENV_X;
      y = 0.102 - 0.016 * ease(t);
    }
    this.carrier.position.set(x, y, 0);

    // ink builds on the rubber as it leaves the pad
    if (p > 0.34 && p < 0.45 && this.inked < 1) {
      this.inked = Math.min(1, this.inked + 0.34);
      if (this.inked >= 1) this.events.onInk?.();
    }
    this.dieMat.color.setRGB(
      0.23 - 0.09 * this.inked,
      0.22 - 0.06 * this.inked,
      0.2 + 0.06 * this.inked,
    );
    this.dieMat.roughness = 0.86 - 0.18 * this.inked;

    // connecting rod follows the geometry rather than pretending
    this.armTip.getWorldPosition(this.rodTopWorld);
    this.carrier.getWorldPosition(this.rodBotWorld);
    this.rodBotWorld.y += 0.055;
    const mid = this.rodTopWorld.clone().add(this.rodBotWorld).multiplyScalar(0.5);
    this.group.worldToLocal(mid);
    const len = this.rodTopWorld.distanceTo(this.rodBotWorld);
    this.rod.position.copy(mid);
    this.rod.scale.set(1, Math.max(0.001, len), 1);
    const dir = this.rodTopWorld.clone().sub(this.rodBotWorld).normalize();
    this.rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

    this.spring.scale.y = 1 - p * 0.42;

    this.gateBar.position.y = 0.055 + this.gateOpen * 0.15;
    this.gateBar.rotation.x = this.gateOpen * 0.22;
  }

  /** How far the paper is pressed down right now, 0..1. */
  get paperSink(): number {
    if (this.pull < 0.86) return 0;
    return (this.pull - 0.86) / 0.14;
  }

  get dieWorldPosition(): THREE.Vector3 {
    return this.carrier.getWorldPosition(new THREE.Vector3());
  }

  update(dt: number): void {
    if (this.phase === 'ready') {
      this.readyLift = Math.min(1, this.readyLift + dt * 2.2);
      this.applyKinematics();
    } else if (this.phase === 'sleeping') {
      this.readyLift = Math.max(0, this.readyLift - dt * 2.2);
      this.applyKinematics();
    } else if (this.phase === 'striking') {
      this.strikeT += dt;
      this.setPull(Math.min(1, this.pull + dt * 4.2));
      if (!this.struck && this.pull >= 0.995) {
        this.struck = true;
        this.events.onContact?.(this.lastPressure);
      }
      if (this.struck && this.strikeT > 0.22) {
        this.phase = 'returning';
        this.returnT = 0;
      }
    } else if (this.phase === 'returning') {
      this.returnT += dt;
      // spring return with a little overshoot, then the gate lets go
      const k = Math.min(1, this.returnT / 0.42);
      const eased = 1 - Math.pow(1 - k, 3);
      this.setPull(this.pull * (1 - eased) + 0 * eased);
      if (this.pull < 0.02) this.setPull(0);
      if (k >= 1) {
        this.events.onRelease?.();
        this.phase = this.struck ? 'spent' : 'ready';
        if (this.struck) {
          this.gateOpen = 0.0001;
        }
      }
    } else if (this.phase === 'spent' && this.gateOpen > 0 && this.gateOpen < 1) {
      this.gateOpen = Math.min(1, this.gateOpen + dt * 1.6);
      this.applyKinematics();
      if (this.gateOpen >= 1) this.events.onGateOpen?.();
    }
  }

  reset(): void {
    this.phase = 'sleeping';
    this.struck = false;
    this.inked = 0;
    this.gateOpen = 0;
    this.readyLift = 0;
    this.setPull(0);
  }
}

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}
