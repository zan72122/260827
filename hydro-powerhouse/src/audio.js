// Lightweight, asset-free WebAudio for the hydro plant.
// The graph is created only after a user gesture calls unlock().

const DESTINATION_NOTES = Object.freeze({
  lighthouse: [523.25, 659.25, 783.99],
  train: [392.0, 493.88, 587.33],
  city: [329.63, 493.88, 659.25],
  wheel: [329.63, 493.88, 659.25],
});

const MODE_MIX = Object.freeze({
  off: { music: 0.0001, effects: 0.72, ambience: 0.0001 },
  choose: { music: 0.035, effects: 0.76, ambience: 0.055 },
  assembly: { music: 0.03, effects: 0.78, ambience: 0.075 },
  fluids: { music: 0.022, effects: 0.78, ambience: 0.105 },
  casing: { music: 0.018, effects: 0.8, ambience: 0.085 },
  gate: { music: 0.012, effects: 0.78, ambience: 0.135 },
  generation: { music: 0.018, effects: 0.76, ambience: 0.15 },
  complete: { music: 0.03, effects: 0.75, ambience: 0.14 },
});

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function rounded(value) {
  return Math.round(value * 10000) / 10000;
}

export class HydroAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.effectsGain = null;
    this.ambienceGain = null;
    this.reverbGain = null;
    this.convolver = null;

    this.waterPanner = null;
    this.turbinePanner = null;
    this.generatorPanner = null;

    this.mode = 'off';
    this.muted = false;

    this._noiseBuffer = null;
    this._continuous = null;
    this._generation = {
      gate: 0,
      speed: 0,
      power: 0,
      generatorPitch: 58,
      waterGain: 0,
      turbineGain: 0,
      generatorGain: 0,
    };
    this._eventCounts = {
      tap: 0,
      selectDestination: 0,
      bladeSnap: 0,
      assistedBladeSnap: 0,
      coilSnap: 0,
      assistedCoilSnap: 0,
      hoseConnect: 0,
      hoseOil: 0,
      hoseCooling: 0,
      fluidFlow: 0,
      fluidOil: 0,
      fluidCooling: 0,
      casingMove: 0,
      casingLock: 0,
      gateTouch: 0,
      transmission: 0,
      destinationOn: 0,
    };
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        const resumed = this.ctx.resume();
        if (resumed?.catch) resumed.catch(() => {});
      }
      return true;
    }

    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) return false;

    try {
      this.ctx = new AudioContextClass();
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 18;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.006;
      compressor.release.value = 0.24;
      compressor.connect(this.ctx.destination);

      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0.0001 : 0.68;
      this.master.connect(compressor);

      this.musicGain = this.ctx.createGain();
      this.effectsGain = this.ctx.createGain();
      this.ambienceGain = this.ctx.createGain();
      this.musicGain.connect(this.master);
      this.effectsGain.connect(this.master);
      this.ambienceGain.connect(this.master);

      this.convolver = this.ctx.createConvolver();
      this.convolver.normalize = true;
      this.convolver.buffer = this._makeImpulse(0.72, 2.9);
      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.value = 0.11;
      this.musicGain.connect(this.convolver);
      this.effectsGain.connect(this.convolver);
      this.ambienceGain.connect(this.convolver);
      this.convolver.connect(this.reverbGain);
      this.reverbGain.connect(this.master);

      this._noiseBuffer = this._makeNoiseBuffer(1.6);
      this._startContinuousSources();
      this._applyModeMix(true);
      this._applyGeneration(true);
      return true;
    } catch {
      this.ctx = null;
      this.master = null;
      this.musicGain = null;
      this.effectsGain = null;
      this.ambienceGain = null;
      this.reverbGain = null;
      this.convolver = null;
      return false;
    }
  }

  setMuted(value) {
    this.muted = Boolean(value);
    if (this.ctx && this.master) {
      const now = this.now;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0.0001 : 0.68, now, 0.025);
    }
    return this.muted;
  }

  toggleMuted() {
    return this.setMuted(!this.muted);
  }

  suspend() {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    const pending = this.ctx.suspend();
    if (pending?.catch) pending.catch(() => {});
    return true;
  }

  resume() {
    if (!this.ctx || this.ctx.state !== 'suspended') return false;
    const pending = this.ctx.resume();
    if (pending?.catch) pending.catch(() => {});
    return true;
  }

  setMode(mode) {
    this.mode = typeof mode === 'string' && mode ? mode : 'off';
    this._applyModeMix(false);
    return this.mode;
  }

  updateGeneration({ gate = 0, speed = 0, power = 0 } = {}) {
    this._generation.gate = clamp01(gate);
    this._generation.speed = clamp01(speed);
    this._generation.power = clamp01(power);
    this._generation.waterGain = this._generation.gate > 0
      ? 0.018 + 0.19 * Math.pow(this._generation.gate, 0.72)
      : 0;
    this._generation.turbineGain = this._generation.speed > 0
      ? 0.008 + 0.15 * Math.pow(this._generation.speed, 0.82)
      : 0;
    this._generation.generatorGain = this._generation.power > 0
      ? 0.006 + 0.105 * Math.pow(this._generation.power, 0.74)
      : 0;
    this._generation.generatorPitch = 58 + 202 * this._generation.speed;
    this._applyGeneration(false);
  }

  tap() {
    this._count('tap');
    if (!this.ctx) return;
    this._tone(310, { gain: 0.035, duration: 0.12, endFrequency: 270, type: 'sine' });
  }

  selectDestination(kind) {
    this._count('selectDestination');
    if (!this.ctx) return;
    const notes = this._destinationNotes(kind);
    notes.forEach((frequency, index) => {
      this._tone(frequency, {
        delay: index * 0.075,
        gain: 0.055,
        duration: 0.42,
        type: 'sine',
        bus: 'music',
      });
    });
  }

  bladeSnap(index = 0, assisted = false) {
    this._count('bladeSnap');
    if (assisted) this._count('assistedBladeSnap');
    if (!this.ctx) return;
    const delay = assisted ? 0.035 : 0;
    this._noiseBurst({
      delay,
      duration: 0.22,
      gain: assisted ? 0.035 : 0.065,
      filter: 'bandpass',
      startFrequency: 1300,
      endFrequency: 430,
      q: 0.8,
    });
    this._metalHit(118 + (Number(index) % 4) * 8, delay + 0.13, assisted ? 0.045 : 0.085);
  }

  coilSnap(index = 0, assisted = false) {
    this._count('coilSnap');
    if (assisted) this._count('assistedCoilSnap');
    if (!this.ctx) return;
    const delay = assisted ? 0.025 : 0;
    this._tone(132 + (Number(index) % 4) * 7, {
      delay,
      gain: assisted ? 0.035 : 0.065,
      duration: 0.28,
      endFrequency: 94,
      type: 'triangle',
    });
    this._tone(660 + (Number(index) % 5) * 55, {
      delay: delay + 0.07,
      gain: assisted ? 0.018 : 0.035,
      duration: 0.38,
      type: 'sine',
    });
  }

  hoseConnect(kind) {
    this._count('hoseConnect');
    if (this._isOil(kind)) this._count('hoseOil');
    else this._count('hoseCooling');
    if (!this.ctx) return;
    this._tone(this._isOil(kind) ? 92 : 118, {
      gain: 0.07,
      duration: 0.24,
      endFrequency: 72,
      type: 'triangle',
    });
    this._metalHit(this._isOil(kind) ? 172 : 205, 0.1, 0.065);
  }

  fluidFlow(kind) {
    this._count('fluidFlow');
    if (this._isOil(kind)) this._count('fluidOil');
    else this._count('fluidCooling');
    if (!this.ctx) return;
    if (this._isOil(kind)) {
      for (let index = 0; index < 4; index += 1) {
        this._tone(105 + index * 14, {
          delay: index * 0.11,
          gain: 0.025,
          duration: 0.18,
          endFrequency: 78 + index * 8,
          type: 'sine',
          bus: 'ambience',
        });
      }
    } else {
      this._noiseBurst({
        duration: 0.7,
        gain: 0.065,
        filter: 'bandpass',
        startFrequency: 1200,
        endFrequency: 520,
        q: 0.55,
        bus: 'ambience',
      });
      [920, 1180, 1450].forEach((frequency, index) => this._tone(frequency, {
        delay: 0.08 + index * 0.09,
        gain: 0.018,
        duration: 0.13,
        endFrequency: frequency * 1.25,
        bus: 'ambience',
      }));
    }
  }

  casingMove() {
    this._count('casingMove');
    if (!this.ctx) return;
    this._noiseBurst({
      duration: 1.05,
      gain: 0.07,
      filter: 'lowpass',
      startFrequency: 170,
      endFrequency: 430,
      q: 0.65,
    });
    this._tone(54, {
      gain: 0.055,
      duration: 1.1,
      endFrequency: 69,
      type: 'sawtooth',
    });
  }

  casingLock() {
    this._count('casingLock');
    if (!this.ctx) return;
    this._tone(49, {
      gain: 0.11,
      duration: 0.62,
      endFrequency: 38,
      type: 'triangle',
    });
    this._metalHit(96, 0.36, 0.11);
    this._metalHit(228, 0.47, 0.055);
  }

  gateTouch() {
    this._count('gateTouch');
    if (!this.ctx) return;
    this._tone(78, {
      gain: 0.055,
      duration: 0.22,
      endFrequency: 61,
      type: 'square',
    });
    this._noiseBurst({
      delay: 0.04,
      duration: 0.12,
      gain: 0.035,
      filter: 'highpass',
      startFrequency: 900,
      endFrequency: 460,
    });
  }

  transmission() {
    this._count('transmission');
    if (!this.ctx) return;
    const notes = [196, 246.94, 329.63, 392, 493.88, 659.25];
    notes.forEach((frequency, index) => this._tone(frequency, {
      delay: index * 0.085,
      gain: 0.045 + index * 0.004,
      duration: 0.48,
      endFrequency: frequency * 1.08,
      type: index < 2 ? 'triangle' : 'sine',
      bus: index > 2 ? 'music' : 'effects',
    }));
  }

  destinationOn(kind) {
    this._count('destinationOn');
    if (!this.ctx) return;
    const notes = this._destinationNotes(kind);
    [notes[0], notes[1], notes[2], notes[0] * 2].forEach((frequency, index) => {
      this._tone(frequency, {
        delay: index * 0.105,
        gain: index === 3 ? 0.055 : 0.07,
        duration: 0.72,
        type: index === 0 ? 'triangle' : 'sine',
        bus: 'music',
      });
    });
  }

  get stats() {
    return {
      unlocked: Boolean(this.ctx),
      contextState: this.ctx?.state ?? 'unavailable',
      muted: this.muted,
      mode: this.mode,
      buses: {
        music: Boolean(this.musicGain),
        effects: Boolean(this.effectsGain),
        ambience: Boolean(this.ambienceGain),
      },
      hallReverb: Boolean(this.convolver && this.reverbGain),
      spatialSources: {
        water: Boolean(this.waterPanner),
        turbine: Boolean(this.turbinePanner),
        generator: Boolean(this.generatorPanner),
      },
      generatorPitch: rounded(this._generation.generatorPitch),
      waterGain: rounded(this._generation.waterGain),
      turbineGain: rounded(this._generation.turbineGain),
      eventCounts: { ...this._eventCounts },
    };
  }

  _count(name) {
    this._eventCounts[name] = (this._eventCounts[name] || 0) + 1;
  }

  _destinationNotes(kind) {
    const key = String(kind || '').toLowerCase();
    return DESTINATION_NOTES[key] || DESTINATION_NOTES.city;
  }

  _isOil(kind) {
    return String(kind || '').toLowerCase().includes('oil');
  }

  _modeMix() {
    if (MODE_MIX[this.mode]) return MODE_MIX[this.mode];
    if (this.mode.includes('runner') || this.mode.includes('stator')) return MODE_MIX.assembly;
    if (this.mode.includes('fluid')) return MODE_MIX.fluids;
    if (this.mode.includes('casing')) return MODE_MIX.casing;
    if (this.mode.includes('gate')) return MODE_MIX.gate;
    if (this.mode.includes('generat')) return MODE_MIX.generation;
    if (this.mode.includes('complete')) return MODE_MIX.complete;
    return MODE_MIX.assembly;
  }

  _applyModeMix(immediate) {
    if (!this.ctx) return;
    const mix = this._modeMix();
    const now = this.now;
    const timeConstant = immediate ? 0.001 : 0.14;
    this._setTarget(this.musicGain?.gain, mix.music, now, timeConstant);
    this._setTarget(this.effectsGain?.gain, mix.effects, now, timeConstant);
    this._setTarget(this.ambienceGain?.gain, mix.ambience, now, timeConstant);
  }

  _applyGeneration(immediate) {
    if (!this.ctx || !this._continuous) return;
    const state = this._generation;
    const now = this.now;
    const gainTime = immediate ? 0.001 : 0.12;
    const pitchTime = immediate ? 0.001 : 0.08;
    this._setTarget(this._continuous.waterGain.gain, state.waterGain, now, gainTime);
    this._setTarget(this._continuous.turbineGain.gain, state.turbineGain, now, gainTime);
    this._setTarget(this._continuous.generatorGain.gain, state.generatorGain, now, gainTime);
    this._setTarget(this._continuous.waterSource.playbackRate,
      0.64 + state.gate * 0.92, now, pitchTime);
    this._setTarget(this._continuous.waterFilter.frequency,
      360 + state.gate * 1780, now, pitchTime);
    this._setTarget(this._continuous.turbine.frequency,
      34 + state.speed * 76, now, pitchTime);
    this._setTarget(this._continuous.turbineHarmonic.frequency,
      68 + state.speed * 152, now, pitchTime);
    this._setTarget(this._continuous.generator.frequency,
      state.generatorPitch, now, pitchTime);
    this._setTarget(this._continuous.generatorHarmonic.frequency,
      state.generatorPitch * 2.01, now, pitchTime);
  }

  _setTarget(param, target, now, timeConstant) {
    if (!param) return;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(Math.max(0.0001, target), now, timeConstant);
  }

  _makeImpulse(seconds, decay) {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const impulse = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    let seed = 0x2f6e2b1;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        const envelope = Math.pow(1 - index / length, decay);
        const early = index < this.ctx.sampleRate * 0.045 ? 0.38 : 1;
        data[index] = (random() * 2 - 1) * envelope * early;
      }
    }
    return impulse;
  }

  _makeNoiseBuffer(seconds) {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x8d31ac47;
    for (let index = 0; index < length; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[index] = (seed / 0xffffffff) * 2 - 1;
    }
    return buffer;
  }

  _makePanner(x, y, z, destination, refDistance = 3.5) {
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = refDistance;
    panner.maxDistance = 36;
    panner.rolloffFactor = 0.65;
    if (panner.positionX) {
      panner.positionX.value = x;
      panner.positionY.value = y;
      panner.positionZ.value = z;
    } else {
      panner.setPosition(x, y, z);
    }
    panner.connect(destination);
    return panner;
  }

  _startContinuousSources() {
    const ctx = this.ctx;

    this.waterPanner = this._makePanner(-3.6, 1.6, 0, this.ambienceGain, 4.2);
    const waterSource = ctx.createBufferSource();
    waterSource.buffer = this._noiseBuffer;
    waterSource.loop = true;
    const waterFilter = ctx.createBiquadFilter();
    waterFilter.type = 'bandpass';
    waterFilter.frequency.value = 360;
    waterFilter.Q.value = 0.55;
    const waterGain = ctx.createGain();
    waterGain.gain.value = 0.0001;
    waterSource.connect(waterFilter);
    waterFilter.connect(waterGain);
    waterGain.connect(this.waterPanner);

    this.turbinePanner = this._makePanner(0, 1.45, 0, this.ambienceGain, 3.2);
    const turbine = ctx.createOscillator();
    turbine.type = 'triangle';
    turbine.frequency.value = 34;
    const turbineHarmonic = ctx.createOscillator();
    turbineHarmonic.type = 'sine';
    turbineHarmonic.frequency.value = 68;
    const turbineHarmonicGain = ctx.createGain();
    turbineHarmonicGain.gain.value = 0.22;
    const turbineFilter = ctx.createBiquadFilter();
    turbineFilter.type = 'lowpass';
    turbineFilter.frequency.value = 720;
    turbineFilter.Q.value = 0.7;
    const turbineGain = ctx.createGain();
    turbineGain.gain.value = 0.0001;
    turbine.connect(turbineFilter);
    turbineHarmonic.connect(turbineHarmonicGain);
    turbineHarmonicGain.connect(turbineFilter);
    turbineFilter.connect(turbineGain);
    turbineGain.connect(this.turbinePanner);

    this.generatorPanner = this._makePanner(2.9, 1.35, 0, this.ambienceGain, 3.4);
    const generator = ctx.createOscillator();
    generator.type = 'triangle';
    generator.frequency.value = 58;
    const generatorHarmonic = ctx.createOscillator();
    generatorHarmonic.type = 'sine';
    generatorHarmonic.frequency.value = 116.58;
    const generatorHarmonicGain = ctx.createGain();
    generatorHarmonicGain.gain.value = 0.18;
    const generatorFilter = ctx.createBiquadFilter();
    generatorFilter.type = 'lowpass';
    generatorFilter.frequency.value = 920;
    generatorFilter.Q.value = 0.55;
    const generatorGain = ctx.createGain();
    generatorGain.gain.value = 0.0001;
    generator.connect(generatorFilter);
    generatorHarmonic.connect(generatorHarmonicGain);
    generatorHarmonicGain.connect(generatorFilter);
    generatorFilter.connect(generatorGain);
    generatorGain.connect(this.generatorPanner);

    waterSource.start();
    turbine.start();
    turbineHarmonic.start();
    generator.start();
    generatorHarmonic.start();

    this._continuous = {
      waterSource,
      waterFilter,
      waterGain,
      turbine,
      turbineHarmonic,
      turbineGain,
      generator,
      generatorHarmonic,
      generatorGain,
    };
  }

  _bus(name) {
    if (name === 'music') return this.musicGain || this.master;
    if (name === 'ambience') return this.ambienceGain || this.master;
    return this.effectsGain || this.master;
  }

  _tone(frequency, {
    delay = 0,
    gain = 0.05,
    duration = 0.25,
    attack = 0.008,
    endFrequency = null,
    type = 'sine',
    bus = 'effects',
  } = {}) {
    if (!this.ctx) return;
    const start = this.now + Math.max(0, delay);
    const end = start + Math.max(0.04, duration);
    const oscillator = this.ctx.createOscillator();
    const envelope = this.ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), start);
    if (endFrequency !== null) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), end);
    }
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(Math.max(0.0002, gain), start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(envelope);
    envelope.connect(this._bus(bus));
    oscillator.start(start);
    oscillator.stop(end + 0.03);
  }

  _noiseBurst({
    delay = 0,
    duration = 0.2,
    gain = 0.05,
    filter = 'bandpass',
    startFrequency = 900,
    endFrequency = 400,
    q = 0.7,
    bus = 'effects',
  } = {}) {
    if (!this.ctx || !this._noiseBuffer) return;
    const start = this.now + Math.max(0, delay);
    const end = start + Math.max(0.04, duration);
    const source = this.ctx.createBufferSource();
    source.buffer = this._noiseBuffer;
    source.loop = duration > 0.5;
    const biquad = this.ctx.createBiquadFilter();
    biquad.type = filter;
    biquad.Q.value = q;
    biquad.frequency.setValueAtTime(Math.max(30, startFrequency), start);
    biquad.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), end);
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(Math.max(0.0002, gain), start + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(biquad);
    biquad.connect(envelope);
    envelope.connect(this._bus(bus));
    source.start(start, 0);
    source.stop(end + 0.025);
  }

  _metalHit(baseFrequency, delay = 0, gain = 0.08) {
    [1, 2.71, 4.13].forEach((ratio, index) => {
      this._tone(baseFrequency * ratio, {
        delay: delay + index * 0.004,
        gain: gain / (1 + index * 0.8),
        duration: 0.34 + index * 0.09,
        endFrequency: baseFrequency * ratio * 0.94,
        type: index === 0 ? 'triangle' : 'sine',
      });
    });
  }
}
