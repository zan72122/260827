import type { WallKind } from './audio';

export type MenuChoice = WallKind | 'retry';

const CARD_SVGS: Record<string, string> = {
  retry: `<svg viewBox="0 0 100 100">
    <g fill="#a45a42"><rect x="26" y="46" width="20" height="10" rx="1"/><rect x="48" y="46" width="20" height="10" rx="1"/>
    <rect x="16" y="58" width="20" height="10" rx="1"/><rect x="38" y="58" width="20" height="10" rx="1"/><rect x="60" y="58" width="20" height="10" rx="1"/>
    <rect x="26" y="70" width="20" height="10" rx="1"/><rect x="48" y="70" width="20" height="10" rx="1"/></g>
    <path d="M 30 30 A 22 22 0 1 1 50 14" fill="none" stroke="#2e6b48" stroke-width="8" stroke-linecap="round"/>
    <path d="M 50 4 L 64 14 L 50 26 Z" fill="#2e6b48"/>
  </svg>`,
  brick: `<svg viewBox="0 0 100 100">
    <rect x="10" y="14" width="80" height="72" fill="#c9b8a8"/>
    <g fill="#a4523a">
      <rect x="12" y="16" width="24" height="12"/><rect x="38" y="16" width="24" height="12"/><rect x="64" y="16" width="24" height="12"/>
      <rect x="12" y="30" width="11" height="12"/><rect x="25" y="30" width="24" height="12"/><rect x="51" y="30" width="24" height="12"/><rect x="77" y="30" width="11" height="12"/>
      <rect x="12" y="44" width="24" height="12"/><rect x="38" y="44" width="24" height="12"/><rect x="64" y="44" width="24" height="12"/>
      <rect x="12" y="58" width="11" height="12"/><rect x="25" y="58" width="24" height="12"/><rect x="51" y="58" width="24" height="12"/><rect x="77" y="58" width="11" height="12"/>
      <rect x="12" y="72" width="24" height="12"/><rect x="38" y="72" width="24" height="12"/><rect x="64" y="72" width="24" height="12"/>
    </g>
  </svg>`,
  block: `<svg viewBox="0 0 100 100">
    <rect x="10" y="14" width="80" height="72" fill="#c9c5bc"/>
    <g fill="#9a968c" stroke="#7c786f" stroke-width="1">
      <rect x="12" y="16" width="37" height="22"/><rect x="51" y="16" width="37" height="22"/>
      <rect x="12" y="40" width="18" height="22"/><rect x="32" y="40" width="37" height="22"/><rect x="71" y="40" width="17" height="22"/>
      <rect x="12" y="64" width="37" height="22"/><rect x="51" y="64" width="37" height="22"/>
    </g>
    <g fill="#5e5a52">
      <rect x="18" y="20" width="10" height="14" rx="2"/><rect x="33" y="20" width="10" height="14" rx="2"/>
      <rect x="57" y="20" width="10" height="14" rx="2"/><rect x="72" y="20" width="10" height="14" rx="2"/>
    </g>
  </svg>`,
  concrete: `<svg viewBox="0 0 100 100">
    <rect x="14" y="12" width="72" height="76" fill="#a3a19b"/>
    <g fill="#8b8983"><circle cx="30" cy="30" r="3"/><circle cx="70" cy="30" r="3"/><circle cx="30" cy="70" r="3"/><circle cx="70" cy="70" r="3"/></g>
    <path d="M 50 44 L 42 56 M 50 44 L 60 54 M 50 44 L 48 32" stroke="#6e6c66" stroke-width="2" fill="none"/>
    <rect x="14" y="12" width="72" height="6" fill="#93918b"/>
  </svg>`,
};

/**
 * Picture-only overlay for a player who cannot read: one small round menu
 * button, and a picker with big picture cards (rebuild this wall / brick /
 * hollow block / concrete). No scores, timers or currencies anywhere.
 */
