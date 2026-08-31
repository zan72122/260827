# 開発用スクリプト

本編には含まれない、確認用の小さな道具です。どちらも `npm run preview` を
先に起動しておいてから使います。

```sh
# 任意の構図で 1 枚撮る (縦横は viewport から決まる)
node tools/shot.mjs <幅> <高さ> '<構図の JSON か "-">' <出力パス> ['<デバッグ用コード>']
node tools/shot.mjs 390 844 - /tmp/a.png 'o.setTravel(0.45); o.advance(3)'

# 描画負荷の計測 (draw call / 三角形 / DPR / フレームレート)
DSF=1 node tools/perf.mjs
```

`shot.mjs` の第 5 引数は `window.__orgel` を `o` として受け取る式です。
`__orgel` は開発と E2E のためだけの窓口で、機構の状態を外から作るのに使います
(発音そのものは常に通過イベントからしか起きません)。
