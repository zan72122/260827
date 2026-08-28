import type { AudioEngine } from './engine';
import type { BellSize } from '../world/bell';

/**
 * Bell voices.
 *
 * Each shell is rendered offline once as a short modal sample: a bright,
 * inharmonic partial stack plus the metallic transient of the loose ball
 * striking the wall. At play time a sample is retuned, filtered by how hard
 * the strike was, and panned by where the bell is across the frame - so the
 * same three buffers cover a whole strap without anything sounding looped.
 */

const PARTIALS = [1, 1.51, 2.13, 2.73, 3.41, 4.29, 5.16, 6.42, 7.71];

interface SizeSpec {
  base: number;
  decay: number;
  bright: number;
  gain: number;
}

const SPECS: Record<BellSize, SizeSpec> = {
  0: { base: 1740, decay: 0.34, bright: 1.0, gain: 0.5 },
  1: { base: 1180, decay: 0.52, bright: 0.86, gain: 0.68 },
  2: { base: 762, decay: 0.86, bright: 0.7, gain: 0.9 },
};

const VARIANTS = 3;

async function renderBell(
  rate: number,
  spec: SizeSpec,
  variant: number,
): Promise<AudioBuffer> {
  const OfflineCtor =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  const dur = spec.decay * 2.4 + 0.14;
  const ctx = new OfflineCtor(1, Math.ceil(rate * dur), rate);
  const out = ctx.createGain();
  out.gain.value = 0.42;
  out.connect(ctx.destination);

  const seed = variant * 0.37 + 0.11;
  const jit = (k: number) => ((Math.sin((k + 1) * (12.9 + seed * 7)) * 43758.5453) % 1) * 2 - 1;

  // --- modal partials ---------------------------------------------------
  PARTIALS.forEach((ratio, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const detune = jit(i) * 14;
    const f = spec.base * ratio * (1 + jit(i + 20) * 0.008);
    osc.frequency.value = f;
    osc.detune.value = detune;

    const g = ctx.createGain();
    // Higher partials are louder at the attack and die first: that is what
    // makes a sleigh bell read as "bright" rather than "musical".
    const amp = (1 / (1 + i * 0.78)) * (0.55 + spec.bright * 0.6) * (0.8 + Math.abs(jit(i + 5)) * 0.4);
    const decay = spec.decay / (1 + i * 0.42);
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(amp, 0.0016 + i * 0.0004);
    g.gain.exponentialRampToValueAtTime(0.0001, Math.max(0.05, decay * 2.2));

    osc.connect(g);
    g.connect(out);
    osc.start(0);
    osc.stop(dur);
  });

  // --- strike transient: the ball hitting brass -------------------------
  const nLen = Math.floor(rate * 0.05);
  const nb = ctx.createBuffer(1, nLen, rate);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < nLen; i++) {
    const t = i / nLen;
    nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 7);
  }
  const ns = ctx.createBufferSource();
  ns.buffer = nb;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = spec.base * 3.1;
  bp.Q.value = 1.1;
  const ng = ctx.createGain();
  ng.gain.value = 0.5 * spec.bright;
  ns.connect(bp);
  bp.connect(ng);
  ng.connect(out);
  ns.start(0);

  return ctx.startRendering();
}

export class BellBus {
  private buffers: Partial<Record<BellSize, AudioBuffer[]>> = {};
  private input!: GainNode;
  private voices = 0;
  private lastAt = 0;
  private ready = false;
  private rendered = 0;

  constructor(private engine: AudioEngine) {}

  async prepare(): Promise<void> {
    const ctx = this.engine.ctx;
    if (!ctx || this.ready) return;
    this.input = ctx.createGain();
    this.input.gain.value = 0.9;
    this.input.connect(this.engine.dry);
    const send = ctx.createGain();
    send.gain.value = 0.55;
    this.input.connect(send);
    send.connect(this.engine.wet);

    const sizes: BellSize[] = [0, 1, 2];
    for (const s of sizes) {
      const list: AudioBuffer[] = [];
      for (let v = 0; v < VARIANTS; v++) {
        list.push(await renderBell(ctx.sampleRate, SPECS[s], v));
        this.rendered++;
      }
      this.buffers[s] = list;
    }
    this.ready = true;
  }

  /**
   * @param when context time, already offset by the caller's stagger
   * @param pan  -1..1 across the frame
   * @param tilt 0 at a walk, 1 at a trot. A trot is not just louder: the
   *             shorter, sharper swings excite the light shells more and open
   *             the top end, so the same strap changes colour with the gait.
   */
  strike(
    size: BellSize,
    intensity: number,
    detuneCents: number,
    pan: number,
    when = 0,
    tilt = 0,
  ): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.ready) return;
    const list = this.buffers[size];
    if (!list) return;
    const t = Math.max(ctx.currentTime, ctx.currentTime + when);
    // Keep the voice count bounded; a dense trot never becomes a wall.
    if (this.voices > 26 && intensity < 0.35) return;
    if (t - this.lastAt < 0.0035 && intensity < 0.5) return;
    this.lastAt = t;

    const src = ctx.createBufferSource();
    src.buffer = list[(Math.random() * list.length) | 0];
    src.playbackRate.value = Math.pow(2, detuneCents / 1200) * (0.985 + Math.random() * 0.03);

    // A soft strike excites fewer high partials: filter, do not just duck.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = (1400 + Math.pow(intensity, 0.7) * 12000) * (1 + tilt * 0.5);
    lp.Q.value = 0.4;

    // At a trot the small shells come forward and the largest sits back a
    // little, which is what turns a string of separate notes into a band.
    const balance = size === 0 ? 1 + tilt * 0.35 : size === 2 ? 1 - tilt * 0.2 : 1;
    const g = ctx.createGain();
    g.gain.value = SPECS[size].gain * (0.12 + intensity * 0.95) * balance;

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));

    src.connect(lp);
    lp.connect(g);
    g.connect(panner);
    panner.connect(this.input);
    this.voices++;
    src.onended = () => {
      this.voices--;
      src.disconnect();
      lp.disconnect();
      g.disconnect();
      panner.disconnect();
    };
    src.start(t);
  }

  get buffersRendered(): number {
    return this.rendered;
  }

  setLevel(v: number): void {
    if (this.input && this.engine.ctx) {
      this.input.gain.setTargetAtTime(v, this.engine.ctx.currentTime, 0.15);
    }
  }
}
