const { indicatorState } = require('./view-state');
const { createDeferredRefresh } = require('./deferred-refresh');
const { attachDrag, detachDrag, constrain, createFrame, applyAppearance, registerWindow } = require('./portable-window');
const { t } = require('../i18n/i18n');
const { attachInfoPopover } = require('./info-popover');
const { closeActiveHoverMenu } = require('./hover-menu');
const { sectionHelp } = require('./section-help');
const { renderInfoContent } = require('./info-content');
const { setIcon } = require("obsidian");

const nodeLabel = (id) =>
  id.startsWith("#") ? id : id.split("/").pop().replace(/\.md$/, "");

// メイン小窓のDOMと表示操作を管理する。Vaultデータの取得・変更は呼び出し元のAPIへ委譲する。
// state は表示位置・表示状態・セクション開閉状態を共有し、保存は saveState に依頼する。
class MainWindowView {
  constructor(api) {
    this.api = api;
    this.deferredRefresh = createDeferredRefresh(() => api.refresh());
    this.state = api.state;
    this.CSS_CLASS = api.CSS_CLASS;
    this.EVENT = api.EVENT;
    this.ICON = api.ICON;
    this.UI_TEXT = api.UI_TEXT;
    this.el = null;
    this.sig = "";
    this.indicatorButtons = {};
  }

  build() {
    this.el = document.body.createDiv({ cls: this.CSS_CLASS.alpWin });
    this.stacking = registerWindow(this.el);
    applyAppearance(this.el, this.state.windowAppearance);
    const p = this.state.pos;
    if (p) {
      this.el.style.left = `${p.x}px`;
      this.el.style.top = `${p.y}px`;
      this.el.style.right = "auto";
    }
    this.applyVisibility();
    this.render(true);
    this.constrainToViewport();
  }

  dispose() {
    this.deferredRefresh.cancel();
    closeActiveHoverMenu();
    this.stacking?.dispose();
    if (this.el) detachDrag(this.el);
    this.el?.remove();
    this.el = null;
  }

  resetPosition() {
    this.state.pos = null;
    if (!this.el) return;
    this.el.style.left = "auto";
    this.el.style.top = "48px";
    this.el.style.right = "16px";
    this.constrainToViewport();
  }

  updateDetailButton() {
    for (const [kind, button] of Object.entries(this.indicatorButtons)) {
      const visible = this.api.isDetailVisible(kind);
      button.setAttr("aria-expanded", String(visible));
      const openIcon = button.querySelector('.alp-indicator-open-icon');
      if (openIcon) setIcon(openIcon, visible ? 'x' : 'arrow-up-right');
      button.setAttr("aria-label", t('window.toggle', { name: kind === 'orphan' ? t('common.orphan') : t('window.analysis'), action: visible ? t('window.closeAction') : t('window.openAction') }));
    }
  }

  constrainToViewport() {
    const el = this.el;
    if (!el || el.classList.contains(this.CSS_CLASS.isHidden) || el.classList.contains('tk-docked-window')) return;
    this.state.pos = constrain(el, window);
  }

  applyVisibility() {
    closeActiveHoverMenu();
    this.el?.toggleClass(this.CSS_CLASS.isHidden, !this.state.visible);
    if (!this.state.visible) this.api.hideInfoPopovers();
    if (this.state.visible) this.api.scheduleMaint();
    if (this.state.visible) this.stacking?.bringToFront();
    if (this.el) this.api.placeWindow?.(this.el, this.state.visible);
  }

