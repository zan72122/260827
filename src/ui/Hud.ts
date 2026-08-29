import { ICONS } from './icons';
import { clamp } from '../core/math';

export type ControlKind = 'hold' | 'dragY' | 'dragX' | 'press' | 'wheel';

export interface ControlSpec {
  id: string;
  kind: ControlKind;
  icon: keyof typeof ICONS | string;
  /** Short caption for the adult in the room; the icon carries the meaning. */
  label: string;
  tone?: 'primary' | 'trim' | 'danger';
  /** Optional 0..1 fill shown inside the control. */
  progress?: number;
}

interface ControlState extends ControlSpec {
  el: HTMLButtonElement;
  fill: HTMLElement;
  active: boolean;
  lastX: number;
  lastY: number;
}

/**
 * Touch console.
 *
 * Every control is a single, very large target with one job, because the
 * player is four: hold to hoist, turn to tension, pull to release, push to
 * enable. Nothing needs to be read, nothing is timed, and nothing can be
 * dragged into an unsafe state — the machinery clamps that, not the UI.
 */
export class Hud {
  readonly root: HTMLElement;
  private readonly controlBar: HTMLElement;
  private readonly stepBar: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly lampRow: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly controls = new Map<string, ControlState>();
  private readonly steps: HTMLElement[] = [];

  onHold: (id: string, active: boolean) => void = () => undefined;
  onDrag: (id: string, delta: number) => void = () => undefined;
  onPress: (id: string) => void = () => undefined;

  constructor(root: HTMLElement, stepLabels: string[]) {
    this.root = root;
    root.innerHTML = '';

    this.stepBar = document.createElement('div');
    this.stepBar.className = 'step-bar';
    for (const label of stepLabels) {
      const pip = document.createElement('div');
      pip.className = 'step-pip';
      pip.title = label;
      this.stepBar.appendChild(pip);
      this.steps.push(pip);
    }
    root.appendChild(this.stepBar);

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'hint';
    this.hintEl.setAttribute('data-testid', 'hint');
    root.appendChild(this.hintEl);

    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'banner';
    this.bannerEl.setAttribute('data-testid', 'banner');
    root.appendChild(this.bannerEl);

    this.lampRow = document.createElement('div');
    this.lampRow.className = 'lamp-row';
    for (let i = 0; i < 3; i++) {
      const lamp = document.createElement('div');
      lamp.className = 'lamp';
      this.lampRow.appendChild(lamp);
    }
    this.lampRow.style.display = 'none';
    root.appendChild(this.lampRow);

    this.controlBar = document.createElement('div');
    this.controlBar.className = 'control-bar';
    root.appendChild(this.controlBar);
  }

  setSteps(activeIndex: number): void {
    this.steps.forEach((pip, i) => {
      pip.classList.toggle('done', i < activeIndex);
      pip.classList.toggle('active', i === activeIndex);
    });
  }

  setHint(text: string): void {
    this.hintEl.textContent = text;
  }

  showBanner(text: string, visible = true): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.toggle('visible', visible);
  }

  setLamps(count: number): void {
    this.lampRow.style.display = count >= 0 ? 'flex' : 'none';
    Array.from(this.lampRow.children).forEach((el, i) => {
      el.classList.toggle('on', i < count);
    });
  }

  hideLamps(): void {
    this.lampRow.style.display = 'none';
  }

  setControls(specs: ControlSpec[]): void {
    const wanted = new Set(specs.map((s) => s.id));
    for (const [id, state] of this.controls) {
      if (!wanted.has(id)) {
        state.el.remove();
        this.controls.delete(id);
      }
    }
    for (const spec of specs) {
      if (this.controls.has(spec.id)) {
        this.updateControl(spec.id, spec.progress ?? 0);
        continue;
      }
      const el = document.createElement('button');
      el.className = `control ${spec.kind} tone-${spec.tone ?? 'primary'}`;
      el.setAttribute('data-testid', `control-${spec.id}`);
      el.setAttribute('aria-label', spec.label);
      el.type = 'button';
      const fill = document.createElement('span');
      fill.className = 'fill';
      const glyph = document.createElement('span');
      glyph.className = 'glyph';
      glyph.innerHTML = ICONS[spec.icon] ?? '';
      const caption = document.createElement('span');
      caption.className = 'caption';
      caption.textContent = spec.label;
      el.append(fill, glyph, caption);
      this.controlBar.appendChild(el);
      const state: ControlState = { ...spec, el, fill, active: false, lastX: 0, lastY: 0 };
      this.controls.set(spec.id, state);
      this.bind(state);
    }
    // Keep the DOM order matching the requested order.
    for (const spec of specs) {
      const state = this.controls.get(spec.id);
      if (state) this.controlBar.appendChild(state.el);
    }
  }

  updateControl(id: string, progress: number): void {
    const state = this.controls.get(id);
    if (!state) return;
    state.fill.style.transform = `scaleY(${clamp(progress, 0, 1)})`;
  }

  private bind(state: ControlState): void {
    const el = state.el;
    const start = (ev: PointerEvent) => {
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      state.active = true;
      state.lastX = ev.clientX;
      state.lastY = ev.clientY;
      el.classList.add('pressed');
      if (state.kind === 'hold') this.onHold(state.id, true);
      if (state.kind === 'press') this.onPress(state.id);
    };
    const move = (ev: PointerEvent) => {
      if (!state.active) return;
      const dx = ev.clientX - state.lastX;
      const dy = ev.clientY - state.lastY;
      state.lastX = ev.clientX;
      state.lastY = ev.clientY;
      if (state.kind === 'dragY') this.onDrag(state.id, dy / 140);
      else if (state.kind === 'dragX') this.onDrag(state.id, dx / 140);
      else if (state.kind === 'wheel') {
        // A drum turns whichever way you sweep it; both axes wind it in.
        this.onDrag(state.id, (dy + dx) / 180);
      }
    };
    const end = () => {
      if (!state.active) return;
      state.active = false;
      el.classList.remove('pressed');
      if (state.kind === 'hold') this.onHold(state.id, false);
    };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  /** Test and accessibility hook: drive a control without a real pointer. */
  simulate(id: string, kind: 'hold-on' | 'hold-off' | 'drag' | 'press', amount = 0): boolean {
    const state = this.controls.get(id);
    if (!state) return false;
    if (kind === 'hold-on') this.onHold(id, true);
    else if (kind === 'hold-off') this.onHold(id, false);
    else if (kind === 'drag') this.onDrag(id, amount);
    else this.onPress(id);
    return true;
  }

  hasControl(id: string): boolean {
    return this.controls.has(id);
  }
}
