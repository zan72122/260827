import { clamp } from '../core/units';

/**
 * The only screen furniture: a sound button and a quiet indicator of how much
 * wind is stored and when a tooth is plucked.  No score, no timer, no words to
 * read — a four-year-old should be able to use this without being told anything.
 */
export class Hud {
  readonly root: HTMLDivElement;
  private soundBtn: HTMLButtonElement;
  private gaugeFill: SVGPathElement;
  private gaugeWrap: HTMLDivElement;
  private note: HTMLDivElement;
  private noteTimer = 0;
  private muted = false;

  constructor(parent: HTMLElement, onToggleSound: (muted: boolean) => void) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <button class="sound" type="button" aria-label="sound">
        <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
          <path class="horn" d="M6 12h5l7-5v18l-7-5H6z" fill="currentColor"/>
          <g class="waves" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
            <path d="M22 11c2.2 2.7 2.2 7.3 0 10"/>
            <path d="M25.6 8c3.6 4.3 3.6 11.7 0 16"/>
          </g>
          <path class="cross" d="M22 11l8 10M30 11l-8 10" stroke="currentColor" stroke-width="2.4"
                stroke-linecap="round" fill="none" opacity="0"/>
        </svg>
      </button>
      <div class="gauge" aria-hidden="true">
        <svg viewBox="0 0 120 30">
          <path class="track" d="M10 26 A 96 96 0 0 1 110 26" fill="none" stroke-width="5"
                stroke-linecap="round"/>
          <path class="fill" d="M10 26 A 96 96 0 0 1 110 26" fill="none" stroke-width="5"
                stroke-linecap="round"/>
        </svg>
        <div class="note"></div>
      </div>`;
    parent.appendChild(this.root);

    this.soundBtn = this.root.querySelector('.sound')!;
    this.gaugeWrap = this.root.querySelector('.gauge')!;
    this.gaugeFill = this.root.querySelector('.fill')!;
    this.note = this.root.querySelector('.note')!;

    const total = this.gaugeFill.getTotalLength();
    this.gaugeFill.style.strokeDasharray = `${total}`;
    this.gaugeFill.style.strokeDashoffset = `${total}`;

    this.soundBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.soundBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.muted = !this.muted;
      this.soundBtn.classList.toggle('muted', this.muted);
      onToggleSound(this.muted);
    });
  }

  /** Flash for one plucked tooth — this is the cue that stays when sound is off. */
  pulse() {
    this.noteTimer = 1;
  }

  update(dt: number, charge: number, active: boolean) {
    const total = this.gaugeFill.getTotalLength();
    this.gaugeFill.style.strokeDashoffset = `${total * (1 - clamp(charge, 0, 1))}`;
    this.gaugeWrap.classList.toggle('idle', !active && charge < 0.01);
    if (this.noteTimer > 0) {
      this.noteTimer = Math.max(0, this.noteTimer - dt * 3.6);
      this.note.style.opacity = `${this.noteTimer}`;
      this.note.style.transform = `scale(${0.75 + this.noteTimer * 0.5})`;
    }
  }

  get isMuted() {
    return this.muted;
  }
}
