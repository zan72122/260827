import * as THREE from 'three';

export interface PointerSample {
  /** css pixels relative to the canvas */
  x: number;
  y: number;
  /** normalised device coords for raycasting */
  ndc: THREE.Vector2;
  dx: number;
  dy: number;
  /** seconds since this gesture started */
  age: number;
}

export interface PointerHandlers {
  onDown?: (p: PointerSample) => void;
  onMove?: (p: PointerSample) => void;
  onUp?: (p: PointerSample) => void;
}

/** One finger only. No pinch, no orbit, no second pointer. */
export class PointerInput {
  private el: HTMLElement;
  private handlers: PointerHandlers;
  private activeId: number | null = null;
  private last = new THREE.Vector2();
  private startTime = 0;
  readonly sample: PointerSample = {
    x: 0,
    y: 0,
    ndc: new THREE.Vector2(),
    dx: 0,
    dy: 0,
    age: 0,
  };

  constructor(el: HTMLElement, handlers: PointerHandlers) {
    this.el = el;
    this.handlers = handlers;
    el.addEventListener('pointerdown', this.down, { passive: false });
    el.addEventListener('pointermove', this.move, { passive: false });
    el.addEventListener('pointerup', this.up, { passive: false });
    el.addEventListener('pointercancel', this.up, { passive: false });
    el.addEventListener('contextmenu', this.block);
  }

  private fill(e: PointerEvent): void {
    const r = this.el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    this.sample.dx = x - this.last.x;
    this.sample.dy = y - this.last.y;
    this.sample.x = x;
    this.sample.y = y;
    this.sample.ndc.set((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1);
    this.sample.age = (performance.now() - this.startTime) / 1000;
    this.last.set(x, y);
  }

  private down = (e: PointerEvent): void => {
    if (this.activeId !== null) return;
    this.activeId = e.pointerId;
    this.el.setPointerCapture?.(e.pointerId);
    const r = this.el.getBoundingClientRect();
    this.last.set(e.clientX - r.left, e.clientY - r.top);
    this.startTime = performance.now();
    this.fill(e);
    this.sample.dx = 0;
    this.sample.dy = 0;
    e.preventDefault();
    this.handlers.onDown?.(this.sample);
  };

  private move = (e: PointerEvent): void => {
    if (e.pointerId !== this.activeId) return;
    this.fill(e);
    e.preventDefault();
    this.handlers.onMove?.(this.sample);
  };

  private up = (e: PointerEvent): void => {
    if (e.pointerId !== this.activeId) return;
    this.fill(e);
    this.activeId = null;
    e.preventDefault();
    this.handlers.onUp?.(this.sample);
  };

  private block = (e: Event): void => {
    e.preventDefault();
  };

  get isDown(): boolean {
    return this.activeId !== null;
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.up);
    this.el.removeEventListener('contextmenu', this.block);
  }
}
