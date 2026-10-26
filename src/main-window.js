const { setIcon } = require("obsidian");

const nodeLabel = (id) =>
  id.startsWith("#") ? id : id.split("/").pop().replace(/\.md$/, "");

// メイン小窓のDOMと表示操作を管理する。Vaultデータの取得・変更は呼び出し元のAPIへ委譲する。
// state は表示位置・表示状態・セクション開閉状態を共有し、保存は saveState に依頼する。
class MainWindowView {
  constructor(api) {
    this.api = api;
    this.state = api.state;
    this.CSS_CLASS = api.CSS_CLASS;
    this.EVENT = api.EVENT;
    this.ICON = api.ICON;
    this.UI_TEXT = api.UI_TEXT;
    this.el = null;
    this.sig = "";
    this.detailButton = null;
    this.detailButtonIcon = null;
  }

  build() {
    this.el = document.body.createDiv({ cls: this.CSS_CLASS.alpWin });
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
    if (!this.detailButton) return;
    const visible = this.api.isDetailVisible();
    const label = visible ? this.UI_TEXT.detailClose : this.UI_TEXT.detailOpen;
    this.detailButton.setAttr("title", label);
    this.detailButton.setAttr("aria-label", label);
    this.detailButton.setAttr("aria-expanded", String(visible));
    setIcon(this.detailButtonIcon, visible ? "x" : this.ICON.chart);
  }

