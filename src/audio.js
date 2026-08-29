// ごく小さな効果音。合成のみで、外部ファイルを持たない。
// 4歳児がうるさく感じないよう、全体に低め・やわらかめ。
let ctxA = null, master = null, muted = false, noiseBuf = null;

export function initAudio() {
  if (ctxA) { if (ctxA.state === 'suspended') ctxA.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctxA = new AC();
  master = ctxA.createGain();
  master.gain.value = 0.32;
  master.connect(ctxA.destination);
  const n = ctxA.sampleRate * 1.2;
  noiseBuf = ctxA.createBuffer(1, n, ctxA.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
}

export function setMuted(v) { muted = v; if (master) master.gain.value = v ? 0 : 0.32; }
export function isMuted() { return muted; }

function noise(dur, f0, f1, gain, q = 1) {
  if (!ctxA || muted) return null;
  const src = ctxA.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const flt = ctxA.createBiquadFilter();
  flt.type = 'bandpass'; flt.frequency.value = f0; flt.Q.value = q;
  const g = ctxA.createGain();
  const t = ctxA.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  flt.frequency.linearRampToValueAtTime(f1, t + dur);
  src.connect(flt); flt.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.05);
  return { src, g };
}

function tone(freq, dur, gain, type = 'sine', detune = 0) {
  if (!ctxA || muted) return;
  const o = ctxA.createOscillator();
  const g = ctxA.createGain();
  o.type = type; o.frequency.value = freq; o.detune.value = detune;
  const t = ctxA.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.03);
}

let pourVoice = null;
export function pourStart(kind) {
  if (pourVoice) return;
  pourVoice = noise(9, kind === 'liquid' ? 620 : 2600, kind === 'liquid' ? 380 : 2100,
    kind === 'liquid' ? 0.10 : 0.07, kind === 'liquid' ? 1.4 : 0.8);
}
export function pourStop() {
  if (!pourVoice || !ctxA) { pourVoice = null; return; }
  const t = ctxA.currentTime;
  try {
    pourVoice.g.gain.cancelScheduledValues(t);
    pourVoice.g.gain.setValueAtTime(pourVoice.g.gain.value, t);
    pourVoice.g.gain.exponentialRampToValueAtTime(0.0006, t + 0.18);
    pourVoice.src.stop(t + 0.25);
  } catch (e) { /* すでに停止 */ }
  pourVoice = null;
}
export function clink() { tone(1180, 0.5, 0.10, 'sine'); tone(1760, 0.32, 0.05, 'sine', 6); }
export function thunk() { tone(180, 0.22, 0.13, 'sine'); noise(0.16, 260, 120, 0.06, 0.9); }
export function slosh(strength) { noise(0.34, 420 + strength * 300, 200, 0.05 + strength * 0.05, 1.1); }
export function chime() {
  [784, 988, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.75, 0.075, 'sine'), i * 95));
}
export function tap() { tone(560, 0.10, 0.06, 'triangle'); }
