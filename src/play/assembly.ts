import * as THREE from 'three';
import { MM, clamp, damp, smoothstep } from '../core/units';
import { LEAF_ENTRY_TRAVEL, STAR_ENTRY_TRAVEL, spec } from '../design/treeSpec';
import type { TreeModel } from '../render/tree';
import type { PointerSample, PointerSink } from '../input/pointerRouter';
import { distToSegment, pointerOnCameraPlane, toScreen, type Viewport } from './screen';

/** Hit areas are never smaller than this, in CSS pixels (a capsule's half width). */
export const HIT_HALF_PX = 34;
/** How close the board has to get before the groove takes it, in CSS pixels. */
export const CAPTURE_PX = 84;
/** The carried board sits this far above the finger so the joint stays visible. */
export const CARRY_LIFT_PX = 42;

export type TaskId = string;

export interface Task {
  id: TaskId;
  /** metres of travel from entry to seated */
  travelM: number;
  /** local offset of the point the finger grabs */
  grabLocal: THREE.Vector3;
  /** the hit capsule runs between these two local points */
  hitA: THREE.Vector3;
  hitB: THREE.Vector3;
  /** half width of the hit capsule, CSS px */
  hitPx: number;
  /** where the piece settles relative to the finger once it is in the hand */
  carryOffset: THREE.Vector3;
}

type Mode = 'idle' | 'carrying' | 'guided' | 'seating' | 'returning' | 'done';

export interface AssemblyCallbacks {
  onSeated(id: TaskId): void;
  onPickUp(id: TaskId): void;
  onAllDone(): void;
}

/**
 * 木組み — carrying one board at a time and sliding it into its groove.
 *
 * Nothing is dropped onto a peg.  Each board has one straight insertion axis in
 * the world; once the groove has the board, the board can only move along that
 * axis, and it stops dead when its shoulder meets the trunk.  Aim is forgiven
 * generously, but only from outside the joint: a board on the far side of the
 * trunk is at a different depth and is never pulled through it.
 */
export class Assembly implements PointerSink {
  mode: Mode = 'idle';
  private tasks: Task[] = [];
  private index = 0;
  private held: TaskId | null = null;
  private freePos = new THREE.Vector3();
  private targetFree = new THREE.Vector3();
  private t = 0;
  private tSmooth = 0;
  private seatTimer = 0;
  private seatFrom = 0;
  private returnTimer = 0;
  private returnFrom = new THREE.Vector3();
  private pointer = new THREE.Vector2();
  private grabOffset = new THREE.Vector3();
  private grabBlend = 0;
  private planePoint = new THREE.Vector3();
  /** where the piece was when the groove took it */
  private captureFrom = new THREE.Vector3();
  private captureBlend = 1;
  private trayPose = new Map<TaskId, { pos: THREE.Vector3; quat: THREE.Quaternion }>();
  private enabled = true;

  constructor(
    private tree: TreeModel,
    private carrier: THREE.Object3D,
    private camera: THREE.PerspectiveCamera,
    private vp: Viewport,
    private cb: AssemblyCallbacks,
  ) {}

  /** Pieces the child fits, in order, then the tree itself. */
  setTasks(ids: TaskId[], trayOrigin: THREE.Vector3) {
    this.tasks = ids.map((id) => {
      if (id === 'tree') {
        return {
          id,
          travelM: 0.09,
          grabLocal: new THREE.Vector3(0, 0.06, 0),
          hitA: new THREE.Vector3(0, 0.005, 0),
          hitB: new THREE.Vector3(0, 0.16, 0),
          hitPx: 48,
          // the hand holds the trunk about 60 mm up from its foot
          carryOffset: new THREE.Vector3(0, -0.06, 0),
        };
      }
      const piece = this.tree.pieces.get(id)!;
      if (piece.kind === 'star') {
        return {
          id,
          travelM: STAR_ENTRY_TRAVEL * MM,
          grabLocal: new THREE.Vector3(0, 0, 0),
          hitA: new THREE.Vector3(0, -spec.star.height * 0.4 * MM, 0),
          hitB: new THREE.Vector3(0, spec.star.height * 0.4 * MM, 0),
          hitPx: HIT_HALF_PX,
          carryOffset: new THREE.Vector3(0, 0, 0),
        };
      }
      const span = piece.slot!.span;
      return {
        id,
        travelM: LEAF_ENTRY_TRAVEL * MM,
        grabLocal: new THREE.Vector3(span * 0.45 * MM, 0, 0),
        hitA: new THREE.Vector3(0, 0, 0),
        hitB: new THREE.Vector3(span * MM, 0, 0),
        hitPx: HIT_HALF_PX,
        carryOffset: new THREE.Vector3(0, 0, 0),
      };
    });
    this.index = 0;
    this.layOutTray(trayOrigin);
    // where the tree stands before it is carried across to the pot
    this.trayPose.set('tree', {
      pos: this.tree.group.position.clone(),
      quat: this.tree.group.quaternion.clone(),
    });
  }

