import { el, option } from './dom';
import { MicroView, rasterCanvas } from './microscope';
import { compose, type RasterImage } from '../micro/compose';
import { fieldsFromState } from '../micro/fields';
import type { BasePlate } from '../micro/basePlate';
import { replay, summarize, type RunLog, type RunSummary, TICK } from '../sim/engine';
import { bathById } from '../sim/protocol';
import type { SimState } from '../sim/state';
import {
  CAUSES,
  FINDINGS,
  actualFindings,
  causeById,
  computeMetrics,
  historySupport,
  imageOnlyCandidates,
  procedureDeviations,
  type CauseId,
  type FindingId,
  type Metrics,
} from '../sim/findings';
import { FIX_OPTIONS } from '../sim/counterfactual';

export interface DebriefInput {
  plate: BasePlate;
  log: RunLog;
  state: SimState;
  mode: 'practice' | 'exam';
  /** 部分再練習を要求されたときに呼ばれる（指定 tick までのログで再開する）。 */
  onRestartFrom: (tick: number, label: string) => void;
  onRetryAll: () => void;
}

/** 封入後の振り返り。所見 → 原因推定 → 開示 → 次の 1 条件、の順に進む。 */
export class Debrief {
  private step = 0;
  private chosenFindings = new Set<FindingId>();
  private chosenCauses = new Set<CauseId>();
  private chosenFix: string | null = null;
  private metrics: Metrics;
  private summaryData: RunSummary;
  private truth: FindingId[];
  private image: RasterImage;
  private view: MicroView;

  constructor(private input: DebriefInput, private body: HTMLElement) {
    this.metrics = computeMetrics(input.state);
    this.summaryData = summarize(input.log);
    this.truth = actualFindings(this.metrics);
    this.image = compose(input.plate, fieldsFromState(input.state), { seed: input.log.seed });
    this.view = new MicroView(this.image);
  }

  render(): void {
    const b = this.body;
    b.replaceChildren();
    const steps = el('div', { class: 'steps' });
    ['完成画像', '所見', '原因候補', '解説', '次の1条件'].forEach((t, i) => {
      steps.append(el('span', { class: i === this.step ? 'on' : '' }, `${i + 1}. ${t}`));
    });
    b.append(steps);
    if (this.step === 0) this.renderImage(b);
    else if (this.step === 1) this.renderFindings(b);
    else if (this.step === 2) this.renderCauses(b);
    else if (this.step === 3) this.renderExplain(b);
    else this.renderFix(b);
    b.scrollTop = 0;
  }

  private nav(b: HTMLElement, nextLabel: string, canNext = true): void {
    const row = el('div', { class: 'micro-tools' });
    if (this.step > 0) {
      const back = el('button', { class: 'btn small', type: 'button' }, '戻る');
      back.addEventListener('click', () => {
        this.step--;
        this.render();
      });
      row.append(back);
    }
    const next = el('button', { class: 'btn primary small', type: 'button' }, nextLabel);
    if (!canNext) next.setAttribute('disabled', 'true');
    next.addEventListener('click', () => {
      this.step++;
      this.render();
    });
    row.append(next);
    b.append(row);
  }

  // --- 1. 完成画像
  private renderImage(b: HTMLElement): void {
    b.append(el('p', {}, 'あなたが染めた標本の顕微鏡画像です。まずこの像をよく見てください。'));
    b.append(this.view.wrap);
    requestAnimationFrame(() => this.view.layout(this.view.wrap.clientWidth || b.clientWidth));
    const tools = el('div', { class: 'micro-tools' });
    for (const [label, z] of [['拡大 ＋', 1.6], ['縮小 －', 1 / 1.6], ['等倍', 0]] as const) {
      const btn = el('button', { class: 'btn small', type: 'button' }, label);
      btn.addEventListener('click', () => this.view.setZoom(z === 0 ? 1 : this.view.zoom * z));
      tools.append(btn);
    }
    b.append(tools);
    b.append(el('p', { class: 'micro-cap' }, this.captionText()));
    this.nav(b, '所見を選ぶ');
  }

  private captionText(): string {
    const p = this.input.plate.provenance;
    const fixed = '表示条件（明るさ・色調・倍率）は比較のため固定しています。';
    if (p.isRealPhoto) {
      return (
        `実写組織を基にした染色状態の教育用シミュレーションです。各条件で実際に染めた対照標本ではありません。${fixed} ` +
        `元画像: ${p.title} / ${p.credit} / ${p.license}（改変あり: ${p.modifications}）`
      );
    }
    return (
      '【重要】この画像の基礎は実写の顕微鏡写真ではなく、構造の位置関係を示す模式図です' +
      '（基準にする実写画像をこの環境から取得できなかったため）。染色状態は教育用シミュレーションであり、' +
      `各条件で実際に染めた対照標本ではありません。${fixed}`
    );
  }

