const { t } = require('./i18n');
const { Notice } = require("obsidian");
const { areaSelection } = require('./area-model');
const { combinedAreaCategory, combinedAreaColors, combinedAreaMeanDegree } = require('./combined-area-style');

function graphRgb(color) {
  if (/^#[\da-f]{6}$/i.test(color)) return Number.parseInt(color.slice(1), 16);
  // CSS変数や色の混合はテーマ上で解決する。標準グラフにはRGBの整数を渡す。
  const probe = document.body.createSpan();
  try {
    probe.style.color = color;
    const resolved = document.defaultView.getComputedStyle(probe).color;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = resolved;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return (r << 16) | (g << 8) | b;
  } finally {
    probe.remove();
  }
}

function combinedGraphColors(model, state) {
  if (!model) return [];
  const colors = combinedAreaColors({
    planar: state.graphPlanarColor,
    nonplanar: state.graphNonPlanarColor,
    densePlanar: state.clusterHighlightColor,
    undetermined: state.graphUndeterminedColor,
  });
  const areas = model.combinedAreas.filter(area => area.scope === 'within-parent')
    .sort((a, b) => b.noteCount - a.noteCount || a.tag.localeCompare(b.tag));
  const assigned = new Set();
  const byCategory = new Map();
  for (const area of areas) {
    const selection = areaSelection(model, area.id);
    const category = combinedAreaCategory(area.classification, combinedAreaMeanDegree(selection));
    if (category === 'undetermined') continue;
    for (const node of selection.nodes) {
      if (node.startsWith('#') || assigned.has(node)) continue;
      assigned.add(node);
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category).push(`path:"${node.replace(/"/g, '\\"')}"`);
    }
  }
  return [...byCategory].map(([category, paths]) => ({
    query: paths.join(' OR '), color: { a: 1, rgb: graphRgb(colors[category]) },
  }));
}

// 結合領域の4区分を反映し、標準グラフを新しいタブに開く。
async function openStandardGraph(plugin) {
  const graphPlugin = plugin.app.internalPlugins?.plugins?.graph?.instance;
  if (!graphPlugin?.options || typeof graphPlugin.saveOptions !== "function") {
    new Notice(
      t("notice.graphUnavailable"),
    );
    return;
  }

  const managedQueries = new Set(plugin.state.graphColorGroupQueries ?? []);

  try {
    const colorGroups = combinedGraphColors(plugin.maint.result?.distanceAnalysis?.model, plugin.state);
    if (managedQueries.size || colorGroups.length) {
      const options = graphPlugin.options;
      const groups = Array.isArray(options.colorGroups) ? options.colorGroups : [];
      const remaining = [...colorGroups, ...groups.filter(group => !managedQueries.has(group?.query))];
      if (colorGroups.length || remaining.length !== groups.length) {
        options.colorGroups = remaining;
        try {
          await graphPlugin.saveOptions();
        } catch (error) {
          options.colorGroups = groups;
          throw error;
        }
      }
      plugin.state.graphColorGroupQueries = colorGroups.map(group => group.query);
      await plugin.saveData(plugin.state);
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
  } catch (error) {
    console.error("Topology Keeper: failed to open the standard graph", error);
    new Notice(
      t("notice.graphFailed"),
    );
  }
}

module.exports = openStandardGraph;
