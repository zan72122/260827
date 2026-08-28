export type HintKind = 'swipe-right' | 'press' | 'swipe-vertical' | 'pull-down' | 'tap';

const CSS = `
.hint-layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.hint { position: absolute; width: 27vmin; height: 27vmin; margin: -13.5vmin 0 0 -13.5vmin;
  opacity: 0; transition: opacity 420ms ease; will-change: transform, opacity; }
.hint.on { opacity: 0.92; }
.hint svg { width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.55)); }
.hint .hand { animation: none; }
.hint-swipe-right .hand { animation: handRight 1.9s ease-in-out infinite; }
.hint-swipe-vertical .hand { animation: handVertical 1.6s ease-in-out infinite; }
.hint-pull-down .hand { animation: handPull 2.3s ease-in-out infinite; }
.hint-press .hand { animation: handPress 1.5s ease-in-out infinite; }
.hint-tap .hand { animation: handTap 1.4s ease-in-out infinite; }
.hint .ring { transform-origin: 50% 50%; opacity: 0; }
.hint-press .ring, .hint-tap .ring { animation: ringPulse 1.5s ease-out infinite; }
.hint .trail { opacity: 0.55; }
@keyframes handRight { 0% { transform: translateX(-28%); } 55% { transform: translateX(30%); } 100% { transform: translateX(-28%); } }
@keyframes handVertical { 0% { transform: translateY(-22%); } 50% { transform: translateY(24%); } 100% { transform: translateY(-22%); } }
@keyframes handPull { 0% { transform: translateY(-26%); } 60% { transform: translateY(38%); } 100% { transform: translateY(-26%); } }
@keyframes handPress { 0%, 100% { transform: scale(1); } 45% { transform: scale(0.86); } }
@keyframes handTap { 0%, 100% { transform: scale(1) translateY(0); } 40% { transform: scale(0.9) translateY(6%); } }
@keyframes ringPulse { 0% { transform: scale(0.5); opacity: 0.75; } 100% { transform: scale(1.5); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .hint * { animation: none !important; } }
`;

const HAND = `
<g class="hand">
  <path d="M46 78 C34 72 28 60 28 50 L28 34 a5 5 0 0 1 10 0 v12 V24 a5 5 0 0 1 10 0 v20 V20 a5 5 0 0 1 10 0 v24 V30 a5 5 0 0 1 10 0 v28 c0 12 -6 20 -14 24 z"
    fill="#f4e6d2" stroke="#4a3a2c" stroke-width="2.5" stroke-linejoin="round"/>
</g>`;

/**
 * Wordless prompts. They appear only after the child has had a moment to try on
 * their own, and they get rarer with every tree.
 */
export class Hints {
  private readonly layer: HTMLDivElement;
  private readonly node: HTMLDivElement;
  private kind: HintKind | null = null;
  private wanted: HintKind | null = null;
  private delay = 2.4;
  private timer = 0;
  private visible = false;

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.layer = document.createElement('div');
    this.layer.className = 'hint-layer';
    this.node = document.createElement('div');
    this.node.className = 'hint';
    this.layer.appendChild(this.node);
    parent.appendChild(this.layer);
  }

  /** Sets how patient the game is before offering a hint. */
  setDelay(seconds: number): void {
    this.delay = seconds;
  }

  want(kind: HintKind | null, xFrac = 0.5, yFrac = 0.62): void {
    if (this.wanted !== kind) {
      this.wanted = kind;
      this.timer = 0;
      if (kind === null) this.setVisible(false);
    }
    this.node.style.left = (xFrac * 100).toFixed(2) + '%';
    this.node.style.top = (yFrac * 100).toFixed(2) + '%';
  }

  /** Call whenever the child touches the screen: hints step back. */
  noteInput(): void {
    this.timer = -1.6;
    this.setVisible(false);
  }

  update(dt: number): void {
    if (!this.wanted) return;
    this.timer += dt;
    if (this.timer >= this.delay && !this.visible) {
      this.render(this.wanted);
      this.setVisible(true);
    }
  }

  private setVisible(v: boolean): void {
    if (this.visible === v) return;
    this.visible = v;
    this.node.classList.toggle('on', v);
  }

  private render(kind: HintKind): void {
    if (this.kind === kind) return;
    this.kind = kind;
    this.node.className = 'hint hint-' + kind + (this.visible ? ' on' : '');
    let deco = '';
    if (kind === 'swipe-right') {
      deco = `<path class="trail" d="M14 52 H86" stroke="#f4e6d2" stroke-width="4" stroke-linecap="round" stroke-dasharray="8 9"/>
        <path d="M78 42 L92 52 L78 62" fill="none" stroke="#f4e6d2" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else if (kind === 'swipe-vertical') {
      deco = `<path class="trail" d="M50 12 V92" stroke="#f4e6d2" stroke-width="4" stroke-linecap="round" stroke-dasharray="8 9"/>
        <path d="M40 22 L50 10 L60 22" fill="none" stroke="#f4e6d2" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M40 82 L50 94 L60 82" fill="none" stroke="#f4e6d2" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else if (kind === 'pull-down') {
      deco = `<path class="trail" d="M50 6 V96" stroke="#f4e6d2" stroke-width="4" stroke-linecap="round" stroke-dasharray="8 9"/>
        <path d="M38 84 L50 98 L62 84" fill="none" stroke="#f4e6d2" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else {
      deco = `<circle class="ring" cx="50" cy="50" r="34" fill="none" stroke="#f4e6d2" stroke-width="4"/>`;
    }
    this.node.innerHTML = `<svg viewBox="0 0 100 100">${deco}${HAND}</svg>`;
  }

  dispose(): void {
    this.layer.remove();
  }
}
