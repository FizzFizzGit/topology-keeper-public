const { Notice, TFile, MarkdownView, debounce } = require('obsidian');
const { t } = require('../i18n/i18n');
const MainWindowView = require('./main-window');
const DetailWindowView = require('./detail-window');
const { CSS_CLASS, EVENT, ICON, UI_TEXT } = require('../shared/ui-constants');
const { CONFIG } = require('../settings/plugin-settings');
const { hideInfoPopover, disposeInfoPopover } = require('./info-popover');
const { applyAppearance } = require('./portable-window');
const { SidebarWindows } = require('./sidebar-windows');
const { renderExternalFiles } = require('../files/external-files-view');
const PartialGraphWindow = require('../graph-view/graph-view');
const openStandardGraph = require('../graph-view/standard-graph');
const { trashOne: trashOneAction, trashOrphans: trashOrphansAction,
  trashOrphanBase: trashOrphanBaseAction, trashOrphanBases: trashOrphanBasesAction } = require('../analysis/maintenance-actions');

// プラグインの各機能を窓に接続し、表示・配置・入力イベントの寿命を管理する。
class WindowHost {
  constructor(plugin) {
    this.plugin = plugin;
    this.partialGraph = new PartialGraphWindow(plugin);
    this.mainView = this.createMainView();
    this.detailView = this.createAnalysisView();
    this.orphanView = new DetailWindowView({
      ...this.detailView.api,
      setWindowVisible: (visible) => { plugin.state.orphanWindowVisible = visible; },
      getDetailPosition: () => plugin.state.orphanPos,
      setDetailPosition: (position) => { plugin.state.orphanPos = position; },
    }, "orphan");
    this.sidebars = new SidebarWindows(plugin);
  }

  createMainView() {
    const { plugin } = this;
    return new MainWindowView({
      state: plugin.state,
      CSS_CLASS,
      EVENT,
      ICON,
      UI_TEXT,
      getPointerHeldAt: () => this.pointerHeldAt,
      getResult: () => plugin.maint.result,
      placeWindow: (element, visible) => {
        if (!visible) return this.sidebars?.hide('main');
        void this.sidebars?.show('main', element, () => {
          plugin.state.visible = false;
          this.mainView.applyVisibility();
          void plugin.saveData(plugin.state);
        });
      },
      computeExternal: () => plugin.computeExternal(),
      saveState: () => plugin.saveData(plugin.state),
      isMaintSpinning: () => plugin.maintenance.spinning,
      disposeGraphListeners: () => this.partialGraph.dispose(),
      removeInfoPopovers: (owner) => this.removeInfoPopovers(owner),
      hideInfoPopovers: () =>
        document
          .querySelectorAll(".alp-info-popover")
          .forEach(hideInfoPopover),
      refresh: () => plugin.refreshWin(),
      // 設定画面への接続はホスト側に置き、汎用ウィンドウ部品へObsidian依存を持ち込まない。
      openSettings: () => {
        const settings = plugin.app.setting;
        if (typeof settings?.open !== 'function' || typeof settings?.openTabById !== 'function') {
          new Notice(t('window.settingsUnavailable'));
          return;
        }
        settings.open();
        settings.openTabById(plugin.manifest.id);
      },
      scheduleMaint: () => plugin.scheduleMaint(),
      getActiveFile: () => plugin.app.workspace.getActiveFile(),
      isMainNote: (file) => file instanceof TFile && plugin.files.isMainNote(file),
      importFiles: (file) => plugin.importWorkflow.importFiles(file),
      suggestTags: (file) => plugin.tagSuggestions.suggest(file),
      createWebThumbnail: () => {
        // 独自窓をクリックしても、Obsidianの直前のMarkdownビューを挿入先として使う。
        const workspace = plugin.app.workspace;
        const view = workspace.getActiveViewOfType(MarkdownView) ?? workspace.getMostRecentLeaf?.()?.view;
        if (!view?.editor || !plugin.files.isMainNote(view.file)) {
          new Notice(t('window.webThumbnailDisabled'));
          return;
        }
        void plugin.webThumbnails.run(view.editor, view, { promptUrl: true });
      },
      createBaseStandalone: () => plugin.baseWorkflow.createStandalone(),
      renderExternal: (manager, ext) =>
        renderExternalFiles(plugin, manager, ext, {
          CSS_CLASS,
          EVENT,
          section: this.mainView.section.bind(this.mainView),
          iconButton: this.mainView.iconButton.bind(this.mainView),
        }),
      openDetail: (kind) => {
        if (kind === 'orphan') {
          this.orphanView.open();
          plugin.scheduleMaint();
        } else {
          this.detailView.open();
          void plugin.maintenance.openAnalysis();
        }
      },
      closeDetail: (kind) => (kind === "orphan" ? this.orphanView : this.detailView).close(),
      isDetailVisible: (kind) => kind === "orphan" ? this.orphanView.visible : kind === "planar" ? this.detailView.visible : this.detailView.visible || this.orphanView.visible,
      renderDetail: () => { this.detailView.render(); this.orphanView.render(); },
      setDetailPosition: (position) => {
        plugin.state.detailPos = position;
      },
      openLink: (id) => plugin.app.workspace.openLinkText(id, "", "tab"),
    });
  }