  constrainToViewport() {
    const el = this.el;
    if (!el || el.classList.contains(this.CSS_CLASS.isHidden)) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);
    const left = Math.max(0, Math.min(rect.left, maxLeft));
    const top = Math.max(0, Math.min(rect.top, maxTop));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.right = "auto";
    this.state.pos = { x: left, y: top };
  }

  applyVisibility() {
    this.el?.toggleClass(this.CSS_CLASS.isHidden, !this.state.visible);
    if (!this.state.visible) this.api.hideInfoPopovers();
    if (this.state.visible) this.api.scheduleMaint();
  }

  iconButton(parent, icon, label, onClick) {
    const btn = parent.createDiv({
      cls: `clickable-icon alp-btn${icon === "refresh-cw" ? " alp-refresh-btn" : ""}`,
      attr: { title: label, "aria-label": label },
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

  section(parent, key, title) {
    const descriptions = {
      orphan:
        "管理対象のメタノート・サムネイル・Baseのうち、対応関係が見つからないものを表示します。\n\n削除操作の前に対象を確認してください。",
      bases:
        "現在のノートのリンクに登録されているBaseファイルです。\n\nBaseを開く、リンクをコピーする、ノートからリンクを外す操作ができます。リンクを外してもBaseファイル自体は削除されません。",
      assets:
        "現在のノートのリンクに登録されている関連ファイルです。\n\nメタノートを開く、リンクをコピーする、ノートからリンクを外す操作ができます。画像などの外部ファイルは元の場所で開きます。",
    };
    const sectionRow = parent.createDiv({ cls: "alp-sec-row" });
    const det = sectionRow.createEl("details", { cls: "alp-sec" });
    det.dataset.sectionKey = key;
    det.open = this.state.sections[key];
    const summary = det.createEl("summary", { cls: "alp-sec-summary" });
    summary.createSpan({ cls: "alp-sec-title", text: title });
    const info = sectionRow.createDiv({ cls: "alp-info-wrap" });
    const infoButton = info.createSpan({
      cls: "alp-info-button",
      text: "i",
      attr: {
        role: "button",
        tabindex: "0",
        "aria-label": `${title}の説明`,
        "aria-expanded": "false",
      },
    });
    const tip = document.body.createDiv({ cls: "alp-info-popover" });
    tip.dataset.owner = sectionRow.closest(".alp-detail-win") ? "detail" : "main";
    if (key === "planar") {
      tip.createEl("p", {
        text: "このチェックはグラフ構造の特徴を示すもので、分類の正誤を直接判定しません。",
      });
      tip.createEl("p", {
        text: "結果は次の4区分で整理します。関係密度は全ノード間にあり得る辺に対する割合で、現在は25%以上を「密」とする暫定基準です。",
      });
      const list = tip.createEl("ul");
      [
        "密な関係・平面：関係が整理されている可能性",
        "疎な関係・平面：情報や関連付けが少ない可能性",
        "密な関係・非平面：話題が複雑に交差している可能性",
        "疎な関係・非平面：少数の複雑な接続が影響している可能性",
      ].forEach((description) => list.createEl("li", { text: description }));
      tip.createEl("p", {
        text: "4区分は関係密度と平面性による目安です。平面性を確定できない領域は密度の変化からエリア分けし、密度が高いものをホットスポットとして表示します。いずれも分類の品質を保証しません。",
      });
    } else {
      tip.setText(descriptions[key] ?? "このセクションの情報を表示します。");
    }
    tip.setAttr("hidden", "hidden");
    let closeTimer = null;
    const hideTip = () => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        tip.setAttr("hidden", "hidden");
        infoButton.setAttr("aria-expanded", "false");
      }, 300);
    };
    const showTip = () => {
      clearTimeout(closeTimer);
      tip.removeAttribute("hidden");
      infoButton.setAttr("aria-expanded", "true");
      const rect = infoButton.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 24);
      tip.style.width = `${width}px`;
      tip.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
      tip.style.top = "12px";
      const tipHeight = tip.getBoundingClientRect().height;
      const top =
        rect.bottom + 6 + tipHeight <= window.innerHeight - 12
          ? rect.bottom + 6
          : Math.max(12, rect.top - tipHeight - 6);
      tip.style.top = `${top}px`;
    };
    infoButton.addEventListener("mouseenter", showTip);
    infoButton.addEventListener("mouseleave", hideTip);
    infoButton.addEventListener("focus", showTip);
    infoButton.addEventListener("blur", hideTip);
    tip.addEventListener("mouseenter", () => clearTimeout(closeTimer));
    tip.addEventListener("mouseleave", hideTip);
    infoButton.addEventListener(this.EVENT.keydown, (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showTip();
      }
      if (event.key === "Escape") {
        clearTimeout(closeTimer);
        tip.setAttr("hidden", "hidden");
        infoButton.setAttr("aria-expanded", "false");
      }
    });
    det.addEventListener(this.EVENT.toggle, () => {
      if (this.state.sections[key] === det.open) return;
      this.state.sections[key] = det.open;
      this.api.saveState();
      const owner = det.closest(".alp-detail-win")
        ? this.api.getDetailWindow()
        : this.el;
      this.fitWindowToContent(owner);
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

  render(force = false) {
    const pointerHeldAt = this.api.getPointerHeldAt();
    if (pointerHeldAt && Date.now() - pointerHeldAt < 2000) {
      setTimeout(() => this.api.refresh(), 300);
      return;
    }
    const el = this.el;
    if (!el) return;
    const r = this.api.getResult();
    const ext = this.api.computeExternal();
    const sig = JSON.stringify([
      r && [
        r.orphans.map((f) => f.path),
        r.strayThumbs.map((f) => f.path),
        r.orphanBases.map((f) => f.path),
        r.planar && [
          r.planar.k5,
          r.planar.k33,
          r.planar.definite,
          r.planar.suspect,
          r.planar.safe,
          r.planar.hotspots,
          r.planar.boundaryEdges,
          r.planar.meanDensityChange,
          r.planar.truncated,
        ],
      ],
      r?.analysisError,
      r?.maintenanceReady,
      ext && [
        ext.file.path,
        ext.main,
        ext.entries.map((e) => [e.raw, e.kind, e.label]),
      ],
    ]);
    if (!force && sig === this.sig) return;
    this.sig = sig;

    const scrollTop = el.querySelector(".alp-win-body")?.scrollTop ?? 0;
    this.api.disposeGraphListeners();
    this.api.removeInfoPopovers("main");
    el.empty();

    const orphanCount = r
      ? r.orphans.length + r.strayThumbs.length + r.orphanBases.length
      : null;
    const crossingCount = r?.planar
      ? r.planar.definite.length + r.planar.hotspots.length
      : null;
    el.toggleClass("has-issues", (orphanCount ?? 0) > 0);

    const head = el.createDiv({ cls: "alp-win-head" });
    const mark = head.createSpan({ cls: "alp-win-mark" });
    setIcon(mark, this.ICON.network);
    head.createSpan({ cls: "alp-win-title", text: "Topology Keeper" });
    this.iconButton(head, "refresh-cw", "再チェック", () =>
      this.api.runMaint(true, true),
    );
    this.iconButton(head, "locate-fixed", "小窓の位置をリセット", () => {
      this.resetPosition();
      this.api.saveState();
    });
    this.enableDrag(el, head);

    const body = el.createDiv({ cls: "alp-win-body" });
    const indicators = body.createDiv({ cls: "alp-indicators" });
    const orphan = indicators.createDiv({
      cls: `alp-indicator alp-indicator-orphan${(orphanCount ?? 0) > 0 ? " is-alert" : ""}`,
    });
    const orphanIcon = orphan.createDiv({ cls: "alp-indicator-icon" });
    setIcon(orphanIcon, this.ICON.unplug);
    orphan.createDiv({
      cls: "alp-indicator-value",
      text: orphanCount == null ? "…" : String(orphanCount),
    });
    orphan.createDiv({ cls: "alp-indicator-label", text: this.UI_TEXT.orphan });
    orphan.setAttr("title", "孤立した管理対象ファイルの件数");

    const crossing = indicators.createDiv({
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
      "非平面とホットスポットの数。詳しい根拠はエリア分析で確認できます。",
    );

    const actions = body.createDiv({ cls: "alp-main-actions" });
    const primaryActions = actions.createDiv({ cls: "alp-main-actions-row" });
    const detailButton = primaryActions.createEl("button", {
      cls: "alp-action-button alp-detail-open",
      attr: { title: this.UI_TEXT.detailOpen, "aria-expanded": "false" },
    });
    this.detailButton = detailButton;
    this.detailButtonIcon = detailButton.createSpan({
      cls: "alp-detail-open-icon",
    });
    this.updateDetailButton();
    detailButton.addEventListener(this.EVENT.click, () => {
      if (this.api.isDetailVisible()) this.api.closeDetail();
      else this.api.openDetail();
    });

    const add = primaryActions.createEl("button", {
      cls: this.CSS_CLASS.alpActionButton,
      attr: { title: "ファイル追加" },
    });
    setIcon(add.createSpan(), this.ICON.filePlus);
    const active = this.api.getActiveFile();
    const canAdd = this.api.isMainNote(active);
    add.disabled = !canAdd;
    add.setAttr(
      "aria-label",
      canAdd
        ? "現在のノートに外部ファイルを追加"
        : "通常のMarkdownノートを開くとファイルを追加できます",
    );
    add.addEventListener(this.EVENT.click, () => {
      const file = this.api.getActiveFile();
      if (this.api.isMainNote(file)) this.api.importFiles(file);
    });

    const secondaryActions = actions.createDiv({
      cls: "alp-main-actions-secondary",
    });
    const suggest = secondaryActions.createEl("button", {
      cls: this.CSS_CLASS.alpActionButton,
      attr: { title: "タグを提案" },
    });
    setIcon(suggest.createSpan(), this.ICON.tags);
    suggest.disabled = !canAdd;
    suggest.setAttr(
      "aria-label",
      canAdd
        ? "現在のノートにタグを提案"
        : "通常のMarkdownノートを開くとタグを提案できます",
    );
    suggest.addEventListener(this.EVENT.click, () => {
      const file = this.api.getActiveFile();
      if (this.api.isMainNote(file)) this.api.suggestTags(file);
    });

    const createBase = secondaryActions.createEl("button", {
      cls: this.CSS_CLASS.alpActionButton,
      attr: { title: "Baseを作成" },
    });
    setIcon(createBase.createSpan(), this.ICON.base);
    createBase.setAttr(
      "aria-label",
      "UUID付きのBaseファイルを単体作成し、タグ条件を設定",
    );
    createBase.addEventListener(this.EVENT.click, () =>
      this.api.createBaseStandalone(),
    );

    const manager = body.createEl("details", { cls: "alp-file-management" });
    manager.open = !!this.state.sections.fileManagement;
    const managerSummary = manager.createEl("summary", {
      cls: "alp-file-management-summary",
    });
    const folderIcon = managerSummary.createSpan();
    setIcon(folderIcon, this.ICON.folder);
    managerSummary.createSpan({ text: "ファイル管理" });
    manager.addEventListener(this.EVENT.toggle, () => {
      if (this.state.sections.fileManagement === manager.open) return;
      this.state.sections.fileManagement = manager.open;
      this.api.saveState();
      this.fitWindowToContent();
    });
    this.api.renderExternal(manager, ext);

    body.scrollTop = scrollTop;
    this.fitWindowToContent();
    if (this.api.isDetailVisible()) this.api.renderDetail();
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
    if (!el || !body || !head || el.classList.contains(this.CSS_CLASS.isHidden))
      return;
    const isDetail = targetEl?.classList.contains(this.CSS_CLASS.alpDetailWin);
    const available = Math.max(
      120,
      Math.floor(window.innerHeight * (isDetail ? 0.92 : 0.88)),
    );
    let contentBottom = 0;
    const bodyRect = body.getBoundingClientRect();
    for (const child of body.children) {
      contentBottom = Math.max(
        contentBottom,
        child.getBoundingClientRect().bottom - bodyRect.top,
      );
    }
    const bodyStyle = getComputedStyle(body);
    const bodyPadding =
      (parseFloat(bodyStyle.paddingTop) || 0) +
      (parseFloat(bodyStyle.paddingBottom) || 0);
    const desired = Math.ceil(
      head.offsetHeight + contentBottom + bodyPadding + 2,
    );
    const height = Math.max(
      head.offsetHeight + 8,
      Math.min(desired, available),
    );
    el.style.minHeight = `${height}px`;
    el.style.height = `${height}px`;
  }

  enableDrag(el, handle) {
    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest(".alp-btn")) return;
      const rect = el.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      const move = (ev) => {
        const rect = el.getBoundingClientRect();
        const maxLeft = Math.max(0, window.innerWidth - rect.width);
        const maxTop = Math.max(0, window.innerHeight - rect.height);
        const x = Math.max(0, Math.min(ev.clientX - dx, maxLeft));
        const y = Math.max(0, Math.min(ev.clientY - dy, maxTop));
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.right = "auto";
      };
      const up = async () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        const position = {
          x: parseFloat(el.style.left),
          y: parseFloat(el.style.top),
        };
        if (el.classList.contains(this.CSS_CLASS.alpDetailWin))
          this.api.setDetailPosition(position);
        else this.state.pos = position;
        await this.api.saveState();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      e.preventDefault();
    });
  }
}

module.exports = MainWindowView;
