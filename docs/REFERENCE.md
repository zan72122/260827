# 参照資料について / About the reference material

## 確認できなかったもの

課題で指定された製造元のページと画像

- https://www.nakajo.co.jp/shop/buy/dennguriart/da008.htm
- https://www.nakajo.co.jp/shop/buy/dennguriart/dengriart_da008_03.jpg
- https://www.nakajo.co.jp/shop/buy/dennguriart/dengriart_da008_05.jpg

は、**この開発環境のネットワーク送出ポリシーによって遮断されており、閲覧できませんでした。**

```
$ curl https://www.nakajo.co.jp/shop/buy/dennguriart/dengriart_da008_03.jpg
curl: (56) CONNECT tunnel failed, response 403

$ curl -sS "$HTTPS_PROXY/__agentproxy/status"
  "recentRelayFailures": [
    { "kind": "connect_rejected",
      "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
      "host": "www.nakajo.co.jp:443" } ]
```

したがって **掲載画像そのものは未確認** です。参照写真はゲームに一切取り込んでいません
（そもそも取得できていません）。ロゴ・印刷面も再現していません。

## 課題文から与えられた実測値

| 項目 | 値 | 出典 |
|---|---|---|
| 高さ | 約 29 cm | 課題文 |
| 開いた幅 | 約 23 cm | 課題文 |

実装では高さ 0.291 m、最大半径 0.115 m（幅 0.230 m）としています。

## 一般的なハニカム紙構造として確認したこと

製品ページの代わりに、ハニカムペーパー装飾の一般的な製法を Web 検索で確認しました。

- 薄紙を重ね、**一枚おきにずらした糊線**で貼り合わせる。開くと糊線の間が離れ、
  六角形のセルが連鎖的に生まれる。
- ツリー型は**両端に厚紙の表紙**を貼り、開いて 360 度にしたところで
  両表紙を合わせて留める（磁石またはリボン・留め具）。
- 使わないときは本のように畳んで薄くなる。

出典:
- https://sweetredpoppy.com/how-to-make-honeycomb-paper-christmas-ornaments/
- https://www.hellowonderful.co/post/honeycomb-paper-christmas-tree/
- https://christines-crafts.com/make-gorgeous-honeycomb-paper-decorations/
- https://cuckoo4design.com/easy-honeycomb-ornament/
- https://www.anothercrew.com/items/77682306 （卓上ハニカムペーパーツリー、折りたたみ式）

## 本作の設計値（実測値ではありません）

以下は **確認できなかったため本作の設計値として決めた数値** です。
資料に記載された実測値と混同しないでください。すべて `src/config.ts` にあります。

| 項目 | 設計値 |
|---|---|
| 薄紙の枚数 | 48 枚 |
| 薄紙の厚み | 0.12 mm |
| 糊線の縦ピッチ（セル高さ） | 12.5 mm |
| 糊線の幅 | 3.0 mm |
| 糊線の段数 | 24 段 |
| 閉じたときの紙同士の間隔 | 0.24 mm（積層厚 約 11.5 mm） |
| 厚紙の厚み | 1.3 mm |
| 背（折り軸）の芯半径 | 3.5 mm |
| 最大展開角 | 352.3°（= 360° − セル 1 枚分。両表紙が背中合わせで合わさるため） |
| 枝の段数 | 5 段 + 幹 |
| 支持具（卓上ジグ）の寸法一式 | すべて設計値 |

支持具は**本作の操作補助**であり、伝統的な製造設備ではありません。
