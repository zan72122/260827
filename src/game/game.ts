import * as THREE from 'three';
import { Stage, type Orientation } from '../core/stage';
import { Input } from '../core/input';
import { AudioEngine } from '../audio/audio';
import { buildEnvironment } from '../gfx/environment';
import { makeSheetMetal } from '../gfx/textures';
import { Workshop } from '../world/workshop';
import { Fixture, DIE_FACE_Y, LEVER_KNOB_Y } from '../world/fixture';
import { Bell } from '../world/bell';
import { Pellet, Brush, Rope } from '../world/props';
import { Director, type ShotName } from './director';
import { Overlay, type ReplayChoice } from '../ui/overlay';
import { clamp, damp, lerp, smoothstep, easeOutCubic } from '../core/util';

export type Phase =
  | 'intro' | 'press' | 'pellet' | 'petals' | 'clinch'
  | 'polish' | 'cord' | 'lift' | 'shake';

const SIZES = [0.115, 0.088, 0.145];
const HINT_DELAY = 3.6;

export class Game {
  private stage: Stage;
  private input: Input;
  private audio = new AudioEngine();
  private director: Director;
  private overlay = new Overlay();
  private env: THREE.Texture;
  private metal = makeSheetMetal(768);
  private workshop: Workshop;
  private fixture!: Fixture;
  private bell!: Bell;
  private pellet!: Pellet;
  private brush!: Brush;
  private cord!: Rope;
  private cordEnd = new THREE.Vector3();
  private work = new THREE.Group();

  phase: Phase = 'intro';
  private phaseTime = 0;
  private idle = 0;
  private hintPulse = 0;
  private locked = false;
  private sizeIndex = 0;
  private menuTimer = 0;
  private lastOrientation: Orientation;

  // per-phase working state
  private leverGrabbed = false;
  private leverGrabY = 0;
  private leverGrabP = 0;
  private leverProgress = 0;
  private pressDone = 0;
  private motorOn = false;
  private pelletHeld = false;
  private pelletSettle = 0;
  private grabbedPetal = -1;
  private hintPetal = -1;
  private petalGrabProgress = 0;
  private petalAnim: { i: number; from: number; t: number }[] = [];
  private clinchProgress = 0;
  private polishStrokes = 0;
  private polishActive = false;
  private polishTravel = 0;
  private polishSpeed = 0;
  private cordHeld = false;
  private cordThread = 0;
  private liftAmount = 0;
  private handX = 0;
  private handTargetX = 0;
  private prevHandX = 0;
  private swingAngle = 0;
  private swingVel = 0;
  private shakeReady = false;
  private rang = false;
  private ringTime = 0;
  private lastRingAt = -10;
  private lastTickAt = -10;
  private bellHome = new THREE.Vector3();
  private timers: { t: number; fn: () => void }[] = [];
  private cine: { t: number; dur: number; step: (k: number) => void; done: () => void } | null = null;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private plane = new THREE.Plane();
  private probeCam = new THREE.PerspectiveCamera();

  constructor(container: HTMLElement) {
    this.stage = new Stage(container);
    this.input = new Input(this.stage);
    this.director = new Director(this.stage);
    this.env = buildEnvironment(this.stage.renderer);
    this.stage.scene.environment = this.env;
    this.workshop = new Workshop(this.env);
    this.stage.scene.add(this.workshop.root);
    this.stage.scene.add(this.work);

    this.stage.onTierChange = (t) => this.workshop.setTier(t);
    this.input.onFirstGesture = () => this.audio.unlock();
    this.input.onDown = () => this.onDown();
    this.input.onUp = () => this.onUp();
    this.overlay.onMute = (m) => this.audio.setMuted(m);
    this.overlay.onChoice = (c) => this.onChoice(c);

    this.lastOrientation = this.stage.orientation;
    this.buildRun(SIZES[0]);
    this.applyLayout();

    // read-only state for automated play-throughs; never drawn on screen
    (window as any).__forge = {
      get state() {
        const g = (window as any).__forgeGame as Game;
        return {
          phase: g.phase, lever: g.leverProgress, bowl: g.bell.bowlForm,
          petals: g.bell.petalFold.slice(), closed: g.bell.closedCount,
          clinch: g.clinchProgress, polish: g.polishStrokes, cord: g.cordThread,
          lift: g.liftAmount, rang: g.rang, locked: g.locked,
          muted: g.audio.muted, orientation: g.stage.orientation,
          targets: g.targets(),
          grab: g.grabbedPetal, down: g.input.p.down, ptr: [g.input.p.x, g.input.p.y],
        };
      },
    };
    (window as any).__forgeGame = this;
  }

  // ------------------------------------------------------------------ setup

  private buildRun(radius: number) {
    this.work.clear();
    this.bell?.dispose();

    this.bell = new Bell({ radius, metal: this.metal, env: this.env });
    this.bell.root.position.set(0, DIE_FACE_Y + radius * 0.023, 0);
    this.bellHome.copy(this.bell.root.position);
    this.bell.sync();
    this.work.add(this.bell.root);

    this.fixture = new Fixture(this.env, radius, this.bell.thickness);
    this.work.add(this.fixture.root);

    this.pellet = new Pellet(this.env, radius * 0.27);
    this.pellet.restY = DIE_FACE_Y;
    this.pellet.mesh.visible = false;
    this.pellet.onImpact = (v, kind) => this.onPelletImpact(v, kind);
    this.work.add(this.pellet.mesh);

    this.brush = new Brush(this.env, radius * 0.4);
    this.work.add(this.brush.root);

    this.cord = new Rope(this.env, 26, radius * 0.055);
    this.cord.mesh.visible = false;
    this.work.add(this.cord.mesh);

    this.audio.tuneBell(radius);
    this.audio.setAmbience(1);
    this.resetState();
  }

