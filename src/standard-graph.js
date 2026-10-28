const { t } = require('./i18n');
const { Notice } = require("obsidian");
const { CONFIG, getHighlightColor } = require("./plugin-settings");

// 領域のノートを標準グラフの共有色グループとして保存し、グラフを再読み込みする。
//
// 【入力】 plugin は main.js のプラグイン本体で、app / state / saveData を提供する。
//   plugin.maint.result.planar は findNonPlanar の結果。definite / hotspots / safe の各領域を
//   非平面 / ホットスポット / 平面の検索グループにまとめる。タグ頂点は path 検索から除外する。
// 【入出力】 app.internalPlugins.plugins.graph の非公開 API から標準グラフ設定全体を読み、
//   colorGroups だけを更新して保存する。前回のプラグイン管理グループだけを置き換えるため、
//   利用者の色グループは残る。
//   標準グラフの設定は全ビューで共有される。既存グラフは閉じず、新しいタブにグラフを開く。
//   検索フィルター等の設定は変更せず、色グループだけを追加する。
//   利用者の環境ではコアプラグインの disable / enable は不要と確認済み。
//   対応 API が無い場合や失敗時は通知する。
async function openClusterInStandardGraph(plugin) {
  const graphPlugin = plugin.app.internalPlugins?.plugins?.graph?.instance;
  if (!graphPlugin?.options || typeof graphPlugin.saveOptions !== "function") {
    new Notice(
      t("notice.graphUnavailable"),
    );
    return;
  }

  const planar = plugin.maint.result?.planar;
  if (!planar) {
    new Notice(t("notice.noAnalysis"));
    return;
  }

  const claimed = new Set();
  const categories = [
    {
      areas: planar.definite ?? [],
      color: plugin.state.graphNonPlanarColor ?? CONFIG.graphNonPlanarColor,
      fallback: CONFIG.graphNonPlanarColor,
    },
    {
      areas: planar.hotspots ?? [],
      color: getHighlightColor(plugin.state),
      fallback: CONFIG.clusterHighlightColor,
    },
    {
      areas: planar.safe ?? [],
      color: plugin.state.graphPlanarColor ?? CONFIG.graphPlanarColor,
      fallback: CONFIG.graphPlanarColor,
    },
    {
      areas: planar.remainder ?? [],
      color: plugin.state.graphUndeterminedColor ?? CONFIG.graphUndeterminedColor,
      fallback: CONFIG.graphUndeterminedColor,
    },
  ];
  const colorGroups = [];
  for (const { areas, color, fallback } of categories) {
    const paths = new Set();
    for (const area of areas) {
      for (const id of area.originalNodes ?? area.nodes ?? []) {
        if (String(id).startsWith("#") || claimed.has(id)) continue;
        paths.add(id);
      }
    }
    for (const path of paths) claimed.add(path);
    if (paths.size === 0) continue;
    const query = [...paths]
      .map((path) => `path:"${String(path).replace(/"/g, '\\"')}"`)
      .join(" OR ");
    const colorValue = /^#[0-9a-f]{6}$/i.test(color)
      ? color
      : fallback;
    const rgb = Number.parseInt(colorValue.slice(1), 16);
    colorGroups.push({ query, color: { a: 1, rgb } });
  }

  try {
    const options = graphPlugin.options;
    const groups = Array.isArray(options.colorGroups)
      ? options.colorGroups
      : [];
    const managedQueries = new Set(plugin.state.graphColorGroupQueries ?? []);
    if (plugin.state.graphHighlightQuery)
      managedQueries.add(plugin.state.graphHighlightQuery);
    const previousColorGroups = options.colorGroups;
    options.colorGroups = [
      ...colorGroups,
      ...groups.filter((group) => !managedQueries.has(group?.query)),
    ];
    try {
      await graphPlugin.saveOptions();
    } catch (error) {
      options.colorGroups = previousColorGroups;
      throw error;
    }
    plugin.state.graphColorGroupQueries = colorGroups.map((group) => group.query);
    delete plugin.state.graphHighlightQuery;
    await plugin.saveData(plugin.state);
    if (colorGroups.length === 0) {
      new Notice(t("notice.colorsCleared"));
      return;
    }

    // 先に表示先を確保する。グラフが唯一のタブだった場合、先に閉じると
    // "tab" を作るためのタブグループまで消えてしまう。
    const workspace = plugin.app.workspace;
    let leaf;
    try {
      leaf = workspace.getLeaf("tab");
    } catch (error) {
      // タブグループ自体がまだ無いレイアウトでは、ルート分割に新しいleafを作る。
      if (error?.message !== "No tab group found.") throw error;
      leaf = workspace.getLeaf(true);
    }
    await leaf.setViewState({ type: "graph", active: true });
    new Notice(t("notice.graphOpened"));
  } catch (error) {
    console.error("Topology Keeper: failed to open highlighted graph", error);
    new Notice(
      t("notice.graphFailed"),
    );
  }
}

module.exports = openClusterInStandardGraph;
