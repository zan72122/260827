/**
 * Quality is a single ordered ladder rather than three fixed presets, because
 * the order the spec asks for matters: when a device struggles we give up
 * reflections first, then transmission quality, then particles, and only after
 * that resolution and shadows. Nothing on this ladder touches input handling,
 * so the game keeps responding at every step.
 */
export type TierName = 'high' | 'medium' | 'low';

export interface QualitySettings {
  name: TierName;
  step: number;
  dpr: number;
  shadows: boolean;
  shadowMapSize: number;
  /** 0 = no physical transmission (alpha blended ice instead) */
  transmission: number;
  /** environment map resolution and how strongly it is applied */
  envRes: number;
  reflections: number;
  snowCount: number;
  bubbleCount: number;
  /** real dynamic point lights allowed in the finale */
  finaleLights: number;
}

function base(maxDpr: number): QualitySettings {
  return {
    name: 'high',
    step: 0,
    dpr: Math.min(maxDpr, 2),
    shadows: true,
    shadowMapSize: 2048,
    transmission: 0.92,
    envRes: 256,
    reflections: 1,
    snowCount: 900,
    bubbleCount: 54,
    finaleLights: 3,
  };
}

const LADDER: Array<(s: QualitySettings) => void> = [
  (s) => {
    s.envRes = 128;
    s.reflections = 0.85;
    s.shadowMapSize = 1024;
    s.dpr = Math.min(s.dpr, 1.75);
  },
  (s) => {
    s.transmission = 0.55;
    s.finaleLights = 2;
  },
  (s) => {
    s.snowCount = 380;
    s.bubbleCount = 32;
  },
  (s) => {
    s.transmission = 0;
    s.envRes = 64;
    s.reflections = 0.7;
  },
  (s) => {
    s.dpr = Math.min(s.dpr, 1.15);
    s.snowCount = 170;
    s.bubbleCount = 18;
    s.finaleLights = 1;
  },
  (s) => {
    s.shadows = false;
    s.shadowMapSize = 512;
    s.dpr = Math.min(s.dpr, 1);
  },
];

export class Quality {
  settings: QualitySettings;
  private maxDpr: number;
  private samples: number[] = [];
  private cooldown = 4;
  private listeners: Array<(s: QualitySettings) => void> = [];

  constructor(forcedStep?: number) {
    this.maxDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
    let start = 0;
    if (mem <= 4) start = 1;
    if (mem <= 3) start = 2;
    if (mem <= 2) start = 4;
    this.settings = this.build(forcedStep ?? start);
  }

  private build(step: number): QualitySettings {
    const s = base(this.maxDpr);
    const n = Math.max(0, Math.min(LADDER.length, step));
    for (let i = 0; i < n; i++) LADDER[i](s);
    s.step = n;
    s.name = n <= 1 ? 'high' : n <= 3 ? 'medium' : 'low';
    return s;
  }

  onChange(fn: (s: QualitySettings) => void) {
    this.listeners.push(fn);
  }

  setStep(step: number) {
    if (this.settings.step === step) return;
    this.settings = this.build(step);
    for (const fn of this.listeners) fn(this.settings);
  }

  /** Feed frame times (ms); steps one rung down when consistently slow. */
  sample(ms: number) {
    if (this.cooldown > 0) {
      this.cooldown -= 1 / 60;
      return;
    }
    this.samples.push(ms);
    if (this.samples.length < 80) return;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.samples.length = 0;
    if (avg > 25 && this.settings.step < LADDER.length) {
      this.setStep(this.settings.step + 1);
      this.cooldown = 7;
    }
  }
}
