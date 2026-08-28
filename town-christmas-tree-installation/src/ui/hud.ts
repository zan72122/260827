import { bindCircle, bindDrag, bindSwipe, clamp } from '../core/input';

export type ControlKind =
  | 'none'
  | 'guide'
  | 'outriggers'
  | 'jacks'
  | 'slings'
  | 'lever'
  | 'capstan'
  | 'spiral'
  | 'star'
  | 'switch'
  | 'menu';

export interface HudCallbacks {
  guide(): void;
  outrigger(index: number): void;
  jacks(): void;
  slingDrag(index: number, x: number, y: number, phase: 'start' | 'move' | 'end'): void;
  lever(value: number): void;
  tagLine(value: number): void;
  capstan(turns: number): void;
  spiral(progress: number): void;
  star(): void;
  bigSwitch(): void;
  menu(action: 'relight' | 'again' | 'newTree'): void;
  toggle(kind: 'sound' | 'motion' | 'glow', value: boolean): void;
  anyInput(): void;
}

export interface DropTarget {
  index: number;
  x: number;
  y: number;
  visible: boolean;
  near: boolean;
}

const STEP_COUNT = 8;

/**
 * All touch controls live in DOM so they can honour the safe area and be
 * re-laid-out (not cropped) between portrait and landscape.
 */
export class Hud {
  private root: HTMLElement;
  private stepsEl: HTMLElement;
  private titleEl: HTMLElement;
  private layer: HTMLElement;
  private togglesEl: HTMLElement;
  private cb: HudCallbacks;
  private cleanups: (() => void)[] = [];
  private kind: ControlKind = 'none';
  private lastInput = performance.now();
  private hintTimer = 0;
  private leverValue = 0;
  private leverEl: HTMLElement | null = null;
  private leverKnob: HTMLElement | null = null;
  private ropeKnob: HTMLElement | null = null;
  private pucks: HTMLElement[] = [];
  private targets: HTMLElement[] = [];
  private spiralPath: SVGPathElement | null = null;
  private spiralDone: SVGPathElement | null = null;
  private spiralDot: SVGCircleElement | null = null;
  private outriggerPads: HTMLElement[] = [];
  private spiralTurns = 2.6;
  private capstanTurns = 3;

  constructor(root: HTMLElement, cb: HudCallbacks, initial: { motion?: boolean; glow?: boolean; sound?: boolean } = {}) {
    this.root = root;
    this.cb = cb;

    this.stepsEl = document.createElement('div');
    this.stepsEl.className = 'steps';
    for (let i = 0; i < STEP_COUNT; i++) this.stepsEl.appendChild(document.createElement('b'));
    root.appendChild(this.stepsEl);

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'title-card';
    root.appendChild(this.titleEl);

    this.togglesEl = document.createElement('div');
    this.togglesEl.className = 'toggles';
    root.appendChild(this.togglesEl);
    this.addToggle('sound', '🔊', '🔈', initial.sound ?? true);
    this.addToggle('motion', '🎬', '🐢', initial.motion ?? true);
    this.addToggle('glow', '✨', '🌙', initial.glow ?? true);

    this.layer = document.createElement('div');
    this.layer.className = 'control-layer';
    root.appendChild(this.layer);
  }

  private addToggle(kind: 'sound' | 'motion' | 'glow', onGlyph: string, offGlyph: string, initial: boolean): void {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = initial ? onGlyph : offGlyph;
    b.setAttribute('aria-pressed', String(initial));
    b.setAttribute(
      'aria-label',
      kind === 'sound' ? 'おと' : kind === 'motion' ? 'うごき' : 'ひかり',
    );
    let state = initial;
    b.addEventListener('click', () => {
      state = !state;
      b.textContent = state ? onGlyph : offGlyph;
      b.setAttribute('aria-pressed', String(state));
      this.cb.toggle(kind, state);
      this.touch();
    });
    this.togglesEl.appendChild(b);
  }

  private touch(): void {
    this.lastInput = performance.now();
    this.hintTimer = 0;
    for (const el of this.layer.querySelectorAll('.hint')) el.classList.remove('hint');
    this.cb.anyInput();
  }

