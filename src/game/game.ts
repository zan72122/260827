import * as THREE from 'three';
import { Cake } from '../cake/cake';
import { CAKE, chefDesign, makePlacement, POSES as POSE_LIST, SLOTS, type Placement, type Pose } from '../cake/design';
import type { MaterialSet } from '../materials';
import { buildKitchen, STATION, type Kitchen } from '../scene/kitchen';
import { buildGuide, buildKnife, buildPaletteKnife, buildPipingBag, buildServer, type Guide, type PipingBag } from '../scene/tools';
import { CameraRig } from '../scene/camera';
import { Hud } from '../ui/hud';
import { Pointer, type DragState } from '../input/pointer';
import { Sfx } from '../audio/audio';
import { Rng } from '../util/rng';
import { clamp, damp, easeOut, easeInOut, Timeline } from '../util/tween';

type Phase =
  | 'intro' | 'cut1' | 'turn' | 'cut2' | 'serve' | 'study'
  | 'toBuild' | 'place' | 'fill' | 'lid' | 'coat'
  | 'aim' | 'cutNew' | 'turnNew' | 'serveNew' | 'studyNew' | 'again';

const WEDGE = CAKE.wedgeAngle;
const RAD45 = Math.PI / 4;

interface Station {
  cake: Cake;
  plate: THREE.Group;
  guide: Guide;
  knife: THREE.Group;
  server: THREE.Group;
  origin: THREE.Vector3;
  /** Board-top height above the bench. */
  cakeY: number;
  plateAngle: number;
  /** Which of the two cut lines the blade is currently drawing. */
  scoreKind: 'a' | 'b';
}

interface Crumb {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  scale: number;
  life: number;
}

export class Game {
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  private kitchen: Kitchen;
  private mats: MaterialSet;
  private hud = new Hud();
  private sfx = new Sfx();
  private pointer: Pointer;
  private timeline = new Timeline();
  private rng = new Rng(7);

  private phase: Phase = 'intro';
  private phaseTime = 0;
  private clock = 0;
  private cutStation!: Station;
  private buildStation!: Station;
  private paletteKnife: THREE.Group;
  private piping: PipingBag;

  private cutProgress = 0;
  private servedProgress = 0;
  private aimAngle = 0;
  private round = 0;
  private busy = false;

  private trayBerries: { group: THREE.Group; placement: Placement }[] = [];
  private carried: { group: THREE.Group; placement: Placement; home: THREE.Vector3 } | null = null;
  private carriedSlot = -1;
  private downHitBerrySlot = -1;

  private raycaster = new THREE.Raycaster();
  private crumbs: Crumb[] = [];
  private crumbMesh!: THREE.InstancedMesh;
  private static readonly MAX_CRUMBS = 64;
  private pipeLast = new THREE.Vector2(999, 999);

  constructor(mats: MaterialSet, canvas: HTMLElement, aspect: number, env: THREE.Texture) {
    this.mats = mats;
    this.scene.background = new THREE.Color(0xd9d2c8);
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.75;
    this.scene.fog = new THREE.Fog(0xcfc7bc, 150, 300);

    this.kitchen = buildKitchen(mats);
    this.scene.add(this.kitchen.root);
    this.rig = new CameraRig(aspect);

    this.cutStation = this.makeStation(this.kitchen.cutTable.group, this.kitchen.cutTable.plate, STATION.cut, this.kitchen.cutTable.cakeY, chefDesign());
    this.buildStation = this.makeStation(this.kitchen.buildTable.group, this.kitchen.buildTable.plate, STATION.build, this.kitchen.buildTable.cakeY, { placements: [], fill: 0 });

    this.buildFinishedCake(this.cutStation.cake);
    this.prepareBuildCake();

    this.paletteKnife = buildPaletteKnife(mats);
    this.paletteKnife.visible = false;
    this.scene.add(this.paletteKnife);
    this.piping = buildPipingBag(mats);
    this.piping.group.scale.setScalar(0.82);
    this.piping.group.visible = false;
    this.scene.add(this.piping.group);

    this.makeTray();

    const crumbGeo = new THREE.TetrahedronGeometry(0.15, 0);
    this.crumbMesh = new THREE.InstancedMesh(crumbGeo, this.mats.crumb, Game.MAX_CRUMBS);
    this.crumbMesh.count = 0;
    this.crumbMesh.castShadow = true;
    this.crumbMesh.frustumCulled = false;
    this.scene.add(this.crumbMesh);

    this.pointer = new Pointer(canvas);
    this.pointer.onDown = (d) => this.onDown(d);
    this.pointer.onMove = (d) => this.onMove(d);
    this.pointer.onUp = (d) => this.onUp(d);

    this.rig.apply({ target: new THREE.Vector3(0, 8.2, 0), dir: new THREE.Vector3(-0.9, 0.5, 1), fit: 15 }, true);
    this.rig.goto('whole', 2.6);
    this.setPhase('intro');
  }

  /* --------------------------------------------------------------- setup */

