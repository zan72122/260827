// 自由配置システム＋星ボタン：アーチ／テーブル／吊り飾りの各フェーズ共通。
// タップした「正確な位置」に花を置かせ、最低数に達すると金色の星ボタンが現れて
// 押すと次フェーズへ。上限数に達すると星を押さなくても自動で完了する。
// 文字・数字は一切描かない（記号としての星のみ）。

import * as THREE from 'three';

// 星ボタンはカメラ右下・カメラから1.2m前方のレイ上に常駐
const STAR_NDC = new THREE.Vector2(0.72, -0.72);
const STAR_DIST = 1.2;
// タップ判定半径：viewport短辺の9%
const TAP_RADIUS_RATIO = 0.09;
// 星の見た目まわり
const STAR_BASE_SCALE = 0.32;
const STAR_POP_DUR = 0.4;
const STAR_PULSE_SPEED = 3.0;
const STAR_PULSE_AMP = 0.12;
// ヒントグロー（min未達の間、置き場所を光らせて誘導する）
const HINT_BASE_SCALE = 0.35;
const HINT_IDLE_AFTER = 7;   // 秒：これ以上操作がないとパルスを強める
const HINT_IDLE_BOOST = 1.6;

// ---------- 星ボタンの見た目（canvas 2D） ----------

