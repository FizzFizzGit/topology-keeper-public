// 分析結果から表示対象だけを取り出す。DOM・Vault操作・座標計算を持たない。
// 入力adjは読み取り専用。中核90、周辺35の上限と実辺／縮約辺の区別をここに集約する。
function selectGraph(adj, selection) {
  const allSelectedIds = [
    ...new Set((selection.nodes ?? []).filter((id) => adj.has(id))),
  ];
  const selectedIds = allSelectedIds
    .sort((a, b) => Number(b === selection.tag) - Number(a === selection.tag) || (adj.get(b)?.size ?? 0) - (adj.get(a)?.size ?? 0))
    .slice(0, 90);
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

  return { allSelectedIds, selected, ids, edges, boundaryLinks };
}
module.exports = { selectGraph };
