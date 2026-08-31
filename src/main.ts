import './style.css';
import { $, Sheet, el } from './ui/dom';
import { Game, type MagnifyMode, type MountPhase, type Mode } from './app/game';
import { loadBasePlate } from './micro/assets';
import type { BasePlate } from './micro/basePlate';
import { buildMagnifier } from './ui/magnifier';
import { buildProtocolSheet } from './ui/protocolSheet';
import { Debrief } from './ui/debrief';
import { BATH_INDEX, STATIONS, bathById, TEACHING } from './sim/protocol';
import { cloneLog, type RunLog } from './sim/engine';
import { DIM } from './sim/geometry';

const canvas = $('gl') as unknown as HTMLCanvasElement;
const sheet = new Sheet();

let plate: BasePlate | null = null;
let assetFallback: string | null = null;
let game: Game | null = null;
let mode: Mode = 'practice';
let magnify: MagnifyMode = 'auto';

// ---------------------------------------------------------------------------
// タイトル画面
// ---------------------------------------------------------------------------

function setChoice(groupId: string, value: string): void {
  for (const b of $(groupId).querySelectorAll<HTMLElement>('.choice-btn')) {
    b.classList.toggle('on', b.dataset.v === value);
  }
}

const MODE_NOTES: Record<Mode, string> = {
  practice: '最初の1動作だけ案内します。誤操作を止める設定と、結果を確認して巻き戻す設定を選べます。',
  exam: '正しい薬液も原因も先には表示しません。手順書・薬液名・時計は参照できます。最終画像まで進んでから考えます。',
};

function initTitle(): void {
  setChoice('pick-mode', mode);
  setChoice('pick-magnify', magnify);
  $('mode-note').textContent = MODE_NOTES[mode];
  $('pick-mode').addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.choice-btn');
    if (!t) return;
    mode = t.dataset.v as Mode;
    setChoice('pick-mode', mode);
    $('mode-note').textContent = MODE_NOTES[mode];
  });
  $('pick-magnify').addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.choice-btn');
    if (!t) return;
    magnify = t.dataset.v as MagnifyMode;
    setChoice('pick-magnify', magnify);
  });
  $('start').addEventListener('click', () => {
    const seed = ($('seed') as HTMLInputElement).value.trim() || 'he-2601';
    startGame({ mode, magnify, seed });
  });
}

// ---------------------------------------------------------------------------
// ゲーム開始 / 再開
// ---------------------------------------------------------------------------

interface StartOpts {
  mode: Mode;
  magnify: MagnifyMode;
  seed: string;
  resumeLog?: RunLog;
  station?: (typeof STATIONS)[number]['id'];
}

function startGame(opts: StartOpts): void {
  game?.dispose();
  $('title').hidden = true;
  $('hud-top').hidden = false;
  $('hud-bottom').hidden = false;
  sheet.close();
  game = new Game(canvas, opts, {
    onHud: updateHud,
    onMountPhase: updateMountTools,
    onFinished: openDebrief,
    onHint: showHint,
    onConfirm: showConfirm,
  });
  game.start();
  bindPointer(game);
  exposeTestApi(game);
  updateHud();
  updateMountTools(game.mountPhase);
}

/**
 * 自動テスト用の **読み取り専用** API。
 * 画面上の座標や現在値を返すだけで、状態を書き換える手段は公開しない。
 * 操作テストは必ず実際のポインタ経路を通す。
 */