  private resetState() {
    this.phase = 'intro';
    this.phaseTime = 0;
    this.idle = 0;
    this.locked = false;
    this.leverGrabbed = false;
    this.leverProgress = 0;
    this.pressDone = 0;
    this.pelletHeld = false;
    this.pelletSettle = 0;
    this.grabbedPetal = -1;
    this.hintPetal = -1;
    this.petalAnim.length = 0;
    this.timers.length = 0;
    this.cine = null;
    this.clinchProgress = 0;
    this.polishStrokes = 0;
    this.polishTravel = 0;
    this.polishActive = false;
    this.cordHeld = false;
    this.cordThread = 0;
    this.liftAmount = 0;
    this.swingAngle = 0;
    this.swingVel = 0;
    this.handX = this.handTargetX = this.prevHandX = 0;
    this.rang = false;
    this.shakeReady = false;
    this.ringTime = 0;
    this.bell.clinch = 0;
    this.bell.crown.visible = false;
    this.bell.resetPolish();
    this.bell.root.position.copy(this.bellHome);
    this.bell.root.rotation.set(0, 0, 0);
    this.pellet.container = null;
    this.pellet.held = false;
    this.pellet.mesh.visible = false;
    this.brush.root.visible = false;
    this.cord.mesh.visible = false;
    this.fixture.lever.setProgress(0);
    this.fixture.clinchLever.setProgress(0);
    this.fixture.clinchLever.root.visible = false;
    this.fixture.lever.root.visible = true;
    this.fixture.setColletProgress(0);
    this.fixture.setRamProgress(0, 0);
    window.clearTimeout(this.menuTimer);
    this.overlay.showChoices(false);
    this.director.cut('intro', 0.01);
    this.director.setFollow(null);
    this.applyLayout();
  }

  private applyLayout() {
    this.fixture.layout(this.stage.orientation);
  }

  // ------------------------------------------------------------------ input

  private onDown() {
    this.idle = 0;
    this.audio.unlock();
    if (this.locked) return;
    const p = this.input.p;
    switch (this.phase) {
      case 'intro':
      case 'press': {
        // one verb in this scene, so the whole screen is the lever; only
        // downward movement actually drives it, a stray tap does nothing
        this.leverGrabbed = true;
        this.leverGrabY = p.y;
        this.leverGrabP = this.leverProgress;
        if (this.phase === 'intro') this.enter('press');
        break;
      }
      case 'pellet': {
        if (this.input.screenDistance(this.pellet.pos) < 240) {
          this.pelletHeld = true;
          this.pellet.held = true;
        }
        break;
      }
      case 'petals': {
        let best = -1, bestD = 140;
        for (let i = 0; i < this.bell.petalCount; i++) {
          if (this.bell.petalFold[i] > 0.99) continue;
          if (this.petalAnim.some((a) => a.i === i)) continue;
          const d = this.input.screenDistance(this.bell.petalWorld(i, this.tmp));
          if (d < bestD) { bestD = d; best = i; }
        }
        if (best >= 0) {
          this.grabbedPetal = best;
          this.petalGrabProgress = this.bell.petalFold[best];
        }
        break;
      }
      case 'clinch': {
        this.leverGrabbed = true;
        this.leverGrabY = p.y;
        this.leverGrabP = this.clinchProgress;
        break;
      }
      case 'polish': {
        this.polishActive = true;
        break;
      }
      case 'cord': {
        if (this.input.screenDistance(this.cordEnd) < 190) this.cordHeld = true;
        break;
      }
      case 'lift':
        break;
      case 'shake':
        this.shakeReady = true;
        break;
    }
  }

  private onUp() {
    this.idle = 0;
    switch (this.phase) {
      case 'press':
        this.leverGrabbed = false;
        break;
      case 'pellet':
        if (this.pelletHeld) {
          this.pelletHeld = false;
          this.pellet.held = false;
          this.releasePellet();
        }
        break;
      case 'petals':
        if (this.grabbedPetal >= 0) {
          const i = this.grabbedPetal;
          this.grabbedPetal = -1;
          if (this.bell.petalFold[i] > 0.28) {
            this.petalAnim.push({ i, from: this.bell.petalFold[i], t: 0 });
          } else {
            this.petalAnim.push({ i, from: this.bell.petalFold[i], t: -1 });
          }
        }
        break;
      case 'clinch':
        this.leverGrabbed = false;
        break;
      case 'polish':
        this.polishActive = false;
        this.audio.setSwish(0);
        break;
      case 'cord':
        if (this.cordHeld) {
          this.cordHeld = false;
          const near = this.input.screenDistance(this.bell.loopWorld(this.tmp)) < 200
            || this.cordEnd.distanceTo(this.tmp) < this.bell.R * 1.5;
          if (near) {
            this.cordThread = 0.0001;
            this.audio.cord();
          }
        }
        break;
      default:
        break;
    }
  }

  /** Run `fn` after `sec` of game time. Everything the state machine schedules
   *  goes through here, so a slow frame slows the whole sequence together
   *  instead of letting timers race the animation. */
  private after(sec: number, fn: () => void) { this.timers.push({ t: sec, fn }); }

  /** A short cinematic beat -- tool retracting, jig opening -- on the game clock. */
  private play(dur: number, step: (k: number) => void, done: () => void) {
    this.cine = { t: 0, dur, step, done };
  }

  private runScheduled(dt: number) {
    if (this.cine) {
      this.cine.t += dt;
      const k = clamp(this.cine.t / this.cine.dur, 0, 1);
      this.cine.step(k);
      if (k >= 1) { const d = this.cine.done; this.cine = null; d(); }
    }
    for (let i = this.timers.length - 1; i >= 0; i--) {
      this.timers[i].t -= dt;
      if (this.timers[i].t <= 0) {
        const fn = this.timers[i].fn;
        this.timers.splice(i, 1);
        fn();
      }
    }
  }

