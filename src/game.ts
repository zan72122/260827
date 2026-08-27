// The game: a single continuous loop —
// land on the roof → carry the sack → peek into the flue → swipe down to
// squeeze through → land in the hearth → fill the stocking → finger beside
// the nose → swipe up to whoosh back — with no scores, timers or fail states.
import * as THREE from 'three';
import { World, LAYOUT, roofY } from './world';
import { Santa } from './santa';
import { Sled } from './sled';
import { Stocking } from './stocking';
import { buildGifts, Gift, GiftKind, updateGiftFlight } from './gifts';
import { ParticleSystem } from './particles';
import { CameraRig, Shot } from './camera';
import { InputManager, InputHandler } from './input';
import { UI } from './ui';
import { audio } from './audio';
import { metrics } from './metrics';
import {
  clamp, clamp01, lerp, damp, easeInOut, easeOut, easeIn,
  easeOutElastic, easeOutBack, Timeline, remap
} from './util';

type Phase =
  | 'intro' | 'walk' | 'peek' | 'entry' | 'descend' | 'landing' | 'gifts'
  | 'prepAscend' | 'nose' | 'awaitUp' | 'ascend' | 'roofReturn' | 'menu'
  | 'freeEnter' | 'free' | 'freeExit';

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function roofFeetY(x: number): number {
  return roofY(x) + 0.24;
}

export class Game {
  scene = new THREE.Scene();
  rig: CameraRig;
  world!: World;
  santa: Santa;
  sled!: Sled;
  stocking!: Stocking;
  gifts: Gift[] = [];
  soot: ParticleSystem;
  snowPuff: ParticleSystem;
  ui = new UI();
  input: InputManager;

  phase: Phase = 'intro';
  private tl: Timeline | null = null;
  private time = 0;
  private seed: number;

  // santa placement (root)
  private pos = new THREE.Vector3();
  private yaw = 0;
  private yawTarget = 0;

  // entry / descent state
  private entryE = 0;
  private p = 0;               // 0 flue top … 1 flue bottom
  private vel = 0;
  private dragAccum = 0;
  private dragXAccum = 0;
  private scrubRate = 0;       // event-time-based vertical drag velocity (screens/s)
  private lastDragT = 0;
  private touching = false;
  private lean = 0;
  private lastPaintP = -1;
  private movedRecently = 0;
  private retriedThisRun = false;

  // gift state
  private giftOrder = 0;
  private lastGift: GiftKind = 'ball';
  private reachTimer = 0;

  // hint state
  private idleT = 0;
  private hintCooldown = 0;
  private demoT = 0;

  // sled cinematics
  private sledFly = 0; // 0..1 landing progress

  // camera shot blending for the entry (compare → follow, continuous)
  private raycaster = new THREE.Raycaster();

  private noseArmed = false;   // upward swipe accepted
  private pendingLaunch = 0;

  // derived layout
  private get cx(): number { return LAYOUT.chimneyX; }
  private get cz(): number { return LAYOUT.chimneyZ; }

  // where Santa's root sits on the sleigh bench
  private seatPos(): THREE.Vector3 {
    return V3(LAYOUT.sledX, roofY(LAYOUT.sledX) + 0.36, LAYOUT.sledZ - 0.45);
  }
  private yShaftTop = 4.12;
  private yShaftBot = 0.98;

  fps = 60;
  debugMinVel = 0; // dev probe: most negative scrub velocity seen
  private upScrub = 0;

  constructor(seed: number, input: InputManager, aspect: number) {
    this.seed = seed;
    this.input = input;
    this.rig = new CameraRig(aspect);
    this.scene.fog = new THREE.Fog(0x101a30, 16, 60);

    this.santa = new Santa(seed);
    this.santa.root.visible = false;
    this.scene.add(this.santa.root);

    this.soot = new ParticleSystem(90, 0x1c1512, 0.05, -0.6, 0.8);
    this.snowPuff = new ParticleSystem(60, 0xdfe8f6, 0.06, -1.2, 0.8);
    this.scene.add(this.soot.points, this.snowPuff.points);

    this.buildWorld(seed);

    input.handler = this.makeInputHandler();
    this.wireUI();
    this.startIntro();
    this.rig.snapTo(this.shotFor(0));
  }

