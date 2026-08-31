// 小さなアニメーション基盤：タイマーと補間トラックだけ。
// ゲーム全体の演出はここに積んで、毎フレーム update(dt) で進める。

const timers = [];
const tracks = [];

export const Ease = {
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => t * (2 - t),
  inOutQuad: t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inCubic: t => t * t * t,
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: t => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2),
  outElastic: t => {
    if (t === 0 || t === 1) return t;
    const p = 0.34;
    return Math.pow(2, -9 * t) * Math.sin(((t - p / 4) * (2 * Math.PI)) / p) + 1;
  },
  outBounceSoft: t => {
    const k = 1 - Math.pow(1 - t, 2.4);
    return k + Math.sin(t * Math.PI * 2) * 0.055 * (1 - t);
  },
};

/** delay 秒後に一度だけ呼ぶ。戻り値の handle は cancel() できる。 */
export function after(delay, fn) {
  const h = { t: delay, fn, dead: false };
  timers.push(h);
  return h;
}

/** dur 秒かけて fn(k) を 0→1 で呼ぶ。tag を付けると同 tag の古いトラックを止める。 */
export function track(dur, fn, opts = {}) {
  const { ease = Ease.inOutCubic, delay = 0, onDone = null, tag = null } = opts;
  if (tag) killTag(tag);
  const h = { t: -delay, dur, fn, ease, onDone, tag, dead: false, started: false };
  tracks.push(h);
  return h;
}

export function killTag(tag) {
  for (const t of tracks) if (t.tag === tag) t.dead = true;
}

export function clearAll() {
  timers.length = 0;
  tracks.length = 0;
}

export function updateAnim(dt) {
  for (let i = timers.length - 1; i >= 0; i--) {
    const h = timers[i];
    if (h.dead) { timers.splice(i, 1); continue; }
    h.t -= dt;
    if (h.t <= 0) { timers.splice(i, 1); h.fn(); }
  }
  for (let i = tracks.length - 1; i >= 0; i--) {
    const h = tracks[i];
    if (h.dead) { tracks.splice(i, 1); continue; }
    h.t += dt;
    if (h.t < 0) continue;
    if (!h.started) { h.started = true; h.fn(h.ease(0), 0); }
    const raw = Math.min(1, h.t / h.dur);
    h.fn(h.ease(raw), raw);
    if (raw >= 1) { tracks.splice(i, 1); if (h.onDone) h.onDone(); }
  }
}

/** フレームレート非依存の指数ダンピング */
export function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function dampVec(vec, target, lambda, dt) {
  const k = 1 - Math.exp(-lambda * dt);
  vec.x += (target.x - vec.x) * k;
  vec.y += (target.y - vec.y) * k;
  vec.z += (target.z - vec.z) * k;
  return vec;
}
