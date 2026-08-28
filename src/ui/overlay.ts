/**
 * The only DOM the game shows: a mute control and, at the very end, three
 * pictures. No text anywhere -- a four year old who cannot read must be able to
 * choose "make this one again" without help.
 */
export type ReplayChoice = 'again' | 'resize' | 'play';

function svg(paths: string, size: number): string {
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${paths}</svg>`;
}

/** A jingle bell drawn the way this game's bell actually looks: round body,
 *  a slit low on the shell, a brazed loop on top. */
const BELL = (cx: number, cy: number, r: number) => `
  <circle cx="${cx}" cy="${cy}" r="${r}"/>
  <path d="M ${cx - r * 0.46} ${cy + r * 0.52} h ${r * 0.92}"/>
  <path d="M ${cx - r * 0.3} ${cy - r * 0.96} v ${-r * 0.2}
           a ${r * 0.3} ${r * 0.3} 0 0 1 ${r * 0.6} 0 v ${r * 0.2}"/>`;

export class Overlay {
  readonly root: HTMLDivElement;
  private muteBtn: HTMLButtonElement;
  private choices: HTMLDivElement;
  onMute: ((m: boolean) => void) | null = null;
  onChoice: ((c: ReplayChoice) => void) | null = null;
  private muted = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'ui';
    const style = document.createElement('style');
    style.textContent = `
      #ui { position: fixed; inset: 0; z-index: 10; pointer-events: none;
            font: 400 15px/1 system-ui, sans-serif; color: #e8ddc8; }
      #ui button { pointer-events: auto; -webkit-tap-highlight-color: transparent;
            background: none; border: 0; padding: 0; color: inherit; cursor: pointer; }
      #mute { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 10px);
            right: calc(env(safe-area-inset-right, 0px) + 10px);
            width: 76px; height: 76px; display: grid; place-items: center;
            opacity: 0.42; transition: opacity 200ms; }
      #mute:active { opacity: 0.85; }
      #mute .plate { width: 46px; height: 46px; border-radius: 50%;
            background: rgba(18,15,12,0.5); display: grid; place-items: center;
            backdrop-filter: blur(3px); }
      #choices { position: absolute; left: 0; right: 0;
            bottom: calc(env(safe-area-inset-bottom, 0px) + 14px);
            display: flex; align-items: flex-end; justify-content: center; gap: 14px;
            opacity: 0; visibility: hidden; transform: translateY(24px);
            transition: opacity 600ms ease, transform 600ms ease, visibility 0s linear 600ms; }
      #choices.show { opacity: 1; visibility: visible; transform: none; transition-delay: 0s; }
      /* while hidden these must not intercept a finger aimed at the work */
      #choices button { pointer-events: none; }
      #choices.show button { pointer-events: auto; }
      #choices button { display: grid; place-items: center; border-radius: 24px;
            background: rgba(20,16,12,0.52); backdrop-filter: blur(6px);
            border: 1.5px solid rgba(215,186,132,0.24);
            transition: transform 140ms ease, background 200ms ease; }
      #choices button:active { transform: scale(0.94); background: rgba(38,30,20,0.72); }
      #choices button.primary { width: 112px; height: 112px; border-radius: 30px;
            border-color: rgba(226,196,138,0.6); background: rgba(46,35,21,0.62);
            box-shadow: 0 6px 26px rgba(0,0,0,0.45); }
      #choices button.small { width: 86px; height: 86px; opacity: 0.82; }
      @media (max-height: 420px) { #choices button.primary { width: 96px; height: 96px; }
            #choices button.small { width: 74px; height: 74px; } }
    `;
    this.root.appendChild(style);

    this.muteBtn = document.createElement('button');
    this.muteBtn.id = 'mute';
    this.muteBtn.setAttribute('aria-label', 'sound');
    this.renderMute();
    this.muteBtn.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      this.muted = !this.muted;
      this.renderMute();
      this.onMute?.(this.muted);
    });
    this.root.appendChild(this.muteBtn);

    this.choices = document.createElement('div');
    this.choices.id = 'choices';
    const mk = (cls: string, label: string, inner: string, choice: ReplayChoice) => {
      const b = document.createElement('button');
      b.className = cls;
      b.setAttribute('aria-label', label);
      b.innerHTML = inner;
      b.addEventListener('pointerup', (e) => { e.stopPropagation(); this.onChoice?.(choice); });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      return b;
    };
    // different size: a small bell beside a big one
    this.choices.appendChild(mk('small', 'different size',
      svg(`${BELL(19, 44, 9)}${BELL(43, 34, 16)}`, 58), 'resize'));
    // the loudest option: make this same bell again
    this.choices.appendChild(mk('primary', 'make it again',
      svg(`${BELL(32, 41, 15)}
           <path d="M 9 24 a 23 23 0 0 1 40 -8"/>
           <path d="M 50 5 v 12 h -12"/>`, 74), 'again'));
    // just play with the finished bell
    this.choices.appendChild(mk('small', 'just play',
      svg(`${BELL(32, 38, 14)}
           <path d="M 7 26 q 5 -6 10 0"/><path d="M 57 26 q -5 -6 -10 0"/>
           <path d="M 4 38 q 5 -6 10 0"/><path d="M 60 38 q -5 -6 -10 0"/>`, 58), 'play'));
    this.root.appendChild(this.choices);
    document.body.appendChild(this.root);
  }

  private renderMute() {
    const on = `<path d="M 14 26 h 8 l 11 -9 v 30 l -11 -9 h -8 z"/>
      <path d="M 40 24 a 12 12 0 0 1 0 16"/><path d="M 46 18 a 20 20 0 0 1 0 28"/>`;
    const off = `<path d="M 14 26 h 8 l 11 -9 v 30 l -11 -9 h -8 z"/>
      <path d="M 41 26 l 14 12"/><path d="M 55 26 l -14 12"/>`;
    this.muteBtn.innerHTML = `<span class="plate">${svg(this.muted ? off : on, 26)}</span>`;
  }

  showChoices(v: boolean) { this.choices.classList.toggle('show', v); }
  get choicesVisible() { return this.choices.classList.contains('show'); }
}
