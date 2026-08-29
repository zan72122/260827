import { makeRng, rand, clamp } from './rng.js';

// ドーム内部は半径 R=100 の球。粒子は 3D で動かし、描画時に手前/奥へ振り分ける。
// これで「手前の粒は大きくはっきり、奥の粒は液体越しに沈んで見える」奥行きが出る。
export const R = 100;
export const FLOOR = R * 0.58;          // 内部の床(台座の上面)
export const FLOOR_R = Math.sqrt(R * R - FLOOR * FLOOR) * 0.99;
export const BINS = 11;                        // 積もりの高さマップ(BINS x BINS)

export class Dome {
  constructor(particle, liquid, seed = 1) {
    this.setRecipe(particle, liquid, seed);
  }

  setRecipe(particle, liquid, seed = 1) {
    this.mat = particle;
    this.liq = liquid;
    this.rng = makeRng(seed * 7919 + 13);
    this.list = [];
    this.pile = new Float32Array(BINS * BINS);
    this.spin = 0;        // 縦軸まわりの渦
    this.slosh = { x: 0, y: 0, z: 0 };
    this.energy = 0;      // 揺れの強さ(0..1超)
    this.fill = 0;        // 入っている粒の割合 0..1
    this.liquidLevel = 0; // 液体の高さ 0..1
    this.time = 0;
    this.fizzBubbles = [];
    this.settledAt = -1;
  }

  get capacity() { return this.mat ? this.mat.count : 0; }

  // 瓶から少しずつ注ぐ。open=true(フタを開けた状態)では空気中を落ちる。
  addParticles(n) {
    const m = this.mat;
    if (!m) return;
    const rng = this.rng;
    for (let i = 0; i < n && this.list.length < m.count; i++) {
      const a = rng() * Math.PI * 2;
      const rad = rng() * R * 0.30;
      this.list.push({
        x: Math.cos(a) * rad,
        y: -R * rand(rng, 0.95, 1.25),      // 口の上から落ちてくる
        z: Math.sin(a) * rad,
        vx: rand(rng, -6, 6), vy: rand(rng, 10, 34), vz: rand(rng, -6, 6),
        size: rand(rng, m.size[0], m.size[1]),
        ci: Math.floor(rng() * m.colors.length),
        rot: rng() * Math.PI * 2,
        rotV: rand(rng, -1, 1) * m.spin,
        phase: rng() * Math.PI * 2,
        freq: rand(rng, m.flutterFreq[0], m.flutterFreq[1]),
        rest: false,
        sinkK: rand(rng, 0.70, 1.38),   // 一粒ずつ重さが違う
        // 浮く素材はそれぞれ止まる高さが違う。全部が天井に張りつくと見えない。
        ceilY: -R * rand(rng, 0.20, 0.84),
        px: 0, py: 0, pz: 0,
        flashPhase: rng() * Math.PI * 2,
      });
    }
    this.fill = this.list.length / m.count;
  }

  binIndex(x, z) {
    const bx = clamp(Math.floor(((x / FLOOR_R) * 0.5 + 0.5) * BINS), 0, BINS - 1);
    const bz = clamp(Math.floor(((z / FLOOR_R) * 0.5 + 0.5) * BINS), 0, BINS - 1);
    return bz * BINS + bx;
  }

  // x位置ごとの積もりの高さ(手前から見た稜線)
  pileProfile() {
    const out = new Float32Array(BINS);
    for (let bx = 0; bx < BINS; bx++) {
      let h = 0;
      for (let bz = 0; bz < BINS; bz++) h = Math.max(h, this.pile[bz * BINS + bx]);
      out[bx] = h;
    }
    return out;
  }

  pileAt(x, z) {
    const i = this.binIndex(x, z);
    return this.pile[i];
  }