  // --- 2. 所見
  private renderFindings(b: HTMLElement): void {
    b.append(el('p', {}, '完成画像から読み取れる所見を選んでください（複数選択可）。'));
    b.append(this.thumb());
    for (const f of FINDINGS) {
      b.append(
        option(f.ja, f.group, this.chosenFindings.has(f.id), (on) => {
          if (on) {
            if (f.id === 'no_major_issue') this.chosenFindings.clear();
            else this.chosenFindings.delete('no_major_issue');
            this.chosenFindings.add(f.id);
          } else this.chosenFindings.delete(f.id);
        }),
      );
    }
    this.nav(b, '原因候補へ');
  }

  private thumb(): HTMLElement {
    const wrap = el('div');
    const c = rasterCanvas(this.image, 0);
    c.style.width = '100%';
    c.style.display = 'block';
    c.style.border = '1px solid #333a3f';
    wrap.append(c);
    return wrap;
  }

  // --- 3. 原因候補
  private renderCauses(b: HTMLElement): void {
    b.append(
      el('p', {}, 'その所見を説明できそうな原因を選んでください。長い記述は必要ありません。'),
      el('p', { class: 'dim' }, '選んだ所見: ' + (this.chosenFindings.size ? [...this.chosenFindings].map((f) => FINDINGS.find((x) => x.id === f)!.ja).join(' / ') : '（未選択）')),
    );
    for (const c of CAUSES) {
      b.append(
        option(c.ja, `根拠になりやすい操作: ${c.evidenceHint}`, this.chosenCauses.has(c.id), (on) => {
          if (on) this.chosenCauses.add(c.id);
          else this.chosenCauses.delete(c.id);
        }),
      );
    }
    this.nav(b, '解説を見る');
  }

  // --- 4. 解説
  private renderExplain(b: HTMLElement): void {
    const supported = historySupport(this.summaryData, this.input.state, this.metrics).filter((s) => s.strength > 0.15);
    const imageCands = imageOnlyCandidates(this.truth);
    const deviations = procedureDeviations(this.summaryData, this.metrics);

    // --- 評価は 3 つに分ける
    b.append(el('h3', {}, '1) 観察できた所見'));
    const missed = this.truth.filter((f) => !this.chosenFindings.has(f));
    const extra = [...this.chosenFindings].filter((f) => !this.truth.includes(f));
    b.append(
      el('p', {}, 'モデル上で成立している所見: ' + this.truth.map(nameOf).join(' / ')),
      el('div', { class: `verdict ${missed.length === 0 && extra.length === 0 ? 'ok' : 'info'}` },
        el('p', {}, missed.length ? `見落とし: ${missed.map(nameOf).join(' / ')}` : '見落としはありません。'),
        el('p', {}, extra.length ? `モデル上は成立していない所見も選んでいます: ${extra.map(nameOf).join(' / ')}` : '過剰な選択はありません。'),
      ),
    );

    b.append(el('h3', {}, '2) 履歴に基づく原因推定'));
    b.append(
      el('p', { class: 'dim' }, '同じ見え方でも、画像だけからは複数の原因が考えられます。今回の操作履歴がどれを支持するかを分けて示します。'),
    );
    b.append(el('p', {}, '画像だけから考えられる原因候補: ' + (imageCands.length ? imageCands.map((c) => causeById(c).ja).join(' / ') : '（特になし）')));
    if (supported.length) {
      const ul = el('ul');
      for (const s of supported) {
        ul.append(el('li', {}, el('b', {}, causeById(s.cause).ja), ' — ', s.detail));
      }
      b.append(el('p', {}, '今回の履歴から特に支持される原因:'), ul);
    } else {
      b.append(el('p', {}, '今回の履歴からは、特定の原因を強く支持する所見はありません。'));
    }
    const supportedIds = new Set(supported.map((s) => s.cause));
    const chosenOk = [...this.chosenCauses].filter((c) => supportedIds.has(c));
    const chosenNo = [...this.chosenCauses].filter((c) => !supportedIds.has(c));
    const missedCause = [...supportedIds].filter((c) => !this.chosenCauses.has(c));
    b.append(
      el('div', { class: `verdict ${chosenNo.length === 0 && missedCause.length === 0 ? 'ok' : 'info'}` },
        el('p', {}, chosenOk.length ? `履歴に支持される原因を選べています: ${chosenOk.map((c) => causeById(c).ja).join(' / ')}` : '履歴に支持される原因は選ばれていません。'),
        el('p', {}, chosenNo.length
          ? `履歴では支持が弱い原因: ${chosenNo
              .map((c) => causeById(c).ja + (imageCands.includes(c) ? '（画像だけからは候補になり得ます）' : '（今回の像からも候補になりません）'))
              .join(' / ')}`
          : ''),
        el('p', {}, missedCause.length ? `見落とした原因: ${missedCause.map((c) => causeById(c).ja).join(' / ')}` : ''),
      ),
    );

    b.append(el('h3', {}, '3) 操作履歴'));
    b.append(this.historyTable());

    b.append(el('h3', {}, '手順からの逸脱'));
    if (deviations.length) {
      const ul = el('ul');
      for (const d of deviations) {
        ul.append(el('li', {}, `${d.text} ${d.visible ? '（今回の像に出ています）' : '（今回の像には強く出ていません）'}`));
      }
      b.append(ul);
      b.append(el('p', { class: 'dim' }, '像に出ていない逸脱でも、日常の運用では試薬の寿命や他の標本への持ち越しに影響します。今回のモデルでは像への影響が小さかった、という意味です。'));
    } else {
      b.append(el('p', {}, '原手順との大きな差はありません。'));
    }

    b.append(el('h3', {}, '標本状態の要約（教材モデル値）'));
    const m = this.metrics;
    const t = el('table');
    t.innerHTML =
      '<tbody>' +
      row('核のヘマトキシリン', m.hemaN.toFixed(3)) +
      row('核外のヘマトキシリン', m.hemaB.toFixed(3)) +
      row('核 / 背景の比', m.nucContrast.toFixed(2)) +
      row('色出しの進行', m.blue.toFixed(3)) +
      row('エオジン', m.eosin.toFixed(3)) +
      row('残存パラフィン', m.paraffin.toFixed(4)) +
      row('曇り（残留水分・透徹不良）', m.haze.toFixed(3)) +
      row('乾燥障害', m.dried.toFixed(3)) +
      row('気泡の占める割合', m.bubble.toFixed(3)) +
      row('未充填の割合', m.unfilled.toFixed(3)) +
      '</tbody>';
    b.append(t);

    this.nav(b, '次に変える1条件へ');
  }

