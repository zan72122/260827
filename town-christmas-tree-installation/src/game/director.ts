import * as THREE from 'three';
import { Rng, hashSeed } from '../core/rng';
import { AudioKit } from '../core/audio';
import { clamp, damp } from '../core/input';
import type { QualitySettings } from '../core/quality';
import { Materials } from '../world/materials';
import { Town } from '../world/town';
import { ConiferTree } from '../world/tree';
import { MobileCrane } from '../world/crane';
import { TreeTransport } from '../world/trailer';
import { Mewp } from '../world/mewp';
import { Rigging } from '../world/rigging';
import { GuyWires, TopStar, TreeLights, buildGifts } from '../world/lights';
import { Crowd, Person } from '../world/people';
import { SkyDome, Snowfall } from '../world/weather';
import { CameraRig, fitShot } from './camera';
import { Inertial, Spring } from './geom';
import { Hud } from '../ui/hud';

export type Stage =
  | 'arrive'
  | 'outriggers'
  | 'rigging'
  | 'lift'
  | 'settle'
  | 'lower'
  | 'guys'
  | 'wrap'
  | 'star'
  | 'illuminate'
  | 'finale';

const STAGE_STEP: Record<Stage, number> = {
  arrive: 0,
  outriggers: 1,
  rigging: 2,
  lift: 3,
  settle: 3,
  lower: 4,
  guys: 5,
  wrap: 6,
  star: 6,
  illuminate: 7,
  finale: 7,
};

const STAGE_TITLE: Record<Stage, [string, string]> = {
  arrive: ['🚚', 'おおきな木が きたよ'],
  outriggers: ['🦿', 'クレーンの あしを ひろげよう'],
  rigging: ['🪢', 'みきに ベルトを かけよう'],
  lift: ['🏗️', 'ゆっくり おこそう'],
  settle: ['🏗️', 'まんなかへ はこぶよ'],
  lower: ['🕳️', 'あなに おろそう'],
  guys: ['🔄', 'ワイヤーを ぴんと はろう'],
  wrap: ['💡', 'ひかりを まきつけよう'],
  star: ['⭐', 'てっぺんに ほしを'],
  illuminate: ['🎉', 'まちに あかりを つけよう'],
  finale: ['🎄', 'できあがり！'],
};

const TRAILER_PARK_X = 11.9;
const REAR_BUNK_X = TRAILER_PARK_X - 4.2;
const BUTT_OVERHANG = 6.0;
const DECK_AXIS_Y = 1.5;
const TAIL_ANGLE = Math.asin(DECK_AXIS_Y / BUTT_OVERHANG);
const PIVOT = new THREE.Vector3(REAR_BUNK_X - Math.cos(TAIL_ANGLE) * BUTT_OVERHANG, 0, 0);
const SLING_LEG = 6.5;
const SOCKET_SEAT_Y = -0.62;

export interface DirectorOptions {
  seed: number;
  quality: QualitySettings;
  audio: AudioKit;
  hud: Hud;
  scene: THREE.Scene;
  rig: CameraRig;
  renderer: THREE.WebGLRenderer;
}

/** Everything about the current run that must survive an orientation change. */
interface RunState {
  stage: Stage;
  outriggerExtended: boolean[];
  jacksDown: boolean;
  slingPlaced: boolean[];
  hoist: number;
  lower: number;
  guyProgress: number;
  wrapProgress: number;
  starPlaced: boolean;
  litTimer: number;
  illuminated: boolean;
}

export class Director {
  readonly scene: THREE.Scene;
  readonly rig: CameraRig;
  private hud: Hud;
  private audio: AudioKit;
  private quality: QualitySettings;
  private renderer: THREE.WebGLRenderer;
  private rng: Rng;
  readonly seed: number;

  private materials: Materials;
  private town: Town;
  private tree: ConiferTree;
  private crane: MobileCrane;
  private transport: TreeTransport;
  private mewp: Mewp;
  private rigging: Rigging;
  private guys: GuyWires;
  private lights: TreeLights;
  private star: TopStar;
  private gifts: THREE.Group;
  private sky: SkyDome;
  private snow: Snowfall;
  private crowd: Crowd;
  private crew: { person: Person; home: THREE.Vector3 }[] = [];
  private mewpWorker: Person;
  private craneOperator: Person;
  private switchPodium = new THREE.Group();
  private switchLever = new THREE.Group();
  private root = new THREE.Group();

  private baseLight: THREE.PointLight;
  private midLight: THREE.PointLight;
  private starLight: THREE.PointLight;
  private workLight: THREE.PointLight;

  private state: RunState = {
    stage: 'arrive',
    outriggerExtended: [false, false, false, false],
    jacksDown: false,
    slingPlaced: [false, false],
    hoist: 0,
    lower: 1,
    guyProgress: 0,
    wrapProgress: 0,
    starPlaced: false,
    litTimer: -1,
    illuminated: false,
  };

  private theta = new Inertial(0, 0.22, 0.2);
  // The transport is already rolling toward the gate when the child arrives.
  private trailerTarget = 0.58;
  private departure = 0;
  private slew = new Spring(0, 6, 4.6);
  private buttHeight = new Inertial(0.55, 0.28, 0.36);
  private tagYaw = new Spring(0, 9, 5.2);
  private tagInput = 0;
  private treeLift = 0;
  private time = 0;
  private todTarget = 0.05;
  private tod = 0.05;
  private exposure = 1;
  private aspect = 1;
  private gentleMotion = false;
  private gentleLights = false;
  private slingTension = 0;
  private seated = false;
  private seatFlash = 0;
  private settleTimer = 0;
  private wrapVisual = 0;
  private starAnim = 0;
  private stowTimer = 0;
  private mewpPark = new THREE.Vector3(-17, 0, 4.5);
  private mewpWork = new THREE.Vector3(0, 0, 0);
  private mewpPos = new THREE.Vector3(-17, 0, 4.5);
  private auto = false;
  private autoTimer = 0;
  private autoPhase = 0;
  private dropScreen: { x: number; y: number }[] = [
    { x: -999, y: -999 },
    { x: -999, y: -999 },
  ];
  private dragging = -1;
  private lastPointer = { x: -999, y: -999 };
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private ratchetAcc = 0;
  private guyStep = 0;
  private lightStep = 0;
  private windStrength: number;
  private alive = true;
  private timers: number[] = [];

