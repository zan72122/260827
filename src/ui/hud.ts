/**
 * All on-screen furniture.
 *
 * There is no written language anywhere in the game: the only persistent
 * controls are a speaker and a volume slider, and the end-of-run choice is
 * made from three pictures. Hints are drawn as a moving hand, never as text.
 */

export type ReplayChoice = 'again' | 'rebell' | 'walk';

const NS = 'http://www.w3.org/2000/svg';

function svg(width: number, height: number, body: string, cls = ''): SVGSVGElement {
  const el = document.createElementNS(NS, 'svg') as SVGSVGElement;
  el.setAttribute('viewBox', `0 0 ${width} ${height}`);
  el.setAttribute('class', cls);
  el.innerHTML = body;
  return el;
}

const STYLE = `
#hud { position: absolute; inset: 0; pointer-events: none; z-index: 20;
  font-size: 0; -webkit-user-select: none; user-select: none; }
#hud .row { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 10px);
  right: calc(env(safe-area-inset-right, 0px) + 12px);
  display: flex; align-items: center; gap: 8px; pointer-events: auto; }
#hud button { -webkit-appearance: none; appearance: none; border: 0; padding: 0; margin: 0;
  background: rgba(18,22,28,0.42); border-radius: 999px;
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  width: 46px; height: 46px; display: grid; place-items: center; cursor: pointer;
  box-shadow: 0 1px 6px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(255,255,255,0.1);
  touch-action: manipulation; }
#hud button:active { transform: scale(0.94); }
#hud .vol { width: 118px; height: 46px; border-radius: 999px;
  background: rgba(18,22,28,0.42); backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px); display: flex; align-items: center;
  padding: 0 14px; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1); }
#hud .vol input { -webkit-appearance: none; appearance: none; width: 100%; height: 5px;
  border-radius: 3px; background: rgba(255,255,255,0.28); outline: none; }
#hud .vol input::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px;
  border-radius: 50%; background: #f0dcb4; box-shadow: 0 1px 3px rgba(0,0,0,0.45); }
#hud .vol input::-moz-range-thumb { width: 20px; height: 20px; border: 0;
  border-radius: 50%; background: #f0dcb4; }

#hud .hint { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
  pointer-events: none; opacity: 0; transition: opacity 500ms ease; }
#hud .hint.on { opacity: 0.92; }
#hud .hint svg { width: 84px; height: 84px; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.5)); }
#hud .hint.drag svg { animation: dragLoop 2.4s ease-in-out infinite; }
#hud .hint.swipe svg { animation: swipeLoop 2.1s ease-in-out infinite; }
#hud .hint.shake svg { animation: shakeLoop 1.5s ease-in-out infinite; }
@keyframes dragLoop { 0%,12% { transform: translate(0,0); } 55% { transform: translate(0,-58px); }
  75%,100% { transform: translate(0,-58px); opacity: 0; } }
@keyframes swipeLoop { 0%,10% { transform: translate(0,26px); opacity: 0.2; }
  45% { transform: translate(0,-34px); opacity: 1; }
  70%,100% { transform: translate(0,-34px); opacity: 0; } }
@keyframes shakeLoop { 0%,100% { transform: translate(-26px,0); }
  50% { transform: translate(26px,0); } }

#fadeveil { position: absolute; inset: 0; z-index: 30; pointer-events: none;
  background: #eef3f8; opacity: 0; transition: opacity 620ms ease; }
/* The cards sit along the bottom so the place you have just arrived at stays
   visible behind them. */
#hud .choices { position: absolute; inset: 0; display: none; align-items: flex-end;
  justify-content: center; gap: clamp(10px, 3vw, 30px); pointer-events: auto;
  background: linear-gradient(to bottom, rgba(10,14,20,0) 40%, rgba(10,14,20,0.5));
  padding: 0 calc(env(safe-area-inset-right,0px) + 12px)
           calc(env(safe-area-inset-bottom,0px) + 18px)
           calc(env(safe-area-inset-left,0px) + 12px); }
#hud .choices.on { display: flex; }
#hud .choices .card { background: rgba(28,33,41,0.82); border-radius: 22px;
  width: clamp(96px, 20vw, 150px); aspect-ratio: 1 / 1.06; display: grid; place-items: center;
  box-shadow: 0 6px 20px rgba(0,0,0,0.45), inset 0 0 0 2px rgba(240,220,180,0.22);
  cursor: pointer; transition: transform 160ms ease; touch-action: manipulation; }
#hud .choices .card:active { transform: scale(0.95); }
#hud .choices .card svg { width: 76%; height: 76%; }
@media (orientation: portrait) {
  #hud .choices { gap: clamp(6px, 2vw, 16px); }
  #hud .choices .card { width: clamp(84px, 28vw, 150px); aspect-ratio: 1 / 1.05; }
}
@media (prefers-reduced-motion: reduce) {
  #hud .hint svg { animation-duration: 5s !important; }
  #hud .choices .card { transition: none; }
}
`;

