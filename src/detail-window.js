const { setIcon, setTooltip } = require("obsidian");
const { HOTSPOT_DENSITY_THRESHOLD } = require("./graph-analysis");

// 構造分析・メンテナンスの詳細窓を管理する。
//
// 【責務】詳細窓の生成・表示・位置調整・内容描画・破棄をまとめる。
//   Vault の分析やファイル操作は行わず、既存のプラグイン本体が持つ状態と操作口を利用する。
// 【入力】api は描画に必要な状態の取得と、削除・再計算・グラフ表示などの操作口を提供する。
//   options は UI の共通識別子と CONFIG。
// 【出力】DOM のみを更新する。ウィンドウ位置は api.setDetailPosition に渡し、
//   ドラッグ後の保存は api.enableDrag に委譲する。Vault の内容は変更しない。
class DetailWindowView {
  constructor(api, kind = "planar") {
    this.kind = kind;
    this.infoOwner = `detail-${kind}`;
    this.expandedAreas = new Set();
    this.api = api;
    this.CSS_CLASS = api.CSS_CLASS;
    this.UI_TEXT = api.UI_TEXT;
    this.EVENT = api.EVENT;
    this.ICON = api.ICON;
    this.maxFindings = api.maxFindings;
    this.el = null;
    this.visible = false;
  }

  open() {
    this.visible = true;
    this.api.setWindowVisible?.(true);
    this.api.updateDetailButton();
    if (!this.el) {
      this.el = document.body.createDiv({ cls: this.CSS_CLASS.alpDetailWin });
      this.el.dataset.infoOwner = this.infoOwner;
      this.el.setWindowPosition = (position) => this.api.setDetailPosition(position);
    }

    const position = this.api.getDetailPosition();
    if (position) {
      this.el.style.left = `${position.x}px`;
      this.el.style.top = `${position.y}px`;
    } else {
      this.placeAtDefaultPosition();
    }
    this.el.style.width = "300px";
    this.el.style.right = "auto";
    this.el.classList.remove(this.CSS_CLASS.isHidden);
    this.render();
    this.constrainToViewport();
    this.api.saveState?.();
  }

  placeAtDefaultPosition() {
    if (!this.el) return;
    const mainRect = this.api.getMainWindow()?.getBoundingClientRect();
    const width = 300;
    const left = mainRect
      ? Math.max(0, Math.min(mainRect.left - width - 5, window.innerWidth - width))
      : Math.max(0, window.innerWidth - width - 16);
    const top = mainRect
      ? Math.max(0, Math.min(mainRect.top, window.innerHeight - 180))
      : 48;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this.el.style.right = "auto";
  }

  resetPosition() {
    this.api.setDetailPosition(null);
    this.placeAtDefaultPosition();
    this.constrainToViewport();
  }

  close() {
    this.visible = false;
    this.api.setWindowVisible?.(false);
    this.api.saveState?.();
    this.api.updateDetailButton();
    if (this.kind === "planar") this.api.disposeGraphListeners();
    this.api.removeInfoPopovers(this.infoOwner);
    this.el?.addClass(this.CSS_CLASS.isHidden);
  }

  dispose() {
    this.visible = false;
    this.api.removeInfoPopovers(this.infoOwner);
    this.el?.remove();
    this.el = null;
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
    this.api.setDetailPosition({ x: left, y: top });
  }

