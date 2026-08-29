/**
 * Everything on the glass. No instructions to read: a hand, a path, a ring and
 * one short line for the grown-up once the machine has explained itself.
 */

export type HintKind = 'swipe' | 'hold' | 'pull';

const HAND_SVG = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <g>
    <path d="M25 44c-6-4-10-9-12-15-1.4-3.8 3-6.4 5.4-3.1l3.6 4.8V13.5a3.5 3.5 0 017 0v13.2a3.2 3.2 0 016.4 0v2.1a3.2 3.2 0 016.3 0v2.2a3.1 3.1 0 016.3 0v10.6c0 6.6-4.3 12.4-11 12.4h-6c-3.3 0-6-1.2-8-3z"
      fill="#fdf6ea" stroke="#3a2f26" stroke-width="2.4" stroke-linejoin="round"/>
  </g>
</svg>`;

const REPLAY_SVG = `
<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <path d="M24 9a15 15 0 1 0 14.4 19.3" fill="none" stroke="#2f5c34" stroke-width="5" stroke-linecap="round"/>
  <path d="M24 3.5v11L34 9z" fill="#2f5c34"/>
</svg>`;

const BOOT_SVG = `
<svg class="boot-tree" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <path d="M32 5l11 18h-6l12 17h-9l10 15H16l10-15h-9l12-17h-6z" fill="#33553a"/>
  <rect x="28" y="55" width="8" height="7" fill="#5a4128"/>
</svg>`;

export class Hud {
  private root: HTMLElement;
  private hand: HTMLDivElement;
  private trail: HTMLDivElement;
  private trailSvg: SVGSVGElement;
  private trailPath: SVGPathElement;
  private caption: HTMLDivElement;
  private replay: HTMLButtonElement;
  private veil: HTMLDivElement;
  private boot: HTMLDivElement;

  private kind: HintKind = 'swipe';
  private from = { x: 0, y: 0 };
  private to = { x: 0, y: 0 };
  private t = 0;
  private active = false;
  private subtle = false;

  constructor(root: HTMLElement) {
    this.root = root;

    this.trail = document.createElement('div');
    this.trail.className = 'hint-trail';
    this.trail.innerHTML =
      '<svg width="1" height="1"><path fill="none" stroke="#fdf6ea" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 16" opacity="0.95"/></svg>';
    this.trailSvg = this.trail.querySelector('svg')!;
    this.trailPath = this.trail.querySelector('path')!;
    root.appendChild(this.trail);

    this.hand = document.createElement('div');
    this.hand.className = 'hint';
    this.hand.innerHTML = HAND_SVG;
    root.appendChild(this.hand);

    this.caption = document.createElement('div');
    this.caption.className = 'caption';
    root.appendChild(this.caption);

    this.replay = document.createElement('button');
    this.replay.className = 'replay';
    this.replay.type = 'button';
    this.replay.setAttribute('aria-label', 'つぎの き');
    this.replay.innerHTML = REPLAY_SVG;
    root.appendChild(this.replay);

    this.veil = document.createElement('div');
    Object.assign(this.veil.style, {
      position: 'absolute',
      inset: '0',
      background: '#0d0f11',
      opacity: '0',
      pointerEvents: 'none',
      transition: 'opacity 380ms ease',
    } as CSSStyleDeclaration);
    root.appendChild(this.veil);

    this.boot = document.createElement('div');
    this.boot.id = 'boot';
    this.boot.innerHTML = BOOT_SVG;
    root.appendChild(this.boot);
  }

  bootDone(): void {
    this.boot.classList.add('gone');
    setTimeout(() => this.boot.remove(), 900);
  }

  onReplay(fn: () => void): void {
    this.replay.addEventListener('click', fn);
  }

  setReplay(on: boolean): void {
    this.replay.classList.toggle('on', on);
  }

  setCaption(text: string | null): void {
    if (text) {
      this.caption.textContent = text;
      this.caption.classList.add('on');
    } else {
      this.caption.classList.remove('on');
    }
  }

  setVeil(v: number): void {
    this.veil.style.opacity = String(v);
  }

  /** Point the hand at a place on the glass. Coordinates are CSS pixels. */
  showHint(kind: HintKind, fx: number, fy: number, tx: number, ty: number, subtle = false): void {
    this.kind = kind;
    this.from.x = fx;
    this.from.y = fy;
    this.to.x = tx;
    this.to.y = ty;
    this.subtle = subtle;
    if (!this.active) this.t = 0;
    this.active = true;
    this.hand.classList.add('on');
    this.trail.classList.toggle('on', kind !== 'hold' && !subtle);
    if (kind !== 'hold' && !subtle) {
      const pad = 40;
      const minX = Math.min(fx, tx) - pad;
      const minY = Math.min(fy, ty) - pad;
      const w = Math.abs(tx - fx) + pad * 2;
      const h = Math.abs(ty - fy) + pad * 2;
      this.trail.style.transform = `translate(${minX}px, ${minY}px)`;
      this.trailSvg.setAttribute('width', String(w));
      this.trailSvg.setAttribute('height', String(h));
      this.trailPath.setAttribute('d', `M ${fx - minX} ${fy - minY} L ${tx - minX} ${ty - minY}`);
    }
  }

  hideHint(): void {
    this.active = false;
    // update() writes opacity inline, which would otherwise outrank the class
    this.hand.style.opacity = '0';
    this.hand.classList.remove('on');
    this.trail.classList.remove('on');
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const cycle = this.kind === 'hold' ? 1.5 : 2.1;
    const p = (this.t % cycle) / cycle;
    let x = this.from.x;
    let y = this.from.y;
    let scale = 1;
    if (this.kind === 'hold') {
      scale = 1 - 0.12 * Math.max(0, Math.sin(p * Math.PI * 2));
    } else {
      const k = Math.min(1, Math.max(0, (p - 0.12) / 0.62));
      const e = k * k * (3 - 2 * k);
      x = this.from.x + (this.to.x - this.from.x) * e;
      y = this.from.y + (this.to.y - this.from.y) * e;
      scale = 0.9 + 0.1 * Math.sin(p * Math.PI);
    }
    const fade = this.subtle ? 0.55 : 1;
    this.hand.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    this.hand.style.opacity = String(fade * (this.kind === 'hold' ? 1 : 0.55 + 0.45 * Math.sin(p * Math.PI)));
  }

  get element(): HTMLElement {
    return this.root;
  }
}
