import * as THREE from 'three';
import { detectQuality } from '../core/quality';
import { Seabed } from '../world/terrain';
import { Water } from '../world/water';
import { Sky } from '../world/sky';
import { Ship, DECK_Y } from '../world/ship';
import { CableSystem } from '../world/cable';
import { Rov } from '../world/rov';
import { Motes, EntrySplash, Fish } from '../world/particles';
import { Islands } from '../world/islands';
import { LayRoute } from '../route/route';
import { processStroke, alternativeRoute } from '../route/stroke';
import { CameraRig, EnvironmentFX, CamTarget } from './director';
import { Overlay } from '../ui/overlay';
import { makeCableMaterial } from '../world/materials';

type Phase = 'opening' | 'planning' | 'laying' | 'arrival' | 'result';

const BASE_SEED = 1234;

/** Free GPU resources of a subtree (textures are shared and kept). */
function disposeDeep(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}

// Opening deck-tour keyframes (ship-local), built once.
const OPENING_KEYS: { t: number; p: THREE.Vector3; l: THREE.Vector3 }[] = [
  { t: 0.0, p: new THREE.Vector3(2.5, DECK_Y + 7.5, 7.0), l: new THREE.Vector3(-1, DECK_Y + 1, 0) },
  { t: 2.6, p: new THREE.Vector3(1.5, DECK_Y + 4.0, 5.6), l: new THREE.Vector3(-1.8, DECK_Y + 2.6, 0) },
  { t: 5.2, p: new THREE.Vector3(-4.4, DECK_Y + 2.8, 4.8), l: new THREE.Vector3(-6.6, DECK_Y + 1.3, 0) },
  { t: 7.6, p: new THREE.Vector3(-10.6, DECK_Y + 3.4, 4.4), l: new THREE.Vector3(-12.3, DECK_Y + 2.3, 0) },
  { t: 10.0, p: new THREE.Vector3(-18.5, DECK_Y + 1.8, 5.0), l: new THREE.Vector3(-14.2, 0.0, 0) },
  { t: 12.4, p: new THREE.Vector3(-24, DECK_Y + 14, 16), l: new THREE.Vector3(-6, 0, 0) }
];

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  private envFx: EnvironmentFX;
  private quality = detectQuality();
  private overlay = new Overlay();

  // per-seed world
  private seabed!: Seabed;
  private islands!: Islands;
  private fish!: Fish;
  private worldGroup = new THREE.Group();

  // persistent actors
  private water!: Water;
  private sky = new Sky();
  private ship!: Ship;
  private shipTail!: THREE.Mesh;
  private cable = new CableSystem();
  private rov!: Rov;
  private motes!: Motes;
  private splash = new EntrySplash();

  // game state
  phase: Phase = 'opening';
  private playCount = 0;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private phaseT = 0;
  private timeScale = 1;

  // route state
  private route: LayRoute | null = null;
  private playerRoutePts: THREE.Vector3[] = [];
  private altRoutePts: THREE.Vector3[] = [];
  private shipS = 0;
  private layT = 0;
  private preLayPos = new THREE.Vector3();
  private touchdownS = 0;
  private landing = false;
  private landingBlend = 0;
  private layingDone = false;

  // planning / input state
  private drawing = false;
  private activePointer = -1;
  private strokeWorld: THREE.Vector3[] = [];
  private strokeNorm: { x: number; y: number }[] = [];
  private planLine!: THREE.Line;
  private previewLine!: THREE.Line;
  private hintRingA!: THREE.Mesh;
  private hintRingB!: THREE.Mesh;
  private hazardRing!: THREE.Mesh;
  private ripple!: THREE.Mesh;
  private rippleT = 99;
  private planFade = 0; // >0 while the rejected line fades out
  private firstPlanShown = false;
  private raycaster = new THREE.Raycaster();
  private drawPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ndc = new THREE.Vector2();

  // perf probe (for the verification harness)
  private frameMs: number[] = [];
  maxFrameMs = 0;

  // scratch
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private camTarget: CamTarget = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private prevShot: CamTarget = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private layQ = 0;
  private laySide = new THREE.Vector3();
  private layShots: { q0: number; q1: number; fn: (o: CamTarget) => void }[] | null = null;
  private shipPos = new THREE.Vector3();
  private shipFwd = new THREE.Vector3(1, 0, 0);
  private openingShipPos = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.quality.pixelRatioCap));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.rig = new CameraRig(innerWidth / innerHeight);
    this.scene.add(this.sky.group);
    const env = this.sky.buildEnvironment(this.renderer);

    this.ship = new Ship(env);
    this.scene.add(this.ship.group);
    this.buildShipTail();

    this.rov = new Rov(this.quality);
    this.rov.setVisible(false);
    this.scene.add(this.rov.group);
    this.motes = new Motes(this.quality);
    this.scene.add(this.motes.points);
    this.scene.add(this.splash.points);
    this.scene.add(this.cable.group);

    this.scene.add(this.worldGroup);
    this.buildWorld(BASE_SEED);

    this.envFx = new EnvironmentFX(this.scene, this.renderer, this.sky, this.water);
    this.buildPlanningVisuals();

    this.setOpeningShipPose();
    this.startOpening();

    this.bindInput();
    addEventListener('resize', () => this.onResize());
    this.overlay.onSkip = () => { if (this.phase === 'opening') this.enterPlanning(); };
    this.overlay.onReplay = () => this.replay();

    // Precompile all shaders once so the first underwater transition and the
    // first lay never stall on shader compilation.
    this.renderer.compile(this.scene, this.rig.camera);

    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------------- world

  private buildWorld(seed: number): void {
    for (const c of [...this.worldGroup.children]) {
      this.worldGroup.remove(c);
      disposeDeep(c);
    }
    this.seabed?.dispose();

    this.seabed = new Seabed(seed, this.quality);
    this.worldGroup.add(this.seabed.group);
    this.islands = new Islands(this.seabed);
    this.worldGroup.add(this.islands.group);
    this.fish = new Fish(this.quality);
    this.worldGroup.add(this.fish.mesh);

    if (!this.water) {
      this.water = new Water(this.seabed.depthTexture, this.quality);
      this.scene.add(this.water.mesh);
    } else {
      this.water.setDepthTexture(this.seabed.depthTexture);
    }
  }

  private buildShipTail(): void {
    // Short cable drop from the stern into the sea, shown while the ship is
    // idle (opening/planning) before a real catenary exists.
    const pts = [
      this.ship.overboardLocal.clone(),
      new THREE.Vector3(-15.3, -1.2, 0),
      new THREE.Vector3(-16.4, -3.8, 0),
      new THREE.Vector3(-16.9, -7.5, 0)
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 20, 0.3, 8, false);
    this.shipTail = new THREE.Mesh(tube, makeCableMaterial());
    this.ship.group.add(this.shipTail);
  }

  private buildPlanningVisuals(): void {
    // Live plan line: a restrained chart-style dashed line, clearly a drawing
    // aid - NOT the physical cable (no glow).
    const planGeo = new THREE.BufferGeometry();
    planGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
    // Preallocated dash distances - avoids computeLineDistances() re-creating
    // a new attribute (and GL buffer) on every pointermove.
    planGeo.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(600), 1));
    const planMat = new THREE.LineDashedMaterial({
      color: 0xf3ede0, dashSize: 1.6, gapSize: 1.1, transparent: true, opacity: 0.85
    });
    this.planLine = new THREE.Line(planGeo, planMat);
    this.planLine.frustumCulled = false;
    this.planLine.visible = false;
    this.scene.add(this.planLine);

    // One-time preview line A->B (first play only).
    const prevGeo = new THREE.BufferGeometry();
    prevGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(80 * 3), 3));
    const prevMat = new THREE.LineDashedMaterial({
      color: 0xd9e4ea, dashSize: 1.2, gapSize: 1.6, transparent: true, opacity: 0.5
    });
    this.previewLine = new THREE.Line(prevGeo, prevMat);
    this.previewLine.frustumCulled = false;
    this.previewLine.visible = false;
    this.scene.add(this.previewLine);

    const ringGeo = new THREE.RingGeometry(2.2, 3.4, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.hintRingA = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffe9a8, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide
    }));
    this.hintRingA.visible = false;
    this.scene.add(this.hintRingA);
    this.hintRingB = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xcfe2ea, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide
    }));
    this.hintRingB.visible = false;
    this.scene.add(this.hintRingB);

    const hazGeo = new THREE.RingGeometry(1.6, 2.4, 32);
    hazGeo.rotateX(-Math.PI / 2);
    this.hazardRing = new THREE.Mesh(hazGeo, new THREE.MeshBasicMaterial({
      color: 0xffb347, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide
    }));
    this.scene.add(this.hazardRing);

    const ripGeo = new THREE.RingGeometry(0.9, 1.25, 32);
    ripGeo.rotateX(-Math.PI / 2);
    this.ripple = new THREE.Mesh(ripGeo, new THREE.MeshBasicMaterial({
      color: 0xdfeef2, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide
    }));
    this.scene.add(this.ripple);
  }

  private setOpeningShipPose(): void {
    const a = this.seabed.anchorA;
    this.openingShipPos.set(a.x + 26, 0, a.z + 2);
    this.shipPos.copy(this.openingShipPos);
    this.shipFwd.set(1, 0, 0);
    this.ship.group.position.copy(this.shipPos);
    this.ship.group.rotation.set(0, 0, 0);
    this.ship.setCoilFraction(1);
    this.shipTail.visible = true;
    // Camera snaps computed from ship-local points need a fresh matrix.
    this.ship.group.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- phases

  private startOpening(): void {
    this.phase = 'opening';
    this.phaseT = 0;
    this.overlay.showSkip();
    this.water.setClarity(0.25);
    // Snap the camera onto the deck immediately.
    const p = this.shipLocalToWorld(new THREE.Vector3(2.5, DECK_Y + 7.5, 7), this.v1);
    const l = this.shipLocalToWorld(new THREE.Vector3(-1, DECK_Y + 1, 0), this.v2);
    this.rig.snap(p, l);
  }

  private enterPlanning(): void {
    this.phase = 'planning';
    this.phaseT = 0;
    this.overlay.hideSkip();
    this.overlay.hideResult();
    this.rig.stiffness = 2.2;
    this.route = null;
    this.layingDone = false;
    this.landing = false;
    this.landingBlend = 0;
    this.cable.reset();
    this.rov.setVisible(false);
    this.shipTail.visible = true;
    this.setOpeningShipPose();
    this.hintRingA.visible = true;
    this.hintRingB.visible = true;
    this.hintRingA.position.set(this.seabed.anchorA.x, 0.6, this.seabed.anchorA.z);
    this.hintRingB.position.set(this.seabed.anchorB.x, 0.6, this.seabed.anchorB.z);
    if (!this.firstPlanShown) {
      this.firstPlanShown = true;
      this.showPreviewLine();
    }
  }

  private showPreviewLine(): void {
    // A single, quiet chart-style forecast line from A toward B.
    const a = this.seabed.anchorA, b = this.seabed.anchorB;
    const attr = this.previewLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = 80;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      attr.setXYZ(i,
        a.x + (b.x - a.x) * t,
        0.6,
        a.z + (b.z - a.z) * t + Math.sin(t * Math.PI) * -14
      );
    }
    attr.needsUpdate = true;
    this.previewLine.geometry.setDrawRange(0, 0);
    this.previewLine.computeLineDistances();
    this.previewLine.visible = true;
    (this.previewLine as unknown as { __t: number }).__t = 0;
  }

  private startLaying(route: LayRoute): void {
    this.phase = 'laying';
    this.phaseT = 0;
    this.rig.stiffness = 2.6;
    this.route = route;
    this.cable.build(route);
    this.layT = 0;
    this.preLayPos.copy(this.shipPos);
    this.shipS = route.shipStartS;
    this.touchdownS = 0;
    this.landing = false;
    this.landingBlend = 0;
    this.layingDone = false;
    this.shipTail.visible = false;
    this.splash.setActive(true);
    this.planLine.visible = false;
    this.hintRingA.visible = false;
    this.hintRingB.visible = false;
    this.previewLine.visible = false;
    this.rov.setVisible(true);
    this.altRoutePts = alternativeRoute(this.playerRoutePts, this.seabed);
  }

  private enterArrival(): void {
    this.phase = 'arrival';
    this.phaseT = 0;
    this.splash.setActive(false);
    this.cable.hideCatenary();
    this.rov.setVisible(false);
    this.ship.setLaySpeed(0);
  }

  private enterResult(): void {
    this.phase = 'result';
    this.phaseT = 0;
    this.overlay.showResult(this.seabed, this.playerRoutePts, this.altRoutePts);
  }

  private replay(): void {
    if (this.phase !== 'result') return;
    this.playCount++;
    this.overlay.hideResult();
    // Vary valley / rocks / seagrass so a new curve is worth trying.
    this.buildWorld(BASE_SEED + this.playCount * 7919);
    this.islands.setConnected(false);
    this.enterPlanning();
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    // A cancelled system gesture must NOT commit the stroke.
    el.addEventListener('pointercancel', (e) => this.cancelStroke(e.pointerId));
    el.addEventListener('lostpointercapture', (e) => this.cancelStroke(e.pointerId));
  }

  /** Abort an in-progress stroke without judging it (system gesture etc.). */
  private cancelStroke(pointerId: number): void {
    if (!this.drawing || pointerId !== this.activePointer) return;
    this.drawing = false;
    this.activePointer = -1;
    this.planFade = 1;
  }

  /**
   * Pointer -> normalized -> ray -> sea-plane world point.
   * Uses the canvas rect (not window size): on iOS Safari the two can diverge
   * under pinch-zoom or during URL-bar animation.
   */
  private pointerToSea(e: PointerEvent, out: THREE.Vector3): boolean {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    this.ndc.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    const hit = this.raycaster.ray.intersectPlane(this.drawPlane, out);
    return !!hit;
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.phase === 'opening') {
      this.enterPlanning();
      return;
    }
    if (this.phase !== 'planning' || this.activePointer !== -1) return;
    if (!this.pointerToSea(e, this.v1)) return;
    const a = this.seabed.anchorA, b = this.seabed.anchorB;
    const dA = Math.hypot(this.v1.x - a.x, this.v1.z - a.z);
    const dB = Math.hypot(this.v1.x - b.x, this.v1.z - b.z);
    if (Math.min(dA, dB) > 16) {
      this.spawnRipple(this.v1);
      return;
    }
    this.activePointer = e.pointerId;
    this.drawing = true;
    this.strokeWorld = [this.v1.clone()];
    this.strokeNorm = [{ x: e.clientX / innerWidth, y: e.clientY / innerHeight }];
    this.previewLine.visible = false;
    this.planFade = 0;
    this.planLine.visible = true;
    (this.planLine.material as THREE.LineDashedMaterial).opacity = 0.85;
    this.updatePlanLine();
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.drawing || e.pointerId !== this.activePointer) return;
    if (!this.pointerToSea(e, this.v1)) return;
    const last = this.strokeWorld[this.strokeWorld.length - 1];
    if (last.distanceTo(this.v1) < 1.0) return;
    if (this.strokeWorld.length >= 590) return;
    this.strokeWorld.push(this.v1.clone());
    this.strokeNorm.push({ x: e.clientX / innerWidth, y: e.clientY / innerHeight });
    this.updatePlanLine();

    // Gentle steering: highlight when the finger is over rock or coral.
    const st = this.seabed.surfaceType(this.v1.x, this.v1.z);
    if (st !== 'sand') {
      this.hazardRing.position.set(this.v1.x, 0.65, this.v1.z);
      (this.hazardRing.material as THREE.MeshBasicMaterial).opacity = 0.75;
      (this.hazardRing.material as THREE.MeshBasicMaterial).color.setHex(
        st === 'rock' ? 0xffb347 : 0x7de8a0
      );
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.drawing || e.pointerId !== this.activePointer) return;
    this.drawing = false;
    this.activePointer = -1;
    const result = processStroke(this.strokeWorld, this.seabed);
    if (!result.ok) {
      // No punishment: a soft ripple where the finger left, the line melts
      // away, and the start ring resumes pulsing for an instant retry.
      const lastP = this.strokeWorld[this.strokeWorld.length - 1] ?? this.v1;
      this.spawnRipple(lastP);
      this.planFade = 1;
      return;
    }
    this.playerRoutePts = result.points.map((p) => p.clone());
    this.startLaying(new LayRoute(result.points, this.seabed));
  }

  private spawnRipple(at: THREE.Vector3): void {
    this.ripple.position.set(at.x, 0.55, at.z);
    this.rippleT = 0;
  }

  private updatePlanLine(): void {
    const attr = this.planLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const dist = this.planLine.geometry.getAttribute('lineDistance') as THREE.BufferAttribute;
    const n = Math.min(this.strokeWorld.length, 600);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const p = this.strokeWorld[i];
      attr.setXYZ(i, p.x, 0.55, p.z);
      if (i > 0) acc += p.distanceTo(this.strokeWorld[i - 1]);
      dist.setX(i, acc);
    }
    attr.needsUpdate = true;
    dist.needsUpdate = true;
    this.planLine.geometry.setDrawRange(0, n);
  }

  // ---------------------------------------------------------------- ship pose

  private shipLocalToWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(local).applyMatrix4(this.ship.group.matrixWorld);
  }

  private poseShip(dt: number): void {
    const t = this.elapsed;
    let px: number, pz: number;
    const onRoute = this.route &&
      (this.phase === 'laying' || this.phase === 'arrival' || this.phase === 'result');
    if (onRoute) {
      this.layT += dt;
      this.route!.surfaceAt(Math.min(this.shipS, this.route!.shipEndS), this.v1);
      this.route!.tangentAt(Math.min(this.shipS, this.route!.shipEndS), this.v2);
      // Ease from the idle pose into the route during the first moments.
      const blend = THREE.MathUtils.clamp(this.layT / 2.0, 0, 1);
      px = THREE.MathUtils.lerp(this.preLayPos.x, this.v1.x, blend);
      pz = THREE.MathUtils.lerp(this.preLayPos.z, this.v1.z, blend);
      this.shipFwd.lerp(this.v2, Math.min(1, dt * 2)).normalize();
    } else {
      px = this.openingShipPos.x;
      pz = this.openingShipPos.z;
    }
    const bob = this.water.surfaceY(px, pz, t) * 0.6;
    this.shipPos.set(px, bob, pz);
    this.ship.group.position.copy(this.shipPos);
    const yaw = Math.atan2(-this.shipFwd.z, this.shipFwd.x);
    this.ship.group.rotation.set(
      Math.sin(t * 0.7) * 0.008,
      yaw,
      Math.sin(t * 0.55 + 1.3) * 0.012
    );
    this.ship.group.updateMatrixWorld();
  }

  // ---------------------------------------------------------------- laying

  private updateLaying(dt: number): void {
    if (!this.route) return;
    const route = this.route;
    const speed = THREE.MathUtils.clamp(route.length / 40, 3.4, 5.6);
    this.ship.setLaySpeed(speed);

    if (!this.landing) {
      this.shipS += speed * dt;
      if (this.shipS >= route.shipEndS) {
        this.shipS = route.shipEndS;
        this.landing = true;
      }
      const depth = Math.max(4, -route.depthAt(this.touchdownS));
      const layback = THREE.MathUtils.clamp(depth * 0.85, 3, 24);
      this.touchdownS = Math.max(this.touchdownS, Math.max(0, this.shipS - layback));
    } else {
      // Shore landing at island B: the remaining cable settles to the beach.
      this.landingBlend = Math.min(1, this.landingBlend + dt * 0.7);
      this.touchdownS += speed * 1.25 * dt;
      if (this.touchdownS >= route.length - 0.4) {
        this.touchdownS = route.length;
        this.cable.setTouchdown(this.touchdownS);
        this.layingDone = true;
        this.enterArrival();
        return;
      }
    }

    this.cable.setTouchdown(this.touchdownS);
    const stern = this.shipLocalToWorld(this.ship.overboardLocal, this.v3);
    this.cable.updateCatenary(stern, this.shipFwd, this.landingBlend);

    // Tank empties in proportion to the cable that has left the ship.
    const paidOut = this.touchdownS + (this.shipS - this.touchdownS) * 1.25;
    this.ship.setCoilFraction(1 - THREE.MathUtils.clamp(paidOut / route.length, 0, 1));

    // Burial machine at the touchdown (only in real water depth).
    const tdDepth = route.depthAt(this.touchdownS);
    if (tdDepth < -8 && !this.layingDone) {
      this.rov.setVisible(true);
      const idx = route.stationIndexAt(this.touchdownS);
      this.rov.place(this.cable.touchdownPoint, this.cable.touchdownTangent, route.stations[idx].buriable, dt);
    } else {
      this.rov.setVisible(false);
    }
  }

  // ---------------------------------------------------------------- cameras

  private planCamTarget(out: CamTarget): void {
    const aspect = this.rig.camera.aspect;
    if (aspect >= 1) {
      // Landscape: islands left/right, whole crossing readable.
      out.pos.set(0, 118, 98);
      out.look.set(0, -16, 0);
    } else {
      // Portrait: near island at the bottom, far island at the top - the long
      // axis of the screen carries the crossing.
      out.pos.set(this.seabed.anchorA.x - 62, 132, 0);
      out.look.set(34, -20, 0);
    }
  }

  private openingCamTarget(out: CamTarget): void {
    // Deck tour: tank -> tensioner -> sheave -> sea, then rise away.
    const keys = OPENING_KEYS;
    const t = this.phaseT;
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const k0 = keys[i], k1 = keys[i + 1];
    const f = THREE.MathUtils.clamp((t - k0.t) / (k1.t - k0.t), 0, 1);
    const sf = f * f * (3 - 2 * f);
    this.v1.copy(k0.p).lerp(k1.p, sf);
    this.v2.copy(k0.l).lerp(k1.l, sf);
    this.shipLocalToWorld(this.v1, out.pos);
    this.shipLocalToWorld(this.v2, out.look);
    if (t > 13.6) this.enterPlanning();
  }

  /** Shot table for the laying camera chain, built once (no per-frame allocs). */
  private buildLayShots(): { q0: number; q1: number; fn: (o: CamTarget) => void }[] {
    const side = this.laySide;
    const td = this.cable.touchdownPoint;
    return [
      {
        q0: -1, q1: 0.10, fn: (o) => {
          // 1: high oblique - ship and both islands.
          o.pos.set(this.shipPos.x - this.shipFwd.x * 30, 54, this.shipPos.z + 66);
          o.look.set(this.shipPos.x + this.shipFwd.x * 26, -6, this.shipPos.z);
        }
      },
      {
        q0: 0.10, q1: 0.26, fn: (o) => {
          // 2: deck midshot - cable running tank -> tensioner -> sheave.
          this.shipLocalToWorld(this.v1.set(7.5, DECK_Y + 7.5, 9.5), o.pos);
          this.shipLocalToWorld(this.v2.set(-6, DECK_Y + 1.2, 0), o.look);
        }
      },
      {
        q0: 0.26, q1: 0.36, fn: (o) => {
          // 3: stern closeup - cable entering the water.
          this.shipLocalToWorld(this.v1.set(-18.5, 3.4, 6.8), o.pos);
          this.shipLocalToWorld(this.v2.set(-14.2, 0.5, 0), o.look);
        }
      },
      {
        q0: 0.36, q1: 0.56, fn: (o) => {
          // 4: descend the water column WITH the cable.
          const f = THREE.MathUtils.clamp((this.layQ - 0.36) / 0.20, 0, 1);
          const ct = THREE.MathUtils.lerp(0.9, 0.06, f);
          this.cable.catenaryPoint(ct, this.v1);
          o.pos.set(this.v1.x + side.x * 9, this.v1.y + 2.2, this.v1.z + side.z * 9);
          this.cable.catenaryPoint(Math.max(0, ct - 0.16), this.v2);
          o.look.copy(this.v2);
        }
      },
      {
        q0: 0.56, q1: 0.80, fn: (o) => {
          // 5: seabed 3/4 view - touchdown + burial machine.
          o.pos.set(
            td.x - this.cable.touchdownTangent.x * 12 + side.x * 12,
            td.y + 8.5,
            td.z - this.cable.touchdownTangent.z * 12 + side.z * 12
          );
          o.look.set(td.x + this.cable.touchdownTangent.x * 3, td.y + 0.5, td.z + this.cable.touchdownTangent.z * 3);
        }
      },
      {
        q0: 0.80, q1: 9, fn: (o) => {
          // 6: pull back - the whole laid path seen from the seabed.
          o.pos.set(td.x + side.x * 32, td.y + 30, td.z + side.z * 32);
          this.route!.surfaceAt(this.touchdownS * 0.55, this.v2);
          o.look.set(this.v2.x, this.seabed.height(this.v2.x, this.v2.z) + 2, this.v2.z);
        }
      }
    ];
  }

  /** The 7-stage laying camera chain, blended continuously by lay progress. */
  private layCamTarget(out: CamTarget): void {
    const route = this.route!;
    const span = Math.max(1, route.shipEndS - route.shipStartS);
    let q = (this.shipS - route.shipStartS) / span;
    if (this.landing) {
      // Monotonic: touchdownS lags shipEndS at the flip, so never let q drop
      // back through the shot chain.
      q = 1 + Math.max(0, this.touchdownS - route.shipEndS) /
        Math.max(8, route.length - route.shipEndS) * 0.2;
    }
    this.layQ = q;
    this.laySide.set(-this.cable.touchdownTangent.z, 0, this.cable.touchdownTangent.x);
    if (!this.layShots) this.layShots = this.buildLayShots();
    const shots = this.layShots;

    // Piecewise with smooth cross-fade near boundaries.
    let active = shots[0];
    let idx = 0;
    for (let i = 0; i < shots.length; i++) {
      if (q >= shots[i].q0 && q < shots[i].q1) { active = shots[i]; idx = i; break; }
    }
    active.fn(out);
    this.clampCamAboveGround(out);
    const W = 0.03;
    if (idx > 0 && q - active.q0 < W) {
      shots[idx - 1].fn(this.prevShot);
      this.clampCamAboveGround(this.prevShot);
      const f = (q - active.q0) / W;
      const sf = f * f * (3 - 2 * f);
      out.pos.lerpVectors(this.prevShot.pos, out.pos, sf);
      out.look.lerpVectors(this.prevShot.look, out.look, sf);
    }
  }

  /** Never let an underwater shot sink into a dune. */
  private clampCamAboveGround(t: CamTarget): void {
    if (t.pos.y < 0) {
      const g = this.seabed.height(t.pos.x, t.pos.z);
      t.pos.y = Math.max(t.pos.y, g + 3.2);
    }
  }

  private arrivalCamTarget(out: CamTarget): void {
    const t = this.phaseT;
    const b = this.seabed.anchorB;
    if (t < 4.2) {
      // 7a: rise to the far shore station as its lamp comes on.
      out.pos.set(b.x - 34, 16, 24);
      out.look.set(b.x + 6, 4, 0);
      if (t > 1.2) this.islands.setConnected(true);
    } else {
      // 7b: wide view of both islands, then the chart takes over.
      this.planCamTarget(out);
    }
    if (t > 7.2 && this.phase === 'arrival') this.enterResult();
  }

  // ---------------------------------------------------------------- frame

  private frame(): void {
    const rawDt = Math.min(this.clock.getDelta(), 0.1);
    const dt = rawDt * this.timeScale;
    this.elapsed += dt;
    this.phaseT += dt;
    const t0 = performance.now();

    this.poseShip(dt);

    switch (this.phase) {
      case 'opening':
        this.openingCamTarget(this.camTarget);
        break;
      case 'planning':
        this.planCamTarget(this.camTarget);
        this.updatePlanningFx(dt);
        break;
      case 'laying':
        this.updateLaying(dt);
        if (this.phase === 'laying') this.layCamTarget(this.camTarget);
        break;
      case 'arrival':
        this.arrivalCamTarget(this.camTarget);
        break;
      case 'result':
        this.planCamTarget(this.camTarget);
        this.camTarget.pos.x += Math.sin(this.elapsed * 0.1) * 6;
        break;
    }

    this.rig.update(this.camTarget, dt);

    // Water clarity per phase: crystal for planning, realistic for the lay.
    const clarityTarget =
      this.phase === 'planning' ? 0.85 :
      this.phase === 'result' ? 0.6 :
      this.phase === 'opening' ? 0.3 : 0.16;
    this.water.setClarity(THREE.MathUtils.lerp(this.water.getClarity(), clarityTarget, Math.min(1, dt * 2)));

    const sternNow = this.shipLocalToWorld(this.ship.overboardLocal, this.v3);
    this.splash.update(sternNow, dt);

    this.envFx.update(this.rig.position.y);
    this.water.update(this.elapsed);
    this.seabed.update(this.elapsed);
    this.ship.update(dt);
    this.rov.update(dt);
    this.motes.update(this.rig.position, this.elapsed);
    this.fish.update(this.elapsed);
    this.islands.update(dt);

    this.renderer.render(this.scene, this.rig.camera);

    const ms = performance.now() - t0;
    this.frameMs.push(ms);
    if (this.frameMs.length > 240) this.frameMs.shift();
    this.maxFrameMs = Math.max(...this.frameMs);
  }

  private updatePlanningFx(dt: number): void {
    // Pulsing start/end rings.
    const s = 1 + Math.sin(this.elapsed * 2.4) * 0.12;
    this.hintRingA.scale.setScalar(s);
    this.hintRingB.scale.setScalar(1 + Math.sin(this.elapsed * 2.4 + 1) * 0.08);
    (this.hintRingA.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(this.elapsed * 2.4) * 0.3;

    // One-time forecast line reveal.
    if (this.previewLine.visible) {
      const holder = this.previewLine as unknown as { __t: number };
      holder.__t = (holder.__t ?? 0) + dt;
      const f = THREE.MathUtils.clamp(holder.__t / 2.6, 0, 1);
      this.previewLine.geometry.setDrawRange(0, Math.floor(f * 80));
      if (holder.__t > 5) {
        (this.previewLine.material as THREE.LineDashedMaterial).opacity =
          Math.max(0, 0.5 - (holder.__t - 5) * 0.4);
        if (holder.__t > 6.4) this.previewLine.visible = false;
      }
    }

    // Rejected-stroke fade-out.
    if (this.planFade > 0) {
      this.planFade = Math.max(0, this.planFade - dt * 1.6);
      (this.planLine.material as THREE.LineDashedMaterial).opacity = 0.85 * this.planFade;
      if (this.planFade === 0) this.planLine.visible = false;
    }

    // Hazard ring decay.
    const hm = this.hazardRing.material as THREE.MeshBasicMaterial;
    hm.opacity = Math.max(0, hm.opacity - dt * 1.4);

    // Ripple feedback.
    if (this.rippleT < 1) {
      this.rippleT += dt * 1.4;
      const f = this.rippleT;
      this.ripple.scale.setScalar(1 + f * 5);
      (this.ripple.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 * (1 - f));
    }
  }

  // ---------------------------------------------------------------- misc

  private onResize(): void {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.quality.pixelRatioCap));
    this.renderer.setSize(innerWidth, innerHeight);
    this.rig.camera.aspect = innerWidth / innerHeight;
    this.rig.camera.updateProjectionMatrix();
    // Route/progress live in world space, so nothing else to re-map: the
    // planning camera target follows the new aspect on the next frame.
  }

  // Verification hooks (used by the automated playtest, harmless in prod).
  worldToScreen(x: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, 0.5, z).project(this.rig.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  }
  getState() {
    return {
      phase: this.phase,
      anchorA: [this.seabed.anchorA.x, this.seabed.anchorA.z],
      anchorB: [this.seabed.anchorB.x, this.seabed.anchorB.z],
      shipS: this.shipS,
      touchdownS: this.touchdownS,
      routeLength: this.route?.length ?? 0,
      stations: this.route?.stations.length ?? 0,
      cableGap: this.cable.continuityGap(),
      gapSeabed: this.cable.gapSeabed,
      gapStern: this.cable.gapStern,
      camY: this.rig.position.y,
      maxFrameMs: this.maxFrameMs,
      avgFrameMs: this.frameMs.length
        ? this.frameMs.reduce((a, b) => a + b, 0) / this.frameMs.length
        : 0,
      playCount: this.playCount,
      strokeSamples: this.strokeNorm.length,
      playerRoute: this.playerRoutePts.map((p) => [
        Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10
      ])
    };
  }
  setTimeScale(k: number): void {
    this.timeScale = THREE.MathUtils.clamp(k, 0.1, 8);
  }
  resetFrameProbe(): void {
    this.frameMs = [];
    this.maxFrameMs = 0;
  }
}