  private makeStation(table: THREE.Group, plate: THREE.Group, origin: THREE.Vector3, cakeY: number, design: { placements: Placement[]; fill: number }): Station {
    const cake = new Cake(this.mats, design);
    cake.root.position.y = cakeY;
    plate.add(cake.root);

    const guide = buildGuide(this.mats);
    guide.group.position.set(origin.x + 26, 0, origin.z);
    guide.group.visible = false;
    table.parent!.add(guide.group);

    const knife = buildKnife(this.mats);
    knife.rotation.y = Math.PI;
    guide.boom.add(knife);
    knife.visible = false;

    const server = buildServer(this.mats);
    server.visible = false;
    this.scene.add(server);

    return { cake, plate, guide, knife, server, origin, cakeY, plateAngle: 0, scoreKind: 'a' };
  }

  private buildFinishedCake(cake: Cake) {
    cake.buildBoardAndBase();
    for (const p of cake.design.placements) cake.addBerry(p);
    cake.setFill(1);
    cake.addTopSponge();
    cake.buildCoat();
    cake.setCoat(1, 1);
    cake.addDecoration(4242);
  }

  private prepareBuildCake() {
    const cake = this.buildStation.cake;
    cake.buildBoardAndBase();
    cake.buildCoat();
    cake.setCoat(0, 0);
    cake.setFill(0);
    cake.root.visible = false;
    this.addDimples(cake);
  }

  private dimpleTexture: THREE.Texture | null = null;

