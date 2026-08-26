// Fully synthesized WebAudio: quiet electric drive whine, blade scrape,
// auger rumble, water trickle, hydraulic conditioner moves, and a small
// celebration chime. No samples, no licensing issues, toddler-gentle levels.

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.started = false;
  }

  unlock() {
    if (this.started) { this.ctx?.resume?.(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { return; }
    this.started = true;
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = noiseBuf;

    // --- electric motor whine (two detuned saws → lowpass)
    this.motorGain = ctx.createGain(); this.motorGain.gain.value = 0;
    const mFilter = ctx.createBiquadFilter();
    mFilter.type = 'lowpass'; mFilter.frequency.value = 700; mFilter.Q.value = 2;
    this.motorOsc1 = ctx.createOscillator(); this.motorOsc1.type = 'sawtooth'; this.motorOsc1.frequency.value = 70;
    this.motorOsc2 = ctx.createOscillator(); this.motorOsc2.type = 'sawtooth'; this.motorOsc2.frequency.value = 71.5;
    const mMix = ctx.createGain(); mMix.gain.value = 0.5;
    this.motorOsc1.connect(mMix); this.motorOsc2.connect(mMix);
    mMix.connect(mFilter); mFilter.connect(this.motorGain); this.motorGain.connect(this.master);
    this.motorFilter = mFilter;
    this.motorOsc1.start(); this.motorOsc2.start();

    // --- blade scrape (noise → bandpass)
    this.scrapeGain = ctx.createGain(); this.scrapeGain.gain.value = 0;
    const sSrc = ctx.createBufferSource(); sSrc.buffer = noiseBuf; sSrc.loop = true;
    const sFilter = ctx.createBiquadFilter(); sFilter.type = 'bandpass'; sFilter.frequency.value = 2600; sFilter.Q.value = 0.8;
    sSrc.connect(sFilter); sFilter.connect(this.scrapeGain); this.scrapeGain.connect(this.master);
    sSrc.start();

    // --- auger rumble (noise → lowpass, tremolo)
    this.augerGain = ctx.createGain(); this.augerGain.gain.value = 0;
    const aSrc = ctx.createBufferSource(); aSrc.buffer = noiseBuf; aSrc.loop = true; aSrc.playbackRate.value = 0.5;
    const aFilter = ctx.createBiquadFilter(); aFilter.type = 'lowpass'; aFilter.frequency.value = 180;
    const trem = ctx.createGain(); trem.gain.value = 1;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 11;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.4;
    lfo.connect(lfoG); lfoG.connect(trem.gain); lfo.start();
    aSrc.connect(aFilter); aFilter.connect(trem); trem.connect(this.augerGain); this.augerGain.connect(this.master);
    aSrc.start();

    // --- water trickle (noise → highpass, gentle)
    this.waterGain = ctx.createGain(); this.waterGain.gain.value = 0;
    const wSrc = ctx.createBufferSource(); wSrc.buffer = noiseBuf; wSrc.loop = true; wSrc.playbackRate.value = 1.7;
    const wFilter = ctx.createBiquadFilter(); wFilter.type = 'highpass'; wFilter.frequency.value = 5200;
    wSrc.connect(wFilter); wFilter.connect(this.waterGain); this.waterGain.connect(this.master);
    wSrc.start();

    // quiet arena room tone
    const rSrc = ctx.createBufferSource(); rSrc.buffer = noiseBuf; rSrc.loop = true; rSrc.playbackRate.value = 0.25;
    const rFilter = ctx.createBiquadFilter(); rFilter.type = 'lowpass'; rFilter.frequency.value = 120;
    const rGain = ctx.createGain(); rGain.gain.value = 0.02;
    rSrc.connect(rFilter); rFilter.connect(rGain); rGain.connect(this.master);
    rSrc.start();
  }

  setMuted(m) {
    this.enabled = !m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  // speedNorm 0..1, work 0..1 (conditioner down & moving)
  setDrive(speedNorm, work) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.motorGain.gain.setTargetAtTime(0.05 + speedNorm * 0.12, t, 0.15);
    this.motorOsc1.frequency.setTargetAtTime(60 + speedNorm * 160, t, 0.2);
    this.motorOsc2.frequency.setTargetAtTime(61.5 + speedNorm * 163, t, 0.2);
    this.motorFilter.frequency.setTargetAtTime(500 + speedNorm * 1500, t, 0.2);
    this.scrapeGain.gain.setTargetAtTime(work * 0.06, t, 0.15);
    this.augerGain.gain.setTargetAtTime(work * 0.20, t, 0.15);
    this.waterGain.gain.setTargetAtTime(work * 0.035, t, 0.2);
  }

  stopDrive() { this.setDrive(0, 0); }

  _env(freq, dur, type = 'sine', vol = 0.2, when = 0) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _noiseBurst(dur, filterFreq, vol, type = 'bandpass', when = 0) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.1);
  }

  conditionerDown() {
    this._noiseBurst(0.9, 900, 0.08, 'lowpass');           // hydraulic hiss
    this._env(180, 0.9, 'triangle', 0.05);
    this._env(55, 0.25, 'sine', 0.3, 0.85);                // clunk on the ice
    this._noiseBurst(0.12, 300, 0.15, 'lowpass', 0.85);
  }

  conditionerUp() {
    this._noiseBurst(0.8, 1100, 0.06, 'lowpass');
    this._env(220, 0.8, 'triangle', 0.04);
  }

  lidOpen() {
    this._env(90, 0.5, 'triangle', 0.12);
    this._noiseBurst(0.6, 500, 0.1, 'lowpass', 0.1);
  }

  skateSwish() {
    this._noiseBurst(0.35, 3800, 0.05, 'bandpass');
  }

  chime() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this._env(f, 0.7, 'sine', 0.12, i * 0.16));
  }

  drawTick() {
    this._env(700 + Math.random() * 200, 0.08, 'sine', 0.02);
  }
}
