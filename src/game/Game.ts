import * as THREE from 'three';
import { CameraRig, type Shot } from '../camera/CameraRig';
import { GameAudio } from '../audio/Audio';
import { Gestures } from '../input/Gestures';
import { Hints } from '../ui/Hints';
import { Net } from '../net/Net';
import { Debris } from '../tree/Debris';
import { TreeRig } from '../tree/TreeRig';
import { TREE_VARIANTS } from '../tree/TreeSpec';
import { Baler } from '../world/Baler';
import { Lobby } from '../world/Lobby';
import { Shaker } from '../world/Shaker';
import { YARD, Yard } from '../world/Yard';
import { makeBlobShadow, worldMaterials, type WorldMaterials } from '../core/materials';
import { Rng, clamp, damp, easeInOutCubic, lerp, smoothstep } from '../core/rng';
import type { RenderSystem } from '../core/renderer';

export type Phase =
  | 'intro'
  | 'toShaker'
  | 'shaking'
  | 'toBaler'
  | 'feeding'
  | 'compare'
  | 'transport'
  | 'release'
  | 'admire';

const V = () => new THREE.Vector3();

export class Game {
  private readonly scene = new THREE.Scene();
  private readonly rig = new CameraRig();
  private readonly audio = new GameAudio();
  private readonly gestures: Gestures;
  private readonly hints: Hints;
  private readonly mats: WorldMaterials;
  private readonly yard: Yard;
  private readonly shaker: Shaker;
  private readonly baler: Baler;
  private readonly lobby: Lobby;
  private readonly net: Net;
  private readonly debris: Debris;
  private readonly fade: HTMLDivElement;
  private readonly render: RenderSystem;
  private readonly rng = new Rng(31337);
  private readonly treeShadow: THREE.Mesh;

  private tree!: TreeRig;
  private treeIndex = 0;
  private phase: Phase = 'intro';
  private phaseTime = 0;
  private feed = 0;
  private shakeHeld = 0;
  private pull = 0;
  private opened = 0;
  private fadeLevel = 0;
  private fadeTarget = 0;
  private travelFrom = V();
  private travelTo = V();
  private settleDone = false;
  private treeBase = V();
  private treeGroundY = 0;
  private grabbing = false;
  private pullGain = 0.85;
  private front = 0;
  private changingTree = false;

  constructor(overlay: HTMLElement, render: RenderSystem) {
    this.render = render;
    this.mats = worldMaterials(render.quality);
    this.yard = new Yard(this.scene, this.mats, render.quality);

    this.shaker = new Shaker(this.mats);
    this.shaker.group.position.copy(YARD.shaker);
    this.shaker.group.rotation.y = -0.16;
    this.scene.add(this.shaker.group);

    this.baler = new Baler(this.mats, YARD.axisHeight);
    this.baler.group.position.copy(YARD.balerEntry);
    this.scene.add(this.baler.group);

    this.lobby = new Lobby(this.mats);
    this.scene.add(this.lobby.group);
    this.lobby.setActive(true);

    this.net = new Net(render.quality);
    this.debris = new Debris(render.quality.debrisCount);
    this.scene.add(this.debris.mesh);

    this.treeShadow = makeBlobShadow(this.mats.shadowBlob, 1);
    this.scene.add(this.treeShadow);

    this.gestures = new Gestures(render.renderer.domElement);
    this.gestures.onSwipe = (e) => this.onSwipe(e.dx);
    this.gestures.onTap = () => this.onTap();

    this.hints = new Hints(overlay);

    this.fade = document.createElement('div');
    this.fade.style.cssText =
      'position:fixed;inset:0;background:#0b0f13;opacity:0;pointer-events:none;transition:opacity 480ms ease;';
    overlay.appendChild(this.fade);

    this.spawnTree(0);
    this.rig.setViewport(render.size.w, render.size.h);
    this.rig.cut(this.shotFor('intro'));
  }

  // ------------------------------------------------------------------ setup

