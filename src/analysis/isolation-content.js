// 孤立窓の本文だけを描く。窓の位置・開閉・ドラッグ・分析計算は持たない。
// 入力は保持済みの判定結果とapi。ノートを開く・削除する操作はapiへ委譲する。
// 通常ノートの一覧には削除操作を置かず、生成データの管理操作と区別する。
function renderOrphans(body, r, orphanCount, api, t) {
  if (!r.noteIsolation) return renderManagedOrphans(body, r, orphanCount, api, t);
  const isolation = r.noteIsolation;
  const sec = api.section(body, 'orphan', t('isolation.title', { count: isolation.isolated.length }));
  if (!isolation.ready) {
    sec.createDiv({ cls: api.CSS_CLASS.alpEmpty, text: t("isolation.waiting") });
  } else {
    const list = (parent, files) => {
      for (const file of files.slice(0, 100)) {
        const row = parent.createDiv({ cls: api.CSS_CLASS.alpRow });
        const name = row.createEl('button', { cls: 'alp-note-isolation-link', text: file.basename ?? file.path,
          attr: { type: 'button', title: file.path } });
        name.addEventListener(api.EVENT.click, () => api.openFile(file));
      }
      if (files.length > 100) parent.createDiv({ cls: api.CSS_CLASS.alpSmall, text: t('isolation.more', { count: files.length - 100 }) });
    };
    list(sec, isolation.isolated);
    if (!isolation.isolated.length) sec.createDiv({ cls: api.CSS_CLASS.alpEmpty, text: t("isolation.none") });
    if (isolation.tagOnly.length) {
      const tags = sec.createEl('details', { cls: 'alp-orphan-fold' });
      tags.createEl('summary', { text: t('isolation.tagOnly', { count: isolation.tagOnly.length }) });
      list(tags, isolation.tagOnly);
    }
    if (isolation.allowed.length) {
      const allowed = sec.createEl('details', { cls: 'alp-orphan-fold' });
      allowed.createEl('summary', { text: t('isolation.excluded', { count: isolation.allowed.length }) });
      list(allowed, isolation.allowed);
    }
  }
  const managed = api.section(body, 'managedOrphan', t('isolation.managedCount', {
    count: r.maintenanceReady === false ? '…' : orphanCount,
  }));
  renderManagedOrphans(managed, r, orphanCount, api, t, { embedded: true });
}

function renderManagedOrphans(body, r, orphanCount, api, t, { embedded = false } = {}) {
  const sec = embedded ? body.createDiv({ cls: 'alp-managed-data-content' }) : api.section(
    body,
    "managedOrphan",
    t('isolation.managedTitle', { notes: r.orphans.length, images: r.strayThumbs.length, bases: r.orphanBases.length }),
  );
  if (r.maintenanceReady === false) {
    sec.createDiv({ cls: api.CSS_CLASS.alpEmpty, text: t("isolation.waitingDeletion") });
    return;
  }
  if (orphanCount === 0) {
    sec.createDiv({ cls: api.CSS_CLASS.alpEmpty, text: api.UI_TEXT.clean });
    return;
  }

  if (r.orphans.length + r.strayThumbs.length > 0) {
    const bulk = sec.createEl("button", {
      text: t("isolation.deleteManaged"),
      cls: "mod-warning alp-wide",
    });
    bulk.addEventListener(api.EVENT.click, () => api.trashOrphans());
  }

  for (const file of r.orphans) {
    const row = sec.createDiv({ cls: api.CSS_CLASS.alpRow });
    const name = row.createSpan({
      cls: "alp-name is-link",
      text: api.metaLabel(file),
    });
    name.setAttr("title", file.path);
    name.addEventListener(api.EVENT.click, () =>
      api.openFile(file),
    );
    api.iconButton(row, "trash-2", t("isolation.trashNote"), () =>
      api.trashOne(file),
    );
  }
  if (r.strayThumbs.length > 0) {
    const names = r.strayThumbs
      .slice(0, 5)
      .map((f) => f.name)
      .join(", ");
    const more =
      r.strayThumbs.length > 5 ? t('isolation.moreItems', { count: r.strayThumbs.length - 5 }) : "";
    sec.createDiv({
      cls: api.CSS_CLASS.alpSmall,
      text: t('isolation.thumbnails', { names, more }),
    });
  }

  if (r.orphanBases.length > 0) {
    const bulkBases = sec.createEl("button", {
      text: t("isolation.deleteBases"),
      cls: "mod-warning alp-wide",
    });
    bulkBases.addEventListener(api.EVENT.click, () =>
      api.trashOrphanBases(),
    );
    for (const file of r.orphanBases) {
      const row = sec.createDiv({ cls: "alp-row alp-base" });
      const name = row.createSpan({
        cls: "alp-name is-link",
        text: api.getBaseLabel(file),
      });
      name.setAttr("title", file.path);
      name.addEventListener(api.EVENT.click, () =>
        api.openFile(file),
      );
      api.iconButton(row, "trash-2", t("isolation.trashBase"), () =>
        api.trashOrphanBase(file),
      );
    }
  }
}


module.exports = { renderOrphans };
