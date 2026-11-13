/** 分析用の隣接表は無向。矢印は元の解決済みリンクから取り戻す。
 * タグの所属・縮約辺には元ノート間の向きを捏造しない。
 */
function edgeDirections(edge, resolvedLinks = {}) {
  if (edge.contracted || edge.a.startsWith('#') || edge.b.startsWith('#')) return { start: false, end: false };
  return { start: (resolvedLinks[edge.b]?.[edge.a] ?? 0) > 0,
    end: (resolvedLinks[edge.a]?.[edge.b] ?? 0) > 0 };
}

/** ノードとラベルを含む現在の配置へ合わせる。負座標も正座標も制限しない。 */
function fittedView(nodes, width, height, padding = 80) {
  const minX = Math.min(...nodes.map(node => node.x - 20)) - padding;
  const minY = Math.min(...nodes.map(node => node.y - 25)) - padding;
  const maxX = Math.max(...nodes.map(node => node.x + node.labelWidth + 25)) + padding;
  const maxY = Math.max(...nodes.map(node => node.y + 25)) + padding;
  const zoom = Math.min(width / (maxX - minX), height / (maxY - minY));
  return { zoom, panX: width / 2 - (minX + maxX) / 2 * zoom,
    panY: height / 2 - (minY + maxY) / 2 * zoom };
}
module.exports = { edgeDirections, fittedView };

// 円と矢印で同じ寸法を使う。strokeの外半分と描画のにじみ分を除ける。
const NODE_STROKE_WIDTH = 1.7;
const nodeRadius = node => node.selected ? 9 : 6;
function arrowTip(source, target, gap = 2) {
  const dx = target.x - source.x, dy = target.y - source.y;
  const distance = Math.hypot(dx, dy) || 1;
  const inset = nodeRadius(target) + NODE_STROKE_WIDTH / 2 + gap;
  return { x: target.x - dx / distance * inset, y: target.y - dy / distance * inset };
}
Object.assign(module.exports, { NODE_STROKE_WIDTH, nodeRadius, arrowTip });