  private spawnTree(index: number): void {
    this.treeIndex = index;
    if (this.tree) {
      this.net.object.removeFromParent();
      this.tree.dispose();
    }
    const spec = TREE_VARIANTS[index % TREE_VARIANTS.length];
    this.tree = new TreeRig(spec, this.render.quality);
    this.scene.add(this.tree.object);
    this.tree.root.position.copy(YARD.treeStart);
    this.tree.root.rotation.set(0, this.rng.range(-0.4, 0.4), 0);
    this.treeBase.copy(YARD.treeStart);
    this.tree.root.add(this.net.object);
    this.net.configure(spec.height, (t) => this.tree.radiusAt(t));
    this.net.reset();
    this.debris.clear();
    this.debris.setGround(0);
    this.treeGroundY = 0;
    this.feed = 0;
    this.shakeHeld = 0;
    this.pull = 0;
    this.front = 0;
    this.opened = 0;
    this.settleDone = false;
    this.shaker.clamp = 0;
    this.shaker.vibration = 0;
    this.tree.update(0.016);
  }

  async startAudio(): Promise<void> {
    await this.audio.start();
    this.audio.setWind(0.6);
  }

  // ------------------------------------------------------------------ input

  private onSwipe(dx: number): void {
    this.hints.noteInput();
    if (this.phase === 'intro') {
      // any decisive push to the right sends the tree to the shaker
      if (dx > 0.35) this.enter('toShaker');
    } else if (this.phase === 'shaking') {
      const enough = this.treeIndex > 0 || this.tree.shedProgress > 0.22;
      if (dx > 0.35 && enough) this.enter('toBaler');
    } else if (this.phase === 'admire' && this.phaseTime > 1.6) {
      // the finished tree gets a moment of its own before the next one arrives
      this.nextTree();
    }
  }

  private onTap(): void {
    this.hints.noteInput();
    if (this.phase === 'admire' && this.phaseTime > 1.6) this.nextTree();
  }

  private nextTree(): void {
    if (this.changingTree) return;
    this.changingTree = true;
    this.fadeTarget = 1;
    window.setTimeout(() => {
      this.spawnTree((this.treeIndex + 1) % TREE_VARIANTS.length);
      this.enter('intro');
      this.rig.cut(this.shotFor('intro'));
      this.fadeTarget = 0;
      this.changingTree = false;
    }, 460);
  }

  // ----------------------------------------------------------------- phases

  private enter(p: Phase): void {
    this.phase = p;
    this.phaseTime = 0;
    if (p === 'toShaker') {
      this.travelFrom.copy(this.tree.root.position);
      this.travelTo.set(YARD.shaker.x, this.shaker.seatY, YARD.shaker.z);
    }
    if (p === 'shaking') {
      this.shaker.clamp = 1;
      this.audio.clampThunk();
    }
    if (p === 'toBaler') {
      this.travelFrom.copy(this.tree.root.position);
      this.travelTo.set(YARD.balerEntry.x, YARD.balerEntry.y, YARD.balerEntry.z);
      this.shaker.clamp = 0;
      this.audio.setMotor(0);
    }
    if (p === 'feeding') {
      this.net.object.visible = true;
    }
    if (p === 'compare') {
      this.audio.chime();
      this.audio.setRollers(0);
    }
    if (p === 'transport') {
      this.fadeTarget = 1;
      this.audio.setEngine(0.9);
    }
    if (p === 'release') {
      this.audio.setEngine(0);
    }
    if (p === 'admire') {
      this.audio.settle();
      this.audio.chime();
      this.hints.setDelay(this.treeIndex === 0 ? 2.6 : 4.5);
    }
    // guidance thins out once the child has seen the machines work
    if (p === 'intro') this.hints.setDelay(this.treeIndex === 0 ? 2.2 : 5.5);
  }

