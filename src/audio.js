// 効果音はすべて合成。外部ファイルなし、最初のタッチで解錠。
let ctx = null;
let master = null;
let muted = false;

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.85;
  master.connect(ctx.destination);
  if (ctx.state === 'suspended') ctx.resume();
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.85, ctx.currentTime, 0.02);
}
export function isMuted() { return muted; }

function env(node, t0, a, d, peak = 1) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  node.connect(g);
  g.connect(master);
  return g;
}

function tone(freq, t0, a, d, peak, type = 'sine', detune = 0) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (detune) o.detune.setValueAtTime(detune, t0);
  env(o, t0, a, d, peak);
  o.start(t0);
  o.stop(t0 + a + d + 0.05);
  return o;
}

function noise(dur) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

export function sfxPick() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(430, t);
  o.frequency.exponentialRampToValueAtTime(880, t + 0.09);
  env(o, t, 0.008, 0.13, 0.22);
  o.start(t); o.stop(t + 0.2);
  tone(1320, t + 0.02, 0.006, 0.09, 0.07, 'triangle');
}

export function sfxInk() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = noise(0.24);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(700, t);
  bp.frequency.exponentialRampToValueAtTime(2200, t + 0.2);
  bp.Q.value = 1.6;
  src.connect(bp);
  env(bp, t, 0.02, 0.22, 0.16);
  src.start(t);
  tone(180, t, 0.01, 0.16, 0.10, 'sine');
}

export function sfxPress() {
  if (!ctx) return;
  const t = ctx.currentTime;
  // 低い「どん」＋紙のかさっ
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(190, t);
  o.frequency.exponentialRampToValueAtTime(72, t + 0.16);
  env(o, t, 0.006, 0.22, 0.42);
  o.start(t); o.stop(t + 0.3);

  const src = noise(0.13);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1500;
  src.connect(hp);
  env(hp, t, 0.004, 0.12, 0.10);
  src.start(t);
}

export function sfxReveal(step = 0) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const scale = [523.25, 659.25, 783.99, 987.77, 1174.66];
  for (let i = 0; i < 3; i++) {
    const f = scale[(step + i) % scale.length] * (i === 2 ? 2 : 1);
    tone(f, t + i * 0.075, 0.01, 0.42, 0.13, 'sine');
    tone(f * 2, t + i * 0.075, 0.01, 0.20, 0.035, 'triangle');
  }
}

export function sfxCollect() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 4; i++) {
    tone(1400 + i * 420, t + i * 0.045, 0.006, 0.16, 0.055, 'sine');
  }
  const src = noise(0.3);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.9;
  src.connect(bp);
  env(bp, t, 0.03, 0.26, 0.055);
  src.start(t);
}

export function sfxSlide() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = noise(0.38);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(900, t);
  bp.frequency.exponentialRampToValueAtTime(2600, t + 0.3);
  bp.Q.value = 0.7;
  src.connect(bp);
  env(bp, t, 0.05, 0.3, 0.075);
  src.start(t);
}

export function sfxPlace() {
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(300, t, 0.006, 0.12, 0.14, 'sine');
  const src = noise(0.09);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1200;
  src.connect(lp);
  env(lp, t, 0.004, 0.08, 0.07);
  src.start(t);
}
