const { DENSE_LINK_THRESHOLD, getRemainderKind } = require('../graph/graph-analysis');
const { presentAnalysis } = require('./analysis-presentation');
const { combinedAreaCategory, combinedAreaColors, combinedAreaMeanDegree } = require('./combined-area-style');

// 分析本文の描画・展開状態・接続参照を管理する。窓の開閉・位置・保存・分析実行は持たない。
// apiは色・選択・ノート操作・グラフ描画を提供する。
// hostはrequestRender / fitContentを提供する。開閉時のサイズ調整は詳細窓に集約する。
// 翻訳とアイコン描画を注入し、Obsidian本体やグローバルな窓には依存させない。
function createAnalysisContent(api, host, { t, setIcon, setTooltip }) {
  class AnalysisContentView {
    constructor() {
      this.api = api;
      this.host = host;
      this.CSS_CLASS = api.CSS_CLASS;
      this.EVENT = api.EVENT;
      this.ICON = api.ICON;
      this.maxFindings = api.maxFindings;
      // ビューが生きている間は再描画しても展開状態を維持する。
      this.expandedAreas = new Set();
    }
    createAreaRow(parent, item, kind, index, color) {
      const key = item.id ?? JSON.stringify([kind, [...item.nodes].sort()]);
      const container = parent.createDiv({ cls: "alp-finding is-" + kind });
      container.style.setProperty("--alp-area-color", color ?? 'transparent');
      if (color == null) container.style.setProperty('background-color', 'transparent');
      const row = container.createEl("details", { cls: "alp-finding-details" });
      row.areaExpansionKey = key;
      row.open = this.expandedAreas.has(key);
      const header = row.createEl("summary", { cls: "alp-finding-head" });
      header.createSpan({ cls: "alp-finding-title", text: item.title ?? t('area.rowTitle', { index: index + 1, count: item.nodes.length }) });
      row.addEventListener("toggle", () => {
        if (row.open) this.expandedAreas.add(key);
        else this.expandedAreas.delete(key);
        // toggleを捕捉する詳細窓が、入れ子の行もまとめてサイズ調整する。
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
          this.host.fitContent();
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
        this.host.requestRender();
      });
    }

    renderNodeList(row, ids, moreLabel) {
      const nodes = row.createDiv({ cls: 'alp-finding-nodes' });
      ids.slice(0, 12).forEach((id, index) => {
        if (index) nodes.createSpan({ text: t('window.separator') });
        this.api.nodeChip(nodes, id);
      });
      if (ids.length > 12)
        nodes.createSpan({ text: t(moreLabel, { count: ids.length - 12 }) });
    }

    renderAreaModel(sec, model, originalAreaIds) {
      const api = this.api;
      const colors = api.getAreaColors();
      const labels = { planar: t("area.planar"), nonplanar: t("area.nonplanar"), undetermined: t("area.undetermined") };
      const visibleAreas = model.originalAreas.filter(area => originalAreaIds.includes(area.id));
      if (visibleAreas.length) sec.createDiv({ cls: 'alp-subtitle', text: t('area.primitiveTitle', { count: visibleAreas.length }) });
      for (const [index, area] of visibleAreas.slice(0, 30).entries()) {
        const selection = this.presentation.selection(area.id);
        const row = this.createAreaRow(sec, selection, 'primitive', index,
          colors.primitive ?? '#70c9c0');
        row.createDiv({ cls: this.CSS_CLASS.alpSmall,
          text: t('area.primitiveStats', { label: labels[area.classification] ?? labels.undetermined, count: area.links.length }) });
        this.renderNodeList(row, area.nodes, 'isolation.more');
      }
      if (visibleAreas.length > 30) sec.createDiv({ cls: this.CSS_CLASS.alpSmall, text: t('area.morePrimitive', { count: visibleAreas.length - 30 }) });
      if (model.combinedAreas.length) sec.createDiv({ cls: 'alp-subtitle', text: t('area.combinedTitle', { count: model.combinedAreas.length }) });
      const combinedColors = combinedAreaColors(colors);
      for (const [index, combined] of model.combinedAreas.slice(0, 30).entries()) {
        const selection = this.presentation.selection(combined.id);
        const { classification } = combined;
        const meanDegree = combinedAreaMeanDegree(selection);
        const category = combinedAreaCategory(classification, meanDegree);
        const color = combinedColors[category];
        const row = this.createAreaRow(sec, selection, 'combined', index, color);
        if (classification) row.createDiv({ cls: this.CSS_CLASS.alpSmall,
          text: t('area.combinedDiagnosis', { label: t(`area.${category}`), meanDegree: meanDegree.toFixed(2) }) });
        const standalone = combined.members.filter(member => member.standalone).length;
        const areas = combined.members.length - standalone;
        const stats = !standalone ? 'area.combinedStats' : areas ? 'area.combinedWithNotes' : 'area.combinedOnlyNotes';
        row.createDiv({ cls: this.CSS_CLASS.alpSmall,
          text: t(stats, { areas, standalone, notes: combined.noteCount }) });
        if (combined.tagRole) {
          const role = combined.tagRole;
          const label = role.role === 'cross-cutting' ? t("area.crossCutting")
            : role.role === 'cohesive' ? t("area.cohesive") : t("area.insufficient");
          row.createDiv({ cls: this.CSS_CLASS.alpSmall, text: label });
          row.createDiv({ cls: this.CSS_CLASS.alpSmall,
            text: t('area.roleStats', { tags: (role.coTagSimilarity * 100).toFixed(1), links: (role.directDensity * 100).toFixed(1), components: role.componentCount, weight: role.weight.toFixed(2) }) });
        }
        for (const member of combined.members.slice(0, 20)) {
          row.createDiv({ cls: this.CSS_CLASS.alpSmall,
            text: t('area.member', { count: member.nodes.length }) });
          this.renderNodeList(row, member.nodes, 'isolation.more');
        }
        if (combined.members.length > 20) row.createDiv({ text: t('area.moreCombinedMembers', { count: combined.members.length - 20 }) });
      }
      if (model.combinedAreas.length > 30) sec.createDiv({ cls: this.CSS_CLASS.alpSmall, text: t('area.moreCombined', { count: model.combinedAreas.length - 30 }) });
    }

    renderParentAreas(row, model, id) {
      if (!model) return;
      const parent = this.presentation.parent(id);
      if (!parent) return;
      const previousParentLabel = this.currentParentLabel;
      this.currentParentLabel = parent.label;
      this.renderAreaModel(row, { ...model,
        combinedAreas: model.combinedAreas.filter(area => area.scope === 'within-parent' && area.parentIds?.includes(id)),
      }, parent.originalAreaIds);
      const external = model.combinedAreas.filter(area => area.scope === 'cross-parent' && area.parentIds?.includes(id));
      if (external.length) {
        row.createDiv({ cls: 'alp-subtitle', text: t("area.external") });
        const references = row.createDiv({ cls: 'alp-external-area-references' });
        for (const connection of external.slice(0, 30)) {
          const targets = this.presentation.targetLabels(connection, id);
          const reference = references.createDiv({ cls: 'alp-external-area-reference' });
          this.renderFindingActions(reference, this.presentation.selection(connection.id), {
            tagOnly: true, tooltip: t('area.connectionTarget', { targets: targets.join(' · ') }),
          });
        }
        if (external.length > 30) row.createDiv({ cls: this.CSS_CLASS.alpSmall, text: t('area.moreConnections', { count: external.length - 30 }) });
      }
      this.currentParentLabel = previousParentLabel;
    }

    renderDistanceAreas(body, result) {
      const api = this.api;
      if (!result) return null;
      if (result.running || result.error) {
        const phase = { distance: 'area.distancePhaseDistances', votes: 'area.distancePhaseVotes',
          areas: 'area.distancePhaseAreas' }[result.phase];
        body.createDiv({ cls: this.CSS_CLASS.alpSmall, attr: { role: 'status' },
          text: result.error ?? t(phase ?? 'window.computing') });
      }
      if (result.running) {
        const controls = body.createDiv({ cls: 'alp-distance-controls' });
        if (result.showProgress) {
          const progress = controls.createEl('progress', { cls: 'alp-distance-progress',
            attr: { max: '1', 'aria-label': t('area.distanceProgress') } });
          if (result.phase === 'votes' && Number.isFinite(result.voteProgress)) progress.value = result.voteProgress;
        }
        controls.createEl('button', { text: t('area.distanceCancel'), attr: { type: 'button' } })
          .addEventListener('click', () => api.cancelDistanceAnalysis());
      } else if (result.requiresConfirmation) {
        body.createEl('button', { text: t('area.distanceStart'), attr: { type: 'button' } })
          .addEventListener('click', () => api.startConfirmedDistanceAnalysis());
      }
      if (!result.model) return null;
      const sec = api.section(body, 'distanceAreas', t('area.distanceTitle'), { collapsible: false });
      this.addStandardGraphButton(sec);
      const regularPresentation = this.presentation;
      const presentation = presentAnalysis(result.model, t);
      this.presentation = presentation;
      const { model } = presentation;
      const areaColor = api.getAreaColors().undetermined ?? '#8792a2';
      sec.createDiv({ cls: this.CSS_CLASS.alpSmall, text: t('area.distanceStats', {
        count: model.parents.length, threshold: 100 * result.threshold,
      }) });
      if (result.completedAt) sec.createDiv({ cls: this.CSS_CLASS.alpSmall,
        text: t('area.distanceCompletedAt', { date: new Date(result.completedAt).toLocaleString() }) });
      for (const [index, parent] of model.parents.slice(0, 30).entries()) {
        const item = presentation.selection(parent.id);
        const row = this.createAreaRow(sec, item, 'distance', index, areaColor);
        this.renderNodeList(row, parent.nodes, 'isolation.more');
        this.renderParentAreas(row, model, parent.id);
      }
      if (model.parents.length > 30) sec.createDiv({ cls: this.CSS_CLASS.alpSmall,
        text: t('area.moreAreas', { count: model.parents.length - 30 }) });
      this.presentation = regularPresentation;
      this.connectionTargets = new Map();
      return { presentation, section: sec };
    }

    addStandardGraphButton(sec) {
      const graphButton = sec.sectionActions.createEl("button", {
        cls: "clickable-icon alp-graph-icon-button alp-planar-graph-button",
        attr: {
          title: t('area.standardGraph'),
          "aria-label": t('area.standardGraph'),
        },
      });
      sec.sectionActions.insertBefore(graphButton, sec.sectionActions.querySelector(".alp-info-wrap"));
      setIcon(graphButton, this.ICON.fork);
      graphButton.addEventListener(this.EVENT.click, (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.api.openStandardGraph();
      });
    }

    renderPlanar(body, r) {
      this.graphHost = null;
      this.presentation = null;
      this.connectionTargets = new Map();
      this.currentParentLabel = null;
      const api = this.api;
      const distance = this.renderDistanceAreas(body, r.distanceAnalysis);
      if (distance) {
        this.renderSelectedGraph(distance.section, distance);
        return;
      }
      this.presentation = r.areaModel ? presentAnalysis(r.areaModel, t) : null;
      if (this.presentation) r = { ...r, areaModel: this.presentation.model };
      const p = r.planar;
      const sec = api.section(body, "planar", t("common.areaCandidates"));
      this.addStandardGraphButton(sec);
      if (!p) {
        sec.createDiv({ cls: this.CSS_CLASS.alpEmpty,
          text: r.analysisError ?? t(api.isAnalysisRunning?.() ? 'window.computing' : 'area.analysisOnDemand') });
        this.renderSelectedGraph(sec, distance);
        return;
      }
      if (r.analysisError) sec.createDiv({ cls: this.CSS_CLASS.alpSmall, text: r.analysisError });
      const densityThreshold = DENSE_LINK_THRESHOLD;
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
          this.renderNodeList(row, item.nodes, 'area.moreVertices');
          this.renderParentAreas(row, r.areaModel, JSON.stringify([parentKind, [...item.nodes].sort()]));
        });
        if (areas.length > 30)
          sec.createDiv({
            cls: this.CSS_CLASS.alpSmall,
            text: t('area.moreAreas', { count: areas.length - 30 }),
          });
      };

      for (const group of classifiedAreas)
        renderAreaGroup(group.label, group.areas, group.kind);

      for (const category of ['boundary', 'low', 'small']) {
        renderAreaGroup(t(`area.${category}`), (p.remainder ?? []).filter(area => getRemainderKind(area) === category), 'undetermined');
      }

      this.renderSelectedGraph(sec, distance);

      if (p.definite.length === 0 && p.suspect.length === 0) {
        sec.createDiv({
          cls: this.CSS_CLASS.alpEmpty,
          text: t("area.noNonplanar"),
        });
      }

    }

    renderSelectedGraph(section, distance) {
      this.graphHost = section.createDiv({ cls: 'alp-graph-host' });
      this.graphPresentation = distance?.presentation ?? this.presentation;
      this.graphIsDistance = !!distance;
      this.refreshSelectedGraph(false);
    }

    refreshSelectedGraph(replace = true) {
      if (!this.graphHost) return;
      const api = this.api;
      if (replace) {
        api.disposeGraphListeners?.();
        this.graphHost.empty();
      }
      const selected = api.getSelectedCluster?.();
      if (selected?.id) {
        const current = this.graphPresentation?.selection(selected.id) ?? null;
        api.setSelectedCluster(current);
        if (current) api.renderClusterGraph(this.graphHost, current);
      } else if (selected?.nodes?.length && !this.graphIsDistance) {
        api.renderClusterGraph(this.graphHost, selected);
      }
    }
  }
  return new AnalysisContentView();
}
module.exports = { createAnalysisContent };
