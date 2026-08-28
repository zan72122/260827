import * as THREE from 'three';
import type { Engine } from '../core/engine';
import { audio } from '../audio/audio';
import { clamp, easeOut, easeOutBack } from '../util/math';

/* ------------------------------------------------------------------ *
 * One finger, no precision.  Every target is a fat invisible proxy, every
 * socket has a magnet, a tap alone is enough to fit a part, and a cancelled
 * pointer always returns the part rather than duplicating it.
 * ------------------------------------------------------------------ */

export interface Draggable {
  id: string;
  root: THREE.Object3D;
  /** invisible pick geometry, already parented under root */
  proxy: THREE.Object3D;
  /** world-space destination */
  targetPos: THREE.Vector3;
  targetQuat: THREE.Quaternion;
  /** where it waits before being fitted, in its home parent's space */
  homeParent: THREE.Object3D;
  homeLocal: THREE.Vector3;
  homeQuatLocal: THREE.Quaternion;
  snapRadius: number;
  placed: boolean;
  /** called once, when it seats */
  onPlace: () => void;
  /** parent the part gets re-attached to once seated */
  destParent: THREE.Object3D;
}

/** Resting place of a part in world space (the tray moves when the screen does). */
export function homeWorld(item: Draggable, outPos: THREE.Vector3, outQuat: THREE.Quaternion) {
  item.homeParent.updateWorldMatrix(true, false);
  outPos.copy(item.homeLocal).applyMatrix4(item.homeParent.matrixWorld);
  item.homeParent.getWorldQuaternion(outQuat).multiply(item.homeQuatLocal);
  return outPos;
}

export type Mode =
  | { kind: 'none' }
  | { kind: 'drag'; items: Draggable[] }
  | { kind: 'swipe'; dir: 1 | -1; onDone: () => void }
  | { kind: 'trace' }
  | { kind: 'arc'; onChange: (delta: number) => void; onDone: () => void }
  | { kind: 'tap'; proxies: THREE.Object3D[]; onTap: (id: string) => void };

interface Flight {
  obj: THREE.Object3D;
  fromPos: THREE.Vector3; toPos: THREE.Vector3;
  fromQuat: THREE.Quaternion; toQuat: THREE.Quaternion;
  t: number; dur: number; arc: number;
  onEnd?: () => void;
}

export class Interaction {
  mode: Mode = { kind: 'none' };
  /** the lighter is driven directly while tracing */
  lighterRoot: THREE.Object3D | null = null;
  lighterHome = new THREE.Vector3();
  lighterHomeQuat = new THREE.Quaternion();
  onLighterMove: ((tip: THREE.Vector3) => void) | null = null;
  lighterTip: (() => THREE.Vector3) | null = null;
  /**
   * While guiding the wand, drag it in the plane of the wick it is heading
   * for.  Without this the wand can only travel across the screen at one
   * fixed depth, and a candle on the far side of a ring is unreachable.
   */
  traceAnchor: THREE.Vector3 | null = null;
  private traceScreenOffset = new THREE.Vector2();
  onLighterPick: (() => void) | null = null;
  onLighterDrop: (() => void) | null = null;

  /** true while a finger is down on something */
  dragging = false;
  pointerActive = false;
  readonly pointerNdc = new THREE.Vector2();
  readonly pointerPx = new THREE.Vector2();
  lastInputAt = 0;

  private engine: Engine;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane();
  private grabOffset = new THREE.Vector3();
  private held: Draggable | null = null;
  private heldStartPos = new THREE.Vector3();
  private downPx = new THREE.Vector2();
  private downAt = 0;
  private movedPx = 0;
  private flights: Flight[] = [];
  private pointerId = -1;
  private swipeAccum = 0;
  private arcAccum = 0;
  private root: THREE.Object3D;

