import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { AudioKit } from '../core/AudioKit';
import type { QualityBudget } from '../core/AdaptiveQuality';
import type { PointerSample } from '../core/PointerInput';
import { CameraDirector } from '../camera/CameraDirector';
import { ChildGuidance } from './ChildGuidance';
import { Envelope, EnvelopeFactory } from '../scene/EnvelopeFactory';
import { loadDestinations, type DestinationModule } from '../scene/DestinationSymbol';
import { Belt, ConveyorController } from '../scene/ConveyorController';
import { DispatchSchedule } from '../scene/DispatchSchedule';
import { LAYOUT, PostOfficeRoom } from '../scene/PostOfficeRoom';
import { PostalBag } from '../scene/PostalBag';
import { PostmarkPress } from '../scene/PostmarkPress';
import { PhysicalWorldMap } from '../scene/PhysicalWorldMap';
import { SorterBay, SorterGraph } from '../scene/SorterGraph';
import type { MaterialLibrary } from '../scene/materials';
import type { DestinationId, DispatchKind, EnvelopeSpec } from '../types';

export type Step =
  | 'boot'
  | 'bagArriving'
  | 'bagClasp'
  | 'unloading'
  | 'flip'
  | 'toPress'
  | 'press'
  | 'toHandoff'
  | 'carry'
  | 'chute'
  | 'betweenLetters'
  | 'closeBag'
  | 'dispatch'
  | 'departing'
  | 'map'
  | 'roundEnd';

interface RoundPlan {
  destinations: DestinationId[];
  bays: { destination: DestinationId; dispatch: DispatchKind | null }[];
  letters: { destination: DestinationId; dispatch: DispatchKind }[];
  showSchedule: boolean;
}

const ROUNDS: RoundPlan[] = [
  {
    destinations: ['lighthouse'],
    bays: [{ destination: 'lighthouse', dispatch: null }],
    letters: [{ destination: 'lighthouse', dispatch: 'today' }],
    showSchedule: false,
  },
  {
    destinations: ['lighthouse', 'mountain', 'forest'],
    bays: [
      { destination: 'lighthouse', dispatch: null },
      { destination: 'mountain', dispatch: null },
      { destination: 'forest', dispatch: null },
    ],
    letters: [
      { destination: 'forest', dispatch: 'today' },
      { destination: 'lighthouse', dispatch: 'today' },
      { destination: 'mountain', dispatch: 'today' },
    ],
    showSchedule: false,
  },
  {
    destinations: ['lighthouse', 'mountain', 'forest'],
    bays: [
      { destination: 'lighthouse', dispatch: null },
      { destination: 'mountain', dispatch: null },
      { destination: 'forest', dispatch: 'today' },
      { destination: 'forest', dispatch: 'christmas' },
    ],
    letters: [
      { destination: 'forest', dispatch: 'today' },
      { destination: 'forest', dispatch: 'christmas' },
      { destination: 'lighthouse', dispatch: 'today' },
      { destination: 'forest', dispatch: 'christmas' },
      { destination: 'mountain', dispatch: 'today' },
    ],
    showSchedule: true,
  },
];

const FACE_DOWN = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
const FACE_UP = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

const STACK_POS = new THREE.Vector3(-2.78, 0.945, 0.95);
const FLIP_POS = new THREE.Vector3(-2.1, 0.95, 0.92);
const PRESS_ENV_POS = new THREE.Vector3(LAYOUT.pressPos.x + 0.14, LAYOUT.counterTop + 0.042, LAYOUT.pressPos.z);
const CARRY_PLANE_Y = 1.03;

export interface GameCallbacks {
  onPips: (total: number, done: number) => void;
  onChildLine: (show: boolean) => void;
  onLoading: (progress: number) => void;
}

type DragKind = 'none' | 'clasp' | 'swipe' | 'lever' | 'carry' | 'cord' | 'chain';

/**
 * The whole run: a bag arrives, one letter is followed all the way out of the
 * building, then the same understanding turns into a sorting game.
 */
export class GameFlow {
  step: Step = 'boot';
  round = 1;
  oneCondition = false;

  readonly factory: EnvelopeFactory;
  readonly sorter: SorterGraph;
  readonly conveyor: ConveyorController;
  readonly press: PostmarkPress;
  readonly dispatch: DispatchSchedule;
  readonly worldMap: PhysicalWorldMap;

  private scene: THREE.Scene;
  private mats: MaterialLibrary;
  private room: PostOfficeRoom;
  private director: CameraDirector;
  private guidance: ChildGuidance;
  private audio: AudioKit;
  private cb: GameCallbacks;
  private budget: QualityBudget;

  private destModules = new Map<DestinationId, DestinationModule>();
  private letters: Envelope[] = [];
  private ambient: Envelope[] = [];
  private queue = 0;
  private active: Envelope | null = null;
  private activeBay: SorterBay | null = null;
  private arrivalBag: PostalBag | null = null;
  private closeQueue: SorterBay[] = [];
  private closingBay: SorterBay | null = null;

