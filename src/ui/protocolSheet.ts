import { BATHS, PROTOCOL_STEPS, TEACHING, bathById } from '../sim/protocol';
import { el } from './dom';

/** 手順書。原資料 [S1] の条件と、本教材が置いた設定を分けて示す。 */
export function buildProtocolSheet(body: HTMLElement): void {
  body.append(
    el('p', {},
      '出典: Newcomer Supply「H&E STAINING PROCEDURE WITH HARRIS MODIFIED」[S1]。' +
      '色出しは Scott Tap Water Substitute、対比染色は Eosin Y Working Solution を採用しています。'),
  );

  const t = el('table');
  t.innerHTML =
    '<thead><tr><th style="width:2.2em">#</th><th>工程</th><th style="width:7.5em">原手順の条件</th></tr></thead>';
  const tb = el('tbody');
  for (const s of PROTOCOL_STEPS) {
    const tr = el('tr');
    tr.append(el('td', {}, String(s.no)));
    const c = el('td');
    c.append(s.ja);
    if (s.baths.length) {
      c.append(el('div', { class: 'dim' }, s.baths.map((b) => bathById(b).labelEn).join(' → ')));
    }
    tr.append(c, el('td', {}, s.cond));
    tb.append(tr);
  }
  t.append(tb);
  body.append(t);

  body.append(
    el('h3', {}, '本教材が置いた設定（原手順には無い値）'),
    el('ul', {},
      el('li', {}, `核染色の教材上の基準時間: ${TEACHING.hematoxylinTargetSec} 秒（原手順は「1〜5分」の幅を示すのみ）`),
      el('li', {}, `エオジンの教材上の基準時間: ${TEACHING.eosinTargetSec} 秒（原手順は「30秒〜3分」の幅を示すのみ）`),
      el('li', {}, `分別の教材上の目安: ${TEACHING.differentiationTargetDips} ディップ前後（原手順は「速やかに」とのみ記載。秒数の規定は無い）`),
      el('li', {}, '「十分に洗う」「速やかに」など、原手順が秒数を示していない箇所に臨床上の正解秒数は設定していません。'),
    ),
    el('p', { class: 'dim' },
      'これらは資料の許容範囲内で選んだ教材設定であり、唯一の臨床的正解ではありません。' +
      '速度定数などのモデル係数は PROTOCOL.md に分けて記載しています。'),
  );

  body.append(el('h3', {}, '作業台の薬液槽'));
  const t2 = el('table');
  t2.innerHTML = '<thead><tr><th>槽</th><th>Reagent</th><th style="width:6.5em">原手順の条件</th></tr></thead>';
  const tb2 = el('tbody');
  for (const b of BATHS) {
    const tr = el('tr');
    tr.append(el('td', {}, b.labelJa), el('td', {}, b.labelEn), el('td', {}, b.ref.text));
    tb2.append(tr);
  }
  t2.append(tb2);
  body.append(t2);
  body.append(
    el('p', { class: 'dim' },
      '無色の試薬は見た目では区別できません。ラベルと作業台上の位置で判断してください。' +
      '水道水槽と蒸留水槽は「水を交換」で中身を新しくできます。同じ水に出し入れしただけでは交換になりません。'),
  );
}
