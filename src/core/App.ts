import * as THREE from 'three';
import { AdaptiveQuality } from './AdaptiveQuality';
import { buildNozzles, type NozzleId, type NozzleSpec } from '../piping/NozzleProfile';
import { buildNozzle, type NozzleObject } from '../scene/NozzleMesh';
import { CakeSurfaceContact, CAKE_TOP } from '../scene/CakeSurfaceContact';
import { Cake } from '../scene/Cake';
import { buildStrawberries } from '../scene/Strawberries';
import { buildKitchen } from '../scene/Kitchen';
import { PipingBag } from '../scene/PipingBag';
import { PastryHand } from '../scene/PastryHand';
import { PipingController } from '../piping/PipingController';
import { PipingInput } from '../piping/PipingInput';
import { DecorationHistory } from '../state/DecorationHistory';
import { CameraDirector } from '../camera/CameraDirector';
import { GameFlow } from '../state/GameFlow';
import { Hints } from '../ui/Hints';
import { CreamMaterial } from '../render/CreamMaterial';
import { makeEnvironmentTexture } from '../render/KitchenEnvironment';
import { clamp, damp, lerp, smoothstep } from '../util/math';

type SlotState = 'bench' | 'attached' | 'dragging' | 'toBag' | 'toBench';

interface NozzleSlot {
  obj: NozzleObject;
  state: SlotState;
  home: THREE.Vector3;
  homeQuat: THREE.Quaternion;
  startPos: THREE.Vector3;
  startQuat: THREE.Quaternion;
  anim: number;
  pick: THREE.Mesh;
}

const BENCH_Y = 0.0125;

