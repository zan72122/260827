# いっぴつ コンクリート — One-Stroke Concrete Printer

子どもの一筆が、実寸大のコンクリート建築へ立ち上がるモバイルWebゲーム。

基礎スラブに指で一筆描くと、ガントリー式の建設用3Dコンクリートプリンターが
その軌跡を追い、湿ったセメント系材料を押し出して同じ輪郭を何層も積み重ねる。
右へ膨らませた線は右へ膨らんだ壁に、左へ凹ませた線は左へ凹んだ建物になる。
入力はテンプレートに置換されない。

- 対象: 4歳児（文章を読まなくても遊べる）
- 端末: iPhone / iPad（モバイルSafari）、縦・横両対応
- 技術: TypeScript + Three.js (WebGL 2)、バックエンドなし

## 遊び方

1. スラブの枠内に指で一筆描く（閉じても開いてもよい。開いた線は湾曲壁やベンチになる）
2. プリンターが開始点へ移動し、第1層をほぼ実時間で印刷（接写）
3. 2〜3層の追従ののち、タイムラプスで壁が立ち上がる（角では減速して見せる）
4. 作業員の安全確認。閉曲線なら屋根パネルをクレーンで設置
5. 上空からの比較（左上のカードに自分の一筆）→ もう一回

## 開発

```bash
npm install
npm run dev        # 開発サーバー
npm run build      # 型検査 + production build
npm run preview    # dist/ を配信
```

## 検証

```bash
npm run build
node test/verify.mjs          # 全デバイス×6形状の実プレイ検証
node test/verify.mjs --quick  # 短縮版
```

iPhone/iPad の縦横 4 構成で入力中・第1層・積層中・完成のスクリーンショットを
`verification/shots/` に保存し、統計を `verification/report.json` に書き出す。

## ドキュメント

- 基準寸法と一次資料: [docs/TECH_NOTES.md](docs/TECH_NOTES.md)
