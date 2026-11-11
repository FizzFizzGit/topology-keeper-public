# Topology Keeper 0.30.0

## 変更点

- ワーシャル・フロイド法で求めた最短ホップ数と境界票率から距離エリアを表示します。分析窓で素領域、結合領域、エリア間のタグ接続を確認できます。共有タグだけでつながる1ノートの成分は、独立した距離エリアの件数から外します。
- 前回の分析結果と最短ホップ表を保存します。再計算では、接続変更の影響を受ける始点の距離を更新します。
- 結合領域を平均接続数と平面性の4区分で色分けします。標準グラフにも同じ色を反映できます。平面性の判定には、部分グラフに表示するノートとタグの接続を使います。
- メイン・分析・孤立・部分グラフを、独立ウィンドウまたは左右いずれかのサイドパネルで開けます。メイン・分析・孤立のタイトルバーには一括折りたたみを追加しました。
- URLを入力してWebページのサムネイルを撮影し、画像リンクとしてノート本文に挿入できます。保存幅と画像内のタイトル枠を選べます。孤立した生成画像は管理データの整理に表示されます。

## 利用条件

距離エリアの分析上限は256頂点です。境界票率のしきい値は2.5%、結合領域の「密」の基準は1頂点あたり平均3.5本です。標準グラフの着色はObsidianの内部APIを使います。開発・自動テスト環境はWindowsです。

## Changes

- Distance areas use shortest hop counts from Floyd–Warshall and votes on graph boundaries. Expand an area to inspect primitive areas, combined areas, and tag connections to other areas. A one-note component connected only through shared tags is omitted from the distance area count.
- The plugin saves the previous analysis and shortest-hop table. Recalculation updates distances from sources affected by connection changes.
- Combined areas are colored by average connections and planarity. The same colors can be applied to Obsidian’s standard graph. Planarity is tested on the note and tag connections shown in the partial graph.
- Open the main, analysis, isolation, and partial graph windows as floating windows or in either sidebar. The main, analysis, and isolation title bars include a collapse-all button.
- Capture a web page thumbnail from a URL and insert it into a note as a linked image. Choose its saved width and whether to draw the title on the image. Orphaned generated images appear in managed data cleanup.

## Limits

Distance area analysis supports up to 256 vertices. The boundary vote threshold is 2.5%, and combined areas are dense at 3.5 or more connections per vertex on average. Standard graph coloring uses Obsidian’s internal API. Development and automated tests run on Windows.
