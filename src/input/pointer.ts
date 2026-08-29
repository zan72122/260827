export interface PointerSample {
  /** Normalised device coords, -1..1. */
  x: number;
  y: number;
  /** CSS pixels. */
  px: number;
  py: number;
}

export interface DragState extends PointerSample {
  startX: number;
  startY: number;
  startPx: number;
  startPy: number;
  dx: number;
  dy: number;
  /** Seconds since press. */
  age: number;
}

type Handler = (d: DragState) => void;

/**
 * Single-finger input only: press, drag, release. No pinch, no two-finger
 * rotation, no camera control.
 */
export class Pointer {
  down = false;
  state: DragState = { x: 0, y: 0, px: 0, py: 0, startX: 0, startY: 0, startPx: 0, startPy: 0, dx: 0, dy: 0, age: 0 };
  onDown: Handler | null = null;
  onMove: Handler | null = null;
  onUp: Handler | null = null;
  private el: HTMLElement;
  private t0 = 0;

  constructor(el: HTMLElement) {
    this.el = el;
    el.addEventListener('pointerdown', this.handleDown, { passive: false });
    el.addEventListener('pointermove', this.handleMove, { passive: false });
    window.addEventListener('pointerup', this.handleUp, { passive: false });
    window.addEventListener('pointercancel', this.handleUp, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private read(e: PointerEvent): PointerSample {
    const r = this.el.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    return { px, py, x: (px / r.width) * 2 - 1, y: -(py / r.height) * 2 + 1 };
  }

  private handleDown = (e: PointerEvent) => {
    if (this.down) return;
    e.preventDefault();
    const s = this.read(e);
    this.down = true;
    this.t0 = performance.now();
    this.state = { ...s, startX: s.x, startY: s.y, startPx: s.px, startPy: s.py, dx: 0, dy: 0, age: 0 };
    this.el.setPointerCapture?.(e.pointerId);
    this.onDown?.(this.state);
  };

  private handleMove = (e: PointerEvent) => {
    if (!this.down) return;
    e.preventDefault();
    const s = this.read(e);
    const st = this.state;
    st.x = s.x; st.y = s.y; st.px = s.px; st.py = s.py;
    st.dx = s.x - st.startX;
    st.dy = s.y - st.startY;
    st.age = (performance.now() - this.t0) / 1000;
    this.onMove?.(st);
  };

  private handleUp = (e: PointerEvent) => {
    if (!this.down) return;
    e.preventDefault?.();
    this.down = false;
    this.state.age = (performance.now() - this.t0) / 1000;
    this.onUp?.(this.state);
  };
}
