const { t } = require('./i18n');
const { buildAdjacency, findNonPlanar } = require("./graph-analysis");
const { Notice } = require("obsidian");
const { CONFIG } = require("./plugin-settings");
const { buildAreaHierarchy } = require("./area-model");
const { assessTagRoles } = require("./tag-role");
const { findIsolatedNotes } = require('./note-isolation');
const { sameAdjacency } = require('./analysis-cache');
const { analyzeDistanceAreas, MAX_DISTANCE_VERTICES } = require('./distance-area-analysis');
const { encodeDistanceCache, decodeDistanceCache } = require('./distance-area-cache');

const ABORTED = Symbol("maintenance-aborted");

// 孤立ファイル検出とグラフ分析を順に実行し、結果と再チェック表示を管理する。
// plugin は app / state / maint / mainView / computeOrphans を提供する。
class MaintenanceWorkflow {
  constructor(plugin, { isManaged, isManagedPath, getAllTags, maxFindings }) {
    this.plugin = plugin;
    this.isManaged = isManaged;
    this.isManagedPath = isManagedPath;
    this.getAllTags = getAllTags;
    this.maxFindings = maxFindings;
    this.running = false;
    this.spinning = false;
    this.spinToken = 0;
    this.isolationToken = 0;
    this.isolationSpinning = false;
    this.waiters = new Map();
  }

  cancel() {
    this.disposed = true;
    this.plugin.maint.token++;
    this.running = false;
    this.spinning = false;
    this.spinToken++;
    this.isolationToken++;
    this.isolationSpinning = false;
    this.distanceRequest = null;
    this.distanceGraph = null;
    // 待機のPromiseも完了させ、キャンセル後にfinallyだけが宙に残らないようにする。
    for (const [timer, resolve] of this.waiters) { clearTimeout(timer); resolve(); }
    this.waiters.clear();
  }