export class UI {
  private root: HTMLDivElement;
  private panel: HTMLDivElement;
  private ghost: HTMLDivElement;
  private menuBtn: HTMLButtonElement;
  onChoice: ((c: MenuChoice) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:10;';
    parent.appendChild(this.root);

    // round menu button (safe-area aware)
    this.menuBtn = document.createElement('button');
    this.menuBtn.style.cssText = `position:absolute;top:calc(env(safe-area-inset-top,0px) + 12px);right:calc(env(safe-area-inset-right,0px) + 12px);
      width:54px;height:54px;border-radius:50%;border:none;background:rgba(40,44,50,0.55);pointer-events:auto;
      display:flex;align-items:center;justify-content:center;padding:9px;backdrop-filter:blur(4px);`;
    this.menuBtn.innerHTML = `<svg viewBox="0 0 100 100" style="width:100%;height:100%">
      <g fill="#e8e4dc"><rect x="18" y="24" width="28" height="16" rx="2"/><rect x="50" y="24" width="28" height="16" rx="2"/>
      <rect x="18" y="44" width="14" height="16" rx="2"/><rect x="36" y="44" width="28" height="16" rx="2"/><rect x="68" y="44" width="10" height="16" rx="2"/>
      <rect x="18" y="64" width="28" height="16" rx="2"/><rect x="50" y="64" width="28" height="16" rx="2"/></g></svg>`;
    this.menuBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.menuBtn.addEventListener('click', () => this.togglePanel());
    this.root.appendChild(this.menuBtn);

    // picker panel
    this.panel = document.createElement('div');
    this.panel.style.cssText = `position:absolute;inset:0;display:none;align-items:center;justify-content:center;
      background:rgba(20,24,28,0.45);pointer-events:auto;`;
    const row = document.createElement('div');
    row.style.cssText = `display:flex;gap:16px;flex-wrap:wrap;justify-content:center;align-items:center;max-width:92vw;`;
    for (const key of ['retry', 'brick', 'block', 'concrete'] as MenuChoice[]) {
      const card = document.createElement('button');
      card.dataset.kind = key;
      card.style.cssText = `width:min(24vw,132px);height:min(24vw,132px);border-radius:22px;border:4px solid rgba(255,255,255,0.85);
        background:#f4efe6;padding:10px;box-shadow:0 6px 18px rgba(0,0,0,0.35);`;
      card.innerHTML = CARD_SVGS[key];
      card.addEventListener('pointerdown', (e) => e.stopPropagation());
      card.addEventListener('click', () => {
        this.hidePanel();
        this.onChoice?.(key);
      });
      row.appendChild(card);
    }
    this.panel.appendChild(row);
    this.panel.addEventListener('click', (e) => {
      if (e.target === this.panel) this.hidePanel();
    });
    this.root.appendChild(this.panel);

    // ghost fingertip for the one silent demo
    this.ghost = document.createElement('div');
    this.ghost.style.cssText = `position:absolute;width:44px;height:44px;border-radius:50%;margin:-22px 0 0 -22px;
      background:radial-gradient(circle,rgba(255,255,255,0.85) 0%,rgba(255,255,255,0.25) 55%,transparent 75%);
      display:none;pointer-events:none;`;
    this.root.appendChild(this.ghost);
  }

  setCurrent(kind: WallKind): void {
    for (const el of Array.from(this.panel.querySelectorAll('button'))) {
      const b = el as HTMLButtonElement;
      b.style.borderColor = b.dataset.kind === kind ? '#f2b63c' : 'rgba(255,255,255,0.85)';
    }
  }

  showPanel(): void {
    this.panel.style.display = 'flex';
  }

  hidePanel(): void {
    this.panel.style.display = 'none';
  }

  get panelVisible(): boolean {
    return this.panel.style.display !== 'none';
  }

  togglePanel(): void {
    if (this.panelVisible) this.hidePanel();
    else this.showPanel();
  }

  setGhost(x: number, y: number, visible: boolean): void {
    this.ghost.style.display = visible ? 'block' : 'none';
    if (visible) {
      this.ghost.style.left = `${x}px`;
      this.ghost.style.top = `${y}px`;
    }
  }
}
