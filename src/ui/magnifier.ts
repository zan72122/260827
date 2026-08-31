import { GH, GW } from '../sim/protocol';
import type { SimState } from '../sim/state';
import { el } from './dom';

interface MapDef {
  key: string;
  label: string;
  get: (s: SimState) => Float32Array;
  max: number;
  color: (v: number) => [number, number, number];
}

const heat = (v: number): [number, number, number] => [30 + v * 210, 30 + v * 150, 40 + v * 60];
const blue = (v: number): [number, number, number] => [26 + v * 90, 26 + v * 100, 40 + v * 200];
const pink = (v: number): [number, number, number] => [40 + v * 210, 26 + v * 90, 40 + v * 130];
const grey = (v: number): [number, number, number] => [24 + v * 220, 24 + v * 220, 26 + v * 220];

const MAPS: MapDef[] = [
  { key: 'paraffin', label: '残存パラフィン', get: (s) => s.field.paraffin, max: 1, color: heat },
  { key: 'polar', label: '媒体の極性（0=キシレン系 / 1=水系）', get: (s) => s.field.polar, max: 1, color: grey },
  { key: 'hemaN', label: '核のヘマトキシリン量', get: (s) => s.field.hemaN, max: 1.35, color: blue },
  { key: 'hemaB', label: '核外のヘマトキシリン量', get: (s) => s.field.hemaB, max: 0.6, color: blue },
  { key: 'blue', label: '色出しの進行', get: (s) => s.field.blue, max: 1, color: blue },
  { key: 'eosin', label: 'エオジン量', get: (s) => s.field.eosin, max: 1.3, color: pink },
  { key: 'water', label: '残留水分', get: (s) => s.field.water, max: 1, color: grey },
  { key: 'cleared', label: '透徹の進行', get: (s) => s.field.cleared, max: 1, color: grey },
  { key: 'dried', label: '乾燥による障害', get: (s) => s.field.dried, max: 1, color: heat },
];

function mapCanvas(def: MapDef, s: SimState): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = GW;
  c.height = GH;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(GW, GH);
  const a = def.get(s);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const v = Math.max(0, Math.min(1, a[y * GW + x] / def.max));
      const [r, g, b] = def.color(v);
      // 行 0（切片の下端）を画像の下端に置く
      const j = ((GH - 1 - y) * GW + x) * 4;
      img.data[j] = r;
      img.data[j + 1] = g;
      img.data[j + 2] = b;
      img.data[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * 学習用拡大表示。**顕微鏡を覗いている表示ではない**ことを明示する。
 * 実践モードで「非表示」を選んだ場合は、この関数自体を呼ばない（DOM に情報を出さない）。
 */
export function buildMagnifier(body: HTMLElement, s: SimState): void {
  body.append(
    el('p', { class: 'dim' },
      '肉眼では見えない切片内部の状態を、教材のモデル値としてそのまま表示しています。' +
      '顕微鏡像ではありません。上下はラックに挿したときのスライドの向きに合わせています。'),
  );
  const grid = el('div', { class: 'maps' });
  for (const def of MAPS) {
    const fig = el('figure');
    fig.append(mapCanvas(def, s), el('figcaption', {}, def.label));
    grid.append(fig);
  }
  body.append(grid);

  const film = s.film;
  const rows: string[] = [];
  for (let r = GH - 1; r >= 0; r--) rows.push(`${r}: ${(film.vol[r] * 1000).toFixed(1)}`);
  body.append(
    el('h3', {}, 'スライド上の液膜'),
    el('p', { class: 'dim' }, `組成 — 水 ${pct(film.comp.water)} / アルコール ${pct(film.comp.alcohol)} / キシレン ${pct(film.comp.xylene)} / 酸 ${pct(film.comp.acid)} / ヘマトキシリン ${pct(film.comp.hema)} / エオジン ${pct(film.comp.eosin)}`),
    el('p', { class: 'dim' }, `行ごとの液膜量（上端→下端、×10⁻³）: ${rows.join(' , ')}`),
    el('p', { class: 'dim' }, `空気中に出てからの経過: ${film.airSec.toFixed(1)} 秒（教材内モデル時間）`),
  );
}

const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;
