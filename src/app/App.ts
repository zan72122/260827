import * as THREE from 'three';
import { CakeState, type SeatId, type Stage } from '../core/CakeState';
import { buildTextures, type TextureLibrary } from '../render/textures';
import { Materials } from '../render/materials';
import { buildEnvMap, LightRig, type DevLighting } from '../render/Environment';
import { World } from './World';
import { CameraDirector, DEV_SHOTS } from '../camera/CameraDirector';
import { Overlay } from '../ui/Overlay';
import { AudioKit } from '../audio/AudioKit';
import { PointerInput, type PointerFrame } from '../input/PointerInput';
import type { StageBehaviour, StageContext, Viewport } from './StageContext';
import { WelcomeStage } from '../stages/WelcomeStage';
import { TurntableOperation } from '../stages/TurntableOperation';
import { FlowerStage } from '../stages/FlowerStage';
import { FlowerTransfer } from '../stages/FlowerTransfer';
import { ServeStage } from '../stages/ServeStage';
import { ServingCut } from '../stages/ServingCut';
import { AfterStage } from '../stages/AfterStage';
import type { FlowerBuilder } from '../flower/FlowerBuilder';
import { loadSession, saveSession } from '../core/Storage';
import { clamp } from '../util/math';

/**
 * Wiring.
 *
 * The game state, the scene and the drawing are kept apart: CakeState knows
 * what has happened, World knows what exists, and this class only decides which
 * stage is listening to the finger and hands the renderer a frame.
 */

const DEV_SHOT_ORDER = [
  'flower-side', 'flower-back', 'flower-top', 'flower-far-side',
  'cake-low', 'cake-top', 'room-wide',
];
const DEV_LIGHTING: DevLighting[] = ['default', 'overcast', 'evening'];

export class App {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly textures: TextureLibrary;
  private readonly materials: Materials;
  private readonly envMap: THREE.Texture;
  private readonly lights = new LightRig();
  private readonly state = new CakeState();
  private readonly world: World;
  private readonly director: CameraDirector;
  private readonly overlay: Overlay;
  private readonly audio = new AudioKit();
  private readonly input: PointerInput;

  private readonly stages: Record<Stage, StageBehaviour>;
  private stage: Stage = 'welcome';

  private active: FlowerBuilder | null = null;
  private placed: FlowerBuilder[] = [];

  private readonly viewport: Viewport = { width: 1, height: 1, portrait: true };
  private renderScale = 1;
  private frameAvg = 16;
  private lastScaleChange = 0;
  private running = false;
  private lastTime = 0;
  private raf = 0;
  private audioStarted = false;
  private devShotIndex = -1;
  private wasInDevShot = false;
  private devLightIndex = 0;
  private showInfo = false;
  private fps = 60;

  private readonly ndc = new THREE.Vector2();
  private readonly ray = new THREE.Raycaster();
  private readonly plane = new THREE.Plane();
  private readonly ctx: StageContext;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    if (!this.renderer.capabilities.isWebGL2) {
      this.renderer.dispose();
      throw new Error('WebGL 2 is not available');
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0xefe7db, 1);
    container.appendChild(this.renderer.domElement);

    this.textures = buildTextures();
    this.materials = new Materials(this.textures);
    this.envMap = buildEnvMap(this.renderer);

    this.world = new World(this.materials, this.state);
    this.world.scene.environment = this.envMap;
    this.world.scene.add(this.lights.group);

    this.director = new CameraDirector(1);
    this.overlay = new Overlay(container);
    this.input = new PointerInput(this.renderer.domElement);

    const saved = loadSession();
    if (saved?.seat) this.state.seat = saved.seat;

    this.ctx = {
      world: this.world,
      state: this.state,
      materials: this.materials,
      camera: this.director,
      overlay: this.overlay,
      audio: this.audio,
      lights: this.lights,
      viewport: this.viewport,
      screenOf: (p, out) => this.screenOf(p, out),
      pickOnPlane: (x, y, planeY, out) => this.pickOnPlane(x, y, planeY, out),
      goTo: (s) => this.goTo(s),
      activeFlower: () => this.active,
      setActiveFlower: (f) => {
        this.active = f;
      },
      placedFlowers: () => this.placed,
      addPlacedFlower: (f) => {
        this.placed.push(f);
        this.state.flowers.push(f.record);
        this.persist();
      },
      restart: (seat) => this.restart(seat),
    };

