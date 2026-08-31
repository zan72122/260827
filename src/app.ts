import * as THREE from 'three';
import { MM, TAU, clamp, damp } from './core/units';
import { shoulderPlaneY, spec, trunkFaceRadius, trunkTopY } from './design/treeSpec';
import { Mechanism, MAX_TURNS } from './mech/mechanism';
import { PINS, combIndexOf, pinsBetween } from './mech/melody';
import { MusicBoxAudio } from './audio/musicBox';
import { buildPalette } from './render/materials';
import { buildEnvironment, buildOrnaments, buildRoom, layout } from './render/room';
import { TreeModel } from './render/tree';
import { PotAndMovement } from './render/movement';
import { CameraDirector, fitDistance, type Framing, type Phase } from './camera/director';
import { PointerRouter } from './input/pointerRouter';
import { Assembly } from './play/assembly';
import { Winder } from './play/wind';
import { Hud } from './ui/hud';
import type { Viewport } from './play/screen';

/** The three boards and the star the child fits, biggest first. */
const CHILD_TASKS = ['t0f2', 't1f7', 't2f2', 'star', 'tree'];

const MAX_DT = 1 / 20; // never work through a long tab-away in one step

export interface DebugState {
  phase: Phase;
  mech: string;
  turns: number;
  charge: number;
  seated: number;
  remaining: number;
  fps: number;
  triangles: number;
  drawCalls: number;
  dpr: number;
  gripPx: number;
  portrait: boolean;
  notes: number;
  muted: boolean;
  audio: string;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly mech = new Mechanism();
  readonly audio = new MusicBoxAudio();
  readonly tree: TreeModel;
  readonly pot: PotAndMovement;
  readonly director: CameraDirector;
  readonly assembly: Assembly;
  readonly winder: Winder;
  readonly hud: Hud;
  private router: PointerRouter;
  private carrier = new THREE.Group();
  private vp: Viewport = { width: 1, height: 1 };
  private dprCap = 1.5;
  private dpr = 1.5;
  private frameTimes: number[] = [];
  private last = 0;
  private ornaments: Array<{ pivot: THREE.Object3D; swing: number }> = [];
  private prevShaft = 0;
  private running = true;
  private startDelay = 1.5;
  private fps = 60;
  private lastSeated: string | null = null;
  /** how many pins have gone past the comb since the page loaded */
  notesPlayed = 0;

