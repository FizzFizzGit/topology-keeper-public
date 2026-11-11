// 初期配置だけを担当する純粋な計算。入力のID・辺は変更しない。
// DOM、パン・ズーム、ドラッグ後の再配置は扱わない。戻り値のノード座標は表示側が所有する。
const nodeLabel = id => id.startsWith('#') ? id : id.split('/').pop().replace(/\.md$/, '');
function layoutGraph(ids, selected, edges) {
  const centerX = 800,
    centerY = 500;
  const nodes = ids.map((id, i) => {
    // Golden-angle seed avoids putting all nodes on a few axes before the force layout starts.
    const angle = i * 2.399963229728653;
    const radius = 45 + Math.sqrt(i + 1) * (selected.has(id) ? 70 : 125);
    const label = nodeLabel(id);
    return {
      id,
      selected: selected.has(id),
      label,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      labelWidth: Math.max(55, Math.min(420, label.length * 9 + 16)),
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const simEdges = edges
    .map((edge) => ({ ...edge, a: byId.get(edge.a), b: byId.get(edge.b) }))
    .filter((edge) => edge.a && edge.b);

  // Force-directed layout: stronger link attraction, pair repulsion, label-box collision avoidance,
  // and weak gravity. Unlike the previous version, context nodes have no fixed corner targets.
  const relax = (steps) => {
    const repulsion = 18000;
    for (let step = 0; step < steps; step++) {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x,
            dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = (i + 1) * 0.7;
            dy = (j + 1) * 0.4;
            d2 = dx * dx + dy * dy;
          }
          const d = Math.sqrt(d2);
          const minD = 68;
          const push =
            repulsion / Math.max(2500, d2) +
            (d < minD ? (minD - d) * 0.12 : 0);
          const fx = (dx / d) * push,
            fy = (dy / d) * push;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;

          // Approximate text rectangles to push apart labels that would overlap.
          const ay1 = a.y - 13,
            ay2 = a.y + 13;
          const by1 = b.y - 13,
            by2 = b.y + 13;
          const ax1 = a.x + 13,
            ax2 = ax1 + a.labelWidth;
          const bx1 = b.x + 13,
            bx2 = bx1 + b.labelWidth;
          const overlapX = Math.min(ax2, bx2) - Math.max(ax1, bx1);
          const overlapY = Math.min(ay2, by2) - Math.max(ay1, by1);
          if (overlapX > 0 && overlapY > 0) {
            const sign = a.x <= b.x ? -1 : 1;
            const labelPush = Math.min(3.5, overlapX * 0.025 + 0.5);
            a.vx += sign * labelPush;
            b.vx -= sign * labelPush;
            const ySign = a.y <= b.y ? -1 : 1;
            a.vy += ySign * overlapY * 0.035;
            b.vy -= ySign * overlapY * 0.035;
          }
        }
      }
      for (const edge of simEdges) {
        const { a, b } = edge;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const target = edge.contracted
          ? 205
          : a.selected && b.selected
            ? 175
            : 215;
        const force = (d - target) * 0.018;
        a.vx += (dx / d) * force;
        a.vy += (dy / d) * force;
        b.vx -= (dx / d) * force;
        b.vy -= (dy / d) * force;
      }
      for (const n of nodes) {
        // Mild central gravity keeps the graph in one navigable area without pinning nodes to corners.
        n.vx += (centerX - n.x) * 0.0007;
        n.vy += (centerY - n.y) * 0.0007;
        n.vx *= 0.72;
        n.vy *= 0.72;
        n.x += Math.max(-22, Math.min(22, n.vx));
        n.y += Math.max(-22, Math.min(22, n.vy));
      }
    }
  };
  relax(480);

  // Fit the coordinate space to the laid-out graph, retaining enough room for complete labels.
  const bounds = () => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x - 20);
      minY = Math.min(minY, n.y - 25);
      maxX = Math.max(maxX, n.x + n.labelWidth + 25);
      maxY = Math.max(maxY, n.y + 25);
    }
    return { minX, minY, maxX, maxY };
  };
  const b = bounds();
  const W = Math.max(1200, b.maxX - b.minX + 160);
  const H = Math.max(760, b.maxY - b.minY + 160);
  const offsetX = W / 2 - (b.minX + b.maxX) / 2;
  const offsetY = H / 2 - (b.minY + b.maxY) / 2;
  for (const n of nodes) {
    n.x += offsetX;
    n.y += offsetY;
  }
  return { nodes, simEdges, width: W, height: H };
}
module.exports = { layoutGraph };