  private update(dt: number): void {
    this.phaseTime += dt;
    const g = this.gestures;
    g.beginFrame(dt);
    if (g.down) this.hints.noteInput();

    switch (this.phase) {
      case 'intro':
        this.hints.want('swipe-right', this.rig.isPortrait ? 0.34 : 0.28, this.rig.isPortrait ? 0.62 : 0.62);
        break;

      case 'toShaker': {
        const t = smoothstep(this.phaseTime / 1.5);
        const p = this.tree.root.position;
        p.lerpVectors(this.travelFrom, this.travelTo, easeInOutCubic(t));
        p.y += Math.sin(t * Math.PI) * 0.45;
        this.tree.root.rotation.y = lerp(this.tree.root.rotation.y, 0, dt * 3);
        this.treeBase.copy(p);
        if (t >= 1) this.enter('shaking');
        break;
      }

      case 'shaking': {
        this.hints.want('press', this.rig.isPortrait ? 0.5 : 0.42, this.rig.isPortrait ? 0.72 : 0.74);
        const holding = g.down;
        this.shaker.setLeverSmooth(holding ? 1 : 0, dt);
        const drive = damp(this.tree.shakeDrive, holding ? 1 : 0, holding ? 5.5 : 3.2, dt);
        this.tree.shakeDrive = drive;
        this.shaker.vibration = drive;
        this.audio.setMotor(drive);
        this.rig.setShake(drive * 0.9);
        if (holding) this.shakeHeld += dt * drive;

        // dry material only, and it leaves from the bottom of the tree upward
        const shed = this.tree.shedDry(this.shakeHeld / 3.4);
        const shedFront = clamp(this.shakeHeld / 3.4 + 0.15, 0, 1);
        this.spawnDebris(drive * 34 * dt + shed * 0.7, 0, shedFront, 0.5 + drive);
        this.spawnDebris(drive * 9 * dt, 1, 1, 0.6);
        this.spawnDebris(drive * 0.9 * dt, 2, 0.7, 0.7);
        if (drive > 0.15 && this.rng.next() < drive * 2.4 * dt * 8) this.audio.branchRub(drive * 0.7);
        this.audio.needleTick(this.debris.landings, dt);

        if (this.tree.shedProgress > 0.2 || this.treeIndex > 0) {
          this.hints.want('swipe-right', this.rig.isPortrait ? 0.62 : 0.6, 0.5);
        }
        break;
      }

      case 'toBaler': {
        const t = smoothstep(this.phaseTime / 1.9);
        const e = easeInOutCubic(t);
        const p = this.tree.root.position;
        p.lerpVectors(this.travelFrom, this.travelTo, e);
        p.y += Math.sin(t * Math.PI) * 0.3;
        // butt first: the tree lies down with its sawn end leading
        this.tree.root.rotation.set(0, 0, e * (Math.PI / 2));
        this.tree.shakeDrive = damp(this.tree.shakeDrive, 0, 4, dt);
        this.shaker.vibration = damp(this.shaker.vibration, 0, 6, dt);
        this.audio.setMotor(this.shaker.vibration);
        this.rig.setShake(this.shaker.vibration * 0.5);
        this.treeBase.copy(p);
        if (t >= 1) this.enter('feeding');
        break;
      }

      case 'feeding': {
        this.hints.want('swipe-vertical', this.rig.isPortrait ? 0.5 : 0.44, this.rig.isPortrait ? 0.7 : 0.66);
        // up-down strokes on the feed rollers drive the tree in
        const stroke = g.down ? Math.abs(g.frameDy) : 0;
        const rate = clamp(stroke * 0.55, 0, 0.05);
        this.feed = Math.min(1.78, this.feed + rate);
        const rolling = rate > 0.0005;
        // feeding harder rattles the branches as the cone forces them in
        this.tree.shakeDrive = damp(this.tree.shakeDrive, clamp(rate * 12, 0, 0.42), 8, dt);
        this.baler.rollerSpeed = damp(this.baler.rollerSpeed, rolling ? 7 : 0, 6, dt);
        this.audio.setRollers(rolling ? 0.9 : 0);
        if (rolling && this.rng.next() < 12 * dt) this.audio.branchRub(0.5 + rate * 6);

        const spec = this.tree.spec;
        this.tree.root.position.set(YARD.balerEntry.x + this.feed * spec.height, YARD.balerEntry.y, YARD.balerEntry.z);
        this.tree.setFoldFromFeed(this.feed);
        this.net.wrap = clamp(this.feed - this.baler.length / spec.height, 0, 1);
        this.treeBase.copy(this.tree.root.position);
        if (this.feed >= 1.72) this.enter('compare');
        break;
      }

      case 'compare': {
        this.hints.want(null);
        this.tree.shakeDrive = damp(this.tree.shakeDrive, 0, 4, dt);
        this.baler.rollerSpeed = damp(this.baler.rollerSpeed, 0, 4, dt);
        this.audio.setRollers(0);
        if (this.phaseTime > 2.8) this.enter('transport');
        break;
      }

      case 'transport': {
        this.hints.want(null);
        if (this.phaseTime > 0.9 && this.tree.root.position.x < 30) {
          // arrive standing up in the delivery hall, still netted
          this.tree.root.rotation.set(0, -0.35, 0);
          this.tree.root.position.set(this.lobby.stand.x, this.lobby.stand.y + 0.28, this.lobby.stand.z);
          this.treeGroundY = this.lobby.floorY;
          this.debris.setGround(this.lobby.floorY);
          this.treeBase.copy(this.tree.root.position);
          this.tree.update(0.016);
          this.rig.cut(this.shotFor('release'));
          this.fadeTarget = 0;
        }
        if (this.phaseTime > 1.9) this.enter('release');
        break;
      }

      case 'release': {
        this.hints.want('pull-down', this.rig.isPortrait ? 0.5 : 0.47, this.rig.isPortrait ? 0.78 : 0.8);
        if (g.down && !this.grabbing) {
          // where the child takes hold decides the rhythm of the opening
          this.grabbing = true;
          const grab = clamp(1 - g.y, 0, 1);
          this.pullGain = lerp(0.62, 1.15, grab);
          this.tree.releaseSpread = lerp(1.6, 0.55, grab);
        } else if (!g.down) {
          this.grabbing = false;
        }
        if (g.down && g.frameDy > 0) {
          this.pull += g.frameDy * this.pullGain;
          this.audio.setNetStretch(clamp(g.frameDy * 26, 0, 1), this.pull);
        } else {
          this.audio.setNetStretch(0, this.pull);
        }
        this.net.pull = clamp(this.pull * 0.7, 0, 1.6);
        // the front is rate limited: however hard the child pulls, the tree still
        // opens as a wave from the butt upward rather than all at once
        // the last stretch of net slips off on its own: no precise final pull
        const pulled = clamp(this.pull / 2.4, 0, 1);
        const wanted = pulled > 0.86 ? 1 : pulled;
        this.front = Math.min(wanted, this.front + dt * 0.62);
        const front = this.front;
        this.net.front = front;
        // the first quarter of the pull only takes up slack: the camera is fully
        // pulled back before any branch is free
        this.tree.setReleaseFront(clamp((front - 0.34) / 0.66, 0, 1));
        this.opened = Math.max(this.opened, front);

        for (let i = 0; i < this.net.snaps; i++) this.audio.netSnap();
        const pops = this.tree.consumePops();
        if (pops > 0) {
          this.audio.branchOpen(clamp(0.35 + pops * 0.25, 0.3, 1));
          const p = V();
          for (let i = 0; i < Math.min(4, pops * 2); i++) {
            if (this.tree.sampleFoliage(this.rng, p)) this.debris.spawn(p, 1, 0.6);
          }
        }
        if (front >= 1 && this.tree.foldAverage < 0.08) {
          if (!this.settleDone) {
            this.settleDone = true;
            this.phaseTime = 0;
          } else if (this.phaseTime > 1.4) {
            this.enter('admire');
          }
        }
        break;
      }

      case 'admire': {
        this.hints.want('tap', 0.5, this.rig.isPortrait ? 0.8 : 0.82);
        this.audio.setNetStretch(0, 0);
        break;
      }
    }

    // ---- shared per-frame work -------------------------------------------
    this.tree.update(dt);
    this.net.update(dt);
    this.debris.update(dt);
    this.shaker.update(dt);
    this.baler.update(dt, this.phase === 'feeding' && this.net.wrap > 0);
    this.hints.update(dt);

    const focus = this.treeBase;
    this.yard.setShadowFocus(focus.x, focus.z);
    this.treeShadow.position.set(focus.x, this.treeGroundY + 0.016, focus.z);
    const spread = this.phase === 'feeding' || this.phase === 'compare' ? 1.1 : 1 - this.tree.foldAverage * 0.55;
    this.treeShadow.scale.setScalar(clamp(this.tree.metrics.naturalRadius * spread, 0.5, 2.4));
    (this.treeShadow.material as THREE.Material).opacity = this.phase === 'transport' ? 0 : 0.55;

    this.net.setLOD(this.rig.distanceTo(focus) < 7.5);
    this.rig.to(this.shotFor(this.phase));
    this.rig.update(dt);

    this.fadeLevel = damp(this.fadeLevel, this.fadeTarget, 6, dt);
    this.fade.style.opacity = this.fadeTarget.toFixed(2);

    g.endFrame();
    this.publishState();
  }

