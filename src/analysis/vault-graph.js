const { readNoteMetadata } = require('../shared/note-metadata');

// ノートとタグの無向グラフを作る。頂点はノートのパス、またはタグ（"#タグ" 形式の文字列）。
// 辺は「ノート間の実リンク」と「ノートとタグの付与関係」。管理フォルダ内のファイルは頂点にしない。
//
// 【入力】
//   app.metadataCache.resolvedLinks : { リンク元パス: { リンク先パス: 個数 } }（解決済みの本文リンク）。
//   app.vault.getMarkdownFiles()    : Markdown ノートの TFile 配列。画像や .base は頂点にしない。
//   app.metadataCache.getFileCache(file) : CachedMetadata（未解析なら null）。getAllTags に渡す。
//   getAllTags(cache) : "#" 付きのタグ文字列の配列（frontmatter の tags と本文の #タグの両方）。無ければ null。
//   isManaged(file) / isManagedPath(path) : 管理フォルダ内か。該当するものは頂点にも辺にも入れない。
// 【出力】 Map<頂点ID, Set<隣接する頂点ID>>（無向なので辺は両方向に入る）。
//   頂点IDは、ノートなら Vault 相対パス（例 "資料/メモ.md"）、タグなら "#" 付きの文字列（例 "#資料"）。
//   "#" で始まるかどうかでタグとノートを区別している（graph-view.js の nodeLabel や、
//   findNonPlanar の bad の集計など）。他のモジュールの tag-suggest.js は "#" を外して扱うので、混同しないこと。
//   自分自身への辺は作らない。
//   戻り値は maintenance-workflow.js が maint.graphAdj に保持し、findNonPlanar の入力と、
//   graph-view.js のグラフ描画（周辺ノードの取得）に使われる。保存はしない。
function buildAdjacency(app, { isManaged, isManagedPath, getAllTags }) {
  const adj = new Map();
  const addEdge = (u, v) => {
    if (!u || !v || u === v) return;
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(v)) adj.set(v, new Set());
    adj.get(u).add(v);
    adj.get(v).add(u);
  };
  const resolved = app.metadataCache.resolvedLinks;
  const { files, caches } = readNoteMetadata(app, file => !isManaged(file));
  const markdownPaths = new Set(files.map(file => file.path));

  for (const file of files) {
    for (const dest of Object.keys(resolved[file.path] ?? {})) {
      // グラフはノートとタグを対象にする。画像・BaseなどのVault内ファイルは頂点にしない。
      if (markdownPaths.has(dest) && !isManagedPath(dest))
        addEdge(file.path, dest);
    }
    const cache = caches.get(file.path);
    for (const tag of (cache ? getAllTags(cache) : null) ?? []) {
      addEdge(file.path, tag);
    }
  }
  return adj;
}

module.exports = { buildAdjacency };