  private enter(p: Phase) {
    this.phase = p;
    this.phaseTime = 0;
    this.idle = 0;
  }

  // ----------------------------------------------------------------- frame

  update(dt: number) {
    this.input.update(dt);
    if (this.stage.orientation !== this.lastOrientation) {
      // rotating the device re-stages the tools; nothing about the work is lost
      this.lastOrientation = this.stage.orientation;
      this.applyLayout();
    }
    this.director.reframe();
    this.phaseTime += dt;
    if (!this.input.p.down) this.idle += dt; else this.idle = 0;

    this.positionLevers(dt);
    this.runScheduled(dt);

    switch (this.phase) {
      case 'intro': this.updateIntro(dt); break;
      case 'press': this.updatePress(dt); break;
      case 'pellet': this.updatePellet(dt); break;
      case 'petals': this.updatePetals(dt); break;
      case 'clinch': this.updateClinch(dt); break;
      case 'polish': this.updatePolish(dt); break;
      case 'cord': this.updateCord(dt); break;
      case 'lift': this.updateLift(dt); break;
      case 'shake': this.updateShake(dt); break;
    }

    this.pellet.update(dt);
    this.bell.sync();
    this.director.update(dt);
    this.hintPulse = this.idle > HINT_DELAY ? (this.idle - HINT_DELAY) : -1;
    if (this.hintPulse >= 0) this.tickHintSound();
  }

  /**
   * Solve where the lever has to stand on the bench so its knob lands in the
   * operating zone of THIS screen: low and central in portrait, left of the
   * work in landscape. A few Newton steps against the live projection, so it
   * stays right through camera moves and device rotation.
   */
  /** A throwaway camera matching a named shot, used only for staging props. */
  private shotCamera(name: ShotName): THREE.PerspectiveCamera {
    const c = this.probeCam;
    c.fov = this.director.poseFor(name, _camPos, _camTarget);
    c.aspect = this.stage.camera.aspect;
    c.near = 0.05; c.far = 60;
    c.position.copy(_camPos);
    c.lookAt(_camTarget);
    c.updateMatrixWorld();
    c.updateProjectionMatrix();
    return c;
  }

  private projectWith(cam: THREE.PerspectiveCamera, world: THREE.Vector3, out: THREE.Vector2) {
    _proj.copy(world).project(cam);
    return out.set(
      (_proj.x * 0.5 + 0.5) * this.stage.width,
      (-_proj.y * 0.5 + 0.5) * this.stage.height
    );
  }

  private solveBenchAnchor(
    cam: THREE.PerspectiveCamera,
    ax: number, ay: number, height: number, out: THREE.Vector3,
    minR = 0.40, maxR = 1.05, minCam = 0.44
  ) {
    cam.getWorldDirection(_fwd);
    _rightH.set(-_fwd.z, 0, _fwd.x);
    if (_rightH.lengthSq() < 1e-8) _rightH.set(1, 0, 0); else _rightH.normalize();
    _fwdH.set(_fwd.x, 0, _fwd.z);
    if (_fwdH.lengthSq() < 1e-8) _fwdH.set(0, 0, -1); else _fwdH.normalize();
    const pitch = Math.max(-_fwd.y, 0.22);
    for (let it = 0; it < 9; it++) {
      _probe.set(out.x, height, out.z);
      const s = this.projectWith(cam, _probe, _v2c);
      const ex = ax - s.x, ey = ay - s.y;
      const dist = Math.max(cam.position.distanceTo(_probe), 0.05);
      const px = (2 * Math.tan((cam.fov * Math.PI) / 360) * dist) / this.stage.height;
      const relax = 0.62;
      out.x += relax * (_rightH.x * ex * px - (_fwdH.x * ey * px) / pitch);
      out.z += relax * (_rightH.z * ex * px - (_fwdH.z * ey * px) / pitch);
      const r = Math.hypot(out.x, out.z);
      if (r < minR) { out.x *= minR / (r || 1e-4); out.z *= minR / (r || 1e-4); }
      if (r > maxR) { out.x *= maxR / r; out.z *= maxR / r; }
    }
    // never let a tool end up against the lens, where it would swell to fill
    // the frame and hide the very thing it operates on
    const cx = out.x - cam.position.x, cz = out.z - cam.position.z;
    const cd = Math.hypot(cx, cz);
    if (cd < minCam) {
      const k = minCam / (cd || 1e-4);
      out.x = cam.position.x + cx * k;
      out.z = cam.position.z + cz * k;
    }
  }

  /** True while a loose prop is still settling, or has drifted near the edge of
   *  this screen -- it stays put once it is comfortably in reach. */
  private needsRepositioning(p: THREE.Vector3): boolean {
    if (this.phaseTime < 2.4) return true;
    const s = this.input.toScreen(p, _v2c);
    const m = 74;
    return s.x < m || s.y < m || s.x > this.stage.width - m || s.y > this.stage.height - m;
  }

  private positionLevers(dt: number) {
    const land = this.stage.orientation === 'landscape';
    // landscape puts the control to the left of the work, portrait puts it low
    // and a little off centre so it never stands in front of the bell
    const ax = (land ? 0.16 : 0.32) * this.stage.width;
    const ay = (land ? 0.56 : 0.74) * this.stage.height;
    const useClinch = this.phase === 'clinch';
    const active = useClinch ? this.fixture.clinchLever : this.fixture.lever;
    _leverPos.copy(active.root.position);
    this.solveBenchAnchor(
      this.shotCamera(useClinch ? 'clinch' : 'press'), ax, ay, LEVER_KNOB_Y, _leverPos
    );
    active.standAt(_leverPos.x, _leverPos.z, clamp(dt * 7, 0, 1));
    const idleOne = useClinch ? this.fixture.lever : this.fixture.clinchLever;
    idleOne.standAt(_leverPos.x, _leverPos.z, 1);
  }

