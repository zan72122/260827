import * as THREE from 'three';
import { Rig, WORLD } from './rig';
import { buildScene, type SceneBuild } from './scene';
import { buildWater, type WaterHandle } from './water';
import { Director } from './camera';
import { GameAudio } from './audio';
import { SwitchPad } from './switchpad';
import { buildEnvironment } from './env';
import { makeFinMaps, makeFishMaps } from './textures';
import { AdaptiveQuality, initialQuality, type QualitySettings } from './quality';
import type { FishMeshes } from './fish';

type Phase = 'title' | 'deploy' | 'wait' | 'wind' | 'mobile' | 'unhook' | 'tank';

interface FreeFish {
  meshes: FishMeshes;
  mode: 'arc' | 'swim' | 'leave';
  t: number;
  from: THREE.Vector3;
  ctrl: THREE.Vector3;
  to: THREE.Vector3;
  phase: number;
  speed: number;
  radius: number;
  depth: number;
}

/** Damped harmonic used for every rod-tip signal. */
class Tip {
  value = 0;
  private vel = 0;
  omega = 66;
  zeta = 0.16;
  step(dt: number): number {
    const acc = -this.omega * this.omega * this.value - 2 * this.zeta * this.omega * this.vel;
    this.vel += acc * dt;
    this.value += this.vel * dt;
    return this.value;
  }
  kick(v: number, omega: number, zeta: number): void {
    this.omega = omega;
    this.zeta = zeta;
    this.vel += v;
  }
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private build: SceneBuild;
  private water: WaterHandle;
  private rig: Rig;
  private director = new Director();
  private audio = new GameAudio();
  private pad: SwitchPad;
  private quality: QualitySettings;
  private adaptive: AdaptiveQuality;

  private phase: Phase = 'title';
  private phaseT = 0;
  private round = 0;
  private hooked = 0;
  private time = 0;
  private accumulator = 0;
  private lastFrame = 0;

  private biteTimes: number[] = [];
  private biteRolls: number[] = [];
  private nextBite = 0;
  private waitT = 0;
  private tipOsc = new Tip();
  private tipNoise = 0;
  private pendingKicks: { at: number; v: number; omega: number; zeta: number }[] = [];
  private bendTarget = 0;
  private bend = 0;
  private shotTimer = 0;
  private movedToMid = false;

  private freeFish: FreeFish[] = [];
  private unhookIndex = 0;
  private unhookTotal = 0;
  private unhookTimer = 0;
  private tankReleased = false;

