const { t } = require('./i18n');
const { setIcon, setTooltip } = require("obsidian");
const { HOTSPOT_DENSITY_THRESHOLD, getRemainderKind } = require("./graph-analysis");
const { areaSelection: buildSelection } = require("./area-model");
function areaSelection(model, id) {
  const selection = buildSelection(model, id);
  if (!selection) return null;
  const area = model.originalAreas.find(area => area.id === id);
  if (area) {
    const parent = model.parents?.find(parent => parent.id === area.parentId);
    selection.title = parent ? t('area.primitiveInParent', { parent: parent.label }) : t('term.primitiveArea');
  } else {
    const combined = model.combinedAreas.find(area => area.id === id);
    const parents = (combined.parentIds ?? []).map(id => model.parents?.find(parent => parent.id === id)?.label).filter(Boolean);
    selection.title = t('area.connectionTitle', { label: t(combined.scope === 'cross-parent' ? 'term.crossAreaConnection' : 'term.combinedArea'), tag: combined.tag, parents: parents.length ? ` (${parents.join(' · ')})` : '' });
  }
  return selection;
}

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
    this.el.style.width = `${this.windowWidth()}px`;
    this.el.style.right = "auto";
    this.el.classList.remove(this.CSS_CLASS.isHidden);
    this.render();
    this.constrainToViewport();
    this.api.saveState?.();
  }

  windowWidth() {
    return Math.max(0, Math.min(this.kind === 'orphan' ? 280 : 300, window.innerWidth - (this.kind === 'orphan' ? 20 : 12)));
  }

  placeAtDefaultPosition() {
    if (!this.el) return;
    const mainRect = this.api.getMainWindow()?.getBoundingClientRect();
    const width = this.windowWidth();
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
      text: this.kind === "orphan" ? t("common.orphan") : t("window.analysis"),
    });
    api.iconButton(head, "refresh-cw", t("window.recheck"), () =>
      api.runMaint(true, true),
    );
    api.iconButton(head, "locate-fixed", t("window.resetPosition"), () => {
      this.resetPosition();
      api.saveState();
    });
    api.iconButton(head, "x", t("window.close"), () =>
      this.close(),
    );
    api.enableDrag(el, head);

    const body = el.createDiv({ cls: "alp-detail-body" });
    // Native details toggle events do not bubble; capture nested sections too.
    body.addEventListener('toggle', () => {
      api.fitWindowToContent(el);
      this.constrainToViewport();
    }, true);
    if (r) {
      const orphanCount =
        r.orphans.length + r.strayThumbs.length + r.orphanBases.length;
      if (this.kind === "orphan") this.renderOrphans(body, r, orphanCount);
      else this.renderPlanar(body, r);
    } else {
      body.createDiv({
        cls: this.CSS_CLASS.alpEmpty,
        text: t("window.checking"),
      });
    }
    body.scrollTop = scrollTop;
    api.fitWindowToContent(el);
  }

  renderOrphans(body, r, orphanCount) {
    if (!r.noteIsolation) return this.renderManagedOrphans(body, r, orphanCount);
    const api = this.api;
    const isolation = r.noteIsolation;
    const sec = api.section(body, 'orphan', t('isolation.title', { count: isolation.isolated.length }));
    if (!isolation.ready) {
      sec.createDiv({ cls: this.CSS_CLASS.alpEmpty, text: t("isolation.waiting") });
    } else {
      const list = (parent, files) => {
        for (const file of files.slice(0, 100)) {
          const row = parent.createDiv({ cls: this.CSS_CLASS.alpRow });
          const name = row.createEl('button', { cls: 'alp-note-isolation-link', text: file.basename ?? file.path,
            attr: { type: 'button', title: file.path } });
          name.addEventListener(this.EVENT.click, () => api.openFile(file));
        }
        if (files.length > 100) parent.createDiv({ cls: this.CSS_CLASS.alpSmall, text: t('isolation.more', { count: files.length - 100 }) });
      };
      list(sec, isolation.isolated);
      if (!isolation.isolated.length) sec.createDiv({ cls: this.CSS_CLASS.alpEmpty, text: t("isolation.none") });
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
    const managed = api.section(body, 'managedOrphan', t("isolation.managed"));
    this.renderManagedOrphans(managed, r, orphanCount, { embedded: true });
  }

  renderManagedOrphans(body, r, orphanCount, { embedded = false } = {}) {
    const api = this.api;
    const sec = embedded ? body.createDiv({ cls: 'alp-managed-data-content' }) : api.section(
      body,
      "managedOrphan",
      t('isolation.managedTitle', { notes: r.orphans.length, images: r.strayThumbs.length, bases: r.orphanBases.length }),
    );
    if (r.maintenanceReady === false) {
      sec.createDiv({ cls: this.CSS_CLASS.alpEmpty, text: t("isolation.waitingDeletion") });
      return;
    }
    if (orphanCount === 0) {
      sec.createDiv({ cls: this.CSS_CLASS.alpEmpty, text: this.UI_TEXT.clean });
      return;
    }

    if (r.orphans.length + r.strayThumbs.length > 0) {
      const bulk = sec.createEl("button", {
        text: t("isolation.deleteManaged"),
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
        cls: this.CSS_CLASS.alpSmall,
        text: t('isolation.thumbnails', { names, more }),
      });
    }

    if (r.orphanBases.length > 0) {
      const bulkBases = sec.createEl("button", {
        text: t("isolation.deleteBases"),
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
        api.iconButton(row, "trash-2", t("isolation.trashBase"), () =>
          api.trashOrphanBase(file),
        );
      }
    }
  }

  createAreaRow(parent, item, kind, index, color) {
    const key = item.id ?? JSON.stringify([kind, [...item.nodes].sort()]);
    const container = parent.createDiv({ cls: "alp-finding is-" + kind });
    container.style.setProperty("--alp-area-color", color);
    const row = container.createEl("details", { cls: "alp-finding-details" });
    row.areaExpansionKey = key;
    row.open = this.expandedAreas.has(key);
    const header = row.createEl("summary", { cls: "alp-finding-head" });
    header.createSpan({ cls: "alp-finding-title", text: item.title ?? t('area.rowTitle', { index: index + 1, count: item.nodes.length }) });
    row.addEventListener("toggle", () => {
      if (row.open) this.expandedAreas.add(key);
      else this.expandedAreas.delete(key);
      this.api.fitWindowToContent(this.el);
      this.constrainToViewport();
    });
    this.renderFindingActions(container, item);
    return row;
  }

  renderFindingActions(row, item, { tagOnly = false, tooltip = null } = {}) {
    const api = this.api;
    const actions = row.createSpan({ cls: "alp-finding-actions" });
    // The same tag relation can be referenced from several parents. Compare
    // actual graph content, so different relations using one tag stay distinct.
    const key = item.tag ? JSON.stringify([item.tag, [...item.nodes].sort(),
      [...new Set((item.links ?? []).map(link => JSON.stringify([...link].sort())))].sort()]) : null;
    this.connectionTargets ??= new Map();
    const previous = key ? this.connectionTargets.get(key) : null;
    if (previous) {
      row.addClass?.('has-connection-reference');
      const button = actions.createEl('button', {
        cls: 'alp-expand-connection-button alp-tag-connection-button',
        attr: { type: 'button', 'aria-label': t('area.expandConnectionAria', { tag: item.tag, parent: previous.label }) },
      });
      const expandIcon = button.createSpan({ cls: 'alp-tag-button-icon', attr: { 'aria-hidden': 'true' } });
      setIcon(expandIcon, 'chevrons-up');
      button.createSpan({ cls: 'alp-tag-button-label', text: item.tag });
      setTooltip(button, t('area.expandConnection', { parent: previous.label }));
      button.addEventListener(this.EVENT.click, event => {
        event.preventDefault();
        event.stopPropagation();
        for (let element = previous.element; element; element = element.parentElement ?? element.parent) {
          if (element.tagName === 'DETAILS' || element.tag === 'details') {
            element.open = true;
            if (element.areaExpansionKey) this.expandedAreas.add(element.areaExpansionKey);
          }
        }
        api.fitWindowToContent?.(this.el);
        previous.element.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        previous.element.focus?.({ preventScroll: true });
      });
      return;
    }
    if (key) {
      row.setAttr?.('tabindex', '-1');
      this.connectionTargets.set(key, { element: row, label: this.currentParentLabel ?? item.title ?? t("area.previous") });
    }
    const detail = actions.createEl("button", {
      cls: tagOnly ? "alp-partial-graph-button alp-tag-connection-button" : "alp-partial-graph-button",
      attr: {
        type: "button",
        "aria-label": tagOnly ? t('area.connectionGraph', { tag: item.tag }) : t("area.graphAria"),
      },
    });
    if (tagOnly) {
      const graphIcon = detail.createSpan({ cls: 'alp-tag-button-icon', attr: { 'aria-hidden': 'true' } });
      setIcon(graphIcon, this.ICON.network);
      detail.createSpan({ cls: 'alp-tag-button-label', text: item.tag });
    } else setIcon(detail, this.ICON.network);
    setTooltip(detail, tooltip ?? t("area.graph"));
    detail.addEventListener(this.EVENT.click, (event) => {
      event.preventDefault();
      event.stopPropagation();
      api.setSelectedCluster({
        ...item,
        nodes: [...item.nodes],
        links: item.links ?? [],
        boundaryLinks: item.boundaryLinks ?? [],
      });
      this.render();
    });
  }

  renderAreaModel(sec, model, { embedded = false, hideOriginals = false, originalAreaIds = null } = {}) {
    const api = this.api;
    const colors = api.getAreaColors();
    const labels = { planar: t("area.planar"), nonplanar: t("area.nonplanar"), undetermined: t("area.undetermined") };
    const visibleAreas = originalAreaIds ? model.originalAreas.filter(area => originalAreaIds.includes(area.id)) : model.originalAreas;
    if (!embedded) sec.createDiv({ cls: this.CSS_CLASS.alpSmall,
      text: t('area.primitiveHelp') });
    if (!hideOriginals) sec.createDiv({ cls: 'alp-subtitle', text: t('area.primitiveTitle', { count: visibleAreas.length }) });
    const numbers = new Map(model.originalAreas.map((area, index) => [area.id, index + 1]));
    for (const [index, area] of (hideOriginals ? [] : visibleAreas.slice(0, 30)).entries()) {
      const selection = areaSelection(model, area.id);
      const parent = model.parents?.find(parent => parent.id === area.parentId);
      selection.title = t('area.primitiveRow', { index: numbers.get(area.id), count: area.nodes.length, parent: parent ? t('area.inParent', { parent: parent.label }) : '' });
      const row = this.createAreaRow(sec, selection, 'primitive', index,
        colors.primitive ?? '#70c9c0');
      row.createDiv({ cls: this.CSS_CLASS.alpSmall,
        text: t('area.primitiveStats', { label: labels[area.classification] ?? labels.undetermined, count: area.links.length, density: (200 * area.links.length / (area.nodes.length * (area.nodes.length - 1))).toFixed(1) }) });
      const nodes = row.createDiv({ cls: 'alp-finding-nodes' });
      area.nodes.slice(0, 12).forEach(id => api.nodeChip(nodes, id));
      if (area.nodes.length > 12) nodes.createSpan({ text: t('isolation.more', { count: area.nodes.length - 12 }) });
    }
    if (!hideOriginals && !visibleAreas.length) sec.createDiv({ cls: this.CSS_CLASS.alpEmpty, text: t("area.nonePrimitive") });
    if (!hideOriginals && visibleAreas.length > 30) sec.createDiv({ cls: this.CSS_CLASS.alpSmall, text: t('area.morePrimitive', { count: visibleAreas.length - 30 }) });
    sec.createDiv({ cls: 'alp-subtitle', text: t('area.combinedTitle', { count: model.combinedAreas.length }) });
    for (const [index, combined] of model.combinedAreas.slice(0, 30).entries()) {
      const selection = areaSelection(model, combined.id);
      const row = this.createAreaRow(sec, selection, 'combined', index, 'var(--text-accent)');
      row.createDiv({ cls: this.CSS_CLASS.alpSmall,
        text: t('area.combinedStats', { areas: combined.areaIds.length, notes: new Set(combined.members.flatMap(member => member.nodes)).size }) });
      if (combined.tagRole) {
        const role = combined.tagRole;
        const label = role.role === 'cross-cutting' ? t("area.crossCutting")
          : role.role === 'cohesive' ? t("area.cohesive") : t("area.insufficient");
        row.createDiv({ cls: this.CSS_CLASS.alpSmall, text: label });
        row.createDiv({ cls: this.CSS_CLASS.alpSmall,
          text: t('area.roleStats', { tags: (role.coTagSimilarity * 100).toFixed(1), links: (role.directDensity * 100).toFixed(1), components: role.componentCount, weight: role.weight.toFixed(2) }) });
      }
      for (const member of combined.members.slice(0, 20)) {
        const area = model.originalAreas.find(area => area.id === member.areaId);
        const parent = model.parents?.find(parent => parent.id === area?.parentId);
        row.createDiv({ cls: this.CSS_CLASS.alpSmall,
          text: t('area.member', { parent: parent ? t('area.memberParent', { parent: parent.label }) : '', index: numbers.get(member.areaId), count: member.nodes.length }) });
        const nodes = row.createDiv({ cls: 'alp-finding-nodes' });
        member.nodes.slice(0, 12).forEach(id => api.nodeChip(nodes, id));
        if (member.nodes.length > 12) nodes.createSpan({ text: t('isolation.more', { count: member.nodes.length - 12 }) });
      }
      if (combined.members.length > 20) row.createDiv({ text: t('area.morePrimitiveCompact', { count: combined.members.length - 20 }) });
    }
    if (!model.combinedAreas.length) sec.createDiv({ cls: this.CSS_CLASS.alpEmpty, text: t("area.noneCombined") });
    if (model.combinedAreas.length > 30) sec.createDiv({ cls: this.CSS_CLASS.alpSmall, text: t('area.moreCombined', { count: model.combinedAreas.length - 30 }) });
    const selected = embedded ? null : api.getSelectedCluster();
    if (selected?.id) {
      const current = areaSelection(model, selected.id);
      api.setSelectedCluster(current);
      if (current) api.renderClusterGraph(sec, current);
    }
  }

  renderParentAreas(row, result, kind, item) {
    const model = result.areaModel;
    if (!model?.parents) return;
    const id = JSON.stringify([kind, [...item.nodes].sort()]);
    const parent = model.parents.find(parent => parent.id === id);
    if (!parent) return;
    const previousParentLabel = this.currentParentLabel;
    this.currentParentLabel = parent.label;
    row.createDiv({ cls: 'alp-subtitle', text: t('area.parentInside', { parent: parent.label }) });
    this.renderAreaModel(row, { ...model,
      combinedAreas: model.combinedAreas.filter(area => area.scope === 'within-parent' && area.parentIds?.includes(id)),
    }, { embedded: true, originalAreaIds: parent.originalAreaIds });
    const external = model.combinedAreas.filter(area => area.scope === 'cross-parent' && area.parentIds?.includes(id));
    if (external.length) {
      row.createDiv({ cls: 'alp-subtitle', text: t("area.external") });
      const references = row.createDiv({ cls: 'alp-external-area-references' });
      for (const connection of external.slice(0, 30)) {
        // Show only this parent's actual destinations, not every parent in the
        // tag's global relation (the latter may have no pair with this parent).
        const destinations = new Set();
        const lookup = new Map(model.originalAreas.map(area => [area.id, area]));
        for (const pair of connection.connections) {
          const pairParents = pair.areaIds.map(areaId => lookup.get(areaId)?.parentId);
          if (pairParents.includes(id)) for (const other of pairParents) if (other && other !== id) destinations.add(other);
        }
        const targets = [...destinations].map(other => model.parents.find(parent => parent.id === other)?.label).filter(Boolean);
        const reference = references.createDiv({ cls: 'alp-external-area-reference' });
        this.renderFindingActions(reference, areaSelection(model, connection.id), {
          tagOnly: true, tooltip: t('area.connectionTarget', { targets: targets.join(' · ') }),
        });
      }
      if (external.length > 30) row.createDiv({ cls: this.CSS_CLASS.alpSmall, text: t('area.moreConnections', { count: external.length - 30 }) });
    }
    this.currentParentLabel = previousParentLabel;
  }

  renderPlanar(body, r) {
    if (r.areaModel?.parents) {
      const keys = { safe: 'area.parentPlanar', definite: 'area.parentNonplanar', hotspots: 'area.parentHotspot', low: 'area.parentLow', small: 'area.parentSmall', boundary: 'area.parentBoundary' };
      r = { ...r, areaModel: { ...r.areaModel, parents: r.areaModel.parents.map(parent => ({ ...parent,
        label: keys[parent.category ?? parent.kind] ? t(keys[parent.category ?? parent.kind], { index: parent.labelIndex ?? 1 }) : parent.label,
      })) } };
    }
    this.connectionTargets = new Map();
    this.currentParentLabel = null;
    const api = this.api;
    const p = r.planar;
    const sec = api.section(
      body,
      "planar",
      t("common.areaCandidates"),
    );
    const graphButton = sec.sectionActions.createEl("button", {
      cls: "clickable-icon alp-graph-icon-button alp-planar-graph-button",
      attr: {
        title: t("area.standardGraph"),
        "aria-label": t("area.standardGraphAria"),
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
      sec.createDiv({ cls: this.CSS_CLASS.alpEmpty, text: r.analysisError ?? t("window.computing") });
      return;
    }
    if (r.analysisError) sec.createDiv({ cls: this.CSS_CLASS.alpSmall, text: r.analysisError });
    if (r.areaModel && !r.areaModel.parents) {
      this.renderAreaModel(sec, r.areaModel);
      sec.createDiv({ cls: 'alp-subtitle', text: t("area.oldHeading") });
      sec.createDiv({ cls: this.CSS_CLASS.alpSmall,
        text: t('area.oldHelp') });
    }
    if (r.areaModel?.parents) sec.createDiv({ cls: this.CSS_CLASS.alpSmall,
      text: t("area.parentHelp") });
    const densityThreshold = HOTSPOT_DENSITY_THRESHOLD;
    const areaColors = api.getAreaColors();
    const classifiedAreas = [
      {
        label: t("area.densePlanar"),
        areas: p.safe.filter((x) => (x.linkDensity ?? 0) >= densityThreshold),
        kind: "planar",
      },
      {
        label: t("area.sparsePlanar"),
        areas: p.safe.filter((x) => (x.linkDensity ?? 0) < densityThreshold),
        kind: "planar",
      },
      {
        label: t("area.denseNonplanar"),
        areas: p.definite.filter((x) => (x.linkDensity ?? 0) >= densityThreshold),
        kind: "nonplanar",
      },
      {
        label: t("area.sparseNonplanar"),
        areas: p.definite.filter((x) => (x.linkDensity ?? 0) < densityThreshold),
        kind: "nonplanar",
      },
    ];
    if (p.truncated) {
      sec.createDiv({
        cls: this.CSS_CLASS.alpSmall,
        text: t('area.limit', { count: this.maxFindings }),
      });
    }

    const renderAreaGroup = (label, areas, kind) => {
      if (areas.length === 0) return;
      sec.createDiv({
        cls: "alp-subtitle",
        text: t('area.groupTitle', { label, count: areas.length }),
      });
      areas.slice(0, 30).forEach((item, index) => {
        const parentKind = kind === 'planar' ? 'safe' : kind === 'nonplanar' ? 'definite' : 'remainder';
        const row = this.createAreaRow(sec, { ...item, title: t('area.rowTitle', { index: index + 1, count: item.nodes.length }) }, kind, index, areaColors[kind] ?? 'var(--text-muted)');
        const reason = kind === "nonplanar"
          ? item.edgeBoundExceeded
            ? t('area.edgeBound', { count: item.edges })
            : t("area.pattern")
          : kind === 'undetermined' ? t("area.unknownReason") : t("area.planarReason");
        row.createDiv({
          cls: this.CSS_CLASS.alpSmall,
          text: kind === 'undetermined'
            ? t('area.unknownStats', { reason, count: item.nodes.length, density: ((item.linkDensity ?? (2 * (item.edges ?? item.links?.length ?? 0) / Math.max(1, item.nodes.length * (item.nodes.length - 1)))) * 100).toFixed(1) })
            : t('area.stats', { reason, count: item.nodes.length, density: (item.density * 100).toFixed(1) }),
        });
        const nodes = row.createDiv({ cls: "alp-finding-nodes" });
        item.nodes.slice(0, 12).forEach((id, i) => {
          if (i) nodes.createSpan({ text: t('window.separator') });
          api.nodeChip(nodes, id);
        });
        if (item.nodes.length > 12)
          nodes.createSpan({ text: t('area.moreVertices', { count: item.nodes.length - 12 }) });
        this.renderParentAreas(row, r, parentKind, item);
      });
      if (areas.length > 30)
        sec.createDiv({
          cls: this.CSS_CLASS.alpSmall,
          text: t('area.moreAreas', { count: areas.length - 30 }),
        });
    };

    for (const group of classifiedAreas)
      renderAreaGroup(group.label, group.areas, group.kind);

    if (p.hotspots.length > 0) {
      sec.createDiv({
        cls: "alp-subtitle",
        text: t('area.hotspotsTitle', { count: p.hotspots.length }),
      });
      sec.createDiv({
        cls: this.CSS_CLASS.alpSmall,
        text: t('area.boundaryStats', { count: p.boundaryEdges.length, mean: (p.meanDensityChange * 100).toFixed(1) }),
      });
      p.hotspots.slice(0, 30).forEach((item, index) => {
        const row = this.createAreaRow(sec, { ...item, title: t('area.rowTitle', { index: index + 1, count: item.nodes.length }) }, "hotspot", index, areaColors.hotspot);
        row.createDiv({
          cls: this.CSS_CLASS.alpSmall,
          text: t('area.hotspotStats', { count: item.nodes.length, density: (item.density * 100).toFixed(1), mean: (item.meanLocalDensity * 100).toFixed(1) }),
        });
        const nodes = row.createDiv({ cls: "alp-finding-nodes" });
        item.nodes.slice(0, 12).forEach((id, i) => {
          if (i) nodes.createSpan({ text: t('window.separator') });
          api.nodeChip(nodes, id);
        });
        if (item.nodes.length > 12)
          nodes.createSpan({ text: t('area.moreVertices', { count: item.nodes.length - 12 }) });
        this.renderParentAreas(row, r, 'hotspots', item);
      });
      if (p.hotspots.length > 30)
        sec.createDiv({
          cls: this.CSS_CLASS.alpSmall,
          text: t('area.moreAreas', { count: p.hotspots.length - 30 }),
        });
    }

    for (const category of ['boundary', 'low', 'small']) {
      renderAreaGroup(t(`area.${category}`), (p.remainder ?? []).filter(area => getRemainderKind(area) === category), 'undetermined');
    }

    if (r.areaModel?.parents) {
      const selected = api.getSelectedCluster();
      if (selected?.id) {
        const current = areaSelection(r.areaModel, selected.id);
        api.setSelectedCluster(current);
        if (current) api.renderClusterGraph(sec, current);
      }
    }
    const selectedCluster = api.getSelectedCluster();
    if (selectedCluster?.nodes?.length && (!r.areaModel || !selectedCluster.id)) {
      api.renderClusterGraph(sec, selectedCluster);
    }

    if (p.safe.length > 0)
      sec.createDiv({
        cls: this.CSS_CLASS.alpSmall,
        text: t("area.planarCaveat"),
      });
    if (p.definite.length === 0 && p.suspect.length === 0) {
      sec.createDiv({
        cls: this.CSS_CLASS.alpEmpty,
        text: t("area.noNonplanar"),
      });
    }

    if ((p.remainder?.length ?? 0) > 0) {
      sec.createDiv({
        cls: this.CSS_CLASS.alpSmall,
        text: t("area.remainderHelp"),
      });
    }
  }
}

module.exports = DetailWindowView;