  private timer = 0;
  private travel = 0;
  private moveFrom = new THREE.Vector3();
  private moveTo = new THREE.Vector3();
  private moveT = 1;
  private moveDur = 1;
  private flipT = 1;
  private snapBay: SorterBay | null = null;
  private rejectedBay: SorterBay | null = null;
  private returning = false;

  private drag: DragKind = 'none';
  private dragAccum = 0;
  private dragStartPull = 0;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CARRY_PLANE_Y);
  private hitPoint = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();

  private swipePending = false;
  private stackTargets: THREE.Vector3[] = [];
  private unloadFrom = new THREE.Vector3();
  private viewport = { width: 1, height: 1 };
  private loading = false;

  constructor(
    scene: THREE.Scene,
    mats: MaterialLibrary,
    room: PostOfficeRoom,
    director: CameraDirector,
    guidance: ChildGuidance,
    audio: AudioKit,
    budget: QualityBudget,
    cb: GameCallbacks,
  ) {
    this.scene = scene;
    this.mats = mats;
    this.room = room;
    this.director = director;
    this.guidance = guidance;
    this.audio = audio;
    this.budget = budget;
    this.cb = cb;

    this.factory = new EnvelopeFactory(budget.highResFaces);
    scene.add(this.factory.group);

    this.sorter = new SorterGraph(mats);
    this.sorter.group.position.copy(LAYOUT.sorterOrigin);
    scene.add(this.sorter.group);

    this.conveyor = new ConveyorController();
    scene.add(this.conveyor.group);
    const intake = new Belt(mats, {
      length: LAYOUT.intakeBelt.toX - LAYOUT.intakeBelt.fromX,
      width: 0.62,
      height: LAYOUT.intakeBelt.height,
    });
    this.conveyor.addBelt(
      'intake',
      intake,
      new THREE.Vector3(
        (LAYOUT.intakeBelt.fromX + LAYOUT.intakeBelt.toX) / 2,
        0,
        LAYOUT.intakeBelt.z,
      ),
    );
    this.conveyor.addPath('intake', [
      new THREE.Vector3(LAYOUT.intakeBelt.fromX, LAYOUT.intakeBelt.height + 0.01, LAYOUT.intakeBelt.z),
      new THREE.Vector3(LAYOUT.bagDrop.x, LAYOUT.intakeBelt.height + 0.01, LAYOUT.intakeBelt.z),
    ]);

    this.press = new PostmarkPress(mats, {
      onInk: () => this.audio.play('inkTouch'),
      onContact: (p) => this.onPostmarkContact(p),
      onRelease: () => this.audio.play('springBack'),
      onGateOpen: () => this.onGateOpen(),
    });
    this.press.group.position.copy(LAYOUT.pressPos);
    scene.add(this.press.group);

    this.dispatch = new DispatchSchedule(mats);
    this.dispatch.group.position.copy(LAYOUT.dockOrigin);
    this.dispatch.setRackTransform(new THREE.Vector3(-1.55, 0, -3.05), -0.5);
    this.dispatch.onDoorOpen = () => this.audio.play('shutter');
    this.dispatch.onDeparted = (destination) => this.onDeparted(destination);
    this.dispatch.onStored = (destination) => this.onStored(destination);
    scene.add(this.dispatch.group);

    this.worldMap = new PhysicalWorldMap(mats);
    this.worldMap.group.position.copy(LAYOUT.mapCenter);
    scene.add(this.worldMap.group);

    this.defineShots();
  }

  // ---------------------------------------------------------------- shots

  private defineShots(): void {
    const d = this.director;
    // Each shot names the world radius that must stay in frame; the director
    // dollies back until it fits, so portrait never loses the action.
    d.define('outside', {
      pos: new THREE.Vector3(3.5, 2.7, -9.6),
      target: new THREE.Vector3(2.9, 1.7, -3.4),
      fov: 40,
      radius: 1.9,
      glide: 2.2,
      portrait: { fov: 52 },
    });
    d.define('intake', {
      pos: new THREE.Vector3(-4.6, 1.3, 2.2),
      target: new THREE.Vector3(-3.4, 0.95, 0.9),
      fov: 44,
      radius: 0.52,
      portrait: { fov: 54 },
    });
    d.define('counter', {
      pos: new THREE.Vector3(-2.2, 1.5, 2.0),
      target: new THREE.Vector3(-2.15, 0.96, 0.92),
      fov: 43,
      radius: 0.45,
      portrait: { fov: 54 },
    });
    d.define('press', {
      pos: new THREE.Vector3(-0.7, 1.62, 2.2),
      target: new THREE.Vector3(-0.66, 1.06, 0.88),
      fov: 42,
      radius: 0.5,
      portrait: { fov: 54 },
    });
    d.define('pressMacro', {
      pos: new THREE.Vector3(-0.3, 1.19, 1.5),
      target: new THREE.Vector3(-0.62, 1.0, 0.9),
      fov: 32,
      radius: 0.2,
      glide: 1.0,
      portrait: { fov: 42 },
    });
    this.refitSorterShot();
    d.define('follow', {
      pos: new THREE.Vector3(0.5, 1.2, 0.6),
      target: new THREE.Vector3(0.5, 0.8, -0.6),
      fov: 44,
      portrait: { fov: 56 },
    });
    d.define('bag', {
      pos: new THREE.Vector3(0.5, 1.35, 0.9),
      target: new THREE.Vector3(0.5, 0.45, -1.2),
      fov: 44,
      radius: 0.45,
      portrait: { fov: 56 },
    });
    d.define('dock', {
      // framed on the doorway and its pull chain, with the snow beyond
      pos: new THREE.Vector3(3.3, 1.7, 1.35),
      target: new THREE.Vector3(6.1, 1.2, 0.2),
      fov: 48,
      radius: 1.75,
      portrait: { fov: 60 },
    });
    d.define('map', {
      pos: new THREE.Vector3(-4.6, 1.95, -1.35),
      target: new THREE.Vector3(-4.6, 1.95, -4.05),
      fov: 44,
      radius: 1.6,
      glide: 1.8,
      portrait: { fov: 56 },
    });
  }

  /**
   * The overhead sorting shot has to hold every chute AND the hand-off spot the
   * letter starts from, however many chutes are open and whichever way up the
   * device is.
   */
  private refitSorterShot(): void {
    const n = this.sorter.bays.length;
    const outer = n > 0 ? Math.abs(this.sorter.bays[n - 1].group.position.x) : 0;
    const radius = Math.max(1.2, outer + 0.6);
    this.director.define('sorterOverview', {
      pos: new THREE.Vector3(0.5, 2.45, 2.25),
      target: new THREE.Vector3(0.5, 0.95, -0.15),
      fov: 50,
      radius,
      // portrait reads the line from above: chutes across, letters top to bottom
      portrait: {
        pos: new THREE.Vector3(0.5, 3.35, 2.55),
        target: new THREE.Vector3(0.5, 0.95, -0.15),
        fov: 80,
      },
    });
  }

  private defineBagShot(bay: SorterBay): void {
    const p = bay.group.getWorldPosition(new THREE.Vector3());
    this.director.define('bag', {
      pos: new THREE.Vector3(p.x, 1.35, p.z + 1.85),
      target: new THREE.Vector3(p.x, 0.45, p.z + 0.55),
      fov: 44,
      portrait: { pos: new THREE.Vector3(p.x, 1.5, p.z + 1.6), fov: 56 },
    });
  }

  setViewport(width: number, height: number): void {
    this.viewport.width = width;
    this.viewport.height = height;
  }

  /** Called on every rotation: the shelf re-ranks and the overhead shot refits. */
  setOrientation(portrait: boolean): void {
    this.sorter.setPortrait(portrait);
    this.refitSorterShot();
  }

  setBudget(b: QualityBudget): void {
    this.budget = b;
    this.room.setSnowCount(b.snowCount);
    this.room.setShadowMapSize(b.shadowMapSize);
  }

  // ---------------------------------------------------------------- rounds

  async startRound(n: number): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.round = Math.max(1, Math.min(ROUNDS.length, n));
    const plan = ROUNDS[this.round - 1];

    this.cb.onLoading(0.15);
    this.teardownRound();

    // only the destinations this round needs are ever fetched
    const mods = await loadDestinations(plan.destinations);
    mods.forEach((m) => this.destModules.set(m.id, m));
    this.cb.onLoading(0.65);

    for (const b of plan.bays) {
      const mod = this.destModules.get(b.destination)!;
      const bay = this.sorter.addBay(mod, b.dispatch, b.dispatch === 'christmas' ? 'storage' : 'dispatch');
      // a destination bag is never quite empty: the day's earlier mail is in it
      bay.bag.setLoad(this.round === 1 ? 0.3 : 0.18);
      this.worldMap.addLamp(mod.id, mod.mapUv);
    }
    this.refitSorterShot();

    const rng = new Rng(1000 + this.round * 37);
    plan.letters.forEach((l, i) => {
      const spec = makeSpec(`r${this.round}-${i}`, l.destination, l.dispatch, rng);
      const env = this.factory.create(spec, this.destModules.get(l.destination)!, plan.showSchedule);
      env.visible = false;
      this.letters.push(env);
    });

    this.spawnAmbientPaper(rng);

    this.cb.onPips(this.letters.length, 0);
    this.cb.onChildLine(false);
    this.guidance.setLevel(this.round);
    this.cb.onLoading(1);
    this.loading = false;

    this.beginArrival();
  }

  private teardownRound(): void {
    // nothing may run while the hall is being rebuilt
    this.step = 'boot';
    this.timer = 0;
    this.drag = 'none';
    this.guidance.setHint(null);
    for (const e of [...this.letters, ...this.ambient]) this.factory.release(e);
    this.letters = [];
    this.ambient = [];
    this.queue = 0;
    this.active = null;
    this.activeBay = null;
    this.snapBay = null;
    this.closeQueue = [];
    this.closingBay = null;
    this.sorter.clear();
    this.press.reset();
    this.dispatch.reset();
    if (this.arrivalBag) {
      this.scene.remove(this.arrivalBag.group);
      this.arrivalBag.dispose();
      this.arrivalBag = null;
    }
  }

  /** Loose letters already lying in the counter tray: paper count, not new mechanics. */
  private spawnAmbientPaper(rng: Rng): void {
    const mods = [...this.destModules.values()];
    if (!mods.length) return;
    const budgetLeft = Math.max(0, 30 - this.letters.length);
    const n = Math.min(this.budget.ambientPaper, budgetLeft);
    for (let i = 0; i < n; i++) {
      const mod = mods[i % mods.length];
      const spec = makeSpec(`amb-${i}`, mod.id, 'today', rng);
      const env = this.factory.create(spec, mod, false);
      env.position.set(
        LAYOUT.inTray.x + rng.range(-0.012, 0.012),
        LAYOUT.inTray.y + 0.012 + i * 0.0018,
        LAYOUT.inTray.z + rng.range(-0.012, 0.012),
      );
      env.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, rng.range(-0.05, 0.05), 0));
      this.ambient.push(env);
    }
  }

  private beginArrival(): void {
    this.arrivalBag = new PostalBag(this.mats, { withClasp: true, snow: true });
    this.arrivalBag.setLoad(this.letters.length >= 4 ? 0.75 : 0.45);
    this.arrivalBag.group.position.set(
      LAYOUT.intakeBelt.fromX,
      LAYOUT.intakeBelt.height + 0.012,
      LAYOUT.intakeBelt.z,
    );
    this.scene.add(this.arrivalBag.group);

    this.conveyor.setSpeed('intake', 1);
    this.audio.setBeltRunning(true);
    this.step = 'bagArriving';
    this.timer = 0;
    this.director.cut('outside');
    this.guidance.setHint(null);
  }

  // ---------------------------------------------------------------- update

  update(dt: number, elapsed: number): void {
    this.press.update(dt);
    this.sorter.update(dt);
    this.conveyor.update(dt);
    this.dispatch.update(dt);
    this.worldMap.update(dt);
    this.arrivalBag?.meltSnow(dt);
    this.guidance.update(dt);

    this.advanceMove(dt);
    this.stepLogic(dt, elapsed);

    // the paper never quite forgets the die
    if (this.active?.postmarked && this.step !== 'press') {
      this.active.sink += (0.12 - this.active.sink) * Math.min(1, dt * 3);
    }

    this.factory.update();
  }

  private advanceMove(dt: number): void {
    if (this.moveT >= 1) return;
    this.moveT = Math.min(1, this.moveT + dt / this.moveDur);
    const k = smooth(this.moveT);
    if (this.active) {
      this.active.position.lerpVectors(this.moveFrom, this.moveTo, k);
    }
  }

  private moveActive(to: THREE.Vector3, dur: number): void {
    if (!this.active) return;
    this.moveFrom.copy(this.active.position);
    this.moveTo.copy(to);
    this.moveT = 0;
    this.moveDur = dur;
  }

  private stepLogic(dt: number, elapsed: number): void {
    switch (this.step) {
      case 'bagArriving': {
        const bag = this.arrivalBag;
        if (!bag) break;
        this.timer += dt;
        const t = Math.min(1, this.timer / 4.6);
        this.conveyor.point('intake', smooth(t), this.tmp);
        bag.group.position.copy(this.tmp);
        if (this.timer > 1.6 && this.director.shot === 'outside') this.director.go('intake');
        if (t >= 1) {
          this.conveyor.setSpeed('intake', 0);
          this.audio.setBeltRunning(false);
          this.step = 'bagClasp';
          this.guidance.setHint((time, amt) => {
            const c = bag.claspGroup;
            if (!c) return;
            c.position.x = Math.sin(time * 3.4) * 0.02 * amt;
            c.rotation.z = Math.sin(time * 3.4 + 0.6) * 0.06 * amt;
          });
        }
        break;
      }

      case 'unloading': {
        this.timer += dt;
        const k = smooth(Math.min(1, this.timer / 0.7));
        this.letters.forEach((env, i) => {
          const target = this.stackTargets[i];
          if (!target) return;
          const lag = Math.max(0, Math.min(1, k * 1.4 - i * 0.08));
          env.position.lerpVectors(this.unloadFrom, target, lag);
          env.position.y += Math.sin(lag * Math.PI) * 0.035;
        });
        if (this.timer > 0.85) {
          this.step = 'flip';
          this.prepareNextLetter();
        }
        break;
      }

      case 'flip': {
        if (this.flipT < 1 && this.active) {
          this.flipT = Math.min(1, this.flipT + dt * 2.2);
          const k = smooth(this.flipT);
          this.tmpQ.slerpQuaternions(FACE_DOWN, FACE_UP, k);
          this.active.quaternion.copy(this.tmpQ);
          this.active.position.y = FLIP_POS.y + Math.sin(k * Math.PI) * 0.055;
          this.active.bend = Math.sin(k * Math.PI) * 0.9;
          if (this.flipT >= 1) {
            this.active.bend = 0.12;
            this.step = 'toPress';
            this.timer = 0;
            this.moveActive(PRESS_ENV_POS, 1.5);
            this.conveyor.setSpeed('intake', 0);
            this.audio.play('slide');
            this.director.go('press');
            this.guidance.setHint(null);
          }
        }
        break;
      }

      case 'toPress': {
        if (this.moveT >= 1) {
          this.step = 'press';
          this.press.wake();
          this.audio.play('leverUp');
          this.director.go('press');
          this.guidance.setHint((time, amt) => {
            if (this.press.phase === 'ready' && amt > 0.01) {
              this.press.setPull(Math.max(0, Math.sin(time * 2.6)) * 0.09 * amt);
            }
          });
        }
        break;
      }

      case 'press': {
        if (this.active) {
          this.active.sink = this.press.paperSink * 0.9;
        }
        if (this.press.phase === 'striking' && this.director.shot !== 'pressMacro') {
          this.director.go('pressMacro');
        }
        break;
      }

      case 'toHandoff': {
        if (this.moveT >= 1) {
          this.step = 'carry';
          this.director.go('sorterOverview');
          this.setupCarryGuidance();
        }
        break;
      }

      case 'carry': {
        if (this.returning && this.moveT >= 1) this.returning = false;
        break;
      }

      case 'chute': {
        const bay = this.activeBay;
        const env = this.active;
        if (!bay || !env) break;
        this.travel = Math.min(1, this.travel + dt * 0.42);
        bay.pointAt(this.travel, this.tmp);
        env.position.copy(this.tmp);
        // the sheet keeps its own orientation through chute, belt and gate
        const tilt = this.travel < 0.35 ? -1.1 + this.travel * 1.2 : -0.62 + (this.travel - 0.35) * 0.7;
        env.quaternion.setFromEuler(new THREE.Euler(tilt, 0, Math.sin(this.travel * 7) * 0.06));
        env.bend = 0.35 + Math.sin(this.travel * 9) * 0.12;
        if (this.travel > 0.94 && env.visible) {
          env.visible = false;
          env.filedIn = bay.id;
          bay.filed.push(env);
          bay.bag.setLoad(Math.min(1, bay.bag.loadAmount + 0.22));
          bay.setWindowOpen(0);
          bay.runBelt(false);
          this.audio.play('snap');
          this.cb.onPips(this.letters.length, this.queue);
        }
        if (this.travel >= 1) {
          this.director.stopFollow();
          this.factory.demote(env);
          this.active = null;
          this.activeBay = null;
          this.step = 'betweenLetters';
          this.timer = 0;
        }
        break;
      }

      case 'betweenLetters': {
        this.timer += dt;
        if (this.timer > 0.9) {
          if (this.queue < this.letters.length) {
            // the next letter also lands face down on the counter, not at the press
            this.prepareNextLetter();
          } else {
            this.beginClosing();
          }
        }
        break;
      }

      case 'departing':
      case 'dispatch':
      case 'closeBag':
      case 'map':
        break;

      case 'roundEnd': {
        this.timer += dt;
        if (this.round < ROUNDS.length && this.timer > (this.round === 1 ? 5.5 : 3.2)) {
          this.timer = -999;
          this.cb.onChildLine(false);
          void this.startRound(this.round + 1);
        }
        break;
      }

      default:
        break;
    }

    void elapsed;
  }

  // ---------------------------------------------------------------- beats

  private prepareNextLetter(): void {
    const env = this.letters[this.queue];
    this.active = env;
    this.queue++;
    env.visible = true;
    env.position.copy(FLIP_POS);
    env.quaternion.copy(FACE_DOWN);
    env.bend = 0;
    env.sink = 0;
    env.fold = env.spec.fold * 0.5;
    this.factory.promote(env);
    this.moveT = 1;
    this.press.reset();
    this.waitForSwipe();
  }

  /** The letter lands face down. One big swipe turns it over - no angle required. */
  private waitForSwipe(): void {
    this.step = 'flip';
    this.flipT = 1;
    this.swipePending = true;
    this.director.go('counter');
    const env = this.active!;
    this.guidance.setHint((time, amt) => {
      env.bend = Math.max(0, Math.sin(time * 2.4)) * 0.55 * amt;
    });
  }

  private doFlip(): void {
    if (!this.active) return;
    this.swipePending = false;
    this.flipT = 0;
    this.audio.play('slide');
    this.guidance.setHint(null);
    this.guidance.poke();
  }

  private onPostmarkContact(pressure: number): void {
    if (!this.active) return;
    this.factory.stamp(this.active, pressure);
    this.audio.play('strike');
  }

  private onGateOpen(): void {
    this.audio.play('gate');
    if (this.step !== 'press') return;
    this.step = 'toHandoff';
    this.moveActive(new THREE.Vector3(LAYOUT.handoffPos.x, LAYOUT.handoffPos.y, LAYOUT.handoffPos.z), 1.2);
    this.director.go('press');

    // the first time, one metal placard lifts and that chute opens
    if (this.round === 1 && this.active) {
      const bay = this.sorter.baysFor(this.active.destination)[0];
      if (bay) {
        bay.raisePlacard(1);
        bay.setWindowOpen(1);
        this.audio.play('window');
      }
    }
  }

  private setupCarryGuidance(): void {
    const env = this.active;
    if (!env) return;
    const bays = this.sorter.bays.filter((b) => b.accepts(env, this.oneCondition));
    this.guidance.setHint((time, amt) => {
      for (const b of bays) b.raisePlacard(this.round === 1 ? 1 : amt * 0.75);
      env.position.y = CARRY_PLANE_Y - 0.06 + Math.sin(time * 2.2) * 0.012 * amt;
    });
  }

  private beginClosing(): void {
    this.closeQueue = this.sorter.bays.filter((b) => b.filed.length > 0);
    this.guidance.setHint(null);
    this.nextClosing();
  }

  private nextClosing(): void {
    const bay = this.closeQueue.shift() ?? null;
    this.closingBay = bay;
    if (!bay) {
      this.finishRound();
      return;
    }
    this.step = 'closeBag';
    this.defineBagShot(bay);
    this.director.go('bag');
    this.guidance.setHint((time, amt) => {
      bay.bag.cordMesh.rotation.z = Math.sin(time * 2.6) * 0.14 * amt;
    });
  }

  private sealAndDispatch(bay: SorterBay): void {
    const kind: DispatchKind = bay.key.dispatch ?? 'today';
    bay.bag.setClosed(1);
    bay.bag.attachSeal(kind);
    this.audio.play('cord');
    this.guidance.setHint(null);

    if (kind === 'today') {
      this.step = 'dispatch';
      this.director.go('dock');
      this.guidance.setHint((time, amt) => {
        this.dispatch.chainGrip.position.y = 1.78 - Math.max(0, Math.sin(time * 2.8)) * 0.06 * amt;
      });
    } else {
      this.step = 'departing';
      this.dispatch.dispatchBag(bay.bag.group, kind, bay.key.destination);
      this.audio.play('wheel');
      this.defineBagShot(bay);
      this.director.go('dock');
    }
  }

  private onDeparted(destination: DestinationId): void {
    this.audio.play('engine');
    this.worldMap.routeTo(destination);
    this.step = 'map';
    this.director.go('map');
    this.timer = 0;
    window.setTimeout(() => {
      this.audio.play('lamp');
      this.nextClosing();
    }, 3400);
  }

  private onStored(destination: DestinationId): void {
    this.worldMap.markKept(destination);
    this.audio.play('wheel');
    window.setTimeout(() => this.nextClosing(), 1600);
  }

  private finishRound(): void {
    this.step = 'roundEnd';
    this.timer = 0;
    this.director.go('map');
    this.cb.onPips(this.letters.length, this.letters.length);
    if (this.round === 1) this.cb.onChildLine(true);
  }

  // ---------------------------------------------------------------- input

  onPointerDown(p: PointerSample, camera: THREE.Camera): void {
    this.guidance.poke();
    this.raycaster.setFromCamera(p.ndc, camera);
    this.dragAccum = 0;

    if (this.step === 'bagClasp' && this.arrivalBag?.claspGroup) {
      if (this.raycaster.intersectObject(this.arrivalBag.claspGroup, true).length) {
        this.drag = 'clasp';
        return;
      }
    }

    if (this.step === 'flip' && this.swipePending && this.active?.group) {
      if (this.raycaster.intersectObject(this.active.group, true).length) {
        this.drag = 'swipe';
        return;
      }
    }

    if (this.step === 'press' && this.press.isInteractive) {
      if (this.raycaster.intersectObject(this.press.handleHit, true).length) {
        this.drag = 'lever';
        this.dragStartPull = this.press.pull;
        this.press.beginPull();
        return;
      }
    }

    if (this.step === 'carry' && this.active?.group && !this.returning) {
      if (this.raycaster.intersectObject(this.active.group, true).length) {
        this.drag = 'carry';
        return;
      }
    }

    if (this.step === 'closeBag' && this.closingBay) {
      const bag = this.closingBay.bag;
      if (this.raycaster.intersectObject(bag.cordHit, true).length) {
        this.drag = 'cord';
        return;
      }
    }

    if (this.step === 'dispatch') {
      if (this.raycaster.intersectObject(this.dispatch.chainHit, true).length) {
        this.drag = 'chain';
        return;
      }
    }

    this.drag = 'none';
  }

  onPointerMove(p: PointerSample, camera: THREE.Camera): void {
    if (this.drag === 'none') return;
    this.guidance.poke();

    switch (this.drag) {
      case 'clasp': {
        this.dragAccum += p.dx;
        const k = THREE.MathUtils.clamp(this.dragAccum / 90, 0, 1);
        const c = this.arrivalBag?.claspGroup;
        if (c) {
          c.position.x = k * 0.22;
          c.rotation.z = -k * 0.5;
        }
        if (k >= 1) this.openBag();
        break;
      }
      case 'swipe': {
        this.dragAccum += Math.abs(p.dx) + Math.abs(p.dy) * 0.3;
        if (this.active) this.active.bend = Math.min(0.8, this.dragAccum / 120);
        if (this.dragAccum > 70) {
          this.drag = 'none';
          this.doFlip();
        }
        break;
      }
      case 'lever': {
        this.dragAccum += p.dy;
        this.press.setPull(this.dragStartPull + this.dragAccum / 150);
        break;
      }
      case 'carry': {
        this.raycaster.setFromCamera(p.ndc, camera);
        if (this.raycaster.ray.intersectPlane(this.plane, this.hitPoint)) {
          this.dragCarry(this.hitPoint);
        }
        break;
      }
      case 'cord': {
        this.dragAccum += p.dy;
        const bay = this.closingBay;
        if (bay) {
          const k = THREE.MathUtils.clamp(this.dragAccum / 110, 0, 1);
          bay.bag.setClosed(k * 0.98);
          if (k >= 1) {
            this.drag = 'none';
            this.sealAndDispatch(bay);
          }
        }
        break;
      }
      case 'chain': {
        this.dragAccum += p.dy;
        const k = THREE.MathUtils.clamp(this.dragAccum / 110, 0, 1);
        this.dispatch.setChainPull(k);
        if (k >= 1) {
          this.drag = 'none';
          this.pullDockChain();
        }
        break;
      }
      default:
        break;
    }
  }

  onPointerUp(): void {
    if (this.drag === 'lever') this.press.endPull();
    if (this.drag === 'carry') this.dropCarried();
    if (this.drag === 'cord' && this.closingBay) this.closingBay.bag.setClosed(0);
    if (this.drag === 'chain') this.dispatch.releaseChain();
    this.drag = 'none';
  }

  private dragCarry(point: THREE.Vector3): void {
    const env = this.active;
    if (!env) return;
    env.position.set(point.x, CARRY_PLANE_Y, point.z);
    env.quaternion.setFromEuler(new THREE.Euler(-1.15, 0, 0));

    const near = this.sorter.nearest(env.position, 0.55);
    if (near !== this.snapBay) {
      if (this.snapBay && this.snapBay !== near) {
        this.snapBay.setWindowOpen(0);
      }
      this.snapBay = near;
      this.rejectedBay = null;
    }
    if (near) {
      near.worldSnapPoint(this.tmp);
      env.position.lerp(this.tmp, 0.55);
      if (near.accepts(env, this.oneCondition)) {
        if (!near.windowIsOpen) {
          near.setWindowOpen(1);
          this.audio.play('window');
        }
      } else if (this.rejectedBay !== near) {
        // no penalty: the little window simply stays shut
        this.rejectedBay = near;
        near.setWindowOpen(0);
        this.audio.play('reject');
      }
    }
  }

  private dropCarried(): void {
    const env = this.active;
    if (!env) return;
    const bay = this.snapBay;
    if (bay && bay.accepts(env, this.oneCondition)) {
      this.activeBay = bay;
      this.travel = 0;
      this.step = 'chute';
      bay.runBelt(true);
      this.audio.play('chute');
      this.guidance.setHint(null);
      const offset = this.director.isPortrait
        ? new THREE.Vector3(0.1, 0.42, 0.66)
        : new THREE.Vector3(0.26, 0.3, 0.72);
      this.director.follow(env.group!, offset);
    } else {
      this.snapBay?.setWindowOpen(0);
      this.snapBay = null;
      this.returning = true;
      this.moveActive(LAYOUT.handoffPos.clone(), 0.7);
    }
  }

  private openBag(): void {
    if (this.step !== 'bagClasp') return;
    this.drag = 'none';
    this.audio.play('clasp');
    this.guidance.setHint(null);
    const bag = this.arrivalBag!;
    if (bag.claspGroup) bag.claspGroup.visible = false;
    bag.group.rotation.z = -0.16;

    // the letters slide out of the mouth onto the wooden counter
    bag.mouthAnchor.getWorldPosition(this.unloadFrom);
    this.unloadFrom.y -= 0.08;
    this.stackTargets = this.letters.map(
      (_, i) => new THREE.Vector3(STACK_POS.x + i * 0.014, STACK_POS.y + i * 0.0017, STACK_POS.z + i * 0.008),
    );
    this.letters.forEach((env, i) => {
      env.visible = true;
      env.position.copy(this.unloadFrom);
      env.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, i * 0.05 - 0.05, 0));
    });
    this.audio.play('slide');
    this.step = 'unloading';
    this.timer = 0;
    this.director.go('counter');
  }

  private pullDockChain(): void {
    this.dispatch.releaseChain();
    const bay = this.closingBay;
    if (!bay) return;
    this.step = 'departing';
    this.dispatch.dispatchBag(bay.bag.group, 'today', bay.key.destination);
    this.guidance.setHint(null);
  }

  // ---------------------------------------------------------------- api

  setOneCondition(v: boolean): void {
    this.oneCondition = v;
  }

  replay(): void {
    this.cb.onChildLine(false);
    void this.startRound(1);
  }

  /** Test-only entry point; nothing in the interface reaches it. */
  jumpToRound(n: number): void {
    this.cb.onChildLine(false);
    void this.startRound(n);
  }

  /** Small, read-only surface used by the automated sorting test. */
  testState(): Record<string, unknown> {
    return {
      round: this.round,
      step: this.step,
      oneCondition: this.oneCondition,
      letters: this.letters.length,
      filedTotal: this.sorter.bays.reduce((a, b) => a + b.filed.length, 0),
      swipePending: this.swipePending,
      activeDestination: this.active?.destination ?? null,
      activeDispatch: this.active?.dispatch ?? null,
      postmarked: this.active?.postmarked ?? false,
      pressPhase: this.press.phase,
      bays: this.sorter.bays.map((b) => ({
        id: b.id,
        destination: b.key.destination,
        dispatch: b.key.dispatch,
        filed: b.filed.length,
        load: Number(b.bag.loadAmount.toFixed(3)),
        closed: b.bag.closed,
        sealed: b.bag.sealed,
        windowOpen: b.windowIsOpen,
      })),
      lamps: [...this.destModules.keys()].filter((id) => this.worldMap.isLit(id)),
      doorOpen: Number(this.dispatch.doorAmount.toFixed(2)),
    };
  }

  /** Screen position of whatever the child should be able to touch right now. */
  testPoint(id: string): { x: number; y: number } | null {
    const w = this.viewport.width;
    const h = this.viewport.height;
    const grab = (o: THREE.Object3D | null | undefined) => {
      if (!o) return null;
      o.getWorldPosition(this.tmp);
      const p = this.director.project(this.tmp, w, h);
      return { x: p.x, y: p.y };
    };

    if (id === 'clasp') return grab(this.arrivalBag?.claspGroup);
    if (id === 'envelope') return grab(this.active?.group);
    if (id === 'lever') return grab(this.press.handleHit);
    if (id === 'cord') return grab(this.closingBay?.bag.cordHit);
    if (id === 'chain') return grab(this.dispatch.chainHit);
    if (id.startsWith('bay:')) {
      const bay = this.sorter.bayById(id.slice(4));
      if (!bay) return null;
      bay.worldSnapPoint(this.tmp);
      const p = this.director.project(this.tmp, w, h);
      return { x: p.x, y: p.y };
    }
    return null;
  }

  /** The bay the active letter belongs in, under the current rule. */
  testTargetBayId(): string | null {
    const env = this.active;
    if (!env) return null;
    const bay = this.sorter.bays.find((b) => b.accepts(env, this.oneCondition));
    return bay?.id ?? null;
  }

  testWrongBayId(): string | null {
    const env = this.active;
    if (!env) return null;
    const bay = this.sorter.bays.find((b) => !b.accepts(env, this.oneCondition));
    return bay?.id ?? null;
  }
}

function makeSpec(id: string, destination: DestinationId, dispatch: DispatchKind, rng: Rng): EnvelopeSpec {
  const tones: [number, number, number][] = [
    [238, 229, 206],
    [230, 221, 199],
    [242, 236, 219],
    [225, 214, 190],
    [234, 224, 205],
  ];
  return {
    id,
    destination,
    dispatch,
    width: rng.range(0.195, 0.235),
    height: rng.range(0.104, 0.124),
    seed: rng.int(2, 90000),
    tone: rng.pick(tones),
    fibre: rng.range(0.6, 1.5),
    wear: rng.range(0.4, 1.3),
    stampCorner: rng.next() > 0.5 ? 0 : 1,
    fold: rng.range(0, 1),
  };
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
