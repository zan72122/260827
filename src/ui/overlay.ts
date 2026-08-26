// 文字なしUI: 指のヒントアニメーション / もう一回ボタン / 一筆比較カード

import { RawSample } from '../path/process';

export class Overlay {
  private hint = document.getElementById('hint') as unknown as SVGElement;
  private replayBtn = document.getElementById('replay') as HTMLButtonElement;
  private card = document.getElementById('compareCard') as HTMLDivElement;
  private cardCanvas = document.getElementById('compareCanvas') as HTMLCanvasElement;
  private hintTimer: number | null = null;

  onReplay: (() => void) | null = null;

  constructor() {
    this.replayBtn.addEventListener('click', () => {
      this.onReplay?.();
    });
  }

  /** 描画フェーズ開始: 少し待ってからヒントを出す */
  armHint(delayMs = 1200): void {
    this.cancelHint();
    this.hintTimer = window.setTimeout(() => {
      this.hint.classList.add('show');
    }, delayMs);
  }

  cancelHint(): void {
    if (this.hintTimer !== null) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    this.hint.classList.remove('show');
  }

  showReplay(show: boolean): void {
    this.replayBtn.classList.toggle('show', show);
  }

  /** 子どもの生ストロークをカードに描く（チョーク風） */
  showCompareCard(raw: { x: number; z: number }[] | RawSample[]): void {
    const ctx = this.cardCanvas.getContext('2d')!;
    const W = this.cardCanvas.width, H = this.cardCanvas.height;
    ctx.clearRect(0, 0, W, H);
    // スラブ風の下地
    ctx.fillStyle = '#a9a49a';
    roundRect(ctx, 4, 4, W - 8, H - 8, 18);
    ctx.fill();
    if (raw.length > 1) {
      let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
      for (const p of raw) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
      const span = Math.max(maxX - minX, maxZ - minZ, 0.01);
      const pad = 34;
      const s = (W - pad * 2) / span;
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      ctx.strokeStyle = '#f7f4ea';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      raw.forEach((p, i) => {
        const x = W / 2 + (p.x - cx) * s;
        const y = H / 2 + (p.z - cz) * s;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    this.card.classList.add('show');
  }

  hideCompareCard(): void {
    this.card.classList.remove('show');
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
