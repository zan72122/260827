import { ICONS, colorSwatchIcon } from './icons';

/**
 * The whole interface: a row of large picture buttons along the bottom, a mute
 * toggle in the corner, and a gentle hint that shows the shape of the gesture
 * when a child pauses. No text, no timer, no score.
 */

export interface ChoiceButton {
  id: string;
  /** Key into ICONS, or raw SVG markup. */
  icon: string;
  /** Spoken label for assistive technology; never shown. */
  label: string;
  selected?: boolean;
  tint?: string;
}

export type HintKind = 'arc' | 'tap' | 'swipe' | null;

const CSS = `
.ui-root { position: fixed; inset: 0; pointer-events: none; z-index: 10; }
.ui-choices {
  position: absolute; left: 0; right: 0;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 18px);
  display: flex; gap: 16px; justify-content: center; align-items: flex-end;
  padding: 0 14px; flex-wrap: wrap;
}
.ui-btn {
  pointer-events: auto;
  width: 78px; height: 78px; padding: 0; border: none;
  border-radius: 50%;
  background: rgba(255, 252, 246, 0.93);
  box-shadow: 0 5px 16px rgba(70, 52, 34, 0.26), inset 0 0 0 2px rgba(255,255,255,0.7);
  display: grid; place-items: center;
  cursor: pointer;
  transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.ui-btn svg { width: 56px; height: 56px; display: block; }
.ui-btn:active { transform: scale(0.94); }
.ui-btn.selected {
  background: #fff;
  box-shadow: 0 5px 16px rgba(70,52,34,0.3), inset 0 0 0 4px #c98aa0;
  transform: translateY(-4px);
}
.ui-btn.pulse { animation: uiPulse 2.4s ease-in-out infinite; }
@keyframes uiPulse {
  0%, 72%, 100% { transform: translateY(0) scale(1); }
  82% { transform: translateY(-6px) scale(1.05); }
}
.ui-corner {
  pointer-events: auto;
  position: absolute; top: calc(env(safe-area-inset-top, 0px) + 12px);
  right: calc(env(safe-area-inset-right, 0px) + 12px);
  width: 52px; height: 52px; border: none; border-radius: 50%;
  background: rgba(255, 252, 246, 0.78);
  box-shadow: 0 3px 10px rgba(70,52,34,0.2);
  display: grid; place-items: center; cursor: pointer;
  touch-action: manipulation;
}
.ui-corner svg { width: 32px; height: 32px; }
.ui-hint {
  position: absolute; inset: 0; pointer-events: none;
  display: grid; place-items: center;
  opacity: 0; transition: opacity 600ms ease;
}
.ui-hint.on { opacity: 0.92; }
.ui-hint svg { width: min(46vw, 240px); height: min(46vw, 240px); overflow: visible; }
.ui-hint .trace {
  fill: none; stroke: #fff; stroke-width: 5; stroke-linecap: round;
  filter: drop-shadow(0 1px 3px rgba(60,40,25,0.55));
  stroke-dasharray: 26 300; animation: uiTrace 2.6s ease-in-out infinite;
}
@keyframes uiTrace { from { stroke-dashoffset: 300; } to { stroke-dashoffset: 0; } }
.ui-hint .dot { fill: #fff; filter: drop-shadow(0 1px 3px rgba(60,40,25,0.55)); }
.ui-dev {
  position: absolute; left: 10px; top: calc(env(safe-area-inset-top, 0px) + 10px);
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #3b2f24; background: rgba(255,255,255,0.82); padding: 6px 9px;
  border-radius: 8px; white-space: pre; pointer-events: none; display: none;
}
@media (prefers-reduced-motion: reduce) {
  .ui-btn.pulse { animation: none; }
  .ui-hint .trace { animation-duration: 6s; }
}
@media (max-height: 460px) {
  .ui-btn { width: 62px; height: 62px; }
  .ui-btn svg { width: 44px; height: 44px; }
  .ui-choices { bottom: calc(env(safe-area-inset-bottom, 0px) + 10px); gap: 12px; }
}
`;

