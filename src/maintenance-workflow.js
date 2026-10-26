const { buildAdjacency, findNonPlanar } = require("./graph-analysis");
const { Notice } = require("obsidian");
const { CONFIG } = require("./plugin-settings");

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
  }

  cancel() {
    this.plugin.maint.token++;
    this.running = false;
    this.spinning = false;
    this.spinToken++;
  }

  makeTicker(token) {
    let last = performance.now();
    const started = last;
    return async () => {
      if (performance.now() - started > CONFIG.analysisTimeLimit) {
        const error = new Error("エリア分析が時間上限（10秒）に達しました。前回の結果がある場合は保持します。");
        error.code = "ANALYSIS_TIMEOUT";
        throw error;
      }
      if (performance.now() - last > 12) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        last = performance.now();
      }
      if (token !== this.plugin.maint.token) throw ABORTED;
    };
  }

  async run(force = false, animateRefresh = false) {
    const plugin = this.plugin;
    if (!plugin.state.visible && !force) return;
    const token = ++plugin.maint.token;
    const spinToken = animateRefresh ? ++this.spinToken : null;
    const spinStartedAt = animateRefresh ? performance.now() : 0;
    this.running = true;
    if (animateRefresh) this.spinning = true;
    plugin.mainView.render(force);
    const tick = this.makeTicker(token);
    try {
      const { orphans, strayThumbs, orphanBases, ready } = plugin.computeOrphans();
      plugin.maint.result = {
        orphans,
        strayThumbs,
        orphanBases,
        maintenanceReady: ready,
        planar: plugin.maint.result?.planar ?? null,
      };
      plugin.mainView.render(force);
      const graphAdj = buildAdjacency(plugin.app, {
        isManaged: this.isManaged,
        isManagedPath: this.isManagedPath,
        getAllTags: this.getAllTags,
      });
      const planar = await findNonPlanar(graphAdj, tick, this.maxFindings);
      if (token !== plugin.maint.token) return;
      plugin.maint.graphAdj = graphAdj;
      plugin.maint.result = { orphans, strayThumbs, orphanBases, planar, maintenanceReady: ready };
      plugin.mainView.render(force);
    } catch (error) {
      if (error !== ABORTED) {
        console.error("メンテナンスチェック失敗:", error);
        if (token === plugin.maint.token) {
          plugin.maint.result = { ...plugin.maint.result, analysisError: error.code === "ANALYSIS_TIMEOUT" ? error.message : "エリア分析に失敗しました。再チェックしてください。" };
          new Notice(plugin.maint.result.analysisError);
          plugin.mainView.render(true);
        }
      }
    } finally {
      if (token === plugin.maint.token) this.running = false;
      if (spinToken !== null) {
        const remaining = Math.max(0, 1050 - (performance.now() - spinStartedAt));
        if (remaining > 0)
          await new Promise((resolve) => setTimeout(resolve, remaining));
        if (spinToken === this.spinToken) {
          this.spinning = false;
          document
            .querySelectorAll(".alp-refresh-btn")
            .forEach((button) => button.classList.remove("is-loading"));
          plugin.mainView.render(true);
        }
      } else if (token === plugin.maint.token) {
        plugin.mainView.render(true);
      }
    }
  }
}

module.exports = MaintenanceWorkflow;
