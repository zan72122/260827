/** Text-free picture buttons for 4-year-olds. Icons are drawn on canvases. */

type IconKind = 'return' | 'another' | 'fly' | 'inout';

function drawIcon(g: CanvasRenderingContext2D, kind: IconKind) {
  const S = 128;
  g.clearRect(0, 0, S, S);
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const sack = (cx: number, cy: number, s: number) => {
    g.fillStyle = '#c23a3a';
    g.beginPath();
    g.moveTo(cx - 26 * s, cy - 18 * s);
    g.bezierCurveTo(cx - 40 * s, cy + 8 * s, cx - 34 * s, cy + 34 * s, cx, cy + 36 * s);
    g.bezierCurveTo(cx + 34 * s, cy + 34 * s, cx + 40 * s, cy + 8 * s, cx + 26 * s, cy - 18 * s);
    g.closePath();
    g.fill();
    g.fillStyle = '#f4ecd9';
    g.beginPath();
    g.ellipse(cx, cy - 20 * s, 28 * s, 9 * s, 0, 0, 7);
    g.fill();
    g.fillStyle = '#38121a';
    g.beginPath();
    g.ellipse(cx, cy - 20 * s, 20 * s, 5.5 * s, 0, 0, 7);
    g.fill();
    // stars inside the mouth
    g.fillStyle = '#ffe9a8';
    for (const [dx, dy, r] of [[-8, -21, 2], [2, -19, 2.6], [10, -22, 1.8]] as const) {
      g.beginPath(); g.arc(cx + dx * s, cy + dy * s, r * s, 0, 7); g.fill();
    }
  };
  const arrow = (x0: number, y0: number, x1: number, y1: number, color: string, w = 9) => {
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = w;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    const a = Math.atan2(y1 - y0, x1 - x0);
    g.beginPath();
    g.moveTo(x1 + Math.cos(a) * 14, y1 + Math.sin(a) * 14);
    g.lineTo(x1 + Math.cos(a + 2.5) * 13, y1 + Math.sin(a + 2.5) * 13);
    g.lineTo(x1 + Math.cos(a - 2.5) * 13, y1 + Math.sin(a - 2.5) * 13);
    g.closePath(); g.fill();
  };

  if (kind === 'return') {
    sack(64, 76, 1.15);
    arrow(64, 62, 64, 20, '#ffe9a8');
  } else if (kind === 'another') {
    sack(78, 80, 0.95);
    // little present with bow
    g.fillStyle = '#e8b93e';
    g.fillRect(18, 30, 36, 32);
    g.fillStyle = '#c23a3a';
    g.fillRect(33, 30, 7, 32);
    g.fillRect(18, 43, 36, 7);
    g.strokeStyle = '#c23a3a'; g.lineWidth = 5;
    g.beginPath(); g.arc(31, 27, 6, 0, 7); g.stroke();
    g.beginPath(); g.arc(43, 27, 6, 0, 7); g.stroke();
    arrow(48, 52, 68, 62, '#ffe9a8', 7);
  } else if (kind === 'fly') {
    // big star with motion swoosh
    g.fillStyle = '#ffe9a8';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 30 : 13;
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      const x = 74 + Math.cos(a) * r, y = 50 + Math.sin(a) * r;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath(); g.fill();
    g.strokeStyle = '#ffd97a'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(20, 96); g.quadraticCurveTo(50, 92, 62, 72); g.stroke();
    g.beginPath(); g.moveTo(14, 78); g.quadraticCurveTo(38, 76, 48, 62); g.stroke();
  } else {
    sack(64, 80, 1.05);
    arrow(46, 16, 54, 50, '#ffe9a8', 7);
    arrow(76, 50, 84, 16, '#8fd0ff', 7);
  }
}

export class UI {
  private root = document.getElementById('ui')!;
  private buttons = new Map<string, HTMLButtonElement>();

  private make(kind: IconKind, id: string, onTap: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'picbtn';
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    drawIcon(c.getContext('2d')!, kind);
    b.appendChild(c);
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); onTap(); });
    this.root.appendChild(b);
    this.buttons.set(id, b);
    return b;
  }

  /** the "go back out of the sack" button, bottom center */
  showReturn(onTap: () => void) {
    this.hide('return');
    const b = this.make('return', 'return', onTap);
    b.style.left = 'calc(50% - 46px)';
    b.style.bottom = 'calc(24px + env(safe-area-inset-bottom))';
    requestAnimationFrame(() => b.classList.add('show'));
  }

  /** end menu: three picture choices */
  showMenu(onAnother: () => void, onFly: () => void, onInOut: () => void) {
    const kinds: [IconKind, string, () => void][] = [
      ['another', 'menu-a', onAnother],
      ['fly', 'menu-f', onFly],
      ['inout', 'menu-i', onInOut],
    ];
    kinds.forEach(([k, id, fn], i) => {
      this.hide(id);
      const b = this.make(k, id, fn);
      const portrait = innerHeight > innerWidth;
      if (portrait) {
        b.style.left = 'calc(50% - 46px)';
        b.style.bottom = `calc(${30 + i * 112}px + env(safe-area-inset-bottom))`;
      } else {
        b.style.left = `calc(50% + ${(i - 1) * 120 - 46}px)`;
        b.style.bottom = 'calc(28px + env(safe-area-inset-bottom))';
      }
      setTimeout(() => b.classList.add('show'), i * 140);
    });
  }

  hide(id: string) {
    const b = this.buttons.get(id);
    if (b) {
      b.classList.remove('show');
      setTimeout(() => b.remove(), 400);
      this.buttons.delete(id);
    }
  }
  hideAll() { for (const id of [...this.buttons.keys()]) this.hide(id); }
}