  private historyTable(): HTMLElement {
    const t = el('table');
    t.innerHTML = '<thead><tr><th>#</th><th>槽</th><th>浸漬</th><th>dips</th><th>最大浸漬</th></tr></thead>';
    const tb = el('tbody');
    for (const v of this.summaryData.visits) {
      const d = bathById(v.bathId);
      const tr = el('tr');
      tr.append(
        el('td', {}, String(v.order)),
        el('td', {}, d.labelJa + (d.replaceable ? `（${v.generation}回目の水）` : '')),
        el('td', {}, `${v.submergedSec.toFixed(1)}s`),
        el('td', {}, String(v.dips)),
        el('td', {}, v.maxLevel >= 1 ? '全面' : `${Math.max(0, v.maxLevel * 100).toFixed(0)}%`),
      );
      tb.append(tr);
    }
    t.append(tb);
    const wrap = el('div', { style: 'overflow-x:auto' });
    wrap.append(t);
    const note = el('p', { class: 'dim' },
      `空気中に置いた最長時間 ${this.summaryData.maxAirSec.toFixed(1)} 秒 / 教材内の総経過 ${this.summaryData.totalModelSec.toFixed(0)} 秒`);
    const holder = el('div');
    holder.append(wrap, note);
    return holder;
  }

  // --- 5. 次の 1 条件
  private renderFix(b: HTMLElement): void {
    b.append(
      el('p', {}, '次に 1 つだけ条件を変えるとしたら、どれにしますか。選ぶと、モデル上での比較（反実仮想）を表示します。'),
      el('p', { class: 'dim' }, 'これは実際に染め直した対照標本ではなく、記録した操作を 1 箇所だけ書き換えて再生したモデル上の結果です。'),
    );
    for (const f of FIX_OPTIONS) {
      b.append(
        option(f.ja, `対応する原因: ${causeById(f.cause).ja}`, this.chosenFix === f.id, (on) => {
          this.chosenFix = on ? f.id : null;
          for (const n of b.querySelectorAll('.opt')) n.classList.remove('on');
          if (on) {
            const idx = FIX_OPTIONS.findIndex((x) => x.id === f.id);
            b.querySelectorAll('.opt')[idx]?.classList.add('on');
          }
          this.renderCompare(cmp);
        }),
      );
    }
    const cmp = el('div');
    b.append(cmp);

    const tools = el('div', { class: 'micro-tools' });
    const restart = el('button', { class: 'btn small', type: 'button' }, 'その工程から練習しなおす');
    restart.addEventListener('click', () => this.offerRestart(cmp));
    const again = el('button', { class: 'btn primary small', type: 'button' }, 'はじめからもう一度');
    again.addEventListener('click', () => this.input.onRetryAll());
    tools.append(restart, again);
    b.append(tools);
  }

