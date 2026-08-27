import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 子ども向け入力: 大きな当たり判定・単一ドラッグ・スワイプ検出。
// ピック対象は「ワールド座標 + 画面上の半径(px)」で登録し、
// 押下時に最も近いものを選ぶ。矢印などの UI は出さない。
// ---------------------------------------------------------------------------

export interface Pickable {
  id: string;
  /** ワールド位置を書き込む */
  getWorld(out: THREE.Vector3): void;
  /** 画面上の当たり半径 px */
  radiusPx: number;
  enabled: boolean;
  priority?: number;
}

export interface DragInfo {
  pick: Pickable | null;      // null = 何もない場所（スワイプ用）
  screen: THREE.Vector2;
  ndc: THREE.Vector2;
  moved: boolean;
  velocity: THREE.Vector2;    // px/s（スワイプ判定）
}

export class InputManager {
  private el: HTMLElement;
  private camera: THREE.PerspectiveCamera;
  readonly pickables: Pickable[] = [];
  private active: DragInfo | null = null;
  private activeId = -1;
  private lastPos = new THREE.Vector2();
  private lastT = 0;
  private ray = new THREE.Raycaster();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector2();

  onDragStart?: (d: DragInfo) => void;
  onDragMove?: (d: DragInfo) => void;
  onDragEnd?: (d: DragInfo) => void;
  onTap?: (d: DragInfo) => void;

  constructor(el: HTMLElement, camera: THREE.PerspectiveCamera) {
    this.el = el;
    this.camera = camera;
    el.addEventListener('pointerdown', this.down, { passive: false });
    el.addEventListener('pointermove', this.move, { passive: false });
    el.addEventListener('pointerup', this.up, { passive: false });
    el.addEventListener('pointercancel', this.up, { passive: false });
  }

  register(p: Pickable): Pickable {
    this.pickables.push(p);
    return p;
  }

  private toNdc(e: PointerEvent, out: THREE.Vector2): THREE.Vector2 {
    const r = this.el.getBoundingClientRect();
    out.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    return out;
  }

  /** 画面座標(px)にワールド点を投影 */
  worldToScreen(w: THREE.Vector3, out: THREE.Vector2): THREE.Vector2 {
    const r = this.el.getBoundingClientRect();
    this.tmp.copy(w).project(this.camera);
    out.set((this.tmp.x + 1) / 2 * r.width, (1 - this.tmp.y) / 2 * r.height);
    return out;
  }

  /** NDC からレイを作り、水平面 y=h との交点 */
  groundPoint(ndc: THREE.Vector2, h: number, out: THREE.Vector3): THREE.Vector3 | null {
    this.ray.setFromCamera(ndc, this.camera);
    const t = (h - this.ray.ray.origin.y) / this.ray.ray.direction.y;
    if (t < 0 || !isFinite(t)) return null;
    out.copy(this.ray.ray.origin).addScaledVector(this.ray.ray.direction, t);
    return out;
  }

  raycaster(ndc: THREE.Vector2): THREE.Raycaster {
    this.ray.setFromCamera(ndc, this.camera);
    return this.ray;
  }

  private pickAt(px: number, py: number): Pickable | null {
    let best: Pickable | null = null;
    let bestScore = Infinity;
    for (const p of this.pickables) {
      if (!p.enabled) continue;
      p.getWorld(this.tmp);
      this.worldToScreen(this.tmp, this.tmp2);
      const d = Math.hypot(this.tmp2.x - px, this.tmp2.y - py);
      if (d < p.radiusPx) {
        const score = d - (p.priority ?? 0) * 1000;
        if (score < bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }
    return best;
  }

  private down = (e: PointerEvent): void => {
    if (this.active) return; // 最初の指のみ
    e.preventDefault();
    this.activeId = e.pointerId;
    const r = this.el.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const ndc = this.toNdc(e, new THREE.Vector2());
    const pick = this.pickAt(sx, sy);
    this.active = {
      pick,
      screen: new THREE.Vector2(sx, sy),
      ndc,
      moved: false,
      velocity: new THREE.Vector2()
    };
    this.lastPos.set(sx, sy);
    this.lastT = performance.now();
    this.onDragStart?.(this.active);
  };

  private move = (e: PointerEvent): void => {
    if (!this.active || e.pointerId !== this.activeId) return;
    e.preventDefault();
    const r = this.el.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const now = performance.now();
    const dt = Math.max(1, now - this.lastT) / 1000;
    this.active.velocity.set((sx - this.lastPos.x) / dt, (sy - this.lastPos.y) / dt);
    this.lastPos.set(sx, sy);
    this.lastT = now;
    if (Math.hypot(sx - this.active.screen.x, sy - this.active.screen.y) > 8) this.active.moved = true;
    this.active.screen.set(sx, sy);
    this.toNdc(e, this.active.ndc);
    this.onDragMove?.(this.active);
  };

  private up = (e: PointerEvent): void => {
    if (!this.active || e.pointerId !== this.activeId) return;
    e.preventDefault();
    const d = this.active;
    this.active = null;
    this.activeId = -1;
    if (!d.moved) this.onTap?.(d);
    this.onDragEnd?.(d);
  };
}