  constructor(opts: DirectorOptions) {
    this.scene = opts.scene;
    this.rig = opts.rig;
    this.hud = opts.hud;
    this.audio = opts.audio;
    this.quality = opts.quality;
    this.renderer = opts.renderer;
    this.seed = opts.seed;
    this.rng = new Rng(opts.seed);
    this.scene.add(this.root);

    const rng = this.rng;
    this.windStrength = rng.range(0.35, 1.25);

    this.materials = new Materials(new Rng(opts.seed ^ 0x9e37), this.quality.anisotropy);
    this.town = new Town(this.materials, new Rng(opts.seed ^ 0x51ed), this.quality);
    this.root.add(this.town.root);

    this.sky = new SkyDome(this.quality.shadowMapSize);
    this.sky.addTo(this.scene);
    this.sky.setTimeOfDay(this.todTarget);
    this.sky.refreshEnvironment(this.renderer, this.scene, true);
    this.scene.environmentIntensity = 0.55;

    this.tree = new ConiferTree(new Rng(opts.seed ^ 0x2f1b), this.materials.bark, this.quality.treeLodBias);
    this.root.add(this.tree.root);

    this.crane = new MobileCrane(this.materials, 0);
    this.crane.root.position.set(-4, 0, 11);
    this.crane.root.rotation.y = 0.742;
    this.root.add(this.crane.root);

    const path = [
      new THREE.Vector3(-78, 0, -11),
      new THREE.Vector3(-44, 0, -9),
      new THREE.Vector3(-18, 0, -2.4),
      new THREE.Vector3(-2, 0, 0),
      new THREE.Vector3(TRAILER_PARK_X, 0, 0),
    ];
    this.transport = new TreeTransport(this.materials, path, path.length - 1);
    this.root.add(this.transport.root);

    this.mewp = new Mewp(this.materials);
    this.mewp.root.position.copy(this.mewpPark);
    this.root.add(this.mewp.root);

    this.rigging = new Rigging(this.materials, this.tree, this.root);
    this.guys = new GuyWires(this.materials, this.tree, this.town.anchorPoints, this.root);
    this.lights = new TreeLights(
      this.materials,
      this.tree,
      new Rng(opts.seed ^ 0x77c1),
      this.quality.tier === 'low' ? 74 : this.quality.tier === 'mid' ? 96 : 124,
    );
    this.tree.root.add(this.lights.group);

    this.star = new TopStar(this.materials, new Rng(opts.seed ^ 0x1234));
    this.star.group.position.set(0, this.tree.spec.height * 0.955, 0);
    this.tree.root.add(this.star.group);

    this.gifts = buildGifts(this.materials, new Rng(opts.seed ^ 0xaa11));
    this.root.add(this.gifts);

    this.snow = new Snowfall(this.quality.snowCount, new Rng(opts.seed ^ 0x5a5a), rng.range(0.25, 1.0));
    this.root.add(this.snow.points);

    this.crowd = new Crowd(this.materials, new Rng(opts.seed ^ 0xbeef), this.quality.residentCount, 23, 29, [
      { at: 0, half: 0.55 },
      { at: Math.PI, half: 0.55 },
    ]);
    this.root.add(this.crowd.mesh);

    // ---- crew ------------------------------------------------------------
    const crewSpots: THREE.Vector3[] = [
      new THREE.Vector3(6.4, 0, 7.2), // banksman / signaller
      new THREE.Vector3(3.2, 0, -6.4), // rigger
      new THREE.Vector3(9.5, 0, -6.9), // rigger
      new THREE.Vector3(15.5, 0, -8.6), // tag line hand
      new THREE.Vector3(-9.5, 0, 6.4), // exclusion-zone marshal
    ];
    for (const p of crewSpots) {
      const person = new Person(this.materials, rng, true);
      person.root.position.copy(p);
      person.lookAt(new THREE.Vector3(4, 0, 0));
      this.root.add(person.root);
      this.crew.push({ person, home: p.clone() });
    }
    this.mewpWorker = new Person(this.materials, rng, true);
    this.mewpWorker.root.position.set(0.55, -0.56, 0);
    this.mewpWorker.root.rotation.y = -Math.PI / 2;
    this.mewp.basketFloor.add(this.mewpWorker.root);
    this.craneOperator = new Person(this.materials, rng, true);
    this.craneOperator.root.position.set(-0.1, -0.35, 0);
    this.craneOperator.root.rotation.y = -Math.PI / 2;
    this.root.add(this.craneOperator.root);
    this.craneOperator.root.visible = false;

    // A few nearer residents so the crowd is not only instanced silhouettes.
    for (let i = 0; i < 6; i++) {
      const a = rng.range(-1.1, 1.1) - 1.9;
      const r = rng.range(22.5, 25.0);
      const person = new Person(this.materials, rng, false, i);
      person.root.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      person.lookAt(new THREE.Vector3(0, 0, 0));
      person.setGesture('watch');
      this.root.add(person.root);
      this.crew.push({ person, home: person.root.position.clone() });
    }

    this.buildSwitchPodium();

    // ---- limited practical lights ---------------------------------------
    this.baseLight = new THREE.PointLight(0xffb765, 0, 22, 2);
    this.baseLight.position.set(0, 2.4, 0);
    this.midLight = new THREE.PointLight(0xffc98a, 0, 26, 2);
    this.midLight.position.set(0, this.tree.spec.height * 0.55, 0);
    this.starLight = new THREE.PointLight(0xfff0c0, 0, 16, 2);
    this.starLight.position.set(0, this.tree.spec.height * 0.99, 0);
    this.workLight = new THREE.PointLight(0xfff3dd, 0, 34, 2);
    this.workLight.position.set(2, 9, 6);
    this.root.add(this.baseLight, this.midLight, this.starLight, this.workLight);

    this.mewpWork.set(4.0, 0, 2.9);
    this.applyTreeTransform();
    this.enterStage('arrive', true);
  }