function exposeTestApi(g: Game): void {
  (window as unknown as Record<string, unknown>).__he = {
    grab: () => g.grabHandleScreen(),
    level: () => g.level,
    rackY: () => g.rackY,
    station: () => g.station,
    jar: () => g.currentJar,
    jarOrder: () => g.jarsOfStation(g.station),
    phase: () => g.phase,
    mountPhase: () => g.mountPhase,
    dips: () => (g.currentJar ? g.run.state.baths[BATH_INDEX[g.currentJar]].dips : 0),
    seconds: () => (g.currentJar ? g.run.state.baths[BATH_INDEX[g.currentJar]].usedSec : 0),
    modelSec: () => g.clock.modelSec,
    opSec: () => g.clock.opSec,
    accel: () => g.clock.accel,
    generation: () => (g.currentJar ? g.run.state.baths[BATH_INDEX[g.currentJar]].generation : 0),
    volumeUl: () => g.mount.volumeUl,
    coverAngle: () => g.coverAngleDeg,
    logLength: () => g.run.log.bath.length,
    fieldMeans: () => {
      const f = g.run.state.field;
      const mean = (a: Float32Array): number => {
        let s2 = 0;
        for (let i = 0; i < a.length; i++) s2 += a[i];
        return s2 / a.length;
      };
      return {
        paraffin: mean(f.paraffin),
        hemaN: mean(f.hemaN),
        hemaB: mean(f.hemaB),
        blue: mean(f.blue),
        eosin: mean(f.eosin),
        water: mean(f.water),
        cleared: mean(f.cleared),
        dried: mean(f.dried),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

function updateHud(): void {
  if (!game) return;
  const st = STATIONS.find((s) => s.id === game!.station)!;
  $('hud-station').textContent = `${st.labelJa}`;
  $('hud-mode').textContent = game.mode === 'practice' ? '練習' : '実践';
  $('hud-clock').innerHTML = game.hudClock();
  $('nav-label').textContent = `${st.labelJa} / ${st.labelEn}`;

  const jarId = game.currentJar;
  if (jarId && game.phase === 'play') {
    const d = bathById(jarId);
    $('hud-jar').textContent = `${d.labelJa}`;
    const rt = game.run.state.baths[BATH_INDEX[jarId]];
    const parts = [`原手順: ${d.ref.text}`];
    if (d.ref.dips) parts.push(`ディップ ${rt.dips}/${d.ref.dips}`);
    else parts.push(`ディップ ${rt.dips}`);
    parts.push(`浸漬 ${rt.usedSec.toFixed(0)}秒`);
    if (d.replaceable) parts.push(`水 ${rt.generation}回目`);
    $('hud-ref').textContent = parts.join(' ・ ');
  } else if (game.phase === 'mount') {
    $('hud-jar').textContent = '封入台';
    $('hud-ref').textContent = `封入剤 ${game.mount.volumeUl.toFixed(0)} µL ・ 接触辺 ${game.mount.slipY.toFixed(0)}mm ・ 角度 ${game.coverAngleDeg.toFixed(0)}°`;
  } else {
    $('hud-jar').textContent = '';
    $('hud-ref').textContent = '';
  }

  const status: string[] = [];
  if (game.phase === 'play' && game.currentJar) {
    const lv = game.level;
    if (lv >= 1) status.push('切片全体が液面下');
    else if (lv > 0) status.push(`切片の ${(lv * 100).toFixed(0)}% が液面下`);
    else if (game.rackY < 92) status.push('液切り中（滴が槽へ戻ります）');
    else status.push('搬送位置');
  }
  if (game.statusText) status.push(game.statusText);
  $('hud-status').textContent = status.join(' ・ ');

  const refreshable = game.phase === 'play' && game.currentJar ? bathById(game.currentJar).replaceable : false;
  ($('btn-refresh') as HTMLButtonElement).disabled = !refreshable || game.level > 0;
  $('btn-magnify').hidden = magnify === 'off';

  // 学習用拡大表示「自動」: 肉眼では見えない内部状態を常時 1 行で補助表示する。
  // 「非表示」では DOM にも出さない（実践モードで隠れた情報が透けないようにする）。
  const learn = $('hud-learn');
  if (magnify === 'auto' && game.phase !== 'finished') {
    const f = game.run.state.field;
    const mean = (a: Float32Array): number => {
      let s = 0;
      for (let i = 0; i < a.length; i++) s += a[i];
      return s / a.length;
    };
    const polar = mean(f.polar);
    learn.textContent =
      `学習用（顕微鏡像ではありません）: 残存パラフィン ${(mean(f.paraffin) * 100).toFixed(0)}% ・ ` +
      `核色素 ${mean(f.hemaN).toFixed(2)} ・ 背景色素 ${mean(f.hemaB).toFixed(2)} ・ ` +
      `エオジン ${mean(f.eosin).toFixed(2)} ・ 媒体 ${polar > 0.8 ? '水系' : polar > 0.45 ? 'アルコール' : '非極性'} ・ ` +
      `残留水分 ${(mean(f.water) * 100).toFixed(0)}%`;
    learn.hidden = false;
  } else {
    learn.textContent = '';
    learn.hidden = true;
  }
}

function showConfirm(text: string, onYes: () => void): void {
  const h = $('hint');
  window.clearTimeout(hintTimer);
  h.replaceChildren(el('div', {}, text));
  const row = el('div', { class: 'micro-tools' });
  const no = el('button', { class: 'btn small', type: 'button' }, '戻る');
  no.addEventListener('click', () => {
    h.hidden = true;
  });
  const yes = el('button', { class: 'btn primary small', type: 'button' }, 'それでも移す');
  yes.addEventListener('click', () => {
    h.hidden = true;
    onYes();
  });
  row.append(no, yes);
  h.append(row);
  h.hidden = false;
}

let hintTimer = 0;
function showHint(text: string | null): void {
  const h = $('hint');
  if (!text) {
    h.hidden = true;
    return;
  }
  h.replaceChildren();
  h.append(el('div', {}, text));
  const b = el('button', { class: 'btn small', type: 'button' }, 'わかりました');
  b.addEventListener('click', () => {
    h.hidden = true;
  });
  h.append(b);
  h.hidden = false;
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => {
    h.hidden = true;
  }, 14000);
}

// ---------------------------------------------------------------------------
// 封入操作のボタン
// ---------------------------------------------------------------------------

function updateMountTools(p: MountPhase): void {
  const host = $('mount-tools');
  host.replaceChildren();
  host.hidden = !game || game.phase !== 'mount';
  if (!game || game.phase !== 'mount') return;
  const add = (label: string, fn: () => void, primary = false): void => {
    const b = el('button', { class: `btn${primary ? ' primary' : ''}`, type: 'button' }, label);
    b.addEventListener('click', fn);
    host.append(b);
  };
  if (p === 'take') {
    add('ラックから同じスライドを取り出す', () => game!.takeSlideFromRack(), true);
  } else if (p === 'dispense') {
    host.append(el('div', { class: 'nav-label' }, `ドラッグ=位置 / 長押し=押し出す（${game.mount.volumeUl.toFixed(0)} µL）`));
    add('次へ（カバーガラス）', () => game!.finishDispense(), true);
  } else if (p === 'place') {
    host.append(el('div', { class: 'nav-label' }, '上下ドラッグで接触辺の位置を決める'));
    add('この位置で下ろす', () => game!.beginLower(), true);
  } else if (p === 'lower') {
    host.append(el('div', { class: 'nav-label' }, '下へドラッグしてカバーガラスを倒す'));
  } else {
    add('顕微鏡で観察する', () => openDebrief(), true);
  }
  updateHud();
}

// ---------------------------------------------------------------------------
// ポインタ操作
// ---------------------------------------------------------------------------

function bindPointer(g: Game): void {
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  let moved = false;
  let dragging = false;
  let activeId = -1;
  let holdTimer = 0;
  let squeezing = false;
  let squeezeLast = 0;

  const stopSqueeze = (): void => {
    squeezing = false;
    window.clearTimeout(holdTimer);
  };

  const onDown = (e: PointerEvent): void => {
    if (sheet.isOpen) return;
    if (activeId !== -1) return;
    activeId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    downX = lastX = e.clientX;
    downY = lastY = e.clientY;
    moved = false;
    dragging = false;

    if (g.phase === 'play') {
      dragging = g.beginDrag(e.pointerId, e.clientX, e.clientY);
    } else if (g.phase === 'mount') {
      dragging = true;
      if (g.mountPhase === 'dispense') {
        holdTimer = window.setTimeout(() => {
          if (!moved) {
            squeezing = true;
            squeezeLast = performance.now();
          }
        }, 180);
      }
    }
    e.preventDefault();
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) {
      moved = true;
      stopSqueeze();
    }
    if (g.phase === 'play') {
      g.moveDrag(e.pointerId, e.clientX, e.clientY);
    } else if (g.phase === 'mount' && dragging) {
      const mmPerPx = 0.16;
      if (g.mountPhase === 'dispense') g.moveDispenser(dx * mmPerPx * 0.6, -dy * mmPerPx);
      else if (g.mountPhase === 'place') g.moveCoverEdge(-dy * mmPerPx);
      else if (g.mountPhase === 'lower') g.lowerCover(-dy * 0.16);
    }
    lastX = e.clientX;
    lastY = e.clientY;
    e.preventDefault();
  };

  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    stopSqueeze();
    if (g.phase === 'play') {
      if (!moved && !dragging) g.tapJar(e.clientX, e.clientY);
      g.endDrag(e.pointerId);
    }
    activeId = -1;
    dragging = false;
    updateHud();
  };

  const onCancel = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    stopSqueeze();
    g.cancelDrag();
    activeId = -1;
    dragging = false;
    updateHud();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', onCancel);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const squeezeLoop = (): void => {
    if (!game) return;
    if (squeezing) {
      const now = performance.now();
      game.squeeze(Math.min(0.05, (now - squeezeLast) / 1000));
      squeezeLast = now;
    }
    requestAnimationFrame(squeezeLoop);
  };
  requestAnimationFrame(squeezeLoop);
}