  private hintSoundAt = -1;
  private tickHintSound() {
    const beat = Math.floor(this.hintPulse / 2.4);
    // the object keeps moving, but the chime stops after a few tries
    if (beat !== this.hintSoundAt) {
      this.hintSoundAt = beat;
      if (this.hintPulse > 0.15 && beat < 3) this.audio.hint();
    }
  }

  /** small looping nudge used by every idle hint */
  private nudge(period = 2.4, count = 2) {
    if (this.hintPulse < 0) return 0;
    const t = this.hintPulse % period;
    if (t > count * 0.34) return 0;
    return Math.sin((t / 0.34) * Math.PI * count) * (1 - t / (count * 0.34));
  }

  // ------------------------------------------------------------------ steps

  private updateIntro(dt: number) {
    // hold on the blank, then bring the tool into frame by itself
    if (this.phaseTime > 2.4 && this.director.current === 'intro') {
      this.director.cut('press', 1.5);
    }
    const n = this.nudge();
    this.fixture.lever.setProgress(Math.abs(n) * 0.06);
    this.bell.root.rotation.y = Math.sin(this.phaseTime * 0.28) * 0.012 + n * 0.02;
    void dt;
  }

  private updatePress(dt: number) {
    if (this.director.current !== 'press') this.director.cut('press', 1.0);
    this.bell.root.rotation.y = damp(this.bell.root.rotation.y, 0, 6, dt);

    if (this.leverGrabbed) {
      const want = this.leverGrabP + (this.input.p.y - this.leverGrabY) / 150;
      // forming is plastic: the metal never springs back, so the lever only advances
      this.leverProgress = clamp(Math.max(this.leverProgress, want), 0, 1);
    } else if (this.leverProgress > 0.68 && this.leverProgress < 1) {
      this.leverProgress = clamp(this.leverProgress + dt * 1.3, 0, 1);
    }

    const hint = this.nudge() * 0.05;
    this.fixture.lever.setProgress(clamp(this.leverProgress + (this.leverProgress < 0.02 ? hint : 0), 0, 1));

    const approach = clamp(this.leverProgress / 0.16, 0, 1);
    const form = smoothstep(0.16, 1.0, this.leverProgress);
    if (Math.abs(form - this.bell.bowlForm) > 1e-5) {
      this.bell.bowlForm = form;
      this.bell.markBowlDirty();
      if (form > 0.02 && this.pressDone === 0) {
        this.pressDone = 1;
        this.audio.pressStrike(0.7);
        this.director.impulse(0.008);
      }
    }
    const moving = this.leverGrabbed && Math.abs(this.input.p.dy) > 0.6;
    if (moving !== this.motorOn) { this.motorOn = moving; this.audio.pressMotor(moving); }

    this.bell.sync();
    const poleY = this.bell.root.position.y + this.bell.localCentre(this.tmp).y - this.bell.R + this.bell.thickness * 0.5;
    this.fixture.setRamProgress(approach, poleY);

    if (this.leverProgress >= 1 && !this.locked) {
      this.locked = true;
      this.audio.pressMotor(false);
      this.motorOn = false;
      this.audio.pressStrike(1);
      this.director.impulse(0.016);
      this.retractPress();
    }
  }

  private retractPress() {
    this.play(0.9, (k) => {
      this.fixture.lever.setProgress(1 - easeOutCubic(k));
      this.fixture.setRamProgress(1 - k * 0.999, 0);
    }, () => {
      this.fixture.setRamProgress(0, 0);
      this.locked = false;
      this.leverProgress = 0;
      this.fixture.lever.root.visible = false;
      this.startPellet();
    });
    this.director.cut('drop', 1.3);
  }

  private startPellet() {
    this.enter('pellet');
    const r = this.bell.R;
    this.pellet.mesh.visible = true;
    this.pellet.place(r * 2.1, DIE_FACE_Y + this.pellet.radius, r * 1.15);
    this.pellet.container = null;
  }

  private updatePellet(dt: number) {
    if (this.pelletHeld) {
      // keep the pellet clear of the fingertip so the bowl stays visible
      this.plane.set(_up, -(DIE_FACE_Y + this.bell.R * 0.55));
      const hit = this.input.onPlane(this.plane, 46, this.tmp);
      if (hit) {
        this.pellet.pos.lerp(hit, clamp(dt * 22, 0, 1));
        this.pellet.mesh.position.copy(this.pellet.pos);
      }
    } else if (!this.pellet.container && this.needsRepositioning(this.pellet.pos)) {
      // the pellet waits on the bench wherever this screen has room for it
      const land = this.stage.orientation === 'landscape';
      _spot.set(this.pellet.pos.x, 0, this.pellet.pos.z);
      this.solveBenchAnchor(
        this.shotCamera('drop'),
        (land ? 0.74 : 0.70) * this.stage.width,
        (land ? 0.66 : 0.70) * this.stage.height,
        DIE_FACE_Y + this.pellet.radius, _spot,
        this.bell.R * 1.5, this.bell.R * 3.4, 0.5
      );
      const k = clamp(dt * 3.5, 0, 1);
      this.pellet.pos.x += (_spot.x - this.pellet.pos.x) * k;
      this.pellet.pos.z += (_spot.z - this.pellet.pos.z) * k;
      this.pellet.pos.y = DIE_FACE_Y + this.pellet.radius;
      this.pellet.vel.set(0, 0, 0);
      this.pellet.pos.x += this.nudge(2.6, 2) * this.bell.R * 0.05;
    }

    if (this.pellet.container) {
      this.pellet.container.centre.copy(this.bell.worldCentre(this.tmp2));
      this.pelletSettle += dt;
      if (this.pelletSettle > 1.35 && !this.locked) {
        this.locked = true;
        this.director.cut('petals', 1.4);
        this.after(0.9, () => { this.locked = false; this.enter('petals'); });
      }
    }
    void dt;
  }

