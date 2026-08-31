import * as THREE from 'three';
import {
  BLANK, CHIP, CHIP_LOD, FRAMING, HANDLE_OFFSET_PX, ROW_COUNT, ROW_Y, TIMING,
  WORK_ROW_INDEX, blankRadius,
} from './config';
import { Blank, branchPhi, type BranchVariant, type RowSpec } from './geom/blank';
import { ChipField } from './geom/chipfield';
import { blankBinormal, blankNormal, blankSurfacePoint, blankTangent, embedLength, type ChipParams } from './geom/chip';
import { makeChisel, type Chisel } from './geom/tool';
import { makeMaterials, updateTranslucency, type Materials } from './scene/materials';
import { buildWorkshop, type Workshop } from './scene/workshop';
import { makeEnvironment } from './scene/env';
import { CutAudio } from './sys/audio';

export type Phase = 'work' | 'index' | 'hold' | 'reveal' | 'done' | 'swapOut' | 'swapIn';

/** the branch being cut sits this far round from the camera, so the spiral is
 *  seen close to face-on while the trench and its root stay in view */
const CUT_OFFSET = -1.02;
/** the chisel is lifted a little at the handle, and skewed across the cut */
const TOOL_LIFT = 0.17;
const TOOL_SKEW = -0.30;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export interface Quality { level: 'high' | 'low'; nt: number; tex: number; pixelRatio: number }

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  private mats: Materials;
  private shop: Workshop;
  private blank: Blank;
  private rows: RowSpec[] = [];
  private workRow!: RowSpec;
  private childChips: ChipField;
  private premadeChips: ChipField;
  private tool: Chisel;
  private toolGroup = new THREE.Group();

  phase: Phase = 'work';
  branch = 0;
  feed = 0;      // where the tool is: follows the finger, may go back
  cut = 0;       // how much wood is gone: the high-water mark, never falls
  private phaseT = 0;
  private spinFrom = 0;
  private spinTo = 0;
  private blankSerial = 0;
  private cutSpeed = 0;
  private prevFrameCut = 0;
  private hiddenBranch = -1;
  private grabbed = false;
  private pointerId: number | null = null;
  private lastPX = 0; private lastPY = 0;
  private idleTime = 0;
  interacted = false;

  // screen mapping, recomputed on layout
  private pxPerUnitT = 500;
  dirTx = 0; dirTy = -1;
  private anchorDist = 0.08;
  anchorPx: [number, number] = [0, 0];
  contactPx: [number, number] = [0, 0];
  private camAz = Math.PI / 2;
  private camTilt = 0.3;
  private frameH = 1.3;
  private revealAz = 0;
  private revealH = 0;

  readonly audio = new CutAudio();
  private clock = new THREE.Clock();
  fps = 0;
  private fpsAcc = 0; private fpsN = 0;

  private _n = new THREE.Vector3();
  private _t = new THREE.Vector3();
  private _w = new THREE.Vector3();
  private _p = new THREE.Vector3();
  private _q = new THREE.Vector3();
  private _m = new THREE.Matrix4();
  private _x = new THREE.Vector3();
  private _y = new THREE.Vector3();
  private _z = new THREE.Vector3();
  private root = new THREE.Vector3();

  constructor(readonly canvas: HTMLCanvasElement, readonly quality: Quality) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.level === 'high', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(quality.pixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.86;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x241d16);

    this.camera = new THREE.PerspectiveCamera(FRAMING.fov, 1, 0.05, 30);
    this.scene.environment = makeEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.55;
    this.mats = makeMaterials(quality.tex);
    this.shop = buildWorkshop(this.mats, this.scene, quality.level);

    this.blank = new Blank(this.mats.blank, {
      nt: quality.nt, coarse: 0.03,
      bandStep: quality.level === 'high' ? 0.012 : 0.02,
      workStep: quality.level === 'high' ? 0.005 : 0.008,
    });
    this.shop.spindle.add(this.blank.group);

    this.childChips = new ChipField(ROW_COUNT[WORK_ROW_INDEX], CHIP.seg, CHIP.ring, this.mats.shaving);
    const premadeTotal = ROW_COUNT.reduce((a, b, i) => (i === WORK_ROW_INDEX ? a : a + b), 0);
    this.premadeChips = new ChipField(premadeTotal, CHIP_LOD.seg, CHIP_LOD.ring, this.mats.shaving);
    this.shop.spindle.add(this.childChips.mesh, this.premadeChips.mesh);

    this.tool = makeChisel(this.mats, CHIP.width);
    this.toolGroup.add(this.tool.group);
    this.scene.add(this.toolGroup);

    this.newBlank();
  }

  /* ------------------------------------------------------------------ */
  /* blank set-up                                                        */

  /** Rewrites the variation in place: a replay must not allocate. */
  private fillVariants(out: BranchVariant[], count: number, seed: number): BranchVariant[] {
    const r = mulberry32(seed);
    while (out.length < count) out.push({ skew: 0, cup: 0, widthMul: 1, tipMul: 1, lenMul: 1 });
    for (let i = 0; i < count; i++) {
      const v = out[i];
      v.skew = (r() - 0.5) * 0.22;
      v.cup = 0.045 + r() * 0.04;
      v.widthMul = 0.945 + r() * 0.11;
      v.tipMul = 0.86 + r() * 0.30;
      v.lenMul = 1;
    }
    return out;
  }

  /** A fresh, mostly finished blank: the craftsman's rows are already there. */
  private newBlank() {
    this.blankSerial++;
    const seed = 1000 + this.blankSerial * 37;
    if (this.rows.length === 0) {
      this.rows = ROW_Y.map((y, i) => ({
        yStart: y, length: CHIP.length, width: CHIP.width, depth: CHIP.depth,
        tipRadius: CHIP.tipRadius, curlOpen: CHIP.curlOpen, rake: CHIP.rake,
        count: ROW_COUNT[i], phi0: 0, cuts: new Float64Array(ROW_COUNT[i]),
        variants: [], premade: i !== WORK_ROW_INDEX,
      }));
    }
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      this.fillVariants(row.variants, row.count, seed + i * 101);
      row.cuts.fill(row.premade ? CHIP.length : 0);
    }
    this.workRow = this.rows[WORK_ROW_INDEX];
    this.blank.build(this.rows, WORK_ROW_INDEX);

    let k = 0;
    for (let i = 0; i < this.rows.length; i++) {
      if (i === WORK_ROW_INDEX) continue;
      const row = this.rows[i];
      for (let b = 0; b < row.count; b++) this.premadeChips.set(k++, this.chipParams(row, b), row.cuts[b]);
    }
    this.premadeChips.commit();
    for (let b = 0; b < this.workRow.count; b++) this.childChips.hide(b);
    this.childChips.commit();

    this.branch = 0; this.feed = 0; this.cut = 0; this.cutSpeed = 0; this.hiddenBranch = -1;
    this.setSpindleForBranch(0);
    this.blank.setSeamAwayFrom(this.camAz, this.shop.spindle.rotation.y);
  }

  private _params: ChipParams = {
    yStart: 0, phi: 0, length: 0, width: 0, depth: 0,
    tipRadius: 0, curlOpen: 0, rake: 0, skew: 0, cup: 0,
  };
  /** Reuses one record: this is called every frame while cutting. */
  private chipParams(row: RowSpec, i: number): ChipParams {
    const v = row.variants[i];
    const p = this._params;
    p.yStart = row.yStart;
    p.phi = branchPhi(row, i);
    p.length = row.length * v.lenMul;
    p.width = row.width * v.widthMul;
    p.depth = row.depth;
    p.tipRadius = row.tipRadius * v.tipMul;
    p.curlOpen = row.curlOpen;
    p.rake = row.rake;
    p.skew = v.skew;
    p.cup = v.cup;
    return p;
  }

  private cutAzimuth() { return this.camAz + CUT_OFFSET; }

  /**
   * Turning the spindle by R sends a point at blank-local angle phi to world
   * angle phi - R, so to bring branch i round to the cutting position we need
   * R = phi_i - theta_cut. Indexing to the next face therefore ADDS one step.
   */
  private setSpindleForBranch(i: number) {
    this.shop.spindle.rotation.y = branchPhi(this.workRow, i) - this.cutAzimuth();
  }

  /* ------------------------------------------------------------------ */
  /* layout                                                              */

  resize(w: number, h: number, dpr: number) {
    const portrait = h >= w;
    this.frameH = portrait ? FRAMING.portraitHeight : FRAMING.landscapeHeight;
    this.camTilt = portrait ? FRAMING.portraitTilt : FRAMING.landscapeTilt;
    this.camAz = Math.PI / 2 - (portrait ? 0.12 : FRAMING.landscapeAzimuth);
    this.camTargetY = portrait ? FRAMING.targetY : FRAMING.landscapeTargetY;
    this.lookBias = portrait ? FRAMING.portraitLookBias : FRAMING.landscapeLookBias;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyCamera(this.camAz, this.frameH, this.camTilt);
    if (this.phase === 'index') {
      // re-aim the running index step at the new cutting azimuth
      this.spinTo = branchPhi(this.workRow, this.branch) - this.cutAzimuth();
      this.spinFrom = this.spinTo - (Math.PI * 2) / this.workRow.count;
    } else if (this.phase !== 'reveal' && this.phase !== 'done') {
      this.setSpindleForBranch(Math.min(this.branch, this.workRow.count - 1));
    }
    this.updateScreenMapping(w, h);
  }

  /**
   * The camera orbits the blank's axis but AIMS between the axis and the face
   * being cut, so the contact, the curl and its root stay centred whatever the
   * screen shape. It never moves while the child is working.
   */
  private applyCamera(az: number, frameH: number, tilt: number, targetY: number = this.camTargetY, bias = this.lookBias) {
    const d = (frameH / 2) / Math.tan((FRAMING.fov * Math.PI) / 360);
    this.camera.position.set(
      Math.cos(az) * Math.cos(tilt) * d,
      targetY + Math.sin(tilt) * d,
      Math.sin(az) * Math.cos(tilt) * d,
    );
    this.contactPoint(this.workRow ? this.workRow.length * 0.5 : 0, this._q);
    this.camera.lookAt(
      this._q.x * bias,
      targetY + (this._q.y - targetY) * bias * 0.5,
      this._q.z * bias,
    );
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
  private camTargetY: number = FRAMING.targetY;
  private lookBias: number = FRAMING.portraitLookBias;

  private cssW = 1; private cssH = 1;

  private toPx(v: THREE.Vector3, out: [number, number]) {
    this._q.copy(v).project(this.camera);
    out[0] = (this._q.x * 0.5 + 0.5) * this.cssW;
    out[1] = (0.5 - this._q.y * 0.5) * this.cssH;
    return out;
  }

  private contactPoint(feed: number, out: THREE.Vector3) {
    const y = this.workRow.yStart + feed;
    const th = this.cutAzimuth();
    blankSurfacePoint(y, th, out);
    out.y += BLANK.standHeight;
    return out;
  }

  private toolDir(out: THREE.Vector3) {
    const th = this.cutAzimuth();
    blankNormal(th, this._n); blankTangent(th, this._t); blankBinormal(th, this._w);
    const cg = Math.cos(TOOL_LIFT), sg = Math.sin(TOOL_LIFT);
    out.set(0, 0, 0)
      .addScaledVector(this._t, -cg * Math.cos(TOOL_SKEW))
      .addScaledVector(this._w, cg * Math.sin(TOOL_SKEW))
      .addScaledVector(this._n, sg)
      .normalize();
    return out;
  }

  private updateScreenMapping(w: number, h: number) {
    this.cssW = w; this.cssH = h;
    const th = this.cutAzimuth();
    blankTangent(th, this._t);
    this.contactPoint(0, this._p);
    const a: [number, number] = [0, 0], b: [number, number] = [0, 0];
    this.toPx(this._p, a);
    this.toPx(this._q.copy(this._p).addScaledVector(this._t, 0.05), b);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    this.pxPerUnitT = len / 0.05;
    this.dirTx = dx / len; this.dirTy = dy / len;

    // put the finger on the tool HANDLE_OFFSET_PX away from the edge
    this.toolDir(this._z);
    let lo = 0.01, hi = this.tool.length;
    for (let k = 0; k < 26; k++) {
      const mid = (lo + hi) / 2;
      this.toPx(this._q.copy(this._p).addScaledVector(this._z, mid), b);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < HANDLE_OFFSET_PX) lo = mid; else hi = mid;
    }
    this.anchorDist = (lo + hi) / 2;
  }

  /* ------------------------------------------------------------------ */
  /* input: one finger. The cut advances ONLY while the finger moves.    */

  private hitTest(px: number, py: number): boolean {
    this.contactPoint(this.feed, this._p);
    const a: [number, number] = [0, 0], b: [number, number] = [0, 0];
    this.toPx(this._p, a);
    this.toolDir(this._z);
    this.toPx(this._q.copy(this._p).addScaledVector(this._z, this.tool.length), b);
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const L2 = vx * vx + vy * vy || 1;
    let t = ((px - a[0]) * vx + (py - a[1]) * vy) / L2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - (a[0] + vx * t), py - (a[1] + vy * t));
    if (d < 95) return true;
    // generous fallback: anywhere on the tool's side of the contact
    return (px - a[0]) * this.dirTx + (py - a[1]) * this.dirTy < 0 &&
           Math.hypot(px - a[0], py - a[1]) < Math.max(this.cssW, this.cssH) * 0.6;
  }

  onPointerDown(id: number, px: number, py: number): boolean {
    if (this.pointerId !== null) return false;         // a second finger is ignored
    if (this.phase !== 'work') return false;
    if (!this.hitTest(px, py)) return false;
    this.pointerId = id; this.grabbed = true;
    this.lastPX = px; this.lastPY = py;
    this.interacted = true;
    this.audio.start(); this.audio.resume();
    return true;
  }

  onPointerMove(id: number, px: number, py: number) {
    if (id !== this.pointerId || !this.grabbed || this.phase !== 'work') return;
    const dx = px - this.lastPX, dy = py - this.lastPY;
    this.lastPX = px; this.lastPY = py;
    const along = (dx * this.dirTx + dy * this.dirTy) / this.pxPerUnitT;
    const before = this.cut;
    this.feed = Math.max(0, Math.min(this.workRow.length, this.feed + along));
    // wood already gone stays gone: the cut can only ever grow
    if (this.feed > this.cut) this.cut = this.feed;
    if (this.cut !== before) this.idleTime = 0;
  }

  onPointerUp(id: number) {
    if (id !== this.pointerId) return;
    this.pointerId = null; this.grabbed = false;
  }

  /* ------------------------------------------------------------------ */

  private beginIndex() {
    this.phase = 'index';
    this.phaseT = 0;
    this.spinFrom = this.shop.spindle.rotation.y;
    this.spinTo = this.spinFrom + (Math.PI * 2) / this.workRow.count;
    this.audio.click();
  }

  reset() {
    if (this.phase === 'swapOut' || this.phase === 'swapIn') return;
    this.phase = 'swapOut';
    this.phaseT = 0;
  }

  get finished() { return this.branch >= this.workRow.count; }
  get branchesDone() { return Math.min(this.branch, this.workRow.count); }

  /* ------------------------------------------------------------------ */

  update(): number {
    const dt = Math.min(0.05, this.clock.getDelta());
    const prevCut = this.prevFrameCut;

    switch (this.phase) {
      case 'work': {
        if (!this.debugHold && this.cut >= this.workRow.length - 1e-6) {
          this.workRow.cuts[this.branch] = this.workRow.length;
          this.branch++;
          if (this.branch >= this.workRow.count) { this.phase = 'hold'; this.phaseT = 0; }
          else this.beginIndex();
        }
        break;
      }
      case 'index': {
        this.phaseT += dt / TIMING.indexDuration;
        const k = clamp01(this.phaseT);
        const spin = ease(clamp01((k - 0.20) / 0.62));
        this.shop.spindle.rotation.y = this.spinFrom + (this.spinTo - this.spinFrom) * spin;
        // the tool is lifted clear, then set down at the start of the next face
        this.feed = this.workRow.length * (1 - ease(clamp01(k / 0.30)));
        if (k >= 1) {
          this.phase = 'work'; this.feed = 0; this.cut = 0;
          this.setSpindleForBranch(this.branch);
        }
        break;
      }
      case 'hold': {
        this.phaseT += dt;
        this.feed = Math.max(0, this.feed - dt * 0.35);
        if (this.phaseT >= TIMING.holdAfterLast) {
          this.phase = 'reveal'; this.phaseT = 0;
          this.revealAz = this.camAz; this.revealH = this.frameH;
        }
        break;
      }
      case 'reveal': {
        this.phaseT += dt / TIMING.revealDuration;
        const k = ease(clamp01(this.phaseT));
        this.applyCamera(this.revealAz + 0.85 * k, this.revealH + 0.45 * k, this.camTilt + 0.06 * k);
        if (this.phaseT >= 1) this.phase = 'done';
        break;
      }
      case 'done': break;
      case 'swapOut': {
        // the finished piece is lifted off the centres and carried away
        this.phaseT += dt / TIMING.resetOut;
        const k = ease(clamp01(this.phaseT));
        this.shop.spindle.position.set(-0.62 * k, BLANK.standHeight + 1.05 * k, 0.30 * k);
        this.applyCamera(
          this.camAz + 0.85 * (1 - k), this.frameH + 0.45 * (1 - k), this.camTilt + 0.06 * (1 - k));
        if (this.phaseT >= 1) {
          this.newBlank();
          this.phase = 'swapIn'; this.phaseT = 0;
          this.audio.click(0.6);
        }
        break;
      }
      case 'swapIn': {
        this.phaseT += dt / TIMING.resetIn;
        const k = ease(clamp01(this.phaseT));
        // and a new, unfinished blank is set into the jig from the bench
        this.shop.spindle.position.set(0.40 * (1 - k), BLANK.standHeight - 1.05 * (1 - k), 0.22 * (1 - k));
        if (this.phaseT >= 1) { this.phase = 'work'; this.shop.spindle.position.set(0, BLANK.standHeight, 0); }
        break;
      }
    }

    // The working shaving and the wood it came out of, driven from the same
    // numbers. This runs ONLY while cutting: nothing else is allowed to write
    // a cut length, so the face the blank has just been indexed to stays
    // untouched until the child actually cuts it.
    if (this.phase === 'work' && this.branch < this.workRow.count) {
      const live = this.branch;
      if (this.cut > this.workRow.cuts[live]) {
        this.workRow.cuts[live] = this.cut;
        this.childChips.set(live, this.chipParams(this.workRow, live), this.cut, this.root);
        this.childChips.commit([live, live]);
        this.blank.updateWorkBand();
      } else if (this.cut <= 1e-5 && this.workRow.cuts[live] <= 1e-5 && this.hiddenBranch !== live) {
        this.hiddenBranch = live;
        this.childChips.hide(live);
        this.childChips.commit([live, live]);
      }
    }

    // tool follows the finger exactly; it never advances on its own
    this.placeTool();

    const speed = Math.abs(this.cut - prevCut) / Math.max(dt, 1e-4);
    this.prevFrameCut = this.cut;
    this.cutSpeed = speed;
    this.audio.update(this.phase === 'work' ? speed / (this.workRow.length * 1.8) : 0, dt);

    if (this.phase === 'work' && !this.grabbed) this.idleTime += dt; else this.idleTime = 0;

    updateTranslucency(this.shop.keyDir, this.camera);
    this.renderer.render(this.scene, this.camera);

    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }

    this.contactPoint(this.feed, this._p);
    this.toPx(this._p, this.contactPx);
    this.toolDir(this._z);
    this.toPx(this._q.copy(this._p).addScaledVector(this._z, this.anchorDist), this.anchorPx);
    return dt;
  }

  private placeTool() {
    const th = this.cutAzimuth();
    blankNormal(th, this._n);
    this.contactPoint(this.feed, this._p);
    // the flat back of the blade rests on the floor of the cut: that, not the
    // finger, is what fixes the depth
    this._p.addScaledVector(this._n, -(CHIP.depth - 0.006));
    if (this.phase === 'index') {
      const k = clamp01(this.phaseT / 0.30) * clamp01((1 - this.phaseT) / 0.25);
      this._p.addScaledVector(this._n, 0.075 * Math.min(1, k * 2));
    }
    this.toolDir(this._z);
    this._x.crossVectors(this._n, this._z).normalize();
    this._y.crossVectors(this._z, this._x).normalize();
    this._m.makeBasis(this._x, this._y, this._z);
    this.toolGroup.quaternion.setFromRotationMatrix(this._m);
    this.toolGroup.position.copy(this._p);
    this.toolGroup.visible = !this.debugHideTool && this.phase !== 'reveal' && this.phase !== 'done'
      && this.phase !== 'swapOut' && this.phase !== 'swapIn';
  }

  /* ------------------------------------------------------------------ */

  get idle() { return this.idleTime; }
  get speed() { return this.cutSpeed; }
  get stats() {
    return {
      phase: this.phase, branch: this.branch, feed: this.feed, cut: this.cut,
      done: this.branchesDone, blankSerial: this.blankSerial,
      spindle: this.shop.spindle.rotation.y,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: this.renderer.info.programs?.length ?? 0,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      fps: this.fps,
      contactPx: this.contactPx.slice(),
      anchorPx: this.anchorPx.slice(),
      handleOffsetPx: Math.hypot(this.anchorPx[0] - this.contactPx[0], this.anchorPx[1] - this.contactPx[1]),
      strokePx: this.workRow ? this.workRow.length * this.pxPerUnitT : 0,
      rootWorld: this.root.toArray(),
      env: !!this.scene.environment,
    };
  }

  /** Debug-only: orbit tight around the live blade contact point. */
  debugFocus(azOffset: number, dist: number, elev = 0.18) {
    const th = this.cutAzimuth() + azOffset;
    this.contactPoint(this.feed, this._p);
    const tx = this._p.x, ty = this._p.y, tz = this._p.z;
    this.camera.position.set(
      tx + Math.cos(th) * Math.cos(elev) * dist,
      ty + Math.sin(elev) * dist,
      tz + Math.sin(th) * Math.cos(elev) * dist,
    );
    this.camera.lookAt(tx, ty, tz);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /**
   * Verification probe: reads the shaving actually in the buffer and the
   * blank actually on screen, and reports whether they agree.
   */
  probe() {
    const row = this.workRow;
    const b = Math.min(this.branch, row.count - 1);
    const L = row.cuts[b];
    const p = this.chipParams(row, b);
    const embed = embedLength(p);
    const seg = CHIP.seg;
    const iRoot = Math.round((embed / (L + embed)) * seg);
    const rootC = this.childChips.sectionCentroid(b, iRoot, new THREE.Vector3());
    const tipC = this.childChips.sectionCentroid(b, seg, new THREE.Vector3());

    blankNormal(p.phi, this._n);
    const expect = blankSurfacePoint(p.yStart + L, p.phi, new THREE.Vector3())
      .addScaledVector(this._n, -(p.depth * 0.5 + Math.abs(p.cup) * 0.667 * p.width * 0.5 + 0.002));

    // how far the free tip stands clear of the blank's surface, and how far
    // round the shaving has rolled
    const axis = Math.hypot(tipC.x, tipC.z);
    const tipClear = axis - this.blank.radiusProbe(tipC.y, Math.atan2(tipC.z, tipC.x));
    const tipTurn = p.curlOpen > 1e-6
      ? Math.log((p.tipRadius + p.curlOpen * L) / p.tipRadius) / p.curlOpen : 0;

    let chain = 0;
    const a = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < seg; i++) {
      this.childChips.sectionCentroid(b, i, a);
      this.childChips.sectionCentroid(b, i + 1, c);
      chain += a.distanceTo(c);
    }
    const yMid = p.yStart + L * 0.5;
    const clean = blankRadius(yMid);
    return {
      cut: L,
      rootErr: rootC.distanceTo(expect),
      rootWorldY: rootC.y + BLANK.standHeight,
      tipY: tipC.y,
      tipYExpected: p.yStart,
      chainLen: chain,
      chainExpected: L + embed,
      tipClear,
      tipTurn,
      /** the blank where the shaving came from: should be a cut of `depth` */
      trenchDepth: L > 0.01 ? clean - this.blank.radiusProbe(yMid, p.phi) : 0,
      /** just above the edge the wood must be untouched */
      aboveRoot: blankRadius(p.yStart + L + 0.03) - this.blank.radiusProbe(p.yStart + L + 0.03, p.phi),
      /** clear of the blade's width it must also be untouched */
      besideCut: clean - this.blank.radiusProbe(yMid, p.phi + 0.85),
      depth: p.depth,
      width: p.width,
    };
  }

  /**
   * Cost of the part of a frame this game is actually responsible for:
   * rewriting the live shaving and re-cutting the blank's working band.
   * Device-independent enough to be worth reporting; the rasterising is not.
   */
  measureCutCost(iters = 150) {
    const row = this.workRow;
    const keep = row.cuts[0];
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) {
      this.childChips.set(0, this.chipParams(row, 0), row.length * (0.15 + 0.8 * (i / iters)));
    }
    const t1 = performance.now();
    for (let i = 0; i < iters; i++) {
      row.cuts[0] = row.length * (0.15 + 0.8 * (i / iters));
      this.blank.updateWorkBand();
    }
    const t2 = performance.now();
    row.cuts[0] = keep;
    this.childChips.set(0, this.chipParams(row, 0), keep);
    this.childChips.commit();
    this.blank.updateWorkBand();
    return {
      shavingMs: (t1 - t0) / iters,
      blankMs: (t2 - t1) / iters,
      totalMs: (t2 - t0) / iters,
    };
  }

  /** Debug-only visibility control for the verification harness. */
  show(o: { premade?: boolean; tool?: boolean; child?: boolean }) {
    if (o.premade !== undefined) this.premadeChips.mesh.visible = o.premade;
    if (o.child !== undefined) this.childChips.mesh.visible = o.child;
    if (o.tool !== undefined) this.debugHideTool = !o.tool;
  }
  /** Debug-only: stay in the cutting phase so a mid-state can be inspected. */
  hold(on: boolean) { this.debugHold = on; }
  private debugHideTool = false;
  private debugHold = false;

  /** Debug-only camera override, used by the verification harness. */
  debugCamera(az: number, frameH: number, tilt: number, targetY?: number) {
    this.applyCamera(az, frameH, tilt, targetY ?? this.camTargetY);
  }
  restoreCamera() { this.applyCamera(this.camAz, this.frameH, this.camTilt); }
  get cutAz() { return this.cutAzimuth(); }
  /** verification only */
  get workRowCuts() { return this.workRow.cuts; }
}
