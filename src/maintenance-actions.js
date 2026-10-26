const { Notice, TFile } = require("obsidian");

// 孤立メタノート・サムネイル・Base の削除操作をまとめる。
//
// 【責務】表示中の判定結果をそのまま削除には使わず、操作のたびに最新の状態を再計算する。
//   確認後は Obsidian の fileManager.trashFile を使うため、移動先は利用者の削除設定に従う。
//   判定は maintenance-check.js、実行と表示更新は maintenance-workflow.js に委譲し、
//   このファイルは確認と削除操作を担当する。
// 【入力】 plugin は main.js のプラグイン本体。computeOrphans / metaLabel /
//   maintenance と、app / baseLabels を提供する。各 file は Vault 内の Obsidian TFile。
// 【出力】 Vault ファイルをゴミ箱へ移動し、Notice を表示してメンテナンス結果を再計算する。
//   確認をキャンセルした場合は何も削除しない。空の対象や古くなった単体Baseも削除せず再計算する。

// メタノートと、その cover が指すサムネイル（あれば）を削除する。
async function trashMeta(plugin, file) {
  const fresh = plugin.computeOrphans();
  if (plugin.importWorkflow?.importing || plugin.state?.pendingImport || fresh.ready === false ||
      !fresh.orphans.some(candidate => candidate.path === file.path)) return false;
  const thumb = plugin.externalFileActions.getThumbnailForMeta(file);
  const shared = thumb instanceof TFile && plugin.app.vault.getMarkdownFiles().some(note =>
    note.path !== file.path && (
      plugin.externalFileActions.getThumbnailForMeta(note)?.path === thumb.path ||
      plugin.app.metadataCache.resolvedLinks[note.path]?.[thumb.path] > 0
    ),
  );
  await plugin.app.fileManager.trashFile(file);
  if (thumb instanceof TFile && !shared) {
    const after = plugin.computeOrphans();
    if (after.ready !== false && after.strayThumbs.some(candidate => candidate.path === thumb.path))
      await plugin.app.fileManager.trashFile(thumb);
  }
  return true;
}

function canDelete(plugin) {
  if (plugin.importWorkflow?.importing || plugin.state?.pendingImport || plugin.computeOrphans().ready === false) {
    new Notice("取り込み中・未完了の取り込み・ノートの解析待ちのため削除できません。取り込みの復旧と解析完了後に再チェックしてください。");
    return false;
  }
  return true;
}

async function trashOne(plugin, file) {
  if (!canDelete(plugin)) return;
  if (
    !confirm(
      `「${plugin.metaLabel(file)}」のメタノートをゴミ箱へ移動します（サムネイルがあれば一緒に）。よろしいですか？`,
    )
  )
    return;
  if (!canDelete(plugin)) return;
  if (!await trashMeta(plugin, file)) {
    new Notice("このメタノートは孤立していないか、既に削除されています。");
    plugin.maintenance.run(true);
    return;
  }
  new Notice("🗑️ ゴミ箱へ移動しました。");
  plugin.maintenance.run(true);
}

// 一括削除は、一覧の表示後に Vault が変わっている可能性があるため、確認前に再判定する。
async function trashOrphans(plugin) {
  if (!canDelete(plugin)) return;
  const fresh = plugin.computeOrphans();
  if (fresh.orphans.length + fresh.strayThumbs.length === 0) {
    new Notice("削除対象はありません。");
    plugin.maintenance.run(true);
    return;
  }
  if (
    !confirm(
      `メタノート ${fresh.orphans.length} 件（対応サムネイル含む）と、` +
        `単独サムネイル ${fresh.strayThumbs.length} 件をゴミ箱へ移動します。よろしいですか？`,
    )
  )
    return;

  if (!canDelete(plugin)) return;
  let removedMeta = 0;
  let removedThumbs = 0;
  for (const file of fresh.orphans) if (await trashMeta(plugin, file)) removedMeta++;
  for (const thumb of fresh.strayThumbs) {
    if (!canDelete(plugin)) break;
    if (plugin.computeOrphans().strayThumbs.some(candidate => candidate.path === thumb.path)) {
      await plugin.app.fileManager.trashFile(thumb);
      removedThumbs++;
    }
  }
  new Notice(
    `🗑️ メタノート ${removedMeta} 件、単独サムネイル ${removedThumbs} 件を削除しました。`,
  );
  plugin.maintenance.run(true);
}

async function trashOrphanBase(plugin, file) {
  if (!canDelete(plugin)) return;
  const fresh = plugin.computeOrphans();
  if (!fresh.orphanBases.some((candidate) => candidate.path === file.path)) {
    new Notice("このBaseは孤立していないか、既に削除されています。");
    plugin.maintenance.run(true);
    return;
  }
  if (
    !confirm(
      `孤立Base「${plugin.baseLabels.get(file.path) ?? file.basename}」をゴミ箱へ移動しますか？\n${file.path}`,
    )
  )
    return;
  if (!canDelete(plugin) || !plugin.computeOrphans().orphanBases.some(candidate => candidate.path === file.path)) return;
  await plugin.app.fileManager.trashFile(file);
  new Notice("🗑️ 孤立Baseをゴミ箱へ移動しました。");
  plugin.maintenance.run(true);
}

async function trashOrphanBases(plugin) {
  if (!canDelete(plugin)) return;
  const fresh = plugin.computeOrphans();
  if (fresh.orphanBases.length === 0) {
    new Notice("孤立Baseはありません。");
    plugin.maintenance.run(true);
    return;
  }
  if (
    !confirm(
      `孤立Base ${fresh.orphanBases.length} 件をゴミ箱へ移動しますか？\n\n${fresh.orphanBases.map((file) => file.path).join("\n")}`,
    )
  )
    return;
  let removed = 0;
  for (const file of fresh.orphanBases) {
    if (!canDelete(plugin)) break;
    if (plugin.computeOrphans().orphanBases.some(candidate => candidate.path === file.path)) {
      await plugin.app.fileManager.trashFile(file);
      removed++;
    }
  }
  new Notice(
    `🗑️ 孤立Base ${removed} 件をゴミ箱へ移動しました。`,
  );
  plugin.maintenance.run(true);
}

module.exports = {
  trashMeta,
  trashOne,
  trashOrphans,
  trashOrphanBase,
  trashOrphanBases,
};