  createAnalysisView() {
    const { plugin } = this;
    return new DetailWindowView({
      isMaintSpinning: kind => kind === 'orphan' ? plugin.maintenance.isolationSpinning
        : plugin.maintenance.spinning || plugin.maintenance.analysisRefresh || plugin.maint.result?.distanceAnalysis?.running,
      isAnalysisRunning: () => plugin.maintenance.running,
      getGraphRevision: () => this.partialGraph.revision,
      getGraphNodeLimit: () => plugin.state.partialGraphNodeLimit,
      getWindowAppearance: () => plugin.state.windowAppearance,
      setWindowVisible: (visible) => { plugin.state.areaWindowVisible = visible; },
      getDetailPosition: () => plugin.state.detailPos,
      saveState: () => plugin.saveData(plugin.state),
      getMainWindow: () => this.mainView.el,
      placeWindow: (kind, element, visible, onClose) => {
        if (visible) void this.sidebars?.show(kind, element, onClose);
        else this.sidebars?.hide(kind);
      },
      updateDetailButton: () => this.mainView.updateDetailButton(),
      getPointerHeldAt: () => this.pointerHeldAt,
      getResult: () => plugin.maint.result,
      getSelectedCluster: () => plugin.maint.selectedCluster,
      getAreaColors: () => ({
        primitive: plugin.state.primitiveAreaColor ?? CONFIG.primitiveAreaColor,
        undetermined: plugin.state.graphUndeterminedColor ?? CONFIG.graphUndeterminedColor,
        planar: plugin.state.graphPlanarColor ?? CONFIG.graphPlanarColor,
        densePlanar: plugin.state.clusterHighlightColor ?? CONFIG.clusterHighlightColor,
        nonplanar: plugin.state.graphNonPlanarColor ?? CONFIG.graphNonPlanarColor,
      }),
      setSelectedCluster: (selection) => {
        plugin.maint.selectedCluster = selection;
      },
      setDetailPosition: (position) => {
        plugin.state.detailPos = position;
      },
      getBaseLabel: (file) => plugin.baseLabels.get(file.path) ?? file.basename,
      refresh: () => plugin.refreshWin(),
      disposeGraphListeners: () => this.partialGraph.dispose(),
      removeInfoPopovers: (owner) => this.removeInfoPopovers(owner),
      iconButton: this.mainView.iconButton.bind(this.mainView),
      recheck: kind => kind === 'orphan' ? plugin.maintenance.recheckIsolation() : plugin.maintenance.recheckAnalysis(),
      startConfirmedDistanceAnalysis: () => plugin.maintenance.runDistanceAnalysis({ confirmed: true }),
      cancelDistanceAnalysis: () => plugin.maintenance.cancelDistanceAnalysis(),
      enableDrag: this.mainView.enableDrag.bind(this.mainView),
      fitWindowToContent: this.mainView.fitWindowToContent.bind(this.mainView),
      section: this.mainView.section.bind(this.mainView),
      collapseSections: this.mainView.collapseSections.bind(this.mainView),
      metaLabel: (file) => plugin.metaLabel(file),
      openFile: (file) => plugin.app.workspace.getLeaf("tab").openFile(file),
      trashOrphans: () => trashOrphansAction(plugin),
      trashOne: (file) => trashOneAction(plugin, file),
      trashOrphanBases: () => trashOrphanBasesAction(plugin),
      trashOrphanBase: (file) => trashOrphanBaseAction(plugin, file),
      nodeChip: this.mainView.nodeChip.bind(this.mainView),
      renderClusterGraph: (parent, selection) => this.partialGraph.render(parent, selection,
        selection.distanceAnalysis ? plugin.maintenance.distanceGraph : plugin.maint.graphAdj),
      openStandardGraph: () => openStandardGraph(plugin),
      CSS_CLASS,
      UI_TEXT,
      EVENT,
      ICON,
      maxFindings: CONFIG.maxFindings,
    });

  }

  registerEvents() {
    this.registerViewEvents();
    this.registerPointerEvents();
  }

