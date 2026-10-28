# Topology Keeper 0.29.0

## Changes

- English UI for settings, commands, analysis, partial graphs, tag suggestions, external file operations, and recovery dialogs. The UI follows Obsidian's language; reload the plugin after changing languages.
- Improved area analysis: inspect primitive areas and tag-based combined areas inside each finding. Direct-link communities can remain separate when a shared tag connects them.
- Automatic structural assessment of tags reduces the influence of broad connections without removing tags or requiring a stopword list.
- Hotspots and the remaining undetermined areas are displayed separately. Repeated connections link back to their first occurrence.
- Partial graphs remember position and size, center small graphs, and distinguish constituent areas by color. Standard graph coloring includes original notes along contracted paths.
- Ordinary-note isolation checks cover the vault, with separate tag-only connections and an optional folder for notes that may remain isolated. Generated-data cleanup is grouped separately.
- Repeated tag suggestions reuse a bounded in-memory corpus and index, with invalidation when source data changes.
- More consistent disclosure controls, buttons, indicators, backgrounds, and layouts in both languages.

## 変更点

- 設定・コマンド・各ウィンドウ・タグ提案・外部ファイル操作・復旧ダイアログを英語化。Obsidianの表示言語に追従します。言語変更後はプラグインを再読み込みしてください。
- 各エリア内の素領域と、タグでつながる結合領域を表示。共通タグが追加されても、直接リンクによる独立したまとまりを維持できるよう改善しました。
- タグの構造的な役割を自動評価し、横断的な接続の影響を調整。タグの削除やストップワード登録は不要です。
- ホットスポットと、それ以外の平面性未判定部分を分けて表示。同じ結合領域の再登場時は、最初の表示を展開します。
- 部分グラフの位置・サイズを記憶し、小さなグラフを中央へ配置。素領域の色分けと、縮約前のノートを含む標準グラフの着色を改善しました。
- Vault全体の通常ノートを孤立判定の対象にし、タグのみの接続を分離。孤立していてもよいノートのフォルダを設定できます。管理データの整理は別の折り畳みにまとめました。
- タグ提案の再実行では上限付きのメモリキャッシュを利用し、元データの変更時に無効化します。
- 開閉ボタン・インジケータ・背景色・折り返しなど、日英UIの表示を統一しました。

## Notes / 注意点

Area analysis is heuristic; it does not guarantee a semantic partition or planarity of the entire vault. Shared notes may appear in several areas. Broad-tag estimates remain provisional. Already-open standard graph views may need reopening to reflect colors.

エリア分析は近似的な処理であり、意味的な分類やVault全体の平面性を保証しません。同じノートが複数領域に現れる場合があります。タグの役割推定は暫定的です。既に開いている標準グラフは、着色の反映に開き直しが必要な場合があります。

Development and automated tests run on Windows. Compatibility on other operating systems and comprehensive manual regression testing remain unverified. Existing external-file move/recovery limitations still apply. See RELEASE-CHECKLIST.md.
