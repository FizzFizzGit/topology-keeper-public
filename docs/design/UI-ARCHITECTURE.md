# Window UI boundaries / ウィンドウUIの責務

This document describes the current extraction. These are local CommonJS modules,
not a published package. Storage keys and analysis algorithms remain unchanged.

現時点の分割結果を記録する。公開パッケージにはしていない。保存キーと分析ロジックは維持する。

| Layer / 層 | Modules | Owns / 責務 |
| --- | --- | --- |
| Portable window / 汎用の窓 | `src/windows/portable-window.js`, `.css` | Frame, dragging, viewport constraints, appearance variables, cleanup / 枠・移動・画面内補正・表示変数・解除 |
| Portable help / 汎用の説明 | `src/windows/info-content.js`, `src/windows/info-popover.js` | Text-only formatting and popover interaction / 説明文の書式と開閉・配置・タイマー解除 |
| App settings / アプリ設定 | `src/settings/window-appearance.js` | Defaults, dropdown definitions, saved-value normalization / 初期値・選択肢・保存値の正規化 |
| Settings persistence / 設定保存 | `src/settings/settings-persistence.js` | Ordered JSON snapshots and save-failure reporting / 呼び出し時のJSONの写しを順次保存・失敗通知 |
| Settings UI / 設定画面 | `src/settings/window-settings.js` | Controls, live application, save requests / 設定項目・即時反映・保存要求 |
| Help content / 説明内容 | `src/windows/section-help.js` | Translated content selection / 翻訳済み説明の選択 |
| Isolation content / 孤立の本文 | `src/analysis/isolation-content.js` | Read-only ordinary-note list and generated-data maintenance controls / 通常ノートの一覧と生成データ管理 |
| Analysis content / 分析の本文 | `src/analysis/analysis-content.js` | Analysis lists, expansion state, connection references and graph selection requests / 分析一覧・展開状態・接続参照・グラフ選択要求 |
| Analysis presentation / 分析の表示データ | `src/analysis/analysis-presentation.js` | Localized titles, parent lookup and actual connection destinations / 翻訳済みタイトル・親索引・実際の接続先 |
| Host views / 利用側の窓 | `src/windows/main-window.js`, `src/windows/detail-window.js` | App-specific content and window state / 内容・開閉・位置のアプリ状態 |
| Window host / 窓の管理 | `WindowHost` in `src/windows/window-host.js` | Owns the views, sidebar placement, pointer hold and cleanup / 各窓の生成・サイドパネル配置・押下中の描画保留・終了処理 |
| View state / 表示状態 | `src/windows/view-state.js`, `src/windows/deferred-refresh.js` | Indicator values and cancellable deferred refresh / 表示件数と解除可能な再描画予約 |
| Graph selection and layout / グラフの抽出・配置 | `src/graph-view/graph-selection.js`, `src/graph-view/graph-layout.js`, `src/graph-view/graph-geometry.js` | Pure graph selection, initial layout and geometry / 表示対象・初期配置・幾何計算 |
| Graph host and interaction / グラフの窓・操作 | `PartialGraphWindow` in `src/graph-view/graph-view.js`, `src/graph-view/graph-window-position.js`, `src/graph-view/graph-interaction.js` | Graph panel lifecycle, position persistence, interaction and SVG composition / 部分グラフ窓の開閉・位置保存・操作の解除・SVG描画 |
| Tag suggestion / タグ提案 | `TagSuggestionWorkflow` in `src/tags/tag-suggestion-workflow.js` | Cache invalidation, suggestion dialog and applying selected tags / キャッシュの無効化・提案画面・選択タグの反映 |
| Obsidian adapter / Obsidian連携 | `src/main.js`, `src/settings/settings-tab.js` | Vault operations, persistence and lifecycle / Vault操作・保存・プラグインの寿命 |

## Reusing the window / 窓の再利用

Copy `portable-window.js`, `portable-window.css`, and `LICENSE` for the standalone
shell. The browser script exposes `PortableWindow`; CommonJS exports the same API.
See `examples/portable-window.html?lang=en` or `?lang=ja` for a working example.
The standalone shell retains its own defaults; Topology Keeper defaults to a width range of 280–640px and a 280px minimum height; actual height grows with content up to the configured maximum.

単独の窓は上記3ファイルをコピーして使う。中身は利用側からDOMで追加する。
`createWindow` は一式、`createFrame` はヘッダーと本文だけが必要な場合に使う。
`closeLabel` に翻訳済みラベルを渡せる。ライブラリは言語判定や保存を行わない。

For a docked pane, `createFrame` can provide just the header and body. Do not attach
dragging, fixed positioning or viewport constraints to a pane managed by the host.
Content renderers still use some Obsidian DOM helpers and callbacks; they have not
yet become browser-independent components.

サイドペインでは枠と本文だけを使い、ドラッグ・fixed配置・画面補正は付けない。
本文の一部にはObsidianのDOM補助が残っており、分析一覧全体の移植は未完了。

## Lifecycle / 寿命

- Call the drag disposer before replacing a header, closing a window or removing it.
- Dispose info popovers before removing their DOM; this also cancels delayed closing.
- Keep content and translation selection outside generic components.
- The host handles errors from asynchronous persistence callbacks.
- Main-window updates never dispose the analysis graph. The analysis view owns
  graph replacement and cleanup; unchanged results retain node positions.
- Maintenance cancellation invalidates both job generations and resolves pending
  animation waits. Deferred view refreshes are cancelled when their owner closes.
