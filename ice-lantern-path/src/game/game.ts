import * as THREE from 'three';
import { Engine } from '../core/engine';
import { PointerInput, raycast, rayOnPlane } from '../core/input';
import { Tweener, ease } from '../core/tween';
import { audio } from '../core/audio';
import { Hud } from '../ui/hud';
import { Shed, SHELF_POS, SHELF_Y } from '../world/shed';
import {
  buildBerry,
  buildCloth,
  buildGloves,
  buildInnerMold,
  buildLed,
  buildOuterMold,
  buildPetal,
  buildPitcher,
  buildSprig,
  buildTray,
  type InnerMold,
  type Led,
  type OuterMold,
  type Pitcher,
} from '../world/props';
import { contactShadow } from '../world/materials';
import { WaterRig } from '../ice/water';
import { IceLantern } from '../ice/lantern';
import { BENCH_Y, D } from '../ice/dims';
import { MOLD_POS, SHOTS } from './shots';
import { PathScene, type Design } from './path';

export type Phase =
  | 'intro'
  | 'assemble'
  | 'decorate'
  | 'fill'
  | 'shelve'
  | 'freeze'
  | 'warm'
  | 'pullInner'
  | 'pullOuter'
  | 'led'
  | 'lit'
  | 'carry'
  | 'finale'
  | 'done';

interface DecorItem {
  obj: THREE.Group;
  kind: string;
  home: THREE.Vector3;
  placed: boolean;
  floatTarget: number;
  radius: number;
  theta: number;
}

const DECOR_SLOTS: Array<[number, number]> = [
  [-0.052, 0.03],
  [-0.014, 0.032],
  [0.024, 0.03],
  [-0.05, -0.03],
  [0.005, -0.034],
  [0.062, -0.022],
];

const DECOR_MIN_R = 0.11;
const DECOR_MAX_R = 0.134;
const CARRY_LIFT = 0.1;

export class Game {
  engine: Engine;
  hud: Hud;
  pointer: PointerInput;
  tween = new Tweener();
  shed: Shed;
  phase: Phase = 'intro';
  round = 1;

  moldRig = new THREE.Group();
  outer!: OuterMold;
  inner!: InnerMold;
  water!: WaterRig;
  ice: IceLantern | null = null;
  pitcher!: Pitcher;
  led!: Led;
  tray!: THREE.Group;
  cloth!: THREE.Group;
  cover!: THREE.Mesh;
  decor: DecorItem[] = [];
  designs: Design[] = [];
  finished: THREE.Group[] = [];
  path: PathScene | null = null;

  private drag: {
    obj: THREE.Object3D;
    kind: string;
    offset: THREE.Vector3;
    planeY: number;
    home: THREE.Vector3;
    homeParent: THREE.Object3D;
  } | null = null;
  private gesture: { kind: string; twisted: number; pulled: boolean; tries: number } | null = null;
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private idleNudged = false;
  private pouring = false;
  private pendingPour = 0;
  /** capture-harness only: hold the pour mid way so it can be photographed */
  private devFillCap = 0;
  private pourHold = 0;
  private freezeT = 0;
  private freezeDur = 10;
  private placedCount = 0;
  private ledSeated = false;
  private lanternLight: THREE.PointLight;
  private snowGlow: THREE.Mesh;
  private busy = false;
  private waterHidden = false;
  private freezeEnded = false;