const ICON_HAND = `
  <g fill="none" stroke="#f4e6c8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M32 44V22a5 5 0 0 1 10 0v18" fill="rgba(244,230,200,0.16)"/>
    <path d="M42 34v-6a5 5 0 0 1 10 0v10"/>
    <path d="M52 36v-4a5 5 0 0 1 10 0v18c0 10-7 18-17 18h-6c-6 0-9-3-12-8l-8-13a5 5 0 0 1 8-6l5 6"/>
  </g>`;

const ICON_SPEAKER_ON = `
  <g fill="#f0dcb4">
    <path d="M13 19h7l9-7v24l-9-7h-7z"/>
  </g>
  <g fill="none" stroke="#f0dcb4" stroke-width="3" stroke-linecap="round">
    <path d="M33 18a9 9 0 0 1 0 12"/>
    <path d="M38 13a16 16 0 0 1 0 22"/>
  </g>`;

const ICON_SPEAKER_OFF = `
  <g fill="#e9c8c0"><path d="M13 19h7l9-7v24l-9-7h-7z"/></g>
  <g fill="none" stroke="#e9c8c0" stroke-width="3.4" stroke-linecap="round">
    <path d="M34 18l12 12M46 18L34 30"/>
  </g>`;

const CARD_AGAIN = `
  <g fill="none" stroke="#f2e3c2" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M18 66h44M22 66c-6-4-6-14 2-16l30-5"/>
    <path d="M28 45l6-14h20l6 14"/>
    <circle cx="30" cy="24" r="4" fill="#f2e3c2"/>
    <path d="M62 22a22 22 0 1 0 6 16" />
    <path d="M68 24v14h-14"/>
  </g>`;

const CARD_BELLS = `
  <g fill="none" stroke="#f2e3c2" stroke-width="4" stroke-linecap="round">
    <path d="M10 28c18 12 52 12 70 0"/>
  </g>
  <g fill="#f2e3c2">
    <circle cx="24" cy="44" r="9"/><circle cx="44" cy="49" r="12"/><circle cx="64" cy="44" r="9"/>
  </g>
  <g stroke="#2a2118" stroke-width="3" stroke-linecap="round">
    <path d="M19 47h10M38 53h12M59 47h10"/>
  </g>`;

const CARD_WALK = `
  <g fill="none" stroke="#f2e3c2" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 30c6-8 20-10 28-4l10 2 8 8-6 6-4 16"/>
    <path d="M30 26l-4-10"/>
    <path d="M34 42v22M46 46v18M56 44v20"/>
  </g>
  <g fill="#f2e3c2">
    <ellipse cx="26" cy="70" rx="4" ry="3"/><ellipse cx="40" cy="74" rx="4" ry="3"/>
    <ellipse cx="54" cy="70" rx="4" ry="3"/><ellipse cx="68" cy="74" rx="4" ry="3"/>
  </g>`;

export type HintKind = 'none' | 'drag' | 'swipe' | 'shake' | 'buckle';

