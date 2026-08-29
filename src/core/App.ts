import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AdaptiveQuality } from './Quality';
import { Input, type GestureEnd, type PointerSample } from './Input';
import { Audio } from './Audio';
import { clamp, lerp, smoothstep, Rng, TAU } from './rng';
import { Materials } from '../content/Materials';
import { StrawberryCatalog, BERRY_VARIANTS } from '../content/StrawberryCatalog';
import { CreamField } from '../content/CreamField';
import { makeTurntable, makePlate } from '../content/Props';
import { Hud } from '../ui/Hud';
import { CAKE } from '../game/CakeSpec';
import { CakeView, type RevealItem } from '../game/CakeView';
import {
  PlacementRing,
  computeSeatY,
  topOffset,
  type Placement,
} from '../game/PlacementRing';
import {
  nextOrientation,
  orientationQuaternion,
  type OrientationId,
} from '../game/OrientationState';
import { CutPlaneSelector } from '../game/CutPlaneSelector';
import { ReplayLoop } from '../game/ReplayLoop';
import { RevealCamera, framePose, type Pose } from '../game/RevealCamera';
import { ToolRig } from '../game/ToolRig';
import { Tray } from '../game/Tray';

type Phase =
  | 'intro'
  | 'patissier'
  | 'fill'
  | 'level'
  | 'topSponge'
  | 'nappage'
  | 'chooseCut'
  | 'cutting'
  | 'reveal'
  | 'design';

const CREAM_SURFACE = CAKE.creamBase + CAKE.creamInitial;
const SNAP_RADIUS = 0.032;

/**
 * The game. One cake, one ring of wells, one knife.
 *
 * The only authority on what is inside the cake is the placement list: the
 * assembled cake, the cream volume, the wedge and every cut face in the reveal
 * are all derived from it. Nothing is pre-rendered and nothing is swapped for a
 * finished picture, which is why changing one berry — or just the direction of
 * the cut — changes what the child sees when the slice comes out.
 */
export class App {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly quality: AdaptiveQuality;
  private readonly materials: Materials;
  private readonly catalog: StrawberryCatalog;
  private readonly cream: CreamField;
  private readonly ring = new PlacementRing();
  private readonly input: Input;
  private readonly audio = new Audio();
  private readonly hud: Hud;
  private readonly rig: RevealCamera;
  private readonly tools: ToolRig;
  private readonly tray: Tray;
  private readonly selector = new CutPlaneSelector();
  private readonly replay = new ReplayLoop();
  private readonly rng = new Rng(0x9c4d);

  private readonly cakeAnchor = new THREE.Group();
  private readonly turntable: THREE.Group;
  private readonly plate: THREE.Mesh;
  private readonly cutGuide = new THREE.Group();
  private cake: CakeView;
  private wedge: CakeView | null = null;
  private remain: CakeView | null = null;

  private placements: Placement[] = [];
  private phase: Phase = 'intro';
  private phaseTime = 0;
  private round = 0;
  private portrait = true;
  private revealItems: RevealItem[] = [];
  private wedgeCentre = new THREE.Vector3();
  /** Portrait toggles between looking down at the ring and at the cut face. */
  private overhead = false;

