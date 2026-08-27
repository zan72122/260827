// Gentle, procedural WebAudio for the satellite clean-room game.
// The graph is created only from a user gesture through unlock(); no assets load.

const MODES = new Set(['off', 'cleanroom', 'orbit']);
const SUCCESS_NOTES = [523.25, 659.25, 783.99, 1046.5];

function audioContextConstructor() {
  if (typeof globalThis === 'undefined') return null;
  return globalThis.AudioContext || globalThis.webkitAudioContext || null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export class SatelliteAudio {
  constructor() {
    this.available = Boolean(audioContextConstructor());
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.effectsGain = null;
    this.ambienceGain = null;
    this.mode = 'off';
    this.muted = false;

    this._compressor = null;
    this._noiseBuffer = null;
    this._hvacGain = null;
    this._orbitGain = null;
    this._ambientNodes = [];
    this._voices = new Set();
    this._activeEffects = new Map();
    this._eventCounts = Object.create(null);
    this._unlockPromise = null;
    this._disposed = false;
    this._noiseSeed = 0x51a7e11e;
    this._noiseCursor = 0;
  }

  get now() {
    return this.ctx?.currentTime || 0;
  }

  /**
   * Call from the first pointer/touch event. Calling it more than once is safe.
   * The graph is built synchronously, so a sound invoked directly after unlock()
   * is scheduled while the context resumes on iOS.
   */
  unlock() {
    if (!this.available) return Promise.resolve(false);

    if (!this.ctx || this.ctx.state === 'closed') {
      try {
        this._createGraph();
      } catch (error) {
        this.available = false;
        console.warn('WebAudio could not be started.', error);
        return Promise.resolve(false);
      }
    }

    if (this.ctx.state !== 'suspended') return Promise.resolve(true);
    if (!this._unlockPromise) {
      this._unlockPromise = Promise.resolve(this.ctx.resume())
        .then(() => this.ctx?.state !== 'closed')
        .catch(() => false)
        .finally(() => { this._unlockPromise = null; });
    }
    return this._unlockPromise;
  }

  _createGraph() {
    const AudioContextClass = audioContextConstructor();
    if (!AudioContextClass) throw new Error('AudioContext is unavailable');

    this.ctx = new AudioContextClass({ latencyHint: 'interactive' });
    this._disposed = false;

    this._compressor = this.ctx.createDynamicsCompressor();
    this._compressor.threshold.value = -22;
    this._compressor.knee.value = 24;
    this._compressor.ratio.value = 5;
    this._compressor.attack.value = 0.004;
    this._compressor.release.value = 0.26;
    this._compressor.connect(this.ctx.destination);

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.72;
    this.master.connect(this._compressor);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.46;
    this.musicGain.connect(this.master);

    this.effectsGain = this.ctx.createGain();
    this.effectsGain.gain.value = 0.68;
    this.effectsGain.connect(this.master);

    this.ambienceGain = this.ctx.createGain();
    this.ambienceGain.gain.value = 0.36;
    this.ambienceGain.connect(this.master);

    this._makeNoiseBuffer();
    this._createContinuousBeds();
    this._applyMode(true);
  }

  _makeNoiseBuffer() {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * 3));
    this._noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const samples = this._noiseBuffer.getChannelData(0);
    let state = this._noiseSeed >>> 0;
    for (let index = 0; index < samples.length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      samples[index] = (state / 0x80000000) - 1;
    }
  }

  _createContinuousBeds() {
    const ctx = this.ctx;

    // Clean-room HVAC: low filtered airflow plus a very quiet machinery hum.
    const air = ctx.createBufferSource();
    air.buffer = this._noiseBuffer;
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'lowpass';
    airFilter.frequency.value = 430;
    airFilter.Q.value = 0.45;
    const airBody = ctx.createBiquadFilter();
    airBody.type = 'highpass';
    airBody.frequency.value = 48;
    this._hvacGain = ctx.createGain();
    this._hvacGain.gain.value = 0.0001;
    air.connect(airFilter);
    airFilter.connect(airBody);
    airBody.connect(this._hvacGain);
    this._hvacGain.connect(this.ambienceGain);

    const hum = ctx.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = 58;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.022;
    hum.connect(humGain);
    humGain.connect(this._hvacGain);

    const humLfo = ctx.createOscillator();
    humLfo.type = 'sine';
    humLfo.frequency.value = 0.13;
    const humDepth = ctx.createGain();
    humDepth.gain.value = 0.003;
    humLfo.connect(humDepth);
    humDepth.connect(humGain.gain);

    // Orbit is deliberately a sparse internal/control-room musical bed, not air.
    this._orbitGain = ctx.createGain();
    this._orbitGain.gain.value = 0.0001;
    this._orbitGain.connect(this.musicGain);
    const orbitMixer = ctx.createGain();
    orbitMixer.gain.value = 0.022;
    orbitMixer.connect(this._orbitGain);

    const orbitTones = [164.81, 220, 329.63].map((frequency, index) => {
      const tone = ctx.createOscillator();
      tone.type = index === 1 ? 'triangle' : 'sine';
      tone.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.value = [0.42, 0.22, 0.12][index];
      tone.connect(gain);
      gain.connect(orbitMixer);
      return tone;
    });
    const orbitLfo = ctx.createOscillator();
    orbitLfo.type = 'sine';
    orbitLfo.frequency.value = 0.08;
    const orbitDepth = ctx.createGain();
    orbitDepth.gain.value = 0.004;
    orbitLfo.connect(orbitDepth);
    orbitDepth.connect(orbitMixer.gain);

    const nodes = [air, hum, humLfo, ...orbitTones, orbitLfo];
    nodes.forEach((node) => node.start());
    this._ambientNodes = nodes;
  }

  setMode(mode) {
    const nextMode = MODES.has(mode) ? mode : 'off';
    this.mode = nextMode;
    this._applyMode(false);
    return this.mode;
  }

  setPhaseMode(mode) {
    return this.setMode(mode);
  }

  _applyMode(immediate = false) {
    if (!this.ctx || !this._hvacGain || !this._orbitGain) return;
    const time = this.now;
    const ramp = immediate ? 0.001 : 0.32;
    const setGain = (parameter, target) => {
      parameter.cancelScheduledValues(time);
      parameter.setValueAtTime(Math.max(0.0001, parameter.value), time);
      parameter.linearRampToValueAtTime(target, time + ramp);
    };
    setGain(this._hvacGain.gain, this.mode === 'cleanroom' ? 0.22 : 0.0001);
    setGain(this._orbitGain.gain, this.mode === 'orbit' ? 0.26 : 0.0001);
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.master && this.ctx) {
      const time = this.now;
      this.master.gain.cancelScheduledValues(time);
      this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), time);
      this.master.gain.linearRampToValueAtTime(this.muted ? 0.0001 : 0.72, time + 0.05);
    }
    return this.muted;
  }

  toggleMuted() {
    return this.setMuted(!this.muted);
  }

  async suspend() {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    try {
      await this.ctx.suspend();
      return true;
    } catch {
      return false;
    }
  }

  async resume() {
    return this.unlock();
  }

  _bus(name) {
    if (name === 'music') return this.musicGain;
    if (name === 'ambience') return this.ambienceGain;
    return this.effectsGain;
  }

  _canPlay() {
    return Boolean(this.ctx && this.ctx.state !== 'closed' && !this.muted);
  }

  _trackVoice(source) {
    this._voices.add(source);
    source.addEventListener('ended', () => this._voices.delete(source), { once: true });
  }

  _markEffect(name, duration) {
    const endTime = this.now + Math.max(0, duration);
    this._activeEffects.set(name, Math.max(this._activeEffects.get(name) || 0, endTime));
    this._eventCounts[name] = (this._eventCounts[name] || 0) + 1;
  }

  _tone({
    frequency = 440,
    endFrequency = frequency,
    when = this.now,
    duration = 0.2,
    gain = 0.08,
    attack = 0.008,
    type = 'sine',
    bus = 'effects',
    pan = 0,
  } = {}) {
    if (!this._canPlay()) return null;
    const ctx = this.ctx;
    const start = Math.max(ctx.currentTime, when);
    const end = start + Math.max(0.025, duration);
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), start);
    if (endFrequency !== frequency) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), end);
    }

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(Math.max(0.0002, gain), start + Math.min(attack, duration * 0.4));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(envelope);

    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      envelope.connect(panner);
      panner.connect(this._bus(bus));
    } else {
      envelope.connect(this._bus(bus));
    }

    this._trackVoice(oscillator);
    oscillator.start(start);
    oscillator.stop(end + 0.025);
    return oscillator;
  }

  _noise({
    when = this.now,
    duration = 0.2,
    gain = 0.06,
    filterType = 'bandpass',
    frequency = 900,
    endFrequency = frequency,
    q = 0.7,
    bus = 'effects',
    pan = 0,
    attack = 0.012,
  } = {}) {
    if (!this._canPlay() || !this._noiseBuffer) return null;
    const ctx = this.ctx;
    const start = Math.max(ctx.currentTime, when);
    const length = Math.max(0.03, duration);
    const end = start + length;
    const source = ctx.createBufferSource();
    source.buffer = this._noiseBuffer;
    source.loop = length > this._noiseBuffer.duration - 0.1;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(Math.max(35, frequency), start);
    if (frequency !== endFrequency) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(35, endFrequency), end);
    }

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(Math.max(0.0002, gain), start + Math.min(attack, length * 0.35));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(filter);
    filter.connect(envelope);

    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      envelope.connect(panner);
      panner.connect(this._bus(bus));
    } else {
      envelope.connect(this._bus(bus));
    }

    this._trackVoice(source);
    const maxOffset = Math.max(0, this._noiseBuffer.duration - length - 0.02);
    const offset = maxOffset * ((this._noiseCursor * 0.173) % 1);
    this._noiseCursor += 1;
    source.start(start, offset);
    source.stop(end + 0.025);
    return source;
  }

  tap() {
    if (!this._canPlay()) return false;
    this._markEffect('tap', 0.1);
    this._tone({ frequency: 620, endFrequency: 820, duration: 0.09, gain: 0.045 });
    return true;
  }

  airShower(duration = 1.35) {
    if (!this._canPlay()) return false;
    const length = clamp(duration, 0.35, 4);
    const time = this.now;
    this._markEffect('airShower', length);
    this._noise({ when: time, duration: length, gain: 0.16, filterType: 'bandpass', frequency: 280, endFrequency: 1750, q: 0.55, bus: 'ambience' });
    this._noise({ when: time + 0.05, duration: length * 0.92, gain: 0.055, filterType: 'highpass', frequency: 1700, endFrequency: 3100, q: 0.3, bus: 'ambience' });
    this._tone({ when: time, frequency: 104, endFrequency: 118, duration: length, gain: 0.026, type: 'sine', bus: 'ambience' });
    return true;
  }

  crane(duration = 0.9) {
    if (!this._canPlay()) return false;
    const length = clamp(duration, 0.25, 2.5);
    const time = this.now;
    this._markEffect('crane', length + 0.08);
    this._tone({ when: time, frequency: 86, endFrequency: 112, duration: length, gain: 0.075, type: 'triangle' });
    this._tone({ when: time + 0.02, frequency: 174, endFrequency: 218, duration: length * 0.94, gain: 0.024, type: 'sine' });
    this._noise({ when: time + length * 0.78, duration: 0.12, gain: 0.035, filterType: 'bandpass', frequency: 620, endFrequency: 310, q: 1.2 });
    return true;
  }

  dock() {
    if (!this._canPlay()) return false;
    const time = this.now;
    this._markEffect('dock', 0.34);
    this._tone({ when: time, frequency: 152, endFrequency: 62, duration: 0.23, gain: 0.16, type: 'sine' });
    this._noise({ when: time + 0.055, duration: 0.085, gain: 0.075, filterType: 'lowpass', frequency: 720, endFrequency: 180, q: 0.7 });
    this._tone({ when: time + 0.15, frequency: 920, endFrequency: 1120, duration: 0.15, gain: 0.055 });
    return true;
  }

  connector() {
    if (!this._canPlay()) return false;
    const time = this.now;
    this._markEffect('connector', 0.24);
    this._noise({ when: time, duration: 0.045, gain: 0.075, filterType: 'highpass', frequency: 2300, q: 0.85 });
    this._tone({ when: time + 0.018, frequency: 980, endFrequency: 720, duration: 0.085, gain: 0.075, type: 'triangle' });
    this._tone({ when: time + 0.09, frequency: 1318.51, duration: 0.13, gain: 0.045 });
    return true;
  }

  ratchet(count = 3) {
    if (!this._canPlay()) return false;
    const clicks = clamp(Math.round(count), 1, 6);
    const time = this.now;
    this._markEffect('ratchet', clicks * 0.095 + 0.08);
    for (let index = 0; index < clicks; index += 1) {
      const when = time + index * 0.095;
      this._noise({ when, duration: 0.038, gain: 0.08, filterType: 'highpass', frequency: 1800 + index * 120, q: 1.1 });
      this._tone({ when, frequency: 320 + index * 18, endFrequency: 210, duration: 0.055, gain: 0.032, type: 'square' });
    }
    return true;
  }

  blanketRustle(duration = 0.85) {
    if (!this._canPlay()) return false;
    const length = clamp(duration, 0.2, 2.5);
    const time = this.now;
    this._markEffect('blanketRustle', length);
    this._noise({ when: time, duration: length, gain: 0.085, filterType: 'bandpass', frequency: 760, endFrequency: 2350, q: 0.42 });
    this._noise({ when: time + length * 0.22, duration: length * 0.58, gain: 0.032, filterType: 'highpass', frequency: 3100, endFrequency: 5100, q: 0.45 });
    return true;
  }

  panelLock(side = 'center') {
    if (!this._canPlay()) return false;
    const pan = side === 'left' ? -0.55 : side === 'right' ? 0.55 : 0;
    const time = this.now;
    this._markEffect('panelLock', 0.34);
    this._noise({ when: time, duration: 0.055, gain: 0.09, filterType: 'bandpass', frequency: 1250, endFrequency: 560, q: 1.3, pan });
    this._tone({ when: time + 0.045, frequency: 740, endFrequency: 520, duration: 0.11, gain: 0.07, type: 'triangle', pan });
    this._tone({ when: time + 0.14, frequency: 1046.5, duration: 0.18, gain: 0.045, pan });
    return true;
  }

  test(duration = 1.25) {
    if (!this._canPlay()) return false;
    const length = clamp(duration, 0.65, 2.5);
    const time = this.now;
    this._markEffect('test', length + 0.2);
    this._tone({ when: time, frequency: 46, endFrequency: 52, duration: length, gain: 0.09, type: 'sine' });
    this._noise({ when: time, duration: length, gain: 0.035, filterType: 'lowpass', frequency: 150, endFrequency: 230, q: 0.9 });
    [0.27, 0.58, 0.88].forEach((fraction, index) => {
      this._tone({ when: time + length * fraction, frequency: [659.25, 783.99, 987.77][index], duration: 0.18, gain: 0.055 });
    });
    return true;
  }

  door(open = true, duration = 0.9) {
    if (!this._canPlay()) return false;
    const length = clamp(duration, 0.35, 2);
    const time = this.now;
    this._markEffect('door', length + 0.18);
    this._tone({ when: time, frequency: open ? 62 : 94, endFrequency: open ? 96 : 58, duration: length, gain: 0.06, type: 'triangle' });
    this._noise({ when: time + 0.03, duration: length, gain: 0.07, filterType: 'lowpass', frequency: open ? 240 : 510, endFrequency: open ? 680 : 190, q: 0.55 });
    this._tone({ when: time + length * 0.9, frequency: 138, endFrequency: 72, duration: 0.16, gain: 0.08, type: 'sine' });
    return true;
  }

  launch(duration = 1.7) {
    if (!this._canPlay()) return false;
    const length = clamp(duration, 0.8, 3);
    const time = this.now;
    this._markEffect('launch', length);
    this._tone({ when: time, frequency: 38, endFrequency: 76, duration: length, gain: 0.14, type: 'sine' });
    this._tone({ when: time + 0.05, frequency: 69, endFrequency: 132, duration: length * 0.82, gain: 0.045, type: 'triangle' });
    this._noise({ when: time, duration: length, gain: 0.12, filterType: 'lowpass', frequency: 90, endFrequency: 820, q: 0.42 });
    this._noise({ when: time + length * 0.45, duration: length * 0.5, gain: 0.045, filterType: 'bandpass', frequency: 330, endFrequency: 1450, q: 0.5 });
    return true;
  }

  signal(index = 0) {
    if (!this._canPlay()) return false;
    const time = this.now;
    const base = [880, 987.77, 1046.5][Math.abs(index) % 3];
    const pan = [-0.35, 0, 0.35][Math.abs(index) % 3];
    this._markEffect('signal', 0.52);
    [0, 0.13, 0.27].forEach((offset, pulse) => {
      this._tone({ when: time + offset, frequency: base * (1 + pulse * 0.08), endFrequency: base * (1.28 + pulse * 0.05), duration: 0.18, gain: 0.055 - pulse * 0.006, type: 'sine', pan });
    });
    return true;
  }

  success() {
    if (!this._canPlay()) return false;
    const time = this.now;
    this._markEffect('success', 1.05);
    SUCCESS_NOTES.forEach((frequency, index) => {
      this._tone({ when: time + index * 0.115, frequency, duration: 0.65 + index * 0.08, gain: 0.072, type: 'sine', bus: 'music', pan: (index - 1.5) * 0.14 });
      this._tone({ when: time + index * 0.115, frequency: frequency * 2, duration: 0.22, gain: 0.018, type: 'sine', bus: 'music', pan: (index - 1.5) * 0.14 });
    });
    return true;
  }

  missionPreview(mission = 'weather') {
    if (!this._canPlay()) return false;
    const time = this.now;
    this._markEffect('missionPreview', 0.58);
    if (mission === 'ocean') {
      this._tone({ when: time, frequency: 392, endFrequency: 523.25, duration: 0.38, gain: 0.055, type: 'sine' });
      this._noise({ when: time + 0.04, duration: 0.42, gain: 0.025, filterType: 'bandpass', frequency: 420, endFrequency: 880, q: 1 });
    } else if (mission === 'communication' || mission === 'comms') {
      this._tone({ when: time, frequency: 659.25, endFrequency: 1046.5, duration: 0.15, gain: 0.05 });
      this._tone({ when: time + 0.18, frequency: 783.99, endFrequency: 1318.51, duration: 0.2, gain: 0.05 });
    } else {
      this._tone({ when: time, frequency: 523.25, endFrequency: 659.25, duration: 0.22, gain: 0.05 });
      this._tone({ when: time + 0.15, frequency: 783.99, endFrequency: 698.46, duration: 0.3, gain: 0.045 });
    }
    return true;
  }

  // Descriptive aliases keep scene code readable and ease state-driven autoplay.
  playAirShower(duration) { return this.airShower(duration); }
  playCrane(duration) { return this.crane(duration); }
  playDock() { return this.dock(); }
  playConnector() { return this.connector(); }
  playRatchet(count) { return this.ratchet(count); }
  playBlanketRustle(duration) { return this.blanketRustle(duration); }
  playPanelLock(side) { return this.panelLock(side); }
  playTest(duration) { return this.test(duration); }
  playDoor(open, duration) { return this.door(open, duration); }
  playLaunch(duration) { return this.launch(duration); }
  playSignal(index) { return this.signal(index); }
  playSuccess() { return this.success(); }
  chimeSuccess() { return this.success(); }
  place() { return this.dock(); }
  pop() { return this.connector(); }

  get stats() {
    const now = this.now;
    for (const [name, endTime] of this._activeEffects) {
      if (endTime <= now) this._activeEffects.delete(name);
    }
    const activeEffects = [...this._activeEffects.keys()].sort();
    const ambienceVoices = this.mode === 'off' || this.muted || !this.ctx ? 0 :
      (this.mode === 'cleanroom' ? 3 : 4);
    const transientVoices = this._voices.size;
    const connected = Boolean(this.ctx && this.ctx.state !== 'closed');

    return Object.freeze({
      available: this.available,
      unlocked: connected,
      muted: this.muted,
      mode: this.mode,
      contextState: this.ctx?.state || 'unavailable',
      buses: Object.freeze({
        master: Boolean(this.master),
        music: Boolean(this.musicGain),
        effects: Boolean(this.effectsGain),
        ambience: Boolean(this.ambienceGain),
      }),
      activeVoices: transientVoices + ambienceVoices,
      voices: Object.freeze({
        transient: transientVoices,
        ambience: ambienceVoices,
        total: transientVoices + ambienceVoices,
      }),
      activeEffects: Object.freeze(activeEffects),
      effects: Object.freeze({
        active: Object.freeze(activeEffects.slice()),
        counts: Object.freeze({ ...this._eventCounts }),
      }),
      ambienceActive: ambienceVoices > 0,
    });
  }

  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const node of this._ambientNodes) {
      try { node.stop(); } catch { /* already stopped */ }
    }
    this._ambientNodes.length = 0;
    this._voices.clear();
    this._activeEffects.clear();
    const context = this.ctx;
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.effectsGain = null;
    this.ambienceGain = null;
    this._hvacGain = null;
    this._orbitGain = null;
    if (context && context.state !== 'closed') {
      try { await context.close(); } catch { /* browser already released it */ }
    }
  }
}

export default SatelliteAudio;