  constructor(engine: Engine, root: THREE.Object3D) {
    this.engine = engine;
    this.root = root;
    const c = engine.canvas;
    c.addEventListener('pointerdown', this.onDown, { passive: false });
    c.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp, { passive: false });
    window.addEventListener('pointercancel', this.onCancel, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private setPointer(e: PointerEvent) {
    this.pointerPx.set(e.clientX, e.clientY);
    this.pointerNdc.set(
      (e.clientX / this.engine.width) * 2 - 1,
      -(e.clientY / this.engine.height) * 2 + 1,
    );
  }

  private pick(objects: THREE.Object3D[]): THREE.Object3D | null {
    if (objects.length === 0) return null;
    this.ray.setFromCamera(this.pointerNdc, this.engine.camera);
    const hits = this.ray.intersectObjects(objects, true);
    return hits.length ? hits[0].object : null;
  }

  /** Screen-space distance in px from the pointer to a world point. */
  private screenDist(world: THREE.Vector3) {
    const p = this.engine.projectPx(world, new THREE.Vector2());
    return p.distanceTo(this.pointerPx);
  }

  private onDown = (e: PointerEvent) => {
    if (this.pointerActive) return;            // strictly one finger
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.pointerActive = true;
    this.setPointer(e);
    this.downPx.copy(this.pointerPx);
    this.downAt = performance.now();
    this.movedPx = 0;
    this.swipeAccum = 0;
    this.arcAccum = 0;
    this.lastInputAt = performance.now();
    void audio.unlock();

    const m = this.mode;
    if (m.kind === 'drag') {
      const candidates = m.items.filter((i) => !i.placed && !this.isFlying(i.root));
      const proxies = candidates.map((i) => i.proxy);
      const hit = this.pick(proxies);
      let item: Draggable | undefined;
      if (hit) item = candidates.find((i) => this.contains(i.proxy, hit));
      if (!item) {
        // generous fallback: nearest candidate within a fat screen radius
        let best = Infinity;
        for (const c of candidates) {
          const wp = c.root.getWorldPosition(new THREE.Vector3());
          const d = this.screenDist(wp);
          if (d < best && d < this.touchRadius() * 1.25) { best = d; item = c; }
        }
      }
      if (item) this.beginDrag(item);
    } else if (m.kind === 'trace') {
      if (this.lighterRoot) {
        const wp = this.lighterRoot.getWorldPosition(new THREE.Vector3());
        const tip = this.lighterTip?.() ?? wp;
        const hit = this.pick([this.lighterRoot]);
        if (hit || this.screenDist(wp) < this.touchRadius() * 1.6 ||
            this.screenDist(tip) < this.touchRadius() * 1.6) {
          this.dragging = true;
          // grab wherever the finger landed: the wand must not jump under the
          // finger, so remember the screen gap and hold it through the drag
          const tipPx = this.engine.projectPx(tip, new THREE.Vector2());
          this.traceScreenOffset.copy(tipPx).sub(this.pointerPx);
          this.onLighterPick?.();
        }
      }
    } else if (m.kind === 'swipe' || m.kind === 'arc') {
      // a swipe or a wide sweep is the only thing on offer in these moments,
      // so it is taken from anywhere on the screen: no aiming required
      this.dragging = true;
    }
  };

  private touchRadius() {
    return Math.min(this.engine.width, this.engine.height) * 0.17;
  }

  private contains(parent: THREE.Object3D, child: THREE.Object3D) {
    let c: THREE.Object3D | null = child;
    while (c) { if (c === parent) return true; c = c.parent; }
    return false;
  }

  private isFlying(o: THREE.Object3D) { return this.flights.some((f) => f.obj === o); }

  private beginDrag(item: Draggable) {
    this.held = item;
    this.dragging = true;
    item.root.getWorldPosition(this.heldStartPos);
    // lift out of the tray into scene space so it can travel anywhere
    const wq = item.root.getWorldQuaternion(new THREE.Quaternion());
    this.root.attach(item.root);
    item.root.position.copy(this.heldStartPos);
    item.root.quaternion.copy(wq);

    const camDir = this.engine.camera.getWorldDirection(new THREE.Vector3());
    this.plane.setFromNormalAndCoplanarPoint(camDir, this.heldStartPos);
    const p = this.planePoint();
    this.grabOffset.copy(this.heldStartPos).sub(p ?? this.heldStartPos);
    audio.tick(660);
  }

  /**
   * Move the wand so its tip rides the finger's ray at the depth of whatever
   * wick it is heading for.  A flat drag plane cannot reach a candle on the
   * far side of a ring; this can, and it lands on the wick when the finger is
   * over it.
   */
  private moveWand() {
    const root = this.lighterRoot;
    if (!root) return;
    const tip = this.lighterTip?.() ?? root.getWorldPosition(new THREE.Vector3());
    const px = this.pointerPx.clone().add(this.traceScreenOffset);
    this.ray.setFromCamera(
      new THREE.Vector2(
        (px.x / this.engine.width) * 2 - 1,
        -(px.y / this.engine.height) * 2 + 1,
      ),
      this.engine.camera,
    );
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    const ref = this.traceAnchor ?? tip;
    const depth = clamp(ref.clone().sub(o).dot(d), 0.06, 6);
    const want = o.clone().addScaledVector(d, depth);
    root.position.add(want.sub(tip));
    this.onLighterMove?.(root.position);
  }

  private planePoint(): THREE.Vector3 | null {
    this.ray.setFromCamera(this.pointerNdc, this.engine.camera);
    const out = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, out) ? out : null;
  }

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId || !this.pointerActive) return;
    e.preventDefault();
    const prev = this.pointerPx.clone();
    this.setPointer(e);
    this.movedPx += this.pointerPx.distanceTo(prev);
    this.lastInputAt = performance.now();
    if (!this.dragging) return;

    const m = this.mode;
    if (m.kind === 'drag' && this.held) {
      const p = this.planePoint();
      if (p) {
        const want = p.add(this.grabOffset);
        // magnetism: the closer to the socket, the more the part is pulled in
        const d = want.distanceTo(this.held.targetPos);
        const pull = 1 - clamp(d / (this.held.snapRadius * 2.4), 0, 1);
        want.lerp(this.held.targetPos, pull * pull * 0.85);
        this.held.root.position.copy(want);
        const hq = new THREE.Quaternion();
        homeWorld(this.held, new THREE.Vector3(), hq);
        const q = hq.slerp(this.held.targetQuat, clamp(pull * 1.5, 0, 1));
        this.held.root.quaternion.copy(q);
      }
    } else if (m.kind === 'swipe') {
      const dy = prev.y - this.pointerPx.y;   // up is positive
      this.swipeAccum += dy * m.dir;
      if (this.swipeAccum > this.engine.height * 0.045) {
        this.dragging = false;
        this.pointerActive = false;
        this.pointerId = -1;
        const done = m.onDone;
        this.mode = { kind: 'none' };
        done();
      }
    } else if (m.kind === 'arc') {
      const dx = this.pointerPx.x - prev.x;
      const dy = this.pointerPx.y - prev.y;
      // a wide sweep in either axis; a child does not draw neat arcs
      const delta = (dx - dy) / Math.min(this.engine.width, this.engine.height);
      this.arcAccum += Math.abs(delta);
      m.onChange(delta);
    } else if (m.kind === 'trace' && this.lighterRoot) {
      this.moveWand();
    }
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.finishPointer(false);
  };
  private onCancel = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.finishPointer(true);   // cancelled: always return, never duplicate
  };

  private finishPointer(cancelled: boolean) {
    const m = this.mode;
    const wasTap = this.movedPx < 14 && performance.now() - this.downAt < 500;

    if (m.kind === 'drag') {
      if (this.held) {
        const item = this.held;
        const wp = item.root.getWorldPosition(new THREE.Vector3());
        const near = wp.distanceTo(item.targetPos) < item.snapRadius ||
                     this.screenDist(item.targetPos) < this.touchRadius();
        if (!cancelled && (near || wasTap)) this.seat(item);
        else this.returnHome(item);
      } else if (!cancelled && wasTap) {
        // tapped a part without grabbing it: fit the one that is expected
        const candidates = m.items.filter((i) => !i.placed && !this.isFlying(i.root));
        let best: Draggable | null = null, bestD = Infinity;
        for (const c of candidates) {
          const d = this.screenDist(c.root.getWorldPosition(new THREE.Vector3()));
          if (d < bestD) { bestD = d; best = c; }
        }
        // a plain tap fits the next part, wherever it landed: a four-year-old
        // should never get stuck because they aimed short
        void bestD;
        if (best) this.seat(best);
      }
    } else if (m.kind === 'tap' && !cancelled && wasTap) {
      const hit = this.pick(m.proxies);
      if (hit) {
        let o: THREE.Object3D | null = hit;
        while (o && !o.userData.hit) o = o.parent;
        if (o?.userData.hit) m.onTap(String(o.userData.hit));
      }
    } else if (m.kind === 'trace') {
      this.onLighterDrop?.();
    } else if (m.kind === 'arc') {
      if (this.arcAccum > 0.10) { const d = m.onDone; this.mode = { kind: 'none' }; d(); }
    }

    this.held = null;
    this.dragging = false;
    this.pointerActive = false;
    this.pointerId = -1;
  }

  /** Fly a part into its socket and hand it to its final parent. */
  seat(item: Draggable) {
    if (item.placed) return;
    item.placed = true;
    const from = item.root.getWorldPosition(new THREE.Vector3());
    const fromQ = item.root.getWorldQuaternion(new THREE.Quaternion());
    this.root.attach(item.root);
    item.root.position.copy(from);
    item.root.quaternion.copy(fromQ);
    this.flights.push({
      obj: item.root, fromPos: from, toPos: item.targetPos.clone(),
      fromQuat: fromQ, toQuat: item.targetQuat.clone(),
      t: 0, dur: 0.42, arc: Math.min(0.06, from.distanceTo(item.targetPos) * 0.28),
      onEnd: () => {
        item.destParent.attach(item.root);
        item.onPlace();
      },
    });
  }

  private returnHome(item: Draggable) {
    const from = item.root.getWorldPosition(new THREE.Vector3());
    const fromQ = item.root.getWorldQuaternion(new THREE.Quaternion());
    const toPos = new THREE.Vector3();
    const toQuat = new THREE.Quaternion();
    homeWorld(item, toPos, toQuat);
    this.flights.push({
      obj: item.root, fromPos: from, toPos, fromQuat: fromQ, toQuat,
      t: 0, dur: 0.34, arc: 0.03,
      onEnd: () => {
        item.homeParent.attach(item.root);
        item.root.position.copy(item.homeLocal);
        item.root.quaternion.copy(item.homeQuatLocal);
      },
    });
  }

  update(dt: number) {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt;
      const k = clamp(f.t / f.dur, 0, 1);
      const e = k < 1 ? easeOut(k) : 1;
      const p = f.fromPos.clone().lerp(f.toPos, e);
      p.y += Math.sin(k * Math.PI) * f.arc;
      f.obj.position.copy(p);
      f.obj.quaternion.copy(f.fromQuat.clone().slerp(f.toQuat, easeOutBack(clamp(k * 1.1, 0, 1))));
      if (k >= 1) {
        f.obj.position.copy(f.toPos);
        f.obj.quaternion.copy(f.toQuat);
        this.flights.splice(i, 1);
        f.onEnd?.();
      }
    }
  }

  get busy() { return this.flights.length > 0; }
}
