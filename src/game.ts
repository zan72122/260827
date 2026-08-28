import {
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Matrix4,
  Plane,
  Quaternion,
  Raycaster,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  CylinderGeometry,
  TorusGeometry,
  BoxGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { App } from './core/app';
import { AudioEngine } from './audio/engine';
import { BellBus } from './audio/bells';
import { FoleyBus, type Ground } from './audio/foley';
import { CameraDirector, type Shot } from './camera/director';
import { buildMaterials, type MaterialLibrary } from './world/materials';
import { buildEnvironments, SkyDome, type Environments } from './world/sky';
import { TackRoom, BENCH_TOP } from './world/tackroom';
import { Strap } from './world/strap';
import {
  BellField,
  BELL_RADIUS,
  makeLooseBell,
  type BellSize,
  type BellStrike,
} from './world/bell';
import { Horse, type HoofEvent } from './world/horse';
import { Winter, TrackRibbon, BEATS } from './world/winter';
import { Sleigh, Handler, PuffField } from './world/props';
import { DrivingHarness } from './world/harness';
import { Hud, type ReplayChoice } from './ui/hud';

type Phase =
  | 'boot'
  | 'intro'
  | 'fitting'
  | 'shake'
  | 'harness'
  | 'buckle'
  | 'firstStep'
  | 'toField'
  | 'ride'
  | 'arrival'
  | 'freeWalk';

/** the three bell arrangements, in the order the replay screen offers them */
const CONFIGS: BellSize[][] = [
  [0, 1, 2, 1, 2, 1, 2, 1, 0], // mixed - the recommended first run
  [0, 0, 0, 0, 0, 0, 0, 0, 0], // small only - fine and light
  [2, 2, 2, 2, 2], // a few large - slow and strong
];
const CONFIG_SOCKETS: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8],
  [0, 1, 2, 3, 4, 5, 6, 7, 8],
  [0, 2, 4, 6, 8],
];

const SOCKETS = [0.13, 0.22, 0.31, 0.41, 0.5, 0.59, 0.69, 0.78, 0.87];
const STRAP_LEN = 1.34;

const HORSE_POS = new Vector3(0.95, 0, -1.85);
/**
 * Everything below is in the horse's own space: +Z forward, +Y up.
 *
 * The strap is a closed loop round the base of the neck, which is the one
 * place on this animal whose girth actually matches the strap's length, and
 * the place a real set of shaft chimes hangs. The buckle joins both ends at
 * the crest, where an adult can reach it.
 */
/**
 * Measured off the mesh itself: at the base of the neck the section is about
 * 0.28 m across and 0.6 m deep, and the neck rises forward at roughly 30
 * degrees. The loop's plane is perpendicular to that axis.
 */
const NECK_CENTRE = new Vector3(0, 1.55, 0.9);
const NECK_RADII = new Vector3(0.16, 0.3, 0.27);
const NECK_E1 = new Vector3(1, 0, 0);
const NECK_E2 = new Vector3(0, 0.876, -0.482);
const NECK_R1 = 0.185;
const NECK_R2 = 0.255;
/** the shoulder, which catches the loop when it settles */
const CHEST_CENTRE = new Vector3(0, 1.2, 0.55);
const CHEST_RADII = new Vector3(0.34, 0.42, 0.38);
/** the throat, where the bells gather: what the close shots look at */
const BELL_FOCUS = new Vector3(0, 1.36, 0.99);
const BUCKLE_LOCAL = new Vector3(0, 1.55 + 0.876 * 0.255, 0.9 - 0.482 * 0.255);
/** the horse stands side-on, facing the open barn door */
const HORSE_YAW = -Math.PI / 2;
/** metres from the horse's root back to the sleigh's, set by the shaft length */
const SLEIGH_TRAIL = 2.45;
/** the ride starts a little way inside the route so the sleigh has road behind it */
const RIDE_START = 9;

interface TrayBell {
  mesh: Group;
  size: BellSize;
  home: Vector3;
  carried: boolean;
}

const _v = new Vector3();
const _v2 = new Vector3();
const _screen = new Vector3();
const _anchorA = new Vector3();
const _anchorB = new Vector3();
const _anchorC = new Vector3();
const _traceLocal = new Vector3();
const CARRY_LEFT = new Vector3(-0.26, 0, 0.1);
const CARRY_RIGHT = new Vector3(0.26, 0, -0.1);

export class Game {
  private mats!: MaterialLibrary;
  private envs!: Environments;
  private sky = new SkyDome();
  private director: CameraDirector;

  private roomSet = new Group();
  private fieldSet = new Group();
  private room!: TackRoom;
  private winter!: Winter;
  private strap!: Strap;
  private bells!: BellField;
  private horse!: Horse;
  private handler!: Handler;
  private sleigh!: Sleigh;
  private harness!: DrivingHarness;
  private puffs!: PuffField;
  private tracks!: TrackRibbon;
  private hud!: Hud;

  private audio = new AudioEngine();
  private bellBus = new BellBus(this.audio);
  private foley = new FoleyBus(this.audio);

  private phase: Phase = 'boot';
  private phaseTime = 0;
  private configIndex = 0;
  private tray: TrayBell[] = [];
  private carrying: TrayBell | null = null;
  private socketMarkers: Mesh[] = [];
  private shakeMittens: Group[] = [];
  private strikes: BellStrike[] = [];
  private hoofs: HoofEvent[] = [];
  private raycaster = new Raycaster();
  private benchPlane = new Plane(new Vector3(0, 1, 0), -(BENCH_TOP + 0.055));
  private shakeEnergy = 0;
  private shakeHands = [new Vector3(), new Vector3()];
  private strapCarry: Vector3 | null = null;
  private buckleProgress = 0;
  private buckleMesh!: Mesh;
  private targetRing!: Mesh;
  private stepsTaken = 0;
  private stepArmed = false;
  private sinceStep = 0;
  private rideDistance = 0;
  private closeUpTimer = 0;
  private breathTimer = 1.5;
  private idleTimer = 0;
  private audioUnlocked = false;
  private lastCamPos = new Vector3();
  private frameCount = 0;
  private strikeTotal = 0;
  private hoofTotal = 0;

  constructor(private app: App) {
    this.director = new CameraDirector(app.camera);
  }

