// 外部ファイル欄のデータ取得・リンク解決。UIやプラグインの状態管理には依存しない。
const { filenameFromSource } = require("./source-url");

// メインノートの frontmatter.links を1件ずつ解決し、「何を指しているか」で分類して返す。
//
// 【入力】
//   app          : Obsidian の App。リンク先の解決とメタノートの frontmatter 取得に使う。
//   file         : メインノートの TFile。リンクを解決するときの「リンク元」として渡す。
//   frontmatter  : file の frontmatter オブジェクト（metadataCache.getFileCache(file)?.frontmatter）。
//                  YAML が無いノートでは undefined。
//   linksProperty: links を持つキー名（既定 "links"）。値は ["[[名前]]", ...] の配列、または単一の文字列。
//                  名前の中身は種類ごとに違う:
//                    Base          → "<uuid>.base"（拡張子つき）
//                    メタノート     → "<uuid>"（拡張子なし。管理フォルダ内の .md の basename）
//                    Vault内ファイル → Vault 相対パス（例 "資料/図1.png"）
//                  "[[名前|別名]]" "[[名前#見出し]]" でも "|" と "#" より前だけを名前として使う。
//   baseLabels   : Map<Base の Vault相対パス, 表示名>。main.js の loadBaseLabels が .base の先頭ビュー名から作る。
//   metaFolder   : メタノートの管理フォルダ名。
//
// 【出力】 エントリの配列。要素は { raw, kind, label, file?, source? }。
//   raw   : frontmatter に書かれていた元の値（"[[...]]" 文字列）。リンク解除（external-file-actions.js）が
//           links 配列から「同じ文字列」を取り除くために、解決結果とは別に保持している。
//   kind  : "missing"（リンク先が解決できない）／ "base"（.base ファイル）／
//           "asset"（管理フォルダのメタノート）／ "other"（それ以外の Vault 内ファイル）
//   label : 画面に出す名前。
//   file  : 解決できたときのリンク先の TFile（"missing" では無い）。
//   source: "asset" のときだけ。メタノートの frontmatter.source（元ファイルの場所を表す file:/// のURL）。
//   呼び出し元（main.js の computeExternal）が外部ファイル欄用に保持し、
//   external-files-view.js が kind ごとに行を描画する。
function collectExternalEntries({
  app,
  file,
  frontmatter,
  baseLabels,
  metaFolder,
  linksProperty,
}) {
  return [].concat(frontmatter?.[linksProperty] ?? []).map((raw) => {
    const match = /^\[\[([^\]|#]+)/.exec(String(raw).trim());
    const target = match
      ? app.metadataCache.getFirstLinkpathDest(match[1], file.path)
      : null;

    if (!target) return { raw, kind: "missing", label: String(raw) };
    if (target.extension === "base") {
      return {
        raw,
        kind: "base",
        file: target,
        label: baseLabels.get(target.path) ?? target.basename,
      };
    }
    if (target.path.startsWith(`${metaFolder}/`)) {
      // メタノートの frontmatter.source は、取り込み時に source-url.js の toSourceUrl が作った
      // "file:///C:/dir/a%20b.png" 形式のURL。元ファイルを開く（shell.openPath）ときに使う。
      const source = app.metadataCache.getFileCache(target)?.frontmatter?.source;
      return {
        raw,
        kind: "asset",
        file: target,
        source,
        label: source ? filenameFromSource(source) : target.basename,
      };
    }
    return { raw, kind: "other", file: target, label: target.basename };
  });
}

// メタノートのサムネイル（frontmatter.cover が指す画像）の TFile を返す。
//
// 【入力】
//   file        : メタノートの TFile。
//   thumbFolder : サムネイルの管理フォルダ名。
//   TFile       : Obsidian の TFile クラス（instanceof 判定用に呼び出し側から渡される）。
//   metadataCache から読む frontmatter.cover は、取り込み時に import-workflow.js の createMetaNote が
//   "[[<サムネイル管理フォルダ>/<uuid>.webp]]" の形（Vault 相対パスのウィキリンク）で書いた文字列。
// 【出力】 サムネイルの TFile。次のいずれかなら null:
//   cover が無い／リンクの形でない／解決できない／サムネイル管理フォルダの外のファイルを指している。
//   最後の条件により、cover がサムネイル管理フォルダの外の画像を指していても、
//   その画像はサムネイルとして扱われない（孤立判定や削除の対象にもならない）。
//   利用先: 孤立判定（maintenance-check.js）、メタノート削除時の同時削除、リンク解除時の同時削除。
function findMetaThumbnail({ app, file, thumbFolder, TFile }) {
  const cover = app.metadataCache.getFileCache(file)?.frontmatter?.cover;
  const match = /^\[\[([^\]|#]+)/.exec(String(cover ?? "").trim());
  if (!match) return null;
  const target = app.metadataCache.getFirstLinkpathDest(match[1], file.path);
  return target instanceof TFile && target.path.startsWith(`${thumbFolder}/`)
    ? target
    : null;
}

module.exports = { collectExternalEntries, findMetaThumbnail };