  // ------------------------------------------------------------- podium --
  private buildSwitchPodium(): void {
    const m = this.materials;
    const g = this.switchPodium;
    g.position.set(0, 0, 21.5);
    this.root.add(g);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.24, 1.3), m.timber);
    base.position.y = 0.12;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.0, 0.16), m.timber);
      leg.position.set(s * 0.75, 0.5, 0);
      g.add(leg);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 1.4), m.timber);
    top.position.y = 1.05;
    top.castShadow = true;
    g.add(top);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.7), m.craneAccent);
    housing.position.y = 1.48;
    housing.castShadow = true;
    g.add(housing);
    this.switchLever.position.set(0, 1.72, 0);
    housing.add(this.switchLever);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.85, 8), m.steel);
    bar.position.y = 0.42;
    this.switchLever.add(bar);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), m.craneBody);
    knob.position.y = 0.85;
    this.switchLever.add(knob);
    this.switchLever.rotation.z = 0.6;
    // Bunting posts either side.
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 8), m.timber);
      post.position.set(s * 3.2, 1.3, 0);
      post.castShadow = true;
      g.add(post);
    }
  }

  // -------------------------------------------------------------- stages --
  get stage(): Stage {
    return this.state.stage;
  }

  private enterStage(stage: Stage, snapCamera = false): void {
    this.state.stage = stage;
    this.hud.setSteps(STAGE_STEP[stage]);
    const [glyph, text] = STAGE_TITLE[stage];
    this.hud.setTitle(glyph, text);

    switch (stage) {
      case 'arrive':
        this.todTarget = 0.05;
        this.hud.showControl('guide');
        this.setCrewGesture(0, 'signal-hold');
        break;
      case 'outriggers':
        this.todTarget = 0.16;
        this.hud.showControl('outriggers', { outriggerDone: this.state.outriggerExtended });
        this.setCrewGesture(0, 'point');
        break;
      case 'rigging':
        this.todTarget = 0.27;
        this.hud.showControl('slings');
        this.setCrewGesture(1, 'point');
        this.setCrewGesture(2, 'point');
        break;
      case 'lift':
        this.todTarget = 0.4;
        this.hud.showControl('lever', { leverStart: this.state.hoist, withTagLine: true });
        this.rigging.showTagLine(true);
        this.setCrewGesture(0, 'signal-up');
        this.setCrewGesture(3, 'pull');
        this.moveCrewClear();
        break;
      case 'settle':
        this.hud.showControl('none');
        this.hud.setTitle('🏗️', STAGE_TITLE.settle[1]);
        this.settleTimer = 0;
        this.setCrewGesture(0, 'signal-hold');
        break;
      case 'lower':
        this.todTarget = 0.52;
        this.state.lower = 1;
        this.hud.showControl('lever', { leverStart: 1 });
        this.hud.setLeverValue(1);
        this.setCrewGesture(0, 'signal-down');
        break;
      case 'guys':
        this.todTarget = 0.62;
        this.guys.show(true);
        this.hud.showControl('capstan');
        this.setCrewGesture(0, 'watch');
        this.setCrewGesture(1, 'pull');
        this.setCrewGesture(2, 'pull');
        break;
      case 'wrap':
        this.todTarget = 0.72;
        this.rigging.stow();
        this.hud.showControl('spiral');
        this.setCrewGesture(0, 'watch');
        break;
      case 'star':
        this.todTarget = 0.79;
        this.hud.showControl('star');
        break;
      case 'illuminate':
        this.todTarget = 0.9;
        this.hud.showControl('switch');
        this.stowTimer = 0;
        this.gifts.visible = true;
        this.crowd.gather(1);
        this.setCrewGesture(0, 'wave');
        for (let i = 5; i < this.crew.length; i++) {
          const c = this.crew[i];
          c.person.setGesture('wave');
          // Residents drift up to the barrier line now the zone is clear.
          c.home.multiplyScalar(0.88);
        }
        break;
      case 'finale':
        this.todTarget = 1;
        this.hud.showControl('menu');
        break;
    }
    if (snapCamera) {
      this.rig.set(this.shotFor(stage), true);
    }
  }

  /** setTimeout that never fires into a disposed run. */
  private later(ms: number, fn: () => void): void {
    const id = window.setTimeout(() => {
      if (this.alive) fn();
    }, ms);
    this.timers.push(id);
  }

  private setCrewGesture(index: number, g: Parameters<Person['setGesture']>[0]): void {
    this.crew[index]?.person.setGesture(g);
  }

  /** Riggers step out of the exclusion zone before anything leaves the ground. */
  private moveCrewClear(): void {
    this.crew[1].home.set(1.5, 0, -9.5);
    this.crew[2].home.set(11.5, 0, -10.5);
    this.crew[1].person.setGesture('watch');
    this.crew[2].person.setGesture('watch');
  }

  // ------------------------------------------------------------- actions --
  onGuide(): void {
    if (this.state.stage !== 'arrive') return;
    this.trailerTarget = 1;
    this.audio.setDiesel(0.42, 0.5);
  }

  onOutrigger(index: number): void {
    if (this.state.stage !== 'outriggers') return;
    if (this.state.outriggerExtended[index]) return;
    this.state.outriggerExtended[index] = true;
    this.audio.setHydraulic(0.28, 0.4);
    this.audio.tick(true);
    if (this.state.outriggerExtended.every(Boolean)) {
      // The operator checks the spread before calling for the jacks.
      this.setCrewGesture(0, 'signal-down');
      this.later(650, () => {
        if (this.state.stage === 'outriggers' && !this.state.jacksDown) this.hud.showControl('jacks');
      });
    }
  }

  onJacks(): void {
    if (this.state.stage !== 'outriggers') return;
    if (!this.state.outriggerExtended.every(Boolean)) return;
    this.state.jacksDown = true;
    this.audio.setHydraulic(0.32, 0.7);
  }

  onSlingDrag(index: number, x: number, y: number, phase: 'start' | 'move' | 'end'): void {
    if (this.state.stage !== 'rigging') return;
    this.lastPointer = { x, y };
    this.dragging = phase === 'end' ? -1 : index;
    if (phase === 'end') {
      const t = this.dropScreen[index];
      const d = Math.hypot(x - t.x, y - t.y);
      if (d < 130) this.placeSling(index);
    }
  }

  private placeSling(index: number): void {
    if (this.state.slingPlaced[index]) return;
    this.state.slingPlaced[index] = true;
    this.hud.markSlingDone(index);
    this.audio.clank(index === 0 ? 1 : 1.3);
    if (this.state.slingPlaced.every(Boolean)) {
      this.setCrewGesture(1, 'ok');
      this.setCrewGesture(2, 'ok');
      this.setCrewGesture(3, 'pull');
      this.rigging.showTagLine(true);
      this.later(900, () => {
        if (this.state.stage === 'rigging') this.enterStage('lift');
      });
    }
  }

  onLever(v: number): void {
    if (this.state.stage === 'lift') this.state.hoist = v;
    else if (this.state.stage === 'lower') this.state.lower = v;
  }

  onTagLine(v: number): void {
    this.tagInput = v;
  }

  onCapstan(p: number): void {
    if (this.state.stage !== 'guys') return;
    this.state.guyProgress = Math.max(this.state.guyProgress, p);
  }

  onSpiral(p: number): void {
    if (this.state.stage !== 'wrap') return;
    this.state.wrapProgress = Math.max(this.state.wrapProgress, p);
  }

  onStar(): void {
    if (this.state.stage !== 'star' || this.state.starPlaced) return;
    this.state.starPlaced = true;
    this.star.group.visible = true;
    this.starAnim = 0;
    this.audio.clank(0.8);
  }

  onSwitch(): void {
    if (this.state.stage !== 'illuminate' || this.state.illuminated) return;
    this.state.illuminated = true;
    this.state.litTimer = 0;
    this.lightStep = 0;
    this.audio.bigSwitch();
  }

  onToggleMotion(gentle: boolean): void {
    this.gentleMotion = gentle;
    this.rig.setGentle(gentle);
  }

  onToggleLights(gentle: boolean): void {
    this.gentleLights = gentle;
  }

  // --------------------------------------------------------------- frame --
  update(dt: number): void {
    this.time += dt;
    if (this.auto) this.driveAutoplay(dt);

    this.tod = damp(this.tod, this.todTarget, 0.55, dt);
    this.exposure = this.sky.setTimeOfDay(this.tod);
    this.sky.refreshEnvironment(this.renderer, this.scene);
    this.town.setNightIntensity(clamp((this.tod - 0.55) / 0.35, 0, 1));

    this.updateVehicles(dt);
    this.updateTree(dt);
    this.updateCrane(dt);
    this.updateRigging();
    this.updateStageLogic(dt);
    this.updateLighting(dt);
    this.updateCameraShot(dt);
    this.updateAmbientSound();

    for (const c of this.crew) {
      c.person.root.position.x = damp(c.person.root.position.x, c.home.x, 1.2, dt);
      c.person.root.position.z = damp(c.person.root.position.z, c.home.z, 1.2, dt);
      c.person.update(dt, this.time);
    }
    this.mewpWorker.update(dt, this.time);
    this.crowd.update(this.time);
    this.tree.update(dt, this.time, this.windStrength * (this.gentleMotion ? 0.4 : 1));
    this.tree.updateLod(this.rig.camera);
    this.snow.update(dt, this.rig.camera, this.time);
    this.sky.follow(this.rig.camera);
    this.rig.update(dt, this.time);
    this.hud.tick(dt);
    this.updateDropTargets();
  }

  /** Machinery falls quiet once its part of the job is done. */
  private updateAmbientSound(): void {
    const st = this.state.stage;
    if (st === 'guys' || st === 'star' || st === 'illuminate' || st === 'finale') {
      this.audio.setDiesel(st === 'finale' ? 0 : 0.04, 0.05);
      this.audio.setWinch(0, 0);
    } else if (st === 'wrap') {
      this.audio.setDiesel(0.09, 0.15);
      this.audio.setWinch(0, 0);
    }
  }

  get toneExposure(): number {
    return this.exposure;
  }

  // -------------------------------------------------------------- pieces --
  private updateVehicles(dt: number): void {
    if (this.trailerTarget >= 2) {
      // Pulling out of the square: drive off the parked pose, not the path.
      this.departure += dt * 3.6;
      this.transport.root.position.set(TRAILER_PARK_X + this.departure, 0, 0);
      this.transport.root.rotation.y = 0;
      if (this.departure > 64) this.transport.root.visible = false;
      else this.audio.setDiesel(0.3, 0.6);
      return;
    }
    const drive = this.transport.drive(this.trailerTarget, dt);
    if (drive.moving) {
      this.audio.setDiesel(0.26 + drive.speed * 0.5, clamp(drive.speed, 0, 1));
    } else if (this.state.stage === 'arrive' && this.trailerTarget > 0.5) {
      this.audio.setDiesel(0.12, 0.05);
    }

    // The transport clears the square once the load is safely airborne.
    if (this.state.stage === 'lift' && this.theta.value > 0.62 && this.trailerTarget < 1.5) {
      this.trailerTarget = 2;
    }

    // MEWP drives in for the lighting act and stows afterwards.
    const wantWork = this.state.stage === 'wrap' || this.state.stage === 'star';
    const target = wantWork ? this.mewpWork : this.mewpPark;
    this.mewpPos.x = damp(this.mewpPos.x, target.x, 0.9, dt);
    this.mewpPos.z = damp(this.mewpPos.z, target.z, 0.9, dt);
    this.mewp.root.position.copy(this.mewpPos);
    this.mewp.root.rotation.y = Math.atan2(-(0 - this.mewpPos.z), 0 - this.mewpPos.x) + Math.PI;
  }

  /** Tree kinematics: slack take-up, tailing, pivot, socket descent. */
  private updateTree(dt: number): void {
    const st = this.state;
    let targetTheta = 0;
    if (st.stage === 'lift') {
      const u = st.hoist;
      this.slingTension = clamp(u / 0.08, 0, 1);
      if (u <= 0.08) targetTheta = 0;
      else if (u <= 0.22) targetTheta = ((u - 0.08) / 0.14) * TAIL_ANGLE;
      else targetTheta = TAIL_ANGLE + ((u - 0.22) / 0.78) * (Math.PI / 2 - TAIL_ANGLE);
    } else if (st.stage === 'arrive' || st.stage === 'outriggers' || st.stage === 'rigging') {
      targetTheta = 0;
      this.slingTension = 0;
    } else {
      targetTheta = Math.PI / 2;
      this.slingTension = this.seated ? 0.08 : 1;
    }

    const before = this.theta.velocity;
    this.theta.step(targetTheta, dt);
    const angAccel = dt > 0 ? (this.theta.velocity - before) / dt : 0;

    // Tag line: a gentle, heavily assisted yaw trim.
    this.tagYaw.step(this.tagInput * 0.16, dt);

    this.applyTreeTransform();
    this.tree.setDynamics(angAccel * 60, this.buttHeight.velocity * 40);

    if (Math.abs(this.theta.velocity) > 0.004) {
      this.audio.setWinch(0.16 + Math.min(0.3, Math.abs(this.theta.velocity) * 1.4), clamp(Math.abs(this.theta.velocity) * 4, 0, 1));
      this.audio.setDiesel(0.24, 0.35);
    } else if (this.state.stage === 'lift' || this.state.stage === 'lower' || this.state.stage === 'settle') {
      this.audio.setWinch(0.02, 0.1);
    }
  }

  private applyTreeTransform(): void {
    const theta = this.theta.value;
    const root = this.tree.root;
    let yaw = this.tagYaw.value;
    if (theta < TAIL_ANGLE - 1e-4) {
      // Still carried: the trunk rides the bolsters, its butt overhanging the
      // rear of the deck. Hoisting tails that butt down onto the setts.
      const t = this.transport.root;
      t.updateMatrixWorld(true);
      const heading = t.rotation.y;
      const bunk = new THREE.Vector3(-4.2, DECK_AXIS_Y, 0).applyMatrix4(t.matrixWorld);
      const back = new THREE.Vector3(-Math.cos(heading), 0, Math.sin(heading));
      root.position.set(
        bunk.x + back.x * Math.cos(theta) * BUTT_OVERHANG,
        bunk.y - Math.sin(theta) * BUTT_OVERHANG,
        bunk.z + back.z * Math.cos(theta) * BUTT_OVERHANG,
      );
      yaw += heading;
    } else {
      root.position.set(PIVOT.x + this.slew.value, this.treeLift, 0);
    }
    root.rotation.set(0, yaw, -(Math.PI / 2 - theta));
    root.updateMatrixWorld(true);
  }

  private updateCrane(dt: number): void {
    const targets = this.state.outriggerExtended.map((e) => ({
      extend: e ? 1 : 0,
      jack: this.state.jacksDown && e ? 1 : 0,
    }));
    const res = this.crane.stepOutriggers(targets, dt);
    if (res.moving) {
      this.audio.setHydraulic(0.24, this.state.jacksDown ? 0.75 : 0.35);
    } else {
      this.audio.setHydraulic(0, 0.2);
    }
    for (const i of res.newContacts) {
      this.audio.padSet();
      void i;
    }

    // Hook follows the sling bridle; before rigging it waits beside the load.
    const target = this.tmp;
    if (this.state.stage === 'arrive' || this.state.stage === 'outriggers') {
      target.set(REAR_BUNK_X - 2.5, 7.5, 3.2);
    } else {
      const a = (this.tree.slingHeights[0] + this.tree.slingHeights[1]) / 2;
      this.tree.worldTrunkPoint(a, target);
      target.y += SLING_LEG;
    }
    const st = this.state.stage;
    if (st === 'wrap' || st === 'star' || st === 'illuminate' || st === 'finale') {
      // De-rigged: the crane booms up and swings clear of the tree.
      target.set(-11, 15, 22);
    }
    this.crane.aim(target, dt, 6.5);
  }

  private updateRigging(): void {
    const st = this.state;
    for (let i = 0; i < 2; i++) {
      const placed = st.slingPlaced[i] ? 1 : this.dragging === i ? 0.45 : 0;
      const cur = this.rigging.slings[i].placed;
      this.rigging.setPlaced(i, damp(cur, placed, 6, 1 / 60));
    }
    const rigged = st.slingPlaced.every(Boolean);
    this.rigging.setTension(rigged ? this.slingTension : 0);
    const hook = this.crane.hookWorld(this.tmp2);
    this.rigging.setTagAnchor(this.crew[3].person.root.position.clone().add(new THREE.Vector3(0, 1.3, 0)));
    this.rigging.setTagPull(this.tagInput);
    this.rigging.update(hook);
    this.guys.update();
  }

  private updateStageLogic(dt: number): void {
    const st = this.state;
    switch (st.stage) {
      case 'arrive':
        if (this.transport.progress > 0.995 && this.trailerTarget === 1) {
          this.trailerTarget = 1.2;
          this.audio.airBrake();
          this.audio.setDiesel(0.1, 0);
          this.later(1100, () => {
            if (this.state.stage === 'arrive') this.enterStage('outriggers');
          });
        }
        break;

      case 'outriggers':
        if (st.jacksDown && this.crane.levelled) {
          this.setCrewGesture(0, 'ok');
          if (this.stowTimer === 0) {
            this.stowTimer = 1;
            this.later(1200, () => {
              if (this.state.stage === 'outriggers') {
                this.stowTimer = 0;
                this.enterStage('rigging');
              }
            });
          }
        }
        break;

      case 'lift': {
        // Slack take-up creak, then the crown answering the trunk.
        if (this.slingTension > 0.15 && this.slingTension < 0.98 && this.seatFlash <= 0) {
          this.seatFlash = 0.7;
          this.audio.slingCreak(0.7);
        }
        this.seatFlash -= dt;
        if (Math.abs(this.theta.velocity) > 0.05 && Math.random() < dt * 1.6) {
          this.audio.branchRustle(0.4 + Math.random() * 0.4);
        }
        if (this.theta.value > Math.PI / 2 - 0.012 && st.hoist > 0.985) {
          this.enterStage('settle');
        }
        break;
      }

      case 'settle': {
        this.settleTimer += dt;
        this.slew.step(-PIVOT.x, dt);
        this.treeLift = damp(this.treeLift, 0.55, 1.0, dt);
        this.audio.setWinch(0.1, 0.3);
        if (this.settleTimer > 3.4 && Math.abs(this.slew.value + PIVOT.x) < 0.06) {
          this.audio.setWinch(0, 0);
          this.enterStage('lower');
        }
        break;
      }

      case 'lower': {
        // Wide capture near the socket, but the last 45 cm is a real descent.
        const target = THREE.MathUtils.lerp(SOCKET_SEAT_Y, 0.55, st.lower);
        this.buttHeight.step(target, dt);
        this.treeLift = this.buttHeight.value;
        const assist = clamp((0.55 - this.treeLift) / 0.55, 0, 1);
        this.slew.step(-PIVOT.x, dt);
        this.tagYaw.step(this.tagYaw.value * (1 - assist), dt);
        if (!this.seated && this.treeLift < SOCKET_SEAT_Y + 0.035) {
          this.seated = true;
          this.audio.heavyThud(1);
          this.audio.branchRustle(1);
          this.tree.impulse(0.7);
          this.setCrewGesture(0, 'ok');
          this.later(1800, () => {
            if (this.state.stage === 'lower') this.enterStage('guys');
          });
        }
        break;
      }

      case 'guys': {
        const p = st.guyProgress;
        // Wires come up in sequence, each with a little elastic overshoot.
        const spans: [number, number][] = [
          [0.02, 0.42],
          [0.3, 0.72],
          [0.58, 0.98],
        ];
        spans.forEach((s, i) => {
          const t = clamp((p - s[0]) / (s[1] - s[0]), 0, 1);
          const eased = t * t * (3 - 2 * t);
          this.guys.setTension(i, eased);
          if (eased > 0.98 && this.guyStep === i) {
            this.guyStep++;
            this.audio.wireTension(i / 3);
          }
        });
        this.ratchetAcc += Math.max(0, p - this.ratchetAcc);
        if (p > 0 && Math.random() < dt * 8 && p < 1) this.audio.ratchet();
        // The trunk trues up as the wires take load.
        const lean = (1 - p) * 0.016;
        this.tree.root.rotation.z = -(Math.PI / 2 - this.theta.value) + lean;
        if (p > 0.985 && this.stowTimer === 0) {
          this.stowTimer = 1;
          this.setCrewGesture(0, 'ok');
          this.later(1400, () => {
            if (this.state.stage === 'guys') {
              this.stowTimer = 0;
              this.enterStage('wrap');
            }
          });
        }
        break;
      }

      case 'wrap': {
        this.wrapVisual = damp(this.wrapVisual, st.wrapProgress, 3.2, dt);
        this.lights.setInstalled(this.wrapVisual);
        const p = this.lights.pointAt(this.wrapVisual, this.tree, this.tmp);
        const outward = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(1.55);
        this.mewp.solve(p.clone().add(outward).add(new THREE.Vector3(0, -0.15, 0)), dt);
        this.mewpWorker.setGesture(this.mewp.moving ? 'point' : 'idle');
        if (this.mewp.moving) this.audio.setHydraulic(0.12, 0.55);
        if (st.wrapProgress > 0.985 && this.stowTimer === 0) {
          this.stowTimer = 1;
          this.later(900, () => {
            if (this.state.stage === 'wrap') {
              this.stowTimer = 0;
              this.enterStage('star');
            }
          });
        }
        break;
      }

      case 'star': {
        const topWorld = this.tree.worldTrunkPoint(this.tree.spec.height * 0.9, this.tmp);
        const outward = new THREE.Vector3(1, 0, 0.35).normalize().multiplyScalar(1.5);
        this.mewp.solve(topWorld.clone().add(outward), dt);
        this.mewpWorker.setGesture(st.starPlaced ? 'ok' : 'point');
        if (st.starPlaced) {
          this.starAnim = Math.min(1, this.starAnim + dt * 0.8);
          const e = this.starAnim * this.starAnim * (3 - 2 * this.starAnim);
          this.star.group.position.y = this.tree.spec.height * 0.955;
          this.star.group.scale.setScalar(0.4 + e * 0.6);
          this.star.group.rotation.y = (1 - e) * 1.6;
          if (this.starAnim >= 1 && this.stowTimer === 0) {
            this.stowTimer = 1;
            this.audio.clank(1.4);
            this.later(1200, () => {
              if (this.state.stage === 'star') {
                this.stowTimer = 0;
                this.enterStage('illuminate');
              }
            });
          }
        }
        break;
      }

      case 'illuminate': {
        this.mewp.stow(dt);
        this.stowTimer += dt;
        if (st.litTimer >= 0) {
          st.litTimer += dt * (this.gentleLights ? 0.55 : 1);
          this.switchLever.rotation.z = damp(this.switchLever.rotation.z, -0.6, 3, dt);
          if (st.litTimer > 8.5) this.enterStage('finale');
        }
        break;
      }

      case 'finale':
        this.mewp.stow(dt);
        st.litTimer += dt;
        break;

      default:
        break;
    }
  }

  /** Sequential illumination: base → mid → top → star → street → windows. */
  private updateLighting(dt: number): void {
    const t = this.state.litTimer;
    const H = this.tree.spec.height;
    if (t < 0) {
      this.lights.setLitBelow(-1);
      this.star.setLit(0);
      this.town.setStreetLit(0);
      this.town.setWindowLit(0);
      this.baseLight.intensity = damp(this.baseLight.intensity, 0, 3, dt);
      this.midLight.intensity = damp(this.midLight.intensity, 0, 3, dt);
      this.starLight.intensity = damp(this.starLight.intensity, 0, 3, dt);
      this.workLight.intensity = damp(this.workLight.intensity, this.tod > 0.6 ? 12 : 0, 1.2, dt);
      return;
    }
    const speed = this.gentleLights ? 1.7 : 1;
    const climb = clamp((t - 0.2) / (2.6 * speed), 0, 1);
    const bandTop = THREE.MathUtils.lerp(this.lights.minHeight - 0.1, this.lights.maxHeight + 0.2, climb);
    this.lights.setLitBelow(bandTop);
    this.lights.setBrightness(1);

    const chimeAt = [0.2, 1.0 * speed, 2.0 * speed, 2.9 * speed, 3.6 * speed];
    while (this.lightStep < chimeAt.length && t > chimeAt[this.lightStep]) {
      this.audio.chime(this.lightStep);
      this.lightStep++;
      if (this.lightStep === 5) {
        this.audio.bell();
        this.audio.cheer();
      }
    }

    this.star.setLit(clamp((t - 2.9 * speed) / (0.7 * speed), 0, 1));
    this.town.setStreetLit(clamp((t - 3.4 * speed) / (1.1 * speed), 0, 1));
    this.town.setWindowLit(clamp((t - 3.9 * speed) / (3.4 * speed), 0, 1));

    this.baseLight.intensity = damp(this.baseLight.intensity, climb > 0.05 ? 18 : 0, 2.2, dt);
    this.midLight.intensity = damp(this.midLight.intensity, climb > 0.45 ? 22 : 0, 2.2, dt);
    this.midLight.position.y = H * 0.55;
    this.starLight.position.y = H * 0.99;
    this.starLight.intensity = damp(this.starLight.intensity, t > 3.0 * speed ? 14 : 0, 2.2, dt);
    // One warm fill so the façades are modelled, not flat black.
    this.workLight.position.set(0, 6.5, 4);
    this.workLight.color.setHex(0xffcf9a);
    this.workLight.distance = 44;
    this.workLight.intensity = damp(this.workLight.intensity, t > 3.4 * speed ? 14 : 4, 1.2, dt);
  }

  // -------------------------------------------------------------- camera --
  private shotFor(stage: Stage): { position: THREE.Vector3; look: THREE.Vector3; fov: number; responsiveness?: number } {
    const portrait = this.aspect < 1;
    const H = this.tree.spec.height;

    switch (stage) {
      case 'arrive': {
        // Ride alongside the load: the tree on the deck is the subject, the
        // square and its crane read behind it.
        // Stand near the butt end and look along the load: a 15 m trunk
        // foreshortens into frame, and it grows as the transport comes in.
        const butt = this.tree.root.position;
        const camX = Math.max(-24, butt.x - (portrait ? 12 : 14));
        return {
          position: new THREE.Vector3(camX, portrait ? 5.2 : 5.6, portrait ? -10 : -12.5),
          look: new THREE.Vector3(butt.x + (portrait ? 6 : 7), 2.6, butt.z * 0.5),
          fov: portrait ? 60 : 50,
          responsiveness: 0.7,
        };
      }
      case 'outriggers': {
        // Down at deck level so the legs, pads and cribbing read clearly.
        // High enough to read all four legs spreading and taking the load.
        const c = this.crane.root.position.clone().add(new THREE.Vector3(0.5, 1.2, -0.5));
        const fov = portrait ? 56 : 45;
        return {
          position: new THREE.Vector3(c.x + (portrait ? 6.5 : 8), portrait ? 8 : 7.5, c.z - (portrait ? 13.5 : 16)),
          look: new THREE.Vector3(c.x, portrait ? -1.6 : 0.6, c.z),
          fov,
          responsiveness: 1.0,
        };
      }
      case 'rigging': {
        const c = this.tree.worldTrunkPoint(H * 0.43, new THREE.Vector3());
        c.y = 2.4;
        const fov = portrait ? 48 : 40;
        const dist = portrait ? 10.5 : 12.5;
        return {
          position: new THREE.Vector3(c.x - dist * 0.35, 3.4, c.z - dist * 0.9),
          look: c.clone().add(new THREE.Vector3(0, portrait ? -2.6 : -0.5, 0)),
          fov,
          responsiveness: 1.1,
        };
      }
      case 'lift': {
        const u = clamp(this.theta.value / (Math.PI / 2), 0, 1);
        if (u < 0.1) {
          // Establish: the whole load, the crane and the square in one read.
          const centre = new THREE.Vector3(8, 3.5, 0);
          return {
            position: new THREE.Vector3(portrait ? 14 : 16, portrait ? 8.5 : 8, portrait ? -19 : -21),
            look: centre,
            fov: portrait ? 58 : 47,
            responsiveness: 1.0,
          };
        }
        if (u < 0.88) {
          // Low and behind the butt, looking up the length of the trunk: the
          // tree's size and the hook height are read in one frame.
          const theta = this.theta.value;
          const dist = (portrait ? 19 : 22) + u * (portrait ? 10 : 11);
          return {
            position: new THREE.Vector3(PIVOT.x - dist * 0.5, 2.4 + u * 4.0, -dist * 0.8),
            look: new THREE.Vector3(
              PIVOT.x + H * 0.35 * Math.cos(theta),
              2.0 + H * 0.5 * Math.sin(theta),
              0,
            ),
            fov: portrait ? 58 : 48,
            responsiveness: 0.85,
          };
        }
        // Vertical: ease back so the whole standing tree reads at once.
        const centre = new THREE.Vector3(PIVOT.x, H * 0.5, 0);
        const f = fitShot(centre, H + 4.5, H * 0.8, -1.75, portrait ? 0.13 : 0.1, 23, this.aspect, 1.22);
        return {
          position: f.position,
          look: portrait ? centre.clone().add(new THREE.Vector3(0, -H * 0.1, 0)) : centre,
          fov: f.fov,
          responsiveness: 0.75,
        };
      }
      case 'settle': {
        const centre = new THREE.Vector3(0.9, H * 0.46, 0);
        const f = fitShot(centre, H + 4.5, H * 0.8, -1.95, 0.14, 23, this.aspect, 1.22);
        return {
          position: f.position,
          look: portrait ? centre.clone().add(new THREE.Vector3(0, -H * 0.1, 0)) : centre,
          fov: f.fov,
          responsiveness: 0.85,
        };
      }
      case 'lower': {
        // Butt and socket in one close frame; no numbers, just the fit.
        const centre = new THREE.Vector3(0, portrait ? -0.4 : 1.5, 0);
        const fov = portrait ? 44 : 37;
        const dist = portrait ? 8.5 : 10;
        return {
          position: new THREE.Vector3(-dist * 0.42, 2.9, -dist * 0.9),
          look: centre,
          fov,
          responsiveness: 1.15,
        };
      }
      case 'guys': {
        const centre = new THREE.Vector3(0, H * 0.42, 0);
        const f = fitShot(centre, H + 5, H * 1.15, -2.15, portrait ? 0.12 : 0.09, 22, this.aspect, 1.3);
        return {
          position: f.position,
          look: portrait ? centre.clone().add(new THREE.Vector3(0, -H * 0.12, 0)) : centre,
          fov: f.fov,
          responsiveness: 0.9,
        };
      }
      case 'wrap': {
        // Orbit with the basket: the working point stays just off centre and
        // the machine that is doing the work stays in frame beside it.
        const p = this.lights.pointAt(this.wrapVisual, this.tree, this.tmp);
        const a = Math.atan2(p.z, p.x) + 0.85;
        const dist = portrait ? 18.5 : 20;
        const bias = 0.35;
        return {
          position: new THREE.Vector3(
            Math.cos(a) * dist,
            Math.max(7.4, p.y * 0.58 + 4.6),
            Math.sin(a) * dist,
          ),
          look: new THREE.Vector3(
            p.x * bias,
            Math.max(2.4, p.y * 0.94) + (portrait ? -1.4 : 0.2),
            p.z * bias,
          ),
          fov: portrait ? 58 : 48,
          responsiveness: 0.8,
        };
      }
      case 'star': {
        const centre = new THREE.Vector3(0, H * 0.93, 0);
        const f = fitShot(centre, 7.5, 7.5, 0.62, -0.1, portrait ? 11 : 13, this.aspect, 1.1, 34, 62);
        return {
          position: f.position,
          look: centre.clone().add(new THREE.Vector3(0, portrait ? -1.2 : -0.4, 0)),
          fov: f.fov,
          responsiveness: 0.9,
        };
      }
      case 'illuminate':
      case 'finale': {
        // Foreground snow and barrier, the lit tree mid-ground, town hall and
        // winter sky behind — all readable in one frame.
        const centre = new THREE.Vector3(0, H * 0.44, 0);
        const swing = Math.sin(this.time * 0.055) * 0.13;
        const f = fitShot(centre, H + 9, H * 1.6, -1.62 + swing, portrait ? 0.14 : 0.11, 25, this.aspect, 1.22);
        return {
          position: f.position,
          look: centre.clone().add(new THREE.Vector3(0, portrait ? -H * 0.16 : H * 0.02, 0)),
          fov: f.fov,
          responsiveness: 0.85,
        };
      }
    }
  }

  private updateCameraShot(_dt: number): void {
    this.rig.set(this.shotFor(this.state.stage));
  }

  // -------------------------------------------------------- HUD feedback --
  private updateDropTargets(): void {
    if (this.state.stage !== 'rigging') return;
    const heights = this.tree.slingHeights;
    const list = heights.map((h, i) => {
      const w = this.tree.worldTrunkPoint(h, new THREE.Vector3());
      const p = w.clone().project(this.rig.camera);
      const x = ((p.x + 1) / 2) * window.innerWidth;
      const y = ((1 - p.y) / 2) * window.innerHeight;
      this.dropScreen[i] = { x, y };
      const near =
        this.dragging === i && Math.hypot(this.lastPointer.x - x, this.lastPointer.y - y) < 130;
      return { index: i, x, y, visible: !this.state.slingPlaced[i], near };
    });
    this.hud.updateDropTargets(list);
  }

  /** Compact state summary used by the automated verification passes. */
  snapshot(): Record<string, number | string> {
    return {
      stage: this.state.stage,
      theta: Number(this.theta.value.toFixed(4)),
      outriggers: this.state.outriggerExtended.filter(Boolean).length,
      slings: this.state.slingPlaced.filter(Boolean).length,
      hoist: Number(this.state.hoist.toFixed(3)),
      guys: Number(this.state.guyProgress.toFixed(3)),
      wrap: Number(this.state.wrapProgress.toFixed(3)),
      star: this.state.starPlaced ? 1 : 0,
      treeY: Number(this.tree.root.position.y.toFixed(3)),
      seed: this.seed,
    };
  }

  // ------------------------------------------------------------- resize --
  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.rig.set(this.shotFor(this.state.stage));
  }

  // ------------------------------------------------------------ autoplay --
  startAutoplay(): void {
    this.auto = true;
    this.autoTimer = 0;
    this.autoPhase = 0;
  }

  stopAutoplay(): void {
    this.auto = false;
  }

  get isAutoplaying(): boolean {
    return this.auto;
  }

  /** Drives the same public actions a finger would, for verification runs. */
  private driveAutoplay(dt: number): void {
    this.autoTimer += dt;
    const st = this.state;
    switch (st.stage) {
      case 'arrive':
        if (this.autoTimer > 1.2 && this.trailerTarget < 0.9) this.onGuide();
        break;
      case 'outriggers': {
        const next = st.outriggerExtended.findIndex((v) => !v);
        if (next >= 0 && this.autoTimer > 0.5) {
          this.autoTimer = 0;
          this.onOutrigger(next);
        } else if (next < 0 && !st.jacksDown && this.autoTimer > 0.9) {
          this.onJacks();
        }
        break;
      }
      case 'rigging': {
        const next = st.slingPlaced.findIndex((v) => !v);
        if (next >= 0 && this.autoTimer > 1.1) {
          this.autoTimer = 0;
          this.placeSling(next);
        }
        break;
      }
      case 'lift':
        st.hoist = Math.min(1, st.hoist + dt * 0.09);
        this.hud.setLeverValue(st.hoist);
        this.tagInput = Math.sin(this.time * 0.4) * 0.25;
        break;
      case 'lower':
        st.lower = Math.max(0, st.lower - dt * 0.12);
        this.hud.setLeverValue(st.lower);
        break;
      case 'guys':
        st.guyProgress = Math.min(1, st.guyProgress + dt * 0.2);
        break;
      case 'wrap':
        st.wrapProgress = Math.min(1, st.wrapProgress + dt * 0.14);
        break;
      case 'star':
        if (!st.starPlaced && this.autoTimer > 1.6) this.onStar();
        break;
      case 'illuminate':
        if (!st.illuminated && this.autoTimer > 1.4) this.onSwitch();
        break;
      case 'finale':
        this.autoPhase += dt;
        break;
      default:
        break;
    }
    if (st.stage !== 'lift' && st.stage !== 'lower') this.autoTimer = Math.min(this.autoTimer, 30);
  }

  // -------------------------------------------------------------- replay --
  /** Runs the switch-on again from the finale, in one tap. */
  replayLighting(): void {
    this.enterStage('illuminate');
    this.state.illuminated = true;
    this.state.litTimer = 0;
    this.lightStep = 0;
    this.audio.bigSwitch();
  }

  dispose(): void {
    this.alive = false;
    this.sky.disposeEnvironment();
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
    this.scene.remove(this.root);
    this.rigging.dispose();
    this.tree.dispose();
    this.crane.dispose();
    this.materials.dispose();
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }
}

export function seedFromString(s: string): number {
  return hashSeed(s);
}