  /* interaction */
  private carried: { variantId: string } | null = null;
  private carriedSlot: number | null = null;
  private carriedPos = new THREE.Vector3();
  private pending: { slotId: number; variantId: string } | null = null;
  private dragging = false;
  private pointerActive = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CREAM_SURFACE);
  private ghost: THREE.Group | null = null;
  private ghostVariant = '';

  /* step state */
  private fillGap0 = 1;
  private fillTarget: number = CAKE.fillCeiling;
  private nozzle = new THREE.Vector3(CAKE.ringRadius, CREAM_SURFACE, 0);
  private sweepAngle = 0;
  private swept = 0;
  private spongeLift = 0.085;
  private nappageSweep = 0;
  private cutStage = 0;
  private cutT = 0;
  private lastTime = 0;
  private ready = false;

  constructor(private readonly canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Kept below 1 so a white cake in daylight keeps its modelling.
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = true;

    this.quality = new AdaptiveQuality(this.renderer);
    this.materials = new Materials(this.quality);
    this.catalog = new StrawberryCatalog(this.quality);
    this.cream = new CreamField({
      angularSegments: this.quality.creamAngularSegments,
      radialSegments: 20,
      rOuter: CAKE.radius,
      base: CAKE.creamBase,
      initialHeight: CAKE.creamInitial,
    });
    this.resetCreamSurface();

    this.scene.background = new THREE.Color(0xe9e3db);
    this.buildLighting();

    this.cake = new CakeView(this.materials, this.catalog, this.quality, this.cream, this.ring, {
      a0: 0,
      a1: TAU,
    });
    this.turntable = makeTurntable(this.materials);
    this.plate = makePlate(this.materials);
    this.plate.visible = false;
    this.tools = new ToolRig(this.materials);
    this.tray = new Tray(this.materials, this.catalog, this.quality);

    this.cakeAnchor.add(this.cake.root, this.cutGuide);
    this.scene.add(this.cakeAnchor, this.turntable, this.plate, this.tools.root, this.tray.root);

    this.hud = new Hud(hudRoot);
    this.hud.onAction = (id) => this.onAction(id);
    this.input = new Input(canvas);
    this.input.handler = {
      onDown: (p) => this.onDown(p),
      onMove: (p) => this.onMove(p),
      onUp: (p, e) => this.onUp(p, e),
    };

    this.rig = new RevealCamera(this.posesFor().design);
    this.applyLayout();
    this.enter('intro');
  }

  /* ------------------------------------------------------------ lighting */

  private buildLighting(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.045);
    this.scene.environment = env.texture;
    pmrem.dispose();

    // Soft daylight from the window on the left of the room.
    const sun = new THREE.DirectionalLight(0xfff4e6, 1.75);
    sun.position.set(-0.86, 0.72, -0.28);
    sun.target.position.set(0, 0.035, 0);
    sun.castShadow = true;
    const s = this.quality.shadowMapSize;
    sun.shadow.mapSize.set(s, s);
    sun.shadow.camera.left = -0.2;
    sun.shadow.camera.right = 0.32;
    sun.shadow.camera.top = 0.24;
    sun.shadow.camera.bottom = -0.26;
    sun.shadow.camera.near = 0.2;
    sun.shadow.camera.far = 2.4;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.0016;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);

    // Diffuse ceiling wash, no shadow, so nothing sits in a black hole.
    const ceiling = new THREE.DirectionalLight(0xf3f6ff, 0.22);
    ceiling.position.set(0.35, 1.4, 0.28);
    this.scene.add(ceiling);

    const bounce = new THREE.HemisphereLight(0xf6f2ea, 0xa89a8c, 0.34);
    this.scene.add(bounce);
  }

  /* --------------------------------------------------------------- setup */

  private readonly creamTopAt = (x: number, z: number): number =>
    this.cream.topAt(Math.atan2(z, x), Math.hypot(x, z));

  private resetCreamSurface(): void {
    this.cream.reset();
    this.cream.dimpleWells(this.ring.slots, 0.0118, 0.0031);
  }

  /** Re-open the cake for another round without losing the ring inside it. */
  private reopen(): void {
    this.disposePieces();
    this.resetCreamSurface();
    for (const p of this.placements) {
      const slot = this.ring.slot(p.slotId);
      const v = this.catalog.variant(p.variantId);
      this.cream.press(slot.x, slot.z, v.width * 0.62, 0.0019);
    }
    for (const p of this.placements) {
      p.seatY = computeSeatY(
        this.ring.slot(p.slotId),
        p.orientation,
        p.sink,
        this.catalog.get(p.variantId).near.boundingBox!,
        this.creamTopAt,
      );
    }
    this.cake.refreshCream(true);
    this.cake.setTopSponge(false, CREAM_SURFACE);
    this.cake.setCoat(0, false);
    this.cake.root.visible = true;
    this.cakeAnchor.rotation.y = 0;
    this.turntable.rotation.y = 0;
    this.plate.visible = false;
    this.cake.syncPlacements(this.placements);
  }

  private disposePieces(): void {
    this.wedge?.dispose();
    this.remain?.dispose();
    this.wedge = null;
    this.remain = null;
  }

  /* -------------------------------------------------------------- layout */

  private get aspect(): number {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    return w / Math.max(1, h);
  }

  private posesFor(): Record<string, Pose> {
    const p = this.portrait;
    const a = this.aspect;
    const deg = (d: number) => (d * Math.PI) / 180;
    const frame = (
      target: [number, number, number],
      azimuth: number,
      elevation: number,
      fitH: number,
      fitV: number,
    ): Pose =>
      framePose(
        {
          target: new THREE.Vector3(...target),
          azimuth: deg(azimuth),
          elevation: deg(elevation),
          fitH,
          fitV,
          fov: p ? 46 : 38,
        },
        a,
      );

    return {
      // Portrait looks down the ring with the tray of slices below it;
      // landscape sets the tray beside the cake so both are worked at once.
      design: p
        ? frame([0, 0.03, 0.052], 90, 52, 0.098, 0.15)
        : frame([0.062, 0.03, 0.018], 84, 40, 0.192, 0.118),
      close: p
        ? frame([0, 0.045, 0.004], 88, 44, 0.094, 0.115)
        : frame([0.006, 0.045, 0], 82, 36, 0.126, 0.1),
      nappage: p
        ? frame([0, 0.046, 0], 90, 30, 0.1, 0.112)
        : frame([0, 0.046, 0], 86, 27, 0.136, 0.1),
      choose: p
        ? frame([0, 0.052, 0], 90, 74, 0.096, 0.1)
        : frame([0, 0.052, 0], 88, 66, 0.124, 0.096),
    };
  }

  private applyLayout(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.portrait = h >= w;
    this.tray.layout(this.portrait);
    this.rig.setViewport(w, h);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.setSize(w, h, false);
    const before = this.portrait;
    this.applyLayout();
    if (!this.ready) return;
    // Turning the device keeps every placement; only the framing changes.
    if (before !== this.portrait) this.rig.moveTo(this.cameraFor(this.phase), 0.55);
    else this.rig.snapTo(this.cameraFor(this.phase));
  }

  private cameraFor(phase: Phase): Pose {
    const set = this.posesFor();
    switch (phase) {
      case 'fill':
      case 'level':
      case 'topSponge':
        return set.close;
      case 'nappage':
        return set.nappage;
      case 'chooseCut':
      case 'cutting':
        return set.choose;
      case 'reveal':
        // Portrait can swap between looking straight down at the cake, where
        // the ring was, and looking at the cut face. The choice survives a
        // resize.
        return this.overhead ? this.overheadPose() : this.revealPose();
      default:
        return set.design;
    }
  }

  /** Straight down on the cake and the lifted slice together. */
  private overheadPose(): Pose {
    const mid = this.selector.angle + CAKE.wedgeSpan / 2;
    const centre = new THREE.Vector3(Math.cos(mid) * 0.05, 0.05, Math.sin(mid) * 0.05);
    return framePose(
      {
        target: centre,
        azimuth: Math.PI / 2,
        elevation: (this.portrait ? 78 : 72) * (Math.PI / 180),
        fitH: 0.155,
        fitV: 0.15,
        fov: this.portrait ? 42 : 36,
      },
      this.aspect,
    );
  }

  private revealPose(): Pose {
    const { a0 } = this.selector.planes();
    // Straight at the face the first cut made, so the red shapes read flat on.
    const azimuth = Math.atan2(-Math.cos(a0), Math.sin(a0));
    return framePose(
      {
        target: this.wedgeCentre.clone().add(new THREE.Vector3(0, 0.008, 0)),
        azimuth,
        elevation: (this.portrait ? 26 : 20) * (Math.PI / 180),
        // Room above and below the slice so the two buttons never sit on it.
        fitH: this.portrait ? 0.064 : 0.112,
        fitV: this.portrait ? 0.098 : 0.086,
        fov: this.portrait ? 40 : 34,
      },
      this.aspect,
    );
  }

  /* --------------------------------------------------------------- phase */

  private enter(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
    this.rig.moveTo(this.cameraFor(phase), phase === 'intro' ? 0.01 : 0.9);

    switch (phase) {
      case 'intro':
        this.tools.show('none');
        this.setTrayCount(1);
        break;
      case 'patissier':
        this.tools.show('none');
        this.setTrayCount(0);
        break;
      case 'fill':
        this.setTrayCount(0);
        this.tools.show('piping', false);
        // Fill to just over the tallest slice actually in the cake, so nothing
        // is left sticking out when the upper sponge goes on.
        this.fillTarget = this.computeFillTarget();
        this.fillGap0 = Math.max(1e-9, this.cream.gapVolume(this.fillTarget));
        this.nozzle.set(CAKE.ringRadius, CREAM_SURFACE, 0);
        break;
      case 'level':
        this.tools.show('palette', false);
        this.sweepAngle = 0;
        this.swept = 0;
        break;
      case 'topSponge':
        this.tools.show('none');
        this.spongeLift = 0.085;
        this.cake.setTopSponge(true, CAKE.creamBase + this.cream.maxHeight(), this.spongeLift);
        break;
      case 'nappage':
        this.tools.show('palette');
        this.nappageSweep = 0;
        this.cake.setCoat(0, false);
        break;
      case 'chooseCut':
        this.tools.show('knife', false);
        this.cakeAnchor.rotation.y = 0;
        this.turntable.rotation.y = 0;
        this.buildCutGuide();
        break;
      case 'cutting':
        this.cutStage = 0;
        this.cutT = 0;
        this.cutGuide.visible = false;
        this.tools.show('knife');
        break;
      case 'reveal':
        this.tools.show('none');
        this.overhead = false;
        this.replay.record(this.placements, this.selector.index, this.revealItems.length);
        this.audio.reveal();
        break;
      case 'design':
        this.round++;
        this.setTrayCount(BERRY_VARIANTS.length);
        this.tools.show('none');
        this.reopen();
        break;
    }
  }

  private computeFillTarget(): number {
    let top = CAKE.creamBase + CAKE.creamInitial;
    for (const p of this.placements) {
      const box = this.catalog.get(p.variantId).near.boundingBox;
      if (!box) continue;
      const q = orientationQuaternion(p.orientation, this.ring.slot(p.slotId).angle, 0);
      top = Math.max(top, p.seatY + topOffset(box, q));
    }
    return Math.min(CAKE.creamBase + 0.05, top + 0.0022);
  }

  /** The first play shows the causal chain once, briefly, then gets out of it. */
  private get tutorial(): boolean {
    return this.round === 0;
  }

  private setTrayCount(n: number): void {
    this.tray.showOnly(n);
  }

  /* --------------------------------------------------------------- input */

  private groundAt(p: PointerSample): THREE.Vector3 | null {
    this.raycaster.setFromCamera(p.ndc, this.rig.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, hit) ? hit : null;
  }

  private onDown(p: PointerSample): void {
    this.audio.unlock();
    this.pointerActive = true;
    this.dragging = false;
    this.pending = null;

    if (this.phase === 'intro' || this.phase === 'design') {
      this.raycaster.setFromCamera(p.ndc, this.rig.camera);
      const trayHits = this.raycaster.intersectObjects(this.tray.pickables(), true);
      if (trayHits.length) {
        const variant = findUserData(trayHits[0].object, 'trayVariant') as string | undefined;
        if (variant) {
          this.pending = { slotId: -1, variantId: variant };
          return;
        }
      }
      const cakeHits = this.raycaster.intersectObject(this.cake.root, true);
      for (const hit of cakeHits) {
        const slotId = findUserData(hit.object, 'slotId') as number | undefined;
        if (slotId !== undefined) {
          const placed = this.placements.find((q) => q.slotId === slotId);
          if (placed) this.pending = { slotId, variantId: placed.variantId };
          return;
        }
      }
    }

    if (this.phase === 'fill') this.audio.pipe(true);
    if (this.phase === 'chooseCut') {
      const g = this.groundAt(p);
      if (g && this.selector.aimAt(g.x, g.z)) this.audio.turn();
    }
  }

  private onMove(p: PointerSample): void {
    const g = this.groundAt(p);

    if (!this.dragging && this.pending && this.pointerActive) {
      const started = this.beginCarry(this.pending);
      if (started) this.dragging = true;
    }

    if (this.dragging && this.carried && g) {
      this.updateCarry(g, p);
    }

    if (this.phase === 'fill' && g) {
      // The nozzle tip is drawn a little above the finger so the hand never
      // covers the place the cream is going.
      this.nozzle.set(g.x, CREAM_SURFACE, g.z - 0.014);
    }
    if (this.phase === 'level' && g) {
      this.sweepAngle = Math.atan2(g.z, g.x);
    }
    if (this.phase === 'topSponge' && g) {
      const reach = clamp(1 - Math.hypot(g.x, g.z) / 0.14, 0, 1);
      this.spongeLift = Math.min(this.spongeLift, lerp(0.085, 0, reach));
    }
    if (this.phase === 'chooseCut' && g) {
      if (this.selector.aimAt(g.x, g.z)) {
        this.audio.turn();
        this.buildCutGuide();
      }
    }
  }

  private onUp(p: PointerSample, end: GestureEnd): void {
    this.pointerActive = false;
    this.audio.pipe(false);

    if (this.dragging && this.carried) {
      this.dropCarry();
      this.dragging = false;
      this.pending = null;
      return;
    }

    if (end.tap && this.pending && this.pending.slotId >= 0) {
      const placed = this.placements.find((q) => q.slotId === this.pending!.slotId);
      if (placed) {
        placed.orientation = nextOrientation(placed.orientation);
        placed.seatY = computeSeatY(
          this.ring.slot(placed.slotId),
          placed.orientation,
          placed.sink,
          this.catalog.get(placed.variantId).near.boundingBox!,
          this.creamTopAt,
        );
        this.cake.syncPlacements(this.placements);
        this.audio.turn();
      }
    }
    this.pending = null;
    void p;
  }

  /* ------------------------------------------------------------ carrying */

  private beginCarry(pending: { slotId: number; variantId: string }): boolean {
    if (this.phase !== 'intro' && this.phase !== 'design') return false;
    let orientation: OrientationId = 'faceOut';
    if (pending.slotId >= 0) {
      const idx = this.placements.findIndex((q) => q.slotId === pending.slotId);
      if (idx < 0) return false;
      orientation = this.placements[idx].orientation;
      this.placements.splice(idx, 1);
      this.cake.syncPlacements(this.placements);
    }
    this.carried = { variantId: pending.variantId };
    this.carriedSlot = null;
    this.makeGhost(pending.variantId, orientation);
    this.audio.pick();
    return true;
  }

  private makeGhost(variantId: string, orientation: OrientationId): void {
    if (this.ghost && this.ghostVariant === variantId) {
      this.ghost.visible = true;
      this.ghost.userData.orientation = orientation;
      return;
    }
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghost = null;
    }
    const assets = this.catalog.get(variantId);
    const set = this.materials.berry(assets);
    const mesh = new THREE.Mesh(assets.near, [set.flesh, set.skin]);
    mesh.castShadow = true;
    const g = new THREE.Group();
    g.add(mesh);
    g.userData.orientation = orientation;
    this.ghostVariant = variantId;
    this.ghost = g;
    this.scene.add(g);
  }

  private updateCarry(ground: THREE.Vector3, _p: PointerSample): void {
    if (!this.carried || !this.ghost) return;
    const taken = new Set(this.placements.map((q) => q.slotId));
    const allowCentre = this.phase === 'design';
    const slot = this.ring.nearest(ground.x, ground.z, SNAP_RADIUS, taken);
    const usable = slot && (allowCentre || !slot.center) ? slot : null;
    this.carriedSlot = usable ? usable.id : null;

    const orientation = this.ghost.userData.orientation as OrientationId;
    const assets = this.catalog.get(this.carried.variantId);
    if (usable) {
      // Strong pull: the berry jumps into the well rather than hovering near it.
      const y = computeSeatY(usable, orientation, 0.002, assets.near.boundingBox!, this.creamTopAt);
      this.carriedPos.lerp(new THREE.Vector3(usable.x, y + 0.006, usable.z), 0.55);
      this.ghost.quaternion.slerp(orientationQuaternion(orientation, usable.angle, 0), 0.5);
    } else {
      this.carriedPos.lerp(new THREE.Vector3(ground.x, CREAM_SURFACE + 0.024, ground.z), 0.6);
      this.ghost.quaternion.slerp(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2.3, 0, 0)),
        0.25,
      );
    }
    this.ghost.position.copy(this.carriedPos);
  }

  private dropCarry(): void {
    if (!this.carried) return;
    const variantId = this.carried.variantId;
    const orientation = (this.ghost?.userData.orientation as OrientationId) ?? 'faceOut';
    if (this.ghost) this.ghost.visible = false;

    if (this.carriedSlot !== null) {
      this.commitPlacement(this.carriedSlot, variantId, orientation, true);
    }
    this.carried = null;
    this.carriedSlot = null;
    if (this.phase === 'intro' && this.placements.length >= 1) {
      window.setTimeout(() => {
        if (this.phase === 'intro') this.enter('patissier');
      }, 900);
    }
  }

  private commitPlacement(
    slotId: number,
    variantId: string,
    orientation: OrientationId,
    byPlayer: boolean,
  ): void {
    const slot = this.ring.slot(slotId);
    const v = this.catalog.variant(variantId);
    const sink = 0.0021 + this.rng.jitter(0.0004);
    this.placements.push({
      slotId,
      variantId,
      orientation,
      wobble: this.rng.jitter(1),
      sink,
      byPlayer,
      lift: 0.007,
      seatY: computeSeatY(
        slot,
        orientation,
        sink,
        this.catalog.get(variantId).near.boundingBox!,
        this.creamTopAt,
      ),
    });
    // The cream really is pushed aside; the dimple and its rim stay behind.
    this.cream.press(slot.x, slot.z, v.width * 0.62, 0.0019);
    this.cake.refreshCream();
    this.cake.syncPlacements(this.placements);
    this.audio.settle();
  }

  /* ------------------------------------------------------------- actions */

  private onAction(id: string): void {
    this.audio.unlock();
    switch (id) {
      case 'close':
        this.enter('fill');
        break;
      case 'next':
        this.advanceStep();
        break;
      case 'cut':
        this.enter('cutting');
        break;
      case 'back':
        this.enter('design');
        break;
      case 'view':
        this.overhead = !this.overhead;
        this.rig.moveTo(this.cameraFor(this.phase), 0.8);
        break;
      case 'again':
        this.enter('design');
        break;
    }
  }

  private advanceStep(): void {
    switch (this.phase) {
      case 'fill':
        this.finishFill();
        break;
      case 'level':
        this.finishLevel();
        break;
      case 'topSponge':
        this.spongeLift = 0;
        break;
      case 'nappage':
        this.nappageSweep = 1;
        break;
      default:
        break;
    }
  }

  /* ----------------------------------------------------------- cut guide */

  private buildCutGuide(): void {
    this.cutGuide.clear();
    this.cutGuide.visible = true;
    const { a0, a1 } = this.selector.planes();
    const y = this.cake.topY + CAKE.coatThickness + 0.00025;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xbdb2a6,
      transparent: true,
      opacity: 0.4,
      toneMapped: false,
    });
    for (const a of [a0, a1]) {
      // A shallow scored line, the way a patissier marks a portion. No glow.
      const line = new THREE.Mesh(new THREE.PlaneGeometry(CAKE.radius, 0.0011), mat);
      line.rotation.x = -Math.PI / 2;
      line.rotation.z = -a;
      line.position.set(
        (Math.cos(a) * CAKE.radius) / 2,
        y,
        (Math.sin(a) * CAKE.radius) / 2,
      );
      this.cutGuide.add(line);
    }
  }

  /* --------------------------------------------------------------- steps */

  private finishFill(): void {
    let guard = 0;
    while (this.cream.gapVolume(this.fillTarget) > this.fillGap0 * 0.05 && guard++ < 500) {
      const gap = this.cream.worstGap(this.fillTarget);
      this.cream.fill(gap.x, gap.z, 0.02, this.fillTarget, 0.0022);
    }
    this.cake.refreshCream(true);
    this.enter('level');
  }

  private finishLevel(): void {
    const target = CAKE.creamBase + this.cream.maxHeight();
    for (let i = 0; i < 26; i++) {
      this.cream.level(target, 0.35, (i / 26) * TAU, 0.7);
    }
    this.cake.refreshCream(true);
    this.enter('topSponge');
  }

  private settleBerries(dt: number): void {
    for (const p of this.placements) {
      if (p.lift > 0) p.lift = Math.max(0, p.lift - dt * 0.05);
      const slot = this.ring.slot(p.slotId);
      const support = this.cream.heightAt(
        Math.atan2(slot.z, slot.x),
        Math.hypot(slot.x, slot.z),
      );
      // Cream rising around a slice steadies it; the lean settles, never snaps.
      const steady = smoothstep(CAKE.creamInitial, 0.02, support);
      p.wobble = lerp(p.wobble, p.wobble * (1 - steady), Math.min(1, dt * 2.2));
    }
  }

  /* ---------------------------------------------------------- the knife */

  private startCut(): void {
    const planes = this.selector.planes();
    // Cut faces sit a sixth of a millimetre proud of the cream they cut through.
    const eps = 0.00016;
    this.disposePieces();

    this.wedge = new CakeView(this.materials, this.catalog, this.quality, this.cream, this.ring, {
      a0: planes.a0,
      a1: planes.a1,
      clip: { planes: [planes.planeA, planes.planeB], union: false },
      caps: [
        { plane: planes.planeA, flip: true, offset: -eps, reach: planes.reachA },
        { plane: planes.planeB, flip: true, offset: -eps, reach: planes.reachB },
      ],
    });
    this.remain = new CakeView(this.materials, this.catalog, this.quality, this.cream, this.ring, {
      a0: planes.a1,
      a1: planes.a0 + TAU,
      clip: {
        planes: [
          new THREE.Plane(planes.planeA.normal.clone().negate(), 0),
          new THREE.Plane(planes.planeB.normal.clone().negate(), 0),
        ],
        union: true,
      },
      caps: [
        { plane: planes.planeA, flip: false, offset: eps, reach: planes.reachA },
        { plane: planes.planeB, flip: false, offset: eps, reach: planes.reachB },
      ],
    });

    for (const piece of [this.wedge, this.remain]) {
      piece.setTopSponge(true, this.cake.topY - CAKE.topSpongeThickness);
      piece.setCoat(1, true);
      piece.syncPlacements(this.placements);
      this.cakeAnchor.add(piece.root);
    }
    this.revealItems = this.wedge.buildCaps(this.placements);
    this.remain.buildCaps(this.placements);
    this.cake.root.visible = false;

    const mid = planes.a0 + CAKE.wedgeSpan / 2;
    this.wedgeCentre.set(
      Math.cos(mid) * CAKE.radius * 0.6,
      CAKE.creamBase + 0.012,
      Math.sin(mid) * CAKE.radius * 0.6,
    );
  }

  private updateCutting(dt: number): void {
    const planes = this.selector.planes();
    this.cutT += dt;
    const knife = this.tools.knife;

    if (this.cutStage === 0 || this.cutStage === 1) {
      const angle = this.cutStage === 0 ? planes.a0 : planes.a1;
      const t = clamp(this.cutT / 1.05, 0, 1);
      const top = this.cake.topY + CAKE.coatThickness;
      knife.visible = true;
      // Blade lies in the plane it is cutting and travels down through it.
      knife.position.set(
        Math.cos(angle) * (CAKE.radius * 0.5),
        lerp(top + 0.055, -0.004, smoothstep(0, 1, t)),
        Math.sin(angle) * (CAKE.radius * 0.5),
      );
      knife.rotation.set(0, -angle + Math.PI, 0);
      knife.position.x -= Math.cos(angle) * 0.0;
      if (this.cutT > 0.12 && this.cutT < 0.2) this.audio.cut();
      if (t >= 1) {
        this.cutStage++;
        this.cutT = 0;
        if (this.cutStage === 2) {
          this.startCut();
          this.tools.show('server');
        }
      }
      return;
    }

    const mid = planes.a0 + CAKE.wedgeSpan / 2;
    if (this.cutStage === 2) {
      const t = clamp(this.cutT / 0.9, 0, 1);
      const server = this.tools.server;
      server.visible = true;
      server.position.set(
        Math.cos(mid) * lerp(0.16, 0.03, t),
        CAKE.creamBase * 0.5,
        Math.sin(mid) * lerp(0.16, 0.03, t),
      );
      server.rotation.set(0, -mid + Math.PI, 0.03);
      if (t >= 1) {
        this.cutStage = 3;
        this.cutT = 0;
        this.audio.lift();
      }
      return;
    }

    if (this.cutStage === 3) {
      const t = clamp(this.cutT / 1.25, 0, 1);
      const k = smoothstep(0, 1, t);
      const outward = new THREE.Vector3(Math.cos(mid), 0, Math.sin(mid));
      if (this.wedge) {
        this.wedge.setOffset(
          outward.x * k * 0.108,
          Math.sin(k * Math.PI) * 0.012,
          outward.z * k * 0.108,
        );
      }
      const server = this.tools.server;
      server.position.copy(outward).multiplyScalar(lerp(0.03, 0.12, k));
      server.position.y = Math.sin(k * Math.PI) * 0.012 + CAKE.creamBase * 0.5;
      this.plate.visible = k > 0.35;
      this.plate.position.copy(outward).multiplyScalar(0.112);
      this.plate.position.y = -0.0016;
      this.wedgeCentre.copy(outward).multiplyScalar(CAKE.radius * 0.58 + k * 0.108);
      this.wedgeCentre.y = CAKE.creamBase + 0.014;
      if (t >= 1) {
        this.tools.show('none');
        this.enter('reveal');
      }
    }
  }

  /* --------------------------------------------------------------- tools */

  private poseNozzle(): void {
    const bag = this.tools.piping;
    const a = Math.atan2(this.nozzle.z, this.nozzle.x);
    const r = Math.hypot(this.nozzle.x, this.nozzle.z);
    const surface = this.cream.topAt(a, Math.min(r, CAKE.radius));
    bag.position.set(this.nozzle.x, surface + 0.004, this.nozzle.z);
    bag.rotation.set(0.34, -a + Math.PI / 2, 0.12);
  }

  private posePalette(angle: number, radiusIn: number, height: number): void {
    const p = this.tools.palette;
    p.position.set(Math.cos(angle) * radiusIn, height, Math.sin(angle) * radiusIn);
    p.rotation.set(0, -angle + Math.PI, -0.06);
  }

  /* ---------------------------------------------------------------- loop */

  private updatePhase(dt: number): void {
    this.phaseTime += dt;
    switch (this.phase) {
      case 'patissier': {
        const want = Math.min(CAKE.ringSlots, 1 + Math.floor(this.phaseTime / 0.34));
        const taken = new Set(this.placements.map((p) => p.slotId));
        if (this.placements.length < want) {
          for (let i = 0; i < CAKE.ringSlots; i++) {
            if (!taken.has(i)) {
              // The patissier completes the ring in the same orientation the
              // child chose, so the pattern reads as one ring, not two ideas.
              const first = this.placements[0];
              const variant = BERRY_VARIANTS[(i * 5 + 2) % BERRY_VARIANTS.length].id;
              this.commitPlacement(i, variant, first?.orientation ?? 'faceOut', false);
              break;
            }
          }
        } else if (this.phaseTime > CAKE.ringSlots * 0.34 + 0.7) {
          this.enter('fill');
        }
        break;
      }
      case 'fill': {
        const gap = this.cream.gapVolume(this.fillTarget);
        if (!this.pointerActive) {
          // Unattended, the nozzle finds the largest remaining void itself.
          const worst = this.cream.worstGap(this.fillTarget);
          this.nozzle.lerp(new THREE.Vector3(worst.x, CREAM_SURFACE, worst.z), dt * 3.2);
        }
        const rate = this.tutorial ? 0.062 : 0.03;
        this.cream.fill(this.nozzle.x, this.nozzle.z, 0.019, this.fillTarget, dt * rate);
        this.cake.refreshCream();
        this.poseNozzle();
        this.settleBerries(dt);
        if (gap < this.fillGap0 * 0.06 || this.phaseTime > (this.tutorial ? 9 : 16)) {
          this.finishFill();
        }
        break;
      }
      case 'level': {
        const spin = this.tutorial ? 4.2 : 2.4;
        if (!this.pointerActive) this.sweepAngle += dt * spin;
        const target = CAKE.creamBase + this.cream.maxHeight();
        this.cream.level(target, dt * 2.6, this.sweepAngle, 0.55);
        this.swept += dt * spin;
        this.cake.refreshCream();
        this.posePalette(this.sweepAngle, CAKE.radius * 0.55, target + 0.004);
        if (this.phaseTime > 0.4 && Math.random() < dt * 2) this.audio.scrape();
        this.settleBerries(dt);
        if (this.swept > TAU * 1.05) this.finishLevel();
        break;
      }
      case 'topSponge': {
        const base = CAKE.creamBase + this.cream.maxHeight();
        if (!this.pointerActive) {
          this.spongeLift = Math.max(0, this.spongeLift - dt * (this.tutorial ? 0.09 : 0.055));
        }
        this.cake.setTopSponge(true, base, this.spongeLift);
        if (this.spongeLift <= 0.0001) {
          // The load presses the cream and the berries down; nothing floats.
          this.cream.compress(0.72, base);
          for (const p of this.placements) {
            p.sink = Math.min(0.0034, p.sink + 0.0006);
            p.seatY -= 0.0006;
          }
          const settled = CAKE.creamBase + this.cream.maxHeight();
          this.cake.setTopSponge(true, settled, 0);
          this.cake.refreshCream(true);
          this.cake.syncPlacements(this.placements);
          this.audio.settle();
          this.enter('nappage');
        }
        break;
      }
      case 'nappage': {
        // The wall is really built on a turning table: no cut to black, no swap.
        const speed = this.tutorial ? 0.42 : 0.28;
        this.nappageSweep = Math.min(1, this.nappageSweep + dt * speed);
        this.cakeAnchor.rotation.y = this.nappageSweep * TAU;
        this.turntable.rotation.y = this.cakeAnchor.rotation.y;
        this.cake.setCoat(this.nappageSweep, this.nappageSweep > 0.72);
        // The blade is held still against the turning cake, not swept round it:
        // flat face to the wall, edge tangential, handle above.
        const hold = Math.PI / 2.15;
        const p = this.tools.palette;
        p.position.set(
          Math.cos(hold) * (CAKE.radius + CAKE.coatThickness + 0.0012),
          this.cake.topY + 0.014,
          Math.sin(hold) * (CAKE.radius + CAKE.coatThickness + 0.0012),
        );
        p.rotation.set(0, -(hold + Math.PI / 2), -Math.PI / 2);
        if (Math.random() < dt * 1.4) this.audio.scrape();
        if (this.nappageSweep >= 1) {
          this.cakeAnchor.rotation.y = 0;
          this.turntable.rotation.y = 0;
          if (this.tutorial) {
            // First play: the knife goes through the slice the child put in, so
            // the one thing they did is the one thing they see come back.
            const mine = this.placements.find((p) => p.byPlayer);
            this.selector.index = mine && mine.slotId < CAKE.ringSlots ? mine.slotId : 0;
            this.enter('cutting');
          } else {
            this.enter('chooseCut');
          }
        }
        break;
      }
      case 'chooseCut': {
        // Lined up just outside the rim so the scored lines on the top stay
        // readable: the knife shows the direction, it does not cover the cake.
        const a = this.selector.angle;
        const top = this.cake.topY + CAKE.coatThickness;
        const r = CAKE.radius + 0.055;
        this.tools.knife.position.set(
          Math.cos(a) * r,
          top + 0.026 + Math.sin(this.phaseTime * 2) * 0.0016,
          Math.sin(a) * r,
        );
        this.tools.knife.rotation.set(0, -a + Math.PI, -0.14);
        break;
      }
      case 'cutting':
        this.updateCutting(dt);
        break;
      default:
        break;
    }
  }

  private updateHud(): void {
    switch (this.phase) {
      case 'intro':
        this.hud.set({
          line: 'いちごを ひとつ おいてみよう',
          sub: 'ゆびで ひっぱって、くぼみに いれてね',
        });
        break;
      case 'patissier':
        this.hud.set({ line: 'のこりも おいて、あかい わっかに するよ' });
        break;
      case 'fill':
        this.hud.set({
          line: 'すきまに クリームを いれる',
          sub: 'ゆびで なぞってね',
          actions: [{ id: 'next', label: 'できた' }],
        });
        break;
      case 'level':
        this.hud.set({
          line: 'たいらに ならす',
          actions: [{ id: 'next', label: 'できた' }],
        });
        break;
      case 'topSponge':
        this.hud.set({
          line: 'うえの スポンジを のせる',
          sub: 'まんなかへ ひっぱって',
          actions: [{ id: 'next', label: 'のせる' }],
        });
        break;
      case 'nappage':
        this.hud.set({ line: 'そとがわを しろく する' });
        break;
      case 'chooseCut':
        this.hud.set({
          line: 'どのむきで きる？',
          sub: 'ふちを ゆびで なぞって きめてね',
          actions: [{ id: 'cut', label: 'きる', primary: true }],
        });
        break;
      case 'cutting':
        this.hud.set({ line: '' });
        break;
      case 'reveal': {
        const shown = new Set(this.revealItems.map((r) => r.slotId)).size;
        const mine = this.revealItems.some((r) => r.byPlayer);
        this.hud.set({
          line:
            shown === 0
              ? 'こんどは いちごに あたらなかった'
              : mine && this.tutorial
                ? 'きみが おいた いちごが でた！'
                : 'あかい かたちが でた！',
          sub:
            shown > 0
              ? this.tutorial
                ? 'なかに わっかに して おくと、きったところに でるよ'
                : this.replay.sameRingNewCut
                ? `おなじ ならべかたでも ちがう かたち・きれた いちご ${shown}こ`
                : `きれた いちご ${shown}こ`
              : 'きる むきを かえると あたるよ',
          actions: this.portrait
            ? [
                { id: 'view', label: 'みかたを かえる' },
                { id: 'back', label: 'もどる', primary: true },
              ]
            : [{ id: 'back', label: 'もどる', primary: true }],
        });
        break;
      }
      case 'design':
        this.hud.set({
          line:
            this.round <= 1
              ? 'すきな ところに おいてみよう'
              : this.replay.suggestion(this.placements),
          sub: 'タップで むきが かわる / そとへ ひっぱると とれる',
          actions: [{ id: 'close', label: 'とじて きる', primary: true }],
        });
        break;
    }
  }

  private frame = (now: number): void => {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000 || 0.016);
    this.lastTime = now;

    if (this.quality.sample(dt * 1000, now)) {
      this.renderer.setPixelRatio(this.quality.pixelRatio);
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    }

    this.updatePhase(dt);
    this.rig.update(dt);
    if (this.placements.some((p) => p.lift > 0)) {
      this.settleBerries(dt);
      this.cake.syncPlacements(this.placements);
    }
    this.updateHud();

    for (const view of [this.cake, this.wedge, this.remain]) {
      if (!view || !view.root.visible) continue;
      view.root.updateMatrixWorld();
      view.updateLods(this.rig.camera);
    }

    this.renderer.render(this.scene, this.rig.camera);
    requestAnimationFrame(this.frame);
  };

  /**
   * Scripted access used by the correspondence harness, which drives a whole
   * round headlessly and checks that the faces in the reveal match the
   * placements it made. It calls the same functions the fingers do.
   */
  readonly harness = {
    place: (slotId: number, variantId: string, orientation: OrientationId): void => {
      if (this.placements.some((p) => p.slotId === slotId)) return;
      this.commitPlacement(slotId, variantId, orientation, true);
    },
    clear: (): void => {
      this.placements = [];
      this.reopen();
    },
    turn: (slotId: number): void => {
      const p = this.placements.find((q) => q.slotId === slotId);
      if (!p) return;
      p.orientation = nextOrientation(p.orientation);
      p.seatY = computeSeatY(
        this.ring.slot(p.slotId),
        p.orientation,
        p.sink,
        this.catalog.get(p.variantId).near.boundingBox!,
        this.creamTopAt,
      );
      this.cake.syncPlacements(this.placements);
    },
    aim: (index: number): void => {
      this.selector.index = index;
    },
    /** Close the cake using the same fill, level, load and coat steps. */
    close: (): void => {
      this.enter('fill');
      this.finishFill();
      this.finishLevel();
      const base = CAKE.creamBase + this.cream.maxHeight();
      this.cream.compress(0.72, base);
      for (const p of this.placements) {
        p.sink = Math.min(0.0034, p.sink + 0.0006);
        p.seatY -= 0.0006;
      }
      const settled = CAKE.creamBase + this.cream.maxHeight();
      this.cake.setTopSponge(true, settled, 0);
      this.cake.refreshCream(true);
      this.cake.syncPlacements(this.placements);
      this.cake.setCoat(1, true);
      this.enter('chooseCut');
    },
    cut: (): void => {
      this.enter('cutting');
      this.startCut();
      this.tools.show('none');
      const planes = this.selector.planes();
      const mid = planes.a0 + CAKE.wedgeSpan / 2;
      const outward = new THREE.Vector3(Math.cos(mid), 0, Math.sin(mid));
      if (this.wedge) {
        this.wedge.setOffset(outward.x * 0.108, 0, outward.z * 0.108);
      }
      this.wedgeCentre.copy(outward).multiplyScalar(CAKE.radius * 0.58 + 0.108);
      this.wedgeCentre.y = CAKE.creamBase + 0.014;
      this.plate.visible = true;
      this.plate.position.copy(outward).multiplyScalar(0.112);
      this.plate.position.y = -0.0016;
      this.enter('reveal');
    },
    /** Skip the camera move; the harness screenshots do not wait for tweens. */
    snapCamera: (): void => {
      this.rig.snapTo(this.cameraFor(this.phase));
    },
    state: (): { phase: string; camera: number[]; wedgeCentre: number[]; topY: number } => ({
      phase: this.phase,
      camera: this.rig.camera.position.toArray(),
      wedgeCentre: this.wedgeCentre.toArray(),
      topY: this.cake.topY,
    }),
    report: (): {
      placements: { slotId: number; variantId: string; orientation: string }[];
      cut: number;
      faces: { slotId: number; variantId: string; orientation: string; areaMm2: number; radiusMm: number; heightMm: number }[];
    } => ({
      placements: this.placements.map((p) => ({
        slotId: p.slotId,
        variantId: p.variantId,
        orientation: p.orientation,
      })),
      cut: this.selector.index,
      faces: this.revealItems.map((r) => ({
        slotId: r.slotId,
        variantId: r.variantId,
        orientation: r.orientation,
        areaMm2: r.cap.area * 1e6,
        radiusMm: Math.hypot(r.cap.centre.x, r.cap.centre.z) * 1000,
        heightMm: r.cap.centre.y * 1000,
      })),
    }),
  };

  start(): void {
    this.ready = true;
    this.resize();
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
    // The room arrives after the cake is already on screen and touchable.
    void import('../content/Kitchen').then(({ buildKitchen }) => {
      const room = buildKitchen(this.materials);
      this.scene.add(room);
    });
    window.setTimeout(() => Hud.hideBoot(), 260);
  }
}

function findUserData(object: THREE.Object3D, key: string): unknown {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (node.userData && key in node.userData) return node.userData[key];
    node = node.parent;
  }
  return undefined;
}