  // ------------------------------------------------------------------
  private buildWorld(seed: number): void {
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            for (const key of ['map', 'normalMap', 'roughnessMap'] as const) {
              const t = (m as THREE.MeshStandardMaterial)[key];
              if (t) t.dispose();
            }
            m.dispose();
          }
        }
      });
    }
    if (this.sled) this.scene.remove(this.sled.group);
    if (this.stocking) this.scene.remove(this.stocking.group);
    for (const g of this.gifts) this.scene.remove(g.group);

    this.world = new World(seed);
    this.scene.add(this.world.group);
    this.yShaftTop = LAYOUT.chimneyTopY - 0.9;
    this.yShaftBot = LAYOUT.shaftBottomY - 0.02;

    this.sled = new Sled(seed);
    const slopeAngle = Math.atan2(LAYOUT.ridgeY - LAYOUT.eaveY, LAYOUT.eaveX);
    this.sled.group.rotation.z = slopeAngle * (LAYOUT.sledX >= 0 ? -1 : 1);
    this.sled.group.position.set(LAYOUT.sledX, roofY(LAYOUT.sledX) + 0.2, LAYOUT.sledZ);
    this.scene.add(this.sled.group);

    this.stocking = new Stocking(seed + 40, this.world.variation.stockingHue);
    this.stocking.group.position.set(LAYOUT.stockingX, LAYOUT.stockingTopY, LAYOUT.stockingZ);
    this.scene.add(this.stocking.group);

    this.gifts = buildGifts(seed);
    const homes: [number, number, number][] = [
      [1.22, 0.09, -0.5], [1.56, 0.1, -0.34], [1.9, 0.13, -0.56]
    ];
    this.gifts.forEach((g, i) => {
      g.home.set(...homes[i]);
      g.group.position.copy(g.home);
      g.group.visible = false;
      this.scene.add(g.group);
    });
  }

  private wireUI(): void {
    this.ui.onAgain = () => {
      if (this.phase !== 'menu') return;
      this.ui.showMenu(false);
      this.resetRun();
      this.startWalkFromSled();
    };
    this.ui.onNewHouse = () => {
      if (this.phase !== 'menu') return;
      this.ui.showMenu(false);
      this.seed = (this.seed * 16807 + 13) % 2147483647;
      this.resetRun();
      this.buildWorld(this.seed);
      this.startIntro();
    };
    this.ui.onFree = () => {
      if (this.phase !== 'menu') return;
      this.ui.showMenu(false);
      this.startFreeEnter();
    };
    this.ui.onExitFree = () => {
      if (this.phase !== 'free') return;
      this.ui.showExit(false);
      this.startFreeExit();
    };
  }

  private resetRun(): void {
    this.stocking.reset();
    this.giftOrder = 0;
    for (const g of this.gifts) {
      g.state = 'idle';
      g.group.visible = false;
      g.group.scale.setScalar(1);
      g.group.position.copy(g.home);
      g.group.rotation.set(0, 0, 0);
    }
    if (this.santa.bagDetached) this.santa.reattachBag(1);
    this.santa.bagBaseScale = 1;
    this.santa.squash = 0;
    this.santa.bagSquash = 0;
    this.retriedThisRun = false;
    this.noseArmed = false;
    this.pendingLaunch = 0;
  }

  // ------------------------------------------------------------------
  // phase starters
  // ------------------------------------------------------------------
  private startIntro(): void {
    this.phase = 'intro';
    this.santa.root.visible = false;
    this.sledFly = 0;
    this.world.showSledTracks(0);
    const tl = new Timeline();
    tl.add(0.4, 3.2, (t) => {
      this.sledFly = t;
      const e = easeInOut(t);
      const sx = LAYOUT.sledX, sz = LAYOUT.sledZ;
      const startY = roofY(sx) + 4.2;
      const y = lerp(startY, roofY(sx) + 0.2, easeOut(e));
      const z = lerp(sz + 9, sz, e);
      this.sled.group.position.set(sx, y, z);
      this.sled.group.rotation.x = Math.sin(t * Math.PI) * -0.12;
      if (t > 0.72) this.world.showSledTracks(remap(t, 0.72, 1, 0, 1));
    });
    tl.call(3.4, () => {
      audio.softLand();
      audio.sleighBell();
      this.snowPuff.emit(this.sled.group.position.clone().add(V3(0, 0.1, 0.4)), 10, 0.5, 0.5, 0.9);
    });
    tl.call(4.0, () => {
      // Santa steps out beside the sled
      this.santa.root.visible = true;
      this.pos.set(LAYOUT.sledX + 0.15, roofFeetY(LAYOUT.sledX + 0.15), LAYOUT.sledZ - 1.0);
      this.yaw = this.yawTarget = Math.PI;
      this.santa.setPose({ carry: 1 }, true);
    });
    tl.then(() => this.startWalk());
    this.tl = tl;
  }

  private startWalkFromSled(): void {
    // replay entry: Santa is already on the roof beside the sled
    this.santa.root.visible = true;
    this.pos.set(LAYOUT.sledX + 0.15, roofFeetY(LAYOUT.sledX + 0.15), LAYOUT.sledZ - 1.0);
    this.yaw = this.yawTarget = Math.PI;
    this.santa.setPose({ carry: 1 }, true);
    this.startWalk();
  }

  private startWalk(): void {
    this.phase = 'walk';
    const from = this.pos.clone();
    const to = V3(LAYOUT.standX, roofFeetY(LAYOUT.standX), LAYOUT.standZ);
    const mid = V3(1.5, roofFeetY(1.5), -0.55);
    const tl = new Timeline();
    tl.add(0, 3.0, (t) => {
      const e = easeInOut(t);
      // quadratic bezier walk path
      const a = from.clone().lerp(mid, e);
      const b = mid.clone().lerp(to, e);
      const pt = a.lerp(b, e);
      pt.y = roofFeetY(pt.x);
      const dir = Math.atan2(
        (b.x - a.x) || 0.0001,
        (b.z - a.z) || -0.0001
      );
      this.yawTarget = dir;
      this.pos.copy(pt);
      this.santa.walkSpeed = 0.85;
      this.santa.setPose({ carry: 1 });
    });
    tl.then(() => {
      this.santa.walkSpeed = 0;
      this.yawTarget = -Math.PI / 2; // face the chimney (west)
      this.startPeek();
    });
    this.tl = tl;
  }

  private startPeek(): void {
    this.phase = 'peek';
    this.tl = null;
    this.idleT = 0;
    this.hintCooldown = 4.5;
    this.entryE = 0;
    this.santa.setPose({ peek: 1, carry: 0.25 });
    this.santa.peekPhase = 1;
  }

  private startEntry(): void {
    this.phase = 'entry';
    metrics.firstInput();
    this.santa.peekPhase = 0;
    this.idleT = 0;
  }

  private startDescend(free: boolean): void {
    this.phase = free ? 'free' : 'descend';
    this.p = 0.02;
    this.upScrub = 0;
    this.vel = 0;
    this.lean = 0;
    this.lastPaintP = -1;
    this.idleT = 0;
    this.hintCooldown = 7;
    this.santa.setPose({ tuck: 1 });
  }

  private startLanding(): void {
    this.phase = 'landing';
    metrics.descentDone();
    audio.setSlide(0, 0);
    const feet = () => this.pos.clone().add(V3(0, 0.05, 0));
    const tl = new Timeline();
    // drop from the flue into the firebox, squash releasing with a soft bounce
    tl.add(0, 0.5, (t) => {
      this.pos.y = lerp(this.yShaftBot, LAYOUT.fireboxFloorY + 0.02, easeIn(t));
      this.santa.squash = lerp(1, 0.55, t);
      this.santa.bagSquash = lerp(1, 0.4, t);
      this.santa.setPose({ squat: t, tuck: 1 - t });
    });
    tl.call(0.5, () => {
      audio.landThump();
      this.soot.emit(feet(), 14, 0.35, 1.1, 1.1);
      this.world.paintSoot(0.985, 0.5, 0.6);
    });
    tl.add(0.5, 0.8, (t) => {
      this.santa.squash = lerp(0.55, 0, easeOutElastic(t));
      this.santa.bagSquash = lerp(0.4, 0, easeOutElastic(t));
      this.santa.setPose({ squat: lerp(1, 0.75, t), carry: 0.3 * t });
    });
    // duck out of the firebox into the room, stepping aside so the hearth
    // and stocking stay readable in frame
    tl.add(1.5, 1.4, (t) => {
      const e = easeInOut(t);
      this.pos.x = lerp(this.cx, 2.05, e);
      this.pos.z = lerp(this.cz, -0.92, e);
      this.pos.y = LAYOUT.fireboxFloorY + 0.02 * (1 - e);
      this.yawTarget = 0.5;
      this.santa.walkSpeed = 0.5;
      const clear = remap(this.pos.z, -1.15, -0.75, 0, 1);
      this.santa.setPose({ squat: (1 - clear) * 0.75, carry: 0.3 });
    });
    tl.call(2.9, () => {
      this.santa.walkSpeed = 0;
    });
    // brush the soot out of the beard
    tl.add(3.0, 1.3, (t) => {
      const pulse = Math.sin(clamp01(t) * Math.PI);
      this.santa.setPose({ brushBeard: pulse, carry: 0.3 });
    });
    tl.call(3.35, () => {
      const face = new THREE.Vector3();
      this.santa.faceTarget.getWorldPosition(face);
      this.soot.emit(face.add(V3(0, -0.15, 0.1)), 8, 0.16, 0.15, 1.0);
    });
    tl.call(3.6, () => this.soot.emit(this.pos.clone().add(V3(0, 1.2, 0.2)), 4, 0.14, 0.1, 0.8));
    // set the sack down by the hearth
    tl.call(4.4, () => {
      this.santa.detachBag(this.scene);
    });
    tl.add(4.4, 0.8, (t) => {
      const e = easeInOut(t);
      const b = this.santa.bagNode;
      b.position.lerp(V3(2.35, 0.44, -0.85), e * 0.5 + (t >= 1 ? 1 : 0));
      b.quaternion.slerp(new THREE.Quaternion(), e * 0.5);
      if (t >= 1) {
        b.position.set(2.35, 0.44, -0.85);
        b.quaternion.identity();
      }
    });
    // the gifts appear beside the open sack
    for (let i = 0; i < 3; i++) {
      tl.call(5.15 + i * 0.18, () => {
        const g = this.gifts[i];
        g.group.visible = true;
        g.group.scale.setScalar(0.01);
        audio.giftPluck(i);
      });
      tl.add(5.15 + i * 0.18, 0.4, (t) => {
        const g = this.gifts[i];
        if (g.state === 'idle') g.group.scale.setScalar(easeOutBack(t));
      });
    }
    tl.then(() => this.startGifts());
    this.tl = tl;
  }

  private startGifts(): void {
    this.phase = 'gifts';
    this.tl = null;
    this.idleT = 0;
    this.hintCooldown = 7;
    this.yawTarget = -0.9; // semi-profile, facing the stocking
    this.santa.setPose({ kneel: 0.4 });
  }

  private startPrepAscend(): void {
    this.phase = 'prepAscend';
    const tl = new Timeline();
    const from = this.pos.clone();
    // walk to the sack
    tl.add(0, 0.9, (t) => {
      const e = easeInOut(t);
      this.pos.x = lerp(from.x, 2.2, e);
      this.pos.z = lerp(from.z, -0.78, e);
      this.yawTarget = Math.PI / 2;
      this.santa.walkSpeed = 0.6;
      this.santa.setPose({});
    });
    // pick the sack back up (slimmer now)
    tl.call(0.95, () => {
      this.santa.reattachBag(0.8);
      this.santa.bagBaseScale = 0.8;
    });
    tl.add(0.9, 0.5, (t) => {
      this.santa.walkSpeed = 0;
      this.santa.setPose({ squat: Math.sin(t * Math.PI) * 0.6, carry: t });
    });
    // step to the hearth's front edge, kneel under the mantel, face out —
    // the head must stay in front of the chimney-breast wall so the
    // face close-up reads (he hops back under the flue at launch)
    tl.add(1.5, 1.3, (t) => {
      const e = easeInOut(t);
      this.pos.x = lerp(2.2, this.cx, e);
      this.pos.z = lerp(-0.78, -0.88, e);
      this.yawTarget = lerp(Math.PI / 2, 0, e);
      this.santa.walkSpeed = 0.55;
      const inside = remap(this.pos.z, -0.9, -1.3, 0, 1);
      this.santa.setPose({ carry: 1, squat: inside * 0.6 });
    });
    tl.then(() => {
      this.santa.walkSpeed = 0;
      this.santa.setPose({ carry: 0.7, squat: 0.55, faceCam: 1 });
      this.startNose();
    });
    this.tl = tl;
  }

  private startNose(): void {
    this.phase = 'nose';
    this.tl = null;
    this.idleT = 0;
    this.demoT = 1.4;
    this.hintCooldown = 6;
  }

  private triggerNose(): void {
    if (this.phase !== 'nose') return;
    this.phase = 'awaitUp';
    this.santa.wink();
    audio.noseChime();
    const tl = new Timeline();
    tl.add(0, 0.55, (t) => {
      this.santa.setPose({ nose: t, squat: 0.55, carry: 0.5, faceCam: 1 });
    });
    tl.add(0.55, 0.8, (t) => {
      // anticipation crouch, still holding the nose pose
      this.santa.setPose({ nose: 1 - t * 0.5, squat: 0.55 + t * 0.15, carry: 0.6, faceCam: 1 });
    });
    tl.then(() => {
      this.tl = null;
      this.idleT = 0;
      this.hintCooldown = 5;
      if (this.pendingLaunch > 0) this.startAscend();
    });
    this.tl = tl;
    this.noseArmed = true;
  }

  private startAscend(): void {
    this.phase = 'ascend';
    audio.whooshUp();
    const tl = new Timeline();
    tl.add(0, 0.45, (t) => {
      this.santa.squash = t;
      this.santa.bagSquash = t;
      this.santa.setPose({ launch: t, squat: (1 - t) * 0.8 });
      this.pos.x = lerp(this.pos.x, this.cx, t * 0.6);
      this.pos.z = lerp(this.pos.z, this.cz, t * 0.6);
    });
    tl.add(0.45, 0.75, (t) => {
      const e = easeIn(t) * 0.4 + t * 0.6;
      this.pos.x = lerp(this.pos.x, this.cx, 0.4);
      this.pos.z = lerp(this.pos.z, this.cz, 0.4);
      this.pos.y = lerp(LAYOUT.fireboxFloorY, this.yShaftTop + 0.55, e);
      if (Math.random() < 0.35) {
        this.world.paintSoot(clamp01(1 - e), 0.5 + (Math.random() - 0.5) * 0.2, 0.35);
      }
    });
    tl.call(1.05, () => {
      this.soot.emit(V3(this.cx, LAYOUT.chimneyTopY + 0.25, this.cz), 16, 0.3, 1.6, 1.2);
    });
    // pop out of the mouth, arc over to the rooftop
    tl.add(1.05, 0.6, (t) => {
      const e = easeOut(t);
      this.pos.x = lerp(this.cx, LAYOUT.standX, e);
      this.pos.z = lerp(this.cz, LAYOUT.standZ, e);
      const base = lerp(this.yShaftTop + 0.55, roofFeetY(LAYOUT.standX), e);
      this.pos.y = base + Math.sin(t * Math.PI) * 0.55;
      this.santa.squash = 1 - easeOutElastic(t);
      this.santa.bagSquash = 1 - easeOutElastic(t);
      this.santa.setPose({ launch: 1 - t, carry: t * 0.8 });
      this.yawTarget = Math.PI * 0.75;
    });
    tl.then(() => this.startRoofReturn());
    this.tl = tl;
  }

  private startRoofReturn(): void {
    this.phase = 'roofReturn';
    metrics.loopCompleted();
    const tl = new Timeline();
    // brush the snow & soot off the coat
    tl.add(0.2, 1.5, (t) => {
      const pulse = Math.sin(clamp01(t) * Math.PI);
      this.santa.setPose({ brushSnow: pulse, carry: 0.4 });
    });
    tl.call(0.6, () => this.snowPuff.emit(this.pos.clone().add(V3(0, 1.0, 0.15)), 8, 0.3, 0.3, 0.8));
    tl.call(1.1, () => this.soot.emit(this.pos.clone().add(V3(0, 0.9, 0.15)), 5, 0.25, 0.2, 0.8));
    // walk back to the sleigh
    const to = V3(LAYOUT.sledX + 0.15, 0, LAYOUT.sledZ - 0.95);
    tl.add(1.8, 2.4, (t) => {
      const e = easeInOut(t);
      const from = V3(LAYOUT.standX, 0, LAYOUT.standZ);
      const mid = V3(1.4, 0, -0.6);
      const a = from.clone().lerp(mid, e);
      const b = mid.clone().lerp(to, e);
      const pt = a.lerp(b, e);
      this.pos.x = pt.x;
      this.pos.z = pt.z;
      this.pos.y = roofFeetY(pt.x);
      this.yawTarget = Math.atan2(b.x - a.x || 0.001, b.z - a.z || 0.001);
      this.santa.walkSpeed = 0.8;
      this.santa.setPose({ carry: 1 });
    });
    // hop onto the bench
    tl.add(4.2, 0.8, (t) => {
      this.santa.walkSpeed = 0;
      const e = easeInOut(t);
      this.pos.lerp(this.seatPos(), e);
      this.pos.y += Math.sin(t * Math.PI) * 0.3;
      this.yawTarget = 0;
      this.santa.setPose({ sit: t, carry: 1 - t });
    });
    tl.call(5.2, () => audio.sleighBell());
    tl.then(() => this.startMenu());
    this.tl = tl;
  }

  private startMenu(): void {
    this.phase = 'menu';
    this.tl = null;
    this.santa.setPose({ sit: 1, wave: 0.6 });
    this.ui.showMenu(true);
  }

  // free play: quick auto re-entry (the squeeze plays again, fast), then scrub
  private startFreeEnter(): void {
    this.phase = 'freeEnter';
    this.santa.setPose({ carry: 1 }, true);
    const tl = new Timeline();
    // hop from the sled to the chimney side
    tl.add(0, 1.0, (t) => {
      const e = easeInOut(t);
      const to = V3(LAYOUT.standX, roofFeetY(LAYOUT.standX), LAYOUT.standZ);
      this.pos.lerpVectors(this.seatPos(), to, e);
      this.pos.y += Math.sin(t * Math.PI) * 0.35;
      this.yawTarget = -Math.PI / 2;
      this.santa.setPose({ carry: 1, sit: 1 - t });
    });
    // fast squeeze-in (the signature move replayed, ~1.4s)
    tl.add(1.1, 1.4, (t) => {
      this.entryE = t;
      this.applyEntry(t);
    });
    tl.then(() => {
      this.startDescend(true);
      this.ui.showExit(true);
    });
    this.tl = tl;
  }

  private startFreeExit(): void {
    this.phase = 'freeExit';
    audio.whooshUp();
    const yStart = this.pos.y;
    const tl = new Timeline();
    tl.add(0, 0.7, (t) => {
      this.pos.y = lerp(yStart, this.yShaftTop + 0.55, easeIn(t) * 0.4 + t * 0.6);
    });
    tl.call(0.72, () => {
      this.soot.emit(V3(this.cx, LAYOUT.chimneyTopY + 0.25, this.cz), 12, 0.3, 1.5, 1.1);
    });
    tl.add(0.72, 0.6, (t) => {
      const e = easeOut(t);
      this.pos.x = lerp(this.cx, LAYOUT.standX, e);
      this.pos.z = lerp(this.cz, LAYOUT.standZ, e);
      this.pos.y = lerp(this.yShaftTop + 0.55, roofFeetY(LAYOUT.standX), e) + Math.sin(t * Math.PI) * 0.5;
      this.santa.squash = 1 - easeOutElastic(t);
      this.santa.bagSquash = 1 - easeOutElastic(t);
      this.santa.setPose({ carry: t });
    });
    // walk back & sit
    tl.add(1.4, 1.4, (t) => {
      const e = easeInOut(t);
      const to = this.seatPos();
      const from = V3(LAYOUT.standX, roofFeetY(LAYOUT.standX), LAYOUT.standZ);
      this.pos.lerpVectors(from, to, e);
      this.pos.y += Math.sin(t * Math.PI) * 0.25;
      this.santa.walkSpeed = t < 0.8 ? 0.7 : 0;
      this.yawTarget = lerp(Math.PI * 0.6, 0, e);
      this.santa.setPose({ carry: 1 - t, sit: t });
    });
    tl.then(() => {
      this.santa.walkSpeed = 0;
      this.startMenu();
    });
    this.tl = tl;
  }

  // ------------------------------------------------------------------
  // entry choreography: continuous, scrubbed by the first downward swipe
  // ------------------------------------------------------------------
  // Three readable beats, all in one camera move:
  //  1) hop onto the rim (still fat — his width vs the mouth is the mystery)
  //  2) THE SQUEEZE, above the mouth where it can be seen: shoulders, belly,
  //     coat, fur trim and sack compress together while he wiggles in
  //  3) the slide: the now-slim Santa sinks into the flue
  private applyEntry(e: number): void {
    const stand = V3(LAYOUT.standX, roofFeetY(LAYOUT.standX), LAYOUT.standZ);
    const perch = V3(this.cx + 0.3, LAYOUT.chimneyTopY - 0.55, this.cz);
    const squeezed = V3(this.cx, LAYOUT.chimneyTopY - 0.85, this.cz);
    const inShaft = V3(this.cx, this.yShaftTop, this.cz);
    if (e < 0.3) {
      const t = easeInOut(e / 0.3);
      this.pos.lerpVectors(stand, perch, t);
      this.pos.y += Math.sin(t * Math.PI) * 0.42;
      this.yawTarget = lerp(-Math.PI / 2, 0, t); // turn to face the camera
      this.santa.setPose({ peek: 1 - t, rimSit: t, carry: (1 - t) * 0.3 });
      this.santa.squash = 0;
      this.santa.bagSquash = t * 0.15;
      this.santa.lean = 0;
    } else if (e < 0.68) {
      const t = (e - 0.3) / 0.38;
      this.pos.lerpVectors(perch, squeezed, easeInOut(t));
      this.yawTarget = 0;
      this.santa.squash = easeInOut(t);
      this.santa.bagSquash = clamp01(t * 1.2);
      // legs straighten into the flue quickly so the boots never poke
      // through the chimney's front wall
      this.santa.setPose({ rimSit: Math.max(0, 1 - t * 2.2), tuck: Math.min(1, t * 2.2) });
      // effortful wiggle while the body presses through the opening
      this.santa.lean = Math.sin(t * 19) * 0.5 * Math.sin(Math.min(1, t * 1.4) * Math.PI);
    } else {
      const t = easeInOut((e - 0.68) / 0.32);
      this.pos.lerpVectors(squeezed, inShaft, t);
      this.yawTarget = 0;
      this.santa.squash = 1;
      this.santa.bagSquash = 1;
      this.santa.setPose({ tuck: 1 });
      this.santa.lean = Math.sin(t * 8) * 0.2 * (1 - t);
    }
  }

  // ------------------------------------------------------------------
  // input
  // ------------------------------------------------------------------
  private makeInputHandler(): InputHandler {
    return {
      onDown: (x, y) => {
        audio.unlock();
        this.touching = true;
        this.dragAccum = 0;
        this.dragXAccum = 0;
        this.scrubRate = 0;
        this.lastDragT = performance.now();
        this.idleT = 0;
      },
      onDrag: (dx, dy, x, y) => {
        this.idleT = 0;
        if (this.phase === 'peek') {
          this.dragAccum += dy;
          if (this.dragAccum > 0.018) {
            this.startEntry();
          }
        } else if (this.phase === 'entry') {
          this.entryE = clamp01(this.entryE + Math.max(0, dy) * 1.7);
        } else if (this.phase === 'descend' || this.phase === 'free') {
          // velocity from event timestamps — robust across frame rates
          const now = performance.now();
          const dtE = clamp((now - this.lastDragT) / 1000, 0.004, 0.1);
          this.lastDragT = now;
          this.scrubRate = lerp(this.scrubRate, dy / dtE, 0.45);
          this.dragXAccum += dx;
        } else if (this.phase === 'nose') {
          this.dragAccum += dy;
          if (this.dragAccum < -0.05) {
            // upward swipe during the nose beat: forgive & fast-track
            this.pendingLaunch = 1;
            this.triggerNose();
          }
        } else if (this.phase === 'awaitUp') {
          this.dragAccum += dy;
          if (this.dragAccum < -0.035 && this.noseArmed) {
            if (this.tl) {
              this.pendingLaunch = 1; // anticipation still playing — queue it
            } else {
              this.startAscend();
            }
          }
        }
      },
      onUp: (wasTap, x, y) => {
        this.touching = false;
        if (!wasTap) return;
        this.handleTap(x, y);
      }
    };
  }

  private handleTap(x01: number, y01: number): void {
    const ndc = new THREE.Vector2(x01 * 2 - 1, -(y01 * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    if (this.phase === 'gifts') {
      const targets = this.gifts.filter((g) => g.state === 'idle').map((g) => g.hit);
      const hits = this.raycaster.intersectObjects(targets, false);
      if (hits.length > 0) {
        const gift = this.gifts.find((g) => g.hit === hits[0].object)!;
        this.throwGift(gift);
      }
    } else if (this.phase === 'nose') {
      const hits = this.raycaster.intersectObject(this.santa.noseHit, false);
      if (hits.length > 0) {
        this.triggerNose();
      }
    } else if (this.phase === 'peek') {
      // tapping Santa/chimney: encouraging hop + a stronger peek — feedback
      // that keeps the tap-happy child engaged until the swipe lands
      const hits = this.raycaster.intersectObjects([this.santa.root], true);
      if (hits.length > 0) {
        this.santa.wink();
        audio.hintChime();
      }
    }
  }

  private throwGift(gift: Gift): void {
    gift.state = 'flying';
    gift.flyT = 0;
    gift.from.copy(gift.group.position);
    audio.giftPluck(this.giftOrder);
    this.reachTimer = 0.9;
    this.idleT = 0;
  }

  // ------------------------------------------------------------------
  // camera shots
  // ------------------------------------------------------------------
  private shotFor(dt: number): Shot {
    const portrait = window.innerHeight > window.innerWidth;
    const cx = this.cx, cz = this.cz;
    const sy = this.pos.y;
    const mk = (px: number, py: number, pz: number, lx: number, ly: number, lz: number, fov: number): Shot => ({
      pos: V3(px, py, pz), look: V3(lx, ly, lz), fov
    });
    const face = new THREE.Vector3();

    switch (this.phase) {
      case 'intro': {
        const s = this.sled.group.position;
        return portrait
          ? mk(6.2, 6.3, 8.8, lerp(1.2, 1.6, this.sledFly), lerp(5.6, 4.4, this.sledFly), s.z * 0.3, 50)
          : mk(7.0, 6.0, 8.2, lerp(1.2, 1.6, this.sledFly), lerp(5.4, 4.3, this.sledFly), s.z * 0.3, 44);
      }
      case 'walk':
        return portrait
          ? mk(5.0, 5.8, 4.8, 1.9, 4.25, -0.5, 46)
          : mk(5.3, 5.4, 4.4, 1.85, 4.15, -0.5, 41);
      case 'peek':
        // low 3/4 that reads Santa-vs-flue width side by side, sky above
        return this.compareShot(portrait);
      case 'entry': {
        // continuous blend: compare shot → descent follow, one camera move
        const b = easeInOut(remap(this.entryE, 0.62, 0.98, 0, 1));
        const compare = this.compareShot(portrait);
        const follow = this.followShot(portrait, sy);
        return {
          pos: compare.pos.lerp(follow.pos, b),
          look: compare.look.lerp(follow.look, b),
          fov: lerp(compare.fov, follow.fov, b)
        };
      }
      case 'descend':
      case 'free':
        return this.followShot(portrait, sy);
      case 'landing': {
        const t = this.tl ? this.tl.time : 0;
        if (t < 1.2) return this.followShot(portrait, Math.max(sy, 0.7));
        return portrait
          ? mk(0.7, 1.5, 3.0, 1.32, 0.75, -1.2, 49)
          : mk(0.2, 1.45, 2.4, 1.35, 0.75, -1.2, 42);
      }
      case 'gifts':
        // hearth, Santa's hands, stocking bottom in one mid-closeup
        return portrait
          ? mk(0.8, 1.35, 3.3, 1.35, 0.6, -1.0, 50)
          : mk(0.35, 1.2, 2.45, 1.4, 0.62, -1.0, 42);
      case 'prepAscend':
        return portrait
          ? mk(0.8, 1.4, 3.3, 1.38, 0.72, -1.2, 50)
          : mk(0.3, 1.3, 2.5, 1.4, 0.72, -1.2, 42);
      case 'nose':
      case 'awaitUp': {
        this.santa.faceTarget.getWorldPosition(face);
        return portrait
          ? { pos: face.clone().add(V3(0.16, 0.2, 1.3)), look: face.clone().add(V3(0, 0.04, 0)), fov: 38 }
          : { pos: face.clone().add(V3(0.24, 0.18, 1.2)), look: face.clone().add(V3(0, 0.04, 0)), fov: 35 };
      }
      case 'ascend':
        return this.followShot(portrait, sy);
      case 'roofReturn':
        return portrait
          ? mk(4.9, 5.6, 5.4, 1.9, 4.3, -0.4, 46)
          : mk(5.2, 5.3, 4.9, 1.9, 4.15, -0.4, 41);
      case 'menu':
        return portrait
          ? mk(4.7, 6.2, 8.5, 0.15, 3.95, 0.2, 48)
          : mk(5.8, 5.9, 7.5, 0.4, 3.7, 0.2, 43);
      case 'freeEnter': {
        const t = this.tl ? this.tl.time : 0;
        if (t < 1.1) return this.compareShot(portrait);
        const b = easeInOut(remap(this.entryE, 0.62, 0.98, 0, 1));
        const compare = this.compareShot(portrait);
        const follow = this.followShot(portrait, sy);
        return {
          pos: compare.pos.lerp(follow.pos, b),
          look: compare.look.lerp(follow.look, b),
          fov: lerp(compare.fov, follow.fov, b)
        };
      }
      case 'freeExit':
        return this.followShot(portrait, Math.min(sy, this.yShaftTop));
    }
  }

  // side-ish shot that puts the flue mouth width and Santa's body width in
  // the same frame, sled and sky readable behind
  private compareShot(portrait: boolean): Shot {
    return portrait
      ? { pos: V3(1.35, 5.2, 5.7), look: V3(1.8, 4.5, -1.62), fov: 46 }
      : { pos: V3(0.5, 4.85, 4.6), look: V3(1.78, 4.45, -1.62), fov: 40 };
  }

  // descent follow: vertical brick section beside Santa; in landscape the
  // camera sits off-axis so flue-section and room share the frame
  private followShot(portrait: boolean, sy: number): Shot {
    const cx = this.cx, cz = this.cz;
    const y = clamp(sy, 0.85, this.yShaftTop + 0.4);
    if (portrait) {
      return {
        pos: V3(cx + 0.05, y + 1.25, cz + 3.2),
        look: V3(cx, y + 0.95, cz),
        fov: 46
      };
    }
    return {
      pos: V3(cx + 0.95, y + 1.2, cz + 2.9),
      look: V3(cx - 0.25, y + 0.92, cz),
      fov: 41
    };
  }

  // ------------------------------------------------------------------
  // per-frame update
  // ------------------------------------------------------------------
  update(dt: number): void {
    dt = Math.min(dt, 0.09);
    this.time += dt;

    if (this.tl) {
      const alive = this.tl.update(dt);
      if (!alive && this.tl && this.tl.time >= this.tl.duration) {
        // .then() callbacks may have replaced this.tl already
      }
    }

    this.updatePhase(dt);
    this.updateHints(dt);

    // gift flights
    if (this.phase === 'gifts' || this.phase === 'prepAscend') {
      const mouth = V3(LAYOUT.stockingX, LAYOUT.stockingTopY + 0.08, LAYOUT.stockingZ + 0.02);
      for (const g of this.gifts) {
        if (updateGiftFlight(g, dt, mouth)) {
          this.stocking.addGift(g.kind, this.giftOrder);
          this.lastGift = g.kind;
          this.giftOrder++;
          audio.stockingPop();
          if (this.giftOrder >= 3) {
            const tl = new Timeline();
            tl.call(0.7, () => this.stocking.showPeek(this.lastGift));
            tl.call(1.9, () => this.startPrepAscend());
            this.tl = tl;
          }
        }
        // idle bob
        if (g.state === 'idle' && g.group.visible) {
          g.group.position.y = g.home.y + Math.sin(this.time * 2.2 + g.bob) * 0.015;
          g.group.rotation.y += dt * 0.4;
        }
      }
      if (this.reachTimer > 0) {
        this.reachTimer -= dt;
        this.santa.setPose({ kneel: 0.4, reach: Math.sin(clamp01(this.reachTimer / 0.9) * Math.PI) });
      }
    }

    // fades: reveal the flue section while Santa is inside the house
    this.updateFades();

    // santa transform
    this.yaw = damp(this.yaw, this.yawTarget, 7, dt);
    this.santa.root.position.copy(this.pos);
    this.santa.root.rotation.y = this.yaw;
    this.santa.update(dt, this.time);

    // flue lamp follows Santa whenever he is inside the chimney; during the
    // nose beat it doubles as a soft face fill so the face reads clearly
    {
      const lamp = this.world.descentLamp;
      const inShaft =
        this.phase === 'descend' || this.phase === 'free' || this.phase === 'ascend' ||
        this.phase === 'freeExit' ||
        ((this.phase === 'entry' || this.phase === 'freeEnter') && this.entryE > 0.4) ||
        (this.phase === 'landing' && (this.tl?.time ?? 9) < 1.0);
      const onFace = this.phase === 'nose' || this.phase === 'awaitUp';
      lamp.intensity = damp(lamp.intensity, inShaft ? 2.0 : onFace ? 2.6 : 0, 5, dt);
      if (inShaft) {
        lamp.position.set(this.cx + 0.05, this.pos.y + 1.35, this.cz + 0.5);
      } else if (onFace) {
        const face = new THREE.Vector3();
        this.santa.faceTarget.getWorldPosition(face);
        lamp.position.copy(face).add(V3(0.1, 0.12, 1.0));
      }
    }

    // world & particles
    this.world.update(dt, this.rig.y);
    this.stocking.update(dt);
    this.soot.update(dt);
    this.snowPuff.update(dt);

    // camera
    this.rig.lambda =
      this.phase === 'descend' || this.phase === 'free' || this.phase === 'ascend' ? 6.5 :
      this.phase === 'entry' || this.phase === 'freeEnter' ? 3.2 :
      this.phase === 'nose' || this.phase === 'awaitUp' ? 3.5 : 2.0;
    this.rig.update(this.shotFor(dt), dt);

    this.ui.setDebug(
      `phase: ${this.phase}\nfps: ${this.fps.toFixed(0)}\np: ${this.p.toFixed(2)} v: ${this.vel.toFixed(2)}\n${metrics.summary()}`
    );
  }

  private updatePhase(dt: number): void {
    switch (this.phase) {
      case 'peek': {
        this.santa.peekPhase = 1;
        break;
      }
      case 'entry': {
        // gentle assist while touching; auto-complete past the tipping point
        if (this.touching) this.entryE = clamp01(this.entryE + dt * 0.1);
        else if (this.entryE > 0.55) this.entryE = clamp01(this.entryE + dt * 0.75);
        this.applyEntry(this.entryE);
        if (this.entryE >= 1) this.startDescend(false);
        break;
      }
      case 'descend':
      case 'free': {
        // scrub velocity from the event-based drag rate; a stopped finger
        // decays the rate quickly so Santa halts where the child holds
        const target = this.touching ? clamp(this.scrubRate * 0.3, -0.9, 0.9) : 0;
        this.scrubRate *= Math.exp(-dt * 6);
        this.vel = damp(this.vel, target, this.touching ? 10 : 7, dt);
        this.debugMinVel = Math.min(this.debugMinVel, this.vel);
        const prevP = this.p;
        this.p = this.p + this.vel * dt;

        // lean against the flue walls with horizontal drags
        const leanTarget = clamp(this.dragXAccum * 6, -1, 1);
        this.dragXAccum *= Math.exp(-dt * 4);
        this.lean = damp(this.lean, this.touching ? leanTarget : 0, 5, dt);

        if (this.phase === 'free') {
          // springy bounce at both ends
          if (this.p >= 0.985) {
            this.p = 0.985;
            if (this.vel > 0.12) {
              audio.softLand();
              this.soot.emit(this.pos.clone().add(V3(0, 0.1, 0)), 8, 0.3, 0.9, 0.9);
            }
            this.vel = Math.min(0, -this.vel * 0.35);
          }
          if (this.p <= 0.015) {
            this.p = 0.015;
            this.vel = Math.max(0, -this.vel * 0.35);
          }
        } else {
          if (this.p <= 0.01) {
            this.p = 0.01;
            this.vel = Math.max(this.vel, 0);
          }
          // scrubbing back up after real progress = replaying the move
          // (displacement-based so it works at any frame/event rate)
          if (prevP > 0.25) this.upScrub += Math.max(0, prevP - this.p);
          if (!this.retriedThisRun && this.upScrub > 0.07) {
            this.retriedThisRun = true;
            metrics.retry();
          }
          if (this.p >= 1) {
            this.p = 1;
            this.startLanding();
          }
        }

        // place santa in the shaft
        const maxLeanOff = LAYOUT.innerHalf - 0.245;
        this.pos.set(
          this.cx + this.lean * maxLeanOff,
          lerp(this.yShaftTop, this.yShaftBot, this.p),
          this.cz
        );
        this.santa.squash = 1;
        this.santa.bagSquash = 1;
        this.santa.lean = this.lean;
        this.santa.descentSpeed = this.vel;
        const speed01 = clamp01(Math.abs(this.vel) / 0.85);
        // wobble when paused right after motion
        if (Math.abs(this.vel) < 0.04) {
          this.movedRecently = Math.max(0, this.movedRecently - dt * 0.5);
        } else {
          this.movedRecently = 1;
        }
        this.santa.wobble = Math.abs(this.vel) < 0.04 ? this.movedRecently : 0.15;

        // soot: trail smudges + airborne flecks when moving fast
        if (this.lastPaintP < 0 || Math.abs(this.p - this.lastPaintP) > 0.022) {
          this.lastPaintP = this.p;
          const bellyY = this.pos.y + 0.85;
          const v = clamp01((LAYOUT.chimneyTopY - bellyY) / (LAYOUT.chimneyTopY - LAYOUT.shaftBottomY));
          this.world.paintSoot(v, 0.5 + this.lean * 0.3, speed01);
        }
        if (speed01 > 0.45 && Math.random() < speed01 * 0.5) {
          this.soot.emit(this.pos.clone().add(V3((Math.random() - 0.5) * 0.3, 0.9, 0.1)), 2, 0.2, 0.6, 0.9);
        }
        audio.setSlide(speed01, dt);
        break;
      }
      case 'nose': {
        // gentle self-demonstration: Santa touches his own nose
        this.demoT -= dt;
        if (this.demoT <= 0) {
          this.demoT = 5.5;
          const tl = new Timeline();
          tl.add(0, 1.5, (t) => {
            const pulse = Math.sin(clamp01(t) * Math.PI);
            this.santa.setPose({ nose: pulse * 0.9, squat: 0.55, carry: 0.6, faceCam: 1 });
          });
          this.tl = tl;
        }
        break;
      }
      default:
        break;
    }
    this.santa.descentSpeed = this.phase === 'descend' || this.phase === 'free' ? this.vel : 0;
    if (this.phase !== 'descend' && this.phase !== 'free') {
      this.santa.wobble = 0;
      // entry phases drive lean themselves (the squeeze wiggle)
      if (this.phase !== 'entry' && this.phase !== 'freeEnter') {
        this.santa.lean *= Math.exp(-dt * 6);
      }
      audio.setSlide(0, dt);
    }
  }

  private updateFades(): void {
    switch (this.phase) {
      case 'intro': case 'walk': case 'peek': case 'roofReturn': case 'menu':
        this.world.setFrontFade(1);
        this.world.setHouseFade(1);
        break;
      case 'entry':
      case 'freeEnter':
        this.world.setFrontFade(this.entryE > 0.6 ? 0 : 1);
        this.world.setHouseFade(this.entryE > 0.68 ? 0 : 1);
        break;
      case 'descend': case 'free': case 'ascend': case 'freeExit':
        this.world.setFrontFade(0);
        this.world.setHouseFade(0);
        break;
      case 'landing':
        this.world.setFrontFade(this.tl && this.tl.time > 2.6 ? 1 : 0);
        this.world.setHouseFade(0);
        break;
      case 'gifts': case 'prepAscend':
        this.world.setFrontFade(1);
        this.world.setHouseFade(0);
        break;
      case 'nose': case 'awaitUp':
        this.world.setFrontFade(1);
        this.world.setHouseFade(0);
        break;
    }
  }

  // wordless nudges when the child is stuck
  private updateHints(dt: number): void {
    const interactive =
      this.phase === 'peek' || this.phase === 'gifts' ||
      this.phase === 'nose' || this.phase === 'awaitUp';
    if (!interactive) return;
    this.idleT += dt;
    if (this.idleT > this.hintCooldown) {
      this.idleT = 0;
      this.hintCooldown = 7;
      metrics.hint();
      audio.hintChime();
      if (this.phase === 'peek') {
        // snow motes drift down into the mouth; Santa's sway is already running
        this.world.showHintMotes();
      } else if (this.phase === 'gifts') {
        // gifts do a little jump
        for (const g of this.gifts) {
          if (g.state === 'idle') g.bob += Math.PI; // phase-kick the bob
        }
        const tl = new Timeline();
        tl.add(0, 0.8, (t) => {
          for (const g of this.gifts) {
            if (g.state === 'idle' && g.group.visible) {
              g.group.position.y = g.home.y + Math.sin(clamp01(t) * Math.PI) * 0.12;
            }
          }
        });
        this.tl = this.tl ?? tl;
      } else if (this.phase === 'nose') {
        this.demoT = 0.01; // re-run the self-demo right away
      } else if (this.phase === 'awaitUp') {
        // upward soot swirl inside the flue mouths the way out
        this.soot.emit(this.pos.clone().add(V3(0, 1.4, 0)), 6, 0.2, 1.4, 1.2);
      }
    }
  }
}