  private releasePellet() {
    const r = this.bell.R;
    const d = Math.hypot(this.pellet.pos.x, this.pellet.pos.z);
    if (d < r * 1.5) {
      // generous catch: anywhere near the cup counts as "in"
      this.pellet.pos.x *= 0.12; this.pellet.pos.z *= 0.12;
      this.pellet.pos.y = Math.max(this.pellet.pos.y, DIE_FACE_Y + r * 0.5);
      this.pellet.vel.set(0, -0.05, 0);
      this.pellet.container = { centre: this.bell.worldCentre(new THREE.Vector3()), radius: this.bell.innerRadius };
      this.pellet.syncContainer();
      this.pelletSettle = 0;
    } else {
      this.pellet.vel.set(0, -0.05, 0);
    }
  }

  private onPelletImpact(speed: number, kind: 'bench' | 'shell') {
    const now = performance.now() / 1000;
    if (kind === 'bench') { this.audio.wood(clamp(speed * 1.6, 0.1, 1)); return; }
    if (this.phase === 'shake') {
      if (speed < 0.075) {
        if (now - this.lastTickAt > 0.25) { this.lastTickAt = now; this.audio.dullMetal(0.05); }
        return;
      }
      if (now - this.lastRingAt < 0.035) return;
      this.lastRingAt = now;
      this.audio.bellStrike(clamp((speed - 0.05) * 2.6, 0.07, 1));
      if (!this.rang) { this.rang = true; this.ringTime = 0; }
    } else if (this.phase === 'lift' || this.phase === 'cord') {
      // closed, but still cradled: a muffled knock, never the jingle
      if (speed > 0.12 && now - this.lastTickAt > 0.18) {
        this.lastTickAt = now;
        this.audio.dullMetal(clamp(speed * 0.7, 0.05, 0.3));
      }
    } else {
      // the shell is still open: dead, dry, unmusical -- on purpose
      this.audio.dullMetal(clamp(speed * 2.2, 0.08, 0.9));
    }
  }

  private updatePetals(dt: number) {
    const bell = this.bell;
    if (this.grabbedPetal >= 0) {
      const i = this.grabbedPetal;
      // the closing direction is wherever this petal's tip actually travels on
      // screen as it folds, so back petals work as well as near ones
      const f0 = clamp(bell.petalFold[i], 0, 0.8);
      const a = this.input.toScreen(bell.petalTipWorld(i, f0, this.tmp), _v2a).clone();
      const b = this.input.toScreen(bell.petalTipWorld(i, f0 + 0.2, this.tmp), _v2b);
      let dirX = b.x - a.x, dirY = b.y - a.y;
      let len = Math.hypot(dirX, dirY);
      if (len < 8) { dirX = 0; dirY = -1; len = 1; }
      const p = this.input.p;
      const moveX = p.x - p.startX, moveY = p.y - p.startY;
      let along = (moveX * dirX + moveY * dirY) / len;
      // wrong way: heavy resistance, and it never damages anything
      if (along < 0) along *= 0.16;
      const target = clamp(this.petalGrabProgress + along / 115, 0, 1);
      bell.petalFold[i] = damp(bell.petalFold[i], target, 22, dt);
      bell.markPetalDirty(i);
      if (bell.petalFold[i] > 0.995) {
        this.grabbedPetal = -1;
        this.seatPetal(i);
      }
    }

    for (let k = this.petalAnim.length - 1; k >= 0; k--) {
      const a = this.petalAnim[k];
      if (a.t < 0) {
        // released too early: eases back, no penalty, no sound
        bell.petalFold[a.i] = damp(bell.petalFold[a.i], 0, 9, dt);
        bell.markPetalDirty(a.i);
        if (bell.petalFold[a.i] < 0.004) { bell.petalFold[a.i] = 0; this.petalAnim.splice(k, 1); }
      } else {
        a.t += dt / 0.28;
        const e = easeOutCubic(clamp(a.t, 0, 1));
        bell.petalFold[a.i] = lerp(a.from, 1, e);
        bell.markPetalDirty(a.i);
        if (a.t >= 1) {
          bell.petalFold[a.i] = 1;
          this.petalAnim.splice(k, 1);
          this.seatPetal(a.i);
        }
      }
    }

    // idle: one still-open petal breathes a little, and always settles back
    if (this.hintPulse >= 0 && this.grabbedPetal < 0) {
      if (this.hintPetal < 0 || bell.petalFold[this.hintPetal] > 0.1) {
        this.hintPetal = bell.petalFold.findIndex((f) => f < 0.01);
      }
    } else if (this.hintPetal >= 0) {
      bell.petalFold[this.hintPetal] = 0;
      bell.markPetalDirty(this.hintPetal);
      this.hintPetal = -1;
    }
    if (this.hintPetal >= 0) {
      const n = Math.abs(this.nudge(2.4, 2)) * 0.05;
      if (Math.abs(bell.petalFold[this.hintPetal] - n) > 1e-4) {
        bell.petalFold[this.hintPetal] = n;
        bell.markPetalDirty(this.hintPetal);
      }
    }

    if (bell.closedCount >= bell.petalCount - 1 && this.petalAnim.length === 0 && !this.locked) {
      this.locked = true;
      this.director.cut('clinch', 1.3);
      this.fixture.clinchLever.root.visible = true;
      this.after(0.85, () => { this.locked = false; this.enter('clinch'); });
    }
  }