// 金色の5角星＋光輪グラデーション。文字・数字は描かない。
function makeStarTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const cx = size / 2, cy = size / 2;

  // 光輪（放射グラデーション）
  const halo = g.createRadialGradient(cx, cy, size * 0.06, cx, cy, size * 0.5);
  halo.addColorStop(0, 'rgba(255,248,214,0.95)');
  halo.addColorStop(0.4, 'rgba(255,214,120,0.4)');
  halo.addColorStop(1, 'rgba(255,214,120,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, size, size);

  // 5角星（塗り）
  const spikes = 5;
  const outerR = size * 0.32;
  const innerR = outerR * 0.42;
  g.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = (i % 2 === 0) ? outerR : innerR;
    const a = -Math.PI / 2 + (i * Math.PI) / spikes;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  const starGrad = g.createLinearGradient(cx, cy - outerR, cx, cy + outerR);
  starGrad.addColorStop(0, '#fff8d6');
  starGrad.addColorStop(0.5, '#ffd75e');
  starGrad.addColorStop(1, '#c9861f');
  g.fillStyle = starGrad;
  g.fill();
  g.lineWidth = size * 0.018;
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ndcToScreen(ndc) {
  return {
    x: (ndc.x * 0.5 + 0.5) * window.innerWidth,
    y: (-ndc.y * 0.5 + 0.5) * window.innerHeight,
  };
}

export class FreePlace {
  constructor({ scene, camera, glowTex, audio }) {
    this.scene = scene;
    this.camera = camera;
    this.glowTex = glowTex;
    this.audio = audio;
    // audio は { tap(), pop(), place(i), chimeSuccess() } を持つ。
    // tap() は「外れ演出」用で呼び出し側（main.js）の責務のためここでは呼ばない。

    // 内部専用レイキャスター：プロキシと同じレイヤー2のみを対象にする
    this._raycaster = new THREE.Raycaster();
    this._raycaster.layers.set(2);

    // 星ボタン（光輪付き加算グロー＋星本体の2枚重ね）
    this._starGroup = new THREE.Group();
    this._glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffdb8a, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    this._glowSprite.visible = false;
    this._starTex = makeStarTexture();
    this._starSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._starTex, transparent: true, depthWrite: false, depthTest: false,
    }));
    this._starSprite.visible = false;
    this._starGroup.add(this._glowSprite, this._starSprite);
    this._starGroup.renderOrder = 999;

    this._config = null;
    this._proxies = [];
    this._count = 0;
    this._active = false;
    this._starShown = false;   // 星が一度でも表示されたか（ポップ演出の起点）
    this._starVisibleSince = null; // ポップ演出の基準時刻（update()のtimeで設定）

    // ヒントグロー（min未達の間、suggest()の各点を光らせて誘導する）
    this._hints = []; // {sprite, phase}[]
    this._lastCountSeen = 0;
    this._lastInteractTime = null; // 無操作時間の起点（update()のtimeで設定）
  }

  get active() { return this._active; }
  get count() { return this._count; }

  begin(config) {
    // config = { proxies, resolve, min, cap, suggest, onPlace, onDone }
    this._config = config;
    this._proxies = config.proxies || [];
    for (const m of this._proxies) {
      m.layers.set(2);
      this.scene.add(m);
    }
    this._count = 0;
    this._active = true;
    this._starShown = false;
    this._starVisibleSince = null;
    this._starSprite.visible = false;
    this._glowSprite.visible = false;
    this._starSprite.scale.setScalar(STAR_BASE_SCALE);
    this._glowSprite.scale.setScalar(STAR_BASE_SCALE * 1.8);
    this.scene.add(this._starGroup);

    // ヒントグロー：suggest()の各ワールド座標に置き場所を光らせる誘導マーカーを出す
    this._lastCountSeen = 0;
    this._lastInteractTime = null;
    this._clearHints();
    const pts = config.suggest ? config.suggest() : [];
    for (const p of pts) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color: 0xffe9a8, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      }));
      sprite.scale.setScalar(HINT_BASE_SCALE);
      sprite.position.copy(p);
      this.scene.add(sprite);
      this._hints.push({ sprite, phase: Math.random() * 6.28 });
    }
  }

  // ヒントグローを全部消してシーンから除去
  _clearHints() {
    for (const h of this._hints) this.scene.remove(h.sprite);
    this._hints = [];
  }

  end() {
    for (const m of this._proxies) this.scene.remove(m);
    this._proxies = [];
    this.scene.remove(this._starGroup);
    this._starSprite.visible = false;
    this._glowSprite.visible = false;
    this._clearHints();
    this._active = false;
    this._config = null;
  }

  handleTap(ndc) {
    if (!this._active || !this._config) return false;

    // 1) 星ボタン：可視かつタップがボタン中心から半径以内なら完了処理
    if (this._starSprite.visible) {
      const sp = ndcToScreen(STAR_NDC);
      const tap = ndcToScreen(ndc);
      const short = Math.min(window.innerWidth, window.innerHeight);
      const rad = short * TAP_RADIUS_RATIO;
      const dx = tap.x - sp.x, dy = tap.y - sp.y;
      if (dx * dx + dy * dy <= rad * rad) {
        this.audio.chimeSuccess();
        this._config.onDone();
        this.end();
        return true;
      }
    }

    // 2) プロキシへのレイキャスト → resolve() で配置確定
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObjects(this._proxies, false);
    if (hits.length) {
      const hit = hits[0];
      const placement = this._config.resolve(hit.point, hit.object);
      if (placement != null) {
        this._config.onPlace(placement, this._count);
        this._count++;
        this.audio.place(this._count);
        // ヒントグローを1つ消す（末尾から）
        if (this._hints.length) {
          const h = this._hints.pop();
          this.scene.remove(h.sprite);
        }
        if (this._count >= this._config.min && !this._starShown) {
          this._starShown = true;
          this._starVisibleSince = null; // 次のupdate()で起点を打刻
          this._starSprite.visible = true;
          this._glowSprite.visible = true;
          this.audio.pop();
          this._clearHints(); // 残りがあっても星にバトンタッチ
        }
        if (this._count >= this._config.cap) {
          this.audio.chimeSuccess();
          this._config.onDone();
          this.end();
        }
        return true;
      }
    }

    // 3) いずれでもない：呼び出し側の外れ演出に任せる
    return false;
  }

  update(time) {
    if (!this._active) return;

    // 無操作時間を計測（配置があるたびにリセット）。7秒以上でパルスを強める
    if (this._lastInteractTime === null) this._lastInteractTime = time;
    if (this._count !== this._lastCountSeen) {
      this._lastCountSeen = this._count;
      this._lastInteractTime = time;
    }
    const idleBoost = (time - this._lastInteractTime > HINT_IDLE_AFTER) ? HINT_IDLE_BOOST : 1;

    // ヒントグローのパルス（旧main.jsのupdateMarkersと同様のsin方式）
    for (const h of this._hints) {
      const s = HINT_BASE_SCALE * (1 + 0.25 * idleBoost * Math.sin(time * 3.2 + h.phase));
      h.sprite.scale.setScalar(s);
      h.sprite.material.opacity = 0.55 + 0.35 * Math.sin(time * 3.2 + h.phase) * idleBoost * 0.5 + 0.2;
    }

    // 星ボタンはカメラ右下1.2m地点に常時追従
    this._raycaster.setFromCamera(STAR_NDC, this.camera);
    this._raycaster.ray.at(STAR_DIST, this._starGroup.position);
    this._starGroup.quaternion.copy(this.camera.quaternion);

    if (!this._starSprite.visible) return; // min未達時は非表示のまま
    if (this._starVisibleSince === null) this._starVisibleSince = time;
    const elapsed = time - this._starVisibleSince;
    const popK = Math.min(1, elapsed / STAR_POP_DUR);
    const popEase = 1 - (1 - popK) * (1 - popK) * (1 - popK); // ease-out
    const pulse = 1 + STAR_PULSE_AMP * Math.sin(time * STAR_PULSE_SPEED);
    const s = STAR_BASE_SCALE * popEase * pulse;
    this._starSprite.scale.setScalar(s);
    this._glowSprite.scale.setScalar(s * 1.8);
  }

  screenTargets() {
    if (!this._active || !this._config) return [];
    if (this._starSprite.visible) {
      const sp = ndcToScreen(STAR_NDC);
      return [{ x: sp.x, y: sp.y, next: true }];
    }
    const pts = this._config.suggest ? this._config.suggest() : [];
    return pts.map((p) => {
      const proj = p.clone().project(this.camera);
      return ndcToScreen(proj);
    });
  }
}