  private spawnDebris(count: number, kind: 0 | 1 | 2, maxHeight: number, energy: number): void {
    let n = Math.floor(count);
    if (this.rng.next() < count - n) n++;
    const p = V();
    for (let i = 0; i < n; i++) {
      if (this.tree.sampleFoliage(this.rng, p, maxHeight)) this.debris.spawn(p, kind, energy);
    }
  }

  // ------------------------------------------------------------------ shots

  private shotFor(phase: Phase): Shot {
    const spec = this.tree.spec;
    const h = spec.height;
    const base = this.treeBase;
    const portrait = this.rig.isPortrait;
    const stand = this.lobby.stand;

    switch (phase) {
      case 'intro': {
        // one frame, two silhouettes: a wide tree and a narrow gate
        return portrait
          ? {
              // look along the line - fat tree in front, narrow gate beyond it
              from: V().set(-1, 0.14, 0.34),
              target: V().set(YARD.treeStart.x + 3.6, h * 0.56, YARD.treeStart.z - 0.4),
              fitWidth: 6.0,
              fitHeight: 6.0,
              fov: 58,
              lift: 0.09,
              speed: 1.9,
            }
          : {
              from: V().set(-0.58, 0.15, 0.82),
              target: V().set((YARD.treeStart.x + YARD.gate.x) / 2 - 1.1, h * 0.6, 0.5),
              fitWidth: 15.2,
              fitHeight: 6.2,
              fov: 50,
              lift: 0.06,
              speed: 1.9,
            };
      }

      case 'toShaker':
      case 'shaking': {
        // read the trunk and the branch tips at once, from the side
        return {
          from: V().set(-0.2, 0.19, 1),
          target: V().set(base.x + 0.2, base.y + h * 0.47, base.z),
          fitWidth: portrait ? 2.9 : 5.6,
          fitHeight: portrait ? 5.4 : h * 1.2,
          fov: 46,
          lift: portrait ? 0.11 : 0.05,
          speed: 1.5,
        };
      }

      case 'toBaler': {
        // three-quarter view of the mouth, tree swinging down into it
        return {
          from: V().set(-0.78, 0.28, 1),
          target: V().set(YARD.balerEntry.x - 1.1, YARD.axisHeight * 0.95, YARD.balerEntry.z + 0.3),
          fitWidth: portrait ? 4.4 : 8.0,
          fitHeight: 5.4,
          fov: 48,
          lift: 0.09,
          speed: 1.35,
        };
      }

      case 'feeding': {
        // travel alongside the tree while the cone folds it
        const lead = clamp(this.tree.root.position.x - h * 0.5, YARD.balerEntry.x - 1.2, YARD.gate.x - 0.4);
        return {
          from: V().set(-0.3, 0.26, 1),
          target: V().set(lead, YARD.axisHeight * 1.06, YARD.balerEntry.z + 0.2),
          fitWidth: portrait ? 4.4 : 9.0,
          fitHeight: portrait ? 4.8 : 4.6,
          fov: 49,
          lift: portrait ? 0.02 : 0.02,
          speed: 2.0,
        };
      }

      case 'compare': {
        // the finished bundle lying through the gate that would not take it before
        return {
          from: V().set(-0.45, 0.2, 1),
          target: V().set(YARD.gate.x - 0.4, 2.2, YARD.gate.z + 0.2),
          fitWidth: portrait ? 4.6 : 8.6,
          fitHeight: portrait ? 4.8 : 5.4,
          fov: 48,
          lift: 0.02,
          speed: 1.1,
        };
      }

      case 'transport': {
        // hold the yard framing until the tree has actually arrived
        if (this.tree.root.position.x < 30) return this.shotFor('compare');
        return {
          from: V().set(0.16, 0.24, 1),
          target: V().set(stand.x, 1.8, stand.z),
          fitWidth: portrait ? 3.0 : 6.2,
          fitHeight: 5.0,
          fov: 48,
          speed: 3.4,
        };
      }

      case 'release': {
        // close on the net end, then pull back so the whole tree is in frame
        // well before any branch lets go
        const closeIn = 1 - smoothstep(this.opened / 0.06);
        return {
          from: V().set(0.3, lerp(0.22, 0.08, closeIn), 1),
          target: V().set(stand.x, lerp(base.y + h * 0.5, base.y + 0.5, closeIn), stand.z),
          fitWidth: lerp(portrait ? 2.9 : 6.2, 1.3, closeIn),
          fitHeight: lerp(portrait ? 5.4 : h * 1.22, 1.3, closeIn),
          fov: 47,
          lift: portrait ? 0.1 : 0.04,
          speed: 3.2,
        };
      }

      case 'admire': {
        // the opened tree with a person beside it, for scale
        return {
          from: V().set(0.36, 0.14, 1),
          target: V().set(stand.x + 0.75, base.y + h * 0.46, stand.z + 0.4),
          fitWidth: portrait ? 4.2 : 6.6,
          fitHeight: portrait ? 5.6 : h * 1.3,
          fov: 46,
          lift: portrait ? 0.08 : 0.03,
          speed: 1.0,
        };
      }
    }
  }