  render() {
    const api = this.api;
    const pointerHeldAt = api.getPointerHeldAt();
    if (pointerHeldAt && Date.now() - pointerHeldAt < 2000) {
      setTimeout(() => api.refresh(), 300);
      return;
    }
    const el = this.el;
    if (!el || !this.visible) return;
    const r = api.getResult();
    const scrollTop = el.querySelector(".alp-detail-body")?.scrollTop ?? 0;
    if (this.kind === "planar") api.disposeGraphListeners();
    api.removeInfoPopovers(this.infoOwner);
    el.empty();

    const head = el.createDiv({ cls: "alp-detail-head" });
    const mark = head.createSpan({ cls: "alp-detail-mark" });
    setIcon(mark, this.ICON.chart);
    head.createSpan({
      cls: "alp-detail-title",
      text: this.kind === "orphan" ? "孤立" : "分析結果",
    });
    api.iconButton(head, "refresh-cw", "再チェック", () =>
      api.runMaint(true, true),
    );
    api.iconButton(head, "locate-fixed", "ウィンドウの位置をリセット", () => {
      this.resetPosition();
      api.saveState();
    });
    api.iconButton(head, "x", "ウィンドウを閉じる", () =>
      this.close(),
    );
    api.enableDrag(el, head);

    const body = el.createDiv({ cls: "alp-detail-body" });
    if (r) {
      const orphanCount =
        r.orphans.length + r.strayThumbs.length + r.orphanBases.length;
      if (this.kind === "orphan") this.renderOrphans(body, r, orphanCount);
      else this.renderPlanar(body, r);
    } else {
      body.createDiv({
        cls: this.CSS_CLASS.alpEmpty,
        text: "構造をチェックしています…",
      });
    }
    body.scrollTop = scrollTop;
    api.fitWindowToContent(el);
  }

  renderOrphans(body, r, orphanCount) {
    const api = this.api;
    const sec = api.section(
      body,
      "orphan",
      `孤立 - メタノート ${r.orphans.length} ・ サムネイル ${r.strayThumbs.length} ・ Base ${r.orphanBases.length}`,
    );
    if (r.maintenanceReady === false) {
      sec.createDiv({ cls: this.CSS_CLASS.alpEmpty, text: "ノートの解析待ちです。完了後に再チェックしてください。削除操作は停止しています。" });
      return;
    }
    if (orphanCount === 0) {
      sec.createDiv({ cls: this.CSS_CLASS.alpEmpty, text: this.UI_TEXT.clean });
      return;
    }

    if (r.orphans.length + r.strayThumbs.length > 0) {
      const bulk = sec.createEl("button", {
        text: "🚨 メタノート・サムネイルを一括削除",
        cls: "mod-warning alp-wide",
      });
      bulk.addEventListener(this.EVENT.click, () => api.trashOrphans());
    }

    for (const file of r.orphans) {
      const row = sec.createDiv({ cls: this.CSS_CLASS.alpRow });
      const name = row.createSpan({
        cls: "alp-name is-link",
        text: api.metaLabel(file),
      });
      name.setAttr("title", file.path);
      name.addEventListener(this.EVENT.click, () =>
        api.openFile(file),
      );
      api.iconButton(row, "trash-2", "ゴミ箱へ（サムネイルも一緒に）", () =>
        api.trashOne(file),
      );
    }
    if (r.strayThumbs.length > 0) {
      const names = r.strayThumbs
        .slice(0, 5)
        .map((f) => f.name)
        .join(", ");
      const more =
        r.strayThumbs.length > 5 ? ` ほか${r.strayThumbs.length - 5}件` : "";
      sec.createDiv({
        cls: this.CSS_CLASS.alpSmall,
        text: `単独サムネイル: ${names}${more}`,
      });
    }

    if (r.orphanBases.length > 0) {
      const bulkBases = sec.createEl("button", {
        text: "🚨 孤立Baseを一括削除",
        cls: "mod-warning alp-wide",
      });
      bulkBases.addEventListener(this.EVENT.click, () =>
        api.trashOrphanBases(),
      );
      for (const file of r.orphanBases) {
        const row = sec.createDiv({ cls: "alp-row alp-base" });
        const name = row.createSpan({
          cls: "alp-name is-link",
          text: api.getBaseLabel(file),
        });
        name.setAttr("title", file.path);
        name.addEventListener(this.EVENT.click, () =>
          api.openFile(file),
        );
        api.iconButton(row, "trash-2", "孤立Baseをゴミ箱へ", () =>
          api.trashOrphanBase(file),
        );
      }
    }
  }

