// All sound is synthesized with WebAudio: the continuous cutting hiss of the
// wheel, small ticks as the crack runs, the final clean snap, and soft
// handling thuds. No speech, no music stingers, everything at gentle levels.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.scoreNodes = null;
    this.ambient = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this._startAmbient();
  }

  _noiseBuffer(seconds = 1) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _startAmbient() {
    // very quiet room tone
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(2);
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = this.ctx.createGain();
    g.gain.value = 0.012;
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    this.ambient = { src, g };
  }

  // --- continuous score hiss -------------------------------------------------
  startScore() {
    if (!this.ctx || this.scoreNodes) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(1.5);
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2100;
    bp.Q.value = 1.1;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;
    const g = this.ctx.createGain();
    g.gain.value = 0.0;
    src.connect(hp).connect(bp).connect(g).connect(this.master);
    src.start();
    this.scoreNodes = { src, bp, g };
  }

  // speed in m/s of the wheel; silence when stopped
  updateScore(speed) {
    if (!this.scoreNodes) return;
    const t = this.ctx.currentTime;
    const s = Math.min(speed, 0.9);
    const active = s > 0.005;
    // slow: lower, grainier / fast: shorter, higher — all kept gentle
    const freq = 1300 + 2600 * Math.min(1, s / 0.5);
    const gain = active ? 0.03 + 0.075 * Math.min(1, s / 0.35) : 0.0;
    this.scoreNodes.bp.frequency.setTargetAtTime(freq, t, 0.05);
    this.scoreNodes.g.gain.setTargetAtTime(gain, t, 0.05);
  }

  stopScore() {
    if (!this.scoreNodes) return;
    const { src, g } = this.scoreNodes;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    setTimeout(() => { try { src.stop(); } catch (e) { /* already stopped */ } }, 250);
    this.scoreNodes = null;
  }

  // --- one-shots -------------------------------------------------------------
  _burst({ dur = 0.05, freq = 2200, type = 'highpass', gain = 0.2, rate = 1 }) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(dur * 1.2);
    src.playbackRate.value = rate;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  _tone({ freq = 150, dur = 0.12, gain = 0.15, type = 'sine' }) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  crackTick() {
    this._burst({ dur: 0.03, freq: 3000, gain: 0.06 + Math.random() * 0.04 });
  }

  snap() {
    // the clean "pakit": bright click + short low thump
    this._burst({ dur: 0.045, freq: 2400, gain: 0.3 });
    this._tone({ freq: 160, dur: 0.14, gain: 0.2, type: 'triangle' });
    this._tone({ freq: 620, dur: 0.05, gain: 0.1, type: 'sine' });
  }

  thud() {
    this._tone({ freq: 95, dur: 0.1, gain: 0.12, type: 'sine' });
    this._burst({ dur: 0.04, freq: 500, type: 'lowpass', gain: 0.08 });
  }

  suctionPop() {
    this._tone({ freq: 300, dur: 0.06, gain: 0.08, type: 'sine' });
  }

  pliersSet() {
    this._burst({ dur: 0.03, freq: 1200, type: 'lowpass', gain: 0.09 });
  }

  chime() {
    // soft glassy ring for the light moment
    this._tone({ freq: 1180, dur: 0.7, gain: 0.05, type: 'sine' });
    this._tone({ freq: 1770, dur: 0.5, gain: 0.03, type: 'sine' });
  }
}
