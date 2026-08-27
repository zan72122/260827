import * as THREE from 'three';
import { OutsideScene } from './outside';
import { InsideScene, PathSystem, StarPoints } from './inside';
import { Present, PresentKind } from './presents';
import { UI } from './ui';
import { clamp, easeIn, easeInOut, easeOut, easeOutBack, lerp, smoothstep } from './util';

type State =
  | 'outside' | 'dragging' | 'entering'
  | 'tunnelIn' | 'inside' | 'settling' | 'storedWait'
  | 'tunnelOut' | 'exiting'
  | 'lift' | 'menu'
  | 'diveIn' | 'flyEnter' | 'fly';

const KINDS: PresentKind[] = ['horse', 'plush', 'wheel'];

function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class App {
  renderer: THREE.WebGLRenderer;
  camera = new THREE.PerspectiveCamera(45, 1, 0.05, 220);
  outside = new OutsideScene();
  inside = new InsideScene();
  ui = new UI();
  state: State = 'outside';
  private tState = 0;
  private present: Present | null = null;
  private presentIndex = 0;
  storedCount = 0;
  private everStored = false;
  private mouthMode = false;
  private time = 0;
  private last = performance.now();

  // input
  private pointerId: number | null = null;
  private ndc = new THREE.Vector2();
  private ray = new THREE.Raycaster();
  private dragging = false;
  private downAt = { x: 0, y: 0, t: 0 };
  private nextHintAt = 6; // wordless stardust invitation timer

  // entry / camera blending scratch
  private camFromPos = new THREE.Vector3();
  private camFromQuat = new THREE.Quaternion();
  private entryGrabPos = new THREE.Vector3();
  private entryGrabQuat = new THREE.Quaternion();
  private qEntry = new THREE.Quaternion();
  private mouth = new THREE.Vector3();

  // inside travel
  private path = new PathSystem();
  private followYaw = 0;
  private captureBay = -1;
  private settleFrom = new THREE.Vector3();
  private settleTo = new THREE.Vector3();
  private settleQuatFrom = new THREE.Quaternion();

  // fly mode
  private flyYaw = 0;
  private flyPitch = 0;
  private flyDown = false;
  private lastPointer = new THREE.Vector2();

  // dynamic resolution
  private resScale: number;
  private maxScale: number;
  private frameAcc = 0; private frameN = 0; private resTimer = 0;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    container.appendChild(this.renderer.domElement);

    const q = new URLSearchParams(location.search).get('q');
    this.maxScale = Math.min(devicePixelRatio || 1, 2);
    this.resScale = q === 'low' ? Math.min(0.8, this.maxScale) : this.maxScale;

    this.onResize();
    addEventListener('resize', () => this.onResize());
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));

    this.spawnPresent();
    this.outside.applyCamera(this.camera, this.portrait);

    // instrumentation for tests / perf verification
    (window as any).__game = {
      state: () => this.state,
      stored: () => this.storedCount,
      presentXY: () => this.present ? this.worldToScreen(this.present.group.position.clone().add(new THREE.Vector3(0, 0.5, 0))) : null,
      mouthXY: () => { this.outside.sack.mouthWorld(this.mouth); return this.worldToScreen(this.mouth); },
      bayXY: (i: number) => this.worldToScreen(this.inside.bays[i].anchor),
      presentPos: () => this.present ? this.present.group.position.toArray() : null,
      info: () => ({
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
        calls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        resScale: this.resScale,
      }),
      fps: () => this.frameN > 0 ? 1000 / (this.frameAcc / this.frameN) : 0,
    };

    this.renderer.setAnimationLoop(() => this.tick());
  }

  get portrait() { return innerHeight > innerWidth; }

  private worldToScreen(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight, behind: p.z > 1 };
  }

  private onResize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.resScale);
    this.renderer.setSize(w, h);
    if (this.state === 'outside' || this.state === 'dragging' || this.state === 'menu' || this.state === 'lift') {
      this.outside.applyCamera(this.camera, this.portrait);
    }
  }

  private setState(s: State) {
    this.state = s;
    this.tState = 0;
  }

  private spawnPresent() {
    const kind = KINDS[this.presentIndex % KINDS.length];
    this.presentIndex++;
    const p = new Present(kind);
    p.group.position.copy(this.outside.presentSpot);
    p.group.rotation.y = kind === 'wheel' ? 0.5 : 0.25;
    p.group.scale.setScalar(0.01);
    p.group.userData.spawnT = this.time;
    this.outside.scene.add(p.group);
    this.present = p;
  }

  // ------------------------------------------------------------ input
  private setNdc(e: PointerEvent, yOffset = 0) {
    this.ndc.set(
      (e.clientX / innerWidth) * 2 - 1,
      -(e.clientY / innerHeight) * 2 + 1 + yOffset
    );
  }

  private onDown(e: PointerEvent) {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.lastPointer.set(e.clientX, e.clientY);
    this.downAt = { x: e.clientX, y: e.clientY, t: this.time };
    this.nextHintAt = this.time + 9;

    if (this.state === 'outside') {
      this.setNdc(e);
      this.ray.setFromCamera(this.ndc, this.camera);
      // generous, four-year-old sized hit areas: raycast OR near on screen
      const grabR = Math.min(innerWidth, innerHeight) * 0.22;
      let hitPresent = false;
      if (this.present) {
        const pXY = this.worldToScreen(this.present.group.position.clone().add(new THREE.Vector3(0, 0.55, 0)));
        hitPresent = Math.hypot(pXY.x - e.clientX, pXY.y - e.clientY) < grabR ||
          this.ray.intersectObject(this.present.group, true).length > 0;
      }
      this.outside.sack.mouthWorld(this.mouth);
      const mXY = this.worldToScreen(this.mouth);
      const hitSack = this.ray.intersectObject(this.outside.sack.mesh, false).length > 0 ||
        Math.hypot(mXY.x - e.clientX, mXY.y - e.clientY) < grabR;
      if (hitPresent) {
        this.dragging = true;
        this.setState('dragging');
        // start preloading the inside while the child is busy dragging
      } else if (hitSack && this.mouthMode) {
        this.enterEmpty();
      } else if (hitSack) {
        // friendly feedback: the sack breathes open a little more
        this.outside.sack.jiggle = 0.25;
      }
    } else if (this.state === 'inside' && this.present) {
      // a stroke always starts at the present — no wrong place to touch
      const dust = this.inside.newPathDust();
      this.path.begin(this.present.group.position, dust);
      this.inside.hideGuide();
      this.feedPath(e);
    } else if (this.state === 'fly') {
      this.flyDown = true;
    }
  }

  private onMove(e: PointerEvent) {
    if (e.pointerId !== this.pointerId) return;
    if (this.state === 'dragging' && this.present) {
      this.dragOutside(e);
    } else if (this.state === 'inside' && this.path.active && this.path.fingerDown) {
      this.feedPath(e);
    } else if (this.state === 'fly') {
      const dx = (e.clientX - this.lastPointer.x) / innerWidth;
      const dy = (e.clientY - this.lastPointer.y) / innerHeight;
      this.flyYaw -= dx * 2.4;
      this.flyPitch = clamp(this.flyPitch - dy * 1.8, -1.1, 1.1);
      this.lastPointer.set(e.clientX, e.clientY);
    }
  }

  private onUp(e: PointerEvent) {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    if (this.state === 'dragging') {
      this.dragging = false;
      // a quick tap (the first thing a four-year-old tries): answer with
      // the stardust invitation flying from the present into the mouth
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
      if (moved < 14 && this.time - this.downAt.t < 0.45 && this.present) {
        this.outside.playHint(this.present.group.position);
        this.nextHintAt = this.time + 7;
        this.setState('outside');
        return;
      }
      // let go near the mouth: the cloth leans over and takes it anyway
      if (this.present) {
        this.outside.sack.mouthWorld(this.mouth);
        if (this.present.group.position.distanceTo(this.mouth) < 1.9) {
          this.beginEntry();
          return;
        }
      }
      this.setState('outside');
    } else if (this.state === 'inside') {
      this.path.release();
    } else if (this.state === 'fly') {
      this.flyDown = false;
    }
  }

  /** outside drag: the present tracks the finger in screen space
   *  (carried through the air at roughly the sack's depth) */
  private dragOutside(e: PointerEvent) {
    const p = this.present!;
    this.outside.sack.mouthWorld(this.mouth);
    this.setNdc(e, 0.10);
    this.ray.setFromCamera(this.ndc, this.camera);
    const carryDepth = this.camera.position.distanceTo(this.mouth) - 0.55;
    const target = this.ray.ray.origin.clone().addScaledVector(this.ray.ray.direction, carryDepth);
    target.x = clamp(target.x, -3.2, 3.0);
    target.y = clamp(target.y + Math.sin(this.time * 3.1) * 0.03, 0.25, 2.6);
    target.z = clamp(target.z, -1.8, 3.2);
    p.group.position.lerp(target, 0.35);

    // sack feels the present coming: mouth leans + opens toward it
    const sack = this.outside.sack;
    const d = new THREE.Vector3().subVectors(p.group.position, this.mouth);
    const dist = d.length();
    d.y = 0;
    if (d.lengthSq() > 0.001) sack.leanDir.copy(d.normalize());
    sack.leanAmt = smoothstep(2.6, 0.7, dist);
    sack.open = clamp(0.25 + smoothstep(2.4, 0.8, dist) * 0.75, 0, 1);
    this.outside.santa.hold = clamp(0.5 + smoothstep(2.4, 0.9, dist), 0, 1);

    // near enough: the sack takes it (generous, no precision needed)
    if (dist < 1.0) this.beginEntry();
  }

  /** map a finger position to a world point on the warehouse draw sheet */
  private feedPath(e: PointerEvent) {
    this.setNdc(e, 0.14); // present rides above the finger, never hidden by it
    this.ray.setFromCamera(this.ndc, this.camera);
    const world = new THREE.Vector3();
    const hit = this.ray.ray.intersectPlane(this.inside.drawPlane, world);
    if (!hit || world.distanceTo(this.camera.position) > 44) {
      // pointing at the sky: take a far point and drop it onto the sheet
      world.copy(this.ray.ray.origin).addScaledVector(this.ray.ray.direction, 32);
      this.inside.drawPlane.projectPoint(world.clone(), world);
    }
    world.x = clamp(world.x, -16, 16);
    world.z = clamp(world.z, -30, 10);
    this.path.feed(world);
  }

  // ------------------------------------------------------------ big moments
  private beginEntry() {
    const p = this.present!;
    this.dragging = false;
    this.pointerId = null;
    this.entryGrabPos.copy(p.group.position);
    this.entryGrabQuat.copy(p.group.quaternion);
    // orientation in which this present goes through the mouth
    this.qEntry.setFromUnitVectors(p.entryAxis, new THREE.Vector3(0, -1, 0));
    this.camFromPos.copy(this.camera.position);
    this.camFromQuat.copy(this.camera.quaternion);
    this.setState('entering');
  }

  private enterEmpty() {
    this.camFromPos.copy(this.camera.position);
    this.camFromQuat.copy(this.camera.quaternion);
    if (!this.inside.built) this.inside.buildAll();
    this.setState('diveIn');
  }

  private returnOutside() {
    this.ui.hideAll();
    this.camFromPos.copy(this.camera.position);
    this.camFromQuat.copy(this.camera.quaternion);
    this.setState('tunnelOut');
  }

  // ------------------------------------------------------------ per-state updates
  private tick() {
    const now = performance.now();
    const dtRaw = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    const dt = dtRaw;
    this.time += dt;
    this.tState += dt;

    // dynamic resolution
    this.frameAcc += dtRaw * 1000; this.frameN++;
    this.resTimer += dtRaw;
    if (this.resTimer > 1.5 && this.frameN > 20) {
      const avg = this.frameAcc / this.frameN;
      if (avg > 26 && this.resScale > 0.55) {
        this.resScale = Math.max(0.55, this.resScale * 0.85);
        this.renderer.setPixelRatio(this.resScale);
      } else if (avg < 15 && this.resScale < this.maxScale) {
        this.resScale = Math.min(this.maxScale, this.resScale * 1.08);
        this.renderer.setPixelRatio(this.resScale);
      }
      this.frameAcc = 0; this.frameN = 0; this.resTimer = 0;
    }

    // background preload of the inside while the child plays outside
    if (!this.inside.built && (this.state === 'dragging' || this.state === 'entering')) {
      this.inside.buildStep();
    }

    const outsideActive = ['outside', 'dragging', 'entering', 'exiting', 'lift', 'menu', 'diveIn'].includes(this.state);
    if (outsideActive) this.updateOutside(dt);
    else this.updateInside(dt);

    this.present?.update(dt);
    this.renderer.render(outsideActive ? this.outside.scene : this.inside.scene, this.camera);
  }

  private updateOutside(dt: number) {
    const sack = this.outside.sack;
    const santa = this.outside.santa;
    let breeze = 0;

    if (this.state === 'outside') {
      // the invitation loop: santa parts the mouth wide enough to SEE it
      // breathe, a breath escapes, the ribbon leans — no arrows, no words
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 0.9);
      santa.hold = 0.35 + pulse * 0.6;
      sack.open = 0.10 + pulse * 0.35;
      sack.leanAmt *= 0.95;
      breeze = pulse;
      if (this.present) {
        const p = this.present;
        // spawn pop
        const age = this.time - (p.group.userData.spawnT ?? 0);
        const s = age < 0.6 ? easeOutBack(clamp(age / 0.6, 0, 1)) : 1;
        p.group.scale.setScalar(Math.max(0.01, s));
        // always faintly alive; every few seconds a tiny eager hop
        const hopPhase = (this.time % 3.2);
        let hop = 0;
        let rotZ = Math.sin(this.time * 1.5) * 0.012;
        if (hopPhase < 0.55 && age > 1.2) {
          hop = Math.abs(Math.sin(hopPhase / 0.55 * Math.PI * 2)) * 0.07 * (hopPhase < 0.28 ? 1 : 0.55);
          rotZ += Math.sin(hopPhase * 23) * 0.03;
        }
        p.sway.rotation.z = rotZ;
        // no touch for a while: the stardust invitation plays by itself
        if (this.time > this.nextHintAt && !this.outside.hintPlaying && age > 1.2) {
          this.outside.playHint(p.group.position);
          this.nextHintAt = this.time + 7;
        }
        // settles back to the floor if it was dropped mid-air
        const floorY = Math.max(0, p.group.position.y - Math.max(2.2 * dt, p.group.position.y * 6 * dt));
        p.group.position.y = floorY + hop;
        // ribbon feels the breeze from the sack
        const toSack = new THREE.Vector3().subVectors(sack.group.position, p.group.position);
        toSack.y = 0;
        const local = toSack.normalize().applyQuaternion(p.group.quaternion.clone().invert());
        p.applyBreeze(pulse * 0.9, local);
      }
    } else if (this.state === 'dragging') {
      breeze = 1;
      if (this.present) this.present.group.scale.setScalar(1);
    } else if (this.state === 'entering') {
      breeze = 0.8;
      this.updateEntering(dt);
    } else if (this.state === 'exiting') {
      this.updateExiting(dt);
    } else if (this.state === 'lift') {
      this.updateLift(dt);
    } else if (this.state === 'diveIn') {
      // camera-only dive at the mouth (free-flight / in-and-out play)
      const sack = this.outside.sack;
      sack.mouthWorld(this.mouth);
      const T = 1.2;
      const k = easeInOut(clamp(this.tState / T, 0, 1));
      sack.open = lerp(sack.open, 1, k);
      const above = this.mouth.clone().add(new THREE.Vector3(0, 1.3, 0.9));
      const into = this.mouth.clone().add(new THREE.Vector3(0, 0.15, 0));
      const pos = new THREE.Vector3();
      if (k < 0.5) pos.lerpVectors(this.camFromPos, above, k / 0.5);
      else pos.lerpVectors(above, into, (k - 0.5) / 0.5);
      const look = this.mouth.clone().add(new THREE.Vector3(0, lerp(0.3, -1.2, k), 0));
      const m = new THREE.Matrix4().lookAt(pos, look, k < 0.3 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, -1));
      this.camera.position.copy(pos);
      this.camera.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(m), 0.25);
      if (pos.y - this.mouth.y < 0.3) {
        sack.open = 0.15;
        this.camera.up.set(0, 0, -1);
        this.setState('flyEnter');
      }
    } else if (this.state === 'menu') {
      santa.hold = 0.3 + 0.2 * Math.sin(this.time * 0.9);
      sack.open = 0.1 + 0.08 * Math.sin(this.time * 0.9);
    }

    // the sack opens wide while the invitation flies
    if (this.outside.hintPlaying) {
      sack.open = Math.max(sack.open, 0.85);
      santa.hold = 1;
    }
    // contact shadow keeps the present grounded (fades while carried)
    if (this.present && this.state !== 'entering') {
      const pp = this.present.group.position;
      this.outside.contactShadow.visible = true;
      this.outside.contactShadow.position.set(pp.x, 0.012, pp.z);
      const h = clamp(1 - pp.y * 0.55, 0.15, 1);
      this.outside.contactShadow.scale.setScalar(Math.max(0.01, this.present.group.scale.x * h));
      (this.outside.contactShadow.material as THREE.MeshBasicMaterial).opacity = h;
    } else {
      this.outside.contactShadow.visible = false;
    }

    this.outside.update(dt, breeze);
  }

  private updateEntering(dt: number) {
    const p = this.present!;
    const sack = this.outside.sack;
    sack.mouthWorld(this.mouth);
    const t = this.tState;
    const T_APPROACH = 0.55, T_PAUSE = 0.42, T_SQUEEZE = 0.58, T_SUCK = 0.34;
    const hover = this.mouth.clone().add(new THREE.Vector3(0, 0.72, 0));

    this.outside.santa.hold = 1;
    const d = new THREE.Vector3().subVectors(p.group.position, sack.group.position);
    d.y = 0;
    if (d.lengthSq() > 0.001) sack.leanDir.copy(d.normalize());

    if (t < T_APPROACH) {
      // glide over the mouth, rotate into entry pose; cloth reaches for it
      const k = easeInOut(t / T_APPROACH);
      p.group.position.lerpVectors(this.entryGrabPos, hover, k);
      p.group.quaternion.slerpQuaternions(this.entryGrabQuat, this.qEntry, k);
      sack.open = lerp(sack.open, 1, k);
      sack.leanAmt = 1 - k;
    } else if (t < T_APPROACH + T_PAUSE) {
      // a beat at the entrance: it clearly does NOT fit... and yet
      const k = (t - T_APPROACH) / T_PAUSE;
      sack.open = 1; sack.leanAmt = 0;
      const nudge = Math.max(0, Math.sin(k * Math.PI * 2)) * 0.05;
      p.group.position.copy(hover).add(new THREE.Vector3(0, -nudge, 0));
      p.setSqueeze(nudge * 2.2); // paper starts to give at each little push
    } else if (t < T_APPROACH + T_PAUSE + T_SQUEEZE) {
      // wrap + ribbon compress, tip slides in
      const k = easeInOut((t - T_APPROACH - T_PAUSE) / T_SQUEEZE);
      p.setSqueeze(k * 0.85);
      const y = lerp(hover.y, this.mouth.y + 0.02, k);
      p.group.position.set(this.mouth.x, y, this.mouth.z);
      sack.open = 1 + k * 0.25;
    } else if (t < T_APPROACH + T_PAUSE + T_SQUEEZE + T_SUCK) {
      // SPON — swallowed whole
      const k = easeIn((t - T_APPROACH - T_PAUSE - T_SQUEEZE) / T_SUCK);
      p.setSqueeze(0.85 + k * 0.15);
      p.group.position.set(this.mouth.x, lerp(this.mouth.y + 0.02, this.mouth.y - 0.85, k), this.mouth.z);
      p.group.scale.setScalar(lerp(1, 0.8, k));
      sack.open = 1.25 - k * 0.5;
      if (k > 0.9 && sack.jiggle < 0.5) sack.jiggle = 1;
    }

    // camera: follow from behind/above, dive at the mouth — red cloth swallows the frame
    const camStart = T_APPROACH + T_PAUSE + T_SQUEEZE * 0.45;
    const camT = clamp((t - camStart) / (T_PAUSE + T_SQUEEZE * 0.55 + T_SUCK + 0.22), 0, 1);
    if (camT > 0) {
      const k = easeInOut(camT);
      const above = this.mouth.clone().add(new THREE.Vector3(0, 1.5, 1.0));
      const into = this.mouth.clone().add(new THREE.Vector3(0, 0.16, 0));
      const pos = new THREE.Vector3();
      if (k < 0.45) pos.lerpVectors(this.camFromPos, above, k / 0.45);
      else pos.lerpVectors(above, into, (k - 0.45) / 0.55);
      const lookTgt = this.mouth.clone().add(new THREE.Vector3(0, lerp(0.4, -1.2, k), 0));
      const q0 = this.camera.quaternion.clone();
      this.camera.position.copy(pos);
      const upMix = new THREE.Vector3(0, 1, 0).lerp(new THREE.Vector3(0, 0, -1), smoothstep(0.25, 0.6, k)).normalize();
      const m = new THREE.Matrix4().lookAt(pos, lookTgt, upMix);
      const q1 = new THREE.Quaternion().setFromRotationMatrix(m);
      this.camera.quaternion.copy(q0.slerp(q1, 0.22));
      // the cut hides where red cloth fills the whole frame
      if (this.camera.position.y - this.mouth.y < 0.30) {
        this.startTunnelIn();
        return;
      }
    }
  }

  private startTunnelIn() {
    if (!this.inside.built) this.inside.buildAll();
    const p = this.present!;
    this.outside.scene.remove(p.group);
    this.inside.scene.add(p.group);      // SAME object: paper, ribbon, rotation all continuous
    p.group.scale.setScalar(1);
    this.outside.sack.open = 0.15;
    this.outside.sack.leanAmt = 0;
    this.outside.santa.hold = 0.3;
    this.camera.up.set(0, 0, -1);
    this.setState('tunnelIn');
  }

  private updateTunnelIn(dt: number) {
    const T_RIDE = 3.0, T_BLEND = 1.7;
    const p = this.present!;
    const curve = this.inside.tunnelCurve;
    const t = this.tState;

    if (t < T_RIDE) {
      const u = lerp(0.985, 0.06, easeInOut(t / T_RIDE)); // curve runs top(1)->bottom(0)? no: p(0)=top
      // NOTE: curve param 0 is at the TOP (mouth). We ride 0 -> 1.
      const uu = lerp(0.015, 0.94, easeInOut(t / T_RIDE));
      void u;
      const camPos = curve.getPointAt(uu);
      const ahead = curve.getPointAt(Math.min(uu + 0.085, 1));
      const tangent = curve.getTangentAt(uu);
      this.camera.position.copy(camPos);
      const up = new THREE.Vector3(0, 0, -1).lerp(new THREE.Vector3(0, 1, 0), easeInOut(uu)).normalize();
      this.camera.up.copy(up);
      this.camera.lookAt(ahead);
      // present travels ahead of us, still squeezed, then POPS back to shape
      const pu = Math.min(uu + 0.075, 0.985);
      p.group.position.copy(curve.getPointAt(pu));
      const relax = clamp((uu - 0.22) / 0.3, 0, 1);
      p.setSqueeze(lerp(1, 0, easeOutBack(relax)));
      const qTangent = new THREE.Quaternion().setFromUnitVectors(p.entryAxis, curve.getTangentAt(pu).normalize());
      const upright = new THREE.Quaternion();
      p.group.quaternion.copy(qTangent.slerp(upright, smoothstep(0.55, 0.95, uu)));
      void tangent;
    } else if (t < T_RIDE + T_BLEND) {
      const k = easeInOut((t - T_RIDE) / T_BLEND);
      const rest = this.inside.restPos(this.portrait);
      const target = this.inside.restTarget(this.portrait);
      const endPos = this.inside.tunnelCurve.getPointAt(0.94);
      const mouthUp = this.inside.tunnelCurve.getPointAt(0.45); // the glowing way we came in
      this.camera.up.set(0, 1, 0);
      this.camera.position.lerpVectors(endPos, rest, k);
      // brief look BACK up at the mouth — "we came through THERE" —
      // then swing down to the three bays
      const lookK = smoothstep(0.3, 0.75, k);
      const look = mouthUp.clone().lerp(target, lookK);
      this.camera.lookAt(look);
      p.group.position.lerp(this.inside.presentSpot, k * 0.5);
      p.group.quaternion.slerp(new THREE.Quaternion(), k);
    } else {
      const p2 = this.present!;
      p2.group.position.copy(this.inside.presentSpot);
      p2.resetSway();
      this.followYaw = p2.group.rotation.y;
      if (!this.everStored) this.inside.showGuide(this.inside.presentSpot);
      this.setState('inside');
    }
  }

  private updateInside(dt: number) {
    this.inside.update(dt);
    const p = this.present;
    // headlamp keeps the present readable while riding the tunnel
    const inTunnel = this.state === 'tunnelIn' || this.state === 'tunnelOut' || this.state === 'flyEnter';
    this.inside.travelLight.intensity = lerp(this.inside.travelLight.intensity, inTunnel ? 13 : 0, 0.15);
    if (inTunnel) this.inside.travelLight.position.copy(this.camera.position);
    // the travelling present carries its own pool of warm light
    if (p && (this.state === 'inside' || this.state === 'settling' || this.state === 'tunnelIn')) {
      this.inside.presentLight.position.copy(p.group.position).add(new THREE.Vector3(0, 1.6, 1.2));
      this.inside.presentLight.intensity = 9;
    } else {
      this.inside.presentLight.intensity = 0;
    }

    switch (this.state) {
      case 'tunnelIn': this.updateTunnelIn(dt); break;

      case 'inside': {
        if (!p) break;
        if (this.path.active) {
          const out = { pos: new THREE.Vector3(), tangent: new THREE.Vector3() };
          const speed = this.path.update(dt, out);
          p.group.position.copy(out.pos).add(new THREE.Vector3(0, Math.sin(this.time * 2.2) * 0.05, 0));
          // face along travel; sway wrapped paper + ribbon by curvature
          if (speed > 0.3) {
            const targetYaw = Math.atan2(-out.tangent.z, out.tangent.x);
            this.followYaw = lerpAngle(this.followYaw, targetYaw, 0.08);
            p.group.rotation.set(0, this.followYaw, 0);
          }
          p.applyTravelSway(this.path.curvature, speed);
          // reaching a bay — any bay is the right bay
          for (let i = 0; i < this.inside.bays.length; i++) {
            if (p.group.position.distanceTo(this.inside.bays[i].anchor) < 4.0) {
              this.beginSettle(i);
              break;
            }
          }
        } else {
          // gentle float while waiting for a stroke
          p.group.position.y = this.inside.presentSpot.y + Math.sin(this.time * 1.1) * 0.12;
        }
        // camera: calm, breathing only — never fighting the finger
        const rest = this.inside.restPos(this.portrait);
        const target = this.inside.restTarget(this.portrait);
        const drift = p ? p.group.position.clone().sub(this.inside.presentSpot).multiplyScalar(0.06) : new THREE.Vector3();
        drift.clampLength(0, 1.6);
        this.camera.position.lerp(rest.clone().add(drift), 1 - Math.exp(-dt * 3));
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(target.clone().add(drift.multiplyScalar(2.5)));
        break;
      }

      case 'settling': this.updateSettle(dt); break;

      case 'storedWait': {
        const rest = this.inside.restPos(this.portrait);
        this.camera.position.lerp(rest, 1 - Math.exp(-dt * 2));
        this.camera.lookAt(this.inside.restTarget(this.portrait));
        break;
      }

      case 'tunnelOut': this.updateTunnelOut(dt); break;

      case 'flyEnter': this.updateFlyEnter(dt); break;

      case 'fly': {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.flyPitch, this.flyYaw, 0, 'YXZ'));
        this.camera.quaternion.slerp(q, 1 - Math.exp(-dt * 6));
        if (this.flyDown) {
          const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
          this.camera.position.addScaledVector(fwd, dt * 6);
        }
        // stay inside the cavern
        const center = new THREE.Vector3(0, 4, -8);
        const off = this.camera.position.clone().sub(center);
        if (off.length() > 36) this.camera.position.copy(center).addScaledVector(off.normalize(), 36);
        this.camera.position.y = Math.max(this.camera.position.y, -5);
        break;
      }
    }
  }

  private beginSettle(bayIndex: number) {
    const p = this.present!;
    this.captureBay = bayIndex;
    this.settleFrom.copy(p.group.position);
    this.settleTo.copy(this.inside.storePresent(p, bayIndex));
    if (p.kind === 'plush') this.settleTo.y += 0.35;
    this.settleQuatFrom.copy(p.group.quaternion);
    p.group.userData.baseY = this.settleTo.y;
    p.group.userData.phase = Math.random() * 6;
    this.path.active = false;
    this.inside.archiveTrails();
    this.inside.celebrate(this.settleTo, bayIndex);
    this.setState('settling');
  }

  private updateSettle(dt: number) {
    const p = this.present!;
    const T = 1.7;
    const t = clamp(this.tState / T, 0, 1);
    const k = easeInOut(t);
    // arc down to the slot beside earlier gifts
    const pos = new THREE.Vector3().lerpVectors(this.settleFrom, this.settleTo, k);
    pos.y += Math.sin(k * Math.PI) * 1.6;
    p.group.position.copy(pos);
    const yawQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.followYaw * 0.3, 0));
    p.group.quaternion.slerpQuaternions(this.settleQuatFrom, yawQ, k);

    if (p.kind === 'horse') {
      // touches down and keeps rocking, softer and softer
      p.sway.rotation.z = Math.sin(this.tState * 6) * 0.12 * (1 - t) + Math.sin(this.tState * 4) * 0.05 * t * (1 - t);
    } else if (p.kind === 'plush') {
      const squash = 1 - Math.sin(k * Math.PI) * 0.06;
      p.sway.scale.set(1 / squash, squash, 1 / squash);
    } else {
      // lands on its wheels and rolls a little further
      if (t > 0.8) {
        const roll = (t - 0.8) / 0.2;
        p.group.position.x += Math.sin(this.followYaw + Math.PI / 2) * 0; // keep on slot
        p.sway.rotation.x += dt * (1 - roll) * 2.0;
      }
    }

    if (t >= 1) {
      p.resetSway();
      if (p.kind === 'horse') p.sway.rotation.z = 0;
      this.storedCount++;
      this.everStored = true;
      // stored presents become static set-dressing (cheap from now on):
      // same-kind gifts share one rest geometry
      p.freezeToShared();
      this.present = null;
      this.setState('storedWait');
      this.ui.showReturn(() => this.returnOutside());
    }
  }

  private updateTunnelOut(dt: number) {
    const T_TO_TUNNEL = 0.8, T_RIDE = 2.3;
    const t = this.tState;
    const curve = this.inside.tunnelCurve;
    if (t < T_TO_TUNNEL) {
      const k = easeInOut(t / T_TO_TUNNEL);
      const start = curve.getPointAt(0.94);
      this.camera.position.lerpVectors(this.camFromPos, start, k);
      const look = curve.getPointAt(0.7);
      const m = new THREE.Matrix4().lookAt(this.camera.position, look, new THREE.Vector3(0, 1, 0));
      this.camera.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(m), 0.15);
    } else if (t < T_TO_TUNNEL + T_RIDE) {
      const k = easeInOut((t - T_TO_TUNNEL) / T_RIDE);
      const uu = lerp(0.94, 0.02, k);
      this.camera.position.copy(curve.getPointAt(uu));
      const ahead = curve.getPointAt(Math.max(uu - 0.085, 0));
      const up = new THREE.Vector3(0, 1, 0).lerp(new THREE.Vector3(0, 0, -1), easeInOut(1 - uu)).normalize();
      this.camera.up.copy(up);
      this.camera.lookAt(ahead);
      if (uu < 0.05) {
        // red cloth swallows the frame again — cut back to the room
        this.startExitOutside();
      }
    } else {
      this.startExitOutside();
    }
  }

  private startExitOutside() {
    const sack = this.outside.sack;
    sack.mouthWorld(this.mouth);
    // start just above the rim, looking down at the dark open mouth,
    // so the first outside frame is red cloth + rim — never a black frame
    this.camera.position.copy(this.mouth).add(new THREE.Vector3(0, 0.55, 0.12));
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(this.mouth);
    sack.open = 0.9;
    sack.jiggle = 0.35;
    this.setState('exiting');
  }

  private updateExiting(dt: number) {
    const T = 1.5;
    const t = clamp(this.tState / T, 0, 1);
    const k = easeInOut(t);
    const sack = this.outside.sack;
    sack.mouthWorld(this.mouth);
    const from = this.mouth.clone().add(new THREE.Vector3(0, 0.55, 0.12));
    // pull up and back out to the room view
    const restCam = new THREE.PerspectiveCamera(45, this.camera.aspect);
    this.outside.applyCamera(restCam, this.portrait);
    this.camera.position.lerpVectors(from, restCam.position, k);
    this.camera.up.set(0, 0, -1).lerp(new THREE.Vector3(0, 1, 0), k).normalize();
    this.camera.quaternion.slerp(restCam.quaternion, k * k * 0.6 + 0.08);
    this.camera.fov = restCam.fov;
    this.camera.updateProjectionMatrix();
    sack.open = lerp(0.9, 0.12, k);
    if (t >= 1) {
      this.camera.up.set(0, 1, 0);
      this.outside.applyCamera(this.camera, this.portrait);
      if (this.storedCount === 3 && !this.mouthMode) {
        this.setState('lift');
      } else {
        if (this.storedCount < 3) this.spawnPresent();
        else this.ui.showMenu(
          () => { this.ui.hideAll(); this.spawnPresent(); this.setState('outside'); },
          () => { this.ui.hideAll(); this.enterEmpty(); },
          () => { this.ui.hideAll(); this.mouthMode = true; this.setState('outside'); },
        );
        this.setState(this.storedCount < 3 ? 'outside' : 'menu');
      }
    }
  }

  private updateLift(dt: number) {
    // Santa lifts the sack: from the outside, all that changed is a little weight
    const santa = this.outside.santa;
    const sack = this.outside.sack;
    const t = this.tState;
    const T_GRAB = 0.8, T_UP = 1.2, T_HOLD = 1.4, T_DOWN = 0.9;
    const weight = 1 + this.storedCount * 0.12;
    if (t < T_GRAB) {
      santa.lift = easeInOut(t / T_GRAB);
    } else if (t < T_GRAB + T_UP) {
      const k = easeInOut((t - T_GRAB) / T_UP);
      santa.lift = 1;
      const h = 0.2 / weight;                       // heavier = barely lifts
      sack.group.position.y = k * h;
      sack.group.scale.y = 1 + k * 0.05;            // fabric stretches under the load
      sack.group.scale.x = sack.group.scale.z = 1 - k * 0.025;
    } else if (t < T_GRAB + T_UP + T_HOLD) {
      const k = t - T_GRAB - T_UP;
      sack.group.rotation.z = Math.sin(k * 2.2) * 0.018; // ponderous little sway
    } else if (t < T_GRAB + T_UP + T_HOLD + T_DOWN) {
      const k = easeInOut((t - T_GRAB - T_UP - T_HOLD) / T_DOWN);
      const h = 0.2 / weight;
      sack.group.position.y = (1 - k) * h;
      sack.group.scale.y = 1 + (1 - k) * 0.05;
      sack.group.scale.x = sack.group.scale.z = 1 - (1 - k) * 0.025;
      sack.group.rotation.z *= 0.9;
      santa.lift = 1 - k;
      if (k > 0.95 && sack.jiggle < 0.1) sack.jiggle = 0.5; // soft thump: it IS heavier
    } else {
      santa.lift = 0;
      sack.group.position.y = 0;
      sack.group.scale.set(1, 1, 1);
      sack.group.rotation.z = 0;
      this.setState('menu');
      this.ui.showMenu(
        () => { this.ui.hideAll(); this.spawnPresent(); this.setState('outside'); },
        () => { this.ui.hideAll(); this.enterEmpty(); },
        () => { this.ui.hideAll(); this.mouthMode = true; this.setState('outside'); },
      );
    }
  }

  private updateFlyEnter(dt: number) {
    // ride the fabric tunnel down, no present this time
    const T_RIDE = 2.4;
    const k = easeInOut(clamp(this.tState / T_RIDE, 0, 1));
    const curve = this.inside.tunnelCurve;
    const uu = lerp(0.015, 0.94, k);
    this.camera.position.copy(curve.getPointAt(uu));
    const ahead = curve.getPointAt(Math.min(uu + 0.085, 1));
    const up = new THREE.Vector3(0, 0, -1).lerp(new THREE.Vector3(0, 1, 0), easeInOut(uu)).normalize();
    this.camera.up.copy(up);
    this.camera.lookAt(ahead);
    if (k >= 1) {
      this.camera.up.set(0, 1, 0);
      const rest = this.inside.restPos(this.portrait);
      this.camera.position.copy(rest);
      this.camera.lookAt(this.inside.restTarget(this.portrait));
      const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.flyYaw = e.y; this.flyPitch = e.x;
      this.setState('fly');
      this.ui.showReturn(() => this.returnOutside());
    }
  }
}