export class App {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(31, 1, 0.008, 40);
  private quality: AdaptiveQuality;
  private director: CameraDirector;
  private contact = new CakeSurfaceContact();
  private cake: Cake;
  private history: DecorationHistory;
  private controller: PipingController;
  private input: PipingInput;
  private bag = new PipingBag();
  private hand = new PastryHand();
  private handPivot = new THREE.Group();
  private hints: Hints;
  private flow = new GameFlow();
  private specs: Record<NozzleId, NozzleSpec>;
  private slots: NozzleSlot[] = [];
  private toolGroup = new THREE.Group();
  private tableGroup = new THREE.Group();
  private key!: THREE.DirectionalLight;
  private finishedCream: CreamMaterial;
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private dragSlot: NozzleSlot | null = null;
  private dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.055);
  private dragPoint = new THREE.Vector3();
  private activePointer = -1;
  private width = 1;
  private height = 1;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private tableAngle = 0;
  private undoBtn: HTMLButtonElement | null;
  private introTip = new THREE.Vector3(0, 0.208, 0.004);
  private hoverX = 0;
  private hoverZ = 0;
  private strokeDir = new THREE.Vector2(1, 0);
  private holdShotUntil = 0;
  private latestMeshRef: THREE.Object3D | null = null;
  private lastDrop: { px: number; toHome: number; attached: boolean } | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.quality = new AdaptiveQuality(this.renderer);
    const q = this.quality.settings;
    this.specs = buildNozzles(q);

    this.scene.background = new THREE.Color(0xd7d1c5);
    this.scene.environment = makeEnvironmentTexture(this.renderer);
    this.scene.environmentIntensity = 0.78;

    // ---- lighting -------------------------------------------------------
    const kitchen = buildKitchen();
    this.scene.add(kitchen.group);

    const hemi = new THREE.HemisphereLight(0xf4eee2, 0xa29884, 0.34);
    this.scene.add(hemi);

    this.key = new THREE.DirectionalLight(0xfff2df, 2.25);
    // key light comes from the window in the back wall, up and to the left
    this.key.position.copy(kitchen.windowDir).multiplyScalar(1.1).setY(0.86);
    this.key.target.position.set(0, CAKE_TOP, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    const sc = this.key.shadow.camera;
    sc.left = -0.34;
    sc.right = 0.34;
    sc.top = 0.40;
    sc.bottom = -0.24;
    // the shadow frustum hugs the subject: at 0.02..1.6 the depth precision
    // was thin enough to stripe the turntable
    sc.near = 0.55;
    sc.far = 2.05;
    this.key.shadow.bias = -0.00018;
    this.key.shadow.normalBias = 0.0025;
    this.key.shadow.radius = 2.2;
    this.scene.add(this.key, this.key.target);
    this.quality.bindShadowResize((size) => {
      this.key.shadow.mapSize.set(size, size);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    });

    const fill = new THREE.DirectionalLight(0xe4ecf4, 0.30);
    fill.position.set(0.75, 0.55, 0.9);
    this.scene.add(fill);

    // ---- cake -----------------------------------------------------------
    this.cake = new Cake(this.contact, q);
    this.tableGroup.add(this.cake.group);
    this.tableGroup.add(buildStrawberries(this.contact));
    this.scene.add(this.tableGroup);
    this.turntable = kitchen.turntable;

    this.finishedCream = new CreamMaterial({ bubble: q.bubble, settle: true });
    this.finishedCream.enableSettle();
    this.history = new DecorationHistory(this.finishedCream);
    this.tableGroup.add(this.history.group);

    // ---- tool -----------------------------------------------------------
    let maxPts = 0;
    for (const id of ['openStar', 'round', 'petal'] as NozzleId[]) {
      maxPts = Math.max(maxPts, this.specs[id].cream.count, this.specs[id].opening.count);
    }
    this.controller = new PipingController(this.contact, this.specs.openStar, q.bubble, maxPts + 2);
    this.scene.add(this.controller.liveMesh);
    this.controller.onFinish = (d) => this.onStrokeFinished(d);
    this.controller.onVolume = (v) => this.bag.morph.consume(v);

    this.bag.group.position.y = this.specs.openStar.length * 0.6;
    this.toolGroup.add(this.bag.group);
    this.handPivot.position.set(0, 0.116, 0);
    this.handPivot.rotation.set(0, Math.PI, -0.30);
    this.hand.group.position.set(-0.047, 0, -0.033);
    this.hand.group.rotation.x = -Math.PI / 2;
    this.handPivot.add(this.hand.group);
    this.bag.group.add(this.handPivot);
    this.scene.add(this.toolGroup);

    const slotDefs: { id: NozzleId; stow: THREE.Vector3; row: THREE.Vector3 }[] = [
      {
        id: 'openStar',
        stow: new THREE.Vector3(0.058, BENCH_Y, -0.128),
        row: new THREE.Vector3(0.058, BENCH_Y, -0.128),
      },
      {
        id: 'round',
        stow: new THREE.Vector3(0.104, BENCH_Y, -0.088),
        row: new THREE.Vector3(0.108, BENCH_Y, -0.098),
      },
      {
        id: 'petal',
        stow: new THREE.Vector3(0.142, BENCH_Y, -0.058),
        row: new THREE.Vector3(0.156, BENCH_Y, -0.066),
      },
    ];

    for (const def of slotDefs) {
      const obj = buildNozzle(this.specs[def.id], q.nozzleRings);
      const quat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          -Math.PI * 0.5 + 0.12,
          def.id === 'petal' ? 0.55 : def.id === 'round' ? -0.2 : -0.75,
          0,
          'YXZ',
        ),
      );
      const pick = new THREE.Mesh(
        new THREE.SphereGeometry(0.019, 8, 6),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      pick.position.y = 0.012;
      obj.group.add(pick);
      const slot: NozzleSlot = {
        obj,
        state: def.id === 'openStar' ? 'attached' : 'bench',
        home: def.stow.clone(),
        homeQuat: quat,
        startPos: new THREE.Vector3(),
        startQuat: new THREE.Quaternion(),
        anim: 0,
        pick,
      };
      slot.obj.group.position.copy(slot.home);
      slot.obj.group.quaternion.copy(quat);
      this.scene.add(obj.group);
      this.slots.push(slot);
    }
    this.rowTargets = slotDefs.map((d) => d.row.clone());

    // ---- input / camera / hints ----------------------------------------
    this.input = new PipingInput(this.camera, this.contact);
    this.director = new CameraDirector(this.camera);
    this.hints = new Hints(this.contact);
    this.scene.add(this.hints.group);

    this.undoBtn = document.getElementById('undo') as HTMLButtonElement | null;
    this.undoBtn?.addEventListener('click', () => this.undo());

    this.bindPointer();
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.contact.beginStroke();
      this.cake.refreshTop();
    });
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => {
      window.setTimeout(() => this.resize(), 220);
    });
    window.visualViewport?.addEventListener('resize', () => this.resize());
  }

  private turntable!: THREE.Group;
  private rowTargets: THREE.Vector3[] = [];

  // ------------------------------------------------------------------ input
  private bindPointer(): void {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => this.onDown(e), { passive: false });
    el.addEventListener('pointermove', (e) => this.onMove(e), { passive: false });
    el.addEventListener('pointerup', (e) => this.onUp(e), { passive: false });
    el.addEventListener('pointercancel', (e) => this.onUp(e), { passive: false });
    document.addEventListener('gesturestart', ((e: Event) => e.preventDefault()) as EventListener);
  }

  private setNdc(e: PointerEvent): DOMRect {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    return rect;
  }

  private onDown(e: PointerEvent): void {
    e.preventDefault();
    if (this.activePointer !== -1) return;
    const rect = this.setNdc(e);
    this.hints.notifyActivity();
    this.flow.poke();

    if (this.flow.beat === 'finale') {
      this.flow.go('free');
    }

    if (this.flow.canSwapNozzle) {
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      const picks = this.slots.filter((s) => s.state === 'bench').map((s) => s.pick);
      const hit = this.raycaster.intersectObjects(picks, false)[0];
      if (hit) {
        const slot = this.slots.find((s) => s.pick === hit.object);
        if (slot) {
          this.dragSlot = slot;
          slot.state = 'dragging';
          this.activePointer = e.pointerId;
          this.renderer.domElement.setPointerCapture(e.pointerId);
          this.updateDrag();
          return;
        }
      }
    }

    if (!this.flow.acceptsPiping || this.controller.active) return;
    if (Math.abs(this.tableAngle) > 0.02) return;
    const p = this.input.project(e.clientX, e.clientY, rect.width, rect.height, rect);
    if (!p) return;
    this.activePointer = e.pointerId;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.input.begin(p, this.elapsed);
    this.controller.begin(p.x, p.y, this.elapsed);
    this.flow.notifyBegin();
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.activePointer) return;
    e.preventDefault();
    this.flow.poke();
    const rect = this.setNdc(e);
    if (this.dragSlot) {
      this.updateDrag();
      return;
    }
    if (!this.input.active) return;
    const p = this.input.project(e.clientX, e.clientY, rect.width, rect.height, rect);
    if (p) this.input.move(p, this.elapsed);
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId !== this.activePointer) return;
    this.activePointer = -1;
    try {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    if (this.dragSlot) {
      this.dropNozzle(this.dragSlot);
      this.dragSlot = null;
      return;
    }
    if (this.input.active) {
      this.input.end();
      this.controller.requestEnd(this.elapsed);
    }
  }

  private updateDrag(): void {
    if (!this.dragSlot) return;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    // a plane facing the camera through the bag socket, so dragging up the
    // screen really does carry the tip to the bag
    this.camera.getWorldDirection(_v2);
    this.dragPlane.setFromNormalAndCoplanarPoint(_v2, this.socketWorld());
    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) {
      this.dragSlot.obj.group.position.lerp(this.dragPoint, 0.55);
      const socket = this.socketWorld();
      const d = this.dragSlot.obj.group.position.distanceTo(socket);
      const pull = 1 - smoothstep(0.020, 0.075, d);
      if (pull > 0) this.dragSlot.obj.group.position.lerp(socket, pull * 0.5);
      this.dragSlot.obj.group.quaternion.slerp(this.toolGroup.quaternion, 0.14 + pull * 0.5);
    }
  }

  private socketWorld(): THREE.Vector3 {
    return _v1.set(0, 0, 0).applyMatrix4(this.toolGroup.matrixWorld);
  }

  private dropNozzle(slot: NozzleSlot): void {
    // judge the drop the way the child sees it: close to the bag on screen
    const a = this.projectToScreen(slot.obj.group.position);
    const b = this.projectToScreen(this.socketWorld());
    const px = Math.hypot(a.x - b.x, a.y - b.y);
    const home = this.projectToScreen(slot.home);
    const toHome = Math.hypot(a.x - home.x, a.y - home.y);
    const near = px < Math.min(this.width, this.height) * 0.30 || px < toHome;
    this.lastDrop = { px: Math.round(px), toHome: Math.round(toHome), attached: near };
    if (near) {
      const prev = this.slots.find((s) => s.state === 'attached');
      if (prev && prev !== slot) {
        prev.state = 'toBench';
        prev.anim = 0;
        prev.startPos.copy(prev.obj.group.position);
        prev.startQuat.copy(prev.obj.group.quaternion);
        prev.home.copy(slot.home);
      }
      slot.state = 'toBag';
      slot.anim = 0;
      slot.startPos.copy(slot.obj.group.position);
      slot.startQuat.copy(slot.obj.group.quaternion);
      this.controller.setNozzle(slot.obj.spec);
      this.bag.group.position.y = slot.obj.spec.length * 0.6;
    } else {
      slot.state = 'toBench';
      slot.anim = 0;
      slot.startPos.copy(slot.obj.group.position);
      slot.startQuat.copy(slot.obj.group.quaternion);
    }
  }

  private undo(): void {
    if (this.controller.active) return;
    const d = this.history.undo();
    if (!d) return;
    this.contact.clearRegion(d.centreX, d.centreZ, d.radius + 0.012);
    this.latestMeshRef = null;
    this.hints.notifyActivity();
    this.refreshUndoButton();
  }

  private refreshUndoButton(): void {
    if (!this.undoBtn) return;
    const on = this.history.count > 0 && this.flow.beat !== 'introMacro' && this.flow.beat !== 'introApproach';
    this.undoBtn.classList.toggle('on', on);
  }

  private onStrokeFinished(d: import('../state/DecorationHistory').Decoration): void {
    this.history.add(d);
    // only the two shapes whose structure needs a special angle get one;
    // everything else stays in the working three-quarter view
    if (this.flow.beat === 'free' || this.flow.beat === 'finale') {
      if (d.kind === 'rosette') {
        this.director.set('topDown');
        this.holdShotUntil = this.elapsed + 1.4;
      } else if (d.kind === 'shell') {
        this.director.set('lowSide');
        this.holdShotUntil = this.elapsed + 1.4;
      }
    }
    this.latestMeshRef =
      this.history.group.children[this.history.group.children.length - 1] ?? null;
    this.flow.notifyFinish();
    this.refreshUndoButton();
  }

  // ----------------------------------------------------------------- resize
  private resize(): void {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------- loop
  start(): void {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.elapsed += dt;
    const piping = this.controller.active;

    this.flow.update(dt, piping);
    this.quality.update(dt);

    if (this.input.active) this.input.idle(this.elapsed);

    // ---- extrusion ------------------------------------------------------
    if (piping) {
      this.controller.update(
        dt,
        this.elapsed,
        this.input.point.x,
        this.input.point.y,
        this.input.speed,
      );
      this.hoverX = this.controller.tip.x;
      this.hoverZ = this.controller.tip.z;
    } else {
      this.updateHover(dt);
    }
    this.controller.updateTime(this.elapsed);
    this.finishedCream.uTime.value = this.elapsed;

    // ---- direction used by the shell camera ------------------------------
    if (piping) {
      const t = this.controller.tip;
      const l = Math.hypot(t.x - this.strokeStart.x, t.z - this.strokeStart.y);
      if (l > 0.004) {
        this.strokeDir.set((t.x - this.strokeStart.x) / l, (t.z - this.strokeStart.y) / l);
      }
    } else {
      this.strokeStart.set(this.controller.tip.x, this.controller.tip.z);
    }

    this.updateCamera(dt, piping);
    this.updateTool(dt);
    this.updateSlots(dt);
    this.updateTable(dt);

    this.hints.update(
      dt,
      piping || this.flow.beat === 'introMacro' || this.flow.beat === 'introApproach',
      this.controller.tip,
      this.controller.nozzleAxis,
    );
    if (this.latestMeshRef) {
      const s = 1 - this.hints.settlePulse;
      this.latestMeshRef.scale.set(1, s, 1);
    }

    this.bag.morph.setPressure(Math.max(this.controller.flow, this.hints.bagPulse));
    this.bag.update(dt);
    this.hand.setSqueeze(Math.max(this.controller.flow * 0.9, this.hints.bagPulse), dt);
    this.cake.update(dt);

    this.renderer.render(this.scene, this.camera);

    this.fpsEma += (1 / Math.max(dt, 1e-4) - this.fpsEma) * 0.05;
    if (!DIAGNOSTICS) return;
    const dbg = window as unknown as { __dbg?: Record<string, unknown> };
    dbg.__dbg = {
      fps: Math.round(this.fpsEma),
      simTime: this.elapsed,
      piping: this.controller.active,
      beat: this.flow.beat,
      strokes: this.flow.strokes,
      decorations: this.history.count,
      decorationDrawCalls: this.history.drawCalls,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      nozzle: this.controller.nozzle.id,
      osc: this.controller.oscillations,
      oscTotal: this.controller.oscillationsTotal,
      ribbon: Number(this.controller.ribbon.toFixed(2)),
      liveKind: this.controller.liveKind,
      dragging: this.dragSlot ? this.dragSlot.obj.spec.id : null,
      lastDrop: this.lastDrop,
      kinds: this.history.list.map((d) => d.kind),
      dpr: this.quality.dpr,
      tier: this.quality.tier,
      webgpu: this.quality.webgpu,
      camDist: Number(this.camera.position.distanceTo(this.controller.tip).toFixed(4)),
      bench: this.slots
        .filter((sl) => sl.state === 'bench')
        .map((sl) => ({ id: sl.obj.spec.id, ...this.projectToScreen(sl.obj.group.position) })),
      socket: this.projectToScreen(this.controller.tip),
      cakeCentre: this.projectToScreen(_v1.set(0, CAKE_TOP, 0)),
      fingerOffset: this.input.fingerOffsetPx(this.width, this.height),
      tipY: Number(this.controller.tip.y.toFixed(4)),
      tipX: Number(this.controller.tip.x.toFixed(4)),
      tipZ: Number(this.controller.tip.z.toFixed(4)),
    };
  }

  private fpsEma = 60;

  private strokeStart = new THREE.Vector2();

  private projectToScreen(v: THREE.Vector3): { x: number; y: number } {
    _v3.copy(v).project(this.camera);
    return {
      x: Math.round((_v3.x * 0.5 + 0.5) * this.width),
      y: Math.round((-_v3.y * 0.5 + 0.5) * this.height),
    };
  }

  private updateHover(dt: number): void {
    let hx = this.hoverX;
    let hz = this.hoverZ;
    let height = 0.014;
    if (this.flow.beat === 'introMacro') {
      this.controller.tip.copy(this.introTip);
      return;
    }
    if (this.flow.beat === 'introApproach') {
      const k = clamp(this.flow.t / 1.9, 0, 1);
      const e = k * k * (3 - 2 * k);
      const gy = this.contact.surfaceY(0, 0);
      this.controller.tip.set(
        lerp(this.introTip.x, 0, e),
        lerp(this.introTip.y, gy + 0.016, e),
        lerp(this.introTip.z, 0, e),
      );
      return;
    }
    if (this.flow.beat === 'awaitFirst') {
      hx = 0;
      hz = 0;
      height = 0.015;
    }
    this.controller.hover(hx, hz, height, dt);
  }

  private updateCamera(dt: number, piping: boolean): void {
    const portrait = this.height >= this.width;
    switch (this.flow.beat) {
      case 'introMacro':
        this.director.set('macro');
        break;
      case 'introApproach':
        this.director.set('approach');
        break;
      case 'awaitFirst':
        this.director.set('extrude');
        break;
      case 'firstFlow':
        this.director.set('extrude');
        break;
      case 'firstDone':
        this.director.set('inspect');
        break;
      case 'presentNozzles':
        this.director.set(this.flow.t < 2.1 ? 'bench' : 'free');
        break;
      case 'finale':
        this.director.set('finale');
        break;
      default: {
        // the shot that reads the gesture is taken right after it is made, so
        // the camera never moves under the finger that is drawing
        if (!piping && this.elapsed > this.holdShotUntil) this.director.set('free');
        break;
      }
    }
    this.director.freeze(piping || this.dragSlot !== null);
    this.director.update(dt, {
      tip: this.controller.tip,
      strokeDirX: this.strokeDir.x,
      strokeDirZ: this.strokeDir.y,
      aspect: this.width / this.height,
      portrait,
      elapsed: this.elapsed,
    });
    this.director.bagLean(this.controller.bagLean);
  }

  private updateTool(dt: number): void {
    const axis = this.controller.nozzleAxis;
    _q1.setFromUnitVectors(_up, axis);
    // roll the assembly so the hand always sits on the far side of the bag
    _v2.set(1, 0, 0).applyQuaternion(_q1);
    const away = this.controller.bagLean;
    const ax = axis;
    const cross = _v3.crossVectors(_v2, away).dot(ax);
    const dot = _v2.dot(away);
    // keep the hand on the far side but turned toward the camera enough to read
    const roll = Math.atan2(cross, dot) + 0.92;
    _q2.setFromAxisAngle(ax, roll);
    _q1.premultiply(_q2);

    this.toolGroup.position.copy(this.controller.tip);
    this.toolGroup.quaternion.slerp(_q1, clamp(dt * 6, 0, 1));
    this.toolGroup.updateMatrixWorld(true);
  }

  /**
   * Screen anchors for the spare tips. A tall screen has room for a row along
   * the bottom; a wide one does not, so they sit down the near-right edge where
   * a thumb still reaches them.
   */
  private readonly rowNdcPortrait: [number, number][] = [
    [-0.58, -0.72],
    [-0.17, -0.80],
    [0.24, -0.87],
  ];
  private readonly rowNdcLandscape: [number, number][] = [
    [0.80, -0.72],
    [0.87, -0.36],
    [0.92, -0.02],
  ];
  private benchPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BENCH_Y);
  private benchHit = new THREE.Vector3();
  private benchNdc = new THREE.Vector2();

  /**
   * Park the spare tips on the bench where the child's thumb can reach them,
   * whatever the screen shape is: anchor them in screen space and drop the ray
   * onto the bench.
   */
  private resolveRowTarget(i: number, out: THREE.Vector3): boolean {
    const row = this.height >= this.width ? this.rowNdcPortrait : this.rowNdcLandscape;
    // walk the anchor down the screen until the tip clears the turntable; that
    // keeps it both reachable and visible whatever the screen shape is
    for (let step = 0; step <= 12; step++) {
      const ny = Math.max(-0.97, row[i][1] - step * 0.06);
      this.benchNdc.set(row[i][0], ny);
      this.raycaster.setFromCamera(this.benchNdc, this.camera);
      if (!this.raycaster.ray.intersectPlane(this.benchPlane, this.benchHit)) return false;
      const r = Math.hypot(this.benchHit.x, this.benchHit.z);
      if (r > 0.40) continue;
      if (r >= 0.118 || ny <= -0.965) {
        out.copy(this.benchHit);
        out.y = BENCH_Y;
        return true;
      }
    }
    return false;
  }

  private updateSlots(dt: number): void {
    const presenting =
      this.flow.beat === 'presentNozzles' || this.flow.beat === 'free' || this.flow.beat === 'finale';
    const anchor =
      presenting && !this.controller.active &&
      (this.director.current === 'free' || this.director.current === 'bench');
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (anchor && this.resolveRowTarget(i, _v1)) {
        this.rowTargets[i].copy(_v1);
      }
      if (presenting && this.rowTargets[i]) s.home.lerp(this.rowTargets[i], clamp(dt * 1.4, 0, 1));
      switch (s.state) {
        case 'attached': {
          s.obj.group.position.copy(this.toolGroup.position);
          s.obj.group.quaternion.copy(this.toolGroup.quaternion);
          break;
        }
        case 'bench': {
          s.obj.group.position.lerp(s.home, clamp(dt * 3.2, 0, 1));
          s.obj.group.quaternion.slerp(s.homeQuat, clamp(dt * 3.2, 0, 1));
          break;
        }
        case 'toBag': {
          s.anim = Math.min(1, s.anim + dt / 0.55);
          const e = s.anim * s.anim * (3 - 2 * s.anim);
          s.obj.group.position.lerpVectors(s.startPos, this.toolGroup.position, e);
          _q3.copy(s.startQuat).slerp(this.toolGroup.quaternion, e);
          // screw it on: two turns that ease to a stop
          _q4.setFromAxisAngle(_up, (1 - e) * Math.PI * 4);
          s.obj.group.quaternion.copy(_q3).multiply(_q4);
          if (s.anim >= 1) s.state = 'attached';
          break;
        }
        case 'toBench': {
          s.anim = Math.min(1, s.anim + dt / 0.6);
          const e = s.anim * s.anim * (3 - 2 * s.anim);
          s.obj.group.position.lerpVectors(s.startPos, s.home, e);
          s.obj.group.position.y += Math.sin(e * Math.PI) * 0.04;
          _q3.copy(s.startQuat).slerp(s.homeQuat, e);
          s.obj.group.quaternion.copy(_q3);
          if (s.anim >= 1) s.state = 'bench';
          break;
        }
        case 'dragging':
          break;
      }
    }
  }

  private updateTable(dt: number): void {
    const target = this.flow.beat === 'finale' ? this.tableAngle + dt * 0.24 : 0;
    if (this.flow.beat === 'finale') this.tableAngle = target;
    else this.tableAngle = damp(this.tableAngle, 0, 0.5, dt);
    this.tableGroup.rotation.y = this.tableAngle;
    this.turntable.rotation.y = this.tableAngle;
  }
}

/** read-only diagnostics for automated browser checks: append ?debug=1 */
const DIAGNOSTICS =
  import.meta.env.DEV ||
  (typeof location !== 'undefined' && location.search.indexOf('debug') !== -1);

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _q4 = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