  // ------------------------------------------------------------------- loop

  /** Minimal machine-readable state, used by the automated play-through test. */
  private publishState(): void {
    const w = window as unknown as { __treeGame?: Record<string, unknown> };
    w.__treeGame = {
      phase: this.phase,
      treeIndex: this.treeIndex,
      variant: this.tree.spec.key,
      feed: Number(this.feed.toFixed(3)),
      shed: Number(this.tree.shedProgress.toFixed(3)),
      fold: Number(this.tree.foldAverage.toFixed(3)),
      netFront: Number(this.net.front.toFixed(3)),
      opened: Number(this.opened.toFixed(3)),
      portrait: this.rig.isPortrait,
      webgpu: this.render.isWebGPU,
      quality: this.render.quality.tier,
      treeWidth: Number((this.tree.metrics.naturalRadius * 2).toFixed(2)),
      gateWidth: YARD.gateClearWidth,
    };
  }

  resize(): void {
    this.render.resize();
    this.rig.setViewport(this.render.size.w, this.render.size.h);
  }

  private lastTime = 0;

  frame = (now: number): void => {
    const t = now / 1000;
    const dt = this.lastTime === 0 ? 1 / 60 : Math.min(0.05, t - this.lastTime);
    this.lastTime = t;
    this.update(dt);
    this.render.renderer.render(this.scene, this.rig.camera);
    this.render.tick(dt * 1000);
  };

  dispose(): void {
    this.gestures.dispose();
    this.hints.dispose();
    this.tree.dispose();
    this.net.dispose();
    this.debris.dispose();
    this.yard.dispose();
    this.shaker.dispose();
    this.baler.dispose();
    this.lobby.dispose();
  }
}