  /**
   * The boards wait in the tray at the front of the bench, laid flat and turned
   * away from the player so a long board takes up little width and every one of
   * them stays inside the working view.
   */
  private layOutTray(trayOrigin: THREE.Vector3) {
    const loose = this.tasks.filter((t) => t.id !== 'tree');
    // face up: the board's 5 mm thickness stands vertically
    const faceUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const spacing = 0.055;
    loose.forEach((task, i) => {
      const piece = this.tree.pieces.get(task.id)!;
      const span = piece.slot ? piece.slot.span : spec.star.span;
      const lean = -1.15; // radians about Y, so the boards point away from the player
      const quat = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), lean)
        .multiply(faceUp);
      const x = trayOrigin.x + (i - (loose.length - 1) / 2) * spacing - (span * MM * Math.cos(lean)) / 2;
      const z = trayOrigin.z + (span * MM * Math.sin(lean)) / 2;
      const pos = new THREE.Vector3(x, trayOrigin.y + spec.leaf.thickness * 0.5 * MM, z);
      this.trayPose.set(task.id, { pos, quat });
      this.carrier.add(piece.object);
      piece.object.position.copy(pos);
      piece.object.quaternion.copy(quat);
    });
  }

  get currentTask(): Task | null {
    return this.index < this.tasks.length ? this.tasks[this.index] : null;
  }

  get remaining() {
    return Math.max(0, this.tasks.length - this.index);
  }

  get finished() {
    return this.index >= this.tasks.length;
  }

  setEnabled(v: boolean) {
    this.enabled = v;
  }

  /** World position of the object being fitted right now. */
  private objectOf(id: TaskId): THREE.Object3D {
    return id === 'tree' ? this.tree.group : this.tree.pieces.get(id)!.object;
  }

  /** Entry point, seated point and unit axis of the current joint, in world space. */
  jointWorld(id: TaskId): { entry: THREE.Vector3; seated: THREE.Vector3; axis: THREE.Vector3 } {
    if (id === 'tree') {
      const seated = this.treeSeatedPosition.clone();
      const axis = new THREE.Vector3(0, -1, 0);
      const entry = seated.clone().addScaledVector(axis, -0.09);
      return { entry, seated, axis };
    }
    const local = this.tree.poseFor(id, 0);
    const seated = local.position.clone().applyMatrix4(this.tree.group.matrixWorld);
    const piece = this.tree.pieces.get(id)!;
    let axis: THREE.Vector3;
    let travel: number;
    if (piece.kind === 'star') {
      axis = new THREE.Vector3(0, -1, 0);
      travel = STAR_ENTRY_TRAVEL * MM;
    } else {
      const yaw = piece.slot!.yaw;
      axis = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      travel = LEAF_ENTRY_TRAVEL * MM;
    }
    axis.transformDirection(this.tree.group.matrixWorld).normalize();
    const entry = seated.clone().addScaledVector(axis, -travel);
    return { entry, seated, axis };
  }

  /** Where the tree ends up once its axle is in the bushing. */
  treeSeatedPosition = new THREE.Vector3();

  onDown(p: PointerSample): boolean {
    if (!this.enabled || this.mode !== 'idle') return false;
    const task = this.currentTask;
    if (!task) return false;
    const obj = this.objectOf(task.id);
    obj.updateWorldMatrix(true, false);
    const a = toScreen(this.camera, task.hitA.clone().applyMatrix4(obj.matrixWorld), this.vp);
    const b = toScreen(this.camera, task.hitB.clone().applyMatrix4(obj.matrixWorld), this.vp);
    this.pointer.set(p.x, p.y);
    if (distToSegment(this.pointer, a, b) > task.hitPx) return false;

    this.held = task.id;
    this.mode = 'carrying';
    this.t = 0;
    this.tSmooth = 0;
    this.freePos.copy(obj.getWorldPosition(new THREE.Vector3()));
    this.targetFree.copy(this.freePos);
    // keep the piece where it was grabbed, then settle it into the working grip
    const joint = this.jointWorld(task.id);
    pointerOnCameraPlane(this.camera, p.x, p.y - CARRY_LIFT_PX, this.vp, joint.entry, this.planePoint);
    this.grabOffset.subVectors(this.freePos, this.planePoint);
    this.grabBlend = 0;
    if (task.id !== 'tree') {
      const piece = this.tree.pieces.get(task.id)!;
      this.carrier.attach(piece.object);
    }
    this.cb.onPickUp(task.id);
    return true;
  }

  onMove(p: PointerSample) {
    this.pointer.set(p.x, p.y);
  }

  onUp(_p: PointerSample) {
    if (!this.held || this.mode === 'seating' || this.mode === 'returning') return;
    // most of the way in counts as in: a four-year-old should not have to be
    // precise about where they let go
    if (this.mode === 'guided' && this.tSmooth > 0.45) this.beginSeat();
    else this.beginReturn();
  }

  onCancel(_p: PointerSample) {
    if (!this.held || this.mode === 'seating' || this.mode === 'returning') return;
    // A cancelled gesture never destroys progress: a board that was most of the
    // way home still goes home, anything else simply goes back to the tray.
    if (this.mode === 'guided' && this.tSmooth > 0.8) this.beginSeat();
    else this.beginReturn();
  }

  private beginSeat() {
    this.mode = 'seating';
    this.seatTimer = 0;
    this.seatFrom = this.tSmooth;
  }

  private beginReturn() {
    this.mode = 'returning';
    this.returnTimer = 0;
    this.returnFrom.copy(this.objectOf(this.held!).getWorldPosition(new THREE.Vector3()));
  }

  update(dt: number) {
    if (!this.held) return;
    const id = this.held;
    const task = this.tasks[this.index];
    const obj = this.objectOf(id);
    const joint = this.jointWorld(id);

    if (this.mode === 'returning') {
      this.returnTimer += dt;
      const k = smoothstep(this.returnTimer / 0.26);
      const home = this.trayPose.get(id)!;
      obj.position.lerpVectors(this.returnFrom, home.pos, k);
      // the tree's yaw belongs to the movement, so only the boards are re-aimed
      if (id !== 'tree') obj.quaternion.slerp(home.quat, 1 - Math.exp(-16 * dt));
      if (k >= 1) {
        obj.position.copy(home.pos);
        if (id !== 'tree') obj.quaternion.copy(home.quat);
        this.mode = 'idle';
        this.held = null;
      }
      return;
    }

    if (this.mode === 'seating') {
      this.captureBlend = Math.min(1, this.captureBlend + dt / 0.15);
      this.seatTimer += dt;
      const k = smoothstep(this.seatTimer / 0.14);
      this.tSmooth = this.seatFrom + (1 - this.seatFrom) * k;
      this.applyGuided(id, joint, task, this.tSmooth);
      if (this.seatTimer >= 0.14) this.finishSeat(id);
      return;
    }

    // ---- free carry ------------------------------------------------------
    pointerOnCameraPlane(
      this.camera,
      this.pointer.x,
      this.pointer.y - CARRY_LIFT_PX,
      this.vp,
      joint.entry,
      this.planePoint,
    );
    // a short settle from where it was grabbed into the working grip — long
    // enough not to snatch, short enough that it never lags behind the finger
    this.grabBlend = Math.min(1, this.grabBlend + dt / 0.3);
    const e = smoothstep(this.grabBlend);
    this.targetFree.set(
      this.planePoint.x + this.grabOffset.x * (1 - e) + task.carryOffset.x * e,
      this.planePoint.y + this.grabOffset.y * (1 - e) + task.carryOffset.y * e,
      this.planePoint.z + this.grabOffset.z * (1 - e) + task.carryOffset.z * e,
    );
    this.freePos.set(
      damp(this.freePos.x, this.targetFree.x, 30, dt),
      damp(this.freePos.y, this.targetFree.y, 30, dt),
      damp(this.freePos.z, this.targetFree.z, 30, dt),
    );

    // ---- does the groove have it? ---------------------------------------
    const entryPx = toScreen(this.camera, joint.entry, this.vp);
    const seatedPx = toScreen(this.camera, joint.seated, this.vp);
    const heldPx = toScreen(this.camera, this.freePos, this.vp);
    // the groove only takes a board that is still outside the joint: a board on
    // the far side of the trunk is past the shoulder plane and is never pulled
    // through it
    const outside = this.freePos.clone().sub(joint.seated).dot(joint.axis) < 0.004;
    const near = heldPx.distanceTo(entryPx) < CAPTURE_PX && outside;

    if (this.mode === 'carrying' && near) {
      // the groove takes it: glide the last few millimetres onto the axis
      // rather than snapping, but over 0.15 s, not as a drawn-out animation
      this.mode = 'guided';
      obj.getWorldPosition(this.captureFrom);
      this.captureBlend = 0;
    }

    if (this.mode === 'guided') {
      const ax = seatedPx.x - entryPx.x;
      const ay = seatedPx.y - entryPx.y;
      const len = Math.max(46, Math.hypot(ax, ay));
      const ux = ax / Math.hypot(ax, ay || 1e-6);
      const uy = ay / Math.hypot(ax || 1e-6, ay);
      const along = (heldPx.x - entryPx.x) * ux + (heldPx.y - entryPx.y) * uy;
      this.t = clamp(along / len, -0.25, 1);
      if (this.t < -0.12) {
        this.mode = 'carrying';
      } else {
        this.tSmooth = damp(this.tSmooth, Math.max(0, this.t), 22, dt);
        this.captureBlend = Math.min(1, this.captureBlend + dt / 0.15);
        this.applyGuided(id, joint, task, this.tSmooth);
        if (this.tSmooth > 0.9) this.beginSeat();
        return;
      }
    }

    // still free: follow the finger, turned to the angle it will go in at
    if (id === 'tree') {
      obj.position.copy(this.freePos);
    } else {
      const piece = this.tree.pieces.get(id)!;
      const pose = this.tree.poseFor(id, 0);
      const worldQuat = this.tree.group.getWorldQuaternion(new THREE.Quaternion()).multiply(pose.quaternion);
      // a small tilt while it is in the air, so the 5 mm edge and the end grain read
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22, 0, 0.1));
      piece.object.quaternion.slerp(worldQuat.clone().multiply(tilt), 1 - Math.exp(-14 * dt));
      piece.object.position.copy(this.freePos);
    }
  }

  private applyGuided(
    id: TaskId,
    joint: { entry: THREE.Vector3; seated: THREE.Vector3; axis: THREE.Vector3 },
    task: Task,
    t: number,
  ) {
    const obj = this.objectOf(id);
    const k = 1 - smoothstep(this.captureBlend);
    const onAxis = joint.entry.clone().addScaledVector(joint.axis, task.travelM * clamp(t, 0, 1));
    obj.position.copy(k > 0.001 ? onAxis.lerp(this.captureFrom, k) : onAxis);
    if (id === 'tree') {
      obj.quaternion.identity();
      obj.rotation.y = this.tree.group.rotation.y;
    } else {
      const pose = this.tree.poseFor(id, 0);
      const worldQuat = this.tree.group.getWorldQuaternion(new THREE.Quaternion()).multiply(pose.quaternion);
      if (k > 0.001) obj.quaternion.slerp(worldQuat, 1 - k);
      else obj.quaternion.copy(worldQuat);
    }
  }

  private finishSeat(id: TaskId) {
    if (id === 'tree') {
      this.tree.group.position.copy(this.treeSeatedPosition);
      this.tree.group.rotation.set(0, this.tree.group.rotation.y, 0);
    } else {
      this.tree.seat(id);
    }
    this.mode = 'idle';
    this.held = null;
    this.index++;
    this.cb.onSeated(id);
    if (this.finished) this.cb.onAllDone();
  }

  /** The hit capsule for the piece being offered now, in CSS pixels. */
  hitCapsule(): { a: THREE.Vector2; b: THREE.Vector2; r: number } | null {
    const task = this.currentTask;
    if (!task) return null;
    const obj = this.objectOf(task.id);
    obj.updateWorldMatrix(true, false);
    return {
      a: toScreen(this.camera, task.hitA.clone().applyMatrix4(obj.matrixWorld), this.vp),
      b: toScreen(this.camera, task.hitB.clone().applyMatrix4(obj.matrixWorld), this.vp),
      r: task.hitPx,
    };
  }
}
