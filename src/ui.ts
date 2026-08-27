// Picture-only UI: three end-of-loop choices and a free-play exit button.
// No text anywhere — every button is a pictogram a 4-year-old can read.

const ICON_AGAIN = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <path d="M14 32 L32 16 L50 32" fill="none" stroke="#e8ecf8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="19" y="32" width="26" height="16" rx="2" fill="#e8ecf8"/>
  <rect x="38" y="18" width="6" height="10" fill="#e8ecf8"/>
  <path d="M24 57 a10 8 0 1 1 20 0" fill="none" stroke="#8fd0a0" stroke-width="4" stroke-linecap="round"/>
  <path d="M46 51 L46 59 L38 57 Z" fill="#8fd0a0"/>
</svg>`;

const ICON_NEWHOUSE = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 34 L24 20 L40 34" fill="none" stroke="#e8ecf8" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="13" y="34" width="22" height="14" rx="2" fill="#e8ecf8"/>
  <rect x="29" y="22" width="6" height="9" fill="#d88f5a"/>
  <path d="M40 14 L52 14 M46 8 L46 20" stroke="#f2d06a" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M50 30 L58 30 M54 26 L54 34" stroke="#f2d06a" stroke-width="2.5" stroke-linecap="round"/>
  <rect x="42" y="38" width="14" height="10" rx="2" fill="#a8b6d8"/>
  <path d="M40 38 L49 30 L58 38" fill="none" stroke="#a8b6d8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const ICON_FREE = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect x="24" y="12" width="16" height="42" rx="2" fill="none" stroke="#d8a078" stroke-width="4"/>
  <rect x="20" y="8" width="24" height="6" rx="2" fill="#d8a078"/>
  <path d="M12 26 L12 42 M7 31 L12 26 L17 31" fill="none" stroke="#e8ecf8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M52 42 L52 26 M47 37 L52 42 L57 37" fill="none" stroke="#e8ecf8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="32" cy="33" r="6" fill="#c85050"/>
</svg>`;

const ICON_BACK = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <path d="M40 12 L20 32 L40 52" fill="none" stroke="#e8ecf8" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
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