  private seatPetal(i: number) {
    this.audio.petalBend(0.7 + (i % 3) * 0.1);
    this.director.impulse(0.004);
    if (this.pellet.container) {
      this.pellet.vel.y += 0.06;
      this.pellet.vel.x += (Math.random() - 0.5) * 0.05;
    }
  }

  private updateClinch(dt: number) {
    const last = this.bell.petalFold.findIndex((f) => f < 0.995);
    if (this.leverGrabbed) {
      const want = this.leverGrabP + (this.input.p.y - this.leverGrabY) / 160;
      this.clinchProgress = clamp(Math.max(this.clinchProgress, want), 0, 1);
    } else if (this.clinchProgress > 0.68 && this.clinchProgress < 1) {
      this.clinchProgress = clamp(this.clinchProgress + dt * 1.1, 0, 1);
    }
    const hint = this.clinchProgress < 0.02 ? this.nudge() * 0.05 : 0;
    this.fixture.clinchLever.setProgress(clamp(this.clinchProgress + Math.abs(hint), 0, 1));
    this.fixture.setColletProgress(this.clinchProgress);

    if (last >= 0) {
      const f = smoothstep(0.14, 0.72, this.clinchProgress);
      if (Math.abs(f - this.bell.petalFold[last]) > 1e-4) {
        this.bell.petalFold[last] = f;
        this.bell.markPetalDirty(last);
      }
    }
    this.bell.clinch = smoothstep(0.72, 1, this.clinchProgress);
    if (this.clinchProgress > 0.86 && !this.bell.crown.visible) {
      this.bell.crown.visible = true;
      this.audio.tick(0.07);
    }
    if (this.pellet.container) {
      this.pellet.container.centre.copy(this.bell.worldCentre(this.tmp2));
      this.pellet.container.radius = this.bell.innerRadius;
    }

    if (this.clinchProgress >= 1 && !this.locked) {
      this.locked = true;
      this.bell.petalFold.fill(1);
      this.bell.crown.visible = true;
      for (let i = 0; i < this.bell.petalCount; i++) this.bell.markPetalDirty(i);
      this.audio.clinch();
      this.director.impulse(0.012);
      // the light shifts a touch as the shell closes: no sparkle, no bloom
      const lamp = this.workshop.lamp;
      const base = lamp.intensity;
      this.play(1.5, (k) => {
        lamp.intensity = base * (1 + 0.22 * Math.sin(k * Math.PI));
        this.fixture.setColletProgress(1 - easeOutCubic(clamp((k - 0.35) / 0.65, 0, 1)));
        this.fixture.clinchLever.setProgress(1 - easeOutCubic(clamp((k - 0.2) / 0.8, 0, 1)));
      }, () => {
        lamp.intensity = base;
        this.fixture.setColletProgress(0);
        this.fixture.clinchLever.root.visible = false;
        this.locked = false;
        this.startPolish();
      });
      this.after(0.7, () => this.director.cut('polish', 1.5));
    }
  }

  private startPolish() {
    this.enter('polish');
    this.brush.root.visible = true;
    this.brush.root.position.set(this.bell.R * 3.0, DIE_FACE_Y + this.bell.R * 0.3, this.bell.R * 1.9);
  }

  private updatePolish(dt: number) {
    // the work turns slowly on its own so every face comes past the brush
    this.bell.root.rotation.y += dt * 0.42;
    const p = this.input.p;

    let touched = false;
    if (this.polishActive) {
      const ray = this.input.rayAt(p.x, p.y - 42);
      const hits = ray.intersectObjects(
        [this.bell.bowlMesh, ...this.bell.petalMeshes, ...this.bell.crown.children], false
      );
      const h = hits[0];
      if (h && h.uv) {
        touched = true;
        const nrm = h.normal ? h.normal.clone().normalize() : _up.clone();
        this.brush.root.position.copy(h.point);
        _q.setFromUnitVectors(_up, nrm);
        this.brush.root.quaternion.slerp(_q, clamp(dt * 12, 0, 1));
        this.brush.root.position.addScaledVector(nrm, this.bell.R * 0.06);
        const speed = Math.hypot(p.dx, p.dy);
        this.bell.polishAt(h.uv.x, h.uv.y, 22 + Math.min(speed, 20), 0.26);
        this.polishTravel += speed;
        this.polishSpeed = damp(this.polishSpeed, clamp(speed / 22, 0, 1), 12, dt);
      }
    }
    if (!touched) {
      this.polishSpeed = damp(this.polishSpeed, 0, 8, dt);
      if (!this.polishActive) {
        const n = this.nudge(2.6, 2);
        this.brush.root.position.x = damp(this.brush.root.position.x, this.bell.R * 2.6, 4, dt) + n * this.bell.R * 0.12;
        this.brush.root.position.y = damp(this.brush.root.position.y, DIE_FACE_Y + this.bell.R * 0.5, 4, dt);
        this.brush.root.position.z = damp(this.brush.root.position.z, this.bell.R * 1.8, 4, dt);
        _q.identity();
        this.brush.root.quaternion.slerp(_q, clamp(dt * 5, 0, 1));
      }
    }
    this.audio.setSwish(this.polishSpeed * 0.9);

    const strokes = Math.floor(this.polishTravel / 260);
    if (strokes > this.polishStrokes) {
      this.polishStrokes = strokes;
      this.audio.tick(0.03);
    }
    if (this.polishStrokes >= 3 && !this.locked) {
      this.locked = true;
      this.audio.setSwish(0);
      this.director.cut('cord', 1.4);
      this.after(1.0, () => {
        this.brush.root.visible = false;
        this.locked = false;
        this.startCord();
      });
    }
  }