  createAreaRow(parent, item, kind, index, color) {
    const key = JSON.stringify([kind, [...item.nodes].sort()]);
    const container = parent.createDiv({ cls: "alp-finding is-" + kind });
    container.style.setProperty("--alp-area-color", color);
    const row = container.createEl("details", { cls: "alp-finding-details" });
    row.open = this.expandedAreas.has(key);
    const header = row.createEl("summary", { cls: "alp-finding-head" });
    header.createSpan({ cls: "alp-finding-title", text: "エリア " + (index + 1) + " · " + item.nodes.length + "頂点" });
    row.addEventListener("toggle", () => {
      if (row.open) this.expandedAreas.add(key);
      else this.expandedAreas.delete(key);
      this.api.fitWindowToContent(this.el);
      this.constrainToViewport();
    });
    this.renderFindingActions(container, item);
    return row;
  }

  renderFindingActions(row, item) {
    const api = this.api;
    const actions = row.createSpan({ cls: "alp-finding-actions" });
    const detail = actions.createEl("button", {
      cls: "alp-partial-graph-button",
      attr: {
        type: "button",
        "aria-label": "このエリアの部分グラフを表示",
      },
    });
    setIcon(detail, this.ICON.network);
    setTooltip(detail, "部分グラフを表示");
    detail.addEventListener(this.EVENT.click, (event) => {
      event.preventDefault();
      event.stopPropagation();
      api.setSelectedCluster({
        nodes: [...item.nodes],
        links: item.links ?? [],
        boundaryLinks: item.boundaryLinks ?? [],
      });
      this.render();
    });
  }

