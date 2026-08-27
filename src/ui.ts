// Picture-only UI: three end-of-loop choices and a free-play exit button.
// No text anywhere — every button is a pictogram a 4-year-old can read.

// Bold, dark-on-cream pictograms sized for 4-year-old eyes.
const ICON_AGAIN = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 30 L32 12 L54 30" fill="none" stroke="#3a4a72" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="16" y="30" width="32" height="20" rx="3" fill="#3a4a72"/>
  <rect x="41" y="15" width="8" height="12" fill="#b04040"/>
  <path d="M20 60 a12 9 0 1 1 24 2" fill="none" stroke="#2c8a4a" stroke-width="6" stroke-linecap="round"/>
  <path d="M48 55 L48 64 L38 61 Z" fill="#2c8a4a"/>
</svg>`;

const ICON_NEWHOUSE = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 32 L22 17 L40 32" fill="none" stroke="#3a4a72" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="9" y="32" width="26" height="17" rx="2" fill="#3a4a72"/>
  <rect x="27" y="20" width="7" height="10" fill="#b04040"/>
  <path d="M42 10 L56 10 M49 3 L49 17" stroke="#c8a03c" stroke-width="5" stroke-linecap="round"/>
  <rect x="42" y="40" width="17" height="12" rx="2" fill="#7a8fc0"/>
  <path d="M39 40 L50.5 30 L62 40" fill="none" stroke="#7a8fc0" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const ICON_FREE = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect x="23" y="12" width="18" height="44" rx="2" fill="none" stroke="#8a5a34" stroke-width="5"/>
  <rect x="19" y="6" width="26" height="7" rx="2" fill="#8a5a34"/>
  <path d="M10 26 L10 44 M3.5 32.5 L10 26 L16.5 32.5" fill="none" stroke="#3a4a72" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M54 44 L54 26 M47.5 37.5 L54 44 L60.5 37.5" fill="none" stroke="#3a4a72" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="32" cy="34" r="7.5" fill="#b04040"/>
</svg>`;

const ICON_BACK = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <path d="M40 10 L18 32 L40 54" fill="none" stroke="#3a4a72" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export class UI {
  private menuEl = document.getElementById('menu')!;
  private exitEl = document.getElementById('exit-free') as HTMLButtonElement;
  private debugEl = document.getElementById('debug-overlay')!;

  onAgain: (() => void) | null = null;
  onNewHouse: (() => void) | null = null;
  onFree: (() => void) | null = null;
  onExitFree: (() => void) | null = null;

  constructor() {
    const again = document.getElementById('btn-again')!;
    const newhouse = document.getElementById('btn-newhouse')!;
    const free = document.getElementById('btn-free')!;
    again.innerHTML = ICON_AGAIN;
    newhouse.innerHTML = ICON_NEWHOUSE;
    free.innerHTML = ICON_FREE;
    this.exitEl.innerHTML = ICON_BACK;
    again.addEventListener('click', () => this.onAgain?.());
    newhouse.addEventListener('click', () => this.onNewHouse?.());
    free.addEventListener('click', () => this.onFree?.());
    this.exitEl.addEventListener('click', () => this.onExitFree?.());
    if (new URLSearchParams(location.search).has('debug')) {
      this.debugEl.style.display = 'block';
    }
  }

  showMenu(v: boolean): void {
    this.menuEl.classList.toggle('visible', v);
  }

  showExit(v: boolean): void {
    this.exitEl.classList.toggle('visible', v);
  }

  setDebug(text: string): void {
    if (this.debugEl.style.display !== 'none') {
      this.debugEl.textContent = text;
    }
  }
}
