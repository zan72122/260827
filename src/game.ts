import * as THREE from 'three';
import { AudioEngine, WallKind } from './audio';
import { BALL_RADIUS, BallVisual } from './ball';
import { CameraDirector } from './camera';
import { buildCrane } from './crane';
import { DebrisSystem } from './debris';
import { DustSystem } from './dust';
import { DragInput } from './input';
import { clamp } from './math';
import { Pendulum } from './pendulum';
import { UI } from './ui';
import { Wall } from './wall';
import { buildYard } from './yard';

export const PIVOT = new THREE.Vector3(0, 9.0, -3.0);
export const ROPE_LENGTH = 7.4;

const GROUND_DUST_COLOR = new THREE.Color('#b0a690');
const DEMO_KEY = 'wy_demo_done_v1';

interface Quality {
  debrisPerShape: number;
  dustCount: number;
  pixelRatioCap: number;
}

function detectQuality(): Quality {
  const gpuHint = 'gpu' in navigator;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  if (gpuHint && mem >= 4) return { debrisPerShape: 150, dustCount: 800, pixelRatioCap: 2 };
  if (mem >= 4) return { debrisPerShape: 110, dustCount: 550, pixelRatioCap: 1.75 };
  return { debrisPerShape: 80, dustCount: 380, pixelRatioCap: 1.4 };
}

export class Game {
  readonly scene = new THREE.Scene();
  readonly director: CameraDirector;
  private pendulum = new Pendulum(PIVOT, ROPE_LENGTH);
  private ballVisual: BallVisual;
  private wall: Wall;
  private debris: DebrisSystem;
  private dust: DustSystem;
  private audio = new AudioEngine();
  private input: DragInput;
  private ui: UI;
  readonly quality: Quality;

  private impactCooldown = 0;
  private skimSoundCooldown = 0;
  private skimDustCooldown = 0;
  private landBurst = 0;
  private panelShownForWall = false;
  private throughPasses = 0;
  private prevBallZ = -10;
  private lastPull = 0;

  // silent one-time demo
  private demoActive = false;
  private demoT = 0;

  // for verification / debugging
  readonly debug = {
    lastImpact: null as null | { x: number; y: number; speed: number; destroyed: number },
    impacts: 0,
    wallRatio: 0,
    wallKind: 'brick' as WallKind,
    ballPos: new THREE.Vector3(),
  };

  private tmpPos = new THREE.Vector3();
  private tmpVel = new THREE.Vector3();

  constructor(container: HTMLElement, canvas: HTMLCanvasElement, aspect: number) {
    this.quality = detectQuality();
    this.director = new CameraDirector(aspect);
    buildYard(this.scene);
    this.scene.add(buildCrane(PIVOT));
    this.ballVisual = new BallVisual(this.scene);

    const debrisMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    this.debris = new DebrisSystem(this.scene, this.quality.debrisPerShape, { side: debrisMat });
    this.dust = new DustSystem(this.scene, this.quality.dustCount);

    this.wall = new Wall('brick', this.debris);
    this.scene.add(this.wall.group);

    this.debris.onLand = (kind, size01, pos) => {
      this.audio.debrisLand(kind, size01);
      this.landBurst++;
      if (size01 > 0.5) this.dust.groundPuff(pos, GROUND_DUST_COLOR, 4, 0.9);
    };

    this.ui = new UI(container);
    this.ui.setCurrent('brick');
    this.ui.onChoice = (c) => {
      if (c === 'retry') this.resetWall(this.wall.kind);
      else this.resetWall(c);
    };

    this.input = new DragInput(
      canvas,
      this.director.camera,
      PIVOT,
      ROPE_LENGTH,
      () => this.pendulum.ballPosition(this.tmpPos),
      {
        onAnyPointerDown: () => {
          this.audio.unlock();
          if (this.demoActive) this.finishDemo();
        },
        onDragStart: () => {
          this.pendulum.startDrag();
          this.director.setFrozen(true);
          this.director.toAim();
        },
        onDragEnd: () => {
          this.pendulum.endDrag();
          this.director.setFrozen(false);
          this.director.toSwing();
          if (this.pendulum.speed() > 1.2) this.audio.ropeTaut();
        },
      }
    );

    // barely-perceptible initial sway
    this.pendulum.omega.set(0.018, 0, 0.026);

    if (!localStorage.getItem(DEMO_KEY)) {
      this.demoActive = true;
      this.demoT = 0;
    }
  }

  /** Test/debug helper: switch or rebuild the wall. */
  pickWall(kind: WallKind): void {
    this.resetWall(kind);
  }

  /** Test/debug helper: settle the ball back to rest instantly. */
  calmBall(): void {
    this.pendulum.dragging = false;
    this.pendulum.dir.set(0, -1, 0);
    this.pendulum.omega.set(0, 0, 0);
  }

  private resetWall(kind: WallKind): void {
    if (kind !== this.wall.kind) {
      this.wall.dispose();
      this.wall = new Wall(kind, this.debris);
      this.scene.add(this.wall.group);
    } else {
      this.wall.reset();
    }
    this.debris.clear();
    this.panelShownForWall = false;
    this.throughPasses = 0;
    this.ui.setCurrent(kind);
    this.director.toAim();
  }

  private finishDemo(): void {
    this.demoActive = false;
    this.ui.setGhost(0, 0, false);
    this.pendulum.dragging = false;
    try {
      localStorage.setItem(DEMO_KEY, '1');
    } catch {
      /* private mode */
    }
  }

