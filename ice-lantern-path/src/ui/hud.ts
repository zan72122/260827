/** Big, quiet, hiragana-first HUD. No timers, no score, no failure. */
export class Hud {
  root: HTMLElement;
  private chip: HTMLElement;
  private step: HTMLElement;
  private hint: HTMLElement;
  private bottom: HTMLElement;
  private primary: HTMLButtonElement;
  private secondary: HTMLButtonElement;
  private note: HTMLElement;
  private gen = 0;
  private gen2 = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-top">
        <div class="chip" id="hud-chip"></div>
        <div class="step" id="hud-step"></div>
      </div>
      <div class="hud-hint" id="hud-hint"></div>
      <div class="hud-bottom">
        <button class="btn ghost" id="hud-secondary"></button>
        <button class="btn" id="hud-primary"></button>
      </div>
      <div class="quality-note" id="hud-note"></div>`;
    this.chip = root.querySelector('#hud-chip')!;
    this.step = root.querySelector('#hud-step')!;
    this.hint = root.querySelector('#hud-hint')!;
    this.bottom = root.querySelector('.hud-bottom')!;
    this.primary = root.querySelector('#hud-primary')!;
    this.secondary = root.querySelector('#hud-secondary')!;
    this.note = root.querySelector('#hud-note')!;
    this.primary.style.display = 'none';
    this.secondary.style.display = 'none';
  }

  say(text: string) {
    if (this.chip.textContent === text) return;
    this.chip.textContent = text;
    this.chip.classList.toggle('show', !!text);
  }

  setStep(text: string) {
    this.step.textContent = text;
  }

  showHint(text: string) {
    this.hint.textContent = text;
    this.hint.classList.add('show');
  }

  hideHint() {
    this.hint.classList.remove('show');
  }

  button(label: string | null, onClick?: () => void) {
    const gen = ++this.gen;
    if (!label) {
      this.primary.classList.remove('show');
      window.setTimeout(() => {
        if (!this.primary.classList.contains('show')) this.primary.style.display = 'none';
      }, 320);
      return;
    }
    this.primary.textContent = label;
    this.primary.style.display = '';
    this.primary.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick?.();
    };
    requestAnimationFrame(() => {
      if (gen === this.gen) this.primary.classList.add('show');
    });
  }

  button2(label: string | null, onClick?: () => void) {
    const gen = ++this.gen2;
    if (!label) {
      this.secondary.classList.remove('show');
      window.setTimeout(() => {
        if (!this.secondary.classList.contains('show')) this.secondary.style.display = 'none';
      }, 320);
      return;
    }
    this.secondary.textContent = label;
    this.secondary.style.display = '';
    this.secondary.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick?.();
    };
    requestAnimationFrame(() => {
      if (gen === this.gen2) this.secondary.classList.add('show');
    });
  }

  setNote(text: string) {
    this.note.textContent = text;
  }

  get bottomEl() {
    return this.bottom;
  }
}
