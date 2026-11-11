const { updateGraphDistances, chooseCoreNode } = require('./graph-distances');
const { makeProfile, makeEdges, voteOnEdges, findComponents, edgeVoteRate } = require('./distance-area-growth');
const { buildAreaHierarchy, areaSelection } = require('./area-model');
const { diagnoseAreaPlanarity } = require('./graph-analysis');

// 全ペアを扱う実験の負荷を抑える。しきい値は実例で確認した暫定値。
const MAX_DISTANCE_VERTICES = 256;
const EXPERIMENTAL_BOUNDARY_RATE = 0.025;

async function analyzeDistanceAreas(adjacency, tick, previous = {}) {
  const table = await updateGraphDistances(adjacency, previous.graph, previous.table, tick);
  const { nodes } = table;
  const notes = nodes.filter(node => !node.startsWith('#'));
  const profiles = notes.map(seed => makeProfile(seed,
    new Map(notes.map(note => [note, table.distance(seed, note)]).filter(([, distance]) => Number.isFinite(distance)))));
  const { edges, links } = makeEdges(adjacency, nodes);
  const candidatePairs = await voteOnEdges(profiles, table, edges, tick);
  const cut = new Set(edges.filter(edge => edgeVoteRate(edge) > EXPERIMENTAL_BOUNDARY_RATE));
  const { groups } = findComponents(links, cut);

  // 内訳には判定で残った辺を使う。切ったタグ辺は元のグラフからエリア間の接続を調べる。
  const internal = new Map(nodes.map(node => [node, new Set()]));
  for (const edge of edges) {
    if (cut.has(edge)) continue;
    const a = nodes[edge.a], b = nodes[edge.b];
    internal.get(a).add(b);
    internal.get(b).add(a);
  }
  const distance = [];
  for (const group of groups) {
    const members = group.map(index => nodes[index]).sort();
    const areaNotes = members.filter(node => !node.startsWith('#'));
    if (!areaNotes.length) continue;
    if (areaNotes.length === 1) {
      // 分割前から共有タグだけでつながるノートは、単独の距離エリアとして数えない。
      // 距離表や境界票には含めるので、他のノートとの接続は分析に反映される。
      const neighbors = [...adjacency.get(areaNotes[0])];
      if (neighbors.every(node => node.startsWith('#'))
          && neighbors.some(tag => adjacency.get(tag).size > 1)) continue;
    }
    const links = members.flatMap(from => [...internal.get(from)]
      .filter(to => from < to).map(to => [from, to]));
    const coreNode = await chooseCoreNode(members, areaNotes, internal, tick);
    distance.push({ nodes: members, links, noteCount: areaNotes.length, coreNode });
  }
  distance.sort((a, b) => b.noteCount - a.noteCount || a.nodes[0].localeCompare(b.nodes[0]));
  const model = await buildAreaHierarchy(adjacency, { distance }, tick, internal);
  // 診断対象は部分グラフと同じ。素領域には直接リンク、結合領域には根拠のタグ辺も入る。
  for (const area of [...model.originalAreas, ...model.combinedAreas.filter(area => area.scope === 'within-parent')]) {
    await tick();
    let { nodes, links } = areaSelection(model, area.id);
    if (area.tag) {
      // 結合の見出しタグだけに絞ると、複数タグを経由する閉路が消えてしまう。
      // 所属ノートは維持し、そのノートが親エリア内で持つ全タグ辺を診断・表示に使う。
      // 距離境界で切った辺や、親エリア外のタグ・ノートは戻さない。
      const parent = model.parents.find(parent => area.parentIds.includes(parent.id));
      const members = new Set(nodes.filter(node => !node.startsWith('#')));
      for (const node of parent.selection.nodes) {
        if (node.startsWith('#') && [...internal.get(node)].some(note => members.has(note))) members.add(node);
      }
      nodes = [...members].sort();
      links = nodes.flatMap(from => [...internal.get(from)]
        .filter(to => members.has(to) && from < to).map(to => [from, to]));
      area.selection = { id: area.id, nodes, links, exact: true };
    }
    const graph = new Map(nodes.map(node => [node, new Set()]));
    for (const [a, b] of links) {
      graph.get(a).add(b);
      graph.get(b).add(a);
    }
    if (!area.tag) area.coreNode = await chooseCoreNode(nodes, nodes, graph, tick);
    const { classification, linkDensity } = await diagnoseAreaPlanarity(graph, tick);
    area.classification = classification;
    if (area.tag) area.linkDensity = linkDensity;
  }
  return { model, candidatePairs, threshold: EXPERIMENTAL_BOUNDARY_RATE, table };
}

module.exports = { analyzeDistanceAreas, MAX_DISTANCE_VERTICES };
