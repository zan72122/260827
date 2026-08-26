/**
 * Procedural WebAudio sound design — the process is narrated by sound, not
 * music. Everything is synthesized (no assets): belt drive hum, roller seam
 * rhythm that tracks finger speed, curtain rustle, quiet screening interior,
 * the diverter clunk, underground slap-back echo, outdoor wind + distant
 * jet, the loader motor, and short hold floor-roller rumbles.
 * The AudioContext is created on the first pointer gesture.
 */

function zone(p: number, a: number, b: number, feather = 0.03): number {
  const rise = smooth((p - (a - feather)) / feather);
  const fall = 1 - smooth((p - b) / feather);
  return Math.max(0, Math.min(rise, fall));
}
function smooth(t: number): number {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private layers: Record<string, GainNode> = {};
  private rollerPhase = 0;
  private windLfoPhase = 0;
  private windFilter!: BiquadFilterNode;

  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(comp);

    // shared noise buffer (2s white noise)
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const layer = (name: string): GainNode => {
      const gn = ctx.createGain();
      gn.gain.value = 0;
      gn.connect(this.master);
      this.layers[name] = gn;
      return gn;
    };

    // 1) belt drive hum: two detuned saws through a lowpass
    {
      const gn = layer('belt');
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 240;
      lp.connect(gn);
      for (const f of [48, 97.3]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.value = 0.16;
        o.connect(og).connect(lp);
        o.start();
      }
    }
    // slap-back echo bus for the underground hall
    {
      const gn = layer('echo');
      const delay = ctx.createDelay(0.4);
      delay.delayTime.value = 0.13;
      const fb = ctx.createGain();
      fb.gain.value = 0.34;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      this.layers['belt'].connect(delay);
      delay.connect(lp).connect(fb).connect(delay);
      lp.connect(gn);
    }
    // 4) screening interior: quiet 120Hz mains-ish hum
    {
      const gn = layer('screen');
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 119;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 238;
      const og = ctx.createGain();
      og.gain.value = 0.4;
      const og2 = ctx.createGain();
      og2.gain.value = 0.12;
      o.connect(og).connect(gn);
      o2.connect(og2).connect(gn);
      o.start();
      o2.start();
    }
    // 7) wind: filtered noise, slow LFO handled in update()
    {
      const gn = layer('wind');
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'lowpass';
      this.windFilter.frequency.value = 420;
      src.connect(this.windFilter).connect(gn);
      src.start();
    }
    // 8) distant jet: heavy-lowpassed noise
    {
      const gn = layer('jet');
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      src.playbackRate.value = 0.4;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 140;
      src.connect(lp).connect(gn);
      src.start();
    }
    // 9) loader motor: saw with AM wobble
    {
      const gn = layer('loader');
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 83;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 480;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 6.5;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.25;
      lfo.connect(lfoG).connect(am.gain);
      o.connect(lp).connect(am).connect(gn);
      o.start();
      lfo.start();
    }

    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  /** short one-shot noise burst through a bandpass */
  private burst(freq: number, q: number, dur: number, gain: number, rate = 1): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rate;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.2, dur + 0.05);
    src.stop(t + dur + 0.1);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  trigger(name: 'rustle' | 'flap' | 'clunk' | 'beep' | 'shutter' | 'thud' | 'holdRoll', intensity = 1): void {
    if (!this.ctx) return;
    switch (name) {
      case 'rustle': // heavy rubber strips over the shell
        this.burst(520, 0.8, 0.34, 0.5 * intensity, 0.8);
        this.burst(1150, 1.2, 0.22, 0.25 * intensity, 1.1);
        break;
      case 'flap': // small lead flaps
        this.burst(700, 1.0, 0.18, 0.3 * intensity, 0.9);
        break;
      case 'clunk': // diverter throw
        this.tone(72, 0.28, 0.7);
        this.burst(210, 1.4, 0.12, 0.55, 0.6);
        break;
      case 'beep': // tag read, deliberately modest
        this.tone(1180, 0.09, 0.12);
        break;
      case 'shutter': // roller shutter
        this.burst(320, 0.9, 0.5, 0.4, 0.5);
        break;
      case 'thud': // bag transfer contact / settling
        this.tone(64, 0.22, 0.5);
        this.burst(160, 1.2, 0.12, 0.3, 0.55);
        break;
      case 'holdRoll': // short floor-roller rumble
        this.burst(260, 1.0, 0.28, 0.35, 0.5);
        break;
    }
  }

  update(p: number, speed: number, dt: number): void {
    if (!this.ctx) return;
    const spd = Math.min(1.4, Math.abs(speed));
    const moving = Math.min(1, spd * 1.4);
    const set = (name: string, v: number) => {
      const g = this.layers[name];
      if (g) g.gain.setTargetAtTime(v, this.ctx!.currentTime, 0.08);
    };

    // belts run indoors and on the loader boom; quieter outdoors
    const beltZone = Math.max(zone(p, 0.0, 0.78, 0.02) * 1.0, zone(p, 0.78, 0.9, 0.02) * 0.55, zone(p, 0.9, 0.975, 0.015) * 0.7);
    set('belt', beltZone * (0.12 + 0.5 * moving));
    set('echo', zone(p, 0.23, 0.72, 0.04) * (0.1 + 0.4 * moving));
    set('screen', zone(p, 0.41, 0.53, 0.02) * 0.5);
    const outdoor = zone(p, 0.785, 0.985, 0.02);
    set('wind', outdoor * 0.5 + zone(p, 0.985, 1.0, 0.01) * 0.06);
    set('jet', outdoor * 0.55);
    set('loader', zone(p, 0.885, 0.975, 0.015) * (0.2 + 0.3 * moving));

    // wind gusts
    this.windLfoPhase += dt * 0.7;
    this.windFilter.frequency.value = 380 + Math.sin(this.windLfoPhase) * 160 + Math.sin(this.windLfoPhase * 2.7) * 60;

    // roller seam rhythm: click rate follows the finger speed
    const rollerZone = Math.max(zone(p, 0.02, 0.42, 0.02), zone(p, 0.54, 0.78, 0.02) * 0.8, zone(p, 0.975, 1.0, 0.01) * 0.9);
    if (rollerZone > 0.05 && spd > 0.02) {
      this.rollerPhase += dt * (2 + spd * 9);
      if (this.rollerPhase >= 1) {
        this.rollerPhase %= 1;
        this.burst(880, 2.2, 0.05, 0.16 * rollerZone * (0.4 + moving * 0.6), 1.3);
      }
    }
  }
}
