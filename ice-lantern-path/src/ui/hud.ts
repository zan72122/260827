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

  /**
   * Buttons never rely on requestAnimationFrame: on a slow frame the pending
   * hide timer would land after the show class and leave a live button that
   * cannot be pressed.
   */
  private setButton(
    el: HTMLButtonElement,
    label: string | null,
    onClick: (() => void) | undefined,
    gen: number,
    getGen: () => number
  ) {
    if (!label) {
      el.classList.remove('show');
      window.setTimeout(() => {
        if (getGen() === gen) el.style.display = 'none';
      }, 320);
      return;
    }
    el.textContent = label;
    el.style.display = '';
    el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick?.();
    };
    // force layout so the opacity transition still runs from 0
    void el.offsetWidth;
    el.classList.add('show');
  }

  button(label: string | null, onClick?: () => void) {
    const gen = ++this.gen;
    this.setButton(this.primary, label, onClick, gen, () => this.gen);
  }

  button2(label: string | null, onClick?: () => void) {
    const gen = ++this.gen2;
    this.setButton(this.secondary, label, onClick, gen, () => this.gen2);
  }

  setNote(text: string) {
    this.note.textContent = text;
  }

  get bottomEl() {
    return this.bottom;
  }
}