  constructor(engine: Engine, hud: Hud) {
    this.engine = engine;
    this.hud = hud;
    this.shed = new Shed();
    engine.scene.add(this.shed.group);

    const q = engine.quality.settings;

    this.moldRig.position.copy(MOLD_POS);
    engine.scene.add(this.moldRig);

    this.water = new WaterRig(60, q.bubbleCount);
    this.pitcher = buildPitcher(this.water.surfMat);
    this.led = buildLed();
    this.tray = buildTray();
    this.cloth = buildCloth();

    // windproof cover on the freezing shelf
    const coverMat = new THREE.MeshPhysicalMaterial({
      color: 0xd6e6ee,
      transparent: true,
      opacity: 0.3,
      roughness: 0.18,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      clearcoat: 0.6,
    });
    // cold frame lid, hinged along the back top edge
    this.cover = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.012, 0.64), coverMat);
    this.cover.renderOrder = 22;
    this.cover.geometry.translate(0, 0, 0.32);
    this.cover.position.set(SHELF_POS.x, SHELF_Y + 0.4, SHELF_POS.z - 0.31);
    this.cover.rotation.x = -1.25;
    engine.scene.add(this.cover);

    this.lanternLight = new THREE.PointLight(0xffb066, 0, 1.15, 2);
    engine.scene.add(this.lanternLight);

    this.snowGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.62),
      new THREE.MeshBasicMaterial({
        color: 0xffb066,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
    );
    this.snowGlow.rotation.x = -Math.PI / 2;
    this.snowGlow.renderOrder = 5;
    engine.scene.add(this.snowGlow);

    const gloves = buildGloves();
    gloves.rotation.y = 0.4;
    engine.scene.add(gloves);
    this.glovesGroup = gloves;

    this.buildRound(true);
    this.applyLayout(true);

    this.pointer = new PointerInput(engine.canvas);
    this.pointer.onDown = (p) => this.onDown(p.nx, p.ny);
    this.pointer.onMove = (p) => this.onMove(p.nx, p.ny, p.dx, p.dy);
    this.pointer.onUp = (p) => this.onUp(p.dx, p.dy, p.moved);

    engine.onUpdate = (dt, t) => this.update(dt, t);
    engine.onResize = () => this.applyLayout(true);
    engine.quality.onChange((s) => {
      this.water.setActiveBubbles(s.bubbleCount);
      this.ice?.setTransmission(s.transmission);
      hud.setNote(`${s.name}·${s.step}`);
    });
    hud.setNote(`${q.name}·${q.step}`);

    this.setPhase('intro');
  }

  // ---------------------------------------------------------------- setup

  private buildRound(first: boolean) {
    const q = this.engine.quality.settings;
    this.outer = buildOuterMold();
    this.moldRig.add(this.outer.group);

    this.inner = buildInnerMold();
    this.inner.group.position.copy(this.spots(this.engine.rig.portrait).inner);
    this.moldRig.add(this.inner.group);
    const innerShadow = contactShadow(0.14, 0.22);
    innerShadow.position.y = 0.003;
    this.inner.group.add(innerShadow);
    this.inner.group.userData.shadowDecal = innerShadow;

    this.water.setLevel(0);
    this.water.hideBubbles();
    this.water.setActiveBubbles(q.bubbleCount);
    this.moldRig.add(this.water.group);
    if (!this.water.streamMesh.parent) this.engine.scene.add(this.water.streamMesh);

    this.decor = [];
    this.placedCount = 0;
    const wanted = this.round === 1 ? 6 : 4;
    const kinds: string[] = this.round === 1
      ? ['berry', 'berry', 'berry', 'sprig', 'sprig', 'petal']
      : ['berry', 'berry', 'sprig', 'petal'];
    for (let i = 0; i < wanted; i++) {
      const kind = kinds[i];
      const obj = kind === 'berry' ? buildBerry() : kind === 'sprig' ? buildSprig(i + this.round) : buildPetal();
      const [ox, oz] = DECOR_SLOTS[i % DECOR_SLOTS.length];
      const home = new THREE.Vector3(0.38 + ox, BENCH_Y + 0.019 + (kind === 'berry' ? 0.011 : 0.003), 0.18 + oz);
      if (kind === 'petal') obj.rotation.set(-Math.PI / 2 + 0.2, i * 1.1, 0);
      if (kind === 'sprig') obj.rotation.y = i * 0.8;
      this.engine.scene.add(obj);
      obj.position.copy(home);
      this.decor.push({
        obj,
        kind,
        home: obj.position.clone(),
        placed: false,
        floatTarget: 0,
        radius: 0,
        theta: 0,
      });
    }

    if (first) {
      this.pitcher.setLevel(1);
      this.engine.scene.add(this.pitcher.group);
      this.engine.scene.add(this.tray);
      this.led.setOn(0);
      this.engine.scene.add(this.led.group);
      this.engine.scene.add(this.cloth);
    } else {
      this.pitcher.setLevel(1);
      this.pitcher.group.rotation.set(0, 0, 0);
      this.led.setOn(0);
      this.led.group.rotation.set(0, 0, 0);
    }
    this.pitcher.group.userData.locked = false;
    this.ledSeated = false;
    this.ice = null;
    this.moldRig.position.copy(MOLD_POS);
    this.outer.group.position.set(0, 0, 0);
    this.outer.group.rotation.set(0, 0, 0);
    this.outer.group.visible = true;
  }

  // ---------------------------------------------------------------- layout

  /**
   * Portrait frames reward depth, landscape frames reward lateral spread, so
   * the tools move between a "in front of the mould" and a "beside the mould"
   * arrangement. Everything stays reachable and on screen either way.
   */
  private spots(portrait: boolean) {
    return portrait
      ? {
          tray: new THREE.Vector3(0.19, BENCH_Y, 0.31),
          pitcher: new THREE.Vector3(-0.22, BENCH_Y, 0.31),
          pitcherNear: new THREE.Vector3(-0.17, BENCH_Y, 0.3),
          led: new THREE.Vector3(0.2, BENCH_Y, 0.3),
          ledNear: new THREE.Vector3(0.17, BENCH_Y, 0.28),
          gloves: new THREE.Vector3(-0.66, BENCH_Y, -0.2),
          cloth: new THREE.Vector3(-0.42, BENCH_Y, -0.3),
          inner: new THREE.Vector3(-0.19, 0.001, 0.25),
        }
      : {
          tray: new THREE.Vector3(0.4, BENCH_Y, 0.11),
          pitcher: new THREE.Vector3(-0.52, BENCH_Y, 0.22),
          pitcherNear: new THREE.Vector3(-0.36, BENCH_Y, 0.17),
          led: new THREE.Vector3(0.66, BENCH_Y, 0.04),
          ledNear: new THREE.Vector3(0.34, BENCH_Y, 0.13),
          gloves: new THREE.Vector3(-0.84, BENCH_Y, -0.1),
          cloth: new THREE.Vector3(-0.56, BENCH_Y, -0.26),
          inner: new THREE.Vector3(-0.3, 0.001, 0.2),
        };
  }

  private layoutPortrait: boolean | null = null;
  private glovesGroup: THREE.Group | null = null;

  /** screen-anchored bench position, clamped to the bench top */
  private anchor(ndcX: number, ndcY: number, out = new THREE.Vector3()) {
    this.engine.rig.planePointForScreen(ndcX, ndcY, BENCH_Y, out);
    // a wide frame would put the anchor off the bench entirely, so keep every
    // tool within arm's reach of the mould as well as on the bench
    const dx = out.x - MOLD_POS.x;
    const dz = out.z - MOLD_POS.z;
    const d = Math.hypot(dx, dz);
    const max = 0.46;
    if (d > max) {
      out.x = MOLD_POS.x + (dx / d) * max;
      out.z = MOLD_POS.z + (dz / d) * max;
    }
    out.x = THREE.MathUtils.clamp(out.x, -0.95, 0.95);
    out.z = THREE.MathUtils.clamp(out.z, -0.34, 0.38);
    out.y = BENCH_Y;
    return out;
  }

  /** Anchors for the tool each beat needs, in frame coordinates. */
  private toolAnchor(phase: Phase, out = new THREE.Vector3()) {
    switch (phase) {
      case 'assemble':
        return this.anchor(-0.52, -0.5, out);
      case 'decorate':
        return this.anchor(0.5, -0.52, out);
      case 'fill':
        return this.anchor(-0.5, -0.46, out);
      case 'led':
        return this.anchor(0.46, -0.5, out);
      default:
        return out.set(0, BENCH_Y, 0.2);
    }
  }

  private applyLayout(force: boolean) {
    const portrait = this.engine.rig.portrait;
    if (!force && portrait === this.layoutPortrait) return;
    this.layoutPortrait = portrait;
    const s = this.spots(portrait);
    if (this.phase === 'decorate') this.toolAnchor('decorate', s.tray);
    this.tray.position.copy(s.tray);
    for (let i = 0; i < this.decor.length; i++) {
      const d = this.decor[i];
      const [ox, oz] = DECOR_SLOTS[i % DECOR_SLOTS.length];
      const home = new THREE.Vector3(
        s.tray.x + ox,
        BENCH_Y + 0.019 + (d.kind === 'berry' ? 0.011 : 0.003),
        s.tray.z + oz
      );
      d.home.copy(home);
      if (!d.placed && this.drag?.obj !== d.obj) d.obj.position.copy(home);
    }
    if (this.glovesGroup) this.glovesGroup.position.copy(s.gloves);
    if (this.phase !== 'warm') this.cloth.position.copy(s.cloth);
    if (!this.pitcher.group.userData.locked && this.drag?.obj !== this.pitcher.group) {
      this.pitcher.group.position.copy(this.phase === 'fill' ? this.toolAnchor('fill') : s.pitcher);
    }
    if (!this.ledSeated && this.drag?.obj !== this.led.group) {
      this.led.group.position.copy(this.phase === 'led' ? this.toolAnchor('led') : s.led);
    }
    if (this.phase === 'assemble' && this.drag?.obj !== this.inner.group) {
      const a = this.toolAnchor('assemble');
      this.inner.group.position.set(a.x - MOLD_POS.x, 0.001, a.z - MOLD_POS.z);
    }
  }

  // ---------------------------------------------------------------- phases

  setPhase(p: Phase) {
    this.phase = p;
    this.idleNudged = false;
    this.pointer.poke();
    this.hud.button(null);
    this.hud.button2(null);
    this.hud.hideHint();
    const shot = SHOTS[p === 'warm' ? 'pullInner' : p === 'done' ? 'finale' : p];
    if (shot) this.engine.rig.setShot(shot);

    const step = (n: number, total = 7) => this.hud.setStep(`${n} / ${total}`);

    switch (p) {
      case 'intro':
        this.hud.setStep('');
        this.hud.say('こおりの ランタンを つくろう');
        this.hud.button('はじめる', () => {
          audio.unlock();
          this.setPhase('assemble');
        });
        break;
      case 'assemble':
        step(1);
        this.hud.say('うちがたを そとがたの まんなかへ');
        this.layoutPortrait = null;
        this.applyLayout(true);
        break;
      case 'decorate':
        step(2);
        this.hud.say('あかい み と はっぱを すきまへ');
        this.layoutPortrait = null;
        this.applyLayout(true);
        break;
      case 'fill':
        step(3);
        this.hud.say('みずさしを もって おみずを いれてね');
        this.presentTool(this.pitcher.group, this.toolAnchor('fill'));
        break;
      case 'shelve':
        step(4);
        this.hud.say('かたを こおらせだなへ すべらせてね');
        break;
      case 'freeze':
        step(4);
        this.hud.say('こおって いくよ…');
        this.hud.setStep('');
        break;
      case 'warm':
        step(5);
        this.hud.say('あたたかい ぬのを あてるよ');
        break;
      case 'pullInner':
        step(5);
        this.hud.say('うちがたを まわして うえへ ひっぱってね');
        break;
      case 'pullOuter':
        step(6);
        this.hud.say('とってを もって うえへ ひっぱってね');
        break;
      case 'led':
        step(7);
        this.hud.say('ライトを なかへ いれてね');
        this.presentTool(this.led.group, this.toolAnchor('led'));
        break;
      case 'lit':
        this.hud.setStep('');
        this.hud.say('ついた！ きれいだね');
        this.hud.button('ゆきみちへ', () => this.startCarry());
        if (this.round < 3) this.hud.button2('もうひとつ', () => this.nextRound());
        break;
      case 'carry':
        this.hud.setStep('');
        this.hud.say('そりで ゆきみちへ はこぶよ');
        break;
      case 'finale':
        this.hud.setStep('');
        this.hud.say('スイッチを よこへ すべらせてね');
        break;
      case 'done':
        this.hud.say('ぜんぶ ついたね');
        this.hud.button('もういちど', () => this.restart());
        break;
    }
  }

  /** slides a tool into reach when its beat begins */
  private presentTool(obj: THREE.Object3D, to: THREE.Vector3) {
    const from = obj.position.clone();
    if (from.distanceTo(to) < 0.02) return;
    this.tween.add(0.75, (k) => {
      obj.position.lerpVectors(from, to, k);
      obj.position.y += Math.sin(k * Math.PI) * 0.03;
    }, { ease: ease.inOut, done: () => obj.position.copy(to) });
  }

  // ---------------------------------------------------------------- input

  private hitTest(nx: number, ny: number, objs: THREE.Object3D[]) {
    const hits = raycast(this.engine.rig.camera, nx, ny, objs.filter((o) => o.visible));
    if (!hits.length) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && !o.userData.grab) o = o.parent;
    return o ? { root: o, point: hits[0].point } : { root: hits[0].object, point: hits[0].point };
  }

  private draggables(): THREE.Object3D[] {
    switch (this.phase) {
      case 'assemble':
        return [this.inner.group];
      case 'decorate':
        return this.decor.filter((d) => !d.placed).map((d) => d.obj);
      case 'fill':
        return [this.pitcher.group];
      case 'led':
        return [this.led.group];
      default:
        return [];
    }
  }

  private startDrag(root: THREE.Object3D, kind: string, nx: number, ny: number) {
    const planeY = root.getWorldPosition(this.tmp).y + CARRY_LIFT;
    this.plane.constant = -planeY;
    const p = rayOnPlane(this.engine.rig.camera, nx, ny, this.plane, this.tmp2);
    const home = root.position.clone();
    const world = root.getWorldPosition(new THREE.Vector3());
    this.drag = {
      obj: root,
      kind,
      planeY,
      offset: p ? world.clone().sub(p) : new THREE.Vector3(),
      home,
      homeParent: root.parent!,
    };
    // carry it clear of the finger
    this.drag.offset.y += CARRY_LIFT;
    audio.unlock();
  }

  private onDown(nx: number, ny: number) {
    if (this.busy) return;
    audio.unlock();
    this.idleNudged = false;

    if (this.phase === 'finale') {
      this.path?.onDown(nx, ny, this.engine.rig.camera);
      return;
    }

    if (this.phase === 'fill') {
      if (this.pitcher.group.userData.locked) {
        this.pouring = true;
        return;
      }
      // a long press anywhere brings the pitcher over and starts the pour, so
      // a small hand can never get stuck on the drag
      const onPitcher = this.hitTest(nx, ny, [this.pitcher.group]);
      if (!onPitcher) {
        this.pendingPour = 0.001;
        return;
      }
    }

    if (this.phase === 'shelve') {
      const hit = this.hitTest(nx, ny, [this.outer.group, this.inner.group]);
      if (hit) this.gesture = { kind: 'shelve', twisted: 0, pulled: false, tries: 0 };
      return;
    }

    if (this.phase === 'pullInner' || this.phase === 'pullOuter') {
      const targets = this.phase === 'pullInner' ? [this.inner.group] : [this.outer.group];
      const hit = this.hitTest(nx, ny, targets);
      if (hit) this.gesture = { kind: this.phase, twisted: this.gesture?.twisted ?? 0, pulled: false, tries: this.gesture?.tries ?? 0 };
      return;
    }

    if (this.phase === 'lit' || this.phase === 'led') {
      const hit = this.hitTest(nx, ny, [this.led.group]);
      if (hit && this.ledSeated) {
        this.toggleLight();
        return;
      }
    }

    const list = this.draggables();
    const hit = this.hitTest(nx, ny, list);
    if (hit) this.startDrag(hit.root, (hit.root.userData.grab as string) ?? '', nx, ny);
  }

  private onMove(nx: number, ny: number, dx: number, dy: number) {
    if (this.busy) return;

    if (this.phase === 'finale') {
      this.path?.onMove(dx, dy);
      return;
    }

    if (this.gesture) {
      if (this.gesture.kind === 'pullInner') {
        const twist = THREE.MathUtils.clamp(dx / 260, -0.42, 0.42);
        if (!this.gesture.pulled) this.inner.group.rotation.y = twist;
        this.gesture.twisted = Math.max(this.gesture.twisted, Math.abs(twist));
        if (dy < -55 && !this.gesture.pulled) {
          this.gesture.pulled = true;
          if (this.gesture.twisted > 0.13 || this.gesture.tries >= 1) this.pullInner();
          else {
            this.gesture.tries++;
            this.resistInner();
          }
        }
      } else if (this.gesture.kind === 'shelve') {
        if ((dx > 55 || dy < -55) && !this.gesture.pulled) {
          this.gesture.pulled = true;
          this.gesture = null;
          this.trySlideToShelf();
        }
      } else if (this.gesture.kind === 'pullOuter') {
        if (dy < -60 && !this.gesture.pulled) {
          this.gesture.pulled = true;
          this.pullOuter();
        }
      }
      return;
    }

    if (!this.drag) return;
    this.plane.constant = -this.drag.planeY;
    const p = rayOnPlane(this.engine.rig.camera, nx, ny, this.plane, this.tmp2);
    if (!p) return;
    const world = p.clone().add(this.drag.offset);
    // keep everything on the bench and inside reach
    world.x = THREE.MathUtils.clamp(world.x, -1.0, 1.0);
    world.z = THREE.MathUtils.clamp(world.z, -0.42, 0.44);

    const snap = this.snapTargetFor(this.drag.kind, world);
    if (snap) {
      // snapping is judged on the bench plane only: how high the object is
      // being carried must never decide whether it lands
      const d = Math.hypot(world.x - snap.point.x, world.z - snap.point.z);
      if (d < snap.radius) {
        const k = 0.35 * (1 - d / snap.radius);
        world.x = THREE.MathUtils.lerp(world.x, snap.point.x, k);
        world.z = THREE.MathUtils.lerp(world.z, snap.point.z, k);
      }
    }
    const local = this.drag.obj.parent!.worldToLocal(world.clone());
    this.drag.obj.position.copy(local);
  }

  private onUp(_dx: number, dy: number, moved: boolean) {
    if (this.busy) return;

    if (this.phase === 'finale') {
      this.path?.onUp();
      return;
    }

    this.pendingPour = 0;
    if (this.pouring) {
      this.pouring = false;
      this.pourHold = 0;
      this.water.setPour(false, null, null);
      audio.pourStop();
      this.tween.add(0.5, (k) => {
        this.pitcher.group.rotation.z = -this.pitcherTilt * (1 - k);
      }, { tag: 'tilt' });
      return;
    }

    if (this.gesture) {
      const g = this.gesture;
      this.gesture = null;
      if (g.kind === 'pullInner' && !g.pulled) this.inner.group.rotation.y *= 0.5;
      if (g.kind === 'shelve' && !g.pulled && !moved) this.trySlideToShelf();
      return;
    }

    if (!this.drag) {
      return;
    }
    const d = this.drag;
    this.drag = null;
    const world = d.obj.getWorldPosition(new THREE.Vector3());
    world.y -= CARRY_LIFT;
    const snap = this.snapTargetFor(d.kind, world);
    if (snap && Math.hypot(world.x - snap.point.x, world.z - snap.point.z) < snap.radius) {
      snap.commit(d.obj, world);
    } else {
      // no failure: it simply goes back where it came from
      const target = d.home.clone();
      this.tween.add(0.35, (k) => {
        d.obj.position.lerpVectors(d.obj.position, target, k * 0.6 + 0.1);
      }, { ease: ease.out, done: () => d.obj.position.copy(target) });
    }
    void dy;
  }

  private pitcherTilt = 0;

  // ------------------------------------------------------------- snapping

  private snapTargetFor(kind: string, world: THREE.Vector3):
    | { point: THREE.Vector3; radius: number; commit: (obj: THREE.Object3D, w: THREE.Vector3) => void }
    | null {
    if (kind === 'inner' && this.phase === 'assemble') {
      const point = this.moldRig.localToWorld(new THREE.Vector3(0, D.cavityFloor, 0));
      return { point, radius: 0.13, commit: () => this.seatInner() };
    }
    if (kind === 'decor' && this.phase === 'decorate') {
      const local = this.moldRig.worldToLocal(world.clone());
      const r = Math.hypot(local.x, local.z);
      const th = Math.atan2(local.z, local.x);
      const rr = THREE.MathUtils.clamp(r, DECOR_MIN_R, DECOR_MAX_R);
      const point = this.moldRig.localToWorld(new THREE.Vector3(Math.cos(th) * rr, D.outerFloor + 0.012, Math.sin(th) * rr));
      return { point, radius: 0.15, commit: (obj, w) => this.placeDecor(obj, w) };
    }
    if (kind === 'pitcher' && this.phase === 'fill') {
      const point = this.moldRig.localToWorld(new THREE.Vector3(-0.19, 0.33, -0.12));
      return { point, radius: 0.36, commit: () => this.lockPitcher() };
    }
    if (kind === 'led' && this.phase === 'led' && this.ice) {
      const point = this.ice.group.localToWorld(new THREE.Vector3(0, D.spacerH + 0.001, 0));
      return { point, radius: 0.14, commit: () => this.seatLed() };
    }
    return null;
  }

  // ------------------------------------------------------------ beat: mold

  private seatInner() {
    this.busy = true;
    const g = this.inner.group;
    const from = g.position.clone();
    const to = new THREE.Vector3(0, D.cavityFloor, 0);
    this.tween.add(0.42, (k) => {
      g.position.lerpVectors(from, to.clone().add(new THREE.Vector3(0, 0.055 * Math.sin(k * Math.PI) * (1 - k), 0)), k);
      g.rotation.y = (1 - k) * 0.22;
    }, {
      ease: ease.out,
      done: () => {
        g.position.copy(to);
        g.rotation.y = 0;
        audio.thunk();
        this.busy = false;
        this.tween.wait(0.45, () => this.setPhase('decorate'));
      },
    });
  }

  private placeDecor(obj3d: THREE.Object3D, world: THREE.Vector3) {
    const target = this.decor.find((d) => d.obj === obj3d);
    if (!target || target.placed) return;
    const local = this.moldRig.worldToLocal(world.clone());
    const r = THREE.MathUtils.clamp(Math.hypot(local.x, local.z), DECOR_MIN_R, DECOR_MAX_R);
    const th = Math.atan2(local.z, local.x);
    const restY =
      D.outerFloor + (target.kind === 'berry' ? 0.0118 : target.kind === 'sprig' ? 0.006 : 0.0022);
    const to = new THREE.Vector3(Math.cos(th) * r, restY, Math.sin(th) * r);
    const obj = target.obj;
    this.moldRig.attach(obj);
    const from = obj.position.clone();
    target.placed = true;
    target.radius = r;
    target.theta = th;
    this.placedCount++;
    // decorations always end up inside the wall, whatever the drop point
    if (target.kind === 'sprig') obj.rotation.set(0, -th + Math.PI / 2, 0.05);
    if (target.kind === 'petal') obj.rotation.set(-Math.PI / 2 + 0.12, th, 0);
    this.tween.add(0.3, (k) => {
      obj.position.lerpVectors(from, to, k);
    }, { ease: ease.out, done: () => obj.position.copy(to) });
    audio.drop();

    const need = this.round === 1 ? 4 : 3;
    if (this.placedCount >= need) {
      this.hud.button('できた', () => this.setPhase('fill'));
    }
    if (this.placedCount >= this.decor.length) {
      this.hud.button(null);
      this.tween.wait(0.5, () => this.setPhase('fill'));
    }
  }

  // ------------------------------------------------------------ beat: fill

  private lockPitcher() {
    const g = this.pitcher.group;
    g.userData.locked = true;
    const to = this.moldRig.localToWorld(new THREE.Vector3(-0.19, 0.33, -0.12));
    const from = g.position.clone();
    this.tween.add(0.4, (k) => {
      g.position.lerpVectors(from, to, k);
      g.rotation.y = k * 0.35;
    }, { ease: ease.out });
    this.hud.say('ゆびで ながおしすると おみずが でるよ');
  }

  private updateFill(dt: number) {
    const g = this.pitcher.group;
    // the hand-off to the next beat runs as a tween while the phase is still
    // 'fill'; nothing here may run again during it
    if (this.busy || !g.userData.locked) return;
    if (this.pouring) {
      this.pourHold = Math.min(1, this.pourHold + dt * 2.6);
    } else {
      this.pourHold = Math.max(0, this.pourHold - dt * 4);
    }
    this.pitcherTilt = this.pourHold * 0.95;
    g.rotation.z = -this.pitcherTilt;

    const spout = this.pitcher.spoutTip.getWorldPosition(new THREE.Vector3());
    const surfLocal = this.water.surfaceY;
    const hitLocal = new THREE.Vector3(-0.108, surfLocal, -0.075);
    const hitWorld = this.moldRig.localToWorld(hitLocal.clone());

    if (this.pourHold > 0.35) {
      if (!this.water.pouring) audio.pourStart();
      this.water.setPour(true, spout, hitWorld);
      const rate = (this.round === 1 ? 0.3 : 0.46) * (this.pourHold - 0.3);
      const before = this.water.level;
      const next = this.devFillCap > 0 ? Math.min(this.devFillCap, before + rate * dt) : before + rate * dt;
      this.water.setLevel(next);
      this.pitcher.setLevel(1 - this.water.level * 0.85);
      if (Math.random() < dt * 26) this.water.ripple(hitLocal.x, hitLocal.z, 0.0026);
      if (Math.random() < dt * 16) {
        this.water.spawnBubble(
          hitLocal.x + (Math.random() - 0.5) * 0.03,
          D.outerFloor + 0.006,
          hitLocal.z + (Math.random() - 0.5) * 0.03,
          0
        );
      }
      // air comes off the twigs and clings to the mould wall
      if (Math.random() < dt * 7) {
        const d = this.decor.find((x) => x.placed && x.kind === 'sprig');
        if (d) {
          this.water.spawnBubble(
            d.obj.position.x + (Math.random() - 0.5) * 0.03,
            d.obj.position.y + 0.004,
            d.obj.position.z + (Math.random() - 0.5) * 0.03,
            1
          );
        }
      }
      if (Math.random() < dt * 5) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.random() < 0.5 ? 0.147 : 0.0985;
        const yy = D.outerFloor + Math.random() * Math.max(0.01, this.water.level * D.waterTop - 0.01);
        this.water.spawnBubble(Math.cos(a) * rr, yy, Math.sin(a) * rr, 2);
      }
      if (this.water.level >= 1) this.finishFill();
    } else if (this.water.pouring) {
      this.water.setPour(false, null, null);
      audio.pourStop();
    }

    // floating: berries rise, petals sit on the surface, twigs stay low
    const surf = this.water.surfaceY;
    for (let i = 0; i < this.decor.length; i++) {
      const d = this.decor[i];
      if (!d.placed) continue;
      let target = d.obj.position.y;
      if (d.kind === 'berry') target = Math.min(surf - 0.013 - (i % 3) * 0.014, D.outerFloor + D.waterTop - 0.02);
      else if (d.kind === 'petal') target = surf - 0.005;
      else target = D.outerFloor + 0.006 + Math.min(0.012, this.water.level * 0.02);
      if (target > d.obj.position.y) d.obj.position.y = THREE.MathUtils.damp(d.obj.position.y, target, 3.5, dt);
      if (d.kind !== 'sprig') {
        d.obj.position.x = Math.cos(d.theta) * d.radius;
        d.obj.position.z = Math.sin(d.theta) * d.radius;
      }
    }
  }

  private finishFill() {
    if (this.phase !== 'fill' || this.busy) return;
    this.busy = true;
    this.water.setLevel(1);
    this.pouring = false;
    this.water.setPour(false, null, null);
    audio.pourStop();
    const g = this.pitcher.group;
    g.userData.locked = false;
    const from = g.position.clone();
    const to = new THREE.Vector3(-0.56, BENCH_Y, 0.28);
    this.tween.add(0.7, (k) => {
      g.position.lerpVectors(from, to, k);
      g.rotation.z = -this.pitcherTilt * (1 - k);
      g.rotation.y = 0.35 * (1 - k);
    }, {
      ease: ease.out,
      done: () => {
        this.pitcherTilt = 0;
        this.busy = false;
        this.setPhase('shelve');
      },
    });
  }

  // ---------------------------------------------------------- beat: freeze

  private trySlideToShelf() {
    if (this.phase !== 'shelve' || this.busy) return;
    this.busy = true;
    audio.slide();
    const from = this.moldRig.position.clone();
    const to = new THREE.Vector3(SHELF_POS.x, SHELF_Y + 0.018, SHELF_POS.z);
    this.tween.add(1.5, (k) => {
      this.moldRig.position.lerpVectors(from, to, k);
      this.moldRig.position.y += Math.sin(k * Math.PI) * 0.035;
      if (k > 0.25) this.water.ripple(0.05, 0.02, 0.0009 * (1 - k));
    }, {
      ease: ease.inOut,
      done: () => {
        this.busy = false;
        this.hud.say('カバーを しめてね');
        this.hud.button('しめる', () => this.closeCover());
      },
    });
  }

  private closeCover() {
    this.busy = true;
    this.hud.button(null);
    const from = this.cover.rotation.x;
    this.tween.add(0.9, (k) => {
      this.cover.rotation.x = THREE.MathUtils.lerp(from, 0.16, k);
    }, {
      ease: ease.out,
      done: () => {
        audio.thunk();
        this.busy = false;
        this.beginFreeze();
      },
    });
  }

  private beginFreeze() {
    this.setPhase('freeze');
    this.freezeT = 0;
    this.freezeEnded = false;
    this.freezeDur = (this.round === 1 ? 11 : 7) / Tweener.speed;
    const q = this.engine.quality.settings;
    this.ice = new IceLantern(1000 + this.round * 37, q.transmission);
    this.ice.group.position.set(0, D.outerFloor, 0);
    this.moldRig.add(this.ice.group);
    this.ice.setFreeze(0);
    // The ice solid is exactly the shape the water occupied, so the swap is
    // invisible; it happens only after the surface has stopped moving.
    this.waterHidden = false;
    audio.frost();
  }

  private updateFreeze(dt: number) {
    const prev = this.freezeT;
    this.freezeT = Math.min(1, this.freezeT + dt / this.freezeDur);
    const t = this.freezeT;
    if (!this.waterHidden && t > 0.1) {
      this.waterHidden = true;
      this.water.hideWater();
    }
    this.ice?.setFreeze(THREE.MathUtils.smoothstep(t, 0.02, 0.94));
    // afternoon -> blue dusk -> night across the lapse
    this.engine.env.setTime(THREE.MathUtils.clamp(0.1 + t * t * 0.92, 0, 1));
    // frost creeping over the outside of the mould
    const frost = THREE.MathUtils.smoothstep(t, 0.15, 0.8);
    const m = this.outer.body.material as THREE.MeshPhysicalMaterial;
    m.roughness = 0.34 + frost * 0.34;
    m.opacity = 0.4 + frost * 0.16;
    m.color.setRGB(0.86 + frost * 0.1, 0.906 + frost * 0.07, 0.925 + frost * 0.06);
    if (prev < 0.3 && t >= 0.3) {
      this.water.freezeBubbles();
      audio.frost();
    }
    if (prev < 0.62 && t >= 0.62) audio.frost();
    // the phase only changes once the demould hand-off starts, so this must
    // fire exactly once
    if (t >= 1 && !this.freezeEnded) {
      this.freezeEnded = true;
      this.endFreeze();
    }
  }

  private endFreeze() {
    this.busy = true;
    if (this.ice) {
      // from here the trapped air and the frozen decorations belong to the ice
      this.ice.group.attach(this.water.group);
      for (const d of this.decor) if (d.placed) this.ice.group.attach(d.obj);
    }
    this.hud.say('こおったよ');
    this.tween.wait(0.7, () => {
      const from = this.cover.rotation.x;
      this.tween.add(0.8, (k) => {
        this.cover.rotation.x = THREE.MathUtils.lerp(from, -1.25, k);
      }, {
        ease: ease.out,
        done: () => {
          const p0 = this.moldRig.position.clone();
          audio.slide();
          this.tween.add(1.4, (k) => {
            this.moldRig.position.lerpVectors(p0, MOLD_POS, k);
            this.moldRig.position.y += Math.sin(k * Math.PI) * 0.04;
          }, {
            ease: ease.inOut,
            done: () => {
              this.moldRig.position.copy(MOLD_POS);
              this.busy = false;
              this.startWarm();
            },
          });
        },
      });
    });
  }

  // ---------------------------------------------------------- beat: demold

  private startWarm() {
    this.setPhase('warm');
    this.busy = true;
    const c = this.cloth;
    const start = c.position.clone();
    const around = (k: number) => {
      const a = k * Math.PI * 2.4 - 0.6;
      const r = 0.23;
      c.position.set(MOLD_POS.x + Math.cos(a) * r, BENCH_Y + 0.12 + Math.sin(k * Math.PI) * 0.06, MOLD_POS.z + Math.sin(a) * r);
      c.rotation.y = -a;
    };
    audio.twist();
    this.tween.add(2.4, around, {
      ease: ease.inOut,
      done: () => {
        this.tween.add(0.6, (k) => {
          c.position.lerpVectors(c.position.clone(), start, k * 0.5 + 0.1);
          c.rotation.y *= 1 - k;
        }, {
          done: () => {
            c.position.copy(start);
            c.rotation.set(0, 0, 0);
            // a warmed mould releases: the frost on the outside clears a little
            const m = this.outer.body.material as THREE.MeshPhysicalMaterial;
            m.roughness = 0.42;
            m.opacity = 0.5;
            this.busy = false;
            this.setPhase('pullInner');
          },
        });
      },
    });
  }

  private resistInner() {
    const g = this.inner.group;
    const y0 = g.position.y;
    audio.twist();
    this.hud.showHint('すこし まわしてからね');
    this.tween.add(0.5, (k) => {
      g.position.y = y0 + Math.sin(k * Math.PI) * 0.012;
    }, {
      done: () => {
        g.position.y = y0;
        this.gesture = null;
        this.hud.hideHint();
      },
    });
  }

  private pullInner() {
    this.busy = true;
    this.hud.hideHint();
    const g = this.inner.group;
    const y0 = g.position.y;
    audio.twist();
    this.tween.add(1.05, (k) => {
      g.position.y = y0 + ease.outQuint(k) * 0.42;
      g.rotation.y = (1 - k) * this.inner.group.rotation.y;
    }, {
      ease: ease.linear,
      done: () => {
        audio.pop();
        const from = g.position.clone();
        const to = new THREE.Vector3(-0.5, 0.001, -0.3);
        this.tween.add(0.8, (k) => {
          g.position.lerpVectors(from, to, k);
        }, {
          ease: ease.inOut,
          done: () => {
            this.gesture = null;
            this.busy = false;
            this.setPhase('pullOuter');
          },
        });
      },
    });
  }

  private pullOuter() {
    this.busy = true;
    const g = this.outer.group;
    const iceG = this.ice!.group;
    const y0 = g.position.y;
    const iceY0 = iceG.position.y;
    let popped = false;
    this.tween.add(1.6, (k) => {
      const lift = ease.outQuint(k);
      g.position.y = y0 + lift * 0.5;
      // a tapered mould lets the ice slide down and seat on the bench
      iceG.position.y = THREE.MathUtils.lerp(iceY0, 0, THREE.MathUtils.smoothstep(k, 0.35, 0.82));
      if (!popped && k > 0.78) {
        popped = true;
        audio.pop();
      }
    }, {
      ease: ease.linear,
      done: () => {
        iceG.position.y = 0;
        const from = g.position.clone();
        const to = new THREE.Vector3(0.68, 0.001, -0.3);
        this.tween.add(0.9, (k) => {
          g.position.lerpVectors(from, to, k);
        }, {
          ease: ease.inOut,
          done: () => {
            this.gesture = null;
            this.busy = false;
            this.setPhase('led');
          },
        });
      },
    });
  }

  // ------------------------------------------------------------- beat: led

  private seatLed() {
    this.busy = true;
    const g = this.led.group;
    this.engine.scene.attach(g);
    const target = this.ice!.group.localToWorld(new THREE.Vector3(0, D.spacerH + 0.0005, 0));
    const from = g.position.clone();
    this.tween.add(0.5, (k) => {
      g.position.lerpVectors(from, target, k);
      g.rotation.y = (1 - k) * 0.4;
    }, {
      ease: ease.out,
      done: () => {
        g.position.copy(target);
        g.rotation.y = 0;
        this.ledSeated = true;
        audio.click();
        this.busy = false;
        this.hud.say('スイッチを ぽん と おしてね');
      },
    });
  }

  private toggleLight() {
    if (!this.ice) return;
    const on = this.lanternLight.intensity < 0.05;
    audio.chime(this.round - 1);
    const ice = this.ice;
    this.lanternLight.position.copy(ice.group.localToWorld(new THREE.Vector3(0, D.spacerH + 0.05, 0)));
    this.snowGlow.position.set(this.lanternLight.position.x, BENCH_Y + 0.004, this.lanternLight.position.z);
    this.tween.add(1.1, (k) => {
      const v = on ? k : 1 - k;
      ice.setLit(v);
      this.led.setOn(v);
      this.lanternLight.intensity = v * 0.34;
      (this.snowGlow.material as THREE.MeshBasicMaterial).opacity = v * 0.13;
    }, {
      ease: ease.out,
      done: () => {
        if (on && this.phase === 'led') this.setPhase('lit');
      },
    });
  }

  // ------------------------------------------------------------ rounds

  private nextRound() {
    this.busy = true;
    this.hud.button(null);
    this.hud.button2(null);
    this.storeDesign();
    const ice = this.ice!;
    this.engine.scene.attach(ice.group);
    const ledG = this.led.group;
    const from = ice.group.position.clone();
    const to = new THREE.Vector3(-0.72 + (this.round - 1) * 0.32, BENCH_Y, -0.3);
    const ledFrom = ledG.position.clone();
    const ledTo = to.clone().add(new THREE.Vector3(0, D.spacerH, 0));
    this.tween.add(0.9, (k) => {
      ice.group.position.lerpVectors(from, to, k);
      ledG.position.lerpVectors(ledFrom, ledTo, k);
    }, {
      ease: ease.inOut,
      done: () => {
        this.finished.push(ice.group);
        this.moldRig.remove(this.outer.group, this.inner.group);
        this.engine.scene.remove(this.outer.group, this.inner.group);
        this.lanternLight.intensity = 0;
        (this.snowGlow.material as THREE.MeshBasicMaterial).opacity = 0;
        this.round++;
        this.led = buildLed();
        this.led.setOn(0);
        this.engine.scene.add(this.led.group);
        this.buildRound(false);
        this.busy = false;
        this.setPhase('assemble');
      },
    });
  }

  private storeDesign() {
    this.designs.push({
      seed: 1000 + this.round * 37,
      items: this.decor
        .filter((d) => d.placed)
        .map((d) => ({ kind: d.kind, r: d.radius, theta: d.theta, y: d.obj.position.y })),
    });
  }

  private startCarry() {
    this.busy = true;
    this.hud.button(null);
    this.hud.button2(null);
    this.storeDesign();
    this.setPhase('carry');
    this.path = new PathScene(this.engine, this.designs);
    this.path.setFestiveCallback((v) => this.shed.setFestiveLights(v));
    this.path.setCompleteCallback(() => this.setPhase('done'));
    this.engine.scene.add(this.path.group);
    // the workshop props are behind the camera from here on
    this.engine.env.setTime(1);
    this.path.playSledCutscene(() => {
      this.busy = false;
      this.setPhase('finale');
      this.path?.arm();
    });
  }

  private restart() {
    window.location.reload();
  }

  // ------------------------------------------------------------- idle hint

  private nudge() {
    let obj: THREE.Object3D | null = null;
    switch (this.phase) {
      case 'assemble':
        obj = this.inner.group;
        break;
      case 'decorate':
        obj = this.decor.find((d) => !d.placed)?.obj ?? null;
        break;
      case 'fill':
        obj = this.pitcher.group;
        break;
      case 'shelve':
        obj = this.outer.group;
        break;
      case 'pullInner':
        obj = this.inner.group;
        break;
      case 'pullOuter':
        obj = this.outer.group;
        break;
      case 'led':
        obj = this.led.group;
        break;
      default:
        obj = null;
    }
    if (!obj) return;
    const o = obj;
    const y0 = o.position.y;
    this.tween.add(0.9, (k) => {
      o.position.y = y0 + Math.sin(k * Math.PI * 2) * 0.022 * (1 - k);
    }, { done: () => (o.position.y = y0), tag: 'nudge' });
  }

  /**
   * Capture-harness shortcuts. They drive the same code paths the player
   * does, just without the waiting, so art passes do not need a full run.
   */
  devJump(scene: string) {
    const setupMold = () => {
      this.inner.group.position.set(0, D.cavityFloor, 0);
      const angles = [0.5, 1.9, 3.3, 4.4, 5.6, 2.7];
      this.decor.forEach((d, i) => {
        const r = 0.118 + (i % 3) * 0.006;
        const th = angles[i % angles.length];
        const y = d.kind === 'sprig' ? D.outerFloor + 0.02 : D.outerFloor + 0.06 + (i % 4) * 0.035;
        this.moldRig.attach(d.obj);
        d.obj.position.set(Math.cos(th) * r, y, Math.sin(th) * r);
        if (d.kind === 'sprig') d.obj.rotation.set(0, -th + Math.PI / 2, 0.05);
        if (d.kind === 'petal') d.obj.rotation.set(-Math.PI / 2 + 0.12, th, 0);
        d.placed = true;
        d.radius = r;
        d.theta = th;
      });
      this.placedCount = this.decor.length;
    };

    if (scene === 'pour') {
      setupMold();
      this.setPhase('fill');
      this.applyLayout(true);
      this.tween.cancel();
      this.lockPitcher();
      this.water.setLevel(0.46);
      this.pourHold = 1;
      this.pouring = true;
      this.devFillCap = 0.62;
      for (let i = 0; i < 14; i++) {
        this.water.spawnBubble((Math.random() - 0.5) * 0.24, D.outerFloor + Math.random() * 0.08, (Math.random() - 0.5) * 0.24, 0);
      }
      return;
    }

    if (scene === 'freezing' || scene === 'innerOut') {
      setupMold();
      this.water.setLevel(1);
      if (scene === 'freezing') {
        this.moldRig.position.set(SHELF_POS.x, SHELF_Y + 0.018, SHELF_POS.z);
        this.cover.rotation.x = 0.16;
        this.beginFreeze();
        this.freezeT = 0.5;
        this.ice!.setFreeze(0.5);
        this.water.hideWater();
        this.waterHidden = true;
        this.water.freezeBubbles();
        this.engine.env.setTime(0.58);
        const m = this.outer.body.material as THREE.MeshPhysicalMaterial;
        m.roughness = 0.52;
        m.opacity = 0.49;
        return;
      }
      this.engine.env.setTime(1);
      this.beginFreeze();
      this.freezeT = 1;
      this.ice!.setFreeze(1);
      this.water.hideWater();
      this.waterHidden = true;
      this.ice!.group.attach(this.water.group);
      for (const d of this.decor) this.ice!.group.attach(d.obj);
      this.inner.group.position.y = D.cavityFloor + 0.3;
      this.setPhase('pullInner');
      return;
    }

    if (scene === 'finale') {
      this.designs = [0, 1, 2].map((i) => ({
        seed: 1037 + i * 37,
        items: [
          { kind: 'berry', r: 0.12, theta: 0.4 + i, y: 0.11 },
          { kind: 'berry', r: 0.128, theta: 2.2 + i, y: 0.16 },
          { kind: 'sprig', r: 0.122, theta: 4.1 + i, y: 0.06 },
          { kind: 'petal', r: 0.125, theta: 5.4 + i, y: 0.19 },
        ],
      }));
      this.startCarry();
      return;
    }
    if (scene === 'lit' || scene === 'demold') {
      setupMold();
      this.water.setLevel(1);
      this.engine.env.setTime(1);
      this.beginFreeze();
      this.freezeT = 0.999;
      this.ice!.setFreeze(1);
      this.water.hideWater();
      this.waterHidden = true;
      this.ice!.group.attach(this.water.group);
      for (const d of this.decor) this.ice!.group.attach(d.obj);
      this.inner.group.visible = false;
      this.outer.group.visible = false;
      this.ice!.group.position.y = 0;
      if (scene === 'demold') {
        this.outer.group.visible = true;
        this.outer.group.position.y = 0.24;
        this.ice!.group.position.y = 0.008;
        this.setPhase('pullOuter');
        return;
      }
      this.led.group.position.copy(this.ice!.group.localToWorld(new THREE.Vector3(0, D.spacerH + 0.0005, 0)));
      this.ledSeated = true;
      this.setPhase('led');
      this.toggleLight();
      this.setPhase('lit');
    }
  }

  devFinaleProgress(v: number) {
    this.path?.devProgress(v);
  }

  /** Screen point (css px) of a named target - used by the capture harness. */
  screenPointFor(name: string): { x: number; y: number } | null {
    const v = new THREE.Vector3();
    if (name === 'inner') this.inner.group.getWorldPosition(v).add(new THREE.Vector3(0, 0.16, 0));
    else if (name === 'innerHandle') this.inner.group.getWorldPosition(v).add(new THREE.Vector3(0, D.innerH + 0.04, 0));
    else if (name === 'moldCenter') this.moldRig.localToWorld(v.set(0, D.cavityFloor + 0.12, 0));
    else if (name === 'gap1' || name === 'gap') this.moldRig.localToWorld(v.set(0.122, D.outerFloor + 0.02, 0.02));
    else if (name === 'gap2') this.moldRig.localToWorld(v.set(-0.09, D.outerFloor + 0.02, 0.085));
    else if (name === 'gap3') this.moldRig.localToWorld(v.set(0.02, D.outerFloor + 0.02, -0.122));
    else if (name === 'gap4') this.moldRig.localToWorld(v.set(-0.115, D.outerFloor + 0.02, -0.05));
    else if (name === 'gap5') this.moldRig.localToWorld(v.set(0.09, D.outerFloor + 0.02, 0.08));
    else if (name === 'gap6') this.moldRig.localToWorld(v.set(-0.02, D.outerFloor + 0.02, 0.125));
    else if (name === 'pitcher') this.pitcher.group.getWorldPosition(v).add(new THREE.Vector3(0, 0.12, 0));
    else if (name === 'pourPose') this.moldRig.localToWorld(v.set(-0.19, 0.33, -0.12));
    else if (name === 'outer') this.outer.group.getWorldPosition(v).add(new THREE.Vector3(0, 0.2, 0));
    else if (name === 'handle') this.outer.handles[0].getWorldPosition(v);
    else if (name === 'led') this.led.group.getWorldPosition(v).add(new THREE.Vector3(0, 0.03, 0));
    else if (name === 'cavity') (this.ice ? this.ice.group : this.moldRig).localToWorld(v.set(0, D.spacerH + 0.02, 0));
    else if (name.startsWith('decor')) {
      const i = parseInt(name.slice(5), 10);
      const d = this.decor[i];
      if (!d) return null;
      d.obj.getWorldPosition(v);
    } else if (name === 'switch') {
      this.path?.switchWorld(v);
      if (!this.path) return null;
    } else return null;
    v.project(this.engine.rig.camera);
    return {
      x: ((v.x + 1) / 2) * window.innerWidth,
      y: ((-v.y + 1) / 2) * window.innerHeight,
    };
  }

  get state() {
    return {
      phase: this.phase,
      round: this.round,
      level: this.water.level,
      freeze: this.freezeT,
      busy: this.busy,
      placed: this.placedCount,
      ledSeated: this.ledSeated,
      lit: this.lanternLight.intensity,
    };
  }

  // ---------------------------------------------------------------- update

  update(dt: number, elapsed: number) {
    this.tween.update(dt);
    this.shed.setLamp(THREE.MathUtils.smoothstep(this.engine.env.time, 0.28, 0.72));
    this.water.update(dt, elapsed);
    this.ice?.update(elapsed);
    this.path?.update(dt, elapsed);

    if (this.pendingPour > 0 && this.pointer.active && this.phase === 'fill') {
      this.pendingPour += dt;
      if (this.pendingPour > 0.4) {
        this.pendingPour = 0;
        if (!this.pitcher.group.userData.locked) this.lockPitcher();
        this.pouring = true;
      }
    } else if (!this.pointer.active) {
      this.pendingPour = 0;
    }
    // a contact shadow must never travel with a lifted object
    for (const g of [this.pitcher.group, this.led.group, this.outer.group, this.inner.group]) {
      const decal = g.userData.shadowDecal as THREE.Mesh | undefined;
      if (decal) decal.visible = g.getWorldPosition(this.tmp2).y < BENCH_Y + 0.06;
    }

    if (this.phase === 'fill') this.updateFill(dt);
    if (this.phase === 'freeze') this.updateFreeze(dt);

    if (!this.busy && !this.idleNudged && this.pointer.idleFor() > 4.5) {
      this.idleNudged = true;
      this.nudge();
    }
  }
}