  /** Scripted silent example: the ball is drawn back a little and let go. */
  private stepDemo(dt: number, viewW: number, viewH: number): void {
    this.demoT += dt;
    const t = this.demoT;
    const pullDir = new THREE.Vector3(-0.16, -0.85, -0.5).normalize();
    if (t < 0.7) {
      // ghost fingertip drifts to the ball
      this.pendulum.dragging = false;
    } else if (t < 2.6) {
      // pull back slowly, then hold a beat so the ball settles on the arc
      const k = Math.min(1, (t - 0.7) / 1.5);
      if (!this.pendulum.dragging) this.pendulum.startDrag();
      const rest = new THREE.Vector3(0, -1, 0);
      const target = rest.lerp(pullDir, k * k).normalize();
      this.pendulum.setDragTarget(target);
    } else if (this.pendulum.dragging) {
      this.pendulum.endDrag();
      this.director.toSwing();
    } else if (t > 6.2) {
      this.finishDemo();
    }
    // ghost follows the ball on screen while "holding"
    if (t < 2.65) {
      const p = this.pendulum.ballPosition(this.tmpPos).clone().project(this.director.camera);
      const x = ((p.x + 1) / 2) * viewW;
      const y = ((1 - p.y) / 2) * viewH;
      this.ui.setGhost(x, y, t > 0.15);
    } else {
      this.ui.setGhost(0, 0, false);
    }
  }

  update(dt: number, viewW: number, viewH: number): void {
    dt = Math.min(dt, 1 / 20);

    if (this.demoActive && !this.ui.panelVisible) this.stepDemo(dt, viewW, viewH);

    // player drag -> filtered target on the rope sphere
    const dir = this.input.update(dt);
    if (dir && this.pendulum.dragging) {
      this.pendulum.setDragTarget(dir);
      if (this.input.pullAmount > this.lastPull + 0.06) {
        this.audio.ropeCreak(this.input.pullAmount);
        this.lastPull = this.input.pullAmount;
      } else if (this.input.pullAmount < this.lastPull - 0.1) {
        this.lastPull = this.input.pullAmount;
      }
    }
    if (!this.input.active) this.lastPull = 0;

    // pendulum substeps for a stable, heavy swing
    const sub = 4;
    for (let i = 0; i < sub; i++) this.pendulum.step(dt / sub);

    const pos = this.pendulum.ballPosition(this.tmpPos);
    const vel = this.pendulum.ballVelocity(this.tmpVel);
    const speed = vel.length();

    // ==== wall contact ====
    this.impactCooldown -= dt;
    if (this.impactCooldown <= 0 && !this.pendulum.dragging) {
      const contact = this.wall.testBallContact(pos, BALL_RADIUS, vel);
      if (contact) {
        const result = this.wall.applyImpact(contact, vel, this.dust);
        this.audio.impact(this.wall.kind, result.energy);
        this.director.onImpact(contact, result.energy);
        this.impactCooldown = 0.28;
        this.landBurst = 0;
        // heavy, inelastic rebound
        vel.z = -Math.abs(vel.z) * 0.2 - 0.25;
        vel.x *= 0.8;
        vel.y *= 0.82;
        this.pendulum.setBallVelocity(vel);
        this.debug.lastImpact = {
          x: contact.x,
          y: contact.y,
          speed,
          destroyed: result.destroyed,
        };
        this.debug.impacts++;
        if (result.destroyed > 3) {
          setTimeout(() => this.audio.dustSettle(clamp(result.destroyed / 14, 0, 1)), 700);
        }
      }
    }

    // ==== old structure behind the wall is solid ====
    if (pos.z > 1.9 && vel.z > 0) {
      vel.z = -vel.z * 0.3;
      vel.x *= 0.85;
      this.pendulum.setBallVelocity(vel);
      this.audio.impact('concrete', clamp(speed / 18, 0.05, 0.35));
      this.dust.burst(pos.clone().setZ(2.1), new THREE.Vector3(0, 0, -1), GROUND_DUST_COLOR, 8, 1.4);
    }

    // ==== low pass over the ground raises dust ====
    this.skimDustCooldown -= dt;
    this.skimSoundCooldown -= dt;
    if (pos.y < 1.15 && speed > 3.4) {
      if (this.skimDustCooldown <= 0) {
        this.skimDustCooldown = 0.09;
        this.dust.groundPuff(new THREE.Vector3(pos.x, 0.08, pos.z), GROUND_DUST_COLOR, 5, 1.1 + speed * 0.16);
      }
      if (this.skimSoundCooldown <= 0) {
        this.skimSoundCooldown = 0.9;
        this.audio.groundSkim(clamp(speed / 10, 0, 1));
      }
    }

    // ==== simulation upkeep ====
    const fell = this.wall.update(dt);
    if (fell > 0) this.landBurst = 0;
    this.debris.step(dt);
    this.dust.step(dt);
    this.audio.updateWhoosh(this.pendulum.dragging ? 0 : speed, dt);

    this.ballVisual.update(pos, PIVOT, speed, dt);
    this.director.setFrozen(this.input.active);
    this.director.update(dt, pos);

    // ==== offer rebuild / another material once the wall is mostly down ====
    this.debug.wallRatio = this.wall.destructionRatio();
    this.debug.wallKind = this.wall.kind;
    this.debug.ballPos.copy(pos);
    if (pos.z > 0.6 && this.prevBallZ <= 0.6) this.throughPasses++;
    this.prevBallZ = pos.z;
    const wallDone =
      this.debug.wallRatio > 0.55 || (this.debug.wallRatio > 0.3 && this.throughPasses >= 3);
    if (!this.panelShownForWall && wallDone && this.impactCooldown < -2.2) {
      this.panelShownForWall = true;
      this.ui.showPanel();
    }
  }
}
