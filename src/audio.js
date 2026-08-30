/**
 * Fully synthetic sound (no asset files, no download): burner hiss, the roll of
 * the tube, the breath, the "puku" pop of the bulb, silver shimmer, glitter
 * bells and the final chime. Everything is created on the first touch so the
 * mobile autoplay policy is satisfied.
 */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.nodes = {};
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    // --- burner: filtered noise bed -------------------------------------
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(2.5);
    noise.loop = true;
    const burnerBP = ctx.createBiquadFilter();
    burnerBP.type = 'bandpass'; burnerBP.frequency.value = 760; burnerBP.Q.value = 0.7;
    const burnerGain = ctx.createGain(); burnerGain.gain.value = 0.0;
    noise.connect(burnerBP).connect(burnerGain).connect(master);
    noise.start();

    // --- rolling glass (spin) -------------------------------------------
    const roll = ctx.createBufferSource();
    roll.buffer = this._noiseBuffer(2.5); roll.loop = true;
    const rollLP = ctx.createBiquadFilter();
    rollLP.type = 'lowpass'; rollLP.frequency.value = 420; rollLP.Q.value = 3;
    const rollGain = ctx.createGain(); rollGain.gain.value = 0;
    roll.connect(rollLP).connect(rollGain).connect(master);
    roll.start();

    // --- breath ----------------------------------------------------------
    const breath = ctx.createBufferSource();
    breath.buffer = this._noiseBuffer(2.5); breath.loop = true;
    const breathBP = ctx.createBiquadFilter();
    breathBP.type = 'bandpass'; breathBP.frequency.value = 520; breathBP.Q.value = 0.5;
    const breathGain = ctx.createGain(); breathGain.gain.value = 0;
    breath.connect(breathBP).connect(breathGain).connect(master);
    breath.start();

    // --- heat tone (rises with the glow) ---------------------------------
    const heatOsc = ctx.createOscillator();
    heatOsc.type = 'sine'; heatOsc.frequency.value = 96;
    const heatGain = ctx.createGain(); heatGain.gain.value = 0;
    heatOsc.connect(heatGain).connect(master);
    heatOsc.start();

    this.nodes = { master, burnerGain, burnerBP, rollGain, rollLP, breathGain, breathBP, heatOsc, heatGain };
    this.ready = true;
  }

  _noiseBuffer(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;      // slight brown tilt: less harsh
      d[i] = last * 3.2 + w * 0.35;
    }
    return buf;
  }

  _now() { return this.ctx.currentTime; }

  set(param, value, time = 0.08) {
    if (!this.ready) return;
    param.setTargetAtTime(value, this._now(), Math.max(0.01, time / 3));
  }

  burner(on) { if (this.ready) this.set(this.nodes.burnerGain.gain, on ? 0.055 : 0, 0.6); }

  spin(intensity) {
    if (!this.ready) return;
    this.set(this.nodes.rollGain.gain, 0.10 * intensity, 0.12);
    this.set(this.nodes.rollLP.frequency, 300 + 520 * intensity, 0.15);
  }

  heat(level) {
    if (!this.ready) return;
    this.set(this.nodes.heatGain.gain, 0.05 * level, 0.3);
    this.set(this.nodes.heatOsc.frequency, 90 + 70 * level, 0.35);
    this.set(this.nodes.burnerBP.frequency, 700 + 420 * level, 0.4);
  }

  breath(on, strength = 1) {
    if (!this.ready) return;
    this.set(this.nodes.breathGain.gain, on ? 0.16 * strength : 0, on ? 0.06 : 0.18);
    this.set(this.nodes.breathBP.frequency, on ? 380 + 420 * strength : 380, 0.15);
  }

  /** The "puku" — the exact sound of the bulb pushing out one step. */
  pop(pitch = 1) {
    if (!this.ready) return;
    const t = this._now(), ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(300 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(150 * pitch, t + 0.16);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(g).connect(this.nodes.master);
    o.start(t); o.stop(t + 0.3);
  }

  /** Mirror spreading inside the glass. */
  shimmer() {
    if (!this.ready) return;
    const t = this._now(), ctx = this.ctx;
    [1568, 2093, 2637].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.05);
      g.gain.exponentialRampToValueAtTime(0.05, t + i * 0.05 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.05 + 0.7);
      o.connect(g).connect(this.nodes.master);
      o.start(t + i * 0.05); o.stop(t + i * 0.05 + 0.8);
    });
  }

  /** Tiny bell for each burst of glitter. */
  sparkle(n = 3) {
    if (!this.ready) return;
    const t = this._now(), ctx = this.ctx;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = 1800 + Math.random() * 2200;
      const s = t + Math.random() * 0.35;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.045, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.32);
      o.connect(g).connect(this.nodes.master);
      o.start(s); o.stop(s + 0.36);
    }
  }

  /** Finished ornament hanging on the hook. */
  chime() {
    if (!this.ready) return;
    const t = this._now(), ctx = this.ctx;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const s = t + i * 0.13;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.11, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 1.5);
      o.connect(g).connect(this.nodes.master);
      o.start(s); o.stop(s + 1.6);
    });
  }

  /** Soft metal contact: tool touching glass. */
  tick(vol = 0.05) {
    if (!this.ready) return;
    const t = this._now(), ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = 2400 + Math.random() * 600;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(this.nodes.master);
    o.start(t); o.stop(t + 0.1);
  }
}