  /** Read-only snapshot used by the screenshot harness. */
  debugState(): Record<string, unknown> {
    const m = new (this.basisScratch.constructor as new () => Matrix4)();
    const bellPositions: number[][] = [];
    const shell = (this.bells as unknown as { shellMesh: import('three').InstancedMesh }).shellMesh;
    for (let i = 0; i < this.bells.count; i++) {
      shell.getMatrixAt(i, m);
      const p = new Vector3().setFromMatrixPosition(m);
      bellPositions.push([+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)]);
    }
    const f = this.strap.frameAtParam(0.5, this.tmpFrame);
    return {
      phase: this.phase,
      shot: this.director.current,
      frames: this.frameCount,
      bells: this.bells.count,
      tray: this.tray.length,
      bellPositions,
      strapMid: [+f.pos.x.toFixed(4), +f.pos.y.toFixed(4), +f.pos.z.toFixed(4)],
      strapNodes: [0, 6, 12, 19, 25].map((i) =>
        this.strap.pos[i].toArray().map((n) => +n.toFixed(3)),
      ),
      horsePos: this.horse.group.position.toArray().map((n) => +n.toFixed(3)),
      sleighPos: this.sleigh.group.position.toArray().map((n) => +n.toFixed(3)),
      strapNormal: [+f.normal.x.toFixed(3), +f.normal.y.toFixed(3), +f.normal.z.toFixed(3)],
      camera: this.app.camera.position.toArray().map((n) => +n.toFixed(3)),
      trayScreen: this.tray.map((t) => {
        const p = this.screenOf(t.mesh.position);
        return [Math.round(p.x), Math.round(p.y)];
      }),
      socketScreen: SOCKETS.map((u) => {
        const f = this.strap.frameAtParam(u, this.tmpFrame);
        const p = this.screenOf(f.pos);
        return [Math.round(p.x), Math.round(p.y)];
      }),
      grabRadius: Math.round(this.grabRadius),
      audio: {
        ready: this.audio.ready,
        state: this.audio.ctx ? this.audio.ctx.state : 'none',
        muted: this.audio.isMuted,
        volume: this.audio.currentVolume,
        strikesLastFrame: this.strikes.length,
        bellBuffers: this.bellBus.buffersRendered,
        strikeTotal: this.strikeTotal,
        hoofTotal: this.hoofTotal,
      },
      shakeEnergy: +this.shakeEnergy.toFixed(2),
      phaseTime: +this.phaseTime.toFixed(2),
      buckle: +this.buckleProgress.toFixed(2),
      drive: +this.app.input.drive.toFixed(2),
      steps: this.stepsTaken,
      strapCarry: this.strapCarry ? this.screenOf(this.strapCarry).toArray().map(Math.round) : null,
      neckScreen: this.horse.isLoaded
        ? this.screenOf(this.neckAnchor(new Vector3())).toArray().map(Math.round)
        : null,
      carrying: this.carrying ? this.carrying.size : null,
      horseSpeed: +this.horse.speed.toFixed(3),
      rideDistance: +this.rideDistance.toFixed(2),
    };
  }

  // ------------------------------------------------------------- startup --

  async start(): Promise<void> {
    const app = this.app;
    this.mats = buildMaterials();
    this.envs = buildEnvironments(app.renderer);

    app.scene.add(this.roomSet, this.fieldSet);
    this.sky.addTo(app.scene);
    this.sky.mesh.visible = false;

    this.room = new TackRoom(this.mats);
    this.room.addTo(this.roomSet);

    this.winter = new Winter(this.mats, app.quality.settings);
    this.winter.addTo(this.fieldSet);
    this.fieldSet.visible = false;

    this.strap = new Strap(this.mats, STRAP_LEN, SOCKETS);
    this.strap.addTo(app.scene);

    this.bells = new BellField(this.mats, 16, app.quality.settings.heroBells);
    this.bells.addTo(app.scene);

    this.handler = new Handler(this.mats);
    this.handler.addTo(app.scene);
    this.handler.group.visible = false;

    this.sleigh = new Sleigh(this.mats);
    this.sleigh.addTo(app.scene);
    this.sleigh.group.visible = false;

    this.harness = new DrivingHarness(this.mats);
    this.puffs = new PuffField(this.mats, app.quality.settings.puffBudget);
    this.puffs.addTo(app.scene);
    this.tracks = new TrackRibbon(this.mats);
    this.fieldSet.add(this.tracks.mesh);

    this.buildSocketMarkers();
    this.buildShakeHands();
    this.buildBuckle();

    this.horse = new Horse(this.mats);
    this.horse.addTo(app.scene);
    await this.horse.load('assets/horse.glb');
    this.horse.group.position.copy(HORSE_POS);
    this.horse.group.rotation.y = HORSE_YAW;
    this.horse.root.add(this.harness.group);
    this.harness.setTracesVisible(false);

    this.hud = new Hud(document.getElementById('app') as HTMLElement);
    this.hud.onMuteChange = (m) => this.audio.setMuted(m);
    this.hud.onVolumeChange = (v) => this.audio.setVolume(v);
    this.hud.onChoice = (c) => this.replay(c);
    this.hud.onAnyInput = () => void this.unlockAudio();

    this.director.setReducedMotion(app.quality.reducedMotion);
    app.onResize(() => this.applyOrientation());
    app.quality.onChange((q) => {
      this.winter.applyQuality(q);
      this.bells.setHeroLimit(q.heroBells);
      this.puffs.setCapacity(q.puffBudget);
      this.room.setShadowSize(Math.min(1024, q.shadowSize));
      app.applyQuality();
    });
    this.applyOrientation();

    this.setSet('room');
    this.restore();
    // Settle the leather before the first shot is framed, so a camera that
    // rides the strap has a real strap to ride.
    for (let i = 0; i < 30; i++) this.strap.update(1 / 60);
    this.applyDebugHash();
    app.start((dt, elapsed) => this.frame(dt, elapsed));
  }

  /** `#fitting`, `#shake`, `#harness`, `#step`, `#ride`, `#arrival` for testing. */
  private applyDebugHash(): void {
    const h = location.hash.replace('#', '');
    if (!h) return;
    const jump = () => {
      switch (h) {
        case 'fitting':
          this.setPhase('fitting');
          this.director.play(this.shotFitting(), true);
          break;
        case 'fitheld':
          this.fillAllSockets();
          this.setPhase('boot');
          this.director.play(this.shotFitting(), true);
          break;
        case 'macro':
          this.fillAllSockets();
          this.setPhase('boot');
          this.director.play(
            {
              name: 'macro',
              eye: (out) => {
                const f = this.strap.frameAtParam(SOCKETS[2], this.tmpFrame);
                out.set(f.pos.x + 0.02, f.pos.y + 0.075, f.pos.z + 0.115);
              },
              target: (out) => {
                const f = this.strap.frameAtParam(SOCKETS[2], this.tmpFrame);
                out.set(f.pos.x, f.pos.y + 0.032, f.pos.z);
              },
              fov: 36,
              portraitFov: 46,
            },
            true,
          );
          break;
        case 'placed':
          this.fillAllSockets();
          this.setPhase('fitting');
          this.director.play(this.shotFitting(), true);
          break;
        case 'shake':
          this.fillAllSockets();
          this.setPhase('shake');
          this.prepareShake();
          this.director.play(this.shotShake(), true);
          break;
        case 'harness':
          this.fillAllSockets();
          this.setPhase('harness');
          this.prepareHarness();
          this.director.play(this.shotHarness(), true);
          break;
        case 'buckle':
          this.fillAllSockets();
          this.prepareHarness();
          this.wrapStrap();
          this.director.play(this.shotHarness(), true);
          break;
        case 'step':
          this.fillAllSockets();
          this.prepareHarness();
          this.wrapStrap();
          this.buckleProgress = 1;
          this.buckleMesh.visible = false;
          this.setPhase('firstStep');
          this.director.play(this.shotFirstStep(), true);
          break;
        case 'ride':
          this.fillAllSockets();
          this.prepareHarness();
          this.wrapStrap();
          this.rideDistance = RIDE_START;
          this.startRide('ride');
          break;
        case 'trees':
          this.fillAllSockets();
          this.prepareHarness();
          this.wrapStrap();
          this.rideDistance = 60;
          this.startRide('ride');
          break;
        case 'hill':
          this.fillAllSockets();
          this.prepareHarness();
          this.wrapStrap();
          this.rideDistance = 118;
          this.startRide('ride');
          break;
        case 'arrival':
          this.fillAllSockets();
          this.prepareHarness();
          this.wrapStrap();
          this.rideDistance = this.winter.routeLength - 24.5;
          this.startRide('ride');
          this.setPhase('arrival');
          this.director.play(this.shotArrival(), true);
          break;
        default:
          break;
      }
    };
    jump();
  }

  private fillAllSockets(): void {
    const sizes = CONFIGS[this.configIndex];
    const slots = CONFIG_SOCKETS[this.configIndex];
    for (let i = 0; i < slots.length; i++) {
      if (this.bells.hasSocket(slots[i])) continue;
      this.bells.add(sizes[i], slots[i], SOCKETS[slots[i]]);
    }
    for (const b of this.bells.bells) b.seat = 1;
    for (const t of this.tray) this.app.scene.remove(t.mesh);
    this.tray.length = 0;
  }

  private applyOrientation(): void {
    this.director.portrait = this.app.orientation === 'portrait';
    // Turning the device re-composes the bench but keeps every fitted bell.
    if (this.phase === 'intro' || this.phase === 'fitting') {
      this.layoutTray();
      this.layoutBenchStrap();
    }
  }

  private async unlockAudio(): Promise<void> {
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    await this.audio.ensure();
    if (!this.audio.ctx) return;
    this.foley.prepare();
    this.audio.setSpace(this.fieldSet.visible ? 'outdoor' : 'room');
    await this.bellBus.prepare();
  }

  // -------------------------------------------------------------- set-up --

  private buildSocketMarkers(): void {
    for (let i = 0; i < SOCKETS.length; i++) {
      const m = new Mesh(
        new RingGeometry(0.0135, 0.0185, 18),
        new MeshBasicMaterial({
          color: new Color(0xffe2ad),
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      m.renderOrder = 6;
      this.socketMarkers.push(m);
      this.app.scene.add(m);
    }
  }

  /** Two mittens at the strap's ends while it is being shaken. */
  private buildShakeHands(): void {
    for (let i = 0; i < 2; i++) {
      const g = new Group();
      const mitten = new Mesh(new SphereGeometry(0.055, 10, 8), this.mats.clothLight);
      mitten.scale.set(1, 1.25, 0.9);
      mitten.castShadow = true;
      g.add(mitten);
      const cuff = new Mesh(new CylinderGeometry(0.05, 0.058, 0.09, 8), this.mats.cloth);
      cuff.position.y = 0.085;
      g.add(cuff);
      const sleeve = new Mesh(new CylinderGeometry(0.048, 0.052, 0.22, 8), this.mats.cloth);
      sleeve.position.y = 0.23;
      sleeve.castShadow = true;
      g.add(sleeve);
      g.visible = false;
      this.shakeMittens.push(g);
      this.app.scene.add(g);
    }
  }

  private buildBuckle(): void {
    // A forged buckle frame with its tongue: square stock, not a ring.
    const buckle = new Group();
    const frame = new Mesh(new TorusGeometry(0.032, 0.007, 4, 4), this.mats.iron);
    frame.rotation.z = Math.PI / 4;
    frame.scale.set(1, 1.25, 1);
    buckle.add(frame);
    const tongue = new Mesh(new BoxGeometry(0.055, 0.006, 0.006), this.mats.iron);
    tongue.position.x = 0.012;
    buckle.add(tongue);
    this.buckleMesh = buckle as unknown as Mesh;
    this.buckleMesh.visible = false;
    this.app.scene.add(this.buckleMesh);

    // A soft dark patch on the neck, the size of the strap: a shadow to drop
    // the leather into, not a glowing marker.
    this.targetRing = new Mesh(
      new PlaneGeometry(0.62, 0.62),
      new MeshBasicMaterial({
        map: this.mats.tex.shadowBlob,
        color: new Color(0x0d1016),
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.targetRing.renderOrder = 6;
    this.app.scene.add(this.targetRing);
  }

  private setSet(which: 'room' | 'field'): void {
    const room = which === 'room';
    this.roomSet.visible = room;
    this.fieldSet.visible = !room;
    this.sky.mesh.visible = !room;
    this.app.scene.environment = room ? this.envs.room : this.envs.outdoor;
    this.app.scene.background = null;
    this.app.scene.fog = null;
    if (!room) this.winter.applyFog(this.app.scene);
    this.app.renderer.toneMappingExposure = room ? 0.92 : 0.82;
    if (this.audio.ready) this.audio.setSpace(room ? 'room' : 'outdoor');
  }

  // ------------------------------------------------------------ tray/bells --

  private loadConfig(index: number): void {
    this.configIndex = index % CONFIGS.length;
    for (const t of this.tray) this.app.scene.remove(t.mesh);
    this.tray.length = 0;
    this.bells.clear();
    this.carrying = null;

    const sizes = CONFIGS[this.configIndex];
    const n = sizes.length;
    for (let i = 0; i < n; i++) {
      const size = sizes[i];
      const mesh = makeLooseBell(this.mats, size);
      // Loose bells lie tipped over on the bench, mouth toward the player, so
      // the slit and the ball inside are readable before anything is fitted.
      mesh.rotation.set(1.15, (i % 2 === 0 ? 1 : -1) * 0.25, 0);
      this.app.scene.add(mesh);
      this.tray.push({ mesh, size, home: new Vector3(), carried: false });
    }
    this.layoutTray();
    this.layoutBenchStrap();
  }

  /**
   * The bench layout follows the shape of the screen.
   *
   * In landscape the strap lies across the bench; in portrait it runs away
   * from the player, up the tall frame. Bells are stored by socket index, so
   * turning the device re-lays the bench without losing a single fitting.
   */
  private layoutBenchStrap(): void {
    this.detachStrap();
    this.strap.clearPins();
    this.strap.ellipsoids.length = 0;
    this.strap.planes.length = 0;
    this.strap.planes.push({ y: BENCH_TOP });
    const y = BENCH_TOP + 0.0115;
    const portrait = this.app.orientation === 'portrait';
    const a = portrait
      ? new Vector3(0.05, y, 0.5)
      : new Vector3(-0.658, y, 0.06);
    const b = portrait ? new Vector3(-0.05, y, -0.79) : new Vector3(0.658, y, -0.08);
    this.strap.layout(a, b, 0);
    this.strap.pin(0, a);
    this.strap.pin(25, b);
    this.strap.setGuide(a, b, 0.55);
  }

  private layoutTray(): void {
    const portrait = this.app.orientation === 'portrait';
    const n = this.tray.length;
    for (let i = 0; i < n; i++) {
      const t = this.tray[i];
      const r = BELL_RADIUS[t.size];
      if (portrait) {
        // Two short columns at the near edge, always inside a narrow frame.
        const col = i % 2 === 0 ? -1 : 1;
        const row = Math.floor(i / 2);
        t.home.set(col * 0.15, BENCH_TOP + r * 0.52, 0.68 - row * 0.13);
      } else {
        const span = Math.min(0.94, n * 0.108);
        const x = n === 1 ? 0 : -span / 2 + (span / (n - 1)) * i;
        t.home.set(x, BENCH_TOP + r * 0.52, 0.46);
      }
      if (!t.carried) t.mesh.position.copy(t.home);
    }
  }

  // --------------------------------------------------------------- phases --

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseTime = 0;
    this.idleTimer = 0;
    this.hud.showHint('none');
    // The choice overlay covers the whole screen and takes pointer events;
    // leaving arrival must always take it back down.
    if (p !== 'arrival') this.hud.showChoices(false);
    this.persist();
  }

  private restore(): void {
    let saved: { config?: number } | null = null;
    try {
      const raw = sessionStorage.getItem('sbhr');
      if (raw) saved = JSON.parse(raw) as { config?: number };
    } catch {
      saved = null;
    }
    this.loadConfig(saved?.config ?? 0);
    this.setPhase('intro');
    this.director.play(this.shotIntro(), true);
  }

  private persist(): void {
    try {
      sessionStorage.setItem(
        'sbhr',
        JSON.stringify({
          config: this.configIndex,
          bells: this.bells.bells.map((b) => ({ s: b.size, k: b.socket })),
          phase: this.phase,
        }),
      );
    } catch {
      /* private mode: the run simply does not survive a reload */
    }
  }

  private replay(choice: ReplayChoice): void {
    void this.unlockAudio();
    this.hud.fade(1, 380);
    setTimeout(() => {
      if (choice === 'rebell') {
        this.setSet('room');
        this.loadConfig(this.configIndex + 1);
        this.horse.group.position.copy(HORSE_POS);
        this.horse.group.rotation.set(0, HORSE_YAW, 0);
        this.horse.speed = 0;
        this.harness.setTracesVisible(false);
        this.sleigh.group.visible = false;
        this.setPhase('fitting');
        this.director.play(this.shotFitting(), true);
      } else if (choice === 'walk') {
        this.rideDistance = RIDE_START;
        this.startRide('freeWalk');
      } else {
        this.rideDistance = RIDE_START;
        this.startRide('ride');
      }
      this.tracks.clear();
      this.puffs.clear();
      this.hud.fade(0, 520);
    }, 400);
  }

  // ---------------------------------------------------------------- frame --

  private frame(dt: number, elapsed: number): void {
    this.phaseTime += dt;
    this.frameCount++;
    const input = this.app.input;

    if ((input.frame.pressed || input.tapped) && !this.audioUnlocked) void this.unlockAudio();

    switch (this.phase) {
      case 'intro':
        this.updateIntro();
        break;
      case 'fitting':
        this.updateFitting(dt);
        break;
      case 'shake':
        this.updateShake(dt);
        break;
      case 'harness':
        this.updateHarness(dt);
        break;
      case 'buckle':
        this.updateBuckle(dt);
        break;
      case 'firstStep':
        this.updateFirstStep(dt);
        break;
      case 'ride':
      case 'freeWalk':
        this.updateRide(dt);
        break;
      case 'arrival':
        this.updateArrival(dt);
        break;
      default:
        break;
    }

    this.updateStrapAnchors();
    this.strap.update(dt);
    this.strap.resetDimples();
    for (const b of this.bells.bells) this.strap.setDimple(b.socket, b.seat * 0.85);
    this.strap.setSocketLoad(this.bells.loadsPerSocket(SOCKETS.length));

    this.strikes.length = 0;
    this.bells.update(dt, this.strap, this.strikes);
    this.playStrikes();

    this.room.update(dt);
    this.handler.update(dt);
    this.director.update(dt, elapsed);

    const camQ = new Quaternion();
    this.app.camera.getWorldQuaternion(camQ);
    this.puffs.update(dt, camQ);

    if (this.fieldSet.visible) {
      _v.copy(this.app.camera.position);
      this.winter.update(dt, _v, 0.25);
    }
    this.lastCamPos.copy(this.app.camera.position);
  }

  // ------------------------------------------------------------ scene one --

  private shotIntro(): Shot {
    return {
      name: 'intro',
      eye: (out, t) => {
        out.set(1.5 - t * 0.16, 1.86 - t * 0.06, 2.35 - t * 0.18);
      },
      target: (out) => {
        out.set(-0.05, 1.02, -0.35);
      },
      fov: 44,
      portraitFov: 58,
      portraitLift: 0.06,
      ease: 1.6,
      handheld: 0.6,
    };
  }

  private updateIntro(): void {
    // One loose bell rolls a few centimetres: the only motion in the room, and
    // the reason the eye goes to the bench before anything is explained.
    const t = this.phaseTime;
    const bell = this.tray[Math.floor(this.tray.length / 2)];
    if (bell && t < 2.2) {
      const k = Math.max(0, Math.min(1, (t - 0.55) / 1.1));
      const e = k * k * (3 - 2 * k);
      bell.mesh.position.x = bell.home.x - 0.055 * (1 - e);
      bell.mesh.rotation.z = -(1 - e) * 1.6;
      if (t > 0.55 && t < 1.7 && Math.random() < 0.05) {
        this.foley.leather(0.2, 0);
      }
    }
    if (this.phaseTime > 3.1 || this.app.input.frame.pressed) {
      this.setPhase('fitting');
      this.director.play(this.shotFitting());
    }
  }

  // ------------------------------------------------------------ scene two --

  private shotFitting(): Shot {
    return {
      name: 'fitting',
      eye: (out) => {
        if (this.app.orientation === 'portrait') out.set(0, 1.68, 1.36);
        else out.set(0, 1.44, 0.86);
      },
      target: (out) => {
        if (this.app.orientation === 'portrait') out.set(0, BENCH_TOP + 0.02, -0.16);
        else out.set(0, BENCH_TOP + 0.01, 0.05);
      },
      fov: 54,
      portraitFov: 51,
      ease: 1.1,
      handheld: 0.3,
    };
  }

  private pointerOnBench(out: Vector3): boolean {
    const ndc = this.app.input.frame.ndc;
    this.raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), this.app.camera);
    return this.raycaster.ray.intersectPlane(this.benchPlane, out) !== null;
  }

  private screenOf(p: Vector3): Vector2 {
    _screen.copy(p).project(this.app.camera);
    return new Vector2(
      ((_screen.x + 1) / 2) * window.innerWidth,
      ((-_screen.y + 1) / 2) * window.innerHeight,
    );
  }

  private get grabRadius(): number {
    // A four-year-old's aim: never smaller than a thumb tip.
    return Math.max(52, this.app.shortEdge * 0.13);
  }

  private updateFitting(dt: number): void {
    const input = this.app.input;
    const ptr = input.frame;

    if (ptr.pressed && !this.carrying) {
      let best: TrayBell | null = null;
      let bestD = this.grabRadius;
      for (const t of this.tray) {
        const s = this.screenOf(t.mesh.position);
        // Measured from where the finger landed, not from where it has since
        // travelled: a fast flick still picks up the bell it started on.
        const d = s.distanceTo(ptr.pressScreen);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (best) {
        this.carrying = best;
        best.carried = true;
        this.foley.leather(0.3, 0);
        this.idleTimer = 0;
      }
    }

    if (this.carrying) {
      if (this.pointerOnBench(_v)) {
        const lift = BELL_RADIUS[this.carrying.size] * 1.6 + 0.035;
        this.carrying.mesh.position.lerp(_v.setY(BENCH_TOP + 0.05 + lift), Math.min(1, dt * 18));
      }
      // Picking a bell up rights it: the shank turns down toward the strap.
      const k = Math.min(1, dt * 7);
      this.carrying.mesh.rotation.x += (Math.PI - this.carrying.mesh.rotation.x) * k;
      this.carrying.mesh.rotation.y *= 1 - k;
      this.carrying.mesh.rotation.z *= 1 - k;
      // The ball inside the carried bell answers to the hand carrying it.
      const ball = this.carrying.mesh.userData.ball as Mesh | undefined;
      if (ball) {
        ball.position.x = Math.sin(this.phaseTime * 13) * 0.16;
        ball.position.z = Math.cos(this.phaseTime * 9) * 0.12;
      }
      if (ptr.released) this.dropCarried();
    }

    // The empty sockets breathe just enough to be found without a caption.
    const pulse = 0.5 + 0.5 * Math.sin(this.phaseTime * 2.1);
    for (let i = 0; i < SOCKETS.length; i++) {
      const marker = this.socketMarkers[i];
      const taken = this.bells.hasSocket(i);
      const usable = CONFIG_SOCKETS[this.configIndex].includes(i);
      const f = this.strap.frameAtParam(SOCKETS[i], this.tmpFrame);
      marker.position.copy(f.pos).addScaledVector(f.normal, 0.004);
      marker.quaternion.setFromRotationMatrix(
        this.basisFrom(f.tangent, f.binormal, f.normal),
      );
      const want = taken || !usable ? 0 : this.carrying ? 0.3 + pulse * 0.22 : 0.1 + pulse * 0.12;
      const mat = marker.material as MeshBasicMaterial;
      mat.opacity += (want - mat.opacity) * Math.min(1, dt * 6);
      marker.visible = mat.opacity > 0.01;
    }

    // Done when the tray is empty - or, if a child has lost interest part way
    // through, when enough bells are on and nothing has been touched for a
    // while. There is no way to get stuck on this bench.
    const enough = this.bells.count >= 4 && this.idleTimer > 15;
    if (this.tray.length === 0 || enough) {
      if (this.phaseTime > 0.6) {
        this.setPhase('shake');
        this.director.play(this.shotShake());
        this.prepareShake();
      }
      return;
    }

    // After a few quiet seconds, a hand shows the drag once.
    this.idleTimer += dt;
    if (this.idleTimer > 3.4 && !this.carrying) {
      const s = this.screenOf(this.tray[0].mesh.position);
      this.hud.showHint('drag', { x: s.x, y: s.y });
    } else if (this.carrying || this.idleTimer < 0.2) {
      this.hud.showHint('none');
    }
  }

  private tmpFrame = {
    pos: new Vector3(),
    tangent: new Vector3(),
    normal: new Vector3(),
    binormal: new Vector3(),
  };

  private basisScratch = new Matrix4();

  private basisFrom(x: Vector3, y: Vector3, z: Vector3): Matrix4 {
    return this.basisScratch.makeBasis(x, y, z);
  }

  private dropCarried(): void {
    const carried = this.carrying;
    this.carrying = null;
    if (!carried) return;
    carried.carried = false;

    // The catch area is measured across the bench, ignoring how high the bell
    // is being held: a four-year-old aims at the hole, not at its altitude.
    let bestSocket = -1;
    let bestD = 0.135;
    for (let i = 0; i < SOCKETS.length; i++) {
      if (this.bells.hasSocket(i)) continue;
      if (!CONFIG_SOCKETS[this.configIndex].includes(i)) continue;
      const f = this.strap.frameAtParam(SOCKETS[i], this.tmpFrame);
      const dx = f.pos.x - carried.mesh.position.x;
      const dz = f.pos.z - carried.mesh.position.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD) {
        bestD = d;
        bestSocket = i;
      }
    }

    if (bestSocket >= 0) {
      this.bells.add(carried.size, bestSocket, SOCKETS[bestSocket]);
      this.app.scene.remove(carried.mesh);
      this.tray.splice(this.tray.indexOf(carried), 1);
      const f = this.strap.frameAtParam(SOCKETS[bestSocket], this.tmpFrame);
      const pan = this.panOf(f.pos);
      this.foley.seat(pan);
      this.foley.leather(0.5, pan, 0.02);
      this.bells.jolt(0.25);
      this.hud.showHint('none');
    } else {
      carried.mesh.position.copy(carried.home);
      carried.mesh.rotation.set(1.15, 0.25, 0);
      this.foley.leather(0.22, this.panOf(carried.home));
    }
  }

  // ---------------------------------------------------------- scene three --

  private shotShake(): Shot {
    return {
      name: 'shake',
      eye: (out) => {
        if (this.app.orientation === 'portrait') out.set(0, 1.62, 2.0);
        else out.set(0.05, 1.5, 1.32);
      },
      target: (out) => {
        if (this.app.orientation === 'portrait') out.set(0, 1.16, -0.02);
        else out.set(0, 1.2, 0.02);
      },
      fov: 50,
      portraitFov: 70,
      ease: 1.0,
      handheld: 0.4,
    };
  }

  private prepareShake(): void {
    this.detachStrap();
    this.strap.setGuide(null);
    this.shakeEnergy = 0;
    this.handOffset = 0;
    // Re-lay the leather between the two hands before lifting, so it never
    // has to snap across the bench from wherever it was fitted.
    const reach = this.shakeReach();
    const y = BENCH_TOP + 0.04;
    this.shakeHands[0].set(-reach, y, 0.05);
    this.shakeHands[1].set(reach, y, -0.05);
    const sag = Math.sqrt(Math.max(0, (STRAP_LEN / 2) ** 2 - reach ** 2)) * 0.85;
    this.strap.layout(this.shakeHands[0], this.shakeHands[1], sag);
    this.strap.pin(0, this.shakeHands[0]);
    this.strap.pin(25, this.shakeHands[1]);
    for (let i = 0; i < 20; i++) this.strap.update(1 / 60);
    this.handler.group.visible = false;
  }

  private shakeReach(): number {
    return this.app.orientation === 'portrait' ? 0.42 : 0.5;
  }

  private updateShake(dt: number): void {
    const input = this.app.input;
    const lift = Math.min(1, this.phaseTime / 1.4);
    const baseY = BENCH_TOP + 0.04 + lift * 0.56;
    const swing = new Vector2();
    input.takeDelta(swing);
    const px = (swing.x / Math.max(1, window.innerWidth)) * 2.4;

    // A narrower hold in portrait, where the frame has no width to spare;
    // the strap simply hangs deeper, which reads well either way.
    const reach = this.shakeReach();
    this.shakeHands[0].set(-reach, baseY, 0.05);
    this.shakeHands[1].set(reach, baseY, -0.05);
    this.handOffset += px;
    this.handOffset *= 1 - Math.min(1, dt * 3.2);
    this.handOffset = Math.max(-0.34, Math.min(0.34, this.handOffset));
    this.shakeHands[0].x += this.handOffset;
    this.shakeHands[1].x += this.handOffset;
    this.shakeHands[0].z += this.handOffset * 0.35;
    this.shakeHands[1].z -= this.handOffset * 0.35;

    this.strap.pin(0, this.shakeHands[0]);
    this.strap.pin(25, this.shakeHands[1]);

    // Any wiggle counts, in any direction: a small child shakes a strap the
    // way a small child shakes a strap.
    this.shakeEnergy += (Math.abs(px) + Math.abs(swing.y) / Math.max(1, window.innerHeight)) * 2.6;
    this.shakeEnergy *= 1 - Math.min(1, dt * 0.16);

    this.idleTimer += dt;
    if (this.idleTimer > 2.0 && this.shakeEnergy < 0.5) this.hud.showHint('shake');
    else this.hud.showHint('none');

    if (this.shakeEnergy > 1.7 && this.phaseTime > 2.2) {
      for (const m of this.shakeMittens) m.visible = false;
      this.setPhase('harness');
      this.director.play(this.shotHarness());
      this.prepareHarness();
    }
  }

  private handOffset = 0;

  // ----------------------------------------------------------- scene four --

  private shotHarness(): Shot {
    return {
      name: 'harness',
      eye: (out) => {
        out.set(-1.55, 1.42, 0.62);
      },
      target: (out) => {
        out.set(0.28, 1.24, -1.6);
      },
      fov: 46,
      portraitFov: 62,
      portraitLift: 0.1,
      ease: 1.4,
      handheld: 0.5,
    };
  }

  private neckAnchor(out: Vector3): Vector3 {
    if (this.horse.isLoaded) return this.horseLocalToWorld(NECK_CENTRE, out);
    return out.copy(HORSE_POS).add(new Vector3(-0.78, 1.4, 0));
  }

  private prepareHarness(): void {
    this.detachStrap();
    this.strap.setGuide(null);
    this.handler.group.visible = true;
    this.handler.setPose('stand');
    // Beyond the horse, at its head: present and doing the work, but never
    // between the child's eye and the animal.
    // At the horse's head, on the far side: leading the animal, in shot, and
    // never between the child's eye and the strap.
    this.neckAnchor(_v);
    this.handler.group.position.set(_v.x - 0.62, 0, _v.z - 0.8);
    this.handler.group.rotation.y = Math.atan2(0.62, 0.8);
    // The adult holds the finished strap up beside the horse; the child only
    // has to move it onto the animal.
    this.neckAnchor(_v);
    this.strapCarry = new Vector3(_v.x - 0.5, 1.3, _v.z + 0.5);
    this.layoutCarriedStrap();
    this.harness.setTracesVisible(false);
  }

  private layoutCarriedStrap(): void {
    if (!this.strapCarry) return;
    const a = _anchorA.copy(this.strapCarry).add(CARRY_LEFT);
    const b = _anchorB.copy(this.strapCarry).add(CARRY_RIGHT);
    const sag = Math.sqrt(Math.max(0, (STRAP_LEN / 2) ** 2 - (a.distanceTo(b) / 2) ** 2)) * 0.85;
    this.strap.planes.length = 0;
    this.strap.layout(a, b, sag);
    this.strap.pin(0, a);
    this.strap.pin(25, b);
    for (let i = 0; i < 25; i++) this.strap.update(1 / 60);
    // No disembodied hands here: the adult is in shot, holding it.
    for (const m of this.shakeMittens) m.visible = false;
  }

  private updateHarness(dt: number): void {
    const input = this.app.input;
    this.neckAnchor(_v);
    // The target is a soft dark ellipse on the neck, not a glowing ring.
    // Sit the patch just proud of the coat, on the camera's side of the neck.
    _v2.copy(this.app.camera.position).sub(_v).normalize();
    this.targetRing.position.copy(_v).addScaledVector(_v2, 0.3);
    this.targetRing.position.y -= 0.04;
    this.targetRing.lookAt(this.app.camera.position);
    const tmat = this.targetRing.material as MeshBasicMaterial;
    const near = this.strapCarry ? this.strapCarry.distanceTo(_v) : 9;
    const pulse = 0.5 + 0.5 * Math.sin(this.phaseTime * 1.8);
    tmat.opacity +=
      (Math.max(0.3, 0.72 - near * 0.35) * (0.75 + pulse * 0.25) - tmat.opacity) *
      Math.min(1, dt * 5);

    if (this.strapCarry) {
      if (input.frame.down && this.pointerOnHarnessPlane(_v2)) {
        this.strapCarry.lerp(_v2, Math.min(1, dt * 12));
        this.idleTimer = 0;
        this.hud.showHint('none');
      } else {
        this.idleTimer += dt;
        if (this.idleTimer > 2.6) {
          const s = this.screenOf(this.strapCarry);
          this.hud.showHint('drag', { x: s.x, y: s.y });
        }
      }
      this.strap.pin(0, _anchorA.copy(this.strapCarry).add(CARRY_LEFT));
      this.strap.pin(25, _anchorB.copy(this.strapCarry).add(CARRY_RIGHT));
      this.handler.reachTo(this.strapCarry, 0.65);

      if (input.frame.released && this.strapCarry.distanceTo(this.neckAnchor(_v)) < 0.42) {
        this.wrapStrap();
      }
    }
  }

  private pointerOnHarnessPlane(out: Vector3): boolean {
    const ndc = this.app.input.frame.ndc;
    this.raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), this.app.camera);
    // a vertical plane through the horse's neck, facing the camera
    this.neckAnchor(_v);
    const n = new Vector3().subVectors(this.app.camera.position, _v).setY(0).normalize();
    const plane = new Plane().setFromNormalAndCoplanarPoint(n, _v);
    return this.raycaster.ray.intersectPlane(plane, out) !== null;
  }

  /**
   * Lay the leather straight onto the chest in its finished shape, then let
   * the solver settle it. Without this the strap has to swing into place from
   * wherever it was, and for a few frames it reads as a rope flung forward.
   */
  private attachTargets: Vector3[] = Array.from({ length: 26 }, () => new Vector3());
  private attachStiff: number[] = [];
  private attachLocal: Vector3[] = [];

  /** The loop's rest path, in the horse's own space. */
  private buildLoopPath(): void {
    if (this.attachLocal.length) return;
    for (let i = 0; i < 26; i++) {
      const a = Math.PI / 2 + (i / 25) * Math.PI * 2;
      const p = new Vector3()
        .copy(NECK_CENTRE)
        .addScaledVector(NECK_E1, Math.cos(a) * NECK_R1)
        .addScaledVector(NECK_E2, Math.sin(a) * NECK_R2);
      this.attachLocal.push(p);
      // Snug at the crest where the buckle holds it; loose at the throat,
      // which is exactly where the bells hang and where the swing must show.
      const throat = (1 - Math.sin(a)) * 0.5; // 0 at crest, 1 at throat
      this.attachStiff.push(0.34 - throat * 0.29);
    }
  }

  private updateLoopTargets(): void {
    this.buildLoopPath();
    for (let i = 0; i < 26; i++) {
      this.horseLocalToWorld(this.attachLocal[i], this.attachTargets[i]);
    }
    this.strap.setAttach(this.attachTargets, this.attachStiff);
  }

  private settleStrapOnNeck(): void {
    // The anchors are read off live bone transforms, so the graph has to be
    // current before any of them is asked where it is.
    this.app.scene.updateMatrixWorld(true);
    const local = new Vector3();
    for (let i = 0; i < 26; i++) {
      // A full turn starting and ending at the buckle on the crest.
      const a = Math.PI / 2 + (i / 25) * Math.PI * 2;
      local
        .copy(NECK_CENTRE)
        .addScaledVector(NECK_E1, Math.cos(a) * NECK_R1)
        .addScaledVector(NECK_E2, Math.sin(a) * NECK_R2);
      this.horseLocalToWorld(local, _v);
      this.strap.pos[i].copy(_v);
      this.strap.prev[i].copy(_v);
      this.strap.accel[i].set(0, 0, 0);
    }
    this.updateStrapAnchors(true);
    for (let i = 0; i < 45; i++) this.strap.update(1 / 60);
  }

  private detachStrap(): void {
    this.strap.setAttach(null);
  }

  private wrapStrap(): void {
    this.strapCarry = null;
    for (const m of this.shakeMittens) m.visible = false;
    this.foley.leather(0.85, 0);
    this.strap.clearPins();
    this.strap.ellipsoids.length = 0;
    // The chest is the collider the leather has to lie on: this is what makes
    // the strap sit on the animal instead of through it.
    this.strap.ellipsoids.push({ c: new Vector3(), r: NECK_RADII.clone() });
    this.strap.ellipsoids.push({ c: new Vector3(), r: CHEST_RADII.clone() });
    this.settleStrapOnNeck();
    this.setPhase('buckle');
    this.buckleProgress = 0;
    this.buckleMesh.visible = true;
    (this.targetRing.material as MeshBasicMaterial).opacity = 0;
  }

  // ------------------------------------------------------- buckle closing --

  private updateBuckle(dt: number): void {
    const input = this.app.input;
    const f0 = this.strap.frameAtParam(0.02, this.tmpFrame);
    const a = f0.pos.clone();
    const f1 = this.strap.frameAtParam(0.98, this.tmpFrame);
    const b = f1.pos.clone();
    const p = a.clone().lerp(b, this.buckleProgress);
    this.buckleMesh.position.copy(p);
    this.buckleMesh.lookAt(this.app.camera.position);
    this.buckleMesh.scale.setScalar(1.4);

    if (input.frame.down) {
      const d = new Vector2();
      input.takeDelta(d);
      const gain = 1 / Math.max(120, this.app.shortEdge * 0.55);
      this.buckleProgress = Math.max(0, Math.min(1, this.buckleProgress + Math.abs(d.x) * gain));
      this.idleTimer = 0;
      this.hud.showHint('none');
      if (this.buckleProgress > 0.02 && Math.random() < 0.08) this.foley.leather(0.3, 0);
    } else {
      this.idleTimer += dt;
      if (this.idleTimer > 2.2 && this.buckleProgress < 0.9) {
        const s = this.screenOf(p);
        this.hud.showHint('buckle', { x: s.x, y: s.y });
      }
      // Letting go part-way is safe: it eases back a little, never resets.
      this.buckleProgress = Math.max(0, this.buckleProgress - dt * 0.12);
    }

    if (this.buckleProgress >= 0.995) {
      this.foley.buckle(0);
      this.bells.jolt(0.4);
      this.buckleMesh.visible = false;
      this.stepsTaken = 0;
      this.sinceStep = 0;
      this.setPhase('firstStep');
      this.director.play(this.shotFirstStep());
    }
  }

  // ----------------------------------------------------------- scene five --

  private shotFirstStep(): Shot {
    // Low, close, three-quarter on the chest: the shoulder, the strap and the
    // near foreleg are all in the same frame as the hoof that lands.
    return {
      name: 'firstStep',
      eye: (out) => {
        this.chestPoint(_v);
        const yaw = this.horse.group.rotation.y;
        // low, close, three-quarter front: shoulder, strap and near foreleg
        out.set(
          _v.x + Math.sin(yaw) * 1.86 + Math.cos(yaw) * 1.5,
          _v.y - 0.52,
          _v.z + Math.cos(yaw) * 1.86 - Math.sin(yaw) * 1.5,
        );
        // Keep the lens inside the room whatever the horse does.
        out.x = Math.max(out.x, -2.65);
        out.z = Math.min(out.z, 1.15);
      },
      target: (out) => {
        this.chestPoint(_v);
        out.set(_v.x, _v.y - 0.3, _v.z);
      },
      fov: 46,
      portraitFov: 62,
      portraitLift: 0.04,
      ease: 1.2,
      handheld: 0.7,
    };
  }

  /** Where the bells actually hang: the front of the neck loop. */
  private chestPoint(out: Vector3): Vector3 {
    if (this.horse.isLoaded) return this.horseLocalToWorld(BELL_FOCUS, out);
    return out.copy(this.horse.group.position).add(new Vector3(-0.8, 1.25, 0));
  }

  private updateFirstStep(dt: number): void {
    const input = this.app.input;
    // Exactly one stride per gesture, whatever the swipe looked like: the
    // step is committed when the finger lifts, never while it is still down.
    if (input.frame.down && input.driveStep > 0) this.stepArmed = true;
    if ((input.singleStep || (input.frame.released && this.stepArmed)) && !this.horse.stepping) {
      this.stepArmed = false;
      if (this.horse.speed < 0.25) {
        this.horse.requestStep();
        this.stepsTaken++;
        this.sinceStep = 0;
        this.hud.showHint('none');
        this.idleTimer = 0;
      }
    }
    if (!input.frame.down) this.stepArmed = false;
    this.sinceStep += dt;

    this.hoofs.length = 0;
    const moved = this.horse.update(dt, 0, this.hoofs);
    if (moved > 0) {
      // The horse steps toward the open door, but never so far that the
      // camera would have to follow it through a wall.
      this.horse.group.position.x = Math.max(HORSE_POS.x - 1.15, this.horse.group.position.x - moved);
    }
    this.emitHoofFeedback();

    this.idleTimer += dt;
    if (this.idleTimer > 3 && !this.horse.stepping) this.hud.showHint('swipe');

    // Stay on this shot long enough for the ringing to finish, then leave.
    if (this.stepsTaken >= 2 && this.horse.speed < 0.05 && this.sinceStep > 3.2) {
      this.setPhase('toField');
      this.hud.fade(1, 700);
      setTimeout(() => {
        this.rideDistance = RIDE_START;
        this.startRide('ride');
        this.hud.fade(0, 900);
      }, 780);
    }
  }

  // ------------------------------------------------------------ scene six --

  private startRide(phase: 'ride' | 'freeWalk'): void {
    this.setSet('field');
    this.setPhase(phase);
    this.horse.speed = 0;
    this.sleigh.group.visible = true;
    this.harness.setTracesVisible(true);
    this.handler.group.visible = true;
    this.handler.setPose('sit');
    this.placeOnRoute(this.rideDistance);
    this.app.scene.updateMatrixWorld(true);
    this.director.play(this.shotRideSide(), true);
    this.strap.ellipsoids.length = 0;
    this.strap.ellipsoids.push({ c: new Vector3(), r: NECK_RADII.clone() });
    this.strap.ellipsoids.push({ c: new Vector3(), r: CHEST_RADII.clone() });
    this.settleStrapOnNeck();
  }

  private placeOnRoute(distance: number): void {
    const len = this.winter.routeLength;
    const t = Math.max(0, Math.min(1, distance / len));
    const p = this.winter.route.getPointAt(t, _v);
    const tan = this.winter.route.getTangentAt(t, _v2);
    // The road is dished 6 cm below the spline; the hooves belong on the road.
    this.horse.group.position.set(p.x, p.y - 0.05, p.z);
    this.horse.group.rotation.y = Math.atan2(tan.x, tan.z);

    // The shafts reach the girth, so the sleigh rides a fixed distance back
    // along the same spline: no wandering, no jack-knifing.
    const back = Math.max(0, distance - SLEIGH_TRAIL) / len;
    const sp = this.winter.route.getPointAt(Math.max(0, Math.min(1, back)), new Vector3());
    const st = this.winter.route.getTangentAt(Math.max(0, Math.min(1, back)), new Vector3());
    this.sleigh.group.position.set(sp.x, sp.y - 0.05, sp.z);
    this.sleigh.group.rotation.y = Math.atan2(st.x, st.z) - Math.PI / 2;
    // pitch the body with the slope, so the hill is felt and not just seen
    this.sleigh.body.rotation.z = Math.max(-0.2, Math.min(0.2, -st.y * 1.1));

    if (this.handler.group.visible) {
      this.sleigh.seatAnchor.getWorldPosition(_v);
      // The figure's origin is at its feet; seated, its hips sit 0.84 m above
      // that, so the box has to be met from below.
      this.handler.group.position.set(_v.x, _v.y - 0.84, _v.z);
      this.handler.group.rotation.y = Math.atan2(st.x, st.z);
      this.handler.reachTo(null, 0.5);
    }
  }

  private updateRide(dt: number): void {
    const input = this.app.input;
    const free = this.phase === 'freeWalk';

    // Three speed bands and nothing between them: a fast flick asks for a
    // trot, never a bolt.
    const bands = [0, 1.15, 1.9, 3.25];
    const target = bands[input.driveStep];

    this.hoofs.length = 0;
    const moved = this.horse.update(dt, target, this.hoofs);
    this.rideDistance += moved;
    const end = this.winter.routeLength - 24;
    if (!free && this.rideDistance > end) this.rideDistance = end;
    if (free && this.rideDistance > end) this.rideDistance = RIDE_START;
    this.placeOnRoute(this.rideDistance);

    this.emitHoofFeedback();
    this.updateSleighFeel(dt);

    // A tap anywhere goes to the bells for a moment, then comes back.
    if (input.tapped && this.closeUpTimer <= 0) this.closeUpTimer = 2.6;
    if (this.closeUpTimer > 0) {
      this.closeUpTimer -= dt;
      this.director.play(this.shotChestCloseUp());
    } else {
      this.director.play(this.rideShotFor(this.rideDistance));
    }

    if (input.driveStep === 0 && this.horse.speed < 0.05) {
      this.idleTimer += dt;
      if (this.idleTimer > 2.6) this.hud.showHint('swipe');
    } else {
      this.idleTimer = 0;
      this.hud.showHint('none');
    }

    if (!free && this.rideDistance >= end - 0.5 && this.horse.speed < 0.35) {
      this.setPhase('arrival');
      this.director.play(this.shotArrival());
    }
  }

  private rideShotFor(d: number): Shot {
    // A tall frame gets the depth composition throughout: horse low, road and
    // destination running up the screen. A wide frame gets the authored beats.
    const portrait = this.app.orientation === 'portrait';
    if (d >= BEATS.hillTop - 12 && d < BEATS.hillFoot) return this.shotHillWide();
    if (portrait) return this.shotRideDepth();
    if (d < BEATS.hillTop - 12) return this.shotRideSide();
    if (d < BEATS.village - 8) return this.shotRideRear();
    return this.shotArrivalApproach();
  }

  /** Portrait: over and behind the rig, looking up the road it is taking. */
  private shotRideDepth(): Shot {
    return {
      name: 'rideDepth',
      eye: (out) => {
        const h = this.horse.group;
        const yaw = h.rotation.y;
        out.set(
          h.position.x - Math.sin(yaw) * 6.6 + Math.cos(yaw) * 0.55,
          h.position.y + 2.5,
          h.position.z - Math.cos(yaw) * 6.6 - Math.sin(yaw) * 0.55,
        );
      },
      target: (out) => {
        const h = this.horse.group;
        const yaw = h.rotation.y;
        out.set(
          h.position.x + Math.sin(yaw) * 8,
          h.position.y + 2.0,
          h.position.z + Math.cos(yaw) * 8,
        );
      },
      fov: 48,
      portraitFov: 58,
      ease: 1.2,
      handheld: 0.8,
    };
  }

  private shotRideSide(): Shot {
    return {
      name: 'rideSide',
      eye: (out) => {
        const h = this.horse.group;
        const yaw = h.rotation.y;
        out.set(
          h.position.x + Math.cos(yaw) * 3.8 + Math.sin(yaw) * 0.2,
          h.position.y + 1.15,
          h.position.z - Math.sin(yaw) * 3.8 + Math.cos(yaw) * 0.2,
        );
      },
      target: (out) => {
        const h = this.horse.group;
        const yaw = h.rotation.y;
        out.set(
          h.position.x - Math.sin(yaw) * 0.35,
          h.position.y + 1.2,
          h.position.z - Math.cos(yaw) * 0.35,
        );
      },
      fov: 46,
      portraitFov: 62,
      portraitLift: 0.28,
      ease: 0.9,
      handheld: 0.9,
    };
  }

  private shotRideRear(): Shot {
    return {
      name: 'rideRear',
      eye: (out) => {
        const h = this.horse.group;
        const yaw = h.rotation.y;
        out.set(
          h.position.x - Math.sin(yaw) * 8.6 + Math.cos(yaw) * 1.5,
          h.position.y + 2.6,
          h.position.z - Math.cos(yaw) * 8.6 - Math.sin(yaw) * 1.5,
        );
      },
      target: (out) => {
        const h = this.horse.group;
        const yaw = h.rotation.y;
        out.set(
          h.position.x + Math.sin(yaw) * 3.2,
          h.position.y + 1.35,
          h.position.z + Math.cos(yaw) * 3.2,
        );
      },
      fov: 45,
      portraitFov: 60,
      portraitLift: 0.5,
      ease: 1.1,
      handheld: 0.7,
    };
  }

  private shotHillWide(): Shot {
    return {
      name: 'hillWide',
      // Down the road ahead, looking back up the slope: the rig is read
      // against the sky and no roadside tree can cut across it.
      eye: (out) => {
        const t = Math.min(1, (this.rideDistance + 11) / this.winter.routeLength);
        this.winter.route.getPointAt(t, out);
        const tan = this.winter.route.getTangentAt(t, _v2);
        out.x += -tan.z * 2.4;
        out.z += tan.x * 2.4;
        out.y += 2.05;
      },
      target: (out) => {
        const h = this.horse.group;
        out.set(h.position.x, h.position.y + 1.5, h.position.z);
      },
      fov: 50,
      portraitFov: 66,
      portraitLift: 0.35,
      ease: 1.6,
      handheld: 0.5,
    };
  }

  private shotChestCloseUp(): Shot {
    return {
      name: 'chestClose',
      eye: (out) => {
        this.chestPoint(_v);
        const yaw = this.horse.group.rotation.y;
        out.set(
          _v.x + Math.cos(yaw) * 1.5 + Math.sin(yaw) * 1.05,
          _v.y - 0.16,
          _v.z - Math.sin(yaw) * 1.5 + Math.cos(yaw) * 1.05,
        );
      },
      target: (out) => {
        this.chestPoint(_v);
        out.set(_v.x, _v.y - 0.02, _v.z);
      },
      fov: 40,
      portraitFov: 52,
      ease: 0.75,
      handheld: 1.1,
    };
  }

  private shotArrivalApproach(): Shot {
    return {
      name: 'arriveApproach',
      eye: (out) => {
        const h = this.horse.group;
        const yaw = h.rotation.y;
        out.set(
          h.position.x - Math.sin(yaw) * 11 + Math.cos(yaw) * 5.2,
          h.position.y + 3.1,
          h.position.z - Math.cos(yaw) * 11 - Math.sin(yaw) * 5.2,
        );
      },
      target: (out) => {
        const h = this.horse.group;
        const yaw = h.rotation.y;
        out.set(
          h.position.x + Math.sin(yaw) * 12,
          h.position.y + 2.2,
          h.position.z + Math.cos(yaw) * 12,
        );
      },
      fov: 50,
      portraitFov: 66,
      portraitLift: 0.9,
      ease: 1.8,
      handheld: 0.4,
    };
  }

  private shotArrival(): Shot {
    return {
      name: 'arrival',
      eye: (out) => {
        const h = this.horse.group;
        const yaw = h.rotation.y;
        // Beside and a little behind, so the lit windows sit beyond the rig
        // rather than around the camera.
        out.set(
          h.position.x + Math.cos(yaw) * 7.4 - Math.sin(yaw) * 7.2,
          h.position.y + 2.4,
          h.position.z - Math.sin(yaw) * 7.4 - Math.cos(yaw) * 7.2,
        );
      },
      target: (out) => {
        const h = this.horse.group;
        const yaw = h.rotation.y;
        out.set(
          h.position.x + Math.sin(yaw) * 4.5,
          h.position.y + 1.9,
          h.position.z + Math.cos(yaw) * 4.5,
        );
      },
      fov: 52,
      portraitFov: 68,
      portraitLift: 0.8,
      ease: 2.2,
      handheld: 0.3,
    };
  }

  private updateArrival(dt: number): void {
    this.hoofs.length = 0;
    this.horse.update(dt, 0, this.hoofs);
    this.emitHoofFeedback();
    this.updateSleighFeel(dt);
    if (this.phaseTime > 2.6) this.hud.showChoices(true);
  }

  // --------------------------------------------------------- shared logic --

  private updateStrapAnchors(force = false): void {
    const attached =
      this.phase === 'buckle' ||
      this.phase === 'firstStep' ||
      this.phase === 'toField' ||
      this.phase === 'ride' ||
      this.phase === 'freeWalk' ||
      this.phase === 'arrival';
    if (!attached && !force) return;

    // A neck strap: both ends buckled together at the crest, the loop resting
    // on the neck and shoulders. The anchor rides the neck bone, so the
    // leather is always a beat behind the stride.
    const neck = this.horse.bone('spine_5');
    if (!neck) return;

    if (this.strap.ellipsoids[0]) {
      this.horseLocalToWorld(NECK_CENTRE, this.strap.ellipsoids[0].c);
    }
    if (this.strap.ellipsoids[1]) {
      this.horseLocalToWorld(CHEST_CENTRE, this.strap.ellipsoids[1].c);
    }

    this.updateLoopTargets();
    this.horseLocalToWorld(BUCKLE_LOCAL, _anchorA);
    this.strap.pin(0, _anchorB.copy(_anchorA).addScaledVector(_v.set(1, 0, 0), 0.012));
    this.strap.pin(25, _anchorC.copy(_anchorA).addScaledVector(_v.set(1, 0, 0), -0.012));
    this.strap.setGravity(9.81);

    // traces from the collar back to the shafts, redrawn every frame so they
    // stay taut whatever the horse is doing
    if (this.harness.traceLeft.visible) {
      const mk = (sx: number, y: number, z: number, out: Vector3): Vector3 =>
        this.horseLocalToWorld(_traceLocal.set(sx, y, z), out);
      this.harness.linkTraces(
        mk(-0.29, 0.98, 0.44, _anchorA).clone(),
        mk(-0.4, 0.72, -1.62, _anchorB).clone(),
        mk(0.29, 0.98, 0.44, _anchorA).clone(),
        mk(0.4, 0.72, -1.62, _anchorB).clone(),
      );
    }
  }

  /** Horse-local point to world, honouring the current stance and heading. */
  private horseLocalToWorld(local: Vector3, out: Vector3): Vector3 {
    out.copy(local);
    this.horse.root.localToWorld(out);
    return out;
  }

  private panOf(p: Vector3): number {
    _v.copy(p).project(this.app.camera);
    return Math.max(-1, Math.min(1, _v.x * 0.8));
  }

  private playStrikes(): void {
    this.strikeTotal += this.strikes.length;
    if (!this.audio.ready) return;
    // Tens of milliseconds of spread by index and size, so a stride never
    // lands as one chord; the spread tightens as the gait quickens.
    const tilt = Math.max(0, Math.min(1, (this.horse.speed - 1.4) / 1.9));
    for (const s of this.strikes) {
      const stagger =
        ((s.index % 5) * 0.006 + Math.random() * 0.016 + s.size * 0.004) * (1 - tilt * 0.45);
      this.bellBus.strike(s.size, s.intensity, s.detune, this.panOf(s.pos), stagger, tilt);
    }
  }

  private emitHoofFeedback(): void {
    const outdoors = this.fieldSet.visible;
    const ground: Ground = outdoors ? 'snow' : 'wood';
    const yaw = this.horse.group.rotation.y;
    const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.hoofTotal += this.hoofs.length;
    for (const h of this.hoofs) {
      this.foley.hoof(ground, h.weight, this.panOf(h.world));
      if (outdoors) {
        const at = h.world.clone();
        at.y = this.horse.group.position.y + 0.02;
        this.puffs.hoofSpray(at, fwd, h.weight, this.horse.speed);
        this.tracks.stamp(at, fwd, 0.22, 0.3);
      }
      // The leather answers the shoulder, a beat behind the hoof.
      if (h.weight > 0.45) this.foley.leather(h.weight * 0.4, this.panOf(h.world), 0.03);
    }
  }

  private updateSleighFeel(dt: number): void {
    const speed = this.horse.speed;
    const norm = Math.min(1, speed / 3.4);
    this.foley.setRunner(norm, this.fieldSet.visible ? 1 : 0);
    this.foley.setWind(this.fieldSet.visible ? 0.55 : 0.12);

    if (this.fieldSet.visible && speed > 0.15) {
      const yaw = this.sleigh.group.rotation.y + Math.PI / 2;
      const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      for (const side of [-1, 1]) {
        const p = this.sleigh.group.position
          .clone()
          .add(new Vector3(Math.cos(yaw) * side * 0.44, 0.02, -Math.sin(yaw) * side * 0.44));
        this.tracks.stamp(p, fwd, 0.16, 0.5);
      }
      if (Math.random() < norm * dt * 6) {
        const p = this.sleigh.group.position.clone().add(new Vector3(0, 0.06, 0));
        this.puffs.spawn(
          p,
          new Vector3((Math.random() - 0.5) * 0.6, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.6),
          0.1,
          0.6,
          0.25,
        );
      }
      if (Math.random() < dt * 0.5) this.foley.sleighCreak(0.4 + norm * 0.4, 0);
    }

    // Breath: paced by effort, with vapour only where the air is cold.
    this.breathTimer -= dt * (0.55 + norm * 0.9);
    if (this.breathTimer <= 0) {
      this.breathTimer = 1.5 + Math.random() * 0.7;
      this.horse.nosePosition(_v);
      const yaw = this.horse.group.rotation.y;
      const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      this.foley.breath(0.25 + norm * 0.7, this.panOf(_v));
      if (this.fieldSet.visible) this.puffs.breath(_v, fwd, norm);
    }
  }
}