  addPile(x, z, amount, flat) {
    const i = this.binIndex(x, z);
    // 平らに積もる素材(粉雪)は周囲へ分配し、山になる素材(砂)は真下に積む。
    const share = flat * 0.6;
    this.pile[i] += amount * (1 - share);
    if (share > 0) {
      const bx = i % BINS, bz = (i / BINS) | 0;
      let n = 0; const nb = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = bx + dx, nz = bz + dz;
        if (nx < 0 || nz < 0 || nx >= BINS || nz >= BINS) continue;
        nb.push(nz * BINS + nx); n++;
      }
      for (const k of nb) this.pile[k] += (amount * share) / n;
    }
  }

  // ふる。強さ 0..1、向き dir(-1..1)。
  shake(strength, dir = 1) {
    const g = this.liq ? this.liq.swirlGain : 1;
    this.spin += strength * 5.2 * dir * g;
    this.slosh.x += strength * 120 * dir * g;
    this.slosh.y = Math.max(-70, this.slosh.y - strength * 22);
    this.energy = Math.min(2.2, this.energy + strength * 1.35);
    this.settledAt = -1;
  }

  get isSettled() {
    if (!this.list.length) return false;
    if (this.energy > 0.03) return false;
    let moving = 0;
    for (const p of this.list) if (!p.rest) moving++;
    return moving < Math.max(1, this.list.length * 0.02);
  }

  update(dt, opts = {}) {
    // 液体が入ったとたんに落ち方が変わる。これがこのゲームの最初の「発見」。
    const inLiquid = this.liquidLevel > 0.15;
    const m = this.mat, L = this.liq;
    if (!m) return;
    dt = Math.min(dt, 1 / 30);
    this.time += dt;

    const decay = inLiquid ? L.decay : 2.6;
    this.spin *= Math.exp(-decay * 1.05 * dt);
    this.slosh.x *= Math.exp(-decay * 1.6 * dt);
    this.slosh.y *= Math.exp(-decay * 2.2 * dt);
    this.energy *= Math.exp(-decay * 1.15 * dt);
    if (Math.abs(this.spin) < 0.004) this.spin = 0;
    if (this.energy < 0.006) this.energy = 0;

    // 液体の中と空気中でまったく違う落ち方をする。
    const sinkScale = inLiquid ? L.sinkScale : 5.0;
    const follow = (inLiquid ? m.follow * L.followScale : m.follow * 0.35);
    const flutterAmp = m.flutter * (inLiquid ? (1.3 - L.followScale * 0.28) : 0.35);
    const fizz = inLiquid ? L.fizz : 0;
    const sink = m.sink * sinkScale;
    const liftGate = m.lift;

    for (const p of this.list) {
      p.px = p.x; p.py = p.y; p.pz = p.z;

      if (p.rest) {
        // 揺れが素材ごとのしきい値を超えたときだけ舞い上がる。
        // 一斉にではなく、積もったところが少しずつ崩れるように舞い上げる。
        // (全部を同時に持ち上げると、粒が一枚の板のまま動いてしまう)
        if (this.energy > liftGate &&
            this.rng() < 1 - Math.exp(-(this.energy - liftGate) * 13 * dt)) {
          p.rest = false;
          this.addPile(p.x, p.z, -p.size * m.pack * 0.09, m.pileFlat);
          const k = (this.energy - liftGate) * 26 / Math.max(0.4, m.sink * 0.06 + 1);
          p.vy -= k * (0.35 + this.rng() * 1.5);
          p.vx += (this.rng() - 0.5) * k * 1.8;
          p.vz += (this.rng() - 0.5) * k * 1.8;
        } else {
          continue;
        }
      }

      // 目標速度 = 渦 + ゆれ + 沈み(または浮き)
      // 渦は中心ほど速く、上ほど強い。剛体のように回すと雲がほぐれない。
      const rr2 = (p.x * p.x + p.z * p.z) / (R * R);
      const w = this.spin * (1 - 0.42 * rr2) * (1 + 0.25 * (-p.y / R));
      let tvx = -w * p.z + this.slosh.x * 0.55;
      let tvz = w * p.x;
      let tvy;
      if (sink < 0) {
        // 浮くものは自分の高さまで上がってそこで漂う(泡がガラスの上半分に散る)
        const v = Math.abs(sink) * p.sinkK;
        tvy = clamp((p.ceilY - p.y) * 2.0, -v * 1.7, v * 0.7) + this.slosh.y * 0.5;
      } else {
        tvy = sink * p.sinkK + this.slosh.y * 0.5;
      }
      // 乱れ。粒ごとに位相が違うので、かたまりがほどけて上下に散らばる。
      if (this.energy > 0.02) {
        const e = Math.min(1.2, this.energy);
        const tw = 20 * e * (0.5 + m.follow * 0.11);
        tvy += Math.sin(this.time * (1.1 + p.freq * 1.7) + p.phase * 2.7) * tw;
        tvx += Math.cos(this.time * (0.9 + p.freq * 1.3) + p.phase * 1.9) * tw * 0.75;
        tvz += Math.sin(this.time * (1.3 + p.freq) + p.phase * 3.3) * tw * 0.75;
        // 不規則な蹴り。かたまりを本当にほどくのはこちら。
        const kick = 130 * e * dt * (0.4 + m.follow * 0.10);
        p.vx += (this.rng() - 0.5) * kick;
        p.vy += (this.rng() - 0.5) * kick * 1.25;
        p.vz += (this.rng() - 0.5) * kick;
      }
      if (fizz) {
        // しゅわしゅわ: 細かい上昇流が粒を持ち上げてふわふわさせる
        tvy -= (12 + Math.sin(this.time * 2.4 + p.phase * 3) * 9) * (0.6 + 0.4 * Math.sin(p.phase));
      }

      const k = 1 - Math.exp(-follow * dt);
      p.vx += (tvx - p.vx) * k;
      p.vy += (tvy - p.vy) * k;
      p.vz += (tvz - p.vz) * k;

      // ひらひら(はなびら・ぼたん雪ほど大きい)
      if (flutterAmp > 0.05) {
        const w = Math.sin(this.time * p.freq * 2.4 + p.phase);
        const w2 = Math.cos(this.time * p.freq * 1.7 + p.phase * 1.7);
        p.vx += w * flutterAmp * 9 * dt * 6;
        p.vz += w2 * flutterAmp * 7 * dt * 6;
        p.rot += w * dt * m.spin * 0.8;
      }

      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.rotV * dt * (1 + Math.min(2.4, Math.abs(this.spin) * 0.5));

      // ガラスの内側
      const rr = Math.hypot(p.x, p.y, p.z);
      const lim = R - p.size * 0.45;
      if (rr > lim) {
        const s = lim / rr;
        p.x *= s; p.y *= s; p.z *= s;
        const nx = p.x / lim, ny = p.y / lim, nz = p.z / lim;
        const dot = p.vx * nx + p.vy * ny + p.vz * nz;
        if (dot > 0) {
          p.vx -= nx * dot * 1.35; p.vy -= ny * dot * 1.35; p.vz -= nz * dot * 1.35;
          p.vx *= 0.72; p.vy *= 0.72; p.vz *= 0.72;
        }
      }

      // 床(浮く素材はここへ来ない)
      const restY = FLOOR - this.pileAt(p.x, p.z) - p.size * 0.42;
      if (p.y > restY && Math.hypot(p.x, p.z) < FLOOR_R) {
        p.y = restY;
        if (this.energy < liftGate * 0.85 && Math.abs(p.vy) < 34) {
          p.rest = true;
          p.vx = p.vy = p.vz = 0;
          this.addPile(p.x, p.z, p.size * m.pack * 0.09, m.pileFlat);
        } else {
          p.vy = -Math.abs(p.vy) * 0.18;
          p.vx *= 0.7; p.vz *= 0.7;
        }
      }
    }

    if (fizz) this.updateFizz(dt);
    if (this.isSettled && this.settledAt < 0) this.settledAt = this.time;
  }

  updateFizz(dt) {
    const rng = this.rng;
    if (this.fizzBubbles.length < 46 && rng() < 0.6) {
      const a = rng() * Math.PI * 2, rad = rng() * R * 0.8;
      this.fizzBubbles.push({
        x: Math.cos(a) * rad, z: Math.sin(a) * rad, y: FLOOR - rng() * 8,
        r: rand(rng, 0.9, 2.6), v: rand(rng, 26, 52), phase: rng() * 6.28,
      });
    }
    for (let i = this.fizzBubbles.length - 1; i >= 0; i--) {
      const b = this.fizzBubbles[i];
      b.y -= b.v * dt;
      b.x += Math.sin(this.time * 3 + b.phase) * 6 * dt;
      if (b.y < -R * 0.72) this.fizzBubbles.splice(i, 1);
    }
  }

  // 見た目の指標(比較モードの矢印/星の数に使う。数値は表示しない)
  metrics() {
    let moving = 0, avgSpeed = 0;
    for (const p of this.list) {
      if (!p.rest) { moving++; avgSpeed += Math.hypot(p.vx, p.vy, p.vz); }
    }
    return {
      moving, total: this.list.length,
      avgSpeed: moving ? avgSpeed / moving : 0,
      energy: this.energy,
    };
  }
}
