import * as THREE from 'three';
import type { Engine } from '../core/engine';
import type { Hint } from '../game/types';
import { clamp, easeInOut } from '../util/math';

/* ------------------------------------------------------------------ *
 * Screen furniture, kept to what a four-year-old can use without reading:
 * three machine marks that fill in as each one comes alive, a sound
 * toggle, and a ghost hand that demonstrates the current gesture when the
 * child hesitates.  Nothing else.
 * ------------------------------------------------------------------ */

export class Hud {
  private engine: Engine;
  private ghost: HTMLElement;
  private ghostHand: HTMLElement;
  private ghostArrow: HTMLElement;
  private pips: HTMLElement;
  private pipEls: HTMLElement[];
  private soundBtn: HTMLElement;
  private cycle = 0;
  private a = new THREE.Vector2();
  private b = new THREE.Vector2();
  private shown = false;

  onPip: ((index: number) => void) | null = null;
  onSound: ((muted: boolean) => void) | null = null;

  constructor(engine: Engine) {
    this.engine = engine;
    this.ghost = document.getElementById('ghost')!;
    this.ghostHand = document.getElementById('ghost-hand')!;
    this.ghostArrow = document.getElementById('ghost-arrow')!;
    this.pips = document.getElementById('pips')!;
    this.pipEls = Array.from(this.pips.querySelectorAll<HTMLElement>('.pip'));
    this.soundBtn = document.getElementById('sound')!;

    this.pipEls.forEach((el, i) => {
      el.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        if (this.pips.classList.contains('interactive')) this.onPip?.(i);
      });
    });
    let muted = false;
    this.soundBtn.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      muted = !muted;
      this.soundBtn.classList.toggle('muted', muted);
      this.onSound?.(muted);
    });
  }

  setPip(i: number, state: 'idle' | 'active' | 'done') {
    const el = this.pipEls[i];
    if (!el) return;
    el.classList.toggle('active', state === 'active');
    el.classList.toggle('done', state === 'done');
  }
  setPipsInteractive(on: boolean) { this.pips.classList.toggle('interactive', on); }

  /** `idleSeconds` is how long the child has been still. */
  update(dt: number, hint: Hint, idleSeconds: number, touching: boolean) {
    const want = !!hint && idleSeconds > 2.0 && !touching;
    if (want !== this.shown) {
      this.shown = want;
      this.ghost.style.opacity = want ? '1' : '0';
    }
    if (!want || !hint) { this.cycle = 0; return; }

    this.cycle += dt;
    const period = hint.kind === 'tap' ? 1.5 : 2.3;
    const k = (this.cycle % period) / period;

    let x = 0, y = 0, scale = 1, arrow = 0;
    if (hint.kind === 'tap') {
      this.engine.projectPx(hint.at, this.a);
      x = this.a.x; y = this.a.y;
      const p = k < 0.35 ? easeInOut(k / 0.35) : 1 - easeInOut(clamp((k - 0.35) / 0.35, 0, 1));
      scale = 1 - p * 0.28;
    } else if (hint.kind === 'swipe') {
      this.engine.projectPx(hint.at, this.a);
      const travel = Math.min(this.engine.height * 0.13, 110);
      const dir = hint.dir === 'up' ? -1 : 1;
      const p = k < 0.62 ? easeInOut(k / 0.62) : 1;
      const fade = k > 0.78 ? 1 - (k - 0.78) / 0.22 : 1;
      x = this.a.x;
      y = this.a.y + dir * travel * (p - 0.5);
      scale = 1 - (k < 0.62 ? 0.1 : 0);
      arrow = fade;
      this.ghostArrow.style.transform = hint.dir === 'up' ? 'none' : 'rotate(180deg)';
      this.ghostArrow.style.transformOrigin = '50px 50px';
    } else {
      this.engine.projectPx(hint.from, this.a);
      this.engine.projectPx(hint.to, this.b);
      const p = k < 0.72 ? easeInOut(k / 0.72) : 1;
      const fade = k > 0.82 ? 1 - (k - 0.82) / 0.18 : 1;
      x = this.a.x + (this.b.x - this.a.x) * p;
      y = this.a.y + (this.b.y - this.a.y) * p;
      scale = 1 - 0.08 * Math.sin(p * Math.PI);
      this.ghost.style.opacity = String(fade);
      arrow = 0;
    }

    this.ghostArrow.style.opacity = String(arrow);
    this.ghostHand.style.opacity = '1';
    this.ghost.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }
}
