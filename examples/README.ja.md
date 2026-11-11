# ウィンドウ部品の独立デモ

[English](README.md) | 日本語

`portable-window.html` をブラウザで直接開く。インストール・ビルド・Obsidian・通信は不要。
ページ上部のリンクで日英を切り替える（`?lang=ja` / `?lang=en`）。

見出しのドラッグ、閉じて再表示、追加項目の開閉、ブラウザの縮小を確認できる。
位置はこのデモ自身がlocalStorageへ保存する。保存できない環境でも表示・操作は可能。

再利用時は `src/portable-window.js`、`src/portable-window.css` とルートの `LICENSE` をコピーする。
内容・翻訳・保存処理は利用アプリ側で渡す。`closeLabel` は閉じるボタンの翻訳済みラベル。
アプリが画面を破棄する際は `destroy()` を呼び、監視とイベントを解除する。

詳しいAPIは `portable-window.js` の日本語コメントと [English API guide](README.md)、
モジュールの分担は [UI-ARCHITECTURE.md](../docs/design/UI-ARCHITECTURE.md) を参照。