  private padHeight = 120;
  private pressing = false;
  private hintEl: HTMLElement | null = null;
  private hintUsed = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.quality = initialQuality();
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x05070a, 1);

    const env = buildEnvironment(this.renderer, this.quality.envSize);
    this.build = buildScene(env, this.quality);
    this.water = buildWater(WORLD.holeHalfX, WORLD.holeHalfZ);
    this.build.scene.add(this.water.mesh, this.water.abyss);

    this.rig = new Rig(
      {
        bodySegments: this.quality.bodySegments,
        radialSegments: this.quality.radialSegments,
        transmission: this.quality.transmission,
        fishMaps: makeFishMaps(this.quality.envSize >= 256 ? 1024 : 512),
        finMaps: makeFinMaps(this.quality.envSize >= 256 ? 512 : 256),
        env,
      },
      this.quality.dropCapacity,
    );
    this.build.scene.add(this.rig.group);
    this.pad = new SwitchPad(env);

    this.adaptive = new AdaptiveQuality(this.quality, (s) => {
      this.renderer.setPixelRatio(s.pixelRatio);
      this.renderer.shadowMap.enabled = s.shadows;
      this.build.keyLight.castShadow = s.shadows;
      this.rig.setDropCapacity(s.dropCapacity);
      this.resize();
    });

    this.resize();
    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    this.bindInput();
  }

  attachHint(el: HTMLElement): void {
    this.hintEl = el;
  }

  // ---------------------------------------------------------------- input
  private bindInput(): void {
    const inPad = (y: number) => y > this.canvas.clientHeight - this.padHeight;
    const down = (e: PointerEvent) => {
      e.preventDefault();
      void this.audio.start();
      const y = e.clientY;
      if (inPad(y)) {
        this.pressing = true;
        this.hideHint();
        this.onSwitchDown();
      } else {
        this.onTap();
      }
    };
    const up = (e: PointerEvent) => {
      e.preventDefault();
      this.pressing = false;
    };
    this.canvas.addEventListener('pointerdown', down);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    addEventListener('blur', () => {
      this.pressing = false;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pressing = false;
        this.audio.suspend();
      } else {
        this.audio.resume();
      }
    });
  }

  private hideHint(): void {
    if (this.hintEl && !this.hintUsed) {
      this.hintUsed = true;
      this.hintEl.classList.add('hint--off');
    }
  }

  private onSwitchDown(): void {
    if (this.phase === 'wait') this.startWind();
    else if (this.phase === 'mobile') this.startUnhook();
    else if (this.phase === 'tank') this.leaveTank();
  }

  private onTap(): void {
    if (this.phase === 'mobile') this.startUnhook();
    else if (this.phase === 'tank') this.leaveTank();
  }

  // ---------------------------------------------------------------- phases
  begin(): void {
    this.phase = 'title';
    this.director.setShot('cabin', true);
  }

  play(): void {
    if (this.phase !== 'title') return;
    this.startRound();
  }

  private startRound(): void {
    this.round++;
    this.hooked = 0;
    this.rig.clearFish();
    this.rig.prepareRound(this.round * 1013 + 7);
    this.rig.reset();
    this.rig.resetSurfaceFlags();
    this.director.resetReveal();
    this.phase = 'deploy';
    this.phaseT = 0;
    this.shotTimer = 0;
    this.movedToMid = false;
    this.director.setShot('cabin');
    this.bendTarget = 0;
    this.scheduleBites();
  }

  /** From round four on only the shoal density and the spacing of the bites drift. */
  private scheduleBites(): void {
    const r = () => Math.random();
    const dense = this.round >= 4 ? 0.72 + r() * 0.62 : 1;
    if (this.round === 1) {
      this.biteTimes = [0.8, 5.4, 9.8];
      this.biteRolls = [1, 0.92, 0.5];
    } else if (this.round === 2) {
      this.biteTimes = [0.7, 3.4 + r() * 0.8, 7.0 + r() * 1.2];
      this.biteRolls = [1, 0.95, 0.55];
    } else {
      const b1 = 0.5 + r() * 0.5;
      const b2 = b1 + (2.5 + r() * 1.4) * dense;
      const b3 = b2 + (2.8 + r() * 1.8) * dense;
      this.biteTimes = [b1, b2, b3];
      this.biteRolls =
        this.round >= 4 ? [1, 0.72 + r() * 0.24, 0.38 + r() * 0.32] : [1, 0.85, 0.55];
    }
    this.nextBite = 0;
    this.waitT = 0;
  }

  private startWind(): void {
    this.phase = 'wind';
    this.phaseT = 0;
    this.rig.resetSurfaceFlags();
  }

  private startUnhook(): void {
    if (this.rig.fishCount === 0) {
      this.startRound();
      return;
    }
    this.phase = 'unhook';
    this.phaseT = 0;
    this.tankReleased = false;
    this.unhookIndex = 0;
    this.unhookTotal = this.rig.fishCount;
    this.unhookTimer = 0.35;
  }

  private leaveTank(): void {
    this.tankReleased = true;
    for (const f of this.freeFish) {
      if (f.mode === 'swim') {
        const tank = this.build.tank;
        f.mode = 'leave';
        f.t = 0;
        f.from.copy(f.meshes.group.position);
        f.to.copy(tank.group.localToWorld(tank.chute.clone()));
        f.ctrl.copy(f.from).lerp(f.to, 0.5);
        f.ctrl.y = Math.max(f.from.y, f.to.y) + 0.055; // lift over the rim, not through it
      }
    }
  }

  // ---------------------------------------------------------------- signals
  private fireBite(index: number): void {
    this.hooked = index + 1;
    this.rig.addFish();
    const pan = this.panOf(WORLD.rodTip);
    if (index === 0) {
      // one short, sharp tick
      this.tipOsc.kick(1.9, 72, 0.2);
      this.audio.bite(pan, 1);
    } else if (index === 1) {
      // slower, heavier, doubled — a different kind of movement
      this.tipOsc.kick(1.35, 34, 0.1);
      this.pendingKicks.push({ at: this.time + 0.26, v: 0.75, omega: 30, zeta: 0.1 });
      this.audio.bite(pan, 0.75);
    } else {
      // barely a tick: the tip simply loads a little more
      this.tipOsc.kick(0.5, 22, 0.22);
      this.audio.bite(pan, 0.5);
    }
    this.bendTarget = 0.12 + this.hooked * 0.17;
    if (this.phase === 'wait') {
      this.director.setShot('tip');
      this.shotTimer = index === 0 ? 2.4 : 1.8;
    }
    if (index === 0 && this.round === 1 && this.hintEl && !this.hintUsed) {
      this.hintEl.classList.add('hint--on');
    }
  }

  private panOf(p: THREE.Vector3): number {
    const v = p.clone().project(this.director.camera);
    return Math.max(-1, Math.min(1, v.x)) * 0.75;
  }

  // ---------------------------------------------------------------- loop
  private resize(): void {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.padHeight = Math.round(Math.min(168, Math.max(84, h * 0.155)));
    const mainH = h - this.padHeight;
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.director.resize(w, mainH);
    this.pad.resize(w / this.padHeight);
    const dpr = this.renderer.getPixelRatio();
    this.rig.setLineResolution(w * dpr, mainH * dpr, dpr);
    if (this.hintEl) this.hintEl.style.bottom = `${this.padHeight * 0.5 - 26}px`;
  }

  start(): void {
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const raw = (now - this.lastFrame) / 1000;
      this.lastFrame = now;
      const frame = Math.min(0.1, raw);
      this.adaptive.update(frame);
      // physics runs on its own fixed step, rendering on the display rate
      this.accumulator += frame;
      const FIXED = 1 / 100;
      let steps = 0;
      // frame is clamped to 0.1 s, so 12 steps always drains the accumulator and
      // the simulation clock can never fall behind the wall clock
      while (this.accumulator >= FIXED && steps < 12) {
        this.step(FIXED);
        this.accumulator -= FIXED;
        steps++;
      }
      this.render(frame);
    };
    requestAnimationFrame(loop);
  }

  private step(dt: number): void {
    this.time += dt;
    this.phaseT += dt;

    switch (this.phase) {
      case 'title':
        break;
      case 'deploy':
        this.stepDeploy(dt);
        break;
      case 'wait':
        this.stepWait(dt);
        break;
      case 'wind':
        this.stepWind(dt);
        break;
      case 'mobile':
        this.stepMobile(dt);
        break;
      case 'unhook':
        this.stepUnhook(dt);
        break;
      case 'tank':
        this.stepTank(dt);
        break;
    }

    // rod tip: static load plus whatever is moving down there
    for (let i = this.pendingKicks.length - 1; i >= 0; i--) {
      const k = this.pendingKicks[i];
      if (this.time >= k.at) {
        this.tipOsc.kick(k.v, k.omega, k.zeta);
        this.pendingKicks.splice(i, 1);
      }
    }
    this.tipOsc.step(dt);
    const live = this.hooked > 0 && (this.phase === 'wait' || this.phase === 'wind');
    if (live) {
      this.tipNoise +=
        (Math.random() - 0.5) * dt * 26 * this.hooked - this.tipNoise * dt * 9;
    } else {
      this.tipNoise -= this.tipNoise * dt * 6;
    }
    this.bend = THREE.MathUtils.damp(
      this.bend,
      this.bendTarget + this.rig.motor * 0.22,
      2.6,
      dt,
    );
    this.build.rod.bend = this.bend;
    this.build.rod.vib =
      this.tipOsc.value * 0.012 + this.tipNoise * 0.0016 * (this.phase === 'wind' ? 1.5 : 1);
    this.build.rod.update();
    this.rig.tipOffset.copy(this.build.rod.tip).sub(WORLD.rodTip);

    const allowWind = this.phase === 'wind';
    this.rig.pressing = this.pressing;
    this.rig.update(dt, this.time, allowWind, {
      onRipple: (x, z, s) => this.water.ripple(x, z, s, this.time),
      onFishSurface: () => this.audio.surfaceBreak(this.panOf(new THREE.Vector3(0, 0, 0))),
      onSinkerSurface: () => this.audio.drip(0, 0.5),
    });
    this.build.reel.setSpool(this.rig.spoolAngle);

    for (const f of this.freeFish) this.stepFreeFish(f, dt);
    this.freeFish = this.freeFish.filter((f) => {
      if (f.mode === 'leave' && f.t >= 1) {
        this.build.scene.remove(f.meshes.group);
        this.rig.disposeFish(f.meshes);
        return false;
      }
      return true;
    });
    if (this.phase === 'tank' && this.freeFish.length === 0) this.startRound();
  }

  private stepDeploy(dt: number): void {
    const speed = 1.5;
    this.rig.lineOut = Math.min(WORLD.lineOutDeployed, this.rig.lineOut + speed * dt);
    if (this.phaseT > 1.5 && !this.movedToMid) {
      this.movedToMid = true;
      this.director.setShot('mid');
    }
    if (this.rig.lineOut >= WORLD.lineOutDeployed - 1e-4 && this.phaseT > 2.6) {
      this.phase = 'wait';
      this.phaseT = 0;
      this.waitT = 0;
    }
  }

  private stepWait(dt: number): void {
    this.waitT += dt;
    while (
      this.nextBite < this.biteTimes.length &&
      this.waitT >= this.biteTimes[this.nextBite]
    ) {
      const i = this.nextBite++;
      if (Math.random() <= this.biteRolls[i]) {
        this.fireBite(i);
      } else {
        // the rest of the shoal simply moved on; nothing is lost
        this.nextBite = this.biteTimes.length;
      }
    }
    if (this.shotTimer > 0) {
      this.shotTimer -= dt;
      if (this.shotTimer <= 0) this.director.setShot('mid');
    }
  }

  private stepWind(_dt: number): void {
    if (this.rig.fullyIn && this.rig.motor < 0.02) {
      this.phase = 'mobile';
      this.phaseT = 0;
    }
  }

  private stepMobile(_dt: number): void {
    this.bendTarget = 0.1 + this.rig.fishCount * 0.14;
  }

  private stepUnhook(dt: number): void {
    this.unhookTimer -= dt;
    if (this.unhookTimer <= 0 && this.unhookIndex < this.unhookTotal) {
      const slot = this.unhookIndex;
      const m = this.rig.detach(slot);
      this.unhookIndex++;
      this.unhookTimer = 0.85;
      if (m) {
        const from = m.group.position.clone();
        const tank = this.build.tank;
        const to = tank.group.localToWorld(tank.centre.clone());
        to.x += (Math.random() - 0.5) * 0.06;
        to.z += (Math.random() - 0.5) * 0.05;
        this.freeFish.push({
          meshes: m,
          mode: 'arc',
          t: 0,
          from,
          ctrl: new THREE.Vector3(
            (from.x + to.x) * 0.5,
            Math.max(from.y, to.y) + 0.16,
            (from.z + to.z) * 0.5,
          ),
          to,
          phase: Math.random() * 6.28,
          speed: 0.85 + Math.random() * 0.45,
          radius: 0.78 + Math.random() * 0.2,
          depth: (this.unhookIndex - 1) * 0.026,
        });
        this.bendTarget = 0.1 + this.rig.fishCount * 0.14;
      }
    }
    if (this.unhookIndex >= this.unhookTotal && this.rig.fishCount === 0) {
      this.phase = 'tank';
      this.phaseT = 0;
      this.director.setShot('tank');
    }
  }

  private stepTank(_dt: number): void {
    if (this.phaseT > 6.5) this.leaveTank();
  }

  private stepFreeFish(f: FreeFish, dt: number): void {
    const g = f.meshes.group;
    if (f.mode === 'arc') {
      f.t = Math.min(1, f.t + dt * 1.15);
      const t = f.t;
      const a = 1 - t;
      g.position.set(
        a * a * f.from.x + 2 * a * t * f.ctrl.x + t * t * f.to.x,
        a * a * f.from.y + 2 * a * t * f.ctrl.y + t * t * f.to.y,
        a * a * f.from.z + 2 * a * t * f.ctrl.z + t * t * f.to.z,
      );
      // turn from hanging head-up into swimming level as it goes over
      f.meshes.tilt.rotation.z = -Math.PI / 2 + (Math.PI / 2) * THREE.MathUtils.smoothstep(t, 0.25, 0.95);
      g.rotation.set(0, Math.PI * 0.5 + t * 0.4, Math.sin(t * 3) * 0.12);
      if (f.t >= 1) {
        f.mode = 'swim';
        f.t = 0;
        this.audio.tankSplash(this.panOf(g.position));
        if (this.tankReleased) this.leaveTank();
      }
    } else if (f.mode === 'swim') {
      f.t += dt;
      const tank = this.build.tank;
      const ang = f.phase + f.t * f.speed;
      // the lap is described in the tank's own frame, so it stays inside the glass
      const local = (a: number) =>
        new THREE.Vector3(
          tank.centre.x + Math.cos(a) * tank.swim.x * f.radius,
          tank.centre.y + f.depth - 0.012 + Math.sin(f.t * 1.7 + f.phase) * 0.008,
          tank.centre.z + Math.sin(a) * tank.swim.y * f.radius,
        );
      const here = tank.group.localToWorld(local(ang));
      const next = tank.group.localToWorld(local(ang + 0.05));
      g.position.copy(here);
      const heading = Math.atan2(next.x - here.x, next.z - here.z);
      f.meshes.tilt.rotation.z = 0;
      g.rotation.set(0, heading + Math.sin(f.t * 8 + f.phase) * 0.08, Math.sin(f.t * 4) * 0.05);
    } else {
      f.t = Math.min(1, f.t + dt * 0.75);
      const t = f.t;
      const a = 1 - t;
      g.position.set(
        a * a * f.from.x + 2 * a * t * f.ctrl.x + t * t * f.to.x,
        a * a * f.from.y + 2 * a * t * f.ctrl.y + t * t * f.to.y - t * t * 0.28,
        a * a * f.from.z + 2 * a * t * f.ctrl.z + t * t * f.to.z,
      );
      f.meshes.tilt.rotation.z = -0.5 * t;
      g.rotation.y += dt * 0.6;
    }
    g.updateMatrixWorld();
  }

  // ---------------------------------------------------------------- render
  private render(frame: number): void {
    if (this.phase === 'wind' || this.phase === 'mobile' || this.phase === 'unhook') {
      this.director.reveal(this.rig.topFishY, frame);
    }
    this.director.update(frame, this.rig.topFishY, this.rig.sinkerY);
    this.water.update(this.time);
    this.pad.update(frame, this.pressing);
    this.audio.setMotor(this.rig.motor, this.panOf(WORLD.reelPos));

    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    const mainH = h - this.padHeight;
    const r = this.renderer;
    r.setScissorTest(true);
    r.setViewport(0, this.padHeight, w, mainH);
    r.setScissor(0, this.padHeight, w, mainH);
    r.render(this.build.scene, this.director.camera);
    r.setViewport(0, 0, w, this.padHeight);
    r.setScissor(0, 0, w, this.padHeight);
    r.render(this.pad.scene, this.pad.camera);
    r.setScissorTest(false);
  }

  /** Exposed for the browser check pass only. */
  debugState(): Record<string, number | string> {
    return {
      phase: this.phase,
      round: this.round,
      hooked: this.hooked,
      fish: this.rig.fishCount,
      lineOut: Number(this.rig.lineOut.toFixed(3)),
      motor: Number(this.rig.motor.toFixed(2)),
      topFishY: Number(this.rig.topFishY.toFixed(3)),
      tier: this.quality.tier,
      bitesDone: this.nextBite >= this.biteTimes.length ? 1 : 0,
    };
  }

  forcePress(v: boolean): void {
    this.pressing = v;
    if (v) this.onSwitchDown();
  }
  forceTap(): void {
    this.onTap();
  }
}