  restore() {
    const { state, app } = this.plugin;
    this.mainView.build();
    if (state.areaWindowVisible) this.detailView.open();
    if (state.orphanWindowVisible) this.orphanView.open();
    for (const [kind, visible] of [['main', state.visible], ['planar', state.areaWindowVisible],
      ['orphan', state.orphanWindowVisible], ['graph', false]]) {
      if (!visible) app.workspace.detachLeavesOfType(this.sidebars.type(kind));
    }
  }

  dispose() {
    clearTimeout(this.pointerReleaseTimer);
    this.partialGraph.dispose();
    this.sidebars.dispose();
    this.removeInfoPopovers();
    this.mainView.dispose();
    this.detailView.dispose();
    this.orphanView.dispose();
  }

  // 共通の見た目だけを変更し、結果・スクロール位置・展開状態は保持する。
  // CSS適用後の寸法で位置補正する。再分析・窓の再生成・自動保存は行わない。
  applyWindowAppearance() {
    for (const view of [this.mainView, this.detailView, this.orphanView]) {
      if (!view?.el) continue;
      applyAppearance(view.el, this.plugin.state.windowAppearance);
      this.mainView.fitWindowToContent(view.el);
      view.constrainToViewport();
    }
    // ポップオーバーはbody直下なので、窓からのCSS変数継承に頼らず反映する。
    document.querySelectorAll('.alp-info-popover').forEach(element =>
      applyAppearance(element, { fontScale: this.plugin.state.windowAppearance.fontScale }));
  }

  registerViewEvents() {
    const { plugin } = this;
    // 小窓の再描画（軽い）。refreshWin は現在のノートと保持済みの結果から描き直す。
    plugin.registerEvent(
      plugin.app.workspace.on("active-leaf-change", plugin.refreshWin),
    );
    plugin.registerEvent(plugin.app.workspace.on("file-open", plugin.refreshWin));
    plugin.registerEvent(plugin.app.metadataCache.on("changed", plugin.refreshWin));
  }

  registerPointerEvents() {
    const { plugin } = this;
    // 説明ポップオーバーの外側を押したら閉じる。
    plugin.registerDomEvent(document, "pointerdown", (event) => {
      if (event.target.closest?.(".alp-info-popover, .alp-info-button")) return;
      document
        .querySelectorAll(".alp-info-popover:not([hidden])")
        .forEach(hideInfoPopover);
    });

    // 小窓を押している間は再描画を保留する。
    this.pointerHeldAt = 0;
    const hold = (event) => {
      if (event.target.closest?.(".alp-win, .alp-detail-win")) {
        clearTimeout(this.pointerReleaseTimer);
        this.pointerHeldAt = Date.now();
      }
    };
    const release = () => {
      if (!this.pointerHeldAt) return;
      clearTimeout(this.pointerReleaseTimer);
      // pointerup の直後にはまだ click が残っている。押したボタンが
      // その前に描き直されると、ブラウザがクリックを届けられなくなる。
      this.pointerReleaseTimer = setTimeout(() => {
        this.pointerReleaseTimer = null;
        this.pointerHeldAt = 0;
        plugin.refreshWin();
      }, 0);
    };
    plugin.registerDomEvent(document, "pointerdown", hold, true);
    plugin.registerDomEvent(document, "pointerup", release, true);
    plugin.registerDomEvent(document, "pointercancel", release, true);
    plugin.registerDomEvent(window, "blur", release);

    // Obsidian本体のウィンドウ縮小時に、小窓を表示範囲内へ補正する。
    plugin.registerDomEvent(
      window,
      "resize",
      debounce(() => {
        this.mainView.constrainToViewport();
        this.detailView.constrainToViewport();
        this.orphanView.constrainToViewport();
      }, 50),
    );
  }

  async resetWindowPositions() {
    this.mainView.resetPosition();
    this.detailView.resetPosition();
    this.orphanView.resetPosition();
    await this.plugin.saveData(this.plugin.state);
  }

  applyWindowPlacement(kind) {
    if (!this.plugin.layoutReady) return;
    if (!kind || kind === 'main') this.mainView.applyVisibility();
    if (!kind || kind === 'planar') this.detailView.syncPlacement();
    if (!kind || kind === 'orphan') this.orphanView.syncPlacement();
    if ((!kind || kind === 'graph') && this.plugin.maint.selectedCluster && this.detailView.visible) {
      this.partialGraph.dispose();
      this.detailView.render(true);
    }
  }

  removeInfoPopovers(owner) {
    const selector = owner
      ? `.alp-info-popover[data-owner="${owner}"]`
      : ".alp-info-popover";
    document.querySelectorAll(selector).forEach(tip => { disposeInfoPopover(tip); tip.remove(); });
  }

}

module.exports = WindowHost;