  private startCord() {
    this.enter('cord');
    this.cord.mesh.visible = true;
    this.cordEnd.set(this.bell.R * 1.15, DIE_FACE_Y + this.bell.R * 0.09, this.bell.R * 1.05);
  }

  private updateCord(dt: number) {
    this.bell.root.rotation.y = damp(this.bell.root.rotation.y, Math.round(this.bell.root.rotation.y / (Math.PI * 2)) * Math.PI * 2, 3.2, dt);
    const loop = this.bell.loopWorld(this.tmp);

    if (this.cordThread > 0) {
      this.cordThread = clamp(this.cordThread + dt / 0.8, 0, 1);
      const e = easeOutCubic(this.cordThread);
      this.cordEnd.lerp(loop, clamp(dt * 8, 0, 1));
      const span = this.bell.R * 1.1;
      const n = this.cord.points.length;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const a = t * Math.PI * 2;
        // the thong runs through the ring and hangs as two legs
        const legs = lerp(0, 1, e);
        this.cord.points[i].set(
          loop.x + Math.sin(a) * span * 0.5 * legs,
          loop.y + this.bell.R * 0.13 * Math.cos(a) * legs + span * 0.9 * legs * (1 - Math.abs(Math.cos(a * 0.5))),
          loop.z
        );
      }
      this.cord.refresh();
      if (this.cordThread >= 1 && !this.locked) {
        this.locked = true;
        this.director.cut('lift', 1.3);
        this.after(0.8, () => { this.locked = false; this.enter('lift'); });
      }
      return;
    }

