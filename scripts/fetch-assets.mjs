#!/usr/bin/env node
/**
 * 実写の顕微鏡写真（[S4] 正常大腸 H&E）を取得してローカルに同梱する。
 *
 *   npm run fetch-assets
 *
 * 取得できた場合のみ public/assets/tissue/ に画像と manifest.json を書く。
 * 取得できなかった場合は **無言で偽の組織画像に差し替えず**、理由を表示して終了する。
 * その場合ゲームは「実写ではない構造模式図」で代替し、画面上でそのことを明示する。
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const OUT_DIR = join(process.cwd(), 'public', 'assets', 'tissue');
const IMAGE_FILE = 'colon_high_mag.jpg';

const SOURCE = {
  id: 'S4',
  title: 'Colon, high mag.jpg',
  author: 'CoRus13',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  descriptionPage: 'https://commons.wikimedia.org/wiki/File:Colon,_high_mag.jpg',
  fileUrl: 'https://upload.wikimedia.org/wikipedia/commons/d/de/Colon%2C_high_mag.jpg',
};

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  process.stdout.write(`取得中: ${SOURCE.fileUrl}\n`);
  let buf;
  try {
    const res = await fetch(SOURCE.fileUrl, {
      headers: { 'User-Agent': 'he-staining-simulator/1.0 (educational; local asset fetch)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    process.stderr.write(
      [
        '',
        '取得に失敗しました。',
        `  URL   : ${SOURCE.fileUrl}`,
        `  理由  : ${err instanceof Error ? err.message : String(err)}`,
        '',
        'この実行環境からアクセスできない場合（社内プロキシ・egress 制限など）は、',
        '同じ画像を手元でダウンロードし、次の場所に置いてください:',
        `  ${join(OUT_DIR, IMAGE_FILE)}`,
        `  (出典ページ: ${SOURCE.descriptionPage} / ${SOURCE.license})`,
        'その後もう一度 npm run fetch-assets を実行すると manifest.json を生成します。',
        '',
        '画像が無い場合、ゲームは実写ではない「構造模式図」で代替し、画面上でそのことを明示します。',
        '偽の組織画像を実写として扱うことはありません。',
        '',
      ].join('\n'),
    );
    if (!existsSync(join(OUT_DIR, IMAGE_FILE))) process.exitCode = 1;
    return;
  }

  writeFileSync(join(OUT_DIR, IMAGE_FILE), buf);
  finish(buf);
}

function finish(buf) {
  const sha = createHash('sha256').update(buf).digest('hex');
  const manifest = {
    generatedAt: new Date().toISOString(),
    image: IMAGE_FILE,
    bytes: buf.length,
    sha256: sha,
    ...SOURCE,
    modifications:
      '表示サイズへの縮小と中央付近の切り出し、色分離（color deconvolution）による ' +
      'ヘマトキシリン／エオジン成分への分解、および状態モデルに応じた各成分の増減。',
    attributionText:
      'Colon, high mag. by CoRus13, CC BY-SA 4.0 — 改変あり（縮小・切り出し・色成分の分解と再合成）',
    shareAlikeNote:
      'CC BY-SA 4.0 の継承条件により、この画像から作られた派生画像も同ライセンスで扱う。' +
      'リポジトリのソースコード（MIT）とはライセンスが異なる。',
  };
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(`保存しました: ${join(OUT_DIR, IMAGE_FILE)} (${buf.length} bytes)\nsha256: ${sha}\n`);
}

main();