// ---------------------------------------------------------------------------
// シート（手順書・拡大表示・メニュー・振り返り）
// ---------------------------------------------------------------------------

function bindSheets(): void {
  sheet.onClose = () => game?.setPaused(false);
  $('btn-protocol').addEventListener('click', () => {
    game?.setPaused(true);
    sheet.open('手順書（S1）', buildProtocolSheet);
  });
  $('btn-magnify').addEventListener('click', () => {
    if (!game || magnify === 'off') return;
    game.setPaused(true);
    sheet.open('学習用拡大表示（顕微鏡像ではありません）', (b) => buildMagnifier(b, game!.run.state));
  });
  $('btn-menu').addEventListener('click', () => {
    game?.setPaused(true);
    sheet.open('メニュー', buildMenu);
  });
  $('btn-refresh').addEventListener('click', () => game?.refreshJar());
  $('nav-prev').addEventListener('click', () => game?.stepStation(-1));
  $('nav-next').addEventListener('click', () => game?.stepStation(1));
}

function buildMenu(b: HTMLElement): void {
  if (!game) return;
  b.append(el('h3', {}, 'この教材について'));
  b.append(
    el('p', {},
      '正常ヒト大腸のパラフィン切片（教材上 4µm）1 枚を、[S1] の手順で H&E 染色します。' +
      '完成した標本の顕微鏡画像を観察し、自分の操作履歴と照らして原因を考えるための教材です。'),
    el('p', { class: 'dim' },
      '実作業の力量認定教材ではありません。臨床用の染色品質予測器でもありません。' +
      '反応の速度定数は教材係数であり、実試薬の反応速度として検証されたものではありません。'),
  );

  b.append(el('h3', {}, '設定'));
  const magRow = el('div', { class: 'choice' });
  for (const [v, label] of [['auto', '自動'], ['ondemand', '必要時に開く'], ['off', '非表示']] as const) {
    const btn = el('button', { class: `btn choice-btn${magnify === v ? ' on' : ''}`, type: 'button' }, label);
    btn.addEventListener('click', () => {
      magnify = v;
      for (const n of magRow.querySelectorAll('.choice-btn')) n.classList.remove('on');
      btn.classList.add('on');
      updateHud();
    });
    magRow.append(btn);
  }
  b.append(el('p', { class: 'dim' }, '学習用拡大表示'), magRow);

  const sound = el('button', { class: `btn${game.audio.enabled ? ' on' : ''}`, type: 'button' },
    game.audio.enabled ? '音: ON' : '音: OFF');
  sound.style.width = '100%';
  sound.addEventListener('click', () => {
    game!.audio.setEnabled(!game!.audio.enabled);
    sound.textContent = game!.audio.enabled ? '音: ON' : '音: OFF';
    sound.classList.toggle('on', game!.audio.enabled);
  });
  b.append(el('p', { class: 'dim' }, '効果音（無音でも最後まで進められます）'), sound);

  if (game.mode === 'practice') {
    b.append(el('h3', {}, '練習モードの補助'));
    const blk = el('button', { class: `btn${game.blockMistakes ? ' on' : ''}`, type: 'button' },
      game.blockMistakes ? '誤操作を止める: ON' : '誤操作を止める: OFF');
    blk.style.width = '100%';
    blk.addEventListener('click', () => {
      game!.blockMistakes = !game!.blockMistakes;
      blk.textContent = game!.blockMistakes ? '誤操作を止める: ON' : '誤操作を止める: OFF';
      blk.classList.toggle('on', game!.blockMistakes);
    });
    b.append(blk);
    b.append(el('p', { class: 'dim' }, 'ON にすると、手順書の順序から外れた槽へ移す前に確認を挟みます。'));

    b.append(el('h3', {}, '巻き戻し（教材機能）'));
    b.append(el('p', { class: 'dim' }, '実際の作業では戻せません。標本・槽・履歴を矛盾なく戻すための教材上の機能です。'));
    const sum = game.summary();
    for (const v of sum.visits.slice(-8)) {
      const d = bathById(v.bathId);
      const btn = el('button', { class: 'btn small', type: 'button' }, `${v.order}. ${d.labelJa} の直前へ戻す`);
      btn.style.width = '100%';
      btn.style.marginBottom = '4px';
      btn.addEventListener('click', () => {
        const log = cloneLog(game!.run.log);
        log.bath.length = v.startTick;
        log.level.length = v.startTick;
        log.marks = log.marks.filter((m) => m.tick <= v.startTick);
        log.mount = null;
        sheet.close();
        startGame({ mode: game!.mode, magnify, seed: log.seed, resumeLog: log, station: d.station });
      });
      b.append(btn);
    }
  }

  b.append(el('h3', {}, '画像の出典'));
  const p = plate?.provenance;
  if (p?.isRealPhoto) {
    b.append(el('p', {}, `${p.title} / ${p.credit} / ${p.license}`), el('p', { class: 'dim' }, `改変: ${p.modifications}`));
    if (p.licenseUrl) b.append(el('p', {}, el('a', { href: p.licenseUrl, target: '_blank', rel: 'noreferrer' }, p.licenseUrl)));
  } else {
    b.append(el('p', {}, '実写の顕微鏡写真は取得できていません。構造模式図で代替しています。'));
    if (assetFallback) b.append(el('p', { class: 'dim' }, assetFallback));
  }

  b.append(el('h3', {}, '寸法の出典'));
  b.append(
    el('ul', {},
      el('li', {}, `スライド ${DIM.slide.len}×${DIM.slide.wid}×${DIM.slide.thick}mm（Marienfeld HistoBond [S6]）`),
      el('li', {}, `カバーガラス ${DIM.cover.len}×${DIM.cover.wid}mm、厚さ ${DIM.cover.thick}mm（[S7]。No.1 は 0.13〜0.16mm のため 0.17mm は No.1.5 相当。差異として記録）`),
      el('li', {}, `染色槽 蓋込み外寸 ${DIM.jar.w}×${DIM.jar.hWithLid}×${DIM.jar.d}mm、ステンレス製ラック（[S5]）。ラックは最大10枚用だが1枚のみ装着`),
      el('li', {}, `液面高さ ${DIM.liquidDepth}mm、ラック各部の線径などは教材モデルの寸法`),
    ),
  );

  const again = el('button', { class: 'btn', type: 'button' }, 'はじめからやり直す');
  again.style.width = '100%';
  again.addEventListener('click', () => {
    sheet.close();
    startGame({ mode: game!.mode, magnify, seed: game!.run.log.seed });
  });
  b.append(el('h3', {}, '操作'), again);
}

