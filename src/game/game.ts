/**
 * The play loop: read the yard, shake the tree, feed it through the cone,
 * carry it in, and let it open. One finger, no failure states, no text telling
 * the child what a baler is for.
 */
import * as THREE from 'three';
import { Stage } from '../core/stage';
import { Input } from '../core/input';
import { YardAudio } from '../core/audio';
import { makeSkyTexture } from '../core/textures';
import { clamp, damp, lerp, smoothstep } from '../core/rand';
import type { QualityBudget } from '../core/quality';
import { Materials } from '../world/materials';
import { BALER_POS, GATE_HALF_WIDTH, GATE_POS, SHAKER_POS, TREE_PAD, Yard } from '../world/yard';
import { Baler, AXIS_Y, CONE_LEN } from '../world/baler';
import { Shaker } from '../world/shaker';
import { Hall, HALL_STAND } from '../world/hall';
import { Tree } from '../tree/tree';
import { NetSleeve } from '../tree/net';
import { Debris } from '../tree/debris';
import { VARIANTS } from '../tree/variants';
import { Director, dirFrom, type ShotSpec } from './director';
import { Hud } from '../ui/hud';

export const enum Phase {
  Intro = 'intro',
  ToShaker = 'to-shaker',
  Shake = 'shake',
  ToBaler = 'to-baler',
  Bale = 'bale',
  Compare = 'compare',
  Transport = 'transport',
  Release = 'release',
  Settle = 'settle',
}

const CHILD_LINE = 'おおきな木を ブルブルして ぎゅっと ほそくした';

const EXIT_WORLD_X = BALER_POS.x + CONE_LEN;
const FEED_START_X = BALER_POS.x - 1.15;
/** where the netted tree is stood up: square in front of the loading gate */
const GATE_STAGE = new THREE.Vector3(GATE_POS.x - 2.5, 0, GATE_POS.z);

function contactShadowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.62)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.34)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class Game {
  readonly stage: Stage;
  private input: Input;
  private audio = new YardAudio();
  private hud: Hud;
  private mats: Materials;
  private yard: Yard;
  private hall: Hall;
  private shaker: Shaker;
  private baler: Baler;
  private director: Director;

  private tree!: Tree;
  private net!: NetSleeve;
  private debris!: Debris;
  private contact: THREE.Mesh;

  private sun: THREE.DirectionalLight;
  private sunTarget = new THREE.Object3D();
  private hemi: THREE.HemisphereLight;
  private fill: THREE.DirectionalLight;
  private fog: THREE.Fog;

  phase: Phase = Phase.Intro;
  private t = 0;
  private run = 0;
  private variantIndex = 0;

  private shakeHeld = 0;
  private feedImpulse = 0;
  private feedSpeed = 0;
  private treeX = 0;
  private pullTotal = 0;
  private releaseFront = 0;
  private lastReleased = 0;
  private idle = 0;
  private captionShown = false;
  private clampSound = false;
  private settleSound = false;
  private veil = 0;
  private veilTarget = 0;
  private lastMoveFrom = new THREE.Vector3();
  private lastMoveRot = 0;

  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private focus = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement) {
    this.stage = new Stage(canvas);
    this.input = new Input(canvas);
    this.hud = new Hud(overlay);
    this.director = new Director(this.stage.camera);

    const aniso = this.stage.renderer.capabilities.getMaxAnisotropy();
    this.mats = new Materials(aniso);

    const scene = this.stage.scene;
    const sky = makeSkyTexture('#8ea0b0', '#c3cbd0', '#5d5a53');
    scene.background = sky;
    scene.environment = sky;
    scene.environmentIntensity = 0.45;
    this.fog = new THREE.Fog(0xb9c2c8, 42, 190);
    scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0x9fb4c8, 0x50442f, 1.35);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffd3a0, 2.5);
    this.sun.position.set(-9, 7, 9.5);
    this.sun.castShadow = this.stage.budget.shadows;
    this.sun.shadow.mapSize.set(this.stage.budget.shadowMapSize, this.stage.budget.shadowMapSize);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 48;
    this.sun.shadow.camera.left = -13;
    this.sun.shadow.camera.right = 13;
    this.sun.shadow.camera.top = 13;
    this.sun.shadow.camera.bottom = -13;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.035;
    scene.add(this.sun);
    scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;

    // a soft bounce from the open yard so shaded faces are not pure sky blue
    this.fill = new THREE.DirectionalLight(0xcdd8dc, 0.5);
    this.fill.position.set(7, 4.5, -8);
    scene.add(this.fill);

    this.yard = new Yard(this.mats, this.stage.budget);
    scene.add(this.yard.group);

    this.shaker = new Shaker(this.mats);
    this.shaker.group.position.copy(SHAKER_POS);
    this.shaker.group.rotation.y = -2.18;
    scene.add(this.shaker.group);

    this.baler = new Baler(this.mats);
    this.baler.group.position.copy(BALER_POS);
    scene.add(this.baler.group);

    this.hall = new Hall(this.mats);
    scene.add(this.hall.group);
    this.hall.group.visible = false;
    for (const l of this.hall.lights) l.visible = false;

    // whole-tree contact shadow: the crown never casts into the shadow map,
    // so its weight on the ground is carried by this instead
    this.contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        alphaMap: contactShadowTexture(),
        transparent: true,
        depthWrite: false,
        color: 0x000000,
        opacity: 0.7,
      }),
    );
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.renderOrder = 2;
    scene.add(this.contact);

    this.stage.onBudgetChange((b) => this.applyBudget(b));
    this.hud.onReplay(() => this.nextTree());

    this.buildTree();
    this.enter(Phase.Intro, true);

    const unlock = (): void => {
      this.audio.start();
      this.audio.resume();
    };
    canvas.addEventListener('pointerdown', unlock, { once: false });

    this.exposeTestHooks();
  }

  private applyBudget(b: QualityBudget): void {
    this.sun.castShadow = b.shadows;
    this.sun.shadow.mapSize.set(b.shadowMapSize, b.shadowMapSize);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
  }

  // ---------------------------------------------------------------- tree

  private buildTree(): void {
    const variant = VARIANTS[this.variantIndex % VARIANTS.length];
    this.debris = new Debris(this.stage.budget.debrisMax, this.mats.debris);
    this.stage.scene.add(this.debris.mesh);
    this.tree = new Tree(variant, this.stage.budget, this.mats, (p, e) => {
      this.debris.spawn(p, e);
    });
    this.stage.scene.add(this.tree.group, this.tree.wood, this.tree.tufts);
    this.net = new NetSleeve(variant.height, this.stage.budget, this.mats.net, this.mats.knot);
    this.tree.group.add(this.net.group);
    this.net.coverTop = 0;
    this.net.front = 0;
    this.net.fade = 1;
    this.net.tail = 0.3;
    this.net.floorY = -Infinity;
    this.net.unlock();
    this.tree.group.position.copy(TREE_PAD);
    this.tree.group.rotation.z = 0;
    this.debris.setGround(0.02);
  }

  private disposeTree(): void {
    this.stage.scene.remove(this.tree.group, this.tree.wood, this.tree.tufts, this.debris.mesh);
    this.net.dispose();
    this.tree.dispose();
    this.debris.mesh.geometry.dispose();
    this.debris.mesh.dispose();
  }

  private nextTree(): void {
    this.hud.setReplay(false);
    this.hud.setCaption(null);
    this.disposeTree();
    this.run++;
    this.variantIndex = (this.variantIndex + 1) % VARIANTS.length;
    this.buildTree();
    this.treeX = 0;
    this.pullTotal = 0;
    this.releaseFront = 0;
    this.lastReleased = 0;
    this.shakeHeld = 0;
    this.feedImpulse = 0;
    this.feedSpeed = 0;
    this.captionShown = false;
    this.clampSound = false;
    this.settleSound = false;
    this.setArea(false);
    this.enter(Phase.Intro, true);
  }

  private setArea(indoors: boolean): void {
    // the two locations never share a frame, so only one is ever built into
    // the render list
    this.hall.group.visible = indoors;
    this.yard.group.visible = !indoors;
    this.shaker.group.visible = !indoors;
    this.baler.group.visible = !indoors;
    for (const l of this.hall.lights) l.visible = indoors;
    for (const l of this.yard.lights) l.visible = !indoors;
    this.stage.scene.environmentIntensity = indoors ? 0.1 : 0.45;
    this.hemi.intensity = indoors ? 0.32 : 1.35;
    this.hemi.color.set(indoors ? 0xffe3c0 : 0xa9bccd);
    this.sun.intensity = indoors ? 0.22 : 2.5;
    this.fill.intensity = indoors ? 0.12 : 0.5;
    this.fog.color.set(indoors ? 0x3a3229 : 0xb3bcc3);
    this.fog.near = indoors ? 16 : 42;
    this.fog.far = indoors ? 62 : 190;
  }

  // ---------------------------------------------------------------- shots

  private shot(): ShotSpec {
    const p = this.stage.portrait;
    const h = this.tree.height;
    switch (this.phase) {
      case Phase.Intro: {
        // Staged by hand: a low eye that puts the wide crown on the left and
        // the narrow loading gate, thirty-five metres back, clear of it on the
        // right. Both orientations get their own placement so nothing is cut.
        if (p) {
          return {
            eye: new THREE.Vector3(-20.5, 1.2, 9.5),
            target: new THREE.Vector3(2.35, 2.61, 2.16),
            lambda: 1.5,
          };
        }
        return {
          eye: new THREE.Vector3(-17.5, 1.2, 8.4),
          target: new THREE.Vector3(1.52, 2.72, 2.22),
          lambda: 1.5,
        };
      }
      case Phase.ToShaker:
        return {
          target: new THREE.Vector3(SHAKER_POS.x, h * 0.5, SHAKER_POS.z),
          dir: dirFrom(Math.PI * (p ? 0.79 : 0.72), 0.06),
          fitW: p ? 2.4 : 3.0,
          fitH: h * 0.58,
          lambda: 1.35,
          lift: p ? 0.16 : 0.08,
        };
      case Phase.Shake:
        // side on, far enough to read the whole trunk-to-tip travel of the
        // vibration, with the lever turned toward the camera
        return {
          target: new THREE.Vector3(SHAKER_POS.x + 0.15, h * 0.5, SHAKER_POS.z),
          dir: dirFrom(Math.PI * (p ? 0.81 : 0.74), 0.09),
          fitW: p ? 2.5 : 3.1,
          fitH: h * 0.58,
          lambda: 1.1,
          lift: p ? 0.18 : 0.08,
        };
      case Phase.ToBaler:
        return {
          target: new THREE.Vector3(BALER_POS.x - 0.3, AXIS_Y + 0.15, BALER_POS.z),
          dir: dirFrom(Math.PI * (p ? 0.63 : 0.59), 0.15),
          fitW: p ? 2.7 : 3.6,
          fitH: 2.5,
          lambda: 1.15,
          lift: p ? 0.12 : 0.06,
        };
      case Phase.Bale: {
        // Parallel travel: the camera runs alongside the cone with the tree.
        const lead = clamp(this.treeX - 1.9, BALER_POS.x - 0.9, EXIT_WORLD_X + 2.3);
        return {
          target: new THREE.Vector3(lead, AXIS_Y + 0.15, BALER_POS.z),
          dir: dirFrom(Math.PI * (p ? 0.55 : 0.51), p ? 0.16 : 0.11),
          fitW: p ? 3.4 : 4.7,
          fitH: p ? 3.2 : 2.6,
          lambda: 2.6,
          lift: p ? 0.14 : 0.06,
        };
      }
      case Phase.Compare:
        // Straight down the axis of the loading gate: the bale now sits inside
        // the outline of the slot the whole tree could not go near.
        return {
          target: new THREE.Vector3(GATE_POS.x - 1.3, h * 0.5, GATE_POS.z),
          dir: dirFrom(Math.PI * 1.035, 0.04),
          fitW: p ? 1.5 : 2.2,
          fitH: h * 0.8,
          lambda: 1.2,
          lift: p ? 0.16 : 0.07,
        };
      case Phase.Transport:
        return {
          target: new THREE.Vector3(HALL_STAND.x, h * 0.5, HALL_STAND.z),
          dir: dirFrom(Math.PI * 0.92, 0.08),
          fitW: 2.4,
          fitH: h * 0.6,
          lambda: 1.6,
        };
      case Phase.Release: {
        const close = this.pullTotal < 6;
        if (close) {
          // the net end, in the hand
          return {
            target: new THREE.Vector3(HALL_STAND.x - 0.25, HALL_STAND.y + 0.5, HALL_STAND.z),
            dir: dirFrom(Math.PI * 0.9, 0.09),
            fitW: 0.95,
            fitH: 1.05,
            lambda: 1.5,
            lift: p ? 0.24 : 0.12,
          };
        }
        // pulled back before a single branch is allowed to move
        return {
          target: new THREE.Vector3(HALL_STAND.x, h * 0.52, HALL_STAND.z),
          dir: dirFrom(Math.PI * 0.9, 0.06),
          fitW: p ? 2.0 : 2.6,
          fitH: h * 0.62,
          lambda: 1.25,
          lift: p ? 0.2 : 0.08,
        };
      }
      case Phase.Settle:
        return {
          target: new THREE.Vector3(HALL_STAND.x - 0.7, h * 0.48, HALL_STAND.z + 0.5),
          dir: dirFrom(Math.PI * 0.86, 0.04),
          fitW: p ? 2.3 : 3.2,
          fitH: h * 0.62,
          lambda: 1.0,
          lift: p ? 0.16 : 0.06,
        };
    }
  }

  private applyShot(snap = false): void {
    this.director.set(this.shot(), this.stage.aspect, this.stage.portrait, snap);
  }

  // ---------------------------------------------------------------- phases

  private enter(next: Phase, snap = false): void {
    this.phase = next;
    this.t = 0;
    this.input.clearSwipes();
    this.lastMoveFrom.copy(this.tree.group.position);
    this.lastMoveRot = this.tree.group.rotation.z;
    if (next === Phase.Intro) {
      this.tree.group.position.copy(TREE_PAD);
      this.tree.group.rotation.z = 0;
      this.shaker.setClamp(0);
    }
    this.applyShot(snap);
  }

  private moveTree(to: THREE.Vector3, rotTo: number, k: number, arc: number): void {
    const e = smoothstep(0, 1, k);
    this.tree.group.position.lerpVectors(this.lastMoveFrom, to, e);
    this.tree.group.position.y += Math.sin(e * Math.PI) * arc;
    this.tree.group.rotation.z = lerp(this.lastMoveRot, rotTo, e);
  }

  // ---------------------------------------------------------------- loop

  update(dt: number): void {
    this.input.tick(dt);
    const hinting = this.run === 0;
    if (this.input.down || this.input.travelling) this.idle = 0;
    else this.idle += dt;

    switch (this.phase) {
      case Phase.Intro:
        this.tickIntro(dt, hinting);
        break;
      case Phase.ToShaker:
        this.tickToShaker(dt);
        break;
      case Phase.Shake:
        this.tickShake(dt, hinting);
        break;
      case Phase.ToBaler:
        this.tickToBaler(dt);
        break;
      case Phase.Bale:
        this.tickBale(dt, hinting);
        break;
      case Phase.Compare:
        this.tickCompare(dt);
        break;
      case Phase.Transport:
        this.tickTransport(dt);
        break;
      case Phase.Release:
        this.tickRelease(dt, hinting);
        break;
      case Phase.Settle:
        this.tickSettle(dt);
        break;
    }

    this.tree.update(dt, this.phase === Phase.Shake);
    const landed = this.debris.update(dt);
    for (let i = 0; i < Math.min(landed, 3); i++) this.audio.leafTick(0.7 + Math.random() * 0.5);

    this.net.update((y) => this.crownRadius(y), dt);
    this.updateContactShadow();
    this.updateSun();

    this.applyShot();
    this.director.update(dt);

    this.veil = damp(this.veil, this.veilTarget, 6, dt);
    this.hud.setVeil(this.veil);
    this.hud.update(dt);
    this.audio.setRub(this.tree.rubEnergy * (this.phase === Phase.Shake ? 1 : 0.5));
    this.input.endFrame();
  }

  private crownRadius(y: number): number {
    const bins = this.tree.profile.length;
    const f = clamp((y / this.tree.height) * bins, 0, bins - 1.001);
    const i = Math.floor(f);
    return lerp(this.tree.profile[i], this.tree.profile[i + 1] ?? this.tree.profile[i], f - i);
  }

  private updateContactShadow(): void {
    const w = Math.max(0.6, this.tree.halfWidth * 2.1);
    const p = this.tree.group.position;
    const horizontal = Math.abs(this.tree.group.rotation.z) > 0.6;
    this.contact.position.set(
      horizontal ? p.x - this.tree.height * 0.5 : p.x,
      0.03,
      p.z,
    );
    this.contact.scale.set(horizontal ? this.tree.height * 1.15 : w, horizontal ? w : w, 1);
    const mat = this.contact.material as THREE.MeshBasicMaterial;
    mat.opacity = horizontal ? 0.4 : 0.72;
  }

  private updateSun(): void {
    this.focus.copy(this.tree.group.position);
    this.sunTarget.position.copy(this.focus);
    // low winter sun, three-quarters front-left: the crowns read green and the
    // shadows rake away across the yard
    this.sun.position.set(this.focus.x - 9, this.focus.y + 7, this.focus.z + 9.5);
  }

  // ---------------------------------------------------------------- ticks

  private tickIntro(dt: number, hinting: boolean): void {
    this.t += dt;
    const s = this.input.takeSwipe((sw) => sw.dx > Math.abs(sw.dy) * 0.35);
    if (s) {
      this.audio.start();
      this.hud.hideHint();
      this.enter(Phase.ToShaker);
      return;
    }
    if (!this.input.down && this.t > 0.8 && (hinting || this.idle > 3.2)) {
      const a = this.project(this.tmp.set(TREE_PAD.x, this.tree.height * 0.55, TREE_PAD.z));
      const b = this.project(this.shaker.buttWorldPoint(this.tmp2).setY(this.tree.height * 0.5));
      this.hud.showHint('swipe', a.x, a.y, b.x, b.y, !hinting);
    }
  }

  private tickToShaker(dt: number): void {
    this.t += dt;
    const k = clamp(this.t / 1.35, 0, 1);
    this.shaker.buttWorldPoint(this.tmp);
    this.moveTree(this.tmp, 0, k, 0.35);
    this.shaker.setClamp(smoothstep(0.62, 0.98, k));
    if (!this.clampSound && k > 0.72) {
      this.clampSound = true;
      this.audio.clamp();
    }
    this.shaker.update(dt, 0, 0);
    if (k >= 1) this.enter(Phase.Shake);
  }

  private tickShake(dt: number, hinting: boolean): void {
    this.t += dt;
    const pressing = this.input.down && !this.input.travelling;
    const energy = pressing ? 1 : 0;
    this.tree.setShakeInput(energy);
    if (pressing) this.shakeHeld += dt;
    const env = clamp(this.tree.shakeLevel, 0, 1);
    this.shaker.setClamp(1);
    this.shaker.update(dt, env, pressing ? 1 : 0);
    this.audio.setShake(env);

    const need = this.run === 0 ? 1.25 : 0.45;
    const ready = this.shakeHeld > need;
    if (ready) {
      const s = this.input.takeSwipe((sw) => sw.dx > Math.abs(sw.dy) * 0.3);
      if (s) {
        this.audio.setShake(0);
        this.audio.latch();
        this.hud.hideHint();
        this.enter(Phase.ToBaler);
        return;
      }
    }
    if (!ready) {
      if (this.t > 0.5 && (hinting || this.idle > 2.4) && !pressing) {
        const p = this.project(this.shaker.leverWorldPoint(this.tmp));
        this.hud.showHint('hold', p.x, p.y, p.x, p.y, !hinting);
      } else if (pressing) {
        this.hud.hideHint();
      }
    } else if (!pressing && (hinting || this.idle > 2.2)) {
      const a = this.project(this.tmp.set(SHAKER_POS.x, this.tree.height * 0.5, SHAKER_POS.z));
      const b = this.project(this.tmp2.set(BALER_POS.x - 1.0, AXIS_Y + 0.4, BALER_POS.z));
      this.hud.showHint('swipe', a.x, a.y, b.x, b.y, !hinting);
    }
  }

  private tickToBaler(dt: number): void {
    this.t += dt;
    this.tree.setShakeInput(0);
    this.audio.setShake(0);
    const k = clamp(this.t / 1.75, 0, 1);
    this.shaker.setClamp(1 - smoothstep(0, 0.25, k));
    this.tmp.set(FEED_START_X, AXIS_Y, BALER_POS.z);
    this.moveTree(this.tmp, Math.PI / 2, k, 0.5);
    this.treeX = this.tree.group.position.x;
    this.shaker.update(dt, 0, 0);
    if (k >= 1) {
      this.treeX = FEED_START_X;
      this.enter(Phase.Bale);
    }
  }

  private tickBale(dt: number, hinting: boolean): void {
    this.t += dt;
    // stroke length is measured in screen heights so the feel is the same on
    // a phone and on a tablet
    if (this.input.down) this.feedImpulse += Math.abs(this.input.frameDy) / this.stage.cssHeight;
    this.feedImpulse *= Math.exp(-2.6 * dt);
    const wanted = clamp(this.feedImpulse * 5.2, 0, 2.4);
    this.feedSpeed = damp(this.feedSpeed, wanted, 7, dt);
    this.treeX += this.feedSpeed * dt;

    this.tree.group.position.x = this.treeX;
    this.tree.group.position.y = AXIS_Y;
    this.tree.group.position.z = BALER_POS.z;
    this.tree.group.rotation.z = Math.PI / 2;

    // the machine's own buzz keeps a little dry material coming loose
    this.tree.setShakeInput(clamp(this.feedSpeed * 0.16, 0, 0.2));
    this.tree.applyCone((h) => this.baler.allowedRadius(this.treeX - h - BALER_POS.x));
    this.baler.update(dt, this.feedSpeed);
    this.net.coverTop = clamp(this.treeX - EXIT_WORLD_X, 0, this.tree.height);
    this.audio.setNetTension(this.net.coverTop > 0.05 ? clamp(this.feedSpeed * 0.7, 0, 1) : 0);

    const done = this.treeX >= EXIT_WORLD_X + this.tree.height + 0.35;
    if (done) {
      this.audio.setNetTension(0);
      this.hud.hideHint();
      this.net.lock();
      this.enter(Phase.Compare);
      return;
    }
    // the hand steps out of the way as soon as the tree is actually moving
    if (this.feedSpeed < 0.18 && (hinting || this.idle > 1.8)) {
      const p = this.project(this.tmp.set(BALER_POS.x - 0.42, AXIS_Y + 0.5, BALER_POS.z + 0.7));
      const span = Math.min(this.stage.cssHeight * 0.2, 140);
      this.hud.showHint('swipe', p.x, p.y - span * 0.5, p.x, p.y + span * 0.5, !hinting);
    }
  }

  private tickCompare(dt: number): void {
    this.t += dt;
    this.tree.holdFolded();
    const k = clamp(this.t / 1.9, 0, 1);
    this.tmp.copy(GATE_STAGE);
    this.moveTree(this.tmp, 0, k, 0.55);
    if (k > 0.85) this.net.floorY = 0;
    if (!this.captionShown && this.t > 1.5) {
      this.captionShown = true;
      this.hud.setCaption(CHILD_LINE);
    }
    if (this.t > 3.4) {
      // and through the slot it goes
      const k2 = clamp((this.t - 3.4) / 1.5, 0, 1);
      const e = smoothstep(0, 1, k2);
      this.tree.group.position.x = lerp(GATE_STAGE.x, GATE_POS.x + 2.6, e);
    }
    if (this.t > 5.0) this.enter(Phase.Transport);
  }

  private tickTransport(dt: number): void {
    this.t += dt;
    this.tree.holdFolded();
    this.veilTarget = this.t < 0.85 ? 1 : 0;
    if (this.t > 0.55 && this.tree.group.position.x < HALL_STAND.x - 1) {
      this.tree.group.position.copy(HALL_STAND);
      this.tree.group.rotation.z = 0;
      this.net.floorY = -HALL_STAND.y;
      // stood up indoors, the loose end of the sock is long enough to grab
      this.net.tail = 1.05;
      this.setArea(true);
      this.hud.setCaption(null);
      this.audio.haul();
      this.applyShot(true);
    }
    if (this.t > 1.7) {
      this.veilTarget = 0;
      this.enter(Phase.Release);
    }
  }

  private tickRelease(dt: number, hinting: boolean): void {
    this.t += dt;
    if (this.input.down) {
      const d = Math.max(0, this.input.frameDy);
      this.pullTotal += d;
      if (d > 0.5) this.net.setPullWobble(clamp(d * 0.08, 0, 1));
      this.audio.setNetTension(clamp(d * 0.05, 0, 1));
    } else {
      this.audio.setNetTension(0);
    }

    const span = this.stage.cssHeight * 1.15;
    const wanted = (this.pullTotal / span) * this.tree.height;
    // the camera is pulled back before any branch is allowed to move
    const allowed = this.pullTotal > 6 ? this.director.transitionProgress : 0;
    this.releaseFront = Math.min(wanted, allowed * this.tree.height * 1.05);
    this.net.front = this.releaseFront;
    this.tree.releaseTo(this.releaseFront);
    this.net.tail = 1.05 + clamp(this.pullTotal / span, 0, 1) * 0.7;


    const released = this.tree.releasedFraction;
    if (released > this.lastReleased + 0.035) {
      this.audio.openBurst(clamp(0.5 + (released - this.lastReleased) * 6, 0.4, 1));
      this.lastReleased = released;
    }

    if (this.releaseFront >= this.tree.height * 0.995) {
      this.hud.hideHint();
      this.enter(Phase.Settle);
      return;
    }
    if (!this.input.down && this.t > 0.6 && (hinting || this.idle > 2.0)) {
      this.net.tailPoint(this.tmp).applyMatrix4(this.tree.group.matrixWorld);
      const p = this.project(this.tmp);
      const span2 = Math.min(this.stage.cssHeight * 0.3, 220);
      this.hud.showHint('pull', p.x, p.y, p.x, Math.min(this.stage.cssHeight - 40, p.y + span2), !hinting);
    }
  }

  private tickSettle(dt: number): void {
    this.t += dt;
    this.net.fade = clamp(1 - (this.t - 0.15) * 1.1, 0, 1);
    this.audio.setNetTension(0);
    if (!this.settleSound && this.t > 0.9) {
      this.settleSound = true;
      this.audio.settle();
    }
    if (this.t > 2.2) this.hud.setReplay(true);
  }

  // ---------------------------------------------------------------- utils

  private project(v: THREE.Vector3): { x: number; y: number } {
    const p = v.clone().project(this.stage.camera);
    const behind = p.z > 1;
    const w = this.stage.cssWidth;
    const hgt = this.stage.cssHeight;
    let x = (p.x * 0.5 + 0.5) * w;
    let y = (-p.y * 0.5 + 0.5) * hgt;
    if (behind) {
      x = w - x;
      y = hgt - y;
    }
    // A hint must land somewhere a thumb can actually reach; if the thing it
    // points at has left the frame, keep the hand inside the safe area.
    const mx = Math.min(72, w * 0.18);
    const my = Math.min(96, hgt * 0.16);
    return {
      x: clamp(x, mx, w - mx),
      y: clamp(y, my, hgt - my),
    };
  }

  bootDone(): void {
    this.hud.bootDone();
  }

  private exposeTestHooks(): void {
    // Not UI: a handle so an automated pass can drive the same gestures a
    // finger produces, and read back the state the player can see.
    (window as unknown as Record<string, unknown>).__ctg = {
      phase: () => this.phase,
      tier: () => this.stage.budget.tier,
      counts: () => ({ wood: this.tree.wood.count, tufts: this.tree.tufts.count }),
      run: () => this.run,
      variant: () => this.tree.variant.id,
      halfWidth: () => this.tree.halfWidth,
      gateHalfWidth: () => GATE_HALF_WIDTH,
      foldAverage: () => this.tree.foldAverage,
      dryReserve: () => this.tree.dryReserve,
      released: () => this.tree.releasedFraction,
      netCover: () => this.net.coverTop,
      anchor: (name: string) => {
        switch (name) {
          case 'tree':
            return this.project(
              this.tmp.copy(this.tree.group.position).setY(this.tree.height * 0.55),
            );
          case 'lever':
            return this.project(this.shaker.leverWorldPoint(this.tmp));
          case 'baler':
            return this.project(this.tmp.set(BALER_POS.x - 1.0, AXIS_Y + 0.4, BALER_POS.z));
          case 'rollers':
            return this.project(this.tmp.set(BALER_POS.x - 0.42, AXIS_Y + 0.5, BALER_POS.z + 0.7));
          case 'gate':
            return this.project(this.tmp.set(GATE_POS.x, 2.2, GATE_POS.z));
          case 'tail':
            return this.project(
              this.net.tailPoint(this.tmp).applyMatrix4(this.tree.group.matrixWorld),
            );
          default:
            return { x: this.stage.cssWidth / 2, y: this.stage.cssHeight / 2 };
        }
      },
    };
  }
}