  setSteps(index: number): void {
    const dots = this.stepsEl.children;
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i] as HTMLElement;
      d.className = i < index ? 'done' : i === index ? 'now' : '';
    }
  }

  setTitle(glyph: string, text: string): void {
    this.titleEl.innerHTML = '';
    const g = document.createElement('span');
    g.className = 'glyph';
    g.textContent = glyph;
    const t = document.createElement('span');
    t.textContent = text;
    this.titleEl.append(g, t);
    this.titleEl.style.opacity = text ? '1' : '0';
  }

  get currentKind(): ControlKind {
    return this.kind;
  }

  private clear(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.layer.innerHTML = '';
    this.leverEl = null;
    this.leverKnob = null;
    this.ropeKnob = null;
    this.pucks = [];
    this.targets = [];
    this.spiralPath = null;
    this.spiralDone = null;
    this.spiralDot = null;
    this.outriggerPads = [];
  }

  private pad(cls: string, glyph: string, caption: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `pad ${cls}`;
    el.setAttribute('role', 'button');
    el.innerHTML = `<div><div class="arrow">${glyph}</div><div class="cap">${caption}</div></div>`;
    return el;
  }

  showControl(kind: ControlKind, opts: { leverStart?: number; withTagLine?: boolean; outriggerDone?: boolean[] } = {}): void {
    this.clear();
    this.kind = kind;
    this.lastInput = performance.now();

    switch (kind) {
      case 'guide': {
        const el = this.pad('guide-pad', '➡️', 'よこに スワイプ');
        this.layer.appendChild(el);
        this.cleanups.push(
          bindSwipe(el, 'right', 46, () => {
            this.touch();
            el.classList.add('done');
            this.cb.guide();
          }),
        );
        this.cleanups.push(bindDrag(el, { onStart: () => this.touch() }));
        break;
      }

      case 'outriggers': {
        const wrap = document.createElement('div');
        wrap.className = 'rig-cross';
        const core = document.createElement('div');
        core.className = 'core';
        core.textContent = '🏗️';
        wrap.appendChild(core);
        const dirs: ('left' | 'right' | 'up' | 'down')[] = ['left', 'right', 'up', 'down'];
        const glyphs = ['⬅️', '➡️', '⬆️', '⬇️'];
        for (let i = 0; i < 4; i++) {
          const el = this.pad(`p${i}`, glyphs[i], '');
          if (opts.outriggerDone?.[i]) el.classList.add('done');
          wrap.appendChild(el);
          this.outriggerPads.push(el);
          this.cleanups.push(
            bindSwipe(el, dirs[i], 34, () => {
              this.touch();
              el.classList.add('done');
              this.cb.outrigger(i);
            }),
          );
          this.cleanups.push(bindDrag(el, { onStart: () => this.touch() }));
        }
        this.layer.appendChild(wrap);
        break;
      }

      case 'jacks': {
        const el = this.pad('jack-bar', '⬇️', 'したへ スワイプ');
        this.layer.appendChild(el);
        this.cleanups.push(
          bindSwipe(el, 'down', 40, () => {
            this.touch();
            el.classList.add('done');
            this.cb.jacks();
          }),
        );
        this.cleanups.push(bindDrag(el, { onStart: () => this.touch() }));
        break;
      }

      case 'slings': {
        for (let i = 0; i < 2; i++) {
          const t = document.createElement('div');
          t.className = `drop-target ${i === 0 ? 'red' : 'blue'}`;
          t.style.opacity = '0';
          this.layer.appendChild(t);
          this.targets.push(t);
        }
        for (let i = 0; i < 2; i++) {
          const p = document.createElement('div');
          p.className = `puck ${i === 0 ? 'red' : 'blue'}`;
          p.textContent = i === 0 ? '➊' : '➋';
          this.layer.appendChild(p);
          this.pucks.push(p);
          let home: DOMRect | null = null;
          this.cleanups.push(
            bindDrag(p, {
              onStart: (s) => {
                this.touch();
                home = p.getBoundingClientRect();
                p.style.transition = 'none';
                this.cb.slingDrag(i, s.current.x, s.current.y, 'start');
              },
              onMove: (s) => {
                if (!home) return;
                p.style.left = `${s.current.x - home.width / 2}px`;
                p.style.bottom = 'auto';
                p.style.top = `${s.current.y - home.height / 2}px`;
                this.cb.slingDrag(i, s.current.x, s.current.y, 'move');
              },
              onEnd: (s) => {
                this.cb.slingDrag(i, s.current.x, s.current.y, 'end');
                if (!p.classList.contains('done') && home) {
                  p.style.transition = 'left .25s ease, top .25s ease';
                  p.style.left = `${home.left}px`;
                  p.style.top = `${home.top}px`;
                }
              },
            }),
          );
        }
        break;
      }

      case 'lever': {
        const lever = document.createElement('div');
        lever.className = 'lever';
        lever.innerHTML =
          '<div class="track"></div><div class="caps"><span>⬆️</span><span>⬇️</span></div><div class="knob">🎚️</div>';
        this.layer.appendChild(lever);
        this.leverEl = lever;
        this.leverKnob = lever.querySelector('.knob');
        this.leverValue = opts.leverStart ?? 0;
        this.layoutLever();
        let startValue = this.leverValue;
        this.cleanups.push(
          bindDrag(lever, {
            onStart: () => {
              this.touch();
              startValue = this.leverValue;
            },
            onMove: (s) => {
              const h = lever.clientHeight - 100;
              this.leverValue = clamp(startValue - s.total.y / Math.max(h, 1), 0, 1);
              this.layoutLever();
              this.cb.lever(this.leverValue);
            },
          }),
        );

        if (opts.withTagLine) {
          const strip = document.createElement('div');
          strip.className = 'rope-strip';
          strip.innerHTML = '<div class="hintline"><span>◀</span><span>ロープ</span><span>▶</span></div><div class="rope-knob">🪢</div>';
          this.layer.appendChild(strip);
          this.ropeKnob = strip.querySelector('.rope-knob');
          const centre = () => {
            if (!this.ropeKnob) return;
            this.ropeKnob.style.left = `${strip.clientWidth / 2 - 31}px`;
          };
          centre();
          let value = 0;
          this.cleanups.push(
            bindDrag(strip, {
              onStart: () => this.touch(),
              onMove: (s) => {
                const half = strip.clientWidth / 2 - 40;
                value = clamp(s.total.x / Math.max(half, 1), -1, 1);
                if (this.ropeKnob) this.ropeKnob.style.left = `${strip.clientWidth / 2 - 31 + value * half}px`;
                this.cb.tagLine(value);
              },
              onEnd: () => {
                value = 0;
                centre();
                this.cb.tagLine(0);
              },
            }),
          );
        }
        break;
      }

      case 'capstan': {
        const el = document.createElement('div');
        el.className = 'capstan';
        el.innerHTML = '<div class="spokes"></div><div class="glyph">🔄</div><div class="handle"></div>';
        this.layer.appendChild(el);
        const handle = el.querySelector('.handle') as HTMLElement;
        const place = (a: number) => {
          const r = el.clientWidth / 2 - 34;
          handle.style.left = `${el.clientWidth / 2 + Math.cos(a) * r - 17}px`;
          handle.style.top = `${el.clientHeight / 2 + Math.sin(a) * r - 17}px`;
        };
        place(-Math.PI / 2);
        this.cleanups.push(
          bindCircle(el, (turns, active) => {
            if (active) this.touch();
            place(-Math.PI / 2 + turns * Math.PI * 2);
            this.cb.capstan(clamp(turns / this.capstanTurns, 0, 1));
          }),
        );
        break;
      }

      case 'spiral': {
        const el = document.createElement('div');
        el.className = 'spiral';
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 200 200');
        const bg = document.createElementNS(ns, 'circle');
        bg.setAttribute('class', 'bg');
        bg.setAttribute('cx', '100');
        bg.setAttribute('cy', '100');
        bg.setAttribute('r', '100');
        const d = spiralPathData(100, 100, 20, 88, this.spiralTurns);
        const guide = document.createElementNS(ns, 'path');
        guide.setAttribute('class', 'guide');
        guide.setAttribute('d', d);
        const done = document.createElementNS(ns, 'path');
        done.setAttribute('class', 'done');
        done.setAttribute('d', d);
        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('class', 'dot');
        dot.setAttribute('r', '11');
        svg.append(bg, guide, done, dot);
        el.appendChild(svg);
        this.layer.appendChild(el);
        this.spiralPath = guide;
        this.spiralDone = done;
        this.spiralDot = dot;
        this.setSpiralProgress(0);
        this.cleanups.push(
          bindCircle(el, (turns, active) => {
            if (active) this.touch();
            const p = clamp(turns / this.spiralTurns, 0, 1);
            this.setSpiralProgress(p);
            this.cb.spiral(p);
          }),
        );
        break;
      }

      case 'star': {
        const el = document.createElement('div');
        el.className = 'star-btn pad';
        el.textContent = '⭐';
        this.layer.appendChild(el);
        this.cleanups.push(
          bindSwipe(el, 'up', 40, () => {
            this.touch();
            el.classList.add('done');
            this.cb.star();
          }),
        );
        this.cleanups.push(bindDrag(el, { onStart: () => this.touch() }));
        break;
      }

      case 'switch': {
        const el = document.createElement('div');
        el.className = 'big-switch';
        el.innerHTML = '<div class="slot"></div><div class="handle">💡</div>';
        this.layer.appendChild(el);
        const handle = el.querySelector('.handle') as HTMLElement;
        const place = (v: number) => {
          const range = el.clientHeight - 84 - 28;
          handle.style.top = `${14 + (1 - v) * range}px`;
        };
        let v = 0;
        place(0);
        let fired = false;
        this.cleanups.push(
          bindDrag(el, {
            onStart: () => this.touch(),
            onMove: (s) => {
              const range = Math.max(1, el.clientHeight - 112);
              v = clamp(-s.total.y / range, 0, 1);
              place(v);
              if (v > 0.82 && !fired) {
                fired = true;
                this.cb.bigSwitch();
              }
            },
            onEnd: () => {
              if (!fired) {
                v = 0;
                place(0);
              } else {
                place(1);
              }
            },
          }),
        );
        break;
      }

      case 'menu': {
        const el = document.createElement('div');
        el.className = 'menu';
        const items: [string, string, 'relight' | 'again' | 'newTree'][] = [
          ['✨', 'もういちど', 'relight'],
          ['🔁', 'おなじ木', 'again'],
          ['🌲', 'ちがう木', 'newTree'],
        ];
        for (const [glyph, label, action] of items) {
          const b = document.createElement('button');
          b.type = 'button';
          b.innerHTML = `<span>${glyph}</span>${label}`;
          b.addEventListener('click', () => {
            this.touch();
            this.cb.menu(action);
          });
          el.appendChild(b);
        }
        this.layer.appendChild(el);
        break;
      }

      default:
        break;
    }
  }

  private layoutLever(): void {
    if (!this.leverEl || !this.leverKnob) return;
    const range = this.leverEl.clientHeight - 108;
    this.leverKnob.style.top = `${8 + (1 - this.leverValue) * range}px`;
  }

  setLeverValue(v: number): void {
    this.leverValue = clamp(v, 0, 1);
    this.layoutLever();
  }

  private setSpiralProgress(p: number): void {
    if (!this.spiralPath || !this.spiralDone || !this.spiralDot) return;
    const len = this.spiralPath.getTotalLength();
    this.spiralDone.style.strokeDasharray = `${len}`;
    this.spiralDone.style.strokeDashoffset = `${len * (1 - p)}`;
    const pt = this.spiralPath.getPointAtLength(len * p);
    this.spiralDot.setAttribute('cx', String(pt.x));
    this.spiralDot.setAttribute('cy', String(pt.y));
  }

  markSlingDone(index: number): void {
    this.pucks[index]?.classList.add('done');
  }

  updateDropTargets(list: DropTarget[]): void {
    for (const t of list) {
      const el = this.targets[t.index];
      if (!el) continue;
      el.style.opacity = t.visible ? '1' : '0';
      el.style.left = `${t.x}px`;
      el.style.top = `${t.y}px`;
      el.classList.toggle('near', t.near);
    }
  }

  /** Nudge the current control if the child has hesitated for a few seconds. */
  tick(dt: number): void {
    const idle = (performance.now() - this.lastInput) / 1000;
    if (idle > 4 && this.kind !== 'none') {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) {
        this.hintTimer = 5.5;
        const el = this.layer.querySelector('.pad:not(.done), .lever, .capstan, .spiral, .big-switch, .puck:not(.done)');
        if (el) {
          el.classList.remove('hint');
          void (el as HTMLElement).offsetWidth;
          el.classList.add('hint');
        }
      }
    }
  }

  relayout(): void {
    this.layoutLever();
    if (this.ropeKnob?.parentElement) {
      this.ropeKnob.style.left = `${this.ropeKnob.parentElement.clientWidth / 2 - 31}px`;
    }
  }

  dispose(): void {
    this.clear();
    this.root.innerHTML = '';
  }
}

/** Archimedean spiral as an SVG path, thick enough for a small finger. */
function spiralPathData(cx: number, cy: number, r0: number, r1: number, turns: number): string {
  const steps = Math.round(turns * 36);
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = -Math.PI / 2 + t * turns * Math.PI * 2;
    const r = r0 + (r1 - r0) * t;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    if (i < steps) d += ' ';
  }
  return d;
}