  wait(ms) {
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.waiters.delete(timer); resolve(); }, ms);
      this.waiters.set(timer, resolve);
    });
  }

  // 計算を強制することとDOMを強制再生成することは別。
  // メイン窓の差分がなくても、詳細窓の回転表示は更新する。
  renderViews() {
    // この入口では詳細窓も明示的に更新する。メイン窓からの連鎖描画を止め、
    // 押下中にメイン描画が保留されても、各詳細窓の回転表示は1回ずつ更新する。
    this.plugin.mainView.render(false, false);
    this.plugin.detailView?.render();
    this.plugin.orphanView?.render();
  }

  makeTicker(token, isCurrent = () => token === this.plugin.maint.token) {
    let last = performance.now();
    const started = last;
    return async () => {
      if (performance.now() - started > CONFIG.analysisTimeLimit) {
        const error = new Error(t("notice.timeout"));
        error.code = "ANALYSIS_TIMEOUT";
        throw error;
      }
      if (performance.now() - last > 12) {
        await this.wait(0);
        last = performance.now();
      }
      if (!isCurrent()) throw ABORTED;
    };
  }

  // 孤立チェックは同期計算で完了する。進行中の構造分析を中断せず、結果の該当欄だけ更新する。
  updateIsolation() {
    const plugin = this.plugin;
    const { orphans, strayThumbs, orphanBases, ready } = plugin.computeOrphans();
    const noteIsolation = plugin.app.vault ? findIsolatedNotes(plugin.app, {
      isManaged: this.isManaged, getAllTags: this.getAllTags,
      allowedFolder: plugin.state.orphanAllowedFolder ?? '', linksProperty: CONFIG.properties.links,
    }) : null;
    plugin.maint.result = { planar: null, areaModel: null, ...plugin.maint.result,
      orphans, strayThumbs, orphanBases, noteIsolation, maintenanceReady: ready };
  }

  async runIsolation(animate) {
    const token = this.isolationToken = (this.isolationToken ?? 0) + 1;
    this.isolationSpinning = animate;
    try {
      this.updateIsolation();
      this.renderViews();
      if (animate) await this.wait(1050);
    } finally {
      if (token === this.isolationToken) {
        this.isolationSpinning = false;
        this.renderViews();
      }
    }
  }

  // UIには対象名で操作を公開し、force/animate/targetの引数順を意識させない。
  recheckIsolation() { return this.runIsolation(true); }
  recheckAll() {
    if (this.plugin.maint.result?.distanceAnalysis?.model)
      return Promise.all([this.runIsolation(false), this.runDistanceAnalysis()]);
    return this.run(true);
  }
  recheckAnalysis() { return this.runDistanceAnalysis(); }

  openAnalysis() {
    if (this.plugin.maint.result?.distanceAnalysis?.model || this.restoringDistance) return;
    this.analysisRequested = true;
    if (!this.running) return this.run(false, false, 'planar');
  }

  // 起動時に分析窓を復元しても、ユーザーが開くか更新するまで構造分析は始めない。
  refreshVisible() {
    const { state, detailView, orphanView } = this.plugin;
    const isolation = state.visible || orphanView?.visible;
    if (this.analysisRequested && detailView?.visible && !this.plugin.maint.result?.distanceAnalysis?.model)
      return this.run(false, false, isolation ? 'all' : 'planar');
    if (isolation) return this.runIsolation(false);
  }

  buildGraph() {
    return buildAdjacency(this.plugin.app, {
      isManaged: this.isManaged,
      isManagedPath: this.isManagedPath,
      getAllTags: this.getAllTags,
    });
  }

  async restoreDistanceAnalysis() {
    const { state, maint } = this.plugin;
    if (!state.distanceAnalysisCache || this.restoringDistance || maint.result.distanceAnalysis) return;
    this.restoringDistance = decodeDistanceCache(state.distanceAnalysisCache);
    try {
      const saved = await this.restoringDistance;
      if (!saved || this.disposed || maint.result.distanceAnalysis) return;
      this.distanceGraph = saved.graph;
      maint.result.distanceAnalysis = saved.result;
      this.renderViews();
    } catch (error) {
      console.warn('Topology Keeper could not restore the distance analysis cache:', error);
    } finally {
      this.restoringDistance = null;
    }
  }

  async runDistanceAnalysis() {
    const { maint, state } = this.plugin;
    if (this.restoringDistance) await this.restoringDistance.catch(() => null);
    if (this.disposed || this.distanceRequest) return;
    const graph = this.buildGraph();
    if (!graph?.size) return new Notice(t('area.distanceNotReady'));
    if (graph.size > MAX_DISTANCE_VERTICES) {
      return new Notice(t('area.distanceTooLarge', { count: graph.size, limit: MAX_DISTANCE_VERTICES }));
    }
    const previous = maint.result.distanceAnalysis;
    const pending = this.distanceRequest = {};
    maint.result.distanceAnalysis = { ...previous, running: true, error: null };
    this.renderViews();
    const tick = this.makeTicker(null, () => this.distanceRequest === pending);
    try {
      const result = { ...await analyzeDistanceAreas(graph, tick, {
        graph: this.distanceGraph, table: previous?.table,
      }), completedAt: Date.now() };
      await tick();
      if (this.distanceRequest !== pending) return;
      this.distanceGraph = graph;
      maint.result.distanceAnalysis = result;
      this.renderViews();
      let saved;
      try {
        saved = await encodeDistanceCache(result, graph);
      } catch (error) {
        if (this.distanceRequest === pending) {
          new Notice(t('area.distanceCacheFailed'));
          console.warn('Topology Keeper could not encode the distance analysis cache:', error);
        }
        return;
      }
      if (this.distanceRequest === pending) {
        state.distanceAnalysisCache = saved;
        // 保存エラーの通知は設定保存の待機列に任せる。
        await this.plugin.saveData(state).catch(() => {});
      }
    } catch (error) {
      if (this.distanceRequest === pending && error !== ABORTED) {
        maint.result.distanceAnalysis = { ...previous, running: false,
          error: error.code === 'ANALYSIS_TIMEOUT' ? error.message : t('notice.analysisFailed') };
        console.error('Topology Keeper distance area experiment failed:', error);
      }
    } finally {
      if (this.distanceRequest === pending) {
        this.distanceRequest = null;
        this.renderViews();
      }
    }
  }

  async run(force = false, animateRefresh = false, target = 'all') {
    if (target === 'orphan') return this.runIsolation(animateRefresh);
    const plugin = this.plugin;
    if (!plugin.state.visible && !force && !plugin.detailView?.visible) return;
    const token = ++plugin.maint.token;
    const spinToken = ++this.spinToken;
    const spinStartedAt = animateRefresh ? performance.now() : 0;
    this.running = true;
    this.spinning = animateRefresh;
    this.renderViews();
    const tick = this.makeTicker(token);
    try {
      if (target !== 'planar') this.updateIsolation();
      this.renderViews();
      const graphAdj = this.buildGraph();
      // 孤立判定は毎回更新するが、本文だけの変更では重い構造分析を繰り返さない。
      // 完了した結果だけを再利用する。中断・失敗した計算はキャッシュに入れない。
      if (!force && this.completedAnalysis && this.completedAnalysis.maxFindings === this.maxFindings
          && sameAdjacency(this.completedAnalysis.graphAdj, graphAdj)) {
        plugin.maint.graphAdj = this.completedAnalysis.graphAdj;
        Object.assign(plugin.maint.result, this.completedAnalysis.result);
        return;
      }
      const tagRoles = await assessTagRoles(graphAdj, tick);
      const tagWeights = new Map([...tagRoles].map(([tag, role]) => [tag, role.weight]));
      const planar = await findNonPlanar(graphAdj, tick, this.maxFindings, { tagWeights });
      const areaModel = await buildAreaHierarchy(graphAdj, planar, tick);
      areaModel.tagRoles = Object.fromEntries(tagRoles);
      for (const combined of areaModel.combinedAreas) combined.tagRole = tagRoles.get(combined.tag);
      if (token !== plugin.maint.token) return;
      plugin.maint.graphAdj = graphAdj;
      this.completedAnalysis = { graphAdj, maxFindings: this.maxFindings, result: { planar, areaModel, analysisError: null } };
      plugin.maint.result = { ...plugin.maint.result, planar, areaModel, analysisError: null };
      this.renderViews();
    } catch (error) {
      if (error !== ABORTED) {
        console.error("メンテナンスチェック失敗:", error);
        if (token === plugin.maint.token) {
          plugin.maint.result = { ...plugin.maint.result, analysisError: error.code === "ANALYSIS_TIMEOUT" ? error.message : t("notice.analysisFailed") };
          new Notice(plugin.maint.result.analysisError);
          this.renderViews();
        }
      }
    } finally {
      if (token === plugin.maint.token) this.running = false;
      if (animateRefresh && spinToken === this.spinToken) {
        const remaining = Math.max(0, 1050 - (performance.now() - spinStartedAt));
        if (remaining > 0)
          await this.wait(remaining);
        if (spinToken === this.spinToken) {
          this.spinning = false;
          this.renderViews();
        }
      } else if (token === plugin.maint.token) {
        this.renderViews();
      }
    }
  }
}

module.exports = MaintenanceWorkflow;
