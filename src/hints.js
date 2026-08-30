/**
 * Wordless coaching. A translucent hand shows the gesture in the lower third
 * of the screen — where we want the child's finger to be, so the glass at the
 * top of the frame is never hidden by their own hand.
 */
const HAND = `
<path class="palm" d="M50 96 C34 96 24 84 24 68 L24 40 C24 34 33 34 33 40 L33 58
  L33 22 C33 16 42 16 42 22 L42 56 L42 16 C42 10 51 10 51 16 L51 56 L51 22
  C51 16 60 16 60 22 L60 60 L60 36 C60 30 69 30 69 36 L69 70
  C69 86 62 96 50 96 Z"
  fill="rgba(255,255,255,.93)" stroke="rgba(0,0,0,.35)" stroke-width="2.2" stroke-linejoin="round"/>`;

const SVG = {
  spin: `<svg viewBox="0 0 240 160">
    <g class="arrow" fill="none" stroke="#ffd9a8" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M74 40 H166"/><path d="M84 28 L70 40 L84 52"/><path d="M156 28 L170 40 L156 52"/>
    </g>
    <g class="hand" transform="translate(90 52) scale(.62)">${HAND}</g>
  </svg>`,
  blow: `<svg viewBox="0 0 240 160">
    <g class="arrow" fill="none" stroke="#a8dcff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M120 108 V34"/><path d="M104 50 L120 32 L136 50"/>
    </g>
    <g class="trail" fill="none" stroke="rgba(190,225,255,.75)" stroke-width="4" stroke-linecap="round">
      <path d="M96 92 V60"/><path d="M144 92 V60"/>
    </g>
    <g class="hand" transform="translate(90 66) scale(.62)">${HAND}</g>
  </svg>`,
  tap: `<svg viewBox="0 0 240 160">
    <circle class="ring" cx="120" cy="78" r="30" fill="none" stroke="#ffe0a8" stroke-width="6"/>
    <g class="hand" transform="translate(90 44) scale(.62)">${HAND}</g>
  </svg>`,
};

export class Hints {
  constructor(el) {
    this.el = el;
    this.current = null;
    this.visible = false;
  }

  show(kind) {
    if (this.current !== kind) {
      this.el.innerHTML = SVG[kind] || '';
      this.el.dataset.gesture = kind;
      this.current = kind;
    }
    if (!this.visible) { this.el.classList.add('show'); this.visible = true; }
  }

  hide() {
    if (this.visible) { this.el.classList.remove('show'); this.visible = false; }
  }

  /** Bigger + faster once the child has waited a long time. */
  urgent(on) {
    this.el.style.transform = on ? 'translateX(-50%) scale(1.16)' : 'translateX(-50%) scale(1)';
    this.el.style.filter = on ? 'saturate(1.3)' : '';
  }
}