- Graph interaction cleanup removes listeners and cancels auto-pan frames.

ヘッダー再生成前と窓の破棄時には解除処理を呼ぶ。説明ポップオーバーもDOMだけ消さず、
待機タイマー・ボタンイベントを解除する。保存失敗の扱いは利用アプリが担当する。
孤立・メイン窓の更新では部分グラフを破棄しない。分析窓の結果・選択変更時にだけ再生成する。
処理停止時には孤立・分析双方の待機を解除し、古い処理からの画面更新を防ぐ。

## Changes on 2026-11-02 / 今回の整理

Window API construction moved out of `main.js`. Graph selection, initial layout,
interaction and window geometry now have separate owners, preserving existing
layout parameters. Main indicator comparisons use displayed counts rather than
serializing full analysis results. Detailed views still compare their own content.
Cleanup scans share one note/cache snapshot per call; destructive actions continue
to recheck current references before deletion. Tests share an explicit source-loader
helper, and syntax checks include nested test helpers.

窓への接続は`window-host.js`、部分グラフの計算・操作・位置保存は専用モジュールへ移動した。
メインの差分比較は表示する件数を中心にし、詳細は独自に変更を確認する。
孤立判定内の一覧・キャッシュを共有するが、削除前の最新参照の再確認は省略しない。
共通のテスト読込補助を導入し、模擬対象は各テストで明示する。

Analysis rendering accepts only the current parent-based hierarchy. The old
standalone area-list branch and fallback indicator counts have been removed.
The underlying direct-link area builder remains part of the current algorithm.

分析表示は現行の親エリアを持つ階層モデルに統一した。旧形式の独立一覧・件数の補完分岐は削除した。
直接リンクの素領域を作る内部処理は、現行の階層モデル作成でも使用するため維持する。

Folder settings now have one source of truth: each plugin instance's
`state.folders`. Loading settings has no mutable module-level side effects.
Consumers receive that object or a getter; updates and resets preserve its
identity. `note-metadata.js` shares per-check metadata acquisition and property
link resolution, while isolation, cleanup and graph rules remain separate.

管理フォルダは`state.folders`だけで管理し、読み込みによるグローバル変数の変更を廃止した。
更新・リセットは参照を維持する。`note-metadata.js`で取得とリンク解決だけを共通化し、
通常ノートの孤立・管理データの保護・グラフの判定規則は混同しない。

Retired `maint*` settings, the old default-color migration and the single-query
graph-color migration are no longer interpreted. Help content uses the current
hierarchy without a legacy-result branch. Unknown saved keys may remain in the
JSON but are not consulted by these features; no cleanup migration is added.

旧`maint*`設定の読み替え、旧既定色の置換、旧グラフ色グループの移行は削除済み。
説明文も現行階層へ統一した。未知の保存キー自体はJSONに残り得るが動作には使わず、
削除のための移行処理は追加しない。

Analysis models contain structural facts rather than Japanese display titles.
`analysis-presentation.js` creates localized labels and selection titles per render
without mutating those models, sharing area/parent indexes and destination rules.
Current classification help keys use `classification` rather than `legacy`.

分析結果は構造情報、表示名の生成は表示データ層へ分けた。同じ日本語タイトルを分析側と
表示側で二度生成しない。実際の親同士の接続先も、この層で一貫して取得する。

All plugin `saveData` calls pass through one persistence queue. Each call copies
JSON immediately and writes in invocation order; failed writes reject to awaiting
workflows and are also reported centrally. Later saves continue after a failure.
Import completion removes its journal from live state before enqueueing the save
and restores it in memory if saving fails, avoiding resurrection in concurrent saves.
This is not a transaction across settings, Markdown and images. Pending asynchronous
writes cannot be guaranteed if the host process exits abruptly.

`data.json`は保存要求時点の写しを作り、呼び出し順に書く。失敗しても後続は継続し、
通知とawait側への失敗の返却を両立する。取り込み完了時は先に実行状態から復旧記録を外し、
失敗時にメモリへ戻す。ノート・画像を含む一括トランザクションや、強制終了時の保存完了は保証しない。

## Next extraction candidates / 後続の分割候補

1. Adapt `analysis-content.js` to a pane when needed. It receives an application
   API and three host callbacks: `requestRender`, `fitContent`, and `constrain`.
   Translation and icon helpers are injected. It owns expansion and connection
   references, while the host owns window lifecycle and selected graph state.
2. Keep SVG composition in `graph-view.js`; extract further only where a concrete
   responsibility or second consumer warrants it. Avoid a file per small function.
3. Add docking as a host adapter; avoid teaching the portable library about Vaults,
   leaves, note files or Obsidian settings.

分析本文は独立ビューへ分離済み。ホストには再描画・サイズ調整・位置補正の3操作を要求し、
翻訳・アイコンも注入する。展開状態と接続参照は本文、窓の寿命と選択グラフ状態はホストが持つ。
グラフの主要な責務も分離済み。小さな関数ごとのファイル分割は避ける。
ドッキングはホスト側で実装する。

## Validation / 検証

Run `npm run check`, `npm test`, and `npm run build`. Automated tests cover language
keys, saved appearance, content formatting, popover keyboard/hover/cleanup, window
position and ordinary-note deletion protection. Real Obsidian visual checks remain
necessary for theme interactions, English wrapping and narrow viewports.

日英の文言・保存設定・説明の書式・開閉・解除は自動確認。テーマ依存の見た目、英語の
折り返し、狭い画面での表示は実Obsidianで別途確認する。
