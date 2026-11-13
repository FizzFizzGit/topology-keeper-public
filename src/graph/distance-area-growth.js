function makeProfile(seed, distances) {
  const shells = new Map();
  for (const [node, hops] of distances) {
    if (!shells.has(hops)) shells.set(hops, []);
    shells.get(hops).push(node);
  }
  const ordered = [...shells].sort(([a], [b]) => a - b);
  const core = new Set();
  // 試作上、始点を含む3ノートが初めてそろう段を芯とする。
  // 同じ距離のノートはまとめて含めるので、芯の距離と大きさは始点ごとに変わる。
  let coreRadius = null;
  for (const [hops, nodes] of ordered) {
    for (const node of nodes) core.add(node);
    if (core.size >= 3) {
      coreRadius = hops;
      break;
    }
  }
  return { seed, distances, shells, ordered, core, coreRadius };
}

function compareGrowth(left, right, collectSteps = true) {
  if (left.coreRadius === null || right.coreRadius === null) return null;
  const sharedCore = [...left.core].filter(node => right.core.has(node));
  if (sharedCore.length) return { sharedCore };
  const a = new Set(left.core);
  const b = new Set(right.core);
  const seedDistance = left.distances.get(right.seed);
  if (seedDistance === undefined) return null;
  const steps = [];
  let previousRatio = 0;
  let sharedCount = 0;
  let peak = null;
  // 相手の始点に届く段までを観測する。全グラフに広がった後の重なりは比較に入れない。
  const lastRound = seedDistance - Math.max(left.coreRadius, right.coreRadius);
  for (let round = 1; round <= lastRound; round++) {
    const radiusA = left.coreRadius + round;
    const radiusB = right.coreRadius + round;
    const addedA = left.shells.get(radiusA) ?? [];
    const addedB = right.shells.get(radiusB) ?? [];
    const previousShared = sharedCount;
    for (const node of addedA) {
      a.add(node);
      if (b.has(node)) sharedCount++;
    }
    for (const node of addedB) {
      b.add(node);
      if (a.has(node)) sharedCount++;
    }
    const ratio = sharedCount / (a.size + b.size - sharedCount);
    const gain = ratio - previousRatio;
    let step = { radiusA, radiusB };
    if (collectSteps) {
      step = { ...step, sizeA: a.size, sizeB: b.size, addedA, addedB,
        shared: [...a].filter(node => b.has(node)), newShared: sharedCount - previousShared, ratio };
      steps.push(step);
    }
    // 相手の始点に届く段では必ず重複するので、その段を候補から除く。
    // 同じ伸びなら先に現れた段を採用する。
    if (round < lastRound && gain > 0 && (!peak || gain > peak.gain)) peak = { ...step, gain };
    previousRatio = ratio;
  }
  return { steps, peak };
}

function makeEdges(graph, nodes) {
  const index = new Map(nodes.map((node, i) => [node, i]));
  const edges = [];
  const links = nodes.map(() => []);
  for (const [a, from] of nodes.entries()) for (const to of graph.get(from)) {
    const b = index.get(to);
    if (a >= b) continue;
    const edge = { a, b, separate: 0, together: 0 };
    edges.push(edge);
    links[a].push({ next: b, edge });
    links[b].push({ next: a, edge });
  }
  return { edges, links };
}

async function voteOnEdges(profiles, table, edges, tick, reportProgress) {
  let checked = 0;
  const total = profiles.length * (profiles.length - 1) / 2;
  const checkpointPairs = Math.max(1, Math.min(64, Math.floor(65_536 / (table.nodes.length + edges.length))));
  const side = new Uint8Array(table.nodes.length);
  let candidates = 0;
  for (const [i, a] of profiles.entries()) {
    for (let j = i + 1; j < profiles.length; j++) {
      if (checked % checkpointPairs === 0) {
        reportProgress?.(checked / total);
        if (tick) await tick();
      }
      checked++;
      const b = profiles[j];
      const peak = compareGrowth(a, b, false)?.peak;
      if (!peak) continue;
      candidates++;
      for (const [k, node] of table.nodes.entries()) {
        const left = table.distance(a.seed, node) < peak.radiusA;
        const right = table.distance(b.seed, node) < peak.radiusB;
        // 両方の近傍に入る頂点や、どちらにも入らない頂点からは票を取らない。
        side[k] = left === right ? 0 : left ? 1 : 2;
      }
      for (const edge of edges) {
        if (!side[edge.a] || !side[edge.b]) continue;
        if (side[edge.a] === side[edge.b]) edge.together++;
        else edge.separate++;
      }
    }
  }
  return candidates;
}

function findComponents(links, cut) {
  const componentOf = new Int32Array(links.length).fill(-1);
  const groups = [];
  for (let start = 0; start < links.length; start++) {
    if (componentOf[start] >= 0) continue;
    const members = [start];
    const group = groups.length;
    componentOf[start] = group;
    for (const node of members) {
      for (const { next, edge } of links[node]) {
        if (componentOf[next] >= 0 || cut.has(edge)) continue;
        componentOf[next] = group;
        members.push(next);
      }
    }
    groups.push(members);
  }
  return { groups, componentOf };
}

const edgeVoteRate = edge => edge.separate ? edge.separate / (edge.separate + edge.together) : 0;

module.exports = { makeProfile, compareGrowth, makeEdges, voteOnEdges, findComponents, edgeVoteRate };