    if (this.cordHeld) {
      this.plane.set(_up, -(DIE_FACE_Y + this.bell.R * 0.9));
      const hit = this.input.onPlane(this.plane, 44, this.tmp2);
      if (hit) this.cordEnd.lerp(hit, clamp(dt * 18, 0, 1));
    } else if (this.needsRepositioning(this.cordEnd)) {
      const land = this.stage.orientation === 'landscape';
      _spot.set(this.cordEnd.x, 0, this.cordEnd.z);
      this.solveBenchAnchor(
        this.shotCamera('cord'),
        (land ? 0.70 : 0.66) * this.stage.width,
        (land ? 0.72 : 0.74) * this.stage.height,
        DIE_FACE_Y + this.bell.R * 0.09, _spot,
        this.bell.R * 1.25, this.bell.R * 2.6, 0.5
      );
      const k = clamp(dt * 3, 0, 1);
      this.cordEnd.x += (_spot.x - this.cordEnd.x) * k;
      this.cordEnd.z += (_spot.z - this.cordEnd.z) * k;
      this.cordEnd.y += (DIE_FACE_Y + this.bell.R * 0.09 - this.cordEnd.y) * k
        + this.nudge(2.4, 2) * this.bell.R * 0.05;
    }
    const anchor = _anchor.set(
      this.cordEnd.x * 1.55 + this.bell.R * 0.2,
      DIE_FACE_Y + this.bell.R * 0.06,
      this.cordEnd.z * 1.55 + this.bell.R * 0.2
    );
    this.cord.shape(anchor, this.cordEnd, this.bell.R * 0.28);
  }

  private updateLift(dt: number) {
    const p = this.input.p;
    if (p.down) {
      const up = (p.startY - p.y) / 150;
      this.liftAmount = clamp(Math.max(this.liftAmount, up), 0, 1);
    }
    if (this.hintPulse >= 0 && !p.down) {
      this.liftAmount = Math.max(this.liftAmount, Math.abs(this.nudge(2.4, 2)) * 0.05);
    }
    const h = this.bell.R * 2.9 * easeOutCubic(this.liftAmount);
    this.bell.root.position.y = this.bellHome.y + h;
    this.pellet.container!.centre.copy(this.bell.worldCentre(this.tmp2));
    this.director.setFollow(this.tmp2, clamp(this.liftAmount * 1.3, 0, 1));
    this.updateHangingCord();
    if (this.liftAmount >= 0.999 && !this.locked) {
      this.locked = true;
      this.director.cut('shake', 1.1);
      this.handX = this.handTargetX = this.prevHandX = 0;
      this.swingAngle = 0; this.swingVel = 0;
      this.after(0.65, () => {
        this.locked = false;
        // park the pellet dead still at the bottom of the shell: the very first
        // jingle has to come from the child's own swing, not from the handover
        const c = this.pellet.container!;
        c.centre.copy(this.bell.worldCentre(this.tmp2));
        this.pellet.pos.copy(c.centre);
        this.pellet.pos.y -= c.radius - this.pellet.radius - 1e-4;
        this.pellet.vel.set(0, 0, 0);
        this.pellet.syncContainer();
        // if the lifting finger is still down, wait for a fresh touch: the
        // first swing must be a deliberate one
        this.shakeReady = !this.input.p.down;
        this.enter('shake');
      });
    }
    void dt;
  }

  private updateShake(dt: number) {
    const p = this.input.p;
    const R = this.bell.R;
    if (p.down && this.shakeReady) {
      // the hand follows the finger across the frame
      this.plane.set(_forward, -0);
      const hit = this.input.onPlane(this.plane, 40, this.tmp);
      if (hit) this.handTargetX = clamp(hit.x, -R * 6, R * 6);
    } else {
      this.handTargetX = damp(this.handTargetX, 0, 1.6, dt);
    }
    this.prevHandX = this.handX;
    this.handX = damp(this.handX, this.handTargetX, 26, dt);
    const handAcc = (this.handX - this.prevHandX) / Math.max(dt, 1e-3);

    // pendulum: the shell always lags the hand, the pellet lags the shell
    const L = this.cordLength();
    const g = 9.81;
    const acc = -(g / L) * Math.sin(this.swingAngle)
      - 2.4 * this.swingVel
      - (handAcc / L) * Math.cos(this.swingAngle) * 0.02;
    this.swingVel += acc * dt;
    this.swingAngle += this.swingVel * dt;
    this.swingAngle = clamp(this.swingAngle, -1.1, 1.1);

    const handY = this.handHeight();
    const loopY = this.loopLocalY();
    this.bell.root.position.set(
      this.handX + Math.sin(this.swingAngle) * L,
      handY - Math.cos(this.swingAngle) * L - loopY,
      0
    );
    this.bell.root.rotation.z = -this.swingAngle * 0.85;
    this.bell.root.rotation.y += dt * 0.15;

    this.pellet.container!.centre.copy(this.bell.worldCentre(this.tmp2));
    this.director.setFollow(_follow.set(this.tmp2.x * 0.45, this.tmp2.y, 0), 1);
    this.updateHangingCord();

    if (this.hintPulse >= 0 && !p.down && !this.rang) {
      this.handTargetX = this.nudge(2.4, 2) * R * 0.9;
    }

    if (this.rang) {
      if (this.ringTime === 0) this.audio.setAmbience(0.45);
      this.ringTime += dt;
      // let the first ring breathe before anything else is offered
      if (this.ringTime > 4.5 && !this.overlay.choicesVisible) this.overlay.showChoices(true);
    }
  }

  private cordLength() { return this.bell.R * 2.6; }
  private loopLocalY() { return this.bell.topLocalY - 0.03 * this.bell.R + 0.40 * this.bell.R; }
  /** Chosen so the bell hangs at exactly the height the lift ended on: the
   *  hand-over from "lifted" to "swinging" has to be seamless, or the pellet
   *  gets thrown against the wall and rings before the child swings it. */
  private handHeight() {
    return this.bellHome.y + this.bell.R * 2.9 + this.cordLength() + this.loopLocalY();
  }

  private updateHangingCord() {
    const loop = this.bell.loopWorld(this.tmp);
    const R = this.bell.R;
    const top = _anchor.set(this.handX, this.handHeight(), 0);
    const n = this.cord.points.length;
    const half = Math.floor(n / 2);
    for (let i = 0; i < n; i++) {
      if (i <= half) {
        const t = i / half;
        this.cord.points[i].lerpVectors(top, loop, t);
        this.cord.points[i].x -= Math.sin(t * Math.PI) * R * 0.12;
      } else {
        const t = (i - half) / (n - 1 - half);
        this.cord.points[i].lerpVectors(loop, top, t);
        this.cord.points[i].x += Math.sin(t * Math.PI) * R * 0.12;
      }
    }
    this.cord.refresh();
  }

  // ---------------------------------------------------------------- replay

  private onChoice(c: ReplayChoice) {
    if (this.locked) return;
    this.overlay.showChoices(false);
    if (c === 'play') {
      // back to free play; the menu drifts back shortly so the way out is
      // never more than one more tap away
      window.clearTimeout(this.menuTimer);
      this.menuTimer = window.setTimeout(() => {
        if (this.phase === 'shake') this.overlay.showChoices(true);
      }, 9000);
      return;
    }
    this.locked = true;
    if (c === 'resize') this.sizeIndex = (this.sizeIndex + 1) % SIZES.length;
    const radius = SIZES[this.sizeIndex];
    const dim = document.getElementById('boot');
    dim?.classList.remove('hide');
    this.after(0.42, () => {
      this.buildRun(radius);
      this.locked = false;
      dim?.classList.add('hide');
    });
  }

  /**
   * Where the currently touchable things are, in CSS pixels. Exposed only
   * through the read-only debug state so an automated play-through can press
   * the same places a finger would; nothing here is drawn.
   */
  targets(): { kind: string; x: number; y: number }[] {
    const out: { kind: string; x: number; y: number }[] = [];
    const add = (kind: string, w: THREE.Vector3) => {
      const s = this.input.toScreen(w, _v2c);
      out.push({ kind, x: Math.round(s.x), y: Math.round(s.y) });
    };
    switch (this.phase) {
      case 'intro':
      case 'press': add('lever', this.fixture.lever.knobWorld(this.tmp)); break;
      case 'pellet': add('pellet', this.pellet.pos); add('bowl', this.bell.worldCentre(this.tmp)); break;
      case 'petals':
        for (let i = 0; i < this.bell.petalCount; i++) {
          if (this.bell.petalFold[i] < 0.99) add('petal' + i, this.bell.petalWorld(i, this.tmp));
        }
        add('apex', this.bell.loopWorld(this.tmp));
        break;
      case 'clinch': add('lever', this.fixture.clinchLever.knobWorld(this.tmp)); break;
      case 'polish': add('bell', this.bell.worldCentre(this.tmp)); break;
      case 'cord': add('cordEnd', this.cordEnd); add('loop', this.bell.loopWorld(this.tmp)); break;
      case 'lift': add('bell', this.bell.worldCentre(this.tmp)); break;
      case 'shake': add('bell', this.bell.worldCentre(this.tmp)); break;
    }
    return out;
  }

  render() { this.stage.render(); }
  get renderStage() { return this.stage; }
}

const _up = new THREE.Vector3(0, 1, 0);
const _forward = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _v2a = new THREE.Vector2();
const _v2b = new THREE.Vector2();
const _v2c = new THREE.Vector2();
const _anchor = new THREE.Vector3();
const _follow = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _fwdH = new THREE.Vector3();
const _rightH = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _leverPos = new THREE.Vector3();
const _spot = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _proj = new THREE.Vector3();
