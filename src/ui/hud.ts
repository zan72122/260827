import * as THREE from 'three';

export type CueKind = 'swipe' | 'drag' | 'tap' | 'circle' | 'none';

/**
 * Two elements only: a short line of kana and a gesture cue that sits on the
 * thing to touch. Nothing that needs reading to play.
 */
export class Hud {
  private hint = document.getElementById('hint') as HTMLDivElement;
  private cue = document.getElementById('cue') as HTMLDivElement;
  private text = '';
  private kind: CueKind = 'none';
  private anchor: THREE.Vector3 | null = null;
  private angle = 0;

  setHint(text: string) {
    if (text === this.text) return;
    this.text = text;
    if (!text) {
      this.hint.classList.remove('on');
      return;
    }
    this.hint.textContent = text;
    this.hint.classList.add('on');
  }

  setCue(kind: CueKind, anchor: THREE.Vector3 | null, angleRad = 0) {
    this.anchor = anchor;
    this.angle = angleRad;
    if (kind !== this.kind) {
      this.kind = kind;
      this.cue.innerHTML = kind === 'none' ? '' : svgFor(kind);
    }
    this.cue.classList.toggle('on', kind !== 'none' && !!anchor);
  }

  hideCue() {
    this.setCue('none', null);
  }

  update(camera: THREE.Camera, w: number, h: number) {
    if (!this.anchor || this.kind === 'none') return;
    const p = this.anchor.clone().project(camera);
    const x = ((p.x + 1) / 2) * w;
    const y = ((-p.y + 1) / 2) * h;
    this.cue.style.transform = `translate(${x}px, ${y}px) rotate(${(this.angle * 180) / Math.PI}deg)`;
  }
}

function svgFor(kind: CueKind): string {
  const stroke = '#4a3b34';
  const halo = '#fffdf8';
  if (kind === 'tap') {
    return `<svg viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="15" fill="none" stroke="${halo}" stroke-width="10" opacity="0.7"/>
      <circle cx="50" cy="50" r="15" fill="none" stroke="${stroke}" stroke-width="5" opacity="0.85"/>
      <circle cx="50" cy="50" r="15" fill="none" stroke="${stroke}" stroke-width="4" opacity="0.55">
        <animate attributeName="r" values="15;33;15" dur="1.5s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.55;0;0.55" dur="1.5s" repeatCount="indefinite"/>
      </circle>
    </svg>`;
  }
  if (kind === 'circle') {
    return `<svg viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="30" fill="none" stroke="${halo}" stroke-width="11" opacity="0.6"/>
      <circle cx="50" cy="50" r="30" fill="none" stroke="${stroke}" stroke-width="5" stroke-dasharray="10 9" opacity="0.7">
        <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="4s" repeatCount="indefinite"/>
      </circle>
      <circle cx="80" cy="50" r="8" fill="${stroke}" opacity="0.8">
        <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="4s" repeatCount="indefinite"/>
      </circle>
    </svg>`;
  }
  // swipe / drag: a travelling dot with a tail, pointing along +x of the cue.
  return `<svg viewBox="0 0 100 100">
    <path d="M14 50 H82" stroke="${halo}" stroke-width="12" stroke-linecap="round" opacity="0.7"/>
    <path d="M14 50 H78" stroke="${stroke}" stroke-width="5" stroke-linecap="round" opacity="0.45"/>
    <path d="M66 36 L82 50 L66 64" fill="none" stroke="${stroke}" stroke-width="5"
          stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/>
    <circle cx="14" cy="50" r="10" fill="${stroke}" opacity="0.85">
      <animate attributeName="cx" values="14;72;14" dur="1.9s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.9;0.35;0.9" dur="1.9s" repeatCount="indefinite"/>
    </circle>
  </svg>`;
}
