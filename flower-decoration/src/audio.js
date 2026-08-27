// WebAudio 合成サウンド。外部アセットなし。
// すべて優しい音量・音色（4歳児向け）。初回ポインタ操作で unlock() を呼ぶ。

const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 784.0, 880.0]; // Cペンタトニック

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.effectsGain = null;
    this.ambienceGain = null;
    this.reverbGain = null;
    this.convolver = null;
    this.pianoPanner = null;
    this.barPanner = null;
    this.mode = 'off'; // off | prep | party
    this.muted = false;
    this._musicTimer = null;
    this._ambienceTimer = null;
    this._ambienceNodes = [];
    this._nextNoteTime = 0;
    this._partyStep = 0;
    this._noiseBuf = null;
    this._eventCounts = { footsteps: 0, cloth: 0, tableware: 0, service: 0 };
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 6;
    comp.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(comp);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.13;
    this.effectsGain = this.ctx.createGain();
    this.effectsGain.gain.value = 0.78;
    this.ambienceGain = this.ctx.createGain();
    this.ambienceGain.gain.value = 0.12;
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.16;
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this._makeHallImpulse(1.45, 2.8);
    this.musicGain.connect(this.master);
    this.effectsGain.connect(this.master);
    this.ambienceGain.connect(this.master);
    this.musicGain.connect(this.convolver);
    this.effectsGain.connect(this.convolver);
    this.ambienceGain.connect(this.convolver);
    this.convolver.connect(this.reverbGain);
    this.reverbGain.connect(this.master);
    // ノイズバッファ（効果音用）
    const len = this.ctx.sampleRate * 1.2;
    this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.pianoPanner = this._makePanner(-6.25, 5.9, this.musicGain, 5.5);
    this.barPanner = this._makePanner(6.15, -10.15, this.effectsGain, 4.5);
    this._startMusicLoop();
    this._startAmbienceScheduler();
    if (this.mode === 'party') this.startPartyAmbience();
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  _makeHallImpulse(seconds, decay) {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const impulse = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
      const data = impulse.getChannelData(channel);
      for (let index = 0; index < length; index++) {
        const envelope = Math.pow(1 - index / length, decay);
        const early = index < this.ctx.sampleRate * 0.075 ? 0.45 : 1;
        data[index] = (Math.random() * 2 - 1) * envelope * early;
      }
    }
    return impulse;
  }

  _makePanner(x, z, destination, refDistance = 4) {
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = refDistance;
    panner.maxDistance = 32;
    panner.rolloffFactor = 0.7;
    if (panner.positionX) {
      panner.positionX.value = x;
      panner.positionY.value = 1.1;
      panner.positionZ.value = z;
    } else panner.setPosition(x, 1.1, z);
    panner.connect(destination);
    return panner;
  }

  _bus(name = 'effects') {
    if (name === 'music') return this.pianoPanner || this.musicGain || this.master;
    if (name === 'bar') return this.barPanner || this.effectsGain || this.master;
    if (name === 'ambience') return this.ambienceGain || this.master;
    return this.effectsGain || this.master;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.now);
      this.master.gain.setTargetAtTime(this.muted ? 0.0001 : 0.7, this.now, 0.035);
    }
    return this.muted;
  }

  toggleMuted() { return this.setMuted(!this.muted); }

  // ---- 基本音素 ----

  _pluck(freq, t, { gain = 0.22, dur = 0.9, bright = 0.35, bus = 'effects' } = {}) {
    // オルゴール風：正弦＋高調波、速い減衰
    const ctx = this.ctx; if (!ctx) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    const output = this._bus(bus);
    g.connect(output);
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 4;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(gain * bright, t);
    g2.gain.exponentialRampToValueAtTime(0.0004, t + dur * 0.35);
    o1.connect(g); o2.connect(g2); g2.connect(output);
    o1.start(t); o1.stop(t + dur + 0.1);
    o2.start(t); o2.stop(t + dur * 0.4);
  }

  _noise(t, { dur = 0.15, gain = 0.2, type = 'bandpass', f0 = 1000, f1 = null, q = 1, bus = 'effects' } = {}) {
    const ctx = this.ctx; if (!ctx) return;
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuf;
    src.loop = dur > 0.55;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    if (f1 !== null) flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    src.connect(flt); flt.connect(g); g.connect(this._bus(bus));
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  // ---- 効果音 ----

  tap() { if (!this.ctx) return; this._pluck(PENTA[2 + (Math.random() * 3 | 0)], this.now, { gain: 0.1, dur: 0.4 }); }

  pop() {
    if (!this.ctx) return; const t = this.now;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g); g.connect(this._bus('effects'));
    o.start(t); o.stop(t + 0.16);
    this._noise(t, { dur: 0.05, gain: 0.08, f0: 2500, q: 0.8 });
  }

  place(i = 0) {
    if (!this.ctx) return; const t = this.now;
    this.pop();
    this._pluck(PENTA[(i % 5) + 3], t + 0.05, { gain: 0.16, dur: 0.7 });
  }

  snip() {
    if (!this.ctx) return; const t = this.now;
    this._noise(t, { dur: 0.05, gain: 0.22, type: 'highpass', f0: 3000, q: 1 });
    this._noise(t + 0.07, { dur: 0.06, gain: 0.26, type: 'highpass', f0: 2600, q: 1 });
    this._pluck(PENTA[5], t + 0.1, { gain: 0.08, dur: 0.35 });
  }

  splash() {
    if (!this.ctx) return; const t = this.now;
    this._noise(t, { dur: 0.3, gain: 0.2, f0: 900, f1: 260, q: 1.4 });
    // しずくの跳ね
    const ctx = this.ctx;
    for (let i = 0; i < 3; i++) {
      const tt = t + 0.06 + i * 0.07;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(700 + Math.random() * 400, tt);
      o.frequency.exponentialRampToValueAtTime(1400 + Math.random() * 600, tt + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.09, tt + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0005, tt + 0.1);
      o.connect(g); g.connect(this._bus('effects'));
      o.start(tt); o.stop(tt + 0.12);
    }
  }

  chimeSuccess() {
    if (!this.ctx) return; const t = this.now;
    [0, 2, 4, 7].forEach((n, i) => this._pluck(PENTA[n], t + i * 0.09, { gain: 0.18, dur: 1.0 }));
  }

  gliss(up = true) {
    if (!this.ctx) return; const t = this.now;
    for (let i = 0; i < 9; i++) {
      const idx = up ? i : 8 - i;
      this._pluck(PENTA[idx], t + i * 0.05, { gain: 0.13, dur: 0.8 });
    }
  }

  whoosh(dur = 1.2) {
    if (!this.ctx) return; const t = this.now;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuf; src.loop = true;
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 0.7;
    flt.frequency.setValueAtTime(180, t);
    flt.frequency.exponentialRampToValueAtTime(2400, t + dur * 0.55);
    flt.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(flt); flt.connect(g); g.connect(this._bus('effects'));
    src.start(t); src.stop(t + dur + 0.1);
  }

  doorCreak() {
    if (!this.ctx) return; const t = this.now;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(95, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.15);
    g.gain.linearRampToValueAtTime(0, t + 1.1);
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 300;
    o.connect(flt); flt.connect(g); g.connect(this._bus('effects'));
    o.start(t); o.stop(t + 1.2);
    this.whoosh(1.6);
  }

  bloomNote(i) {
    if (!this.ctx) return;
    this._pluck(PENTA[i % PENTA.length], this.now, { gain: 0.12, dur: 0.9 });
  }

  fanfare() {
    if (!this.ctx) return; const t = this.now;
    const seq = [0, 2, 4, 5, 7, 9, 7, 9];
    seq.forEach((n, i) => this._pluck(PENTA[n % PENTA.length], t + i * 0.11, { gain: 0.2, dur: 1.2 }));
    this._noise(t + 0.1, { dur: 1.4, gain: 0.05, type: 'highpass', f0: 6000, q: 0.5 });
  }

  glassClink() {
    if (!this.ctx) return;
    const t = this.now;
    // 二つのグラスが触れる短い倍音。3音だけに抑えて耳当たりを軽くする。
    [1760, 2637, 3520].forEach((frequency, index) => {
      const ctx = this.ctx;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, t + index * 0.007);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.075 / (index + 1), t + 0.008 + index * 0.007);
      gain.gain.exponentialRampToValueAtTime(0.0004, t + 0.42 - index * 0.06);
      oscillator.connect(gain); gain.connect(this._bus('effects'));
      oscillator.start(t); oscillator.stop(t + 0.48);
    });
  }

  applause() {
    if (!this.ctx) return;
    const t = this.now;
    // 少数の帯域ノイズをずらし、拍手の群れを表現する。全て同時には鳴らさない。
    for (let index = 0; index < 7; index++) {
      this._noise(t + index * 0.115, {
        dur: 0.12,
        gain: 0.09 + (index % 3) * 0.012,
        type: 'bandpass',
        f0: 1050 + (index % 4) * 230,
        f1: 760 + (index % 3) * 150,
        q: 0.75,
      });
    }
  }

  crowdCheer() {
    if (!this.ctx) return;
    const t = this.now;
    const ctx = this.ctx;
    // 3声の短い上昇音と低い空気音で、言葉を使わない穏やかな歓声にする。
    [196, 246.94, 293.66].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = index === 1 ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency, t + index * 0.08);
      oscillator.frequency.linearRampToValueAtTime(frequency * 1.18, t + 0.72 + index * 0.08);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.026, t + 0.18 + index * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + 1.2 + index * 0.08);
      oscillator.connect(gain); gain.connect(this._bus('ambience'));
      oscillator.start(t + index * 0.08); oscillator.stop(t + 1.3 + index * 0.08);
    });
    this._noise(t + 0.05, { dur: 1.05, gain: 0.025, type: 'bandpass', f0: 620, f1: 980, q: 0.55 });
  }

  serviceSetDown() {
    if (!this.ctx) return;
    const t = this.now;
    const ctx = this.ctx;
    // 磁器の低い接地音と、少し遅れるグラスの余韻を各1音に抑える。
    [[520, 0.045, 0.22, 'triangle'], [1568, 0.035, 0.34, 'sine']]
      .forEach(([frequency, peak, duration, type], index) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = t + index * 0.045;
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(peak, start + 0.009);
        gain.gain.exponentialRampToValueAtTime(0.0004, start + duration);
        oscillator.connect(gain); gain.connect(this._bus('bar'));
        oscillator.start(start); oscillator.stop(start + duration + 0.05);
      });
    this._noise(t, { dur: 0.055, gain: 0.018, type: 'highpass', f0: 2200, q: 0.8, bus: 'bar' });
    this._eventCounts.service += 1;
  }

  startPartyAmbience() {
    if (!this.ctx || this._ambienceNodes.length) return;
    const ctx = this.ctx;
    const room = ctx.createBufferSource();
    room.buffer = this._noiseBuf;
    room.loop = true;
    const roomFilter = ctx.createBiquadFilter();
    roomFilter.type = 'bandpass';
    roomFilter.frequency.value = 430;
    roomFilter.Q.value = 0.42;
    const roomGain = ctx.createGain();
    roomGain.gain.value = 0.045;
    room.connect(roomFilter); roomFilter.connect(roomGain); roomGain.connect(this.ambienceGain);

    const sway = ctx.createOscillator();
    sway.type = 'sine';
    sway.frequency.value = 0.11;
    const swayDepth = ctx.createGain();
    swayDepth.gain.value = 0.012;
    sway.connect(swayDepth); swayDepth.connect(roomGain.gain);

    const lowVoices = [112, 147, 183].map((frequency, index) => {
      const oscillator = ctx.createOscillator();
      oscillator.type = index === 1 ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.value = 0.004 + index * 0.001;
      oscillator.connect(gain); gain.connect(this.ambienceGain);
      oscillator.start();
      return oscillator;
    });
    room.start();
    sway.start();
    this._ambienceNodes = [room, sway, ...lowVoices];
  }

  stopPartyAmbience() {
    for (const node of this._ambienceNodes) {
      try { node.stop(); } catch { /* already stopped */ }
    }
    this._ambienceNodes.length = 0;
  }

  _startAmbienceScheduler() {
    if (this._ambienceTimer) return;
    this._ambienceTimer = setInterval(() => {
      if (this.mode !== 'party' || !this.ctx || this.muted) return;
      const roll = Math.random();
      if (roll < 0.42) this.tableware();
      else if (roll < 0.78) this._murmurPulse();
    }, 780);
  }

  _murmurPulse() {
    if (!this.ctx) return;
    const t = this.now;
    this._noise(t, {
      dur: 0.42 + Math.random() * 0.35,
      gain: 0.018,
      type: 'bandpass',
      f0: 260 + Math.random() * 210,
      f1: 180 + Math.random() * 180,
      q: 0.55,
      bus: 'ambience',
    });
  }

  tableware() {
    if (!this.ctx) return;
    const t = this.now;
    const frequency = 1320 + Math.random() * 1250;
    this._pluck(frequency, t, {
      gain: 0.018,
      dur: 0.28,
      bright: 0.16,
      bus: Math.random() > 0.5 ? 'bar' : 'ambience',
    });
    this._eventCounts.tableware += 1;
  }

  footsteps(duration = 2, pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const steps = Math.max(1, Math.floor(duration / 0.46));
    for (let index = 0; index < steps; index += 1) {
      const time = this.now + index * 0.46;
      const source = ctx.createBufferSource();
      source.buffer = this._noiseBuf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 180 + (index % 3) * 35;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.055, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0004, time + 0.13);
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (panner) panner.pan.value = Math.max(-0.9, Math.min(0.9, pan));
      source.connect(filter); filter.connect(gain);
      if (panner) { gain.connect(panner); panner.connect(this.effectsGain); }
      else gain.connect(this.effectsGain);
      source.start(time, (index * 0.11) % 0.8); source.stop(time + 0.16);
    }
    this._eventCounts.footsteps += steps;
  }

  clothRustle(duration = 1.4) {
    if (!this.ctx) return;
    const t = this.now;
    this._noise(t, { dur: duration, gain: 0.045, type: 'bandpass', f0: 620, f1: 1700, q: 0.45 });
    this._eventCounts.cloth += 1;
  }

  // ---- BGM ----

  setMode(mode) {
    this.mode = mode;
    this._partyStep = 0;
    if (mode === 'party') this.startPartyAmbience();
    else this.stopPartyAmbience();
    // off中に止まった過去時刻から大量の音符を追い掛けない。
    if (this.ctx) this._nextNoteTime = this.now + (mode === 'off' ? 0.2 : 0.06);
  }

  _startMusicLoop() {
    if (this._musicTimer) return;
    this._nextNoteTime = this.now + 0.3;
    this._musicTimer = setInterval(() => this._scheduleMusic(), 120);
  }

  _scheduleMusic() {
    if (!this.ctx) return;
    if (this.mode === 'off') {
      this._nextNoteTime = this.now + 0.2;
      return;
    }
    const ahead = 0.35;
    if (this._nextNoteTime < this.now - 0.05) this._nextNoteTime = this.now + 0.06;
    while (this._nextNoteTime < this.now + ahead) {
      if (this.mode === 'prep') this._prepNote(this._nextNoteTime);
      else if (this.mode === 'party') this._partyNote(this._nextNoteTime);
      this._nextNoteTime += this.mode === 'party' ? 0.2727 : (1.6 + Math.random() * 1.4);
    }
  }

  _prepNote(t) {
    // まばらなオルゴール（準備中の静けさ）
    const n = PENTA[(Math.random() * 6 | 0)];
    this._mgPluck(n, t, 0.35, 1.6);
  }

  _partyNote(t) {
    // C - G - Am - F を8分でアルペジオ（オルゴール）
    const chords = [
      [261.63, 329.63, 392.0, 523.25],
      [196.0, 293.66, 392.0, 493.88],
      [220.0, 329.63, 440.0, 523.25],
      [174.61, 261.63, 349.23, 440.0],
    ];
    const bar = (this._partyStep / 8 | 0) % 4;
    const step = this._partyStep % 8;
    const ch = chords[bar];
    const order = [0, 2, 1, 3, 2, 0, 3, 1];
    this._mgPluck(ch[order[step]] * 2, t, 0.5, 0.9);
    if (step === 0) this._mgPluck(ch[0] / 2, t, 0.5, 1.4); // ベース
    if (step === 4) this._mgPluck(ch[0], t, 0.3, 1.0);
    this._partyStep++;
  }

  _mgPluck(freq, t, gain, dur) {
    const ctx = this.ctx; if (!ctx) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    const output = this._bus('music');
    g.connect(output);
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 3;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(gain * 0.25, t);
    g2.gain.exponentialRampToValueAtTime(0.0004, t + dur * 0.3);
    o1.connect(g); o2.connect(g2); g2.connect(output);
    o1.start(t); o1.stop(t + dur + 0.1);
    o2.start(t); o2.stop(t + dur * 0.35);
  }

  get stats() {
    return Object.freeze({
      unlocked: Boolean(this.ctx),
      muted: this.muted,
      mode: this.mode,
      buses: Object.freeze({ music: Boolean(this.musicGain), effects: Boolean(this.effectsGain), ambience: Boolean(this.ambienceGain) }),
      hallReverb: Boolean(this.convolver?.buffer),
      spatialSources: Object.freeze({ piano: Boolean(this.pianoPanner), bar: Boolean(this.barPanner) }),
      ambienceActive: this._ambienceNodes.length > 0,
      eventCounts: Object.freeze({ ...this._eventCounts }),
    });
  }
}