const HINT_SVG: Record<Exclude<HintKind, null>, string> = {
  arc: `<svg viewBox="0 0 200 200">
      <path class="trace" d="M150 100a50 50 0 1 1-14.6-35.4"/>
      <circle class="dot" cx="150" cy="100" r="9"/>
    </svg>`,
  tap: `<svg viewBox="0 0 200 200">
      <circle class="trace" cx="100" cy="100" r="34" stroke-dasharray="14 200"/>
      <circle class="dot" cx="100" cy="100" r="10"/>
    </svg>`,
  swipe: `<svg viewBox="0 0 200 200">
      <path class="trace" d="M40 120c30-26 90-26 120 0"/>
      <circle class="dot" cx="40" cy="120" r="9"/>
    </svg>`,
};

export class Overlay {
  readonly root: HTMLDivElement;
  private readonly choices: HTMLDivElement;
  private readonly mute: HTMLButtonElement;
  private readonly hint: HTMLDivElement;
  private readonly dev: HTMLDivElement;
  private onChoice: ((id: string) => void) | null = null;
  private onMute: ((muted: boolean) => void) | null = null;
  private muted = false;
  private currentHint: HintKind = null;

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.className = 'ui-root';

    this.hint = document.createElement('div');
    this.hint.className = 'ui-hint';
    this.root.appendChild(this.hint);

    this.choices = document.createElement('div');
    this.choices.className = 'ui-choices';
    this.root.appendChild(this.choices);

    this.mute = document.createElement('button');
    this.mute.className = 'ui-corner';
    this.mute.type = 'button';
    this.mute.setAttribute('aria-label', 'sound on or off');
    this.mute.innerHTML = ICONS.soundOn;
    this.mute.addEventListener('click', () => {
      this.muted = !this.muted;
      this.mute.innerHTML = this.muted ? ICONS.soundOff : ICONS.soundOn;
      this.onMute?.(this.muted);
    });
    this.root.appendChild(this.mute);

    this.dev = document.createElement('div');
    this.dev.className = 'ui-dev';
    this.root.appendChild(this.dev);

    parent.appendChild(this.root);
  }

  setChoiceHandler(cb: (id: string) => void): void {
    this.onChoice = cb;
  }

  setMuteHandler(cb: (muted: boolean) => void): void {
    this.onMute = cb;
  }

  /** Replace the row of picture buttons. Passing [] clears it. */
  setChoices(list: ChoiceButton[], pulseFirst = false): void {
    const signature = list.map((c) => `${c.id}:${c.selected ? 1 : 0}:${c.tint ?? ''}`).join('|');
    if (this.choices.dataset.signature === signature) return;
    this.choices.dataset.signature = signature;
    this.choices.replaceChildren();
    list.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ui-btn' + (c.selected ? ' selected' : '') + (pulseFirst && i === 0 ? ' pulse' : '');
      b.setAttribute('aria-label', c.label);
      b.innerHTML = c.tint ? colorSwatchIcon(c.tint) : (ICONS[c.icon] ?? c.icon);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onChoice?.(c.id);
      });
      // Stop the piping gesture from starting under a button.
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.choices.appendChild(b);
    });
  }

  setHint(kind: HintKind): void {
    if (kind === this.currentHint) return;
    this.currentHint = kind;
    if (!kind) {
      this.hint.classList.remove('on');
      return;
    }
    this.hint.innerHTML = HINT_SVG[kind];
    this.hint.classList.add('on');
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.mute.innerHTML = m ? ICONS.soundOff : ICONS.soundOn;
  }

  setDevText(text: string | null): void {
    if (!text) {
      this.dev.style.display = 'none';
      return;
    }
    this.dev.style.display = 'block';
    this.dev.textContent = text;
  }

  dispose(): void {
    this.root.remove();
  }
}