export class Hud {
  readonly root: HTMLDivElement;
  private muteBtn: HTMLButtonElement;
  private volInput: HTMLInputElement;
  private hint: HTMLDivElement;
  private choices: HTMLDivElement;
  private veil: HTMLDivElement;
  private muted = false;

  onMuteChange: (muted: boolean) => void = () => {};
  onVolumeChange: (v: number) => void = () => {};
  onChoice: (c: ReplayChoice) => void = () => {};
  /** fires on any pointer contact with the HUD, used to unlock audio */
  onAnyInput: () => void = () => {};

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'hud';

    const row = document.createElement('div');
    row.className = 'row';

    this.muteBtn = document.createElement('button');
    this.muteBtn.setAttribute('aria-label', 'sound');
    this.muteBtn.appendChild(svg(48, 48, ICON_SPEAKER_ON));
    this.muteBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onAnyInput();
    });
    this.muteBtn.addEventListener('click', () => {
      this.muted = !this.muted;
      this.muteBtn.replaceChildren(svg(48, 48, this.muted ? ICON_SPEAKER_OFF : ICON_SPEAKER_ON));
      this.onMuteChange(this.muted);
    });
    row.appendChild(this.muteBtn);

    const vol = document.createElement('div');
    vol.className = 'vol';
    this.volInput = document.createElement('input');
    this.volInput.type = 'range';
    this.volInput.min = '0';
    this.volInput.max = '100';
    this.volInput.value = '85';
    this.volInput.setAttribute('aria-label', 'volume');
    this.volInput.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onAnyInput();
    });
    this.volInput.addEventListener('input', () => {
      this.onVolumeChange(Number(this.volInput.value) / 100);
    });
    vol.appendChild(this.volInput);
    row.appendChild(vol);
    this.root.appendChild(row);

    this.hint = document.createElement('div');
    this.hint.className = 'hint';
    this.hint.appendChild(svg(84, 84, ICON_HAND));
    this.root.appendChild(this.hint);

    this.choices = document.createElement('div');
    this.choices.className = 'choices';
    const cards: Array<[ReplayChoice, string]> = [
      ['again', CARD_AGAIN],
      ['rebell', CARD_BELLS],
      ['walk', CARD_WALK],
    ];
    for (const [key, art] of cards) {
      const card = document.createElement('div');
      card.className = 'card';
      card.appendChild(svg(84, 84, art));
      card.addEventListener('pointerdown', (e) => e.stopPropagation());
      card.addEventListener('click', () => {
        this.showChoices(false);
        this.onChoice(key);
      });
      this.choices.appendChild(card);
    }
    this.root.appendChild(this.choices);

    this.veil = document.createElement('div');
    this.veil.id = 'fadeveil';
    parent.appendChild(this.veil);

    parent.appendChild(this.root);
  }

  /** Cross-dissolve between sets. 1 = fully covered. */
  fade(to: number, ms = 620, color = '#eef3f8'): void {
    this.veil.style.background = color;
    this.veil.style.transitionDuration = `${ms}ms`;
    this.veil.style.opacity = String(to);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.muteBtn.replaceChildren(svg(48, 48, m ? ICON_SPEAKER_OFF : ICON_SPEAKER_ON));
  }

  setVolume(v: number): void {
    this.volInput.value = String(Math.round(v * 100));
  }

  /**
   * @param at optional screen position in CSS pixels; otherwise centred
   */
  showHint(kind: HintKind, at?: { x: number; y: number }): void {
    this.hint.className = 'hint';
    if (kind === 'none') return;
    const anim = kind === 'buckle' ? 'shake' : kind;
    this.hint.className = `hint on ${anim}`;
    if (at) {
      this.hint.style.left = `${at.x}px`;
      this.hint.style.top = `${at.y}px`;
    } else {
      this.hint.style.left = '50%';
      this.hint.style.top = '58%';
    }
  }

  showChoices(on: boolean): void {
    this.choices.classList.toggle('on', on);
  }
}
