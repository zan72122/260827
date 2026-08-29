import {
  ACESFilmicToneMapping,
  Clock,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { AdaptiveQuality } from '../core/AdaptiveQuality';
import { AudioDirector } from '../core/AudioDirector';
import { MaterialLibrary } from '../materials/MaterialLibrary';
import { TreeHierarchy } from '../tree/TreeHierarchy';
import { BranchRelease } from '../tree/BranchRelease';
import { CraneKinematics } from '../world/Crane';
import { Plaza } from '../world/Plaza';
import { Trailer } from '../world/Trailer';
import { Workers, type Station } from '../world/Workers';
import { Console as OperatorConsole } from '../world/Console';
import { Sky } from '../world/Sky';
import { SlingAndTaglineRig } from '../rig/SlingAndTaglineRig';
import { BaseSocket } from '../rig/BaseSocket';
import { GuyWireTension } from '../rig/GuyWireTension';
import { CameraDirector, type ShotName } from '../camera/CameraDirector';
import { Hud, type ControlSpec } from '../ui/Hud';
import { clamp, damp, lerp, moveTowards, smoothstep } from '../core/math';
import type { LightHarness, LightingSequence, StarHoist } from '../lights';

export type Phase =
  | 'arrival'
  | 'rigging'
  | 'raising'
  | 'seating'
  | 'plumbing'
  | 'release'
  | 'harness'
  | 'star'
  | 'test'
  | 'ceremony'
  | 'finale';

const PHASE_ORDER: Phase[] = [
  'arrival',
  'rigging',
  'raising',
  'seating',
  'plumbing',
  'release',
  'harness',
  'star',
  'test',
  'ceremony',
  'finale',
];

const STEP_LABELS = [
  '荷おろし',
  '吊具',
  '起立',
  '据付',
  '鉛直',
  '枝の解放',
  '照明線',
  '星',
  '区画試験',
  '点灯',
  '完成',
];

/** Time of day each phase settles at: one continuous slide, never a cut. */
const PHASE_TIME: Record<Phase, number> = {
  arrival: 0.14,
  rigging: 0.22,
  raising: 0.3,
  seating: 0.42,
  plumbing: 0.52,
  release: 0.6,
  harness: 0.7,
  star: 0.79,
  test: 0.87,
  ceremony: 0.94,
  finale: 1.0,
};

const SHOT_FOR_PHASE: Record<Phase, ShotName> = {
  arrival: 'arrival',
  rigging: 'rigging',
  raising: 'raising',
  seating: 'seating',
  plumbing: 'plumbing',
  release: 'release',
  harness: 'harness',
  star: 'star',
  test: 'test',
  ceremony: 'ceremony',
  finale: 'finale',
};

const STATION_FOR_PHASE: Record<Phase, Station> = {
  arrival: 'rigging',
  rigging: 'rigging',
  raising: 'raising',
  seating: 'seating',
  plumbing: 'plumbing',
  release: 'release',
  harness: 'harness',
  star: 'star',
  test: 'harness',
  ceremony: 'ceremony',
  finale: 'ceremony',
};

interface PlumbRound {
  tensions: [number, number, number];
  guided: boolean;
}

const PLUMB_ROUNDS: PlumbRound[] = [
  // First lean is a single slack leg, and the drum to turn is pointed out.
  { tensions: [0.78, 0.78, 0.3], guided: true },
  // Second lean is in another direction, with no hint.
  { tensions: [0.32, 0.8, 0.78], guided: false },
  // Third needs two drums trimmed a little each.
  { tensions: [0.55, 0.92, 0.7], guided: false },
];

const SEAT_HEIGHT = 0.14;
const RAISE_RATE = 0.12; // rad/s, the safe hoist speed
const SEAT_RATE = 0.11;
const STAR_RATE = 0.085;

/**
 * The whole build, wired together.
 *
 * The chain is one continuous piece of work: rig, raise, seat, plumb, unstrap,
 * light, star, test, switch on. No step is skipped by a cut, and every step
 * ends in a state the next one starts from.
 */
export class Game {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly quality: AdaptiveQuality;
  readonly materials: MaterialLibrary;
  readonly director: CameraDirector;
  readonly audio = new AudioDirector();
  readonly hud: Hud;

  readonly tree: TreeHierarchy;
  readonly crane: CraneKinematics;
  readonly plaza: Plaza;
  readonly trailer: Trailer;
  readonly workers: Workers;
  readonly operatorConsole: OperatorConsole;
  readonly sky: Sky;
  readonly rig: SlingAndTaglineRig;
  readonly socket: BaseSocket;
  readonly guys: GuyWireTension;
  readonly straps: BranchRelease;

  harness: LightHarness | null = null;
  star: StarHoist | null = null;
  lighting: LightingSequence | null = null;

  phase: Phase = 'arrival';
  phaseTime = 0;
  /** Debug/test accelerator: runs N simulation steps per rendered frame. */
  timeScale = 1;
  private readonly clock = new Clock();
  private readonly buttStart = new Vector3(-6.5, 1.42, 9.0);
  private readonly socketPos = new Vector3(0, 0, 0);
  private readonly consolePos = new Vector3(2.5, 0, 26);
  /** Sector distribution board, so the camera can find it during the test. */
  private readonly boardPos = new Vector3(3.4, 0.6, 3.0);
  private readonly hookTarget = new Vector3();
  private readonly hookWorld = new Vector3();
  private readonly tmp = new Vector3();
  private readonly ctxButt = new Vector3();
  private readonly ctxTip = new Vector3();
  private readonly ctxStar = new Vector3();

  private held = new Set<string>();
  private rigProgress = 0;
  private raiseAngle = 0;
  private seatT = 0;
  private seated = false;
  private clampT = 0;
  private trim = 0;
  private strapPull = 0;
  private plumbRound = 0;
  private plumbHold = 0;
  private starLoaded = false;
  private harnessRequested = false;
  private ceremonyStage = 0;
  private ceremonyTimer = 0;
  private trailerShift = 0;
  private timeOfDay = PHASE_TIME.arrival;
  private elapsed = 0;
  private lastFrameMs = 16;
  private frameCount = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.quality = new AdaptiveQuality(this.renderer);
    const profile = this.quality.profile;
    this.renderer.shadowMap.enabled = profile.shadows;

    this.materials = new MaterialLibrary(profile);
    this.sky = new Sky(this.scene, this.renderer, profile);

    this.plaza = new Plaza(this.materials, profile);
    this.scene.add(this.plaza.group);

    this.trailer = new Trailer(this.materials, profile, new Vector3(-4.5, 0, 9.0));
    this.scene.add(this.trailer.group);

    this.tree = new TreeHierarchy(this.materials, profile);
    this.tree.root.position.copy(this.buttStart);
    this.scene.add(this.tree.root);

    this.crane = new CraneKinematics(this.materials, profile, new Vector3(-10, 0, -11));
    this.scene.add(this.crane.root, this.crane.rope);

    this.socket = new BaseSocket(this.materials, profile, this.tree.buttRadius, this.socketPos);
    this.scene.add(this.socket.group);

    this.rig = new SlingAndTaglineRig(this.tree, this.materials);
    this.scene.add(this.rig.group);

    this.guys = new GuyWireTension(this.tree, this.materials, this.socketPos);
    this.guys.setEngaged(0);
    this.scene.add(this.guys.group);

    this.straps = new BranchRelease(this.tree, this.materials);
    this.scene.add(this.straps.group);

    this.workers = new Workers(this.materials, this.buttStart, this.socketPos);
    this.scene.add(this.workers.group);

    this.operatorConsole = new OperatorConsole(this.materials, this.consolePos, Math.PI);
    this.scene.add(this.operatorConsole.group);

    this.director = new CameraDirector(window.innerWidth / window.innerHeight);
    this.hud = new Hud(hudRoot, STEP_LABELS);
    this.hud.onHold = (id, active) => this.onHold(id, active);
    this.hud.onDrag = (id, delta) => this.onDrag(id, delta);
    this.hud.onPress = (id) => this.onPress(id);

    void this.loadOptionalProps();

    this.sky.setTime(this.timeOfDay);
    this.plaza.setEvening(this.timeOfDay);
    this.plaza.setCrowdFill(0.08);
    this.resize();
    this.enterPhase('arrival');
  }

  /**
   * Authored props are optional: if a compressed GLB has been dropped into
   * public/assets it is loaded and added to the square, otherwise the
   * procedural plaza stands on its own and the build ships without placeholder
   * art. The GLB/KTX2/Meshopt loader is only fetched when there is something
   * for it to load, so an install without extras pays nothing for it.
   */
  private async loadOptionalProps(): Promise<void> {
    const url = './assets/plaza-extras.glb';
    const present = await fetch(url, { method: 'HEAD' })
      .then((res) => res.ok)
      .catch(() => false);
    if (!present) return;
    const { AssetLibrary } = await import('../core/Assets');
    const group = await new AssetLibrary(this.renderer).optional(url);
    if (group) this.plaza.group.add(group);
  }

  /* ---------------------------------------------------------------- input -- */

  private onHold(id: string, active: boolean): void {
    if (active) this.held.add(id);
    else this.held.delete(id);
    void this.audio.start();
  }

  private onDrag(id: string, delta: number): void {
    void this.audio.start();
    switch (id) {
      case 'hook':
        this.rigProgress = clamp(this.rigProgress + delta * 0.55, 0, 1);
        this.hud.updateControl('hook', this.rigProgress);
        break;
      case 'trimL':
        this.trim = clamp(this.trim - delta * 0.06, -0.16, 0.16);
        break;
      case 'trimR':
        this.trim = clamp(this.trim + delta * 0.06, -0.16, 0.16);
        break;
      case 'tag':
        this.rig.tagPull = clamp(this.rig.tagPull + delta * 0.5, -1, 1);
        break;
      case 'drum0':
      case 'drum1':
      case 'drum2': {
        const index = Number(id.slice(4));
        this.guys.windDrum(index, -delta * 0.22);
        if (Math.random() < 0.25) this.audio.click(900 + index * 120, 0.06);
        break;
      }
      case 'strap':
        this.strapPull = clamp(this.strapPull + Math.abs(delta) * 0.9, 0, 1.2);
        this.hud.updateControl('strap', this.strapPull);
        if (this.strapPull >= 1) {
          this.strapPull = 0;
          if (this.straps.releaseNext()) this.audio.click(620, 0.2);
          this.hud.updateControl('strap', 0);
        }
        break;
      case 'reel':
        if (this.harness) {
          this.harness.payOut = clamp(this.harness.payOut + Math.abs(delta) * 0.32, 0, 1);
          this.hud.updateControl('reel', this.harness.payOut);
          this.audio.setWinch(true);
        }
        break;
      case 'plug':
        if (this.lighting) {
          this.strapPull = clamp(this.strapPull + Math.abs(delta) * 0.8, 0, 1.2);
          this.hud.updateControl('plug', this.strapPull);
          if (this.strapPull >= 1) {
            this.strapPull = 0;
            this.lighting.repairFault();
            this.audio.click(520, 0.28);
          }
        }
        break;
      default:
        break;
    }
  }

  private onPress(id: string): void {
    void this.audio.start();
    switch (id) {
      case 'begin':
        this.setPhase('rigging');
        break;
      case 'test':
        this.lighting?.beginTest();
        this.audio.click(1200, 0.14);
        break;
      case 'enable':
        if (this.ceremonyStage >= 3 && this.lighting && this.lighting.state !== 'lit') {
          this.lighting.illuminate();
          this.operatorConsole.setHandle(1);
          this.audio.swell();
        }
        break;
      case 'replay':
        this.reset();
        break;
      default:
        break;
    }
  }

  /* --------------------------------------------------------------- phases -- */

  private setPhase(next: Phase): void {
    if (this.phase === next) return;
    this.phase = next;
    this.phaseTime = 0;
    this.enterPhase(next);
  }

  private enterPhase(phase: Phase): void {
    this.director.setShot(SHOT_FOR_PHASE[phase]);
    this.workers.setStation(STATION_FOR_PHASE[phase]);
    this.hud.setSteps(PHASE_ORDER.indexOf(phase));
    this.hud.hideLamps();
    this.hud.showBanner('', false);

    switch (phase) {
      case 'arrival':
        this.hud.setControls([]);
        this.hud.setHint('ながい みどりの にもつが とどきました');
        break;
      case 'rigging':
        this.hud.setControls([
          { id: 'hook', kind: 'dragY', icon: 'hook', label: 'つりぐを おろす' },
        ]);
        this.hud.setHint('ハンドルを した へ なでて フックを おろそう');
        break;
      case 'raising':
        this.hud.setControls([
          { id: 'hoist', kind: 'hold', icon: 'lever', label: 'つりあげ', tone: 'primary' },
          { id: 'trimL', kind: 'wheel', icon: 'drum', label: 'ひだり びちょうせい', tone: 'trim' },
          { id: 'trimR', kind: 'wheel', icon: 'drum', label: 'みぎ びちょうせい', tone: 'trim' },
          { id: 'tag', kind: 'dragX', icon: 'tagline', label: 'タグライン', tone: 'trim' },
        ]);
        this.hud.setHint('レバーを ながく おして ゆっくり おこそう');
        break;
      case 'seating':
        this.hud.setControls([
          { id: 'hoist', kind: 'hold', icon: 'lever', label: 'おろして すえつけ', tone: 'primary' },
        ]);
        this.hud.setHint('はがねの うけに そっと おろそう');
        break;
      case 'plumbing':
        this.guys.setEngaged(1);
        this.startPlumbRound(0);
        break;
      case 'release':
        this.hud.setControls([
          { id: 'strap', kind: 'dragX', icon: 'strap', label: 'ほごたいを ひく', tone: 'primary' },
        ]);
        this.hud.setHint('したから じゅんばんに ほごたいを ひこう');
        break;
      case 'harness':
        this.hud.setHint('リールを まわして しょうめいせんを だそう');
        void this.loadLights();
        break;
      case 'star':
        this.hud.setControls([
          { id: 'hoist', kind: 'hold', icon: 'star', label: 'ほしを つりあげる', tone: 'primary' },
        ]);
        this.hud.setHint('ほしを てっぺんまで はこぼう');
        break;
      case 'test':
        this.hud.setControls([{ id: 'test', kind: 'press', icon: 'plug', label: 'くかく しけん' }]);
        this.hud.setHint('あかりが したから うえへ すすむか ためそう');
        break;
      case 'ceremony':
        this.ceremonyStage = 0;
        this.ceremonyTimer = 0;
        this.hud.setControls([]);
        this.hud.setLamps(0);
        this.hud.setHint('ランプが みっつ ついたら ハンドルを おそう');
        break;
      case 'finale':
        this.hud.setControls([{ id: 'replay', kind: 'press', icon: 'replay', label: 'もういちど' }]);
        this.hud.setHint('まちの ツリーが ともりました');
        this.hud.showBanner('てんとう かんりょう', true);
        break;
    }
  }

  private startPlumbRound(index: number): void {
    this.plumbRound = index;
    this.plumbHold = 0;
    const round = PLUMB_ROUNDS[index];
    for (let i = 0; i < 3; i++) this.guys.setTension(i, round.tensions[i]);
    const controls: ControlSpec[] = [0, 1, 2].map((i) => ({
      id: `drum${i}`,
      kind: 'wheel' as const,
      icon: 'drum',
      label: `ドラム ${i + 1}`,
      tone: round.guided && round.tensions[i] < 0.5 ? ('primary' as const) : ('trim' as const),
    }));
    this.hud.setControls(controls);
    this.hud.setHint(
      round.guided
        ? 'ひかった ドラムを まわして きを まっすぐに'
        : 'かたむいて いる がわの ドラムを まわそう',
    );
  }

  private async loadLights(): Promise<void> {
    if (this.harnessRequested) return;
    this.harnessRequested = true;
    // Deferred: the harness, the star and the lighting sequence are only built
    // when the build actually reaches them, and they arrive as their own chunk.
    const mod = await import('../lights');
    const profile = this.quality.profile;
    this.harness = new mod.LightHarness(this.tree, this.materials, profile, this.socketPos);
    this.star = new mod.StarHoist(this.tree, this.materials, this.socketPos);
    this.lighting = new mod.LightingSequence(this.harness, this.star, profile);
    this.scene.add(this.harness.group, this.star.group, this.lighting.group);
    this.starLoaded = true;
    this.hud.setControls([
      { id: 'reel', kind: 'wheel', icon: 'reel', label: 'リールを まわす', tone: 'primary' },
      { id: 'winch', kind: 'hold', icon: 'winch', label: 'ウインチ', tone: 'trim' },
    ]);
  }

  /* ----------------------------------------------------------------- loop -- */

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.director.resize(w, h);
  }

  /**
   * Step the simulation by a fixed amount of time without waiting for a frame.
   * Used by the test harness (headless animation frames are throttled) and by
   * the replay reset; rendering still happens on the normal loop.
   */
  advance(seconds: number): void {
    const dt = 1 / 60;
    const steps = Math.min(3600, Math.max(1, Math.round(seconds / dt)));
    for (let i = 0; i < steps; i++) {
      this.elapsed += dt;
      this.phaseTime += dt;
      this.step(dt);
    }
  }

  frame(): void {
    if (this.disposed) return;
    const start = performance.now();
    this.frameCount++;
    const dt = Math.min(0.05, this.clock.getDelta());
    const steps = Math.min(16, Math.max(1, Math.round(this.timeScale)));
    for (let i = 0; i < steps; i++) {
      this.elapsed += dt;
      this.phaseTime += dt;
      this.step(dt);
    }

    this.renderer.render(this.scene, this.director.camera);
    this.lastFrameMs = performance.now() - start;
    this.quality.update(this.lastFrameMs, dt);
  }

  private step(dt: number): void {
    this.updatePhase(dt);

    // Tree pose: the stem is kinematic, the crown is not.
    this.tree.setRaiseAngle(this.raiseAngle, dt);
    this.tree.root.rotation.y = this.trim;
    const seat = smoothstep(this.seatT);
    this.tree.root.position.lerpVectors(this.buttStart, this.tmp.copy(this.socketPos).setY(SEAT_HEIGHT), seat);
    // A slight lift before the traverse, so the butt clears the bolsters.
    this.tree.root.position.y += Math.sin(seat * Math.PI) * 0.9;
    this.tree.update(dt);

    // Crane follows whatever it is currently carrying, and stows once the star
    // is home — the ceremony should not happen under a live boom.
    const carryingStar = this.phase === 'star' && this.star !== null;
    const done = PHASE_ORDER.indexOf(this.phase) >= PHASE_ORDER.indexOf('test');
    if (done) {
      this.crane.stow(dt);
      this.crane.getHookWorld(this.hookWorld);
    } else if (carryingStar && this.star) this.star.hookTarget(this.hookTarget);
    else if (this.rig.rigged > 0.001) {
      this.rig.hookTarget(this.hookTarget);
      this.hookTarget.y += (1 - this.rigProgress) * 8;
    } else {
      this.rig.hookTarget(this.hookTarget);
      this.hookTarget.y += 9;
    }
    if (!done) {
      this.crane.trackHook(this.hookTarget, dt);
      this.crane.getHookWorld(this.hookWorld);
    }

    this.rig.setHookWorld(this.hookWorld);
    this.rig.update(dt);
    this.socket.setClamp(this.clampT);
    this.socket.update(dt);
    this.guys.update(dt);
    this.straps.update(dt);
    this.workers.update(dt);

    if (this.star) {
      this.star.setHookWorld(this.hookWorld);
      this.star.update(dt);
    }
    if (this.harness) this.harness.update(dt);
    if (this.lighting) this.lighting.update(dt);

    // Sky, crowd and window lights follow the phase timeline continuously.
    const targetTime = PHASE_TIME[this.phase];
    this.timeOfDay = damp(this.timeOfDay, targetTime, 0.35, dt);
    this.sky.setTime(this.timeOfDay);
    this.sky.update(dt);
    this.plaza.setEvening(this.timeOfDay);
    this.plaza.setCrowdFill(smoothstep((this.timeOfDay - 0.25) / 0.6) * 0.92 + 0.08);
    this.plaza.animateCrowd(this.elapsed);
    this.materials.setEnvironmentIntensity(lerp(0.35, 1.0, this.sky.daylight));

    // The trailer pulls off the square once its load is standing.
    const wantShift = PHASE_ORDER.indexOf(this.phase) >= PHASE_ORDER.indexOf('release') ? 1 : 0;
    this.trailerShift = damp(this.trailerShift, wantShift, 0.4, dt);
    this.trailer.group.position.x = -4.5 - this.trailerShift * 46;

    // Camera.
    this.tree.pointOnStem(0, this.ctxButt);
    this.tree.worldTip(this.ctxTip);
    if (this.star) this.star.starWorld(this.ctxStar);
    else this.ctxStar.copy(this.ctxTip);
    this.director.update(dt, {
      butt: this.ctxButt,
      tip: this.ctxTip,
      socket: this.socketPos,
      hook: this.hookWorld,
      star: this.ctxStar,
      crane: this.crane.root.position,
      console: this.consolePos,
      board: this.boardPos,
      raiseAngle: this.raiseAngle,
      progress: this.phaseProgress(),
      time: this.elapsed,
    });

    // Crown LOD by distance: full geometry close in, a reduced covering when
    // the camera pulls back for the whole-tree shots.
    const camDist = this.director.camera.position.distanceTo(this.ctxButt);
    this.tree.setDetail(clamp(1.25 - camDist / 90, 0.35, 1));

    this.audio.setCraneLoad(this.rig.tension > 0.05 || carryingStar, this.rig.tension);
    this.audio.setCrowd(
      this.phase === 'ceremony' && this.ceremonyStage > 0
        ? 0.08
        : clamp((this.timeOfDay - 0.3) * 0.9, 0, 0.75) * (this.lighting?.isLit ? 1.2 : 0.7),
      this.lighting?.isLit ? 1500 : 620,
    );
  }

  /** 0..1 within the current phase, used for slow camera pushes. */
  private phaseProgress(): number {
    switch (this.phase) {
      case 'arrival':
        return clamp(this.phaseTime / 5, 0, 1);
      case 'rigging':
        return this.rigProgress;
      case 'raising':
        return this.raiseAngle / (Math.PI / 2);
      case 'seating':
        return this.seatT;
      case 'plumbing':
        return (this.plumbRound + 0.5) / PLUMB_ROUNDS.length;
      case 'release':
        return this.straps.releasedCount / this.straps.bandCount;
      case 'harness':
        return this.harness ? (this.harness.payOut + this.harness.hoist) / 2 : 0;
      case 'star':
        return this.star ? this.star.progress : 0;
      case 'test':
        return clamp(this.phaseTime / 8, 0, 1);
      case 'ceremony':
        return clamp(this.ceremonyStage / 3, 0, 1);
      default:
        return clamp(this.phaseTime / 20, 0, 1);
    }
  }

  private updatePhase(dt: number): void {
    const hoisting = this.held.has('hoist');

    switch (this.phase) {
      case 'arrival': {
        if (this.phaseTime > 3.2 && !this.hud.hasControl('begin')) {
          this.hud.setControls([{ id: 'begin', kind: 'press', icon: 'hook', label: 'はじめる' }]);
        }
        break;
      }

      case 'rigging': {
        this.rig.rigged = damp(this.rig.rigged, this.rigProgress, 4, dt);
        if (this.rigProgress >= 0.999) {
          this.audio.click(760, 0.22);
          this.rig.rigged = 1;
          this.setPhase('raising');
        }
        break;
      }

      case 'raising': {
        if (hoisting) {
          // Whatever the input, the hoist runs at its safe speed.
          this.raiseAngle = moveTowards(this.raiseAngle, Math.PI / 2, RAISE_RATE * dt);
        }
        // Load transfers into the slings before the stem moves at all.
        const wantTension = hoisting || this.raiseAngle > 0.01 ? 1 : 0.15;
        this.rig.tension = damp(this.rig.tension, wantTension, 1.6, dt);
        this.hud.updateControl('hoist', this.raiseAngle / (Math.PI / 2));
        this.operatorConsole.setLever(hoisting ? 1 : 0);
        if (this.raiseAngle >= Math.PI / 2 - 1e-3) {
          this.raiseAngle = Math.PI / 2;
          this.setPhase('seating');
        }
        break;
      }

      case 'seating': {
        if (hoisting && !this.seated) {
          this.seatT = moveTowards(this.seatT, 1, SEAT_RATE * dt);
        }
        this.hud.updateControl('hoist', this.seatT);
        this.operatorConsole.setLever(hoisting ? 1 : 0);
        if (!this.seated && this.seatT >= 0.985) {
          this.seated = true;
          this.socket.impact(1);
          this.audio.thud(1);
        }
        if (this.seated) {
          this.clampT = moveTowards(this.clampT, 1, dt * 0.9);
          this.rig.tension = damp(this.rig.tension, 0.15, 1.2, dt);
          if (this.clampT >= 1) {
            this.audio.click(430, 0.24);
            this.setPhase('plumbing');
          }
        }
        break;
      }

      case 'plumbing': {
        // The slings come off once the guys are holding the stem.
        this.rig.rigged = damp(this.rig.rigged, 0, 1.2, dt);
        this.rig.tension = damp(this.rig.tension, 0, 1.5, dt);
        const lean = this.guys.leanAngle;
        if (lean < 0.0045) this.plumbHold += dt;
        else this.plumbHold = 0;
        if (this.plumbHold > 1.2) {
          if (this.plumbRound + 1 < PLUMB_ROUNDS.length) {
            this.audio.click(880, 0.2);
            this.startPlumbRound(this.plumbRound + 1);
          } else {
            this.audio.click(660, 0.24);
            this.setPhase('release');
          }
        }
        break;
      }

      case 'release': {
        if (this.straps.allReleased && this.tree.bundleAmount < 0.12) {
          this.setPhase('harness');
        }
        break;
      }

      case 'harness': {
        if (!this.harness) break;
        const winching = this.held.has('winch');
        if (this.harness.payOut >= 0.999 && winching) {
          this.harness.hoist = moveTowards(this.harness.hoist, 1, 0.14 * dt);
          this.audio.setWinch(true);
        } else if (!winching) {
          this.audio.setWinch(false);
        }
        this.hud.updateControl('winch', this.harness.hoist);
        if (this.harness.payOut >= 0.999 && this.harness.hoist >= 0.999) {
          this.audio.setWinch(false);
          this.setPhase('star');
        }
        break;
      }

      case 'star': {
        if (!this.star) break;
        if (hoisting) {
          this.star.progress = moveTowards(this.star.progress, 1, STAR_RATE * dt);
          this.audio.setWinch(true);
        } else {
          this.audio.setWinch(false);
        }
        this.hud.updateControl('hoist', this.star.progress);
        if (this.star.progress >= 0.999 && this.star.seated > 0.9) {
          this.audio.click(500, 0.26);
          this.setPhase('test');
        }
        break;
      }

      case 'test': {
        if (!this.lighting) break;
        if (this.lighting.state === 'stalled' && !this.hud.hasControl('plug')) {
          this.hud.setControls([
            { id: 'plug', kind: 'dragX', icon: 'plug', label: 'コネクターを つなぐ', tone: 'danger' },
          ]);
          this.hud.setHint('くらい くかくが あります。コネクターを つなごう');
        }
        if (this.lighting.state === 'tested') this.setPhase('ceremony');
        break;
      }

      case 'ceremony': {
        if (!this.lighting) break;
        this.ceremonyTimer += dt;
        if (this.ceremonyStage < 3 && this.ceremonyTimer > 1.1) {
          this.ceremonyTimer = 0;
          this.ceremonyStage++;
          this.hud.setLamps(this.ceremonyStage);
          this.operatorConsole.setLamps(this.ceremonyStage);
          this.audio.chime(this.ceremonyStage - 1);
          if (this.ceremonyStage === 3) {
            this.hud.setControls([
              { id: 'enable', kind: 'press', icon: 'handle', label: 'てんとう ハンドル', tone: 'primary' },
            ]);
            this.hud.setHint('おおきな ハンドルを おそう');
          }
        }
        if (this.lighting.isLit) this.setPhase('finale');
        break;
      }

      case 'finale':
        break;
    }
  }

  /* ---------------------------------------------------------------- reset -- */

  reset(): void {
    this.rigProgress = 0;
    this.raiseAngle = 0;
    this.seatT = 0;
    this.seated = false;
    this.clampT = 0;
    this.trim = 0;
    this.strapPull = 0;
    this.plumbRound = 0;
    this.plumbHold = 0;
    this.ceremonyStage = 0;
    this.ceremonyTimer = 0;
    this.trailerShift = 0;
    this.held.clear();
    this.rig.rigged = 0;
    this.rig.tension = 0;
    this.straps.reset();
    this.tree.setRaiseAngle(0, 0);
    this.tree.snapPose();
    this.guys.setEngaged(0);
    for (let i = 0; i < 3; i++) this.guys.setTension(i, 0);
    this.socket.setClamp(0);
    if (this.harness) {
      this.harness.payOut = 0;
      this.harness.hoist = 0;
      this.harness.mate(this.lighting?.faultSector ?? 2);
    }
    if (this.star) this.star.progress = 0;
    this.lighting?.reset();
    this.harnessRequested = this.starLoaded;
    this.timeOfDay = PHASE_TIME.arrival;
    this.operatorConsole.setLamps(0);
    this.operatorConsole.setHandle(0);
    this.phase = 'finale';
    this.setPhase('arrival');
  }

  /* ------------------------------------------------------------ test hooks -- */

  /** Snapshot used by the Playwright suite and by the on-screen debug read-out. */
  getState() {
    return {
      phase: this.phase,
      raiseAngle: this.raiseAngle,
      raiseFraction: this.raiseAngle / (Math.PI / 2),
      seatT: this.seatT,
      clamped: this.clampT,
      leanAngle: this.guys.leanAngle,
      guyTensions: this.guys.getTensions(),
      plumbRound: this.plumbRound,
      strapsReleased: this.straps.releasedCount,
      bundle: this.tree.bundleAmount,
      canopyRadius: this.tree.canopyRadius,
      harnessPayOut: this.harness?.payOut ?? 0,
      harnessHoist: this.harness?.hoist ?? 0,
      starProgress: this.star?.progress ?? 0,
      starSeated: this.star?.seated ?? 0,
      lighting: this.lighting?.state ?? 'dark',
      treeBrightness: this.lighting?.treeBrightness ?? 0,
      lightingDebug: this.lighting?.debug() ?? null,
      lampCount: this.harness?.lampCount ?? 0,
      foliageInstances: this.tree.foliageInstances,
      branchCount: this.tree.branches.length,
      timeOfDay: this.timeOfDay,
      tier: this.quality.profile.tier,
      pixelRatio: this.quality.pixelRatio,
      frameMs: this.lastFrameMs,
      frames: this.frameCount,
      elapsed: this.elapsed,
      phaseTime: this.phaseTime,
      portrait: this.director.isPortrait,
      shot: this.director.currentShot,
      treeTipY: this.ctxTip.y,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.dispose();
    this.materials.dispose();
    this.sky.dispose();
  }
}
