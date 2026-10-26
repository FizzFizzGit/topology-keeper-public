const { TFile } = require("obsidian");
const { pathFromSource } = require("./source-url");
const generatedName = file => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(md|base|webp)$/i.test(file.name);

// 孤立判定はUIから切り離し、Vaultとメタデータキャッシュだけを参照する。
// topologyIdではなく、Obsidianの実リンクとFrontmatterのlinksから参照関係を判定する。
//
// 【入力】
//   app.metadataCache.resolvedLinks
//     Obsidian が解決済みの本文リンクを持つ辞書。形式は
//       { "<リンク元のVault相対パス>": { "<リンク先のVault相対パス>": <そのリンクの個数> } }
//     存在しないノートへのリンク（未解決リンク）は含まれない。ここでは個数は使わず、
//     リンク先のパスだけを「参照されている」印として使う。
//   app.metadataCache.getFileCache(file)
//     Markdown ノートの解析結果（CachedMetadata）。未解析なら null。
//     .frontmatter はノート先頭の YAML を JS オブジェクトにしたもので、YAML が無ければ undefined。
//   app.vault.getMarkdownFiles() / getFiles()
//     Vault 内の TFile 配列。file.path は Vault ルートからの相対パス（区切りは常に "/"）。
//   CONFIG.properties.links
//     frontmatter の中でリンク一覧を持つキー名（既定 "links"）。値は ["[[名前]]", ...] の配列
//     （単一の文字列で書かれていることもあるので [].concat で配列に揃える）。
//     "[[名前|別名]]" や "[[名前#見出し]]" の形でも、"|" と "#" より前の「名前」だけを使う。
//   FOLDERS        : 管理フォルダ名 { meta, thumb, base }（plugin-settings.js の実行時の値）。
//   getAllTags     : Obsidian の getAllTags。getAllTags(cache) は "#" 付きのタグ文字列の配列
//                    （例 ["#資料", "#研究/分類"]）で、タグが無ければ null を返す。
//                    ここで渡す cache は「各メタノート自身」のキャッシュ（メインノートのものではない）。
//   inFolder(file, folder) : file.path が "folder/" で始まるかどうか。
//   getThumbnailForMeta(meta) : メタノートの frontmatter.cover から解決したサムネイルの TFile。無ければ null。
//   listBases()    : 管理フォルダ内の .base ファイルの TFile 配列。
//
// 【出力】 { orphans, strayThumbs, orphanBases }。いずれも TFile の配列。
//   orphans      : どこからも参照されず、メタノート自身にタグも付いていないメタノート
//   strayThumbs  : どのメタノートの cover からも参照されていないサムネイル（管理フォルダ内の .webp）
//   orphanBases  : どこからも参照されていない Base
//   呼び出し元（maintenance-workflow.js）が maint.result に保持し、小窓の「孤立」件数と詳細窓の一覧に使う。
//   一括削除・孤立Baseの削除は、この結果を使い回さず、実行時に再計算した結果を使う（main.js の trashOrphans など）。
//   この関数自体はファイルの変更・削除を一切しない（読み取り専用）。
function computeOrphans(app, {
  CONFIG,
  FOLDERS,
  getAllTags,
  inFolder,
  getThumbnailForMeta,
  listBases,
}) {
  // 未解析ノートがある間は、参照が無いという判断をしない。
  if (app.vault.getMarkdownFiles().some(file => !app.metadataCache.getFileCache(file)))
    return { orphans: [], strayThumbs: [], orphanBases: [], ready: false };
  // used: 「どこかから参照されている」ファイルの Vault 相対パスの集合。
  // 自分自身へのリンク（src と dest が同じ）は参照とみなさない。
  const used = new Set();
  for (const [src, dests] of Object.entries(app.metadataCache.resolvedLinks)) {
    for (const dest of Object.keys(dests)) {
      if (dest !== src) used.add(dest);
    }
  }

  // BaseはYAMLの links プロパティ経由で参照されることもあるため、明示的なリンクも調べる。
  // links の要素は "[[<uuid>.base]]" のような文字列で、getFirstLinkpathDest(名前, リンク元のパス) が
  // リンク先の TFile（解決できなければ null）を返す。ここでは .base に解決できたものだけを used に加える。
  for (const note of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(note)?.frontmatter;
    for (const raw of [].concat(fm?.[CONFIG.properties.links] ?? [])) {
      const match = /^\[\[([^\]|#]+)/.exec(String(raw).trim());
      if (!match) continue;
      const target = app.metadataCache.getFirstLinkpathDest(match[1], note.path);
      if (target instanceof TFile) used.add(target.path);
    }
  }

  const metaFiles = app.vault.getMarkdownFiles().filter((file) => inFolder(file, FOLDERS.meta));
  // メタノートの frontmatter.cover（"[[_thumbs/<uuid>.webp]]" 形式）が指しているサムネイルのパス集合。
  // ここに無い .webp が「単独サムネイル」になる。
  const referencedThumbs = new Set();
  for (const meta of app.vault.getMarkdownFiles()) {
    const thumb = getThumbnailForMeta(meta);
    if (thumb) referencedThumbs.add(thumb.path);
  }

  const orphans = metaFiles.filter((file) => {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    if (frontmatter?.topologyKeeper !== true &&
        !(generatedName(file) && pathFromSource(frontmatter?.source))) return false;
    if (used.has(file.path)) return false;
    // 孤立扱いにしない条件: メタノート「自身」にタグが1つでも付いていること。
    //   見ているのは、このメタノートのキャッシュ（getFileCache(file)）から getAllTags で得たタグ
    //   （メタノート自身の frontmatter の tags と本文中の #タグ）。リンク先の領域やメインノートのタグではない。
    //   このプラグインは、メタノートにタグを書き込まない（import-workflow.js の createMetaNote が書くのは source / title / base / cover だけ）。
    //   手動でタグを付けて管理するメタノートは削除候補から除外する。
    const cache = app.metadataCache.getFileCache(file);
    return !(cache && (getAllTags(cache) ?? []).length > 0);
  });
  // サムネイルは取り込み時に WebP で生成する（import-workflow.js が thumbnail.js を呼ぶ）ので、対象は .webp のみ。
  const strayThumbs = app.vault.getFiles().filter((file) =>
    inFolder(file, FOLDERS.thumb) &&
    file.extension === "webp" &&
    generatedName(file) &&
    !used.has(file.path) &&
    !referencedThumbs.has(file.path),
  );
  const orphanBases = listBases().filter((file) => generatedName(file) && !used.has(file.path));
  return { orphans, strayThumbs, orphanBases, ready: true };
}

module.exports = { computeOrphans };
