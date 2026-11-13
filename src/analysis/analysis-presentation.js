const { areaSelection } = require('../graph');

const PARENT_LABELS = { safe: 'area.parentPlanar', definite: 'area.parentNonplanar',
  low: 'area.parentLow', small: 'area.parentSmall', boundary: 'area.parentBoundary',
  distance: 'area.parentDistance' };
const coreLabel = node => node?.startsWith('#') ? node : node?.split('/').pop().replace(/\.md$/i, '');

// 分析の事実データから、翻訳済みの表示情報を一度だけ組み立てる。
// 元モデルを変更せず、索引もこの描画の間だけ保持する。DOM・選択の保存は担当しない。
function presentAnalysis(source, t) {
  const model = { ...source, parents: source.parents.map(parent => ({ ...parent,
    label: coreLabel(parent.coreNode) ?? t(PARENT_LABELS[parent.category], { index: parent.labelIndex }),
  })) };
  const parents = new Map(model.parents.map(parent => [parent.id, parent]));
  const areas = new Map(model.originalAreas.map(area => [area.id, area]));
  const connections = new Map(model.combinedAreas.map(area => [area.id, area]));
  const parentOf = areaId => parents.get(areas.get(areaId)?.parentId);
  return {
    model, parentOf,
    parent: id => parents.get(id),
    selection(id) {
      const selection = areaSelection(model, id);
      if (!selection) return null;
      if (model.parents[0]?.kind === 'distance') selection.distanceAnalysis = true;
      if (parents.has(id)) {
        const parent = parents.get(id);
        selection.title = parent.label;
        selection.coreNode = parent.coreNode;
      } else if (areas.has(id)) {
        const area = areas.get(id);
        selection.title = coreLabel(area.coreNode) ?? t('area.primitiveRow', { count: area.nodes.length });
      } else {
        const connection = connections.get(id);
        selection.title = connection.tag;
        if (connection.scope === 'cross-parent') {
          const labels = connection.parentIds.map(id => parents.get(id)?.label).filter(Boolean);
          selection.title = t('area.connectionTitle', {
            label: t('term.crossAreaConnection'), tag: connection.tag,
            parents: labels.length ? ` (${labels.join(' · ')})` : '',
          });
        }
      }
      return selection;
    },
    targetLabels(connection, parentId) {
      // タグが結ぶ全親ではなく、実際にこの親と接続する相手だけを表示する。
      const destinations = new Set();
      const memberParents = new Map(connection.members.map(member =>
        [member.areaId, member.parentId ?? areas.get(member.areaId)?.parentId]));
      for (const pair of connection.connections) {
        const pairParents = pair.areaIds.map(id => memberParents.get(id));
        if (pairParents.includes(parentId))
          for (const id of pairParents) if (id && id !== parentId) destinations.add(id);
      }
      return [...destinations].map(id => parents.get(id)?.label).filter(Boolean);
    },
  };
}
module.exports = { presentAnalysis };
