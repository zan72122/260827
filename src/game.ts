import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clamp, damp, lerp, smoothstep } from './util';
import { AudioSys } from './audio';
import { ParticleSystem } from './particles';
import { WetMask } from './wetmask';
import { FireSpot, FireSpotConfig } from './fire';
import { WaterStream } from './stream';
import { HoseRig } from './hose';
import { buildWorld, WorldRefs } from './world';
import { Crew } from './crew';
import { AimInput } from './input';

type Mode = 'title' | 'intro' | 'play' | 'calm';

const CREW_POS = new THREE.Vector3(-0.2, 0, 0.4);

const FIRE_LAYOUT: FireSpotConfig[] = [
  { kind: 'pan', x: -2.7, z: 9.2, radius: 0.55, seed: 11 },
  { kind: 'brick', x: 0.2, z: 11.8, radius: 0.6, seed: 22 },
  { kind: 'crib', x: 2.9, z: 9.6, radius: 0.62, seed: 33 },
];

interface CameraPose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private time = 0;

  private audio = new AudioSys();
  private particles = new ParticleSystem();
  private wet: WetMask;
  private fires: FireSpot[] = [];
  private stream = new WaterStream();
  private hose: HoseRig;
  private world: WorldRefs;
  private crew = new Crew();
  private input: AimInput;

  private mode: Mode = 'title';
  private introT = 0;
  private calmT = 0;
  private idleT = 0;
  private hintT = -1;
  private hintTarget = new THREE.Vector3();
  private wasOpen = false;
  private prevClank = false;

  // camera control
  private playPose: CameraPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 55 };
  private curPose: CameraPose = { pos: new THREE.Vector3(0, 2, -3), look: new THREE.Vector3(0, 1, 10), fov: 55 };
  private pullBack = 0; // 0 while spraying, eases toward 1 when idle/calm

  // per-frame derived state
  private impact = new THREE.Vector3(0, 0, 10);
  private nozzleTip = new THREE.Vector3();
  private nozzleButt = new THREE.Vector3();
  private aimDir = new THREE.Vector3(0, 0, 1);
  private heatHit = 0;
  private impactTrace: { x: number; y: number; z: number; t: number }[] = [];

  // perf
  private fpsEma = 60;
  private slowTime = 0;
  private pixelRatio: number;
  /** dt clamp; test harnesses may widen it on slow software renderers */
  private maxStepDt = 0.05;
  private prevImpact = new THREE.Vector3();
  private hadImpact = false;

  private replayBtn: HTMLElement;
  private startOverlay: HTMLElement;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);

    // image-based ambience for believable metal/wet-sheen response
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.wet = new WetMask();
    const seenMats: THREE.MeshStandardMaterial[] = [];
    this.world = buildWorld(this.scene, this.wet, FIRE_LAYOUT.map((f) => ({ x: f.x, z: f.z })));
    for (const cfg of FIRE_LAYOUT) {
      const spot = new FireSpot(cfg, this.wet, seenMats);
      this.fires.push(spot);
      this.scene.add(spot.group);
    }
    this.crew.group.position.copy(CREW_POS);
    this.scene.add(this.crew.group);
    this.crew.group.updateWorldMatrix(true, true);
    this.crew.aim(new THREE.Vector3(0, -0.45, 1).normalize(), 10); // rest pose
    this.scene.add(this.stream.mesh);
    this.scene.add(this.particles.points);
    this.hose = new HoseRig(this.world.pumpOutlet, this.world.hydrantTop, this.world.pumpInlet, CREW_POS);
    this.scene.add(this.hose.group);

    this.input = new AimInput(canvas, this.camera);
    this.input.onPress = () => {
      this.audio.init();
      this.audio.resume();
      if (this.mode === 'intro') this.skipIntro();
    };

    this.replayBtn = document.getElementById('replay-btn')!;
    this.startOverlay = document.getElementById('start-overlay')!;
    document.getElementById('start-btn')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.audio.init();
      this.startIntro();
    });
    this.replayBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.reset();
    });

    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 60));

    this.installDebugApi();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------------- camera

  private onResize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    if (aspect < 1) {
      // portrait: taller framing, depth from the nozzle to far targets;
      // the operator reads at the lower left, never covering the fires
      this.playPose.fov = 66;
      this.playPose.pos.set(0.68, 2.5, -2.4);
      this.playPose.look.set(0.05, 0.55, 10.5);
    } else {
      // landscape: wide framing for sweeping across several fires
      this.playPose.fov = 52;
      this.playPose.pos.set(0.85, 2.15, -2.85);
      this.playPose.look.set(0.1, 0.7, 10);
    }
    this.camera.updateProjectionMatrix();
    this.particles.setViewport(h, this.playPose.fov);
    if (this.mode === 'play' || this.mode === 'calm') this.applyPlayCamera(true);
  }

  /** camera during play: FIXED while a finger is down; slight pull-back allowed after release */
  private applyPlayCamera(force = false): void {
    if (this.input.active && !force) return; // never move the camera mid-swipe
    const pull = this.pullBack;
    this.curPose.fov = this.playPose.fov + pull * 2.5;
    this.curPose.pos.copy(this.playPose.pos);
    this.curPose.pos.z -= pull * 0.9;
    this.curPose.pos.y += pull * 0.35;
    this.curPose.look.copy(this.playPose.look);
    this.setCamera(this.curPose);
  }

  private setCamera(p: CameraPose): void {
    this.camera.position.copy(p.pos);
    this.camera.fov = p.fov;
    this.camera.lookAt(p.look);
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- modes

  private startIntro(): void {
    this.startOverlay.classList.add('hidden');
    this.mode = 'intro';
    this.introT = 0;
  }

  skipIntro(): void {
    if (this.mode !== 'intro') return;
    this.hose.setDeploy(1);
    this.hose.setPressure(1);
    this.audio.pumpStart();
    this.enterPlay();
  }

  private enterPlay(): void {
    this.mode = 'play';
    this.idleT = 0;
    this.pullBack = 0;
    this.applyPlayCamera(true);
  }

  reset(): void {
    for (const f of this.fires) f.reset();
    this.wet.reset();
    this.particles.clear();
    this.impactTrace.length = 0;
    this.calmT = 0;
    this.replayBtn.classList.remove('visible');
    if (this.mode !== 'title' && this.mode !== 'intro') this.enterPlay();
  }

  // ---------------------------------------------------------------- intro timeline

  private updateIntro(dt: number): void {
    this.introT += dt;
    const t = this.introT;
    const w = this.world;

    // hose pays out from the truck toward the crew
    if (t < 2.7) {
      this.hose.setDeploy(Math.min(0.96, t / 2.3));
    } else {
      if (!this.prevClank) {
        this.prevClank = true;
        this.hose.setDeploy(1); // coupling snaps onto the discharge outlet
        this.audio.clank();
      }
    }
    // valve opens, pump comes up
    if (t >= 3.1 && t < 4.1) {
      this.world.valveWheel.rotation.x += dt * 5;
      if (t - dt < 3.1) this.audio.pumpStart();
    }
    // hose pressurizes
    if (t >= 4.2) {
      if (t - dt < 4.2) this.audio.hoseTension();
      this.hose.setPressure(clamp((t - 4.2) / 1.0, 0, 1));
    }
    // nozzle raise: down → level
    const raise = smoothstep(5.4, 6.6, t);
    this.aimDir.set(0, lerp(-0.55, 0.02, raise), 1).normalize();
    this.crew.aim(this.aimDir, dt);

    // camera shots: wide truck → coupling close-up → hose medium → over-shoulder
    const pose = this.curPose;
    const out = w.pumpOutlet;
    const hoseMid = new THREE.Vector3().lerpVectors(out, CREW_POS, 0.55).setY(0.2);
    if (t < 2.4) {
      // 3/4 view of the pumper while the hose pays out
      pose.fov = 46;
      pose.pos.set(0.6, 2.6, -2.2);
      pose.look.copy(w.truckFocus);
    } else if (t < 4.2) {
      // close-up from the side the couplings face
      pose.fov = 38;
      pose.pos.copy(out)
        .addScaledVector(w.panelNormal, 2.3)
        .add(new THREE.Vector3(0.7, 0.5, -0.5));
      pose.look.set(out.x, out.y - 0.1, out.z);
    } else if (t < 5.6) {
      pose.fov = 46;
      pose.pos.set(2.6, 2.0, -1.9);
      pose.look.copy(hoseMid);
    } else {
      const k = smoothstep(5.6, 7.1, t);
      pose.fov = lerp(46, this.playPose.fov, k);
      pose.pos.lerpVectors(new THREE.Vector3(2.6, 2.0, -1.9), this.playPose.pos, k);
      pose.look.lerpVectors(hoseMid, this.playPose.look, k);
    }
    this.setCamera(pose);

    if (t >= 7.2) this.enterPlay();
  }

  // ---------------------------------------------------------------- main frame

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), this.maxStepDt);
    this.time += dt;
    this.fpsEma = lerp(this.fpsEma, dt > 0 ? 1 / dt : 60, 0.05);
    this.adaptQuality(dt);

    if (this.mode === 'title') {
      // gentle establishing view behind the start button
      this.curPose.fov = 50;
      this.curPose.pos.set(3.8, 2.4, -4.2);
      this.curPose.look.set(-0.5, 1, 6);
      this.setCamera(this.curPose);
    } else if (this.mode === 'intro') {
      this.updateIntro(dt);
    } else {
      this.updatePlay(dt);
    }

    // things that always tick
    this.input.update(dt);
    for (const f of this.fires) {
      f.update(dt, this.time, this.camera, this.particles, () => this.audio.drip());
    }
    this.hose.update(this.time);
    this.crew.update(dt);
    this.particles.update(dt);

    const fireTotal = this.fires.reduce((s, f) => s + f.intensity, 0);
    this.audio.update(dt, {
      spray: this.stream.openAmount,
      heatHit: this.heatHit * this.stream.openAmount,
      fireTotal,
    });

    this.wet.flush(this.renderer);
    this.renderer.render(this.scene, this.camera);
  }

  private updatePlay(dt: number): void {
    const open = this.input.active;

    if (open && !this.wasOpen) this.audio.nozzleOpen();
    if (!open && this.wasOpen) this.audio.nozzleClose();
    this.wasOpen = open;

    // --- resolve the impact point from the player's (smoothed) trace
    this.impact.copy(this.input.smoothTarget);
    let surfaceY = 0.02;
    let hitSpot: FireSpot | null = null;
    for (const f of this.fires) {
      const d = Math.hypot(this.impact.x - f.position.x, this.impact.z - f.position.z);
      if (d < f.cfg.radius + 0.45) {
        surfaceY = f.surfaceY;
        hitSpot = f;
        break;
      }
    }
    this.impact.y = surfaceY;

    // --- water effects while the nozzle is open
    this.heatHit = 0;
    const flow = this.stream.openAmount;
    if (flow > 0.25) {
      // apply wetting/dousing along the segment the impact point traveled
      // this frame, so a fast sweep (or a dropped frame) still soaks the
      // whole path instead of stamping isolated dots
      if (!this.hadImpact) this.prevImpact.copy(this.impact);
      const segLen = this.prevImpact.distanceTo(this.impact);
      const n = clamp(Math.ceil(segLen / 0.3), 1, 10);
      const sub = new THREE.Vector3();
      for (let i = 1; i <= n; i++) {
        sub.lerpVectors(this.prevImpact, this.impact, i / n);
        const w = (dt * flow) / n;
        // wetting accumulates with dwell time: slow sweeps soak, fast passes damp
        this.wet.splat(sub.x, sub.z, 0.55, 1.5 * w);
        // fire weakens only around the actual impact path
        for (const f of this.fires) {
          this.heatHit = Math.max(this.heatHit, f.douse(sub, w));
        }
      }
      this.hadImpact = true;
      this.prevImpact.copy(this.impact);
      this.impactTrace.push({ x: this.impact.x, y: this.impact.y, z: this.impact.z, t: this.time });
      if (this.impactTrace.length > 240) this.impactTrace.splice(0, this.impactTrace.length - 240);
    } else {
      this.hadImpact = false;
    }

    // --- stream + crew aim
    this.crew.getNozzleTip(this.nozzleTip);
    const tangent = this.stream.update(dt, this.time, open, this.nozzleTip, this.impact, this.heatHit, this.particles);
    if (open || this.stream.openAmount > 0.02) {
      this.crew.aim(tangent, dt);
    } else if (this.hintT < 0) {
      // rest: nozzle held low, ready
      this.crew.aim(this.aimDir.set(0, -0.35, 1).normalize(), dt * 0.5);
    }
    this.crew.getNozzleButt(this.nozzleButt);
    this.hose.setNozzleAnchor(this.nozzleButt);

    // head cue: watch the strongest remaining fire (or the impact while spraying)
    const strongest = this.fires.reduce((a, b) => (a.intensity >= b.intensity ? a : b));
    this.crew.setLookTarget(open ? this.impact : strongest.position.clone().setY(0.8));

    // --- wordless guidance: after a few idle seconds the operator nudges
    //     the nozzle toward the nearest burning fire
    const anyFire = strongest.intensity > 0.03;
    if (!open && anyFire && this.mode === 'play') {
      this.idleT += dt;
      if (this.idleT > 6 && this.hintT < 0) this.beginHint(strongest);
    } else {
      this.idleT = 0;
    }
    if (this.hintT >= 0) {
      this.hintT += dt;
      const k = Math.sin(clamp(this.hintT / 1.3, 0, 1) * Math.PI);
      this.hintTarget.copy(strongest.position).setY(strongest.surfaceY);
      const dir = this.hintTarget.sub(this.nozzleTip).normalize();
      dir.y = lerp(0.0, dir.y + 0.12, k);
      if (!open) this.crew.aim(dir, dt);
      if (this.hintT > 1.4) { this.hintT = -1; this.idleT = 0; }
    }

    // --- extinguished? settle into the calm shot
    if (this.mode === 'play' && !anyFire) {
      this.mode = 'calm';
      this.calmT = 0;
    }
    if (this.mode === 'calm') {
      this.calmT += dt;
      if (this.calmT > 3.2) this.replayBtn.classList.add('visible');
      if (anyFire) this.mode = 'play'; // (reset re-lights)
    }

    // camera: locked while touching; eases back a touch once the water stops
    const wantPull = open ? this.pullBack : (this.mode === 'calm' ? 1 : clamp((this.idleT - 1.5) * 0.5, 0, 0.4));
    if (!this.input.active) {
      this.pullBack = damp(this.pullBack, wantPull, 1.6, dt);
    }
    this.applyPlayCamera();
  }

  private beginHint(spot: FireSpot): void {
    this.hintT = 0;
    this.hintTarget.copy(spot.position);
  }

  // ---------------------------------------------------------------- perf

  private adaptQuality(dt: number): void {
    if (dt > 0.034) this.slowTime += dt; else this.slowTime = Math.max(0, this.slowTime - dt * 0.5);
    if (this.slowTime > 2.5 && this.pixelRatio > 1) {
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.onResize();
      this.slowTime = 0;
    }
  }

  // ---------------------------------------------------------------- debug/test API

  private installDebugApi(): void {
    const self = this;
    const v = new THREE.Vector3();
    (window as unknown as Record<string, unknown>).__ffgame = {
      get mode() { return self.mode; },
      get fires() { return self.fires.map((f) => f.intensity); },
      get openAmount() { return self.stream.openAmount; },
      get impact() { return { x: self.impact.x, y: self.impact.y, z: self.impact.z, active: self.input.active }; },
      get targetSpeed() { return self.input.targetSpeed; },
      get fps() { return self.fpsEma; },
      get camQuat() { return self.camera.quaternion.toArray(); },
      get pixelRatio() { return self.pixelRatio; },
      impactTrace() { return self.impactTrace.slice(); },
      wetAt(x: number, z: number) { return self.wet.sample(x, z); },
      wetTotal() { return self.wet.totalWetness(); },
      reset() { self.reset(); },
      skipIntro() { self.skipIntro(); },
      /** widen the dt clamp so game time tracks wall time on slow renderers (tests only) */
      setTimeScale(k: number) { self.maxStepDt = 0.05 * Math.max(1, k); },
      firePos(i: number) {
        const f = self.fires[i];
        return { x: f.position.x, y: f.surfaceY, z: f.position.z };
      },
      /** plain css-pixel projection of a world point (no finger offset) */
      screenPointForWorld(x: number, y: number, z: number) {
        v.set(x, y, z).project(self.camera);
        return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
      },
      /** css-pixel point where a finger should press so the water lands on world (x,y,z) */
      fingerPointForWorld(x: number, y: number, z: number) {
        v.set(x, y, z).project(self.camera);
        const w = window.innerWidth, h = window.innerHeight;
        return {
          x: ((v.x + 1) / 2) * w,
          y: ((1 - v.y) / 2) * h + h * 0.13,
        };
      },
      fingerPointForSpot(i: number) {
        const f = self.fires[i];
        v.set(f.position.x, 0, f.position.z).project(self.camera);
        const w = window.innerWidth, h = window.innerHeight;
        return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h + h * 0.13 };
      },
    };
  }
}
