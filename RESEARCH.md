# 現実調査メモ（一般化された架空空港のための資料確認）

一つの空港を複製せず、複数資料から「一般的な手荷物工程」を合成しました。
保安設備は実在の見た目（産業機械の外装＋搬送ローラー＋表示灯＋遮蔽カーテン）に
とどめ、架空のSF装置にはしていません。

## 確認した工程（チェックイン → 航空機）

1. **チェックイン**：計量スケール一体のインジェクションベルト。バーコード
   （またはRFID）のタグが発行され、以後の全工程でかばんを識別する。
2. **搬送**：ゴム幕（ストリップカーテン）を抜けて旅客から見えない搬送網へ。
   下りベルトで地下のソートホールへ降りる構成が一般的。ベルトには亜鉛めっき鋼の
   サイドガード、光電センサー（フォトアイ）、保守通路が伴う。
3. **インライン検査**：EDS（爆発物検知装置）をコンベア経路に組み込む
   「インラインスクリーニング」。米国では CBIS と呼ばれる。装置は白色系の
   産業筐体で、搬送ローラーが貫通し、両端に遮蔽フラップ、上部に状態表示灯。
   投入前にバッグアライナー／タグリーダーが置かれることが多い。
4. **仕分け**：高速ソーター（プッシャー、パドルダイバータ、クロスベルト、
   チルトトレイ等）が行先別にかばんを分岐する。
5. **メイクアップ**：便ごとの集積区画。カルーセルまたはレーンで、作業者が
   手荷物台車（バゲッジカート／ドーリー）へ積み替え、タグ車（トーイング
   トラクター）が牽引する。
6. **ベルトローダー**：自走式のベルトコンベア車。ブーム先端は機体の貨物扉
   シル高さ（概ね 1.1–2.4 m、機種により最大 5 m 超）へ昇降する。
   ナローボディ機ではバラ積み（bulk loading）が主流。
7. **貨物室**：ナローボディの下部貨物室（バルクホールド）。曲面の内張り、
   フレーム、床、カーゴネット、扉付近の床ローラー。前方貨物扉は主翼より
   前方に位置し、外開き上方へ開く。

## 出典（一次資料・業界資料）

- [Wikipedia: Baggage handling system](https://en.wikipedia.org/wiki/Baggage_handling_system)
- [BEUMER Group: How does a baggage handling system work?](https://www.beumergroup.com/knowledge/airport/how-did-the-baggage-handling-system-develop-and-which-systems-are-used-in-airports-today/)
- [BEUMER Group: Integrated screening (ICS)](https://www.beumergroup.com/knowledge/airport/integrated-screening-with-ics-and-what-it-means-for-airports-and-authorities/)
- [Daifuku ATec: Checked Baggage Screening (CBIS/CBRA)](https://daifukuatec.com/airport-technologies/baggage-handling-systems/checked-baggage-screening)
- [MATREX Airport: Baggage sorting](https://www.matrex-airport.com/en/products-and-solutions/baggage-sorting/)
- [Aviatopia: How Baggage Handling Works at Airports](https://aviatopia.com/guides/baggage-handling)
- [Aviatopia: Baggage Belt Loader](https://aviatopia.com/glossary/baggage-belt-loader)
- ベルトローダーの到達高さ・用途の一般値：GSEベンダー各社の製品情報
  （例：[Global GSE](https://www.globalgse.com/used-gse/aircraft-belt-loaders-for-sale)、
  [Orientitan towable belt loader](https://uld-equipment.com/3-2-towable-belt-loader.html)）

## ゲームへの反映

- 検査装置は「白い筐体＋貫通ローラー＋鉛フラップ＋緑/橙の表示灯＋制御盤」。
  内部は暗い搬送トンネルに控えめな走査光とタグ読取りLEDのみ。
- 分岐は「パドルダイバータ＋分岐ローラーデッキ」。直進レーンには他の
  かばんが流れ続け、因果（アームが押す→進路が変わる）を画で示す。
- メイクアップ区画に手荷物台車2台とタグ車を配置し、屋外にはリードイン
  ライン・停止線・機材制限線・カラーコーン・ウインドソック・チョークを
  「実際に必要な箇所だけ」描画。
- 貨物扉は主翼前方、シル高さ約2.9 m。ローダーのブーム角約26度。