  iconButton(parent, icon, label, onClick) {
    const btn = parent.createEl('button', {
      cls: `clickable-icon alp-btn${icon === "refresh-cw" ? " alp-refresh-btn" : ""}`,
      attr: { type: 'button', title: label, "aria-label": label },
    });
    setIcon(btn, icon);
    if (icon === "refresh-cw" && this.api.isMaintSpinning())
      btn.addClass("is-loading");
    btn.addEventListener(this.EVENT.click, (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  collapseSections(body, closed) {
    let save = false;
    for (const section of body.querySelectorAll('details[open]')) {
      const key = section.dataset.sectionKey;
      if (key && this.state.sections[key] !== false) {
        this.state.sections[key] = false;
        save = true;
      }
      closed?.add(section);
      section.open = false;
    }
    // 状態を先にそろえるので、各項目のtoggleで保存を繰り返さない。
    if (save) this.api.saveState();
  }

  section(parent, key, title, { collapsible = true } = {}) {
    const sectionRow = parent.createDiv({ cls: "alp-sec-row" });
    const det = sectionRow.createEl(collapsible ? "details" : "section", { cls: "alp-sec" });
    det.dataset.sectionKey = key;
    if (collapsible) det.open = this.state.sections[key];
    const summary = det.createEl(collapsible ? "summary" : "h3", { cls: "alp-sec-summary" });
    summary.createSpan({ cls: "alp-sec-title", text: title });
    const actions = sectionRow.createSpan({ cls: "alp-section-actions" });
    det.sectionActions = actions;
    const info = actions.createSpan({ cls: "alp-info-wrap" });
    const infoButton = info.createEl("button", {
      cls: "alp-info-button",
      text: "i",
      attr: {
        type: "button",
        "aria-label": t('window.infoTitle', { title }),
        "aria-expanded": "false",
      },
    });
    const tip = document.body.createDiv({ cls: "alp-info-popover" });
    applyAppearance(tip, { fontScale: this.state.windowAppearance?.fontScale });
    tip.dataset.owner = sectionRow.closest(".alp-detail-win")?.dataset.infoOwner ?? "main";
    renderInfoContent(tip, sectionHelp(key, t));
    attachInfoPopover(infoButton, tip);
    if (collapsible) det.addEventListener(this.EVENT.toggle, () => {
      if (this.state.sections[key] === det.open) return;
      this.state.sections[key] = det.open;
      this.api.saveState();
      const owner = det.closest(".alp-detail-win") ?? this.el;
      // 詳細窓は本文のcaptureリスナーで入れ子のtoggleも処理する。
      if (owner === this.el) this.fitWindowToContent(owner);
    });
    return det;
  }

  nodeChip(parent, id) {
    const chip = parent.createSpan({ cls: "alp-chip", text: nodeLabel(id) });
    chip.setAttr("title", id);
    if (!id.startsWith("#")) {
      chip.addClass(this.CSS_CLASS.isLink);
      chip.addEventListener(this.EVENT.click, () => this.api.openLink(id));
    }
  }

  render(force = false, renderDetails = true) {
    const pointerHeldAt = this.api.getPointerHeldAt();
    if (pointerHeldAt && Date.now() - pointerHeldAt < 2000) {
      this.deferredRefresh.schedule();
      return;
    }
    const el = this.el;
    if (!el) return;
    const r = this.api.getResult();
    const ext = this.api.computeExternal();
    const { managedCount, orphanCount, crossingCount } = indicatorState(r);
    const sig = JSON.stringify([
      t('common.areaCandidates'), managedCount, orphanCount, crossingCount,
      r?.maintenanceReady, r?.noteIsolation?.ready, r?.analysisError,
      ext && [ext.file.path, ext.main, ext.entries.map(e => [e.raw, e.kind, e.label])],
    ]);
    if (!force && sig === this.sig) {
      if (renderDetails) this.api.renderDetail?.();
      return;
    }
    this.sig = sig;

    const scrollTop = el.querySelector(".alp-win-body")?.scrollTop ?? 0;
    // 部分グラフは分析窓が所有する。メイン窓の更新では破棄しない。
    this.api.removeInfoPopovers("main");
    closeActiveHoverMenu();
    el.empty();

    el.toggleClass("has-issues", (orphanCount ?? 0) > 0);

    // 共通ライブラリで枠を生成し、Obsidian固有の中身だけをここで描く。
    const { head, body } = createFrame(el, { headClass: 'alp-win-head', bodyClass: 'alp-win-body' });
    body.addEventListener('scroll', closeActiveHoverMenu);
    body.addEventListener('toggle', event => {
      if (!event.target.open) closeActiveHoverMenu();
    }, true);
    const mark = head.createSpan({ cls: "alp-win-mark" });
    setIcon(mark, this.ICON.network);
    head.createSpan({ cls: "alp-win-title", text: "Topology Keeper" });
    this.iconButton(head, 'fold-vertical', t('window.collapseAll'), () => {
      closeActiveHoverMenu();
      this.collapseSections(body);
      this.fitWindowToContent();
    });
    this.iconButton(head, "settings", t("window.openSettings"), () =>
      this.api.openSettings(),
    );
    this.iconButton(head, "locate-fixed", t("window.resetMain"), () => {
      this.resetPosition();
      this.api.saveState();
    });
    this.enableDrag(el, head);

    const indicators = body.createDiv({ cls: "alp-indicators" });
    const orphan = indicators.createEl("button", {
      cls: `alp-indicator alp-indicator-orphan${(orphanCount ?? 0) > 0 ? " is-alert" : ""}`,
    });
    const orphanIcon = orphan.createDiv({ cls: "alp-indicator-icon" });
    setIcon(orphanIcon, this.ICON.unplug);
    orphan.createDiv({
      cls: "alp-indicator-value",
      text: orphanCount == null ? "…" : String(orphanCount),
    });
    orphan.createDiv({ cls: "alp-indicator-label", text: this.UI_TEXT.orphan });
    orphan.setAttr("title", r?.noteIsolation ? t("window.isolationTip", {
      notes: r.noteIsolation.ready ? r.noteIsolation.isolated.length : '…',
      managed: r.maintenanceReady !== false ? managedCount : '…',
    }) : t("window.managedTip"));

    const crossing = indicators.createEl("button", {
      cls: "alp-indicator alp-indicator-crossing",
    });
    const crossingIcon = crossing.createDiv({ cls: "alp-indicator-icon" });
    setIcon(crossingIcon, this.ICON.branch);
    crossing.createDiv({
      cls: "alp-indicator-value",
      text: crossingCount == null ? "…" : String(crossingCount),
    });
    crossing.createDiv({
      cls: "alp-indicator-label",
      text: this.UI_TEXT.crossingCandidates,
    });
    crossing.setAttr(
      "title",
      t('window.areaTip', { count: crossingCount ?? '…' }),
    );

    this.indicatorButtons = { orphan, planar: crossing };
    for (const [kind, button] of Object.entries(this.indicatorButtons)) {
      button.setAttr("type", "button");
      button.createSpan({ cls: 'alp-indicator-open-icon', attr: { 'aria-hidden': 'true' } });
      button.addEventListener(this.EVENT.click, () => {
        if (this.api.isDetailVisible(kind)) this.api.closeDetail(kind);
        else this.api.openDetail(kind);
      });
    }
    this.updateDetailButton();
    const actions = body.createDiv({ cls: "alp-main-actions" });

    const add = actions.createEl("button", {
      cls: this.CSS_CLASS.alpActionButton,
      attr: { title: t("window.addFiles") },
    });
    setIcon(add.createSpan(), this.ICON.filePlus);
    const active = this.api.getActiveFile();
    const canAdd = this.api.isMainNote(active);
    add.disabled = !canAdd;
    add.setAttr(
      "aria-label",
      canAdd
        ? t("window.addFilesAria")
        : t("window.addFilesDisabled"),
    );
    add.addEventListener(this.EVENT.click, () => {
      const file = this.api.getActiveFile();
      if (this.api.isMainNote(file)) this.api.importFiles(file);
    });

    const suggest = actions.createEl("button", {
      cls: this.CSS_CLASS.alpActionButton,
      attr: { title: t("window.suggestTags") },
    });
    setIcon(suggest.createSpan(), this.ICON.tags);
    suggest.disabled = !canAdd;
    suggest.setAttr(
      "aria-label",
      canAdd
        ? t("window.suggestTagsAria")
        : t("window.suggestTagsDisabled"),
    );
    suggest.addEventListener(this.EVENT.click, () => {
      const file = this.api.getActiveFile();
      if (this.api.isMainNote(file)) this.api.suggestTags(file);
    });

    const webThumbnail = actions.createEl('button', {
      cls: this.CSS_CLASS.alpActionButton,
      attr: { type: 'button', title: t('window.webThumbnail'),
        'aria-label': t(canAdd ? 'window.webThumbnail' : 'window.webThumbnailDisabled') },
    });
    setIcon(webThumbnail.createSpan(), 'globe');
    webThumbnail.disabled = !canAdd;
    webThumbnail.addEventListener(this.EVENT.click, () => this.api.createWebThumbnail());

    const createBase = actions.createEl("button", {
      cls: this.CSS_CLASS.alpActionButton,
      attr: { title: t("window.createBase") },
    });
    setIcon(createBase.createSpan(), this.ICON.base);
    createBase.setAttr(
      "aria-label",
      t("window.createBaseAria"),
    );
    createBase.addEventListener(this.EVENT.click, () =>
      this.api.createBaseStandalone(),
    );

    const manager = body.createEl("details", { cls: "alp-file-management" });
    manager.dataset.sectionKey = 'fileManagement';
    manager.open = !!this.state.sections.fileManagement;
    const managerSummary = manager.createEl("summary", {
      cls: "alp-file-management-summary",
    });
    const folderIcon = managerSummary.createSpan();
    setIcon(folderIcon, this.ICON.folder);
    managerSummary.createSpan({ text: t("window.fileManagement") });
    manager.addEventListener(this.EVENT.toggle, () => {
      if (this.state.sections.fileManagement === manager.open) return;
      this.state.sections.fileManagement = manager.open;
      this.api.saveState();
      this.fitWindowToContent();
    });
    this.api.renderExternal(manager, ext);

    body.scrollTop = scrollTop;
    this.fitWindowToContent();
    if (renderDetails && this.api.isDetailVisible()) this.api.renderDetail();
  }

  fitWindowToContent(targetEl = this.el) {
    const el = targetEl;
    const body = el?.querySelector(
      targetEl?.classList.contains(this.CSS_CLASS.alpDetailWin)
        ? ".alp-detail-body"
        : ".alp-win-body",
    );
    const head = el?.querySelector(
      targetEl?.classList.contains(this.CSS_CLASS.alpDetailWin)
        ? ".alp-detail-head"
        : ".alp-win-head",
    );
    if (!el || !body || !head || el.classList.contains(this.CSS_CLASS.isHidden) || el.classList.contains('tk-docked-window'))
      return;
    // 内容高をブラウザに測らせ、下限・上限はCSSで制限する。
    // JSでmin-heightを固定すると下限設定が効かなくなるため、旧インライン値も解除する。
    el.style.minHeight = "";
    el.style.height = "auto";
    // 内容の展開で画面一杯まで伸びた場合も、タイトルバーごと画面内に収める。
    constrain(el, el.ownerDocument.defaultView);
  }

  enableDrag(el, handle) {
    // 汎用部品はObsidianの設定を知らない。完了座標を既存stateへ渡す接着部分。
    // 戻り値の解除関数は詳細窓側が保持し、再描画・閉じる・破棄時に呼ぶ。
    return attachDrag(el, handle, { canDrag: () => !el.classList.contains('tk-docked-window'), onPosition: async position => {
      if (el.classList.contains(this.CSS_CLASS.alpDetailWin))
        (el.setWindowPosition ?? this.api.setDetailPosition)(position);
      else this.state.pos = position;
      await this.api.saveState();
    } });
  }

}

module.exports = MainWindowView;