  /** The only hint of where a slice goes: a shallow dip in the cream. */
  private makeDimpleTexture(): THREE.Texture {
    if (this.dimpleTexture) return this.dimpleTexture;
    const size = 96;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x / size - 0.5) * 2;
        const dy = (y / size - 0.5) * 2;
        const r = Math.hypot(dx, dy);
        const dip = Math.max(0, 1 - r * r);
        // Dark on the far side, a touch brighter on the near lip: a depression.
        const rim = Math.max(0, 1 - Math.abs(r - 0.72) * 6);
        const lit = dy < 0;
        const shade = dip * 0.5 + rim * 0.5;
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = lit ? 255 : 74;
        img.data[i + 3] = Math.max(0, Math.min(255, shade * (lit ? 60 : 96) * Math.abs(dy) * 1.7));
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.dimpleTexture = tex;
    return tex;
  }

  private addDimples(cake: Cake) {
    const mat = new THREE.MeshBasicMaterial({
      map: this.makeDimpleTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.95,
    });
    const group = new THREE.Group();
    group.name = 'dimples';
    for (const slot of SLOTS) {
      const g = new THREE.PlaneGeometry(4.4, 4.4);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(Math.cos(slot.angle) * slot.radius, CAKE.filling.y0 + CAKE.skim + 0.03, Math.sin(slot.angle) * slot.radius);
      m.renderOrder = 1;
      group.add(m);
    }
    cake.body.add(group);
  }

  private makeTray() {
    const rng = new Rng(517);
    const cols = 5;
    for (let i = 0; i < 9; i++) {
      const p = makePlacement(i, 'flatTipOut', rng, i % 3 === 0 ? 1.12 : i % 3 === 1 ? 0.9 : 1.0);
      const g = new THREE.Group();
      const rim = new THREE.Mesh(p.berry.buildSlabRim(p.slab), this.mats.berrySkin);
      const faces = new THREE.Mesh(p.berry.buildSlabFaces(p.slab), this.mats.berryCut);
      rim.castShadow = true;
      g.add(rim, faces);
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = this.kitchen.tray.position.x + (col - (cols - 1) / 2) * 3.9 + (row === 1 ? 1.95 : 0);
      const z = this.kitchen.tray.position.z + (row - 0.5) * 4.2;
      g.position.set(x, 0.75 + p.slab, z);
      g.rotation.set(-Math.PI / 2, 0, rng.range(-0.4, 0.4));
      g.userData.home = g.position.clone();
      this.scene.add(g);
      this.trayBerries.push({ group: g, placement: p });
    }
  }

  /* --------------------------------------------------------------- phases */

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseTime = 0;
    document.body.dataset.phase = p;
    this.hud.hideCue();
    const cutting = p === 'cut1' || p === 'cut2' || p === 'cutNew' || p === 'turnNew' || p === 'aim';
    this.cutStation.guide.group.visible = cutting && (p === 'cut1' || p === 'cut2');
    this.buildStation.guide.group.visible = cutting && p !== 'cut1' && p !== 'cut2';
    switch (p) {
      case 'intro':
        this.hud.setHint('しろい ケーキ');
        break;
      case 'cut1':
        this.cutStation.scoreKind = 'a';
        this.rig.goto('cutA', 1.6);
        this.hud.setHint('ゆびで すーっと きろう');
        this.cutStation.knife.visible = true;
        this.cutProgress = 0;
        break;
      case 'turn':
        this.rig.goto('turn', 1.3);
        this.hud.setHint('だいを まわそう');
        break;
      case 'cut2':
        this.cutStation.scoreKind = 'b';
        this.rig.goto('cutB', 1.3);
        this.hud.setHint('もういちど すーっ');
        this.cutStation.knife.visible = true;
        this.cutProgress = 0;
        break;
      case 'serve':
      case 'serveNew':
        this.rig.goto(p === 'serve' ? 'serve' : 'serveNew', 1.4);
        this.hud.setHint('てまえに ひっぱる');
        this.servedProgress = 0;
        break;
      case 'study':
        this.hud.setHint('しろい なかに いちごが ならんでた');
        break;
      case 'toBuild':
        this.hud.setHint('つぎは じぶんで つくろう');
        break;
      case 'place':
        this.rig.goto('place', 1.4);
        this.hud.setHint(this.round === 0 ? 'いちごを おいてみよう' : 'こんどは ちがう ところに');
        break;
      case 'fill':
        this.rig.goto('fill', 1.4);
        this.hud.setHint('クリームで すきまを うめよう');
        break;
      case 'lid':
        this.rig.goto('lid', 1.4);
        this.hud.setHint('スポンジを のせよう');
        break;
      case 'coat':
        this.rig.goto('coat', 1.4);
        this.hud.setHint('しろく つつむよ');
        break;
      case 'aim':
        this.rig.goto('aim', 1.4);
        this.hud.setHint(this.round >= 1 ? 'きる むきを かえてみよう' : 'どこで きる？');
        break;
      case 'cutNew':
        this.buildStation.scoreKind = 'a';
        this.rig.goto('cutNew', 1.2);
        this.hud.setHint('すーっと きろう');
        this.buildStation.knife.visible = true;
        this.cutProgress = 0;
        break;
      case 'studyNew':
        this.hud.setHint('じぶんで おいた いちごの だんめん');
        break;
      case 'again':
        this.hud.setHint('もういちど つくる？');
        break;
    }
  }

  /* ---------------------------------------------------------------- input */

  private activeStation(): Station {
    return this.phase === 'cut1' || this.phase === 'turn' || this.phase === 'cut2' || this.phase === 'serve' || this.phase === 'study'
      ? this.cutStation
      : this.buildStation;
  }

  /** Screen direction the cut swipe should follow, from rim towards centre. */
  private cutScreenDir(st: Station, worldAngle: number): THREE.Vector2 {
    const a = new THREE.Vector3(Math.cos(worldAngle) * CAKE.radius, CAKE.topCoat.y1, Math.sin(worldAngle) * CAKE.radius)
      .add(st.origin).setY(st.cakeY + CAKE.topCoat.y1);
    const b = new THREE.Vector3(st.origin.x, st.cakeY + CAKE.topCoat.y1, st.origin.z);
    const pa = a.clone().project(this.rig.camera);
    const pb = b.clone().project(this.rig.camera);
    return new THREE.Vector2(pb.x - pa.x, pb.y - pa.y).normalize();
  }

  private cutWorldAngle(st: Station): number {
    return st === this.cutStation ? 0 : this.aimAngle;
  }

  private onDown(d: DragState) {
    this.sfx.resume();
    if (this.busy) return;
    if (this.phase === 'intro') {
      this.setPhase('cut1');
      return;
    }
    if (this.phase === 'again') {
      this.restart();
      return;
    }
    if (this.phase === 'place') {
      this.pickBerry(d);
    }
    if (this.phase === 'fill') {
      this.piping.group.visible = true;
      this.sfx.pipeStart();
      this.pipeLast.set(999, 999);
      this.movePiping(d);
    }
  }

  private onMove(d: DragState) {
    if (this.busy) return;
    switch (this.phase) {
      case 'cut1':
      case 'cut2':
      case 'cutNew': {
        const st = this.activeStation();
        const dir = this.cutScreenDir(st, this.cutWorldAngle(st));
        const along = d.dx * dir.x + d.dy * dir.y;
        const p = clamp(along / 0.42, 0, 1);
        if (p > this.cutProgress) {
          if (this.cutProgress < 0.04 && p >= 0.04) this.sfx.cut();
          if (Math.floor(p * 7) > Math.floor(this.cutProgress * 7)) this.spawnCrumbs(st);
          this.cutProgress = p;
        }
        break;
      }
      case 'turn': {
        const st = this.cutStation;
        const target = clamp(d.dx * 1.9, 0, RAD45 * 1.12);
        const prev = st.plateAngle;
        st.plateAngle = target;
        if (Math.floor(target / 0.11) !== Math.floor(prev / 0.11)) this.sfx.bearing();
        break;
      }
      case 'serve':
      case 'serveNew': {
        const st = this.activeStation();
        const pull = clamp((-d.dy) / 0.34, 0, 1);
        if (pull > this.servedProgress) {
          if (!st.cake.isSplit && pull > 0.015) this.performSplit(st);
          this.servedProgress = pull;
        }
        break;
      }
      case 'place':
        this.dragBerry(d);
        break;
      case 'lid':
        this.handleLidDrag(d);
        break;
      case 'fill':
        this.movePiping(d);
        break;
      case 'aim':
        this.aimDrag(d);
        break;
      default:
        break;
    }
  }

  private onUp(d: DragState) {
    if (this.busy) return;
    switch (this.phase) {
      case 'cut1':
      case 'cut2':
      case 'cutNew':
        if (this.cutProgress > 0.9) this.finishCut();
        else this.cutProgress = 0;
        break;
      case 'turn': {
        const st = this.cutStation;
        if (st.plateAngle > RAD45 * 0.45) this.settleTurn(RAD45);
        else this.settleTurn(0);
        break;
      }
      case 'serve':
      case 'serveNew':
        if (this.servedProgress > 0.72) this.finishServe();
        break;
      case 'place':
        this.dropBerry();
        break;
      case 'fill':
        this.sfx.pipeStop();
        this.piping.group.visible = false;
        if (this.buildStation.cake.fill >= 0.995) this.advanceToLid();
        break;
      case 'aim':
        this.armCut(d);
        break;
      case 'lid':
        this.dropLid(d);
        break;
      default:
        break;
    }
  }

  /* ----------------------------------------------------------- cut & serve */

  private finishCut() {
    const st = this.activeStation();
    this.busy = true;
    this.cutProgress = 1;
    this.sfx.settle();
    const localAngle = this.cutWorldAngle(st) + st.plateAngle;
    this.timeline.add(0.55, (k) => {
      st.knife.position.y = st.cakeY + CAKE.topCoat.y1 + 1.0 + easeOut(k) * 9;
    }, 0.18, () => {
      st.knife.visible = false;
      this.busy = false;
      if (this.phase === 'cut1') {
        this.cutStation.cake.setScore(localAngle, 1, 'a');
        this.setPhase('turn');
      } else if (this.phase === 'cut2') {
        this.setPhase('serve');
      } else if (this.phase === 'cutNew') {
        this.autoSecondCut();
      }
    });
  }

  /** Machine repeats the cut 45 degrees on, so the child swipes only once. */
  private autoSecondCut() {
    const st = this.buildStation;
    this.busy = true;
    this.setPhase('turnNew');
    this.hud.setHint('');
    const from = st.plateAngle;
    this.timeline.add(0.85, (k) => {
      st.plateAngle = from + easeInOut(k) * RAD45;
      if (Math.random() < 0.25) this.sfx.bearing();
    }, 0.15, () => {
      st.knife.visible = true;
      st.scoreKind = 'b';
      this.cutProgress = 0;
      this.sfx.cut();
      this.timeline.add(0.85, (k) => {
        this.cutProgress = easeInOut(k);
        if (Math.floor(k * 7) !== Math.floor((k - 0.02) * 7)) this.spawnCrumbs(st);
      }, 0, () => {
        this.timeline.add(0.4, (kk) => {
          st.knife.position.y = st.cakeY + CAKE.topCoat.y1 + 1.0 + easeOut(kk) * 9;
        }, 0, () => {
          st.knife.visible = false;
          // Present the wedge towards the viewer before it is drawn out.
          const start = st.plateAngle;
          const target = this.aimAngle + RAD45;
          this.timeline.add(0.7, (kk) => {
            st.plateAngle = start + (target - start) * easeInOut(kk);
          }, 0.1, () => {
            this.busy = false;
            this.setPhase('serveNew');
          });
        });
      });
    });
  }

  private settleTurn(target: number) {
    const st = this.cutStation;
    const from = st.plateAngle;
    this.busy = true;
    this.timeline.add(0.6, (k) => {
      const e = 1 - Math.pow(1 - k, 3);
      st.plateAngle = from + (target - from) * e;
    }, 0, () => {
      this.busy = false;
      if (target > 0) {
        this.sfx.bearing();
        this.setPhase('cut2');
      }
    });
  }

  private performSplit(st: Station) {
    const a1 = st === this.cutStation ? 0 : this.aimAngle;
    st.cake.split(a1);
    st.cake.clearScore();
    this.sfx.release();
    this.rig.nudge(0.05);
    st.server.visible = true;
  }

  private finishServe() {
    this.busy = true;
    const from = this.servedProgress;
    this.sfx.settle();
    this.timeline.add(0.5, (k) => {
      this.servedProgress = from + (1 - from) * easeOut(k);
    }, 0, () => {
      this.busy = false;
      if (this.phase === 'serve') {
        this.rig.goto('study', 2.2);
        this.setPhase('study');
        this.timeline.wait(3.4, () => this.goToBuild());
      } else {
        this.rig.goto('revealNew', 1.6);
        this.setPhase('studyNew');
        this.timeline.wait(3.6, () => {
          this.setPhase('again');
          this.hud.setCue('tap', new THREE.Vector3(STATION.build.x, this.buildStation.cakeY + 3, 9));
        });
      }
    });
  }

  /* ------------------------------------------------------------- assembly */

  private goToBuild() {
    this.setPhase('toBuild');
    this.busy = true;
    this.buildStation.cake.root.visible = true;
    this.rig.goto('buildTop', 2.4);
    this.timeline.wait(2.6, () => {
      this.busy = false;
      this.setPhase('place');
    });
  }

  private planePoint(d: DragState, y: number, screenLift = 0): THREE.Vector3 | null {
    this.raycaster.setFromCamera(new THREE.Vector2(d.x, d.y + screenLift), this.rig.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, out);
  }

  private pickBerry(d: DragState) {
    this.raycaster.setFromCamera(new THREE.Vector2(d.x, d.y), this.rig.camera);
    this.downHitBerrySlot = -1;
    const trayHits = this.raycaster.intersectObjects(this.trayBerries.map((t) => t.group), true);
    if (trayHits.length) {
      const grp = this.findTray(trayHits[0].object);
      if (grp) {
        this.carried = { group: grp.group, placement: grp.placement, home: grp.group.userData.home.clone() };
        this.carriedSlot = -1;
        this.sfx.tap();
        return;
      }
    }
    const placed = this.raycaster.intersectObjects(this.buildStation.cake.berryGroups(), true);
    if (placed.length) {
      let o: THREE.Object3D | null = placed[0].object;
      while (o && !o.name.startsWith('berry-')) o = o.parent;
      if (o) this.downHitBerrySlot = Number(o.name.split('-')[1]);
    }
  }

  private findTray(obj: THREE.Object3D) {
    for (const t of this.trayBerries) {
      let o: THREE.Object3D | null = obj;
      while (o) {
        if (o === t.group) return t;
        o = o.parent;
      }
    }
    return null;
  }

  private dragBerry(d: DragState) {
    if (!this.carried) return;
    const st = this.buildStation;
    const y = st.cakeY + CAKE.filling.y0 + CAKE.skim;
    const hit = this.planePoint(d, y, 0.06);
    if (!hit) return;
    const local = hit.clone().sub(st.origin);
    // Forgiving for small hands: anywhere on the cake finds the nearest free dip.
    const overCake = Math.hypot(local.x, local.z) < CAKE.radius + 2.5;
    let best = -1;
    let bestD = overCake ? Infinity : 5.6;
    for (const slot of SLOTS) {
      if (st.cake.hasSlot(slot.index)) continue;
      const dx = local.x - Math.cos(slot.angle) * slot.radius;
      const dz = local.z - Math.sin(slot.angle) * slot.radius;
      const dist = Math.hypot(dx, dz);
      if (dist < bestD) {
        bestD = dist;
        best = slot.index;
      }
    }
    this.carriedSlot = best;
    if (best >= 0) {
      const slot = SLOTS[best];
      this.carried.group.position.set(
        st.origin.x + Math.cos(slot.angle) * slot.radius,
        y + 1.5,
        st.origin.z + Math.sin(slot.angle) * slot.radius
      );
      this.carried.group.rotation.set(-Math.PI / 2, 0, -slot.angle);
    } else {
      this.carried.group.position.set(hit.x, y + 2.4, hit.z);
      this.carried.group.rotation.set(-Math.PI / 2, 0, 0);
    }
  }

  private dropBerry() {
    if (!this.carried) {
      if (this.downHitBerrySlot >= 0) this.cyclePose(this.downHitBerrySlot);
      return;
    }
    const st = this.buildStation;
    if (this.carriedSlot >= 0 && !st.cake.hasSlot(this.carriedSlot)) {
      const p = this.carried.placement;
      p.slot = this.carriedSlot;
      st.cake.addBerry(p);
      this.trayBerries = this.trayBerries.filter((t) => t.group !== this.carried!.group);
      this.scene.remove(this.carried.group);
      this.sfx.place();
      if (st.cake.placedCount === 1) this.hud.setHint('とんとん すると むきが かわる');
      if (st.cake.placedCount >= SLOTS.length) {
        this.hud.setHint('');
        this.timeline.wait(0.7, () => this.setPhase('fill'));
      }
    } else {
      this.carried.group.position.copy(this.carried.home);
      this.carried.group.rotation.set(-Math.PI / 2, 0, 0);
    }
    this.carried = null;
    this.carriedSlot = -1;
  }

  private cyclePose(slot: number) {
    const cake = this.buildStation.cake;
    const node = cake.design.placements.find((p) => p.slot === slot);
    if (!node) return;
    const i = POSE_LIST.indexOf(node.pose);
    const next: Pose = POSE_LIST[(i + 1) % POSE_LIST.length];
    cake.setPose(slot, next);
    this.sfx.tap();
  }

  private movePiping(d: DragState) {
    const st = this.buildStation;
    const y = st.cakeY + st.cake.fillSurfaceY;
    // The nozzle sits above the finger so the point being filled stays visible.
    const hit = this.planePoint(d, y, 0.1);
    if (!hit) return;
    const local = hit.clone().sub(st.origin);
    const r = Math.hypot(local.x, local.z);
    if (r > CAKE.coreRadius) {
      local.multiplyScalar(CAKE.coreRadius / r);
    }
    this.piping.group.position.set(st.origin.x + local.x, y + 1.75, st.origin.z + local.z);
    this.piping.group.rotation.set(0.22, 0, -0.16);
    if (!this.pointer.down) return;
    const here = new THREE.Vector2(local.x, local.z);
    if (here.distanceTo(this.pipeLast) > 1.1) {
      this.pipeLast.copy(here);
      st.cake.pipeBlob(local.x, local.z, this.rng);
      st.cake.setFill(Math.min(1, st.cake.fill + 0.055));
      this.reseat(st);
    }
    if (st.cake.fill >= 0.995) {
      this.hud.setHint('');
    }
  }

  private reseat(st: Station) {
    const f = st.cake.fill;
    st.cake.setBerrySink(() => (1 - Math.min(1, f * 1.15)) * 0.16);
  }

  private advanceToLid() {
    this.sfx.pipeStop();
    this.piping.group.visible = false;
    this.setPhase('lid');
    const st = this.buildStation;
    const lid = st.cake.addTopSponge();
    lid.position.set(-13, CAKE.sponge2.y0 + 5.5, 6);
    lid.rotation.z = 0.16;
  }

  private dropLid(d: DragState) {
    const st = this.buildStation;
    const lid = st.cake.topSponge;
    const hit = this.planePoint(d, st.cakeY + CAKE.sponge2.y0 + 4.5, 0.08);
    const local = hit ? hit.sub(st.origin) : null;
    const overCake = !!local && Math.hypot(local.x, local.z) < CAKE.radius + 3;
    if (!overCake) {
      // Left short of the cake: send it back to wait beside the turntable.
      lid.position.set(-13, CAKE.sponge2.y0 + 5.5, 6);
      lid.rotation.z = 0.16;
      return;
    }
    this.busy = true;
    const from = lid.position.clone();
    const fromRot = lid.rotation.z;
    this.sfx.place();
    this.timeline.add(0.45, (k) => {
      const e = easeOut(k);
      lid.position.set(from.x * (1 - e), CAKE.sponge2.y0 + (from.y - CAKE.sponge2.y0) * (1 - e), from.z * (1 - e));
      lid.rotation.z = fromRot * (1 - e);
    }, 0, () => {
      // The weight of the sponge compresses cream and berries a little.
      this.sfx.settle();
      this.timeline.add(0.5, (k) => {
        const squash = Math.sin(k * Math.PI) * 0.035;
        st.cake.setFill(1 - squash);
        st.cake.setBerrySink(() => squash * 1.6);
      }, 0, () => {
        st.cake.setFill(0.985);
        st.cake.setBerrySink(() => 0.02);
        this.busy = false;
        this.startCoating();
      });
    });
  }

  private startCoating() {
    const st = this.buildStation;
    this.setPhase('coat');
    this.busy = true;
    const dimples = st.cake.body.getObjectByName('dimples');
    if (dimples) dimples.visible = false;
    this.paletteKnife.visible = true;
    const spin0 = st.plateAngle;
    this.sfx.spread();
    this.timeline.add(1.15, (k) => {
      st.cake.setCoat(k, 0);
      st.plateAngle = spin0 + k * Math.PI * 2.1;
      this.placePalette(st, 0.35 + k * 0.2, k);
    }, 0.2, () => {
      this.sfx.spread();
      this.timeline.add(1.5, (k) => {
        st.cake.setCoat(1, k);
        st.plateAngle = spin0 + Math.PI * 2.1 + k * Math.PI * 2.3;
        this.placePalette(st, 0.55 + k * 0.35, k);
      }, 0.05, () => {
        this.paletteKnife.visible = false;
        st.cake.addDecoration(1000 + this.round * 13);
        this.sfx.place();
        st.plateAngle = 0;
        this.timeline.wait(0.7, () => {
          this.busy = false;
          this.setPhase('aim');
        });
      });
    });
  }

  private placePalette(st: Station, height: number, k: number) {
    const ang = -0.55 + Math.sin(k * Math.PI) * 0.2;
    const r = CAKE.radius + 1.5;
    this.paletteKnife.position.set(
      st.origin.x + Math.cos(ang) * r,
      st.cakeY + CAKE.topCoat.y1 * height,
      st.origin.z + Math.sin(ang) * r
    );
    this.paletteKnife.rotation.set(0, -ang + Math.PI / 2, Math.PI / 2 - 0.25);
  }

  private aimDrag(d: DragState) {
    const st = this.buildStation;
    const hit = this.planePoint(d, st.cakeY + CAKE.topCoat.y1);
    if (!hit) return;
    const local = hit.clone().sub(st.origin);
    if (Math.hypot(local.x, local.z) < 1.5) return;
    const raw = Math.atan2(local.z, local.x);
    const step = (Math.PI * 2) / CAKE.cutSteps;
    const snapped = Math.round(raw / step) * step;
    if (Math.abs(snapped - this.aimAngle) > 1e-4) this.sfx.tap();
    this.aimAngle = snapped;
  }

  private armCut(d: DragState) {
    if (Math.hypot(d.dx, d.dy) < 0.02) return;
    this.busy = true;
    this.timeline.wait(0.55, () => {
      this.busy = false;
      this.setPhase('cutNew');
    });
  }

  /* -------------------------------------------------------------- restart */

  private restart() {
    this.round++;
    const st = this.buildStation;
    st.cake.dispose();
    const cake = new Cake(this.mats, { placements: [], fill: 0 });
    cake.root.position.y = st.cakeY;
    st.plate.add(cake.root);
    st.cake = cake;
    st.plateAngle = 0;
    st.server.visible = false;
    this.servedProgress = 0;
    cake.buildBoardAndBase();
    cake.buildCoat();
    cake.setCoat(0, 0);
    cake.setFill(0);
    this.addDimples(cake);
    for (const t of this.trayBerries) {
      t.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      this.scene.remove(t.group);
    }
    this.trayBerries = [];
    this.makeTray();
    this.setPhase('place');
  }

  /* --------------------------------------------------------------- crumbs */

  private spawnCrumbs(st: Station) {
    const ang = this.cutWorldAngle(st);
    const r = CAKE.radius * (1 - this.cutProgress * 0.9);
    for (let i = 0; i < 2; i++) {
      if (this.crumbs.length >= Game.MAX_CRUMBS) this.crumbs.shift();
      this.crumbs.push({
        pos: new THREE.Vector3(
          st.origin.x + Math.cos(ang) * r + this.rng.range(-0.4, 0.4),
          st.cakeY + CAKE.topCoat.y1,
          st.origin.z + Math.sin(ang) * r + this.rng.range(-0.4, 0.4)
        ),
        vel: new THREE.Vector3(this.rng.range(-1.4, 1.4), this.rng.range(0.4, 2.2), this.rng.range(-1.4, 1.4)),
        rot: new THREE.Euler(this.rng.range(0, 3), this.rng.range(0, 3), this.rng.range(0, 3)),
        spin: new THREE.Vector3(this.rng.range(-6, 6), this.rng.range(-6, 6), this.rng.range(-6, 6)),
        scale: this.rng.range(0.55, 1.15),
        life: 0,
      });
    }
  }

  /* ---------------------------------------------------------------- frame */

  update(dt: number, w: number, h: number) {
    this.phaseTime += dt;
    this.clock += dt;
    this.timeline.update(dt);

    for (const st of [this.cutStation, this.buildStation]) {
      st.plate.rotation.y = st.plateAngle;
      st.cake.updateClipping();
    }

    this.updateKnife(dt);
    this.updateWedge(dt);
    this.updateCrumbs(dt);
    this.updateCue();

    if (this.phase === 'aim') {
      this.buildStation.cake.setScore(this.aimAngle, 1, 'guide');
      this.buildStation.guide.group.position.set(
        STATION.build.x + Math.cos(this.aimAngle) * 26,
        0,
        STATION.build.z + Math.sin(this.aimAngle) * 26
      );
      this.buildStation.guide.group.rotation.y = -this.aimAngle;
    }

    this.rig.update(dt);
    this.hud.update(this.rig.camera, w, h);
  }

  private updateKnife(dt: number) {
    for (const st of [this.cutStation, this.buildStation]) {
      if (!st.knife.visible) continue;
      const p = this.cutProgress;
      const rTip = 8.6 - p * 8.6;
      const yEdge = st.cakeY + CAKE.topCoat.y1 + 1.6 - p * (CAKE.topCoat.y1 + 2.0);
      const tipX = -(26 - rTip);
      // Blade tilted so the handle end stays above the cake and stays readable.
      const tilt = -0.2 + 0.06 * p;
      st.knife.position.set(tipX + 22, yEdge, 0);
      st.knife.rotation.set(0, Math.PI, tilt);
      st.guide.carriage.position.x = damp(st.guide.carriage.position.x, tipX + 11.5, 20, dt);
      const drop = Math.max(0.6, st.guide.carriage.position.y - (yEdge + 2.6));
      st.guide.stem.scale.y = drop;
      st.cake.setScore(this.cutWorldAngle(st) + st.plateAngle, p, st.scoreKind);
    }
  }

  private updateWedge(_dt: number) {
    for (const st of [this.cutStation, this.buildStation]) {
      if (!st.cake.isSplit) continue;
      const p = this.servedProgress;
      const e = easeOut(p);
      const localBis = st.cake.cutAngle + WEDGE / 2;
      // Straight out along the bisector first, so the slice never grinds
      // through the rest of the cake, then forward to the viewer.
      const t = Math.min(1, p / 0.72);
      const out = 0.05 + 8.6 * t * t * (3 - 2 * t);
      const forward = 5.2 * easeOut(Math.max(0, (p - 0.5) / 0.5));
      const lift = 1.15 * Math.sin(Math.PI * Math.min(1, p * 1.3)) + 0.5 * e;
      const towardViewer = Math.PI / 2 + st.plateAngle;
      st.cake.wedge.position.set(
        Math.cos(localBis) * out + Math.cos(towardViewer) * forward,
        lift,
        Math.sin(localBis) * out + Math.sin(towardViewer) * forward
      );
      st.cake.wedge.rotation.y = -0.16 * e;
      st.cake.wedge.rotation.z = 0.035 * Math.sin(p * Math.PI);

      const worldBis = localBis - st.plateAngle;
      const hub = st.cake.wedge.getWorldPosition(new THREE.Vector3());
      st.server.visible = p > 0.001 && this.activeStation() === st;
      st.server.position.set(
        hub.x + Math.cos(worldBis) * 8.9,
        st.cakeY + lift - 0.34 - e * 0.22,
        hub.z + Math.sin(worldBis) * 8.9
      );
      st.server.rotation.set(0, Math.PI - worldBis, -0.03 - e * 0.04);
    }
  }

  private updateCrumbs(dt: number) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    for (let i = this.crumbs.length - 1; i >= 0; i--) {
      const c = this.crumbs[i];
      c.life += dt;
      c.vel.y -= 55 * dt;
      c.pos.addScaledVector(c.vel, dt);
      c.rot.x += c.spin.x * dt;
      c.rot.y += c.spin.y * dt;
      const floor = 5.2;
      if (c.pos.y < floor) {
        c.pos.y = floor;
        c.vel.multiplyScalar(0.24);
        c.vel.y = Math.abs(c.vel.y) * 0.24;
        c.spin.multiplyScalar(0.4);
      }
      if (c.life > 16) this.crumbs.splice(i, 1);
    }
    for (let i = 0; i < this.crumbs.length; i++) {
      const c = this.crumbs[i];
      q.setFromEuler(c.rot);
      sc.setScalar(c.scale);
      m.compose(c.pos, q, sc);
      this.crumbMesh.setMatrixAt(i, m);
    }
    this.crumbMesh.count = this.crumbs.length;
    this.crumbMesh.instanceMatrix.needsUpdate = true;
  }

  private updateCue() {
    const st = this.activeStation();
    switch (this.phase) {
      case 'intro':
        this.hud.setCue('tap', new THREE.Vector3(0, this.cutStation.cakeY + CAKE.topCoat.y1 + 2.4, 0));
        break;
      case 'cut1':
      case 'cut2':
      case 'cutNew': {
        if (this.pointer.down) {
          this.hud.hideCue();
          break;
        }
        const ang = this.cutWorldAngle(st);
        const anchor = new THREE.Vector3(
          st.origin.x + Math.cos(ang) * (CAKE.radius + 1.4),
          st.cakeY + CAKE.topCoat.y1 + 1.6,
          st.origin.z + Math.sin(ang) * (CAKE.radius + 1.4)
        );
        const dir = this.cutScreenDir(st, ang);
        this.hud.setCue('swipe', anchor, Math.atan2(-dir.y, dir.x));
        break;
      }
      case 'turn':
        this.hud.setCue(this.pointer.down ? 'none' : 'drag', new THREE.Vector3(0, this.cutStation.cakeY - 0.6, CAKE.boardRadius + 1.6), 0);
        break;
      case 'serve':
      case 'serveNew': {
        if (this.pointer.down) {
          this.hud.hideCue();
          break;
        }
        const bis = (st === this.cutStation ? 0 : this.aimAngle) + WEDGE / 2 - st.plateAngle;
        this.hud.setCue('swipe', new THREE.Vector3(
          st.origin.x + Math.cos(bis) * 5,
          st.cakeY + 2.4,
          st.origin.z + Math.sin(bis) * 5
        ), Math.PI / 2);
        break;
      }
      case 'place': {
        if (this.carried || this.pointer.down) {
          this.hud.hideCue();
          break;
        }
        const next = this.trayBerries[0];
        if (next) this.hud.setCue('drag', next.group.position.clone().setY(next.group.position.y + 1.6), -1.35);
        break;
      }
      case 'fill':
        this.hud.setCue(this.pointer.down ? 'none' : 'circle', new THREE.Vector3(STATION.build.x, this.buildStation.cakeY + CAKE.filling.y0 + 1.5, 0));
        break;
      case 'lid':
        if (!this.pointer.down) {
          this.hud.setCue('drag', new THREE.Vector3(STATION.build.x - 13, this.buildStation.cakeY + CAKE.sponge2.y0 + 7.5, 6), 0.15);
        } else this.hud.hideCue();
        break;
      case 'aim':
        this.hud.setCue(this.pointer.down ? 'none' : 'circle', new THREE.Vector3(STATION.build.x, this.buildStation.cakeY + CAKE.topCoat.y1 + 1.2, 0));
        break;
      default:
        this.hud.hideCue();
        break;
    }
  }

  /** Drag of the top sponge is handled here so it can share the pointer. */
  handleLidDrag(d: DragState) {
    if (this.phase !== 'lid' || this.busy) return;
    const st = this.buildStation;
    const lid = st.cake.topSponge;
    const hit = this.planePoint(d, st.cakeY + CAKE.sponge2.y0 + 4.5, 0.08);
    if (!hit) return;
    const local = hit.clone().sub(st.origin);
    const dist = Math.hypot(local.x, local.z);
    if (dist < 3.4) {
      lid.position.set(local.x * 0.25, CAKE.sponge2.y0 + 3.0, local.z * 0.25);
    } else {
      lid.position.set(local.x, CAKE.sponge2.y0 + 4.5, local.z);
    }
    lid.rotation.z = damp(lid.rotation.z, 0, 8, 0.016);
  }

  get currentPhase() {
    return this.phase;
  }

  /** Read-only snapshot used by the automated play-through harness. */
  get snapshot() {
    return {
      phase: this.phase,
      busy: this.busy,
      cut: this.cutProgress,
      served: this.servedProgress,
      plate: this.cutStation.plateAngle,
      placed: this.buildStation.cake.placedCount,
      fill: this.buildStation.cake.fill,
      clock: this.clock,
    };
  }

  get aimDirection(): number {
    return this.aimAngle;
  }

  get trayAnchors(): THREE.Vector3[] {
    return this.trayBerries.map((t) => t.group.position.clone());
  }
}
