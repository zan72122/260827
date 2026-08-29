export interface HudAction {
  id: string;
  label: string;
  primary?: boolean;
}

export interface HudState {
  line: string;
  sub?: string;
  actions?: HudAction[];
}

/**
 * The whole interface: one short line of hiragana and at most two large
 * buttons. No score, no meters, no arrows pointing at the cake — the cake and
 * the cream are the interface.
 */
export class Hud {
  onAction: ((id: string) => void) | null = null;
  private readonly say: HTMLDivElement;
  private readonly actions: HTMLDivElement;
  private current = '';

  constructor(root: HTMLElement) {
    this.say = document.createElement('div');
    this.say.className = 'hud-say';
    this.actions = document.createElement('div');
    this.actions.className = 'hud-actions';
    root.append(this.say, this.actions);
  }

  set(state: HudState): void {
    const key = `${state.line}|${state.sub ?? ''}|${(state.actions ?? [])
      .map((a) => a.id + a.label)
      .join(',')}`;
    if (key === this.current) return;
    this.current = key;

    this.say.innerHTML = '';
    this.say.append(document.createTextNode(state.line));
    if (state.sub) {
      const small = document.createElement('small');
      small.textContent = state.sub;
      this.say.append(small);
    }
    this.say.classList.toggle('on', state.line.length > 0);

    this.actions.innerHTML = '';
    for (const a of state.actions ?? []) {
      const btn = document.createElement('button');
      btn.className = `hud-btn${a.primary ? ' primary' : ''}`;
      btn.type = 'button';
      btn.textContent = a.label;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.onAction?.(a.id);
      });
      this.actions.append(btn);
    }
  }

  static hideBoot(): void {
    const boot = document.getElementById('boot');
    if (!boot) return;
    boot.classList.add('gone');
    window.setTimeout(() => boot.remove(), 700);
  }
}
