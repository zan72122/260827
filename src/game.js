import { PARTICLES, LIQUIDS, byId, describe } from './materials.js';
import { Dome, R as DR, FLOOR } from './particles.js';
import { drawDome, shapeScale } from './dome_render.js';
import { renderStatic, paintLightWash } from './scene.js';
import { Camera } from './camera.js';
import { getSpriteSet, offscreen } from './sprites.js';
import * as UI from './ui.js';
import * as A from './audio.js';
import { makeRng, rand, clamp, lerp, easeOut } from './rng.js';

const SHELF_KEY = 'material-lab-shelf-v2';
const MAX_SAVED = 12;

// 工程ごとのカメラ。素材選び=中景、注ぐ=接写、ふる=3/4、観察=寄り。
const SHOTS = {
  pick_particle: (L) => [L.W * 0.5, L.H * 0.52, 1.0],
  pour_particle: (L) => [L.domeCx, L.domeCy - L.domeR * 0.55, L.wide ? 1.85 : 1.7],
  pick_liquid:   (L) => [L.W * 0.5, L.H * 0.55, 1.02],
  pour_liquid:   (L) => [L.domeCx, L.domeCy - L.domeR * 0.30, L.wide ? 1.65 : 1.5],
  close:         (L) => [L.domeCx, L.domeCy - L.domeR * 0.62, L.wide ? 1.75 : 1.6],
  shake:         (L) => [L.domeCx, L.domeCy + L.domeR * 0.06, L.wide ? 1.35 : 1.22],
  watch:         (L) => [L.domeCx, L.domeCy + L.domeR * 0.10, L.wide ? 1.55 : 1.42],
  compare:       (L) => [L.W * 0.5, L.H * 0.50, 1.0],
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cam = new Camera();
    this.time = 0;
    this.stage = 'pick_particle';
    this.stageT = 0;
    this.mat = null;
    this.liq = null;
    this.dome = new Dome(null, null, 1);
    this.domeB = null;
    this.compare = false;
    this.activeSide = 'A';
    this.stream = [];
    this.pouring = false;
    this.pourIdle = 0;
    this.holdSince = -1;
    this.releaseAt = -1;
    this.jar = null;          // 手に持っている瓶 {mat|liq, x, y, tilt}
    this.lidT = 0;
    this.shakeVis = { x: 0, y: 0 };
    this.dragging = null;
    this.buttons = [];
    this.shelfOpen = false;
    this.saved = loadShelf();
    this.thumbs = new Map();
    this.static = null;
    this.staticCam = null;
    this.flash = 0;
    this.savedPulse = 0;
    this.muted = false;
    this.hintIndex = 0;
    this.fps = 60; this._fpsAcc = 0; this._fpsN = 0;
    this.cam.onSettle = () => { this.staticDirty = true; };
    this.resize();
    this.gotoStage('pick_particle', true);
  }

  // ---------------------------------------------------------------- layout
  resize() {
    const W = Math.max(280, Math.round(this.canvas.clientWidth || window.innerWidth));
    const H = Math.max(320, Math.round(this.canvas.clientHeight || window.innerHeight));
    this.W = W; this.H = H;
    this.baseDpr = Math.min(2, window.devicePixelRatio || 1);  // 3倍描画は重いので2倍で頭打ち
    if (this.renderScale === undefined) this.renderScale = 1;
    this.applyScale();
    this.L = this.buildLayout(W, H);
    this.staticDirty = true;
    this.thumbs.clear();
    if (this.stage) this.gotoStage(this.stage, true);
  }

  // 描画解像度だけを変える(構図はそのまま)。
  applyScale() {
    const dpr = Math.max(0.75, this.baseDpr * this.renderScale);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.ctx._dpr = dpr;
    this.staticDirty = true;
  }

  // 端末が追いつかないときは描画解像度を下げる。粒の動きを削るより見た目が保てる。
  autoScale(dt) {
    this._ftAcc = (this._ftAcc || 0) + dt;
    this._ftN = (this._ftN || 0) + 1;
    if (this._ftN < 70) return;
    const avg = this._ftAcc / this._ftN;
    this._ftAcc = 0; this._ftN = 0;
    if (!this._warm) { this._warm = true; return; }
    let next = this.renderScale;
    if (avg > 0.0215 && this.renderScale > 0.63) next = this.renderScale - 0.18;
    else if (avg < 0.0125 && this.renderScale < 1) next = Math.min(1, this.renderScale + 0.18);
    if (next !== this.renderScale) {
      this.renderScale = next;
      this.applyScale();
      if (this.onScale) this.onScale();
    }
  }

  buildLayout(W, H) {
    const land = W > H;
    const wide = W > H && W >= 900 && H >= 500;      // iPad 横 → 2台くらべられる
    const L = { W, H, wide, land };
    L.benchTopY = Math.round(H * (land ? 0.40 : 0.44));
    L.shelfY = Math.round(H * (land ? 0.11 : 0.135));
    L.shelfY2 = Math.round(H * (land ? 0.26 : 0.285));
    L.nearY = Math.round(H * (land ? 0.945 : 0.925));
    L.domeR = Math.round(Math.min(W * (land ? 0.175 : 0.30), H * (land ? 0.255 : 0.158)));
    const baseBottom = L.benchTopY + H * (land ? 0.20 : 0.155);
    L.domeCx = Math.round(W * 0.5);
    L.domeCy = Math.round(baseBottom - L.domeR * 1.22);   // 台座の底までを含めた高さ

    // 素材の瓶。狭い画面では奥と手前の2列にして、指で押しやすい大きさを保つ。
    const twoRows = !land && W < 720;
    L.jarRows = twoRows ? 2 : 1;
    const jars = [];
    const n = PARTICLES.length;
    if (twoRows) {
      const per = Math.ceil(n / 2);
      const rows = [
        { y: Math.round(H * 0.735), s: 0.86, count: per },
        { y: Math.round(H * 0.885), s: 1.0, count: n - per },
      ];
      let idx = 0;
      for (const row of rows) {
        const pitch = W / (row.count + 0.35);
        for (let i = 0; i < row.count; i++) {
          const w = Math.min(pitch * 0.82, W * 0.20) * row.s;
          jars.push({
            mat: PARTICLES[idx++], x: Math.round(pitch * (i + 0.68)), y: row.y,
            w, h: w * 1.55, s: row.s,
          });
        }
      }
    } else {
      const pitch = W / (n + 0.4);
      for (let i = 0; i < n; i++) {
        const w = Math.min(pitch * 0.80, H * (land ? 0.165 : 0.13));
        jars.push({
          mat: PARTICLES[i], x: Math.round(pitch * (i + 0.7)),
          y: Math.round(H * (land ? 0.90 : 0.86)), w, h: w * 1.55, s: 1,
        });
      }
    }
    L.jars = jars;

    const bn = LIQUIDS.length;
    const bpitch = W / (bn + 0.6);
    L.bottles = LIQUIDS.map((liq, i) => {
      const w = Math.min(bpitch * 0.62, H * 0.115);
      return {
        liq, x: Math.round(bpitch * (i + 0.8)),
        y: Math.round(H * (land ? 0.88 : 0.845)), w, h: w * 1.9,
      };
    });

    // ボトルの列と重なる瓶に印をつけておく(液体を選ぶ間はそこを空ける)
    const bTop = Math.min(...L.bottles.map((b) => b.y - b.h * 1.02));
    const bBottom = Math.max(...L.bottles.map((b) => b.y + b.h * 0.12));
    for (const j of L.jars) {
      j.hideOnLiquid = (j.y + j.h * 0.12) > bTop && (j.y - j.h * 1.06) < bBottom;
    }

    // 比較モード(iPad横)。2つのドームと、下に小さな素材の棚。
    L.cmp = {
      r: Math.round(Math.min(W * 0.132, H * 0.185)),
      ax: Math.round(W * 0.27), bx: Math.round(W * 0.73),
      stripY: Math.round(H * 0.905),
    };
    L.cmp.cy = Math.round(L.benchTopY + H * 0.075 + L.cmp.r * 0.08);
    L.cmp.tagY = L.cmp.cy + Math.round(L.cmp.r * 1.30);
    return L;
  }

  // ---------------------------------------------------------------- stages
  gotoStage(name, instant = false) {
    this.stage = name;
    this.stageT = 0;
    const shot = SHOTS[name] || SHOTS.pick_particle;
    const [x, y, z] = shot(this.L);
    if (instant) { this.cam.snap(x, y, z); this.staticDirty = true; }
    else this.cam.moveTo(x, y, z, 0.8);
    if (name === 'pour_particle' || name === 'pour_liquid') {
      this.pourIdle = 0; this.releaseAt = -1; this.topping = false;
    }
  }

  newDome() {
    this.mat = null; this.liq = null;
    this.dome = new Dome(null, null, Math.floor(Math.random() * 1000) + 1);
    this.lidT = 0; this.stream.length = 0; this.jar = null; this.shakenOnce = false;
    this.compare = false; this.domeB = null;
    this.gotoStage('pick_particle');
  }

  pickMaterial(mat, side) {
    if (this.compare) {
      const d = side === 'B' ? this.domeB : this.dome;
      const liq = d.liq || byId(LIQUIDS, 'normal');
      d.setRecipe(mat, liq, Math.floor(Math.random() * 900) + 1);
      d.addParticles(mat.count);
      d.liquidLevel = 1;
      d.shake(0.55, side === 'B' ? -1 : 1);
      A.tap();
      return;
    }
    this.mat = mat;
    this.dome.setRecipe(mat, null, Math.floor(Math.random() * 900) + 1);
    this.shakenOnce = false;
    this.jar = { kind: 'jar', mat, x: this.L.domeCx, y: this.L.domeCy - this.L.domeR * 1.35, tilt: 0, t: 0 };
    A.tap();
    this.gotoStage('pour_particle');
  }

  pickLiquid(liq, side) {
    if (this.compare) {
      const d = side === 'B' ? this.domeB : this.dome;
      if (!d.mat) return;
      const keep = d.mat;
      d.setRecipe(keep, liq, Math.floor(Math.random() * 900) + 1);
      d.addParticles(keep.count);
      d.liquidLevel = 1;
      d.shake(0.55, side === 'B' ? -1 : 1);
      A.tap();
      return;
    }
    this.liq = liq;
    this.dome.liq = liq;
    this.jar = { kind: 'bottle', liq, x: this.L.domeCx, y: this.L.domeCy - this.L.domeR * 1.35, tilt: 0, t: 0 };
    A.tap();
    this.gotoStage('pour_liquid');
  }

  closeLid() {
    if (this.stage !== 'close') return;
    this.closing = true;
    A.tap();
  }

  enterCompare() {
    if (!this.L.wide || !this.mat) return;
    this.compare = true;
    this.activeSide = 'A';
    const other = this.saved.find((s) => s.p !== this.mat.id) ||
      { p: PARTICLES.find((p) => p.id !== this.mat.id).id, l: 'thick' };
    this.domeB = new Dome(byId(PARTICLES, other.p), byId(LIQUIDS, other.l), 77);
    this.domeB.addParticles(this.domeB.mat.count);
    this.domeB.liquidLevel = 1;
    this.dome.liquidLevel = 1;
    this.lidT = 1;
    this.gotoStage('compare');
  }

  exitCompare() {
    this.compare = false;
    this.domeB = null;
    this.gotoStage('watch');
  }

  saveCurrent() {
    const d = this.compare && this.activeSide === 'B' ? this.domeB : this.dome;
    if (!d.mat || !d.liq) return;
    const key = `${d.mat.id}|${d.liq.id}`;
    this.saved = this.saved.filter((s) => `${s.p}|${s.l}` !== key);
    this.saved.unshift({ p: d.mat.id, l: d.liq.id, t: Date.now() });
    if (this.saved.length > MAX_SAVED) this.saved.length = MAX_SAVED;
    storeShelf(this.saved);
    this.savedPulse = 1;
    A.chime();
  }

  loadRecipe(rec, side) {
    const mat = byId(PARTICLES, rec.p), liq = byId(LIQUIDS, rec.l);
    if (this.compare) {
      const d = side === 'B' ? this.domeB : this.dome;
      d.setRecipe(mat, liq, Math.floor(Math.random() * 900) + 1);
      d.addParticles(mat.count); d.liquidLevel = 1;
      d.shake(0.5, side === 'B' ? -1 : 1);
    } else {
      this.mat = mat; this.liq = liq;
      this.dome.setRecipe(mat, liq, Math.floor(Math.random() * 900) + 1);
      this.dome.addParticles(mat.count);
      this.dome.liquidLevel = 1;
      this.lidT = 1;
      this.dome.shake(0.5, 1);
      this.gotoStage('watch');
    }
    this.shelfOpen = false;
    A.tap();
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    this.time += dt;
    this.stageT += dt;
    this.cam.update(dt);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.savedPulse = Math.max(0, this.savedPulse - dt * 0.8);

    if (this.stage === 'pour_particle') this.updatePourParticle(dt);
    else if (this.stage === 'pour_liquid') this.updatePourLiquid(dt);
    else if (this.stage === 'close') this.updateClose(dt);

    if (this.jar) {
      this.jar.t = Math.min(1, this.jar.t + dt * 2.6);
      const want = this.pouring ? 1 : 0;
      this.jar.tilt = lerp(this.jar.tilt, want, 1 - Math.exp(-9 * dt));
    }

    // ふれた分だけドームが揺れて見える(手の動きと画面が一致する)
    this.shakeVis.x = lerp(this.shakeVis.x, 0, 1 - Math.exp(-10 * dt));
    this.shakeVis.y = lerp(this.shakeVis.y, 0, 1 - Math.exp(-10 * dt));

    this.updateStream(dt);
    this.dome.update(dt);
    if (this.domeB) this.domeB.update(dt);

    // ふる工程は「一度ふるまで」待つ。何もしていないのに観察へ進んだりしない。
    if (this.dome.energy > 0.5) this.shakenOnce = true;
    if (this.stage === 'shake' && this.shakenOnce && !this.dragging
        && this.dome.energy < 0.40 && this.stageT > 0.7) {
      this.gotoStage('watch');
    }
    if (this.stage === 'watch' && this.dome.settledAt >= 0 && !this._chimed) {
      this._chimed = true;
    }
    if (this.stage !== 'watch') this._chimed = false;

    this.autoScale(dt);
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc > 0.5) { this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }
  }

  updatePourParticle(dt) {
    const d = this.dome;
    if (this.pouring) {
      this.pourIdle = 0;
      if (this.jar && this.jar.tilt > 0.45 && d.list.length < d.capacity) {
        this.spawnStream(dt, 'particle');
      }
    } else {
      this.pourIdle += dt;
      // 迷って手が止まったら、瓶がひとりでに少しだけ傾いて「ここだよ」と示す
      if (this.pourIdle > 2.6 && d.list.length < d.capacity * 0.9) {
        this.jar.tilt = lerp(this.jar.tilt, 0.75, 1 - Math.exp(-3 * dt));
        if (this.jar.tilt > 0.45) this.spawnStream(dt * 0.55, 'particle');
      }
    }
    const filled = d.list.length / Math.max(1, d.capacity);
    if (filled >= 0.995) { this.finishPourParticle(); return; }
    if (!this.pouring && filled > 0.35) {
      if (this.releaseAt < 0) this.releaseAt = this.time;
      else if (this.time - this.releaseAt > 1.1 && this.stream.length === 0) this.finishPourParticle();
    } else if (this.pouring) this.releaseAt = -1;
  }

  finishPourParticle() {
    A.pourStop();
    this.pouring = false;
    this.jar = null;
    this.gotoStage('pick_liquid');
  }

  updatePourLiquid(dt) {
    const d = this.dome;
    const rate = 0.42 * (this.liq ? this.liq.pourRate : 1);
    let flowing = this.pouring;
    if (!this.pouring) {
      this.pourIdle += dt;
      if (this.pourIdle > 2.0 && d.liquidLevel < 0.9) {
        this.jar.tilt = lerp(this.jar.tilt, 0.8, 1 - Math.exp(-3 * dt));
        flowing = this.jar.tilt > 0.45;
      }
    } else { this.pourIdle = 0; }
    if (flowing && this.jar && this.jar.tilt > 0.4) {
      d.liquidLevel = Math.min(1, d.liquidLevel + dt * rate);
      this.liquidJet = 1;
    } else {
      this.liquidJet = Math.max(0, (this.liquidJet || 0) - dt * 3);
    }
    if (d.liquidLevel >= 0.999) { this.finishPourLiquid(); return; }
    if (this.topping) {
      // 注ぎ終わったあと、残りは静かに満たされる(空気の残ったドームにはしない)
      d.liquidLevel = Math.min(1, d.liquidLevel + dt * 0.75);
      if (d.liquidLevel >= 0.999) this.finishPourLiquid();
      return;
    }
    if (!this.pouring && d.liquidLevel > 0.55) {
      if (this.releaseAt < 0) this.releaseAt = this.time;
      else if (this.time - this.releaseAt > 1.1) this.topping = true;
    } else if (this.pouring) this.releaseAt = -1;
  }

  finishPourLiquid() {
    A.pourStop();
    this.topping = false;
    this.dome.liquidLevel = 1;
    this.pouring = false;
    this.jar = null;
    this.liquidJet = 0;
    this.gotoStage('close');
  }

  updateClose(dt) {
    if (this.closing) {
      this.lidT = Math.min(1, this.lidT + dt * 2.4);
      if (this.lidT >= 1) {
        this.closing = false;
        A.thunk();
        this.gotoStage('shake');
      }
    }
  }

  spawnStream(dt, kind) {
    const L = this.L;
    const jar = this.jar;
    if (!jar) return;
    const rate = kind === 'particle' ? 130 : 0;
    this._streamAcc = (this._streamAcc || 0) + dt * rate;
    const mouth = this.jarMouth();
    while (this._streamAcc >= 1) {
      this._streamAcc -= 1;
      if (this.dome.list.length + this.stream.length >= this.dome.capacity) break;
      const m = this.mat;
      this.stream.push({
        x: mouth.x + rand(Math.random, -L.domeR * 0.05, L.domeR * 0.05),
        y: mouth.y,
        vx: Math.cos(jar.tilt * 0.6) * rand(Math.random, -12, 12) + 20 * jar.tilt,
        vy: rand(Math.random, 30, 90),
        rot: Math.random() * 6.28,
        rotV: rand(Math.random, -4, 4),
        ci: Math.floor(Math.random() * m.colors.length),
        size: rand(Math.random, m.size[0], m.size[1]) * (L.domeR / DR) * shapeScale(m.shape),
      });
    }
  }

  jarMouth() {
    const L = this.L, jar = this.jar;
    if (!jar) return { x: L.domeCx, y: L.domeCy - L.domeR };
    const w = L.domeR * 0.62;
    const a = jar.tilt * 1.15;
    return {
      x: jar.x + Math.sin(a) * w * 0.9 + w * 0.1,
      y: jar.y + Math.cos(a) * w * 0.35 + w * 0.30,
    };
  }

  updateStream(dt) {
    const L = this.L;
    const neckY = L.domeCy - L.domeR * 0.95;
    for (let i = this.stream.length - 1; i >= 0; i--) {
      const s = this.stream[i];
      s.vy += 900 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.rot += s.rotV * dt;
      // くびに吸い込まれるように少し寄せる
      s.x = lerp(s.x, L.domeCx, Math.min(1, dt * 3.2));
      if (s.y >= neckY) {
        this.stream.splice(i, 1);
        this.dome.addParticles(1);
      } else if (s.y > L.H * 2) this.stream.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- input
  pointerDown(sx, sy) {
    A.initAudio();
    const btn = this.hitButton(sx, sy);
    if (btn) { this.pressed = btn.id; return; }
    if (this.shelfOpen) { this.hitShelfItem(sx, sy); return; }

    const w = this.cam.toWorld(sx, sy, this.W, this.H);
    if (this.compare) return this.compareDown(sx, sy, w);

    if (this.stage === 'pick_particle') {
      const jar = this.hitJar(w.x, w.y);
      if (jar) this.pickMaterial(jar.mat);
      return;
    }
    if (this.stage === 'pick_liquid') {
      const b = this.hitBottle(w.x, w.y);
      if (b) this.pickLiquid(b.liq);
      return;
    }
    if (this.stage === 'pour_particle' || this.stage === 'pour_liquid') {
      this.pouring = true;
      this.dragging = { kind: 'pour', x: sx, y: sy };
      A.pourStart(this.stage === 'pour_liquid' ? 'liquid' : 'dry');
      return;
    }
    if (this.stage === 'close') {
      this.closeLid();
      return;
    }
    if (this.stage === 'shake' || this.stage === 'watch') {
      if (this.stage === 'watch') this.gotoStage('shake');
      this.dragging = { kind: 'shake', x: sx, y: sy, lastX: sx, t: this.time };
      return;
    }
  }

  compareDown(sx, sy, w) {
    const L = this.L, C = L.cmp;
    const strip = this.compareStrip();
    for (const it of strip.jars) {
      if (Math.abs(sx - it.x) < it.w * 0.62 && sy > it.y - it.h && sy < it.y + it.h * 0.2) {
        this.pickMaterial(it.mat, this.activeSide); return;
      }
    }
    for (const it of strip.bottles) {
      if (Math.abs(sx - it.x) < it.w * 0.62 && sy > it.y - it.h && sy < it.y + it.h * 0.2) {
        this.pickLiquid(it.liq, this.activeSide); return;
      }
    }
    const s = this.cam.toScreen(C.ax, C.cy, this.W, this.H);
    const s2 = this.cam.toScreen(C.bx, C.cy, this.W, this.H);
    const rr = C.r * this.cam.zoom * 1.25;
    if (Math.hypot(sx - s.x, sy - s.y) < rr) this.activeSide = 'A';
    else if (Math.hypot(sx - s2.x, sy - s2.y) < rr) this.activeSide = 'B';
    this.dragging = { kind: 'shake', x: sx, y: sy, lastX: sx, t: this.time };
  }

  pointerMove(sx, sy) {
    const d = this.dragging;
    if (!d) return;
    if (d.kind === 'pour') {
      // 指を横に動かすと注ぐ位置がずれる。傾け続けている感触を出す。
      if (this.jar) {
        const target = clamp(this.L.domeCx + (sx - d.x) * 0.5,
          this.L.domeCx - this.L.domeR * 0.7, this.L.domeCx + this.L.domeR * 0.7);
        this.jar.x = lerp(this.jar.x, target, 0.25);
      }
      return;
    }
    if (d.kind === 'shake') {
      const dx = sx - d.lastX;
      d.lastX = sx;
      const R = this.L.domeR;
      if (Math.abs(dx) > 0.4) {
        const strength = clamp(Math.abs(dx) / (R * 1.6), 0, 0.30);
        const dir = Math.sign(dx);
        this.dome.shake(strength, dir);
        if (this.domeB) this.domeB.shake(strength, dir);
        this.shakeVis.x = clamp(this.shakeVis.x + dx * 0.35, -R * 0.22, R * 0.22);
        this.shakeVis.y = -Math.abs(this.shakeVis.x) * 0.12;
        if (strength > 0.10 && this.time - (this._lastSlosh || 0) > 0.16) {
          this._lastSlosh = this.time;
          A.slosh(strength * 3);
        }
      }
    }
  }

  pointerUp(sx, sy) {
    const btn = this.hitButton(sx, sy);
    if (this.pressed && btn && btn.id === this.pressed) this.activateButton(btn);
    this.pressed = null;
    if (this.pouring) { this.pouring = false; A.pourStop(); }
    this.dragging = null;
  }

  activateButton(btn) {
    A.tap();
    switch (btn.id) {
      case 'shake': this.gotoStage('shake'); this.dome.shake(0.5, 1); if (this.domeB) this.domeB.shake(0.5, -1); A.slosh(0.6); break;
      case 'save': this.saveCurrent(); break;
      case 'new': this.newDome(); break;
      case 'compare': this.compare ? this.exitCompare() : this.enterCompare(); break;
      case 'shelf': this.shelfOpen = !this.shelfOpen; break;
      case 'sound': this.muted = !this.muted; A.setMuted(this.muted); break;
      case 'closeShelf': this.shelfOpen = false; break;
      default: break;
    }
  }

  hitJar(wx, wy) {
    for (const j of this.L.jars) {
      if (Math.abs(wx - j.x) < j.w * 0.62 && wy > j.y - j.h * 1.05 && wy < j.y + j.h * 0.16) return j;
    }
    return null;
  }
  hitBottle(wx, wy) {
    for (const b of this.L.bottles) {
      if (Math.abs(wx - b.x) < b.w * 0.70 && wy > b.y - b.h * 1.05 && wy < b.y + b.h * 0.16) return b;
    }
    return null;
  }
  hitButton(sx, sy) {
    for (const b of this.buttons) {
      if (Math.hypot(sx - b.x, sy - b.y) < b.r * 1.25) return b;
    }
    return null;
  }
  hitShelfItem(sx, sy) {
    for (const it of (this.shelfItems || [])) {
      if (sx > it.x - it.w / 2 && sx < it.x + it.w / 2 && sy > it.y - it.h && sy < it.y + it.h * 0.2) {
        this.loadRecipe(it.rec, this.activeSide);
        return;
      }
    }
  }

  compareStrip() {
    const L = this.L, y = L.cmp.stripY;
    const n = PARTICLES.length, m = LIQUIDS.length;
    const total = n + m + 1;
    const pitch = L.W / (total + 0.5);
    const jars = PARTICLES.map((mat, i) => ({
      mat, x: pitch * (i + 0.8), y, w: pitch * 0.70, h: pitch * 0.98,
    }));
    const bottles = LIQUIDS.map((liq, i) => ({
      liq, x: pitch * (n + 1.4 + i), y, w: pitch * 0.56, h: pitch * 0.98,
    }));
    return { jars, bottles, y, pitch };
  }
}

// -------------------------------------------------------------------- store
function loadShelf() {
  try {
    const raw = localStorage.getItem(SHELF_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => s && s.p && s.l).slice(0, MAX_SAVED) : [];
  } catch (e) { return []; }
}
function storeShelf(arr) {
  try { localStorage.setItem(SHELF_KEY, JSON.stringify(arr)); } catch (e) { /* 保存できなくても遊べる */ }
}

export { loadShelf, storeShelf };
