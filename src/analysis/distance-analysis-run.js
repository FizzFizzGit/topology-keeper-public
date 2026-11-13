const { sameAdjacency } = require('./analysis-cache');
const { analyzeDistanceAreas, estimateDistanceWork } = require('../graph');
const { encodeDistanceCache, decodeDistanceCache } = require('./distance-area-cache');

const WARNING_VERTEX_COUNT = 256;
// この作業量の合成グラフでは、境界票に約1秒かかった。
const STANDARD_VOTE_WORK = 32_640 * (256 + 512);
const PROGRESS_DELAY = 1_000;
const PROGRESS_INTERVAL = 150;

// 距離分析の実行、復元、保存と、最後に完了したグラフを所有する。
class DistanceAnalysisRun {
  constructor(plugin, { t, Notice, buildGraph, renderViews, makeTicker }) {
    this.plugin = plugin;
    this.t = t;
    this.Notice = Notice;
    this.buildGraph = buildGraph;
    this.renderViews = renderViews;
    this.makeTicker = makeTicker;
  }

  cancel() {
    if (!this.request || this.request.completed) return;
    const { previous } = this.request;
    this.request = null;
    this.plugin.maint.result.distanceAnalysis = { ...previous, running: false,
      requiresConfirmation: false, error: this.t('area.distanceCancelled') };
    this.renderViews();
  }

  dispose() {
    this.disposed = true;
    this.request = null;
    this.graph = null;
  }

  canClear() {
    const { state, maint } = this.plugin;
    return !this.disposed && !this.clearing && (!this.request || this.request.completed)
      && Boolean(state.distanceAnalysisCache || maint.result.distanceAnalysis?.model);
  }

  async clear() {
    const { state, maint } = this.plugin;
    if (!this.canClear()) return;
    const saved = state.distanceAnalysisCache;
    this.clearing = true;
    // 完了直後に進行中の圧縮処理が、削除後にキャッシュを書き戻すのを防ぐ。
    this.request = null;
    delete state.distanceAnalysisCache;
    try {
      await this.plugin.saveData(state);
      this.graph = null;
      delete maint.result.distanceAnalysis;
      if (maint.selectedCluster?.distanceAnalysis) maint.selectedCluster = null;
      return true;
    } catch {
      if (saved) state.distanceAnalysisCache = saved;
      // 保存エラーは設定保存の待機列が通知する。
    } finally {
      this.clearing = false;
      if (!this.disposed) this.renderViews();
    }
  }

  async restore() {
    const { state, maint } = this.plugin;
    if (this.clearing || !state.distanceAnalysisCache || this.restoring || maint.result.distanceAnalysis) return;
    this.restoring = decodeDistanceCache(state.distanceAnalysisCache);
    try {
      const saved = await this.restoring;
      if (!saved || this.disposed || this.clearing || !state.distanceAnalysisCache || maint.result.distanceAnalysis) return;
      this.graph = saved.graph;
      maint.result.distanceAnalysis = saved.result;
      this.renderViews();
    } catch (error) {
      console.warn('Topology Keeper could not restore the distance analysis cache:', error);
    } finally {
      this.restoring = null;
    }
  }

  async run({ confirmed = false, onAccepted } = {}) {
    const { maint, state } = this.plugin;
    if (this.restoring) await this.restoring.catch(() => null);
    if (this.disposed || this.clearing || this.request) return;
    const graph = this.buildGraph();
    if (!graph?.size) return new this.Notice(this.t('area.distanceNotReady'));
    const previous = maint.result.distanceAnalysis;
    if (previous?.model && previous.table && sameAdjacency(this.graph, graph)) {
      onAccepted?.();
      if (previous.error || previous.requiresConfirmation) {
        maint.result.distanceAnalysis = { ...previous, error: null, requiresConfirmation: false };
      }
      if (onAccepted || maint.result.distanceAnalysis !== previous) this.renderViews();
      return;
    }
    const { notes, edges, pairs } = estimateDistanceWork(graph);
    const voteWork = pairs * (graph.size + edges);
    if (!confirmed && (graph.size > WARNING_VERTEX_COUNT || voteWork > STANDARD_VOTE_WORK)) {
      maint.result.distanceAnalysis = { ...previous, requiresConfirmation: true,
        error: this.t('area.distanceLongWarning', { count: graph.size, notes, edges }) };
      this.renderViews();
      return;
    }
    const pending = this.request = { previous };
    onAccepted?.();
    const startedAt = performance.now();
    let lastProgressAt = startedAt;
    let voteProgress = 0;
    maint.result.distanceAnalysis = { ...previous, running: true, error: null, requiresConfirmation: false,
      phase: 'distance', showProgress: voteWork >= STANDARD_VOTE_WORK };
    this.renderViews();
    const checkpoint = this.makeTicker(() => this.request === pending);
    const tick = async () => {
      await checkpoint();
      if (this.request !== pending) return;
      const current = maint.result.distanceAnalysis;
      const now = performance.now();
      if (!current.showProgress && now - startedAt >= PROGRESS_DELAY) {
        maint.result.distanceAnalysis = { ...current, showProgress: true, voteProgress };
        this.renderViews();
      } else if (current.showProgress && current.phase === 'votes' && current.voteProgress !== voteProgress
          && now - lastProgressAt >= PROGRESS_INTERVAL) {
        lastProgressAt = now;
        current.voteProgress = voteProgress;
        this.plugin.detailView?.updateDistanceProgress?.(voteProgress);
      }
    };
    try {
      const result = { ...await analyzeDistanceAreas(graph, tick, {
        graph: this.graph, table: previous?.table,
      }, phase => {
        if (this.request !== pending) return;
        maint.result.distanceAnalysis = { ...maint.result.distanceAnalysis, phase,
          voteProgress: phase === 'votes' ? 0 : undefined };
        this.renderViews();
      }, progress => { voteProgress = progress; }), completedAt: Date.now() };
      await tick();
      if (this.request !== pending) return;
      pending.completed = true;
      this.graph = graph;
      maint.result.distanceAnalysis = result;
      this.renderViews();
      let saved;
      try {
        saved = await encodeDistanceCache(result, graph);
      } catch (error) {
        if (this.request === pending) {
          new this.Notice(this.t('area.distanceCacheFailed'));
          console.warn('Topology Keeper could not encode the distance analysis cache:', error);
        }
        return;
      }
      if (this.request === pending) {
        state.distanceAnalysisCache = saved;
        // 保存エラーの通知は設定保存の待機列に任せる。
        await this.plugin.saveData(state).catch(() => {});
      }
    } catch (error) {
      if (this.request === pending && !this.disposed) {
        maint.result.distanceAnalysis = { ...previous, running: false,
          requiresConfirmation: false, error: this.t('notice.analysisFailed') };
        console.error('Topology Keeper distance area analysis failed:', error);
      }
    } finally {
      if (this.request === pending) {
        this.request = null;
        this.renderViews();
      }
    }
  }
}

module.exports = DistanceAnalysisRun;