  constructor(private canvas: HTMLCanvasElement, hudParent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0x2b2118);

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.03, 9);
    this.scene.add(this.carrier);

    this.scene.environment = buildEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.6;

    const palette = buildPalette();
    buildRoom(palette, this.scene);

    this.tree = new TreeModel(palette);
    this.scene.add(this.tree.group);
    this.tree.group.position.set(layout.jigOrigin.x, layout.jigShoulderY, layout.jigOrigin.z);

    this.pot = new PotAndMovement(palette);
    this.pot.group.position.copy(layout.potOrigin);
    this.scene.add(this.pot.group);

    // everything except the child's pieces is already fitted on the jig
    for (const piece of this.tree.pieces.values()) {
      if (!CHILD_TASKS.includes(piece.id)) this.tree.seat(piece.id);
    }
    this.hangOrnaments(palette);

    this.director = new CameraDirector(this.camera, (p, aspect) => this.framingFor(p, aspect));

    this.assembly = new Assembly(this.tree, this.carrier, this.camera, this.vp, {
      onPickUp: () => void this.audio.unlock(),
      onSeated: (id) => this.onSeated(id),
      onAllDone: () => this.onAllDone(),
    });
    this.assembly.treeSeatedPosition = layout.potOrigin
      .clone()
      .add(new THREE.Vector3(0, shoulderPlaneY * MM, 0));
    this.assembly.setTasks(CHILD_TASKS, layout.trayOrigin);

    this.winder = new Winder(this.mech, this.tree, this.camera, this.vp, {
      onGrab: () => {
        void this.audio.unlock();
        this.director.hold(2.4);
      },
      onRelease: () => this.director.hold(2.4),
      onRatchet: (n, slipping) => {
        if (slipping) this.audio.slip();
        else for (let i = 0; i < Math.min(n, 3); i++) this.audio.ratchet();
      },
    });
    this.winder.setEnabled(false);

    this.hud = new Hud(hudParent, (muted) => {
      void this.audio.unlock();
      this.audio.setMuted(muted);
    });

    this.router = new PointerRouter(canvas, [this.winder, this.assembly]);
    canvas.addEventListener('pointerdown', () => void this.audio.unlock(), { passive: true });

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 60));
    document.addEventListener('visibilitychange', () => this.onVisibility());
    this.resize();
  }

  /* ------------------------------------------------------------ framing */

  private framingFor(phase: Phase, aspect: number): Framing {
    const jig = layout.jigOrigin;
    const potTop = layout.potOrigin.clone().add(new THREE.Vector3(0, shoulderPlaneY * MM, 0));
    const tall = aspect < 1;
    const make = (
      target: THREE.Vector3,
      halfW: number,
      halfH: number,
      yaw: number,
      pitch: number,
      fov: number,
    ): Framing => ({ target, dist: fitDistance(halfW, halfH, fov, aspect), yaw, pitch, fov });

    switch (phase) {
      case 'overview':
        // Upright: use the height, from the bench up past the tree.
        // Landscape: open the same scene out sideways along the bench.
        return tall
          ? make(new THREE.Vector3(-0.03, 0.16, 0.055), 0.14, 0.235, 0.12, -0.28, 38)
          : make(new THREE.Vector3(-0.015, 0.14, 0.03), 0.315, 0.165, 0.1, -0.24, 40);
      case 'assembly':
        // oblique and close on the joinery, with the waiting boards still in shot
        return tall
          ? make(
              new THREE.Vector3(jig.x + 0.05, 0.185, jig.z + 0.085),
              0.15,
              0.27,
              0.45,
              -0.18,
              42,
            )
          : make(
              new THREE.Vector3(jig.x + 0.085, 0.185, jig.z + 0.06),
              0.3,
              0.245,
              0.42,
              -0.16,
              42,
            );
      case 'mount': {
        // down at bench level: the axle, the bearing cup and the pot's rim
        const t = new THREE.Vector3(
          (jig.x + layout.potOrigin.x) / 2 - 0.012,
          0.125,
          (jig.z + layout.potOrigin.z) / 2 + 0.015,
        );
        return tall
          ? make(t, 0.2, 0.225, 0.16, -0.26, 40)
          : make(t, 0.3, 0.17, 0.14, -0.22, 42);
      }
      case 'finished':
      default:
        // the pot low in the frame, the turning branches and the star above it
        return tall
          ? make(
              new THREE.Vector3(potTop.x, potTop.y + 0.15, potTop.z),
              0.15,
              0.235,
              0.1,
              -0.08,
              36,
            )
          : make(
              new THREE.Vector3(potTop.x, potTop.y + 0.14, potTop.z),
              0.3,
              0.245,
              0.1,
              -0.1,
              40,
            );
    }
  }

  /* --------------------------------------------------------- ornaments */

  private hangOrnaments(palette: ReturnType<typeof buildPalette>) {
    const { bead, cordGeo, beadWood, cordMat } = buildOrnaments(palette);
    const spots: Array<[string, number]> = [
      ['t1f3', 0.66],
      ['t2f4', 0.6],
      ['t0f4', 0.72],
    ];
    for (const [id, along] of spots) {
      const piece = this.tree.pieces.get(id);
      if (!piece || !piece.slot) continue;
      const pivot = new THREE.Group();
      pivot.position.set(piece.slot.span * along * MM, -6 * MM, 0);
      const cord = new THREE.Mesh(cordGeo, cordMat);
      const ball = new THREE.Mesh(bead, beadWood);
      ball.position.y = -32 * MM;
      ball.castShadow = true;
      pivot.add(cord, ball);
      piece.object.add(pivot);
      this.ornaments.push({ pivot, swing: 0 });
    }
  }

  /* ------------------------------------------------------------- phases */

  private onSeated(id: string) {
    this.lastSeated = id;
    // no camera move on the frame a joint closes
    this.director.hold(1.15);
    this.audio.seatKnock(id === 'star' ? 1.35 : id === 'tree' ? 0.72 : 1);
    if (id === 'star') this.director.go('mount');
    if (id === 'tree') {
      this.director.go('finished');
      this.winder.setEnabled(true);
      this.assembly.setEnabled(false);
    }
  }

  private onAllDone() {
    this.winder.setEnabled(true);
  }

  /* -------------------------------------------------------- life cycle */

  private onVisibility() {
    if (document.hidden) {
      this.router.abort();
      this.audio.suspend();
      this.running = false;
    } else {
      this.running = true;
      this.last = performance.now();
      // the context was already opened by a touch, so it may be resumed here
      if (this.audio.created) void this.audio.unlock();
    }
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.vp.width = w;
    this.vp.height = h;
    this.dpr = Math.min(this.dprCap, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // the tree keeps every millimetre it had; only the view is re-composed
    this.director.reframe(w / h);
  }

  start() {
    this.last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const raw = (now - this.last) / 1000;
      this.last = now;
      if (!this.running) return;
      this.frame(raw, raw);
    };
    requestAnimationFrame(loop);
  }

  /**
   * One step.  The step is clamped here rather than in the loop, so no caller —
   * a tab coming back after an hour included — can make the movement work
   * through a long stretch of time in one go.
   */
  frame(step: number, raw = step, render = true) {
    const dt = clamp(step, 0, MAX_DT);
    // Some browsers report a rotation late, or not at all when only the visual
    // viewport changes, so the canvas is measured every frame rather than
    // trusting the resize event alone.
    if (this.canvas.clientWidth !== this.vp.width || this.canvas.clientHeight !== this.vp.height) {
      this.resize();
    }
    if (this.startDelay > 0) {
      this.startDelay -= dt;
      if (this.startDelay <= 0) this.director.go('assembly');
    }

    this.prevShaft = this.mech.shaftYaw;
    this.mech.step(dt);
    this.emitNotes();

    this.tree.group.rotation.y = this.mech.shaftYaw;
    this.pot.update(this.mech.shaftYaw, dt);

    this.assembly.update(dt);
    this.director.update(dt);

    const omega = this.mech.angularSpeed;
    for (const o of this.ornaments) {
      const targetLag = clamp(-omega * 0.16, -0.35, 0.35);
      o.swing = damp(o.swing, targetLag, 5, dt);
      o.pivot.rotation.z = o.swing;
      o.pivot.rotation.x = Math.sin(performance.now() * 0.0009 + o.pivot.position.x * 40) * 0.02;
    }

    this.audio.setRunning(omega / (TAU / 9.6), this.winder.holding ? 0.7 : 0);
    this.hud.update(dt, this.mech.charge, this.mech.state !== 'idle');

    this.adaptQuality(raw);
    if (render) this.renderer.render(this.scene, this.camera);
  }

  /** Pins that went past the comb this step become notes and tooth flashes. */
  private emitNotes() {
    const moved = (this.mech.shaftYaw - this.prevShaft) / TAU;
    if (moved <= 0) return;
    const period = TAU;
    const fromPhase = (((this.prevShaft % period) + period) % period) / period;
    for (const pin of pinsBetween(fromPhase, moved)) {
      this.notesPlayed++;
      this.audio.pluck(pin.midi, pin.vel, pin.voice);
      this.pot.flashTooth(combIndexOf(pin.midi));
      this.hud.pulse();
    }
  }

  private adaptQuality(raw: number) {
    this.frameTimes.push(raw);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (this.frameTimes.length < 60) return;
    const mean = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps = 1 / Math.max(1e-3, mean);
    if (mean > 0.031 && this.dpr > 1.0) {
      this.dpr = Math.max(1.0, this.dpr - 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this.frameTimes.length = 0;
    } else if (mean < 0.0145 && this.dpr < this.dprCap) {
      this.dpr = Math.min(this.dprCap, this.dpr + 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this.frameTimes.length = 0;
    }
  }

  /* ------------------------------------------------------- test hooks */

  debug(): DebugState {
    return {
      phase: this.director.phase,
      mech: this.mech.state,
      turns: this.mech.turns,
      charge: this.mech.charge,
      seated: this.tree.seatedCount,
      remaining: this.assembly.remaining,
      fps: this.fps,
      triangles: this.renderer.info.render.triangles,
      drawCalls: this.renderer.info.render.calls,
      dpr: this.dpr,
      gripPx: this.winder.gripRadiusPx(),
      portrait: this.vp.height >= this.vp.width,
      notes: this.notesPlayed,
      muted: this.hud.isMuted,
      audio: this.audio.created ? (this.audio.running ? 'running' : 'suspended') : 'not-created',
    };
  }

  /**
   * Inspection views used while building this: the joinery has to hold up from
   * behind, from above and from underneath, not only from the playing camera.
   */
  devView(which: 'back' | 'top' | 'under' | 'side' | 'joint') {
    this.running = false; // hold the loop so the inspection frame is what is shown
    this.scene.updateMatrixWorld(true);
    const t = this.tree.axisPoint(160);
    const d = 0.62;
    switch (which) {
      case 'back':
        this.camera.position.set(t.x, t.y + 0.1, t.z - d);
        break;
      case 'top':
        this.camera.position.set(t.x + 0.09, t.y + d, t.z + 0.09);
        break;
      case 'under':
        // a low grazing look at the foot: collar, thrust washer, bushing, rim
        this.camera.position.set(t.x + 0.075, t.y - 0.145, t.z + 0.115);
        break;
      case 'joint':
        this.camera.position.set(t.x + 0.13, t.y - 0.06, t.z + 0.13);
        break;
      case 'side':
        this.camera.position.set(t.x + d, t.y, t.z);
        break;
    }
    const look =
      which === 'under'
        ? this.tree.axisPoint(2)
        : which === 'joint'
          ? this.tree.axisPoint(spec.tiers[0].height)
          : which === 'top'
            ? this.tree.axisPoint(230)
            : t;
    this.camera.lookAt(look);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  /** Leave an inspection view and carry on playing. */
  resumeLoop() {
    this.running = true;
    this.last = performance.now();
    this.resize();
  }

  /** Run the simulation forward without drawing every frame (tests, screenshots). */
  fastForward(seconds: number) {
    const step = 1 / 60;
    let left = seconds;
    while (left > 1e-6) {
      const dt = Math.min(step, left);
      left -= dt;
      this.frame(dt, dt, false);
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Fit everything without touching the screen — for screenshots and tests. */
  finishAssemblyInstantly() {
    for (const piece of this.tree.pieces.values()) if (!piece.seated) this.tree.seat(piece.id);
    this.tree.group.position.copy(this.assembly.treeSeatedPosition);
    this.assembly.setEnabled(false);
    this.winder.setEnabled(true);
    this.director.go('finished');
  }

  /** Wind by hand, in turns, without a pointer. */
  windTurns(turns: number) {
    this.mech.grab();
    this.mech.applyHandTurn(-turns * TAU);
    this.mech.release();
  }

  /**
   * The tree's real size, measured in the scene rather than read off the design,
   * so a test can prove that turning the phone does not change the tree.
   */
  treeMetrics() {
    this.scene.updateMatrixWorld(true);
    const base = this.tree.axisPoint(0);
    const tip = this.tree.axisPoint(trunkTopY + spec.star.height);
    // measured off the boards themselves: the farthest branch tip from the axis
    let far = 0;
    const p = new THREE.Vector3();
    for (const piece of this.tree.pieces.values()) {
      if (!piece.slot || !piece.seated) continue;
      p.set(piece.slot.span * MM, 0, 0).applyMatrix4(piece.object.matrixWorld);
      far = Math.max(far, Math.hypot(p.x - base.x, p.z - base.z));
    }
    return {
      heightMM: (tip.y - base.y) / MM,
      spanMM: (2 * far) / MM,
      boardThicknessMM: spec.leaf.thickness,
    };
  }

  /**
   * How well the last board the player fitted actually sits: the error against
   * its designed seat, and the radius its shoulder ended up at, which has to be
   * the radius of the trunk's face.
   */
  seatError() {
    const id = this.lastSeated;
    if (!id || id === 'tree') {
      return { id, positionErrorMM: 0, shoulderRadiusMM: 0, trunkFaceRadiusMM: 0 };
    }
    const piece = this.tree.pieces.get(id)!;
    const want = this.tree.poseFor(id, 0).position;
    const got = piece.object.position;
    return {
      id,
      positionErrorMM: got.distanceTo(want) / MM,
      shoulderRadiusMM: Math.hypot(got.x, got.z) / MM,
      trunkFaceRadiusMM: id === 'star' ? Math.hypot(got.x, got.z) / MM : trunkFaceRadius,
    };
  }

  /** Screen position of the piece currently in hand, in CSS pixels. */
  heldPiecePos(): { x: number; y: number } | null {
    const task = this.assembly.currentTask;
    if (!task || this.assembly.mode === 'idle') return null;
    const obj = task.id === 'tree' ? this.tree.group : this.tree.pieces.get(task.id)?.object;
    if (!obj) return null;
    obj.updateWorldMatrix(true, false);
    const q = obj.getWorldPosition(new THREE.Vector3()).project(this.camera);
    return { x: ((q.x + 1) / 2) * this.vp.width, y: ((1 - q.y) / 2) * this.vp.height };
  }

  /** Where the piece being offered can be picked up, in CSS pixels. */
  pickTarget(): { x: number; y: number } | null {
    const c = this.assembly.hitCapsule();
    if (!c) return null;
    return { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 };
  }

  /** Entry and seated points of the current joint, in CSS pixels. */
  jointTargets(): { entry: { x: number; y: number }; seated: { x: number; y: number } } | null {
    const task = this.assembly.currentTask;
    if (!task) return null;
    const j = this.assembly.jointWorld(task.id);
    const p = (v: THREE.Vector3) => {
      const q = v.clone().project(this.camera);
      return { x: ((q.x + 1) / 2) * this.vp.width, y: ((1 - q.y) / 2) * this.vp.height };
    };
    return { entry: p(j.entry), seated: p(j.seated) };
  }

  /** True while the pot is where it was bolted down and only the tree turns. */
  potWorldPosition() {
    return this.pot.group.getWorldPosition(new THREE.Vector3()).toArray();
  }

  /** Screen position of the point the winding grip is measured around. */
  gripCentre() {
    return this.tree.axisPoint(60);
  }

  /** The winding grip's centre in CSS pixels, plus its radius. */
  gripTarget(): { x: number; y: number; r: number } {
    const q = this.tree.axisPoint(60).project(this.camera);
    return {
      x: ((q.x + 1) / 2) * this.vp.width,
      y: ((1 - q.y) / 2) * this.vp.height,
      r: this.winder.gripRadiusPx(),
    };
  }

  get maxTurns() {
    return MAX_TURNS;
  }

  get pinCount() {
    return PINS.length;
  }

  get potHeightMM() {
    return spec.pot.height;
  }
}
