// 分析結果から表示対象だけを取り出す。DOM・Vault操作・座標計算を持たない。
// 選択エリアの内部に残った辺だけをたどり、芯からの最短ホップ数を求める。
function coreDistances(adj, selection, ids, core) {
  const internal = new Map(ids.map(id => [id, []]));
  if (selection.exact) {
    for (const [a, b] of selection.links ?? []) {
      if (!internal.has(a) || !internal.has(b) || !adj.get(a)?.has(b)) continue;
      internal.get(a).push(b);
      internal.get(b).push(a);
    }
  } else {
    for (const id of ids) {
      for (const neighbor of adj.get(id)) if (internal.has(neighbor)) internal.get(id).push(neighbor);
    }
  }
  const distances = new Map([[core, 0]]);
  const queue = [core];
  for (const id of queue) {
    for (const neighbor of internal.get(id)) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, distances.get(id) + 1);
      queue.push(neighbor);
    }
  }
  return distances;
}

// 入力adjは読み取り専用。描画する頂点と、実辺・縮約辺を選ぶ。
function selectGraph(adj, selection, maxCoreNodes = 90) {
  const allSelectedIds = [
    ...new Set((selection.nodes ?? []).filter((id) => adj.has(id))),
  ];
  const byDegree = (a, b) => adj.get(b).size - adj.get(a).size;
  allSelectedIds.sort((a, b) => Number(b === selection.tag) - Number(a === selection.tag) || byDegree(a, b));
  const truncated = allSelectedIds.length > maxCoreNodes;
  let maxHops;
  if (truncated) {
    const core = allSelectedIds.includes(selection.coreNode) ? selection.coreNode : allSelectedIds[0];
    const distances = coreDistances(adj, selection, allSelectedIds, core);
    allSelectedIds.sort((a, b) => (distances.get(a) ?? Infinity) - (distances.get(b) ?? Infinity)
      || byDegree(a, b) || a.localeCompare(b));
    maxHops = distances.get(allSelectedIds[maxCoreNodes - 1]);
  }
  const selectedIds = allSelectedIds.slice(0, maxCoreNodes);
  const selected = new Set(selectedIds);


  const maxContext = 35;
  const context = new Set();
  const boundaryLinks = selection.boundaryLinks ?? [];
  const boundaryKeys = new Set(
    boundaryLinks.map(([u, v]) =>
      u < v ? `${u}\0${v}` : `${v}\0${u}`,
    ),
  );
  const boundaryContext = new Set();
  for (const id of selection.exact ? [] : selected) {
    for (const neighbor of adj.get(id) ?? []) {
      if (!selected.has(neighbor)) context.add(neighbor);
    }
  }
  for (const [u, v] of boundaryLinks) {
    if (selected.has(u) && !selected.has(v)) boundaryContext.add(v);
    if (selected.has(v) && !selected.has(u)) boundaryContext.add(u);
  }
  for (const id of boundaryContext) context.add(id);
  const contextList = [...context]
    .sort(
      (a, b) =>
        Number(boundaryContext.has(b)) - Number(boundaryContext.has(a)) ||
        (adj.get(b)?.size ?? 0) - (adj.get(a)?.size ?? 0),
    )
    .slice(0, maxContext);
  const ids = [...selectedIds, ...contextList];
  const idSet = new Set(ids);
  // edges の各要素 { a, b, contracted, boundary }（a, b は頂点ID）。まず adj の実辺を集め、
  // selection.links / boundaryLinks の未登録辺は次数2抑制後の辺として足す。
  // edgeKeys は「u\0v」（u < v）の形の重複防止用のキー。
  const edges = [];
  const edgeKeys = new Set();
  const allowedEdges = selection.exact ? new Set((selection.links ?? []).map(([a, b]) =>
    JSON.stringify([a, b].sort()))) : null;
  for (const u of ids) {
    for (const v of adj.get(u) ?? []) {
      if (idSet.has(v) && u < v && (!allowedEdges || allowedEdges.has(JSON.stringify([u, v])))) {
        edges.push({
          a: u,
          b: v,
          contracted: false,
          boundary: boundaryKeys.has(`${u}\0${v}`),
        });
        edgeKeys.add(`${u}\0${v}`);
      }
    }
  }
  for (const [u, v] of selection.links ?? []) {
    if (selection.exact) continue; // Model selections contain actual links only.
    const key = u < v ? `${u}\0${v}` : `${v}\0${u}`;
    if (idSet.has(u) && idSet.has(v) && !edgeKeys.has(key)) {
      edges.push({ a: u, b: v, contracted: true });
      edgeKeys.add(key);
    }
  }
  for (const [u, v] of boundaryLinks) {
    const key = u < v ? `${u}\0${v}` : `${v}\0${u}`;
    if (idSet.has(u) && idSet.has(v) && !edgeKeys.has(key)) {
      edges.push({ a: u, b: v, contracted: true, boundary: true });
      edgeKeys.add(key);
    }
  }

  return { allSelectedIds, selected, ids, edges, boundaryLinks, maxHops };
}
module.exports = { selectGraph };
