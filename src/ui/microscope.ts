import type { RasterImage } from '../micro/compose';

/** 完成画像の表示（拡大・パンのみ。対物レンズや焦点の操作は扱わない）。 */
export class MicroView {
  wrap: HTMLElement;
  private canvas: HTMLCanvasElement;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private startDist = 0;
  private startScale = 1;
  private baseW = 0;
  private baseH = 0;

  constructor(private img: RasterImage) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'micro-wrap';
    this.canvas = document.createElement('canvas');
    this.canvas.width = img.width;
    this.canvas.height = img.height;
    const ctx = this.canvas.getContext('2d')!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    this.wrap.append(this.canvas);
    this.bind();
  }

  /** 表示枠の幅に合わせて等倍表示にする。表示条件は固定（色調補正・演出は行わない）。 */
  layout(widthPx: number): void {
    this.baseW = widthPx;
    this.baseH = Math.round((widthPx * this.img.height) / this.img.width);
    this.wrap.style.height = `${this.baseH}px`;
    this.canvas.style.width = `${this.baseW}px`;
    this.canvas.style.height = `${this.baseH}px`;
    this.apply();
  }

  private apply(): void {
    const maxTx = 0;
    const minTx = Math.min(0, this.baseW - this.baseW * this.scale);
    const minTy = Math.min(0, this.baseH - this.baseH * this.scale);
    this.tx = Math.max(minTx, Math.min(maxTx, this.tx));
    this.ty = Math.max(minTy, Math.min(0, this.ty));
    this.canvas.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
  }

  setZoom(s: number): void {
    const prev = this.scale;
    this.scale = Math.max(1, Math.min(6, s));
    const cx = this.baseW / 2;
    const cy = this.baseH / 2;
    this.tx = cx - ((cx - this.tx) / prev) * this.scale;
    this.ty = cy - ((cy - this.ty) / prev) * this.scale;
    this.apply();
  }

  get zoom(): number {
    return this.scale;
  }

  private bind(): void {
    const w = this.wrap;
    w.addEventListener('pointerdown', (e) => {
      w.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.startDist = Math.hypot(a.x - b.x, a.y - b.y);
        this.startScale = this.scale;
      }
    });
    w.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const prev = { ...p };
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.startDist > 4) {
          this.scale = Math.max(1, Math.min(6, (this.startScale * d) / this.startDist));
        }
      } else {
        this.tx += p.x - prev.x;
        this.ty += p.y - prev.y;
      }
      this.apply();
      e.preventDefault();
    });
    const end = (e: PointerEvent): void => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.startDist = 0;
    };
    w.addEventListener('pointerup', end);
    w.addEventListener('pointercancel', end);
    w.addEventListener('pointerleave', end);
  }
}

/** RasterImage を小さな canvas 要素として描く（比較表示用）。 */
export function rasterCanvas(img: RasterImage, cssWidth: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  c.style.width = `${cssWidth}px`;
  return c;
}
