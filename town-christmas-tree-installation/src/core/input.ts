/**
 * Touch-first gesture recognisers used by the HUD widgets.
 * Everything is single-finger, forgiving, and survives pointercancel /
 * rapid tapping / orientation change (listeners are element scoped and the
 * active pointer id is tracked explicitly).
 */

export type Vec2 = { x: number; y: number };

export interface DragState {
  start: Vec2;
  last: Vec2;
  current: Vec2;
  /** Delta since previous move event, in CSS pixels. */
  delta: Vec2;
  /** Delta since gesture start, in CSS pixels. */
  total: Vec2;
  elapsed: number;
}

type DragHandlers = {
  onStart?: (s: DragState) => void;
  onMove?: (s: DragState) => void;
  onEnd?: (s: DragState, cancelled: boolean) => void;
};

const listenerOpts: AddEventListenerOptions = { passive: false };

export function bindDrag(el: HTMLElement, h: DragHandlers): () => void {
  let id: number | null = null;
  let state: DragState | null = null;
  let t0 = 0;

  const point = (e: PointerEvent): Vec2 => ({ x: e.clientX, y: e.clientY });

  const down = (e: PointerEvent) => {
    if (id !== null) return;
    id = e.pointerId;
    t0 = performance.now();
    const p = point(e);
    state = {
      start: p,
      last: p,
      current: p,
      delta: { x: 0, y: 0 },
      total: { x: 0, y: 0 },
      elapsed: 0,
    };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    e.preventDefault();
    h.onStart?.(state);
  };

  const move = (e: PointerEvent) => {
    if (id !== e.pointerId || !state) return;
    const p = point(e);
    state.delta = { x: p.x - state.current.x, y: p.y - state.current.y };
    state.last = state.current;
    state.current = p;
    state.total = { x: p.x - state.start.x, y: p.y - state.start.y };
    state.elapsed = (performance.now() - t0) / 1000;
    e.preventDefault();
    h.onMove?.(state);
  };

  const finish = (e: PointerEvent, cancelled: boolean) => {
    if (id !== e.pointerId || !state) return;
    const s = state;
    id = null;
    state = null;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    h.onEnd?.(s, cancelled);
  };

  const up = (e: PointerEvent) => finish(e, false);
  const cancel = (e: PointerEvent) => finish(e, true);

  el.addEventListener('pointerdown', down, listenerOpts);
  el.addEventListener('pointermove', move, listenerOpts);
  el.addEventListener('pointerup', up, listenerOpts);
  el.addEventListener('pointercancel', cancel, listenerOpts);
  el.addEventListener('lostpointercapture', cancel, listenerOpts);

  return () => {
    el.removeEventListener('pointerdown', down, listenerOpts);
    el.removeEventListener('pointermove', move, listenerOpts);
    el.removeEventListener('pointerup', up, listenerOpts);
    el.removeEventListener('pointercancel', cancel, listenerOpts);
    el.removeEventListener('lostpointercapture', cancel, listenerOpts);
  };
}

/** Fires once when the finger has travelled far enough in `dir`. */
export function bindSwipe(
  el: HTMLElement,
  dir: 'up' | 'down' | 'left' | 'right',
  distance: number,
  cb: () => void,
): () => void {
  let fired = false;
  return bindDrag(el, {
    onStart: () => {
      fired = false;
    },
    onMove: (s) => {
      if (fired) return;
      const v =
        dir === 'up' ? -s.total.y : dir === 'down' ? s.total.y : dir === 'left' ? -s.total.x : s.total.x;
      const cross = dir === 'up' || dir === 'down' ? Math.abs(s.total.x) : Math.abs(s.total.y);
      if (v > distance && v > cross * 0.65) {
        fired = true;
        cb();
      }
    },
  });
}

/**
 * Circular-motion recogniser: reports accumulated signed turns around the
 * element centre. Direction agnostic — a 4 year old spinning either way works.
 */
export function bindCircle(el: HTMLElement, cb: (turns: number, active: boolean) => void): () => void {
  let prevAngle = 0;
  let turns = 0;
  const angleOf = (p: Vec2) => {
    const r = el.getBoundingClientRect();
    return Math.atan2(p.y - (r.top + r.height / 2), p.x - (r.left + r.width / 2));
  };
  return bindDrag(el, {
    onStart: (s) => {
      prevAngle = angleOf(s.current);
      turns = 0;
      cb(0, true);
    },
    onMove: (s) => {
      const a = angleOf(s.current);
      let d = a - prevAngle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      prevAngle = a;
      // Absolute value: either rotation direction tightens the winch.
      turns += Math.abs(d) / (Math.PI * 2);
      cb(turns, true);
    },
    onEnd: () => cb(turns, false),
  });
}

/** Clamp helper shared across the game. */
export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential smoothing. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}
