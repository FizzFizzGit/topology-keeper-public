const { Notice, TFile, MarkdownView } = require('obsidian');
const { t } = require('./i18n');
const MainWindowView = require('./main-window');
const DetailWindowView = require('./detail-window');
const { CSS_CLASS, EVENT, ICON, UI_TEXT } = require('./ui-constants');
const { CONFIG } = require('./plugin-settings');
const { hideInfoPopover } = require('./info-popover');
const { renderExternalFiles } = require('./external-files-view');
const { renderClusterGraph } = require('./graph-view');
const openStandardGraph = require('./standard-graph');
const { trashOne: trashOneAction, trashOrphans: trashOrphansAction,
  trashOrphanBase: trashOrphanBaseAction, trashOrphanBases: trashOrphanBasesAction } = require('./maintenance-actions');

// Obsidianの操作口を各ビューへ接続する場所。窓の実装や分析処理はここに置かない。
// plugin.state / maintenance / workflows の初期化後に一度呼ぶ。
// コールバックで最新状態を参照し、設定や選択を生成時の値へ固定しない。
function createWindowViews(plugin) {
  plugin.mainView = new MainWindowView({
    state: plugin.state,
    CSS_CLASS,
    EVENT,
    ICON,
    UI_TEXT,
    getPointerHeldAt: () => plugin.pointerHeldAt,
    getResult: () => plugin.maint.result,
    placeWindow: (element, visible) => {
      if (!visible) return plugin.sidebars?.hide('main');
      void plugin.sidebars?.show('main', element, () => {
        plugin.state.visible = false;
        plugin.mainView.applyVisibility();
        void plugin.saveData(plugin.state);
      });
    },
    computeExternal: () => plugin.computeExternal(),
    saveState: () => plugin.saveData(plugin.state),
    isMaintSpinning: () => plugin.maintenance.spinning,
    disposeGraphListeners: () => plugin.disposeGraphListeners(),
    removeInfoPopovers: (owner) => plugin.removeInfoPopovers(owner),
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
    suggestTags: (file) => plugin.suggestTags(file),
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
        section: plugin.mainView.section.bind(plugin.mainView),
        iconButton: plugin.mainView.iconButton.bind(plugin.mainView),
      }),
    openDetail: (kind) => {
      if (kind === 'orphan') {
        plugin.orphanView.open();
        plugin.scheduleMaint();
      } else {
        plugin.detailView.open();
        void plugin.maintenance.openAnalysis();
      }
    },
    closeDetail: (kind) => (kind === "orphan" ? plugin.orphanView : plugin.detailView).close(),
    isDetailVisible: (kind) => kind === "orphan" ? plugin.orphanView.visible : kind === "planar" ? plugin.detailView.visible : plugin.detailView.visible || plugin.orphanView.visible,
    renderDetail: () => { plugin.detailView.render(); plugin.orphanView.render(); },
    setDetailPosition: (position) => {
      plugin.state.detailPos = position;
    },
    openLink: (id) => plugin.app.workspace.openLinkText(id, "", "tab"),
  });
  plugin.detailView = new DetailWindowView({
    isMaintSpinning: kind => kind === 'orphan' ? plugin.maintenance.isolationSpinning
      : plugin.maintenance.spinning || plugin.maint.result?.distanceAnalysis?.running,
    isAnalysisRunning: () => plugin.maintenance.running,
    getGraphRevision: () => plugin.graphRevision ?? 0,
    getWindowAppearance: () => plugin.state.windowAppearance,
    setWindowVisible: (visible) => { plugin.state.areaWindowVisible = visible; },
    getDetailPosition: () => plugin.state.detailPos,
    saveState: () => plugin.saveData(plugin.state),
    getMainWindow: () => plugin.mainView.el,
    placeWindow: (kind, element, visible, onClose) => {
      if (visible) void plugin.sidebars?.show(kind, element, onClose);
      else plugin.sidebars?.hide(kind);
    },
    updateDetailButton: () => plugin.mainView.updateDetailButton(),
    getPointerHeldAt: () => plugin.pointerHeldAt,
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
    disposeGraphListeners: () => plugin.disposeGraphListeners(),
    removeInfoPopovers: (owner) => plugin.removeInfoPopovers(owner),
    iconButton: plugin.mainView.iconButton.bind(plugin.mainView),
    recheck: kind => kind === 'orphan' ? plugin.maintenance.recheckIsolation() : plugin.maintenance.recheckAnalysis(),
    enableDrag: plugin.mainView.enableDrag.bind(plugin.mainView),
    fitWindowToContent: plugin.mainView.fitWindowToContent.bind(plugin.mainView),
    section: plugin.mainView.section.bind(plugin.mainView),
    collapseSections: plugin.mainView.collapseSections.bind(plugin.mainView),
    metaLabel: (file) => plugin.metaLabel(file),
    openFile: (file) => plugin.app.workspace.getLeaf("tab").openFile(file),
    trashOrphans: () => trashOrphansAction(plugin),
    trashOne: (file) => trashOneAction(plugin, file),
    trashOrphanBases: () => trashOrphanBasesAction(plugin),
    trashOrphanBase: (file) => trashOrphanBaseAction(plugin, file),
    nodeChip: plugin.mainView.nodeChip.bind(plugin.mainView),
    renderClusterGraph: (parent, selection) => renderClusterGraph(plugin, parent, selection,
      selection.distanceAnalysis ? plugin.maintenance.distanceGraph : plugin.maint.graphAdj),
    openStandardGraph: () => openStandardGraph(plugin),
    CSS_CLASS,
    UI_TEXT,
    EVENT,
    ICON,
    maxFindings: CONFIG.maxFindings,
  });

  plugin.orphanView = new DetailWindowView({
    ...plugin.detailView.api,
    setWindowVisible: (visible) => { plugin.state.orphanWindowVisible = visible; },
    getDetailPosition: () => plugin.state.orphanPos,
    setDetailPosition: (position) => { plugin.state.orphanPos = position; },
  }, "orphan");

}
module.exports = { createWindowViews };
