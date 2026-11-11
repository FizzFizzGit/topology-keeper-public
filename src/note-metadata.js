// 1回の判定に使うノート一覧とメタデータを揃える。永続キャッシュではない。
// 呼び出すたびに読み直すため、削除直前の再確認を古い結果で代用しない。
function readNoteMetadata(app, include = () => true) {
  const files = app.vault.getMarkdownFiles().filter(include);
  const caches = new Map(files.map(file => [file.path, app.metadataCache.getFileCache(file)]));
  return { files, caches, ready: files.every(file => !!caches.get(file.path)) };
}

// linksプロパティの内部リンクだけを解決する共通入口。
// その参照を「接続」「削除保護」のどちらに使うかは各判定側が決める。
function resolvePropertyLink(app, file, raw) {
  const match = /^\[\[([^\]|#]+)/.exec(String(raw ?? '').trim());
  return match ? app.metadataCache.getFirstLinkpathDest(match[1], file.path) : null;
}

function propertyLinkTargets(app, file, cache, property) {
  const targets = [];
  for (const raw of [].concat(cache?.frontmatter?.[property] ?? [])) {
    const target = resolvePropertyLink(app, file, raw);
    if (target) targets.push(target);
  }
  return targets;
}
module.exports = { readNoteMetadata, propertyLinkTargets, resolvePropertyLink };