    this.stages = {
      welcome: new WelcomeStage(this.ctx),
      smoothing: new TurntableOperation(this.ctx),
      piping: new FlowerStage(this.ctx),
      placing: new FlowerTransfer(this.ctx),
      serving: new ServeStage(this.ctx),
      cutting: new ServingCut(this.ctx),
      after: new AfterStage(this.ctx),
    };

    this.overlay.setChoiceHandler((id) => {
      this.ensureAudio();
      this.stages[this.stage].onChoice?.(id);
    });
    this.overlay.setMuteHandler((m) => {
      this.ensureAudio();
      this.audio.setMuted(m);
    });

    this.input.setHandlers({
      onDown: (f) => this.onDown(f),
      onMove: (f) => this.stages[this.stage].onMove?.(f),
      onUp: (f, c) => this.stages[this.stage].onUp?.(f, c),
    });

    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('keydown', this.onKey);

    this.onResize();
    document.body.dataset.stage = 'welcome';
    this.stages.welcome.enter();
  }

  /** Sound may only begin inside a real gesture, so it begins on the first one. */
  private ensureAudio(): void {
    if (this.audioStarted) return;
    this.audioStarted = true;
    this.audio.start();
    this.audio.resume();
  }

  private onDown(f: PointerFrame): void {
    this.ensureAudio();
    this.stages[this.stage].onDown?.(f);
  }

  private onResize = (): void => {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.viewport.width = w;
    this.viewport.height = h;
    this.viewport.portrait = h >= w;
    this.director.setOrientation(this.viewport.portrait);
    this.director.resize(w / h);
    this.applyRenderScale();
  };

  private applyRenderScale(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr * this.renderScale);
    this.renderer.setSize(this.viewport.width, this.viewport.height, true);
  }

  private onVisibility = (): void => {
    if (document.hidden) {
      this.audio.suspend();
      this.input.release();
    } else {
      // Come back where we left off, not several minutes into the future.
      this.lastTime = performance.now();
      if (this.audioStarted) this.audio.resume();
    }
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'v') {
      this.devShotIndex += 1;
      if (this.devShotIndex >= DEV_SHOT_ORDER.length) this.devShotIndex = -1;
      const name = this.devShotIndex >= 0 ? DEV_SHOT_ORDER[this.devShotIndex] : undefined;
      const pair = name ? DEV_SHOTS[name] : null;
      this.director.setDevShot(pair ? (this.viewport.portrait ? pair.portrait : pair.landscape) : null);
    } else if (k === 'l') {
      this.devLightIndex = (this.devLightIndex + 1) % DEV_LIGHTING.length;
      this.lights.setDev(DEV_LIGHTING[this.devLightIndex]);
    } else if (k === 'i') {
      this.showInfo = !this.showInfo;
      if (!this.showInfo) this.overlay.setDevText(null);
    }
  };

  private screenOf(p: THREE.Vector3, out: THREE.Vector2): THREE.Vector2 {
    const v = p.clone().project(this.director.camera);
    out.set(((v.x + 1) / 2) * this.viewport.width, ((1 - v.y) / 2) * this.viewport.height);
    return out;
  }

  private pickOnPlane(x: number, y: number, planeY: number, out: THREE.Vector3): boolean {
    this.ndc.set((x / this.viewport.width) * 2 - 1, -((y / this.viewport.height) * 2 - 1));
    this.ray.setFromCamera(this.ndc, this.director.camera);
    this.plane.set(new THREE.Vector3(0, 1, 0), -planeY);
    return this.ray.ray.intersectPlane(this.plane, out) !== null;
  }

  private goTo(next: Stage): void {
    if (next === this.stage) return;
    this.input.release();
    this.stages[this.stage].exit();
    this.stage = next;
    this.state.stage = next;
    document.body.dataset.stage = next;
    this.overlay.setChoices([]);
    this.stages[next].enter();
    this.persist();
  }

  /** Start over with a fresh cake, releasing everything the last one used. */
  private restart(seat?: SeatId): void {
    this.input.release();
    this.stages[this.stage].exit();

    for (const f of this.placed) f.dispose();
    this.placed = [];
    if (this.active) {
      this.active.dispose();
      this.active = null;
    }
    this.state.flowers = [];
    this.state.working = null;
    this.state.remaining = [{ from: 0, to: Math.PI * 2 }];
    this.state.cut = null;
    this.state.candleLit = false;
    this.state.candlePresent = false;
    if (seat) this.state.seat = seat;

    this.world.resetCake(this.state);
    this.stage = 'piping';
    this.state.stage = 'piping';
    document.body.dataset.stage = 'piping';
    this.overlay.setChoices([]);
    this.stages.piping.enter();
    this.persist();
  }

  private persist(): void {
    saveSession({
      seat: this.state.seat,
      flowers: this.state.flowers,
      savedAt: Date.now(),
    });
  }

  /** Live resource counts, so a replay can be checked for leaks. */
  rendererInfo(): { geometries: number; textures: number; programs: number; flowers: number } {
    const info = this.renderer.info;
    return {
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      flowers: this.placed.length + (this.active ? 1 : 0),
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.tick(this.lastTime);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    if (document.hidden) return;

    const raw = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // A slow device should still move at something like real time, but a tab
    // that has been in the background must never apply a whole minute at once.
    const dt = clamp(raw, 0, 0.1);

    this.frameAvg = this.frameAvg * 0.92 + raw * 1000 * 0.08;
    this.fps = 1000 / Math.max(this.frameAvg, 1);
    this.adaptQuality(now);

    this.input.pump();
    this.stages[this.stage].update(dt);
    this.director.update(dt);
    this.lights.update(dt);
    this.materials.setEnvIntensity(this.lights.envIntensity);

    const focus = new THREE.Vector3();
    if (this.stage === 'piping' || this.stage === 'placing') {
      this.world.nailPivot.getWorldPosition(focus);
      if (this.stage === 'placing') this.world.cakeFocus(focus);
    } else {
      this.world.cakeFocus(focus);
    }
    this.lights.focus(focus);

    this.overlay.setChoices(this.stages[this.stage].choices());
    this.applyDevVisibility();
    this.renderer.render(this.world.scene, this.director.camera);

    if (this.showInfo) {
      const info = this.renderer.info;
      this.overlay.setDevText(
        [
          `stage   ${this.stage}`,
          `fps     ${this.fps.toFixed(0)}  scale ${this.renderScale.toFixed(2)}`,
          `geom    ${info.memory.geometries}`,
          `tex     ${info.memory.textures}`,
          `prog    ${info.programs?.length ?? 0}`,
          `calls   ${info.render.calls}  tris ${info.render.triangles}`,
          `flowers ${this.placed.length}${this.active ? ' +1' : ''}`,
          `light   ${this.lights.devMode()}`,
        ].join('\n'),
      );
    }
  };

  /**
   * The hands and the bag are exactly where they should be during play, which
   * is also exactly in the way when the point is to look at the flower itself
   * from every side. Applied per frame rather than on the key press, so nothing
   * a stage does afterwards can put them back mid-inspection.
   */
  private applyDevVisibility(): void {
    const dev = this.director.inDevShot;
    if (dev) {
      this.world.nailHand.visible = false;
      this.world.pipingRig.visible = false;
      this.wasInDevShot = true;
    } else if (this.wasInDevShot) {
      this.wasInDevShot = false;
      this.world.nailHand.visible = true;
      this.world.pipingRig.visible = this.stage === 'piping';
    }
  }

  /**
   * Keep the frame rate up by giving ground on resolution and on the parts of
   * the picture that are not the subject. The petals keep their geometry.
   */
  private adaptQuality(now: number): void {
    if (now - this.lastScaleChange < 2200) return;
    if (this.frameAvg > 21 && this.renderScale > 0.62) {
      this.renderScale = Math.max(0.62, this.renderScale - 0.14);
      this.lastScaleChange = now;
      this.applyRenderScale();
      if (this.renderScale <= 0.76) {
        this.lights.allowPendantShadow = false;
        this.lights.pendant.castShadow = false;
        this.lights.windowLight.shadow.mapSize.set(512, 512);
        this.lights.windowLight.shadow.map?.dispose();
        this.lights.windowLight.shadow.map = null;
      }
    } else if (this.frameAvg < 13.6 && this.renderScale < 1) {
      this.renderScale = Math.min(1, this.renderScale + 0.14);
      this.lastScaleChange = now;
      this.applyRenderScale();
    }
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onKey);
    this.input.dispose();
    this.overlay.dispose();
    this.audio.dispose();
    for (const f of this.placed) f.dispose();
    if (this.active) this.active.dispose();
    this.materials.dispose();
    this.textures.dispose();
    this.envMap.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
