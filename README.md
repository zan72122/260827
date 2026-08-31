# かみのツリー / Paper Honeycomb Tree

4 歳児が iPhone / iPad のブラウザで遊べる、**紙のハニカムツリーを指で開閉するだけ**の
3D おもちゃです。ぺちゃんこの紙束が、指の動きに合わせて連続的に大きなツリーへ開きます。

- 一本指で紙の端を左右にドラッグすると、紙の隙間が連鎖的に開く
- 途中で止めればその形のまま保持され、指を戻せば同じ紙が畳まれる
- 完成モデルへの差し替えはなし。0% も 50% も 100% も**同じ 1 つの構造の連続変形**
- ステージ選択・収集・飾り付け・ショップ・タイマー・失敗はありません

## 動かす

```bash
npm install
npm run dev       # http://127.0.0.1:5173
```

本番ビルドと確認:

```bash
npm run build
npm run preview   # http://127.0.0.1:4173
```

iPhone / iPad から見るには、同じ LAN の PC で
`npx vite preview --host 0.0.0.0 --port 4173` を実行し、
PC の LAN アドレスにアクセスしてください。

`dist/` は静的ファイルのみです。バックエンド・API キー・アカウントは不要です。

### URL パラメータ

| パラメータ | 効果 |
|---|---|
| `?q=low` / `?q=medium` / `?q=high` | 画質を固定（既定は端末から推定） |

画面右下の「画質」ボタンでも切り替えられます。画質は描画解像度・影・遠景の小物だけを
変え、**紙の構造（48 枚・24 段・セル形状）はどの画質でも同一**です。

## 自動検証

```bash
npm run preview &          # 4173 で配信
npm run verify             # 実ブラウザで実際にドラッグして検証
node tests/shoot.mjs poses # 0/25/50/75/100% × 正面/斜め/背面/上方 の確認画像
```

検証内容と結果は [docs/VERIFICATION.md](docs/VERIFICATION.md) を参照してください。
参照資料の入手可否と設計値の区別は [docs/REFERENCE.md](docs/REFERENCE.md) にあります。

## 構造

```
src/
  config.ts              寸法と設計値（すべてここに集約）
  paper/
    profile.ts           ツリーのシルエット（枝の段）
    honeycombGeometry.ts 48 枚の薄紙を 1 つの静的ジオメトリに構築
    paperMaterial.ts     開度 1 uniform から頂点位置と法線を解析的に生成
    profileBoard.ts      厚紙の表紙
    tree.ts              薄紙 + 表紙 + 留め具 + 吊り糸
  scene/
    stand.ts             卓上の支持ジグ
    workshop.ts          机・クランプ・棚・紙の在庫
  cameraRig.ts           縦画面 / 横画面それぞれの構図
  input.ts               Pointer Events、開度の相対マッピング
  audio.ts               開閉速度に追従する紙擦れ音
  quality.ts, textures.ts, lighting.ts, hint.ts, app.ts, main.ts
```

開閉はシェーダー内の 1 つの uniform で行われるため、何度開閉しても
ジオメトリもイベントリスナーも増えません。
