# SOURCE_MANIFEST — 素材と出典

このプロジェクトが使用・参照した素材の一覧です。
**「調査のために閲覧できること」と「ゲーム内に再配布できること」を分けて記載します。**

---

## A. ゲーム内で再配布している素材

| 素材 | 由来 | ライセンス | 改変 | ローカルファイル |
|------|------|-----------|------|-----------------|
| 3D モデル（染色槽・ステンレスラック・スライド・カバーガラス・作業台・流し・排気フード・棚） | 本プロジェクトによる自作（実物の**寸法**を参考にした手続き生成ジオメトリ） | MIT（本リポジトリのコードと同じ） | — | `src/render3d/*.ts` |
| 天板・ステンレス・ラベル紙のテクスチャ | 本プロジェクトによる手続き生成（Canvas） | MIT | — | `src/render3d/materials.ts` |
| 効果音（金属の接触・液の出入り・滴下・ガラスの接地） | 本プロジェクトによる WebAudio 合成 | MIT | — | `src/app/audio.ts` |
| 正常大腸粘膜の**構造模式図** | 本プロジェクトによる手続き生成 | MIT | — | `src/micro/basePlate.ts`（`proceduralColonSchematic`） |

**外部の画像・3D モデル・PBR 素材は 1 つも同梱していません。**
メーカー写真（Marienfeld）や Leica 掲載写真は、閲覧できることを理由にゲーム素材として転載していません。
これらは**形状・寸法の参考**として用い、ジオメトリは自作しています。

## B. ゲーム内で使う予定だが、この環境では取得できなかった素材

| 素材 | 出典 | ライセンス | 状態 |
|------|------|-----------|------|
| `Colon, high mag.jpg` — 正常大腸の H&E 実写画像 | Wikimedia Commons、撮影者 **CoRus13**<br><https://commons.wikimedia.org/wiki/File:Colon,_high_mag.jpg> | **CC BY-SA 4.0**<br><https://creativecommons.org/licenses/by-sa/4.0/> | **未取得（未解決）** |

### 取得できなかった理由

この実装を行った環境では、`commons.wikimedia.org` および `upload.wikimedia.org` への
アクセスが組織のエグレスポリシーで拒否されます（`CONNECT tunnel failed, response 403` /
`fetch → HTTP 403`）。プロキシの案内に従い、回避策は取っていません。

### そのため行ったこと

- **偽の組織画像を実写として代用していません。**
- 代わりに、正常大腸粘膜の**構造模式図**（陰窩の断面、基底側に並ぶ上皮核、杯細胞の粘液腔、粘膜固有層）を
  手続き生成し、**実写ではないことをタイトル画面・メニュー・完成画像のキャプションに毎回明示**しています。
- 実写画像を使う経路は実装済みです。次の手順で差し替わります。

```bash
npm run fetch-assets      # 取得できる環境なら画像と manifest.json を書き出す
```

取得に失敗した場合はエラー内容と手動での置き場所を表示します。
`public/assets/tissue/colon_high_mag.jpg` を手で置いてから再実行しても manifest が生成されます。
画像が存在すると、起動時に自動的に実写経路（色分離 → 状態に応じた再合成）へ切り替わり、
画面上のクレジット表記も実写用に変わります。

### 実写画像を使う場合のクレジットとライセンス

同梱・配布する場合は次を満たしてください（`scripts/fetch-assets.mjs` が manifest に書き出します）。

> Colon, high mag. by **CoRus13**, **CC BY-SA 4.0**
> <https://creativecommons.org/licenses/by-sa/4.0/>
> 改変あり（表示サイズへの縮小と中央付近の切り出し、色分離によるヘマトキシリン／エオジン成分への分解、
> 状態モデルに応じた各成分の増減と再合成）

- CC BY-SA 4.0 は**継承**を求めます。この画像から作られた派生画像（ゲーム内で生成される完成画像を含む）は
  同ライセンスで扱ってください。
- **画像のライセンスと、本リポジトリのソースコードのライセンス（MIT）は別のものです。** 混同しないでください。

## C. 参照した資料（再配布していない）

| ID | 資料 | 使い方 | この環境からの直接取得 |
|----|------|--------|----------------------|
| S1 | Newcomer Supply — *Hematoxylin Stain, Harris Modified*<br><https://www.newcomersupply.com/product/hematoxylin-stain-harris-modified/> | **手順の順番と処理条件の基準** | 不可（403）。Web 検索経由で記述を確認 |
| S2 | Leica Biosystems — *H&E Staining Overview: A Guide to Best Practices*<br><https://www.leicabiosystems.com/knowledge-pathway/he-staining-overview-a-guide-to-best-practices/> | 機序の説明 | 不可（403）。Web 検索経由 |
| S3 | Leica Biosystems — *H&E Basics Part 4: Troubleshooting H&E*<br><https://www.leicabiosystems.com/knowledge-pathway/he-basics-part-4-troubleshooting-he/> | トラブルの因果の向き | 不可（403）。Web 検索経由 |
| S4 | Wikimedia Commons — *Colon, high mag.jpg* / CoRus13 / CC BY-SA 4.0 | 完成画像の基礎（**未取得**） | 不可（403） |
| S5 | Paul Marienfeld — *Staining jars with tray of steel*<br><https://www.marienfeld-superior.com/staining-jars-2789.html> | 槽の外寸（蓋込み 105×85×70 mm）とラック形状の**参考**。写真は転載していない | 不可（403）。寸法はブリーフ記載値を採用 |
| S6 | Paul Marienfeld — *HistoBond adhesive microscope slides*<br><https://www.marienfeld-superior.com/histobond-microscope-slides.html> | スライド寸法 約 76×26×1 mm の参考 | 不可（403）。寸法はブリーフ記載値を採用 |
| S7 | Paul Marienfeld — *Cover glasses square and rectangular*<br><https://www.marienfeld-superior.com/cover-glasses-thickness-no-1.html> | カバーガラス 24×50 mm の参考。**厚みは資料と差異あり（PROTOCOL.md 7.）** | 不可（403）。Web 検索で No.1 = 0.13〜0.16 mm を確認 |
| S8 | scikit-image — *Separate colors in immunohistochemical staining*<br><https://scikit-image.org/docs/0.25.x/auto_examples/color_exposure/plot_ihc_color_separation.html> | 色分離の技術参考。コードは移植していない（Ruifrok & Johnston の H&E ベクトルのみ使用） | 不可（403） |
| S9 | MDN Pointer Events / WebGL best practices、three.js MeshPhysicalMaterial、Playwright emulation | 実装の技術参考 | 不可（403） |

## D. 依存ライブラリ

| パッケージ | バージョン | ライセンス | 用途 |
|-----------|-----------|-----------|------|
| three | 0.180.0 | MIT | 3D 描画 |
| vite | 7.x | MIT | ビルド |
| typescript | 5.9.x | Apache-2.0 | 型検査 |
| vitest | 3.x | MIT | 単体テスト |
| @playwright/test | 1.56.x | Apache-2.0 | 操作テスト |

`three/examples/jsm/environments/RoomEnvironment.js`（three 同梱、MIT）を環境反射の生成に使用しています。

## E. 本リポジトリのライセンス

ソースコード・生成テクスチャ・合成音・構造模式図は **MIT** です。
上記 B の実写画像を追加した場合、その画像と派生画像には **CC BY-SA 4.0** が適用されます。