  renderPlanar(body, r) {
    const api = this.api;
    const p = r.planar;
    const sec = api.section(
      body,
      "planar",
      "エリア候補",
    );
    const graphButton = sec.sectionActions.createEl("button", {
      cls: "clickable-icon alp-graph-icon-button alp-planar-graph-button",
      attr: {
        title: "標準グラフを開いて分類ごとに色分け",
        "aria-label": "標準グラフを開いて平面・ホットスポット・非平面を色分け",
      },
    });
    sec.sectionActions.insertBefore(graphButton, sec.sectionActions.querySelector(".alp-info-wrap"));
    setIcon(graphButton, this.ICON.fork);
    graphButton.addEventListener(this.EVENT.click, (event) => {
      event.preventDefault();
      event.stopPropagation();
      api.highlightCluster();
    });
    if (!p) {
      sec.createDiv({ cls: this.CSS_CLASS.alpEmpty, text: r.analysisError ?? "計算中…" });
      return;
    }
    if (r.analysisError) sec.createDiv({ cls: this.CSS_CLASS.alpSmall, text: r.analysisError });
    const densityThreshold = HOTSPOT_DENSITY_THRESHOLD;
    const areaColors = api.getAreaColors();
    const classifiedAreas = [
      {
        label: "密な関係・平面",
        areas: p.safe.filter((x) => (x.linkDensity ?? 0) >= densityThreshold),
        kind: "planar",
      },
      {
        label: "疎な関係・平面",
        areas: p.safe.filter((x) => (x.linkDensity ?? 0) < densityThreshold),
        kind: "planar",
      },
      {
        label: "密な関係・非平面",
        areas: p.definite.filter((x) => (x.linkDensity ?? 0) >= densityThreshold),
        kind: "nonplanar",
      },
      {
        label: "疎な関係・非平面",
        areas: p.definite.filter((x) => (x.linkDensity ?? 0) < densityThreshold),
        kind: "nonplanar",
      },
    ];
    if (p.truncated) {
      sec.createDiv({
        cls: this.CSS_CLASS.alpSmall,
        text: `※ K₅ / K₃,₃ の検出は各 ${this.maxFindings} 件を上限としています。`,
      });
    }

    const renderAreaGroup = (label, areas, kind) => {
      if (areas.length === 0) return;
      sec.createDiv({
        cls: "alp-subtitle",
        text: `${label}　${areas.length}エリア`,
      });
      areas.slice(0, 30).forEach((item, index) => {
        const row = this.createAreaRow(sec, item, kind, index, areaColors[kind]);
        const reason = kind === "nonplanar"
          ? item.edgeBoundExceeded
            ? `辺数 ${item.edges} > 3V−6`
            : "K₅ / K₃,₃ 検出"
          : "次数条件による平面判定";
        row.createDiv({
          cls: this.CSS_CLASS.alpSmall,
          text: `${reason} ・ ${item.nodes.length}頂点 ・ 平面密度 ${(item.density * 100).toFixed(1)}%`,
        });
        const nodes = row.createDiv({ cls: "alp-finding-nodes" });
        item.nodes.slice(0, 12).forEach((id, i) => {
          if (i) nodes.createSpan({ text: " ・ " });
          api.nodeChip(nodes, id);
        });
        if (item.nodes.length > 12)
          nodes.createSpan({ text: ` ほか${item.nodes.length - 12}頂点` });
      });
      if (areas.length > 30)
        sec.createDiv({
          cls: this.CSS_CLASS.alpSmall,
          text: `ほか ${areas.length - 30} エリア`,
        });
    };

    for (const group of classifiedAreas)
      renderAreaGroup(group.label, group.areas, group.kind);

    if (p.hotspots.length > 0) {
      sec.createDiv({
        cls: "alp-subtitle",
        text: `ホットスポット　${p.hotspots.length}エリア`,
      });
      sec.createDiv({
        cls: this.CSS_CLASS.alpSmall,
        text: `平面性未判定の領域を密度で分けています。境界候補 ${p.boundaryEdges.length}本 ・ 平均変化度 ${(p.meanDensityChange * 100).toFixed(1)}%。`,
      });
      p.hotspots.slice(0, 30).forEach((item, index) => {
        const row = this.createAreaRow(sec, item, "hotspot", index, areaColors.hotspot);
        row.createDiv({
          cls: this.CSS_CLASS.alpSmall,
          text: `${item.nodes.length}頂点 ・ 密度 ${(item.density * 100).toFixed(1)}% ・ 平均近傍密度 ${(item.meanLocalDensity * 100).toFixed(1)}%`,
        });
        const nodes = row.createDiv({ cls: "alp-finding-nodes" });
        item.nodes.slice(0, 12).forEach((id, i) => {
          if (i) nodes.createSpan({ text: " ・ " });
          api.nodeChip(nodes, id);
        });
        if (item.nodes.length > 12)
          nodes.createSpan({ text: ` ほか${item.nodes.length - 12}頂点` });
      });
      if (p.hotspots.length > 30)
        sec.createDiv({
          cls: this.CSS_CLASS.alpSmall,
          text: `ほか ${p.hotspots.length - 30} エリア`,
        });
    }

    const selectedCluster = api.getSelectedCluster();
    if (selectedCluster?.nodes?.length) {
      api.renderClusterGraph(sec, selectedCluster);
    }

    if (p.safe.length > 0)
      sec.createDiv({
        cls: this.CSS_CLASS.alpSmall,
        text: "平面判定はこのチェックの次数条件に基づきます。分類の品質を示すものではありません。",
      });
    if (p.definite.length === 0 && p.suspect.length === 0) {
      sec.createDiv({
        cls: this.CSS_CLASS.alpEmpty,
        text: "このチェックで非平面・ホットスポットは検出されませんでした。情報量や分類の品質を評価した結果ではありません。",
      });
    }

    if (p.suspect.length > 0 && p.hotspots.length === 0) {
      sec.createDiv({
        cls: this.CSS_CLASS.alpSmall,
        text: `平面性未判定の領域：ホットスポット条件に該当するエリアはありません。境界候補 ${p.boundaryEdges.length}本 ・ 平均変化度 ${(p.meanDensityChange * 100).toFixed(1)}%。`,
      });
    }
  }
}

module.exports = DetailWindowView;