// ---------------------------------------------------------------------------
// 振り返り
// ---------------------------------------------------------------------------

function openDebrief(): void {
  if (!game || !plate) return;
  game.setPaused(true);
  const g = game;
  sheet.open('振り返り', (body) => {
    const d = new Debrief(
      {
        plate: plate!,
        log: g.run.log,
        state: g.run.state,
        mode: g.mode,
        onRestartFrom: (tick) => {
          const log = cloneLog(g.run.log);
          log.bath.length = tick;
          log.level.length = tick;
          log.marks = log.marks.filter((m) => m.tick <= tick);
          log.mount = null;
          const visit = g.summary().visits.find((v) => v.startTick === tick);
          sheet.close();
          startGame({
            mode: g.mode,
            magnify,
            seed: log.seed,
            resumeLog: log,
            station: visit ? bathById(visit.bathId).station : 'deparaffin',
          });
        },
        onRetryAll: () => {
          sheet.close();
          startGame({ mode: g.mode, magnify, seed: g.run.log.seed });
        },
      },
      body,
    );
    d.render();
  });
}

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  try {
    initTitle();
    bindSheets();
    const loaded = await loadBasePlate();
    plate = loaded.plate;
    assetFallback = loaded.fallbackReason;
    const notice = $('asset-notice');
    if (loaded.fallbackReason) {
      notice.innerHTML =
        '<b>顕微鏡画像について</b><br>' +
        '基準にする実写の顕微鏡写真（Wikimedia Commons: Colon, high mag. / CoRus13 / CC BY-SA 4.0）を、' +
        'この環境から取得できませんでした。実写ではない<b>構造模式図</b>で代替しています。' +
        '完成画像にもその旨を明示します。<br>' +
        '<span style="opacity:.75">npm run fetch-assets で画像を取得できた場合は自動的に実写が使われます。</span>';
    } else {
      const p = plate.provenance;
      notice.innerHTML = `<b>顕微鏡画像の出典</b><br>${p.title} / ${p.credit} / ${p.license}<br><span style="opacity:.75">改変: ${p.modifications}</span>`;
    }
    $('loading').hidden = true;
    // 教材内のモデル時間の刻み（デバッグ表示用）
    void TEACHING.tickSec;
  } catch (err) {
    $('loading').hidden = true;
    const f = $('fatal');
    f.hidden = false;
    f.replaceChildren(
      el('div', {}, '起動できませんでした。'),
      el('div', { class: 'dim' }, err instanceof Error ? err.message : String(err)),
    );
  }
}

void boot();
