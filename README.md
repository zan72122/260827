# 氷のずっと奥から

4歳児向けの iPhone / iPad モバイルWebゲーム。
氷床深部のアイスコアドリルを、**一回の連続上スワイプ**で雪面まで引き上げ、
コアバレルから約1mの氷柱を取り出す。

- 題材: 南極・グリーンランドのアイスコア掘削（中型電動コアドリル、コア径98mm）
- 文章・数値の表示なし。指を上へ引くだけ。
- 設計の根拠と採用寸法は [DESIGN.md](DESIGN.md) を参照。

## 実行

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 型チェック + 本番ビルド (dist/)
```

実機で遊ぶ場合は `npm run dev -- --host` でLAN公開し、iPhone/iPadのSafariで開く。

## 操作

- 画面のどこでも、指1本で上へ引く（蛇行してよい。速さは関係ない）
- 指を離すと近い安定状態で保持。9割まで引くと最後まで自動で進む
- 下へ引くと深部へ戻れる
- 完了後は ↺ ボタンで最初から

## デバッグ

- `?debug` を付けると進捗スライダーとFPS表示
- コンソール: `icecore.setProgress(0.5)` / `icecore.getProgress()` / `icecore.setQuality(0..3)`

## テスト

```bash
npm run dev &            # dev サーバーを起動しておく
npm run shots            # 8進捗 × iPhone/iPad 縦横 のスクリーンショット (shots/)
node scripts/behavior-test.mjs   # 実タッチ入力での操作テスト + FPS計測
```

ヘッドレスChromium（SwiftShader）を使用。`PLAYWRIGHT_BROWSERS_PATH` の
Chromium か `/opt/pw-browsers/chromium` が必要。
