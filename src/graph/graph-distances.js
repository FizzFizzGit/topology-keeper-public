// ノート・タグの隣接表 Map<頂点ID, Set<頂点ID>> から、全頂点間の最短距離を求める。
// edgeCost(from, to) でリンクごとに距離を指定できる。省略時はどの辺も距離1。
// 元の隣接表は変更しない。逆向きの辺は入力にある場合だけ使う。
// 計算量は O(V³)、距離表の使用量は 8 × V² バイト。小さい分析範囲向け。
async function measureGraphDistances(adjacency, { edgeCost = () => 1, tick } = {}) {
  if (tick) await tick();
  const nodes = Object.freeze([...adjacency.keys()]);
  const index = new Map(nodes.map((node, i) => [node, i]));
  const size = nodes.length;
  // 一行を連続したメモリに置く。セル (from, to) は from * size + to。
  const distances = new Float64Array(size * size).fill(Infinity);
  const checkpointWork = 65_536;
  let work = 0;
  for (const [from, neighbors] of adjacency) {
    const i = index.get(from);
    const row = i * size;
    distances[row + i] = 0;
    for (const to of neighbors) {
      if (tick && ++work >= checkpointWork) {
        work = 0;
        await tick();
      }
      const j = index.get(to);
      if (j === undefined) throw new RangeError('Neighbor is missing from the graph');
      const cost = edgeCost(from, to);
      if (!Number.isFinite(cost) || cost < 0) throw new RangeError('Edge cost must be finite and non-negative');
      distances[row + j] = Math.min(distances[row + j], cost);
    }
  }

  // 経由できる頂点を一つずつ増やす。via を一番外側に置くことで、
  // via までの距離と via から先の距離は、それまでに求めた最短距離を使える。
  for (let via = 0; via < size; via++) {
    const viaRow = via * size;
    for (let from = 0; from < size; from++) {
      // 内側の比較ごとに待つと計算が重くなるため、行の間で制御を返す。
      if (tick && (work += size) >= checkpointWork) {
        work = 0;
        await tick();
      }
      const row = from * size;
      const toVia = distances[row + via];
      if (toVia === Infinity) continue;
      for (let to = 0; to < size; to++) {
        const candidate = toVia + distances[viaRow + to];
        if (candidate < distances[row + to]) distances[row + to] = candidate;
      }
    }
  }

  return createDistanceTable(nodes, distances);
}

function createDistanceTable(nodeIds, distances) {
  const nodes = Object.freeze([...nodeIds]);
  const index = new Map(nodes.map((node, i) => [node, i]));
  const size = nodes.length;
  return {
    nodes,
    // 未登録の頂点と、登録済みだが到達できない頂点を区別する。
    distance(from, to) {
      const i = index.get(from);
      const j = index.get(to);
      return i === undefined || j === undefined ? undefined : distances[i * size + j];
    },
  };
}

// 距離エリアの辺はすべて重み1。前回の隣接表とホップ表から、更新が必要な行を選ぶ。
// 追加辺が旧距離の三角不等式を破るか、削除辺が旧最短路の候補だった場合だけ、
// 現在の隣接表でその始点から幅優先探索する。同距離の代替経路もここで考慮できる。
async function updateGraphDistances(adjacency, previousGraph, previousTable, tick) {
  if (!previousGraph || !previousTable) return measureGraphDistances(adjacency, { tick });
  await tick();
  const nodes = [...adjacency.keys()];
  const size = nodes.length;
  const added = [], removed = [];
  for (const [from, neighbors] of adjacency) {
    for (const to of neighbors) if (!previousGraph.get(from)?.has(to)) added.push([from, to]);
  }
  for (const [from, neighbors] of previousGraph) {
    for (const to of neighbors) if (!adjacency.get(from)?.has(to)) removed.push([from, to]);
  }
  if (!added.length && !removed.length && size === previousTable.nodes.length
      && nodes.every((node, i) => node === previousTable.nodes[i])) return previousTable;

  const index = new Map(nodes.map((node, i) => [node, i]));
  const links = nodes.map(node => [...adjacency.get(node)].map(other => index.get(other)));
  const distances = new Float64Array(size * size);
  for (const [row, source] of nodes.entries()) {
    await tick();
    const oldDistance = node => previousTable.distance(source, node) ?? Infinity;
    const affected = !previousGraph.has(source)
      || removed.some(([a, b]) => oldDistance(a) !== Infinity && oldDistance(a) + 1 === oldDistance(b))
      || added.some(([a, b]) => oldDistance(a) + 1 < oldDistance(b));
    const start = row * size;
    if (!affected) {
      for (const [column, node] of nodes.entries()) distances[start + column] = oldDistance(node);
      continue;
    }
    distances.fill(Infinity, start, start + size);
    distances[start + row] = 0;
    const queue = [row];
    for (const vertex of queue) {
      const hops = distances[start + vertex] + 1;
      for (const neighbor of links[vertex]) {
        if (distances[start + neighbor] !== Infinity) continue;
        distances[start + neighbor] = hops;
        queue.push(neighbor);
      }
    }
  }
  return createDistanceTable(nodes, distances);
}

async function chooseCoreNode(members, notes, internal, tick) {
  const totals = new Map(members.map(node => [node, 0]));
  // 無向グラフなので、各ノートを始点に一度探索すれば、タグを含む全候補への距離を集計できる。
  // 分割後の辺だけをたどるため、切断した接続による近道は芯の選択に影響しない。
  for (const note of notes) {
    await tick();
    const visited = new Set([note]);
    const queue = [[note, 0]];
    for (const [node, hops] of queue) {
      totals.set(node, totals.get(node) + hops);
      for (const next of internal.get(node)) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push([next, hops + 1]);
      }
    }
  }
  // 同じ距離なら、まとまりを名前で示せるタグを優先。以降は頂点ID順で安定させる。
  return members.reduce((best, node) => {
    const difference = totals.get(node) - totals.get(best);
    return difference < 0 || (difference === 0 && node.startsWith('#') && !best.startsWith('#')) ? node : best;
  });
}

module.exports = { measureGraphDistances, updateGraphDistances, createDistanceTable, chooseCoreNode };