  private renderCompare(host: HTMLElement): void {
    host.replaceChildren();
    if (!this.chosenFix) return;
    const fix = FIX_OPTIONS.find((f) => f.id === this.chosenFix)!;
    host.append(el('p', { class: 'dim' }, 'モデル上で計算しています…'));
    setTimeout(() => {
      const log2 = fix.apply(this.input.log);
      const st2 = replay(log2);
      const img2 = compose(this.input.plate, fieldsFromState(st2), { seed: this.input.log.seed });
      const m2 = computeMetrics(st2);
      const f2 = actualFindings(m2);
      host.replaceChildren();
      const grid = el('div', { class: 'compare' });
      const w = Math.floor((host.clientWidth - 6) / 2);
      const a = el('figure');
      a.append(rasterCanvas(this.image, w), el('figcaption', {}, '今回の結果'));
      const c = el('figure');
      c.append(rasterCanvas(img2, w), el('figcaption', {}, `${fix.ja}（モデル上の反実仮想）`));
      grid.append(a, c);
      host.append(grid);
      const gone = this.truth.filter((x) => !f2.includes(x) && x !== 'no_major_issue');
      const added = f2.filter((x) => !this.truth.includes(x) && x !== 'no_major_issue');
      const supported = new Set(
        historySupport(this.summaryData, this.input.state, this.metrics)
          .filter((x) => x.strength > 0.15)
          .map((x) => x.cause),
      );
      const aimed = supported.has(fix.cause);
      const verdict = gone.length && !added.length
        ? aimed
          ? '妥当: 履歴が支持する原因に対する修正で、モデル上も所見が解消しました。'
          : 'モデル上は所見が解消しましたが、この原因は今回の履歴からは強く支持されていません。他の原因も考えてください。'
        : added.length
          ? '注意: 別の所見が新たに出ました。1 条件の変更が他の工程に影響しています。'
          : aimed
            ? '履歴はこの原因を支持しますが、この変更幅ではモデル上の所見は変わりませんでした。'
            : 'この変更ではモデル上の所見は変わりませんでした。原因の見立てを見直してください。';
      host.append(
        el('h3', {}, '3) 修正の妥当性'),
        el('div', { class: `verdict ${gone.length && !added.length && aimed ? 'ok' : added.length ? 'warn' : 'info'}` },
          el('p', {}, verdict),
          el('p', {}, gone.length ? `解消した所見: ${gone.map(nameOf).join(' / ')}` : '解消した所見はありません。'),
          el('p', {}, added.length ? `新たに出た所見: ${added.map(nameOf).join(' / ')}` : '新たな所見は出ていません。'),
          el('p', { class: 'dim' }, '比較画像は同じ視野・同じ表示条件です。実際に染め直した対照標本ではなく、モデル上の反実仮想です。'),
        ),
      );
    }, 30);
  }

  private offerRestart(host: HTMLElement): void {
    host.replaceChildren();
    host.append(el('p', {}, 'どの工程の直前から練習しなおしますか。'));
    for (const v of this.summaryData.visits) {
      const d = bathById(v.bathId);
      const btn = el('button', { class: 'btn small', type: 'button' }, `${v.order}. ${d.labelJa} の直前へ`);
      btn.style.width = '100%';
      btn.style.marginBottom = '4px';
      btn.addEventListener('click', () => this.input.onRestartFrom(v.startTick, d.labelJa));
      host.append(btn);
    }
    host.append(el('p', { class: 'dim' }, `1 tick = ${TICK} 秒（教材内モデル時間）。標本・槽・履歴をその時点まで矛盾なく戻します。`));
  }
}

const nameOf = (f: FindingId): string => FINDINGS.find((x) => x.id === f)?.ja ?? f;
const row = (k: string, v: string): string => `<tr><th>${k}</th><td>${v}</td></tr>`;
