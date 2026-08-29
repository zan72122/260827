import * as THREE from 'three';

export interface PointerSample {
  /** CSS pixels within the canvas. */
  x: number;
  y: number;
  /** Normalised device coordinates for raycasting. */
  ndc: THREE.Vector2;
}

export interface GestureEnd {
  tap: boolean;
  duration: number;
  distance: number;
  /** Direction of travel in CSS pixels, zero for a tap. */
  dx: number;
  dy: number;
}

export interface InputHandler {
  onDown?(p: PointerSample): void;
  onMove?(p: PointerSample): void;
  onUp?(p: PointerSample, end: GestureEnd): void;
}

/**
 * One finger, large targets, nothing else. There is no pinch, no two finger
 * rotation and no small handle anywhere in the game: a berry is dragged with one
 * finger, turned with one tap, and removed by dragging it off the cake.
 */
export class Input {
  handler: InputHandler | null = null;
  private active: number | null = null;
  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private maxTravel = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.down, { passive: false });
    canvas.addEventListener('pointermove', this.move, { passive: false });
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private sample(e: PointerEvent): PointerSample {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return {
      x,
      y,
      ndc: new THREE.Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1),
    };
  }

  private down = (e: PointerEvent): void => {
    if (this.active !== null) return;
    e.preventDefault();
    this.active = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.sample(e);
    this.startX = p.x;
    this.startY = p.y;
    this.startTime = performance.now();
    this.maxTravel = 0;
    this.handler?.onDown?.(p);
  };

  private move = (e: PointerEvent): void => {
    if (e.pointerId !== this.active) return;
    e.preventDefault();
    const p = this.sample(e);
    this.maxTravel = Math.max(this.maxTravel, Math.hypot(p.x - this.startX, p.y - this.startY));
    this.handler?.onMove?.(p);
  };

  private up = (e: PointerEvent): void => {
    if (e.pointerId !== this.active) return;
    this.active = null;
    const p = this.sample(e);
    const duration = performance.now() - this.startTime;
    const distance = Math.hypot(p.x - this.startX, p.y - this.startY);
    this.handler?.onUp?.(p, {
      // Generous: a four year old's tap always slides a little.
      tap: this.maxTravel < 16 && duration < 420,
      duration,
      distance,
      dx: p.x - this.startX,
      dy: p.y - this.startY,
    });
  };

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.down);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.up);
  }
}
