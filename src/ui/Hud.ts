/**
 * The only screen furniture: progress pips, a one-condition switch and replay.
 * No instructions, no tutorial text, no chat, no accounts.
 */
const CHILD_LINE = 'お手紙に印を押して、絵の同じ袋へ入れて、世界へ送った';

export interface HudCallbacks {
  onToggleMode: (oneCondition: boolean) => void;
  onReplay: () => void;
}

export class Hud {
  private pips: HTMLElement;
  private line: HTMLElement;
  private modeBtn: HTMLButtonElement;
  private loading: HTMLElement;
  private loadingBar: HTMLElement;
  private oneCondition = false;

  constructor(cb: HudCallbacks) {
    this.pips = must('pips');
    this.line = must('childline');
    this.modeBtn = must('btn-mode') as HTMLButtonElement;
    this.loading = must('loading');
    this.loadingBar = this.loading.firstElementChild as HTMLElement;

    this.modeBtn.addEventListener('click', () => {
      this.oneCondition = !this.oneCondition;
      this.modeBtn.dataset.on = String(this.oneCondition);
      const second = document.getElementById('mode-second');
      if (second) second.style.opacity = this.oneCondition ? '0.25' : '1';
      cb.onToggleMode(this.oneCondition);
    });

    must('btn-replay').addEventListener('click', () => {
      cb.onReplay();
    });
  }

  setPips(total: number, done: number): void {
    while (this.pips.childElementCount > total) this.pips.lastElementChild?.remove();
    while (this.pips.childElementCount < total) {
      const d = document.createElement('div');
      d.className = 'pip';
      this.pips.appendChild(d);
    }
    [...this.pips.children].forEach((el, i) => {
      el.className = 'pip' + (i < done ? ' done' : i === done ? ' active' : '');
    });
  }

  setChildLine(show: boolean): void {
    this.line.textContent = show ? CHILD_LINE : '';
    this.line.classList.toggle('show', show);
  }

  setLoading(progress: number): void {
    this.loadingBar.style.width = `${Math.round(Math.max(0.08, progress) * 100)}%`;
    this.loading.classList.toggle('hidden', progress >= 1);
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
}
