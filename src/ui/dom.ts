export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c);
  return n;
}

export function clear(n: HTMLElement): void {
  while (n.firstChild) n.removeChild(n.firstChild);
}

/** 選択肢（チェックボックス相当）。48px 以上の当たり判定を確保する。 */
export function option(text: string, sub: string | null, checked: boolean, onToggle: (v: boolean) => void): HTMLElement {
  const row = el('div', { class: `opt${checked ? ' on' : ''}`, role: 'checkbox', 'aria-checked': String(checked), tabindex: '0' });
  const box = el('span', { class: 'box' });
  const txt = el('span', { class: 'txt' });
  txt.append(text);
  if (sub) txt.append(el('span', { class: 'sub' }, sub));
  row.append(box, txt);
  let on = checked;
  const toggle = (): void => {
    on = !on;
    row.classList.toggle('on', on);
    row.setAttribute('aria-checked', String(on));
    onToggle(on);
  };
  row.addEventListener('click', toggle);
  row.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
  return row;
}

export class Sheet {
  private root = $('sheet');
  private titleEl = $('sheet-title');
  private bodyEl = $('sheet-body');
  onClose: (() => void) | null = null;

  constructor() {
    $('sheet-close').addEventListener('click', () => this.close());
  }

  open(title: string, build: (body: HTMLElement) => void): void {
    this.titleEl.textContent = title;
    clear(this.bodyEl);
    build(this.bodyEl);
    this.root.hidden = false;
    this.bodyEl.scrollTop = 0;
  }

  get body(): HTMLElement {
    return this.bodyEl;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  close(): void {
    this.root.hidden = true;
    clear(this.bodyEl);
    this.onClose?.();
  }
}
