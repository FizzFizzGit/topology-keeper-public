const { t } = require('./i18n');
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
    new Notice(t("cleanup.paused"));
    return false;
  }
  return true;
}

async function trashOne(plugin, file) {
  if (!canDelete(plugin)) return;
  if (
    !confirm(
      t('cleanup.noteConfirm', { name: plugin.metaLabel(file) }),
    )
  )
    return;
  if (!canDelete(plugin)) return;
  if (!await trashMeta(plugin, file)) {
    new Notice(t("cleanup.noteChanged"));
    plugin.maintenance.run(true);
    return;
  }
  new Notice(t("cleanup.trashed"));
  plugin.maintenance.run(true);
}

// 一括削除は、一覧の表示後に Vault が変わっている可能性があるため、確認前に再判定する。
async function trashOrphans(plugin) {
  if (!canDelete(plugin)) return;
  const fresh = plugin.computeOrphans();
  if (fresh.orphans.length + fresh.strayThumbs.length === 0) {
    new Notice(t("cleanup.none"));
    plugin.maintenance.run(true);
    return;
  }
  if (
    !confirm(
      t('cleanup.bulkConfirm', { notes: fresh.orphans.length, images: fresh.strayThumbs.length }),
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
    t('cleanup.bulkDone', { notes: removedMeta, images: removedThumbs }),
  );
  plugin.maintenance.run(true);
}

async function trashOrphanBase(plugin, file) {
  if (!canDelete(plugin)) return;
  const fresh = plugin.computeOrphans();
  if (!fresh.orphanBases.some((candidate) => candidate.path === file.path)) {
    new Notice(t("cleanup.baseChanged"));
    plugin.maintenance.run(true);
    return;
  }
  if (
    !confirm(
      t('cleanup.baseConfirm', { name: plugin.baseLabels.get(file.path) ?? file.basename, path: file.path }),
    )
  )
    return;
  if (!canDelete(plugin) || !plugin.computeOrphans().orphanBases.some(candidate => candidate.path === file.path)) return;
  await plugin.app.fileManager.trashFile(file);
  new Notice(t("cleanup.baseDone"));
  plugin.maintenance.run(true);
}

async function trashOrphanBases(plugin) {
  if (!canDelete(plugin)) return;
  const fresh = plugin.computeOrphans();
  if (fresh.orphanBases.length === 0) {
    new Notice(t("cleanup.noBases"));
    plugin.maintenance.run(true);
    return;
  }
  if (
    !confirm(
      t('cleanup.basesConfirm', { count: fresh.orphanBases.length, paths: fresh.orphanBases.map(file => file.path).join('\n') }),
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
    t('cleanup.basesDone', { count: removed }),
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
