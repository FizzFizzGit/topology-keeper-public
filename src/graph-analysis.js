// グラフ構築と平面性の診断処理。UIやプラグイン状態には依存させない。
// 既存アルゴリズムをそのまま切り出し、設定やObsidian APIは引数で受け取る。

const HOTSPOT_DENSITY_THRESHOLD = 0.25;
const HOTSPOT_MIN_NODES = 3;
const REMAINDER_LABELS = {
  low: '低密度・平面性未判定',
  small: '小規模・平面性未判定',
  boundary: '境界部分・平面性未判定',
};
function getRemainderKind(area) {
  if (area.nodes.length < HOTSPOT_MIN_NODES) return 'small';
  const density = area.linkDensity ?? (2 * (area.edges ?? area.links?.length ?? 0) / (area.nodes.length * (area.nodes.length - 1)));
  return density < HOTSPOT_DENSITY_THRESHOLD ? 'low' : 'boundary';
}

// ノートとタグの無向グラフを作る。頂点はノートのパス、またはタグ（"#タグ" 形式の文字列）。
// 辺は「ノート間の実リンク」と「ノートとタグの付与関係」。管理フォルダ内のファイルは頂点にしない。
//
// 【入力】
//   app.metadataCache.resolvedLinks : { リンク元パス: { リンク先パス: 個数 } }（解決済みの本文リンク）。
//   app.vault.getMarkdownFiles()    : Markdown ノートの TFile 配列。画像や .base は頂点にしない。
//   app.metadataCache.getFileCache(file) : CachedMetadata（未解析なら null）。getAllTags に渡す。
//   getAllTags(cache) : "#" 付きのタグ文字列の配列（frontmatter の tags と本文の #タグの両方）。無ければ null。
//   isManaged(file) / isManagedPath(path) : 管理フォルダ内か。該当するものは頂点にも辺にも入れない。
// 【出力】 Map<頂点ID, Set<隣接する頂点ID>>（無向なので辺は両方向に入る）。
//   頂点IDは、ノートなら Vault 相対パス（例 "資料/メモ.md"）、タグなら "#" 付きの文字列（例 "#資料"）。
//   "#" で始まるかどうかでタグとノートを区別している（graph-view.js の nodeLabel や、
//   findNonPlanar の bad の集計など）。他のモジュールの tag-suggest.js は "#" を外して扱うので、混同しないこと。
//   自分自身への辺は作らない。
//   戻り値は maintenance-workflow.js が maint.graphAdj に保持し、findNonPlanar の入力と、
//   graph-view.js のグラフ描画（周辺ノードの取得）に使われる。保存はしない。
function buildAdjacency(app, { isManaged, isManagedPath, getAllTags }) {
  const adj = new Map();
  const addEdge = (u, v) => {
    if (!u || !v || u === v) return;
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(v)) adj.set(v, new Set());
    adj.get(u).add(v);
    adj.get(v).add(u);
  };
  const resolved = app.metadataCache.resolvedLinks;
  const markdownPaths = new Set(
    app.vault
      .getMarkdownFiles()
      .filter((f) => !isManaged(f))
      .map((f) => f.path),
  );

  for (const file of app.vault.getMarkdownFiles()) {
    if (isManaged(file)) continue;
    for (const dest of Object.keys(resolved[file.path] ?? {})) {
      // グラフはノートとタグを対象にする。画像・BaseなどのVault内ファイルは頂点にしない。
      if (markdownPaths.has(dest) && !isManagedPath(dest))
        addEdge(file.path, dest);
    }
    const cache = app.metadataCache.getFileCache(file);
    for (const tag of (cache ? getAllTags(cache) : null) ?? []) {
      addEdge(file.path, tag);
    }
  }
  return adj;
}

async function findK5(adj, order, idx, limit, tick) {
  const found = [];
  let work = 0;
  for (let i = 0; i < order.length; i++) {
    await tick();
    const v = order[i];
    const nb = [...adj.get(v)].filter((n) => idx.get(n) > i);
    if (nb.length < 4) continue;

    for (let a = 0; a < nb.length; a++) {
      await tick();
      for (let b = a + 1; b < nb.length; b++) {
        if (!adj.get(nb[a]).has(nb[b])) continue;
        for (let c = b + 1; c < nb.length; c++) {
          if (!adj.get(nb[a]).has(nb[c]) || !adj.get(nb[b]).has(nb[c]))
            continue;
          for (let d = c + 1; d < nb.length; d++) {
            if (++work % 500 === 0) await tick();
            if (
              !adj.get(nb[a]).has(nb[d]) ||
              !adj.get(nb[b]).has(nb[d]) ||
              !adj.get(nb[c]).has(nb[d])
            )
              continue;
            found.push([v, nb[a], nb[b], nb[c], nb[d]].sort());
            if (found.length >= limit) return { found, truncated: true };
          }
        }
      }
    }
  }
  return { found, truncated: false };
}

async function findK33(adj, order, limit, tick) {
  let work = 0;
  const cand = order.filter((id) => adj.get(id).size >= 3);
  const pos = new Map(cand.map((id, i) => [id, i]));
  const found = [];
  const seen = new Set();

  for (let i = 0; i < cand.length; i++) {
    await tick();
    const u1 = cand[i];
    const A1 = adj.get(u1);

    // u1 と共通の隣接を3つ以上もつ u2 の候補を、二歩先の数え上げで絞る
    const counts = new Map();
    for (const n of A1) {
      for (const u2 of adj.get(n)) {
        if (++work % 500 === 0) await tick();
        const j = pos.get(u2);
        if (j === undefined || j <= i) continue;
        counts.set(u2, (counts.get(u2) ?? 0) + 1);
      }
    }

    for (const [u2, cnt] of counts) {
      await tick();
      if (cnt < 3) continue;
      const j = pos.get(u2);
      const A2 = adj.get(u2);
      const c12 = [...A1].filter((n) => A2.has(n));

      // 共通近傍のうち任意の3頂点と接続すれば候補。先頭の1頂点との接続は必須ではない。
      const thirdCandidates = new Set();
      for (const n of c12) {
        for (const u3 of adj.get(n)) {
          if (++work % 500 === 0) await tick();
          thirdCandidates.add(u3);
        }
      }
      for (const u3 of thirdCandidates) {
        await tick();
        const k = pos.get(u3);
        if (k === undefined || k <= j) continue;
        const A3 = adj.get(u3);
        const common = c12.filter((n) => A3.has(n)).sort();
        if (common.length < 3) continue;

        const X = [u1, u2, u3].sort();
        for (let a = 0; a < common.length; a++) {
          for (let b = a + 1; b < common.length; b++) {
            for (let c = b + 1; c < common.length; c++) {
              if (++work % 500 === 0) await tick();
              const Y = [common[a], common[b], common[c]];
              const key = `${X.join(",")}||${Y.join(",")}`;
              const rev = `${Y.join(",")}||${X.join(",")}`;
              if (seen.has(key) || seen.has(rev)) continue;
              seen.add(key);
              found.push({ X, Y });
              if (found.length >= limit) return { found, truncated: true };
            }
          }
        }
      }
    }
  }
  return { found, truncated: false };
}

async function reduceGraph(adj, tick) {
  // 次数0/1の頂点を除き、次数2の頂点を抑制する。
  // いずれも平面性を変えず、K5/K3,3 の細分を検出しやすくする。
  const graph = new Map([...adj].map(([u, ns]) => [u, new Set(ns)]));
  const edgeKey = (a, b) => JSON.stringify([a, b].sort());
  const witnesses = new Map();
  for (const [u, ns] of adj) for (const v of ns) {
    if (u < v) witnesses.set(edgeKey(u, v), new Set([u, v]));
  }
  const queue = [...graph.keys()];
  let head = 0;
  const enqueueIfSmall = (u) => {
    if (graph.has(u) && graph.get(u).size <= 2) queue.push(u);
  };

  while (head < queue.length) {
    if (head % 100 === 0) await tick();
    const u = queue[head++];
    const neighbors = graph.get(u);
    if (!neighbors || neighbors.size > 2) continue;

    const ns = [...neighbors];
    for (const v of ns) graph.get(v)?.delete(u);
    graph.delete(u);

    if (ns.length === 2) {
      const [a, b] = ns;
      if (a !== b && graph.has(a) && graph.has(b)) {
        const key = edgeKey(a, b);
        const source = new Set([...(witnesses.get(key) ?? []),
          ...(witnesses.get(edgeKey(a, u)) ?? [a, u]),
          ...(witnesses.get(edgeKey(u, b)) ?? [u, b])]);
        witnesses.set(key, source);
        graph.get(a).add(b);
        graph.get(b).add(a);
      }
    }
    for (const v of ns) witnesses.delete(edgeKey(u, v));
    for (const v of ns) enqueueIfSmall(v);
  }
  return { graph, witnesses };
}

// Tarjan法で2連結成分（ブロック）を抽出する。再帰を使わず大きなVaultでのスタック溢れを避ける。
async function findBiconnectedComponents(graph, tick) {
  const discovery = new Map();
  const low = new Map();
  const parent = new Map();
  const edgeStack = [];
  const blocks = [];
  let time = 0;
  let work = 0;

  const emitUntil = (u, v) => {
    const nodes = new Set();
    while (edgeStack.length) {
      const [a, b] = edgeStack.pop();
      nodes.add(a);
      nodes.add(b);
      if ((a === u && b === v) || (a === v && b === u)) break;
    }
    if (nodes.size) blocks.push(nodes);
  };

  for (const root of graph.keys()) {
    if (discovery.has(root)) continue;
    discovery.set(root, ++time);
    low.set(root, time);
    const stack = [
      { u: root, neighbors: [...(graph.get(root) ?? [])], index: 0 },
    ];

    while (stack.length) {
      if (++work % 200 === 0) await tick();
      const frame = stack[stack.length - 1];
      const u = frame.u;
      if (frame.index < frame.neighbors.length) {
        const v = frame.neighbors[frame.index++];
        if (!discovery.has(v)) {
          parent.set(v, u);
          edgeStack.push([u, v]);
          discovery.set(v, ++time);
          low.set(v, time);
          stack.push({ u: v, neighbors: [...(graph.get(v) ?? [])], index: 0 });
        } else if (v !== parent.get(u) && discovery.get(v) < discovery.get(u)) {
          low.set(u, Math.min(low.get(u), discovery.get(v)));
          edgeStack.push([u, v]);
        }
        continue;
      }

      stack.pop();
      const p = parent.get(u);
      if (p !== undefined) {
        low.set(p, Math.min(low.get(p), low.get(u)));
        if (low.get(u) >= discovery.get(p)) emitUntil(p, u);
      } else if (edgeStack.length) {
        const nodes = new Set();
        while (edgeStack.length) {
          const [a, b] = edgeStack.pop();
          nodes.add(a);
          nodes.add(b);
        }
        if (nodes.size) blocks.push(nodes);
      }
    }
  }
  return blocks;
}

function inducedAdjacency(graph, nodes) {
  const out = new Map();
  for (const u of nodes) {
    out.set(u, new Set([...(graph.get(u) ?? [])].filter((v) => nodes.has(v))));
  }
  return out;
}

// 入力の2連結成分を、内部リンクの集中度（モジュラリティ）が増すまとまりへ分割する。
// 重み付き縮約を反復し、同じ密度の領域間も分離する。元の頂点集合を返し、入力は変更しない。
async function splitStructuralAreas(graph, tick, tagWeights = null, edgeWeights = null, boundaryRatio = 1) {
  const edgeWeight = (u, v) => edgeWeights?.get(JSON.stringify([u, v].sort()))
    ?? Math.min(tagWeights?.get(u) ?? 1, tagWeights?.get(v) ?? 1);
  let weighted = new Map([...graph].map(([u, ns]) => [u, new Map([...ns].map(v => [v, edgeWeight(u, v)]))]));
  let members = new Map([...graph.keys()].map(u => [u, new Set([u])]));
  const total = [...weighted.values()].reduce((sum, ns) => sum + [...ns.values()].reduce((a, b) => a + b, 0), 0);
  if (!total) return [...members.values()];
  for (;;) {
    const community = new Map([...weighted.keys()].map(u => [u, u]));
    const degrees = new Map([...weighted].map(([u, ns]) => [u, [...ns.values()].reduce((a, b) => a + b, 0)]));
    const totals = new Map(degrees);
    for (let pass = 0; pass < 100; pass++) {
      let changed = false;
      for (const [u, ns] of weighted) {
        await tick();
        const current = community.get(u);
        const degree = degrees.get(u);
        const weights = new Map();
        for (const [v, weight] of ns) {
          if (u === v) continue;
          const c = community.get(v);
          weights.set(c, (weights.get(c) ?? 0) + weight);
        }
        totals.set(current, totals.get(current) - degree);
        const score = c => (weights.get(c) ?? 0) - degree * (totals.get(c) ?? 0) / total;
        let best = current;
        let bestScore = score(current);
        for (const c of weights.keys()) {
          const candidate = score(c);
          if (candidate > bestScore + 1e-10) {
            best = c;
            bestScore = candidate;
          }
        }
        community.set(u, best);
        totals.set(best, (totals.get(best) ?? 0) + degree);
        changed ||= best !== current;
      }
      if (!changed) break;
    }
    const nextMembers = new Map();
    const nextGraph = new Map();
    for (const [u, ns] of weighted) {
      await tick();
      const c = community.get(u);
      if (!nextMembers.has(c)) {
        nextMembers.set(c, new Set());
        nextGraph.set(c, new Map());
      }
      for (const v of members.get(u)) nextMembers.get(c).add(v);
      for (const [v, weight] of ns) {
        const d = community.get(v);
        nextGraph.get(c).set(d, (nextGraph.get(c).get(d) ?? 0) + weight);
      }
    }
    if (nextGraph.size === weighted.size) {
      const groups = [...nextMembers.values()];
      // 小さなペアや、外への接続の方が強い集合は独立エリアとしない。
      // K3,3などをモジュラリティだけで断片化することを防ぐ。
      for (const group of groups) {
        let inside = 0;
        let outside = 0;
        for (const u of group) {
          for (const v of graph.get(u)) {
            if (group.has(v)) inside += edgeWeight(u, v);
            else outside += edgeWeight(u, v);
          }
        }
        if (group.size < 3 || inside / 2 <= outside * boundaryRatio) return [new Set(graph.keys())];
      }
      return groups;
    }
    weighted = nextGraph;
    members = nextMembers;
  }
}

// Preserve well-supported note communities independently of tag hubs. Shared
// tags can belong to several areas; their cross-area relation stays in the
// untouched adjacency for buildAreaHierarchy/partial graphs.
async function splitTagIndependentAreas(graph, original, witnesses, tick) {
  if (![...graph.keys()].some(node => node.startsWith('#'))) return null;
  const notes = new Map();
  let work = 0;
  for (const [node, neighbors] of graph) {
    if (node.startsWith('#')) continue;
    const direct = new Set();
    for (const other of neighbors) {
      if (++work % 200 === 0) await tick();
      if (other.startsWith('#')) continue;
      const route = witnesses.get(JSON.stringify([node, other].sort()));
      if (original.get(node)?.has(other) || route && [...route].every(id => !id.startsWith('#'))) direct.add(other);
    }
    notes.set(node, direct);
  }
  if (notes.size < 6) return null;
  // Each note's internal degree must outweigh its external degree in aggregate.
  // Count both endpoints of internal links, as for modularity above.
  const groups = await splitStructuralAreas(notes, tick, null, null, 0.5);
  if (groups.length < 2 || groups.some(group => group.size < 3)) return null;
  const assignedTags = new Set();
  for (const group of groups) {
    const tags = new Set();
    for (const note of group) for (const other of graph.get(note) ?? []) {
      if (++work % 200 === 0) await tick();
      if (other.startsWith('#')) tags.add(other);
    }
    for (const tag of tags) { group.add(tag); assignedTags.add(tag); }
  }
  // Do not silently discard tag-only structures that this decomposition cannot cover.
  if ([...graph.keys()].some(node => node.startsWith('#') && !assignedTags.has(node))) return null;
  return groups;
}

// 平面性未確定の成分を、近傍密度の変化から分割してホットスポットを返す。
//
// 【入力】単純無向グラフの隣接表と、その2連結成分に属する頂点ID一覧。
// 【処理】各頂点と1近傍の誘導部分グラフ密度を計算し、隣接頂点間の密度差の成分内平均を超える辺を除いて連結領域に分割する。
// 【出力】{ areas, boundaryEdges, meanChange }。areasは閾値以上の領域、boundaryEdgesは除いた境界候補辺、
//         meanChangeは密度差の平均。入力グラフは変更しない。
async function findDensityHotspots(graph, nodes, threshold, tick) {
  const localDensity = new Map();
  let work = 0;
  for (const u of nodes) {
    await tick();
    const neighborhood = new Set([u, ...(graph.get(u) ?? [])]);
    const count = neighborhood.size;
    const possibleEdges = (count * (count - 1)) / 2;
    if (!possibleEdges) {
      localDensity.set(u, 0);
      continue;
    }
    let edges = 0;
    for (const a of neighborhood) {
      if (++work % 200 === 0) await tick();
      for (const b of graph.get(a) ?? []) {
        if (a < b && neighborhood.has(b)) edges++;
      }
    }
    localDensity.set(u, edges / possibleEdges);
  }

  const edgeChanges = [];
  let totalChange = 0;
  let edgeCount = 0;
  for (const u of nodes) {
    for (const v of graph.get(u) ?? []) {
      if (++work % 200 === 0) await tick();
      if (u >= v) continue;
      const change = Math.abs(localDensity.get(u) - localDensity.get(v));
      edgeChanges.push({ a: u, b: v, change });
      totalChange += change;
      edgeCount++;
    }
  }
  const meanChange = edgeCount ? totalChange / edgeCount : 0;
  const boundaryEdges = edgeChanges.filter(
    (edge) => meanChange > 0 && edge.change > meanChange,
  );
  const boundaryKeys = new Set(
    boundaryEdges.map((edge) => `${edge.a}\0${edge.b}`),
  );

  const remaining = new Set(nodes);
  const areas = [];
  while (remaining.size) {
    await tick();
    const first = remaining.values().next().value;
    remaining.delete(first);
    const area = new Set([first]);
    const queue = [first];
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head];
      for (const v of graph.get(u) ?? []) {
        if (++work % 200 === 0) await tick();
        const key = u < v ? `${u}\0${v}` : `${v}\0${u}`;
        if (!remaining.has(v) || boundaryKeys.has(key)) continue;
        remaining.delete(v);
        area.add(v);
        queue.push(v);
      }
    }

    const links = [];
    for (const u of area) {
      for (const v of graph.get(u) ?? []) {
        if (u < v && area.has(v)) {
          const key = `${u}\0${v}`;
          if (!boundaryKeys.has(key)) links.push([u, v]);
        }
      }
    }
    const possibleEdges = (area.size * (area.size - 1)) / 2;
    const density = possibleEdges ? links.length / possibleEdges : 0;
    if (area.size < HOTSPOT_MIN_NODES || density < threshold) continue;
    areas.push({
      nodes: [...area],
      links,
      density,
      meanLocalDensity:
        area.size > 0
          ? [...area].reduce((sum, u) => sum + localDensity.get(u), 0) /
            area.size
          : 0,
      boundaryLinks: boundaryEdges.map(({ a, b }) => [a, b]),
    });
  }
  return { areas, boundaryEdges, meanChange };
}

// Hotspots and the remainder partition the original vertices of an undetermined
// finding. Boundary paths omitted by density splitting belong to the remainder.
async function undeterminedRemainder(adjacency, finding, hotspots, tick) {
  const covered = new Set(hotspots.flatMap(area => area.originalNodes ?? area.nodes));
  const remaining = new Set((finding.originalNodes ?? finding.nodes).filter(node => !covered.has(node)));
  const areas = [];
  let work = 0;
  while (remaining.size) {
    await tick();
    const nodes = [remaining.values().next().value];
    remaining.delete(nodes[0]);
    for (let i = 0; i < nodes.length; i++) {
      for (const neighbor of adjacency.get(nodes[i]) ?? []) {
        if (++work % 200 === 0) await tick();
        if (remaining.delete(neighbor)) nodes.push(neighbor);
      }
    }
    nodes.sort();
    const members = new Set(nodes);
    const links = [];
    for (const node of nodes) for (const neighbor of adjacency.get(node) ?? []) {
      if (++work % 200 === 0) await tick();
      if (node < neighbor && members.has(neighbor)) links.push([node, neighbor]);
    }
    const n = nodes.length;
    areas.push({ nodes, originalNodes: [...nodes], links, edges: links.length,
      density: n >= 3 ? links.length / (3 * n - 6) : 0,
      linkDensity: n >= 2 ? 2 * links.length / (n * (n - 1)) : 0,
      sourceSuspectNodes: [...finding.nodes].sort() });
  }
  return areas;
}

// グラフを平面性の観点で分析し、平面性と密度によるエリア候補を返す。
//
// 【入力】
//   adj         : buildAdjacency の戻り値（Map<頂点ID, Set<頂点ID>>）。この関数は adj を書き換えない
//                 （内部で複製してから縮約する）。
//   tick        : async () => void。処理の合間に呼ばれ、UI に制御を返す。実行中に新しい分析が始まったときは
//                 例外（main.js の ABORTED）を投げて、この処理全体を中断させる（main.js の makeTicker）。
//   maxFindings : K5・K3,3 を、それぞれ最大何件まで探すか（main.js の CONFIG.maxFindings）。
// 【出力】 次の形のオブジェクト。
//   k5, k33   : 見つかった K5（頂点5つの配列）・K3,3（{ X, Y }）の一覧。
//   bad       : K5/K3,3 に含まれたノートのパスの集合（タグ頂点は含めない）。
//               現時点では、この値を読んでいる箇所は他に無い（k5 / k33 / definite などが画面に使われている）。
//   definite  : 非平面と確定した領域。 suspect: 次数条件を超え、平面性を確定できない領域。
//   safe      : 次数の十分条件から平面と判定した領域。
//   hotspots  : suspect領域を近傍密度の差で分割し、densityThreshold以上かつ3頂点以上になったエリア。
//   boundaryEdges / meanDensityChange: suspect領域内で平均変化度を超えた境界候補辺と、辺密度変化の平均。
//   truncated : 上限（maxFindings）で検出を打ち切ったか。
//   definite / suspect / safe の各要素（内部リンクの集中度で分割後の2連結成分）:
//     { nodes: 頂点IDの配列, edges: 辺の数, links: [[u, v], ...]（u < v の辺の一覧）,
//       density: 平面グラフの辺数上限 3V−6 に対する割合, linkDensity: 全頂点間の可能な辺に対する割合,
//       degree4 / degree3: 次数が4以上／3以上の頂点の数,
//       edgeBoundExceeded: 辺数が 3V−6 を超えたか, exactPatternFound: K5/K3,3 が見つかったか }
//   【重要】 nodes と links は「縮約後のグラフ」のものである。縮約では、次数0・1の頂点を取り除き、
//   次数2の頂点は両隣をつなぐ1本の辺に置き換える。そのため links には、元の adj には存在しない辺
//   （取り除かれた頂点を飛び越える辺）が含まれる。graph-view.js はそれを「縮約された辺」として区別して描く。
//   戻り値は maintenance-workflow.js が maint.result.planar に保持し、詳細窓の「平面性」欄で表示する。保存はしない。
//   各領域の originalNodes は、その領域内の縮約辺が表す元の頂点も含む。
//   次数0/1として取り除かれた枝は領域に含めず、境界を越えて所属を推測しない。
async function findNonPlanar(adj, tick, maxFindings = 200, { tagWeights = null } = {}) {
  const { graph: reduced, witnesses } = await reduceGraph(adj, tick);
  const edgeWeights = new Map();
  if (tagWeights) {
    let work = 0;
    for (const [key, nodes] of witnesses) {
      let weight = 1;
      for (const node of nodes) {
        if (++work % 200 === 0) await tick();
        weight = Math.min(weight, tagWeights.get(node) ?? 1);
      }
      edgeWeights.set(key, weight);
    }
  }
  const expand = item => {
    const originals = new Set(item.nodes);
    for (const [a, b] of item.links) {
      for (const node of witnesses.get(JSON.stringify([a, b].sort())) ?? []) originals.add(node);
    }
    item.originalNodes = [...originals].sort();
    return item;
  };
  const blocks = await findBiconnectedComponents(reduced, tick);
  const areas = [];
  for (const block of blocks) {
    const graph = inducedAdjacency(reduced, block);
    const groups = await splitTagIndependentAreas(graph, adj, witnesses, tick)
      ?? await splitStructuralAreas(graph, tick, tagWeights, edgeWeights);
    // 分割でできた橋や関節点も再評価し、独立した領域として扱う。
    for (const group of groups) {
      const subgraph = inducedAdjacency(graph, group);
      areas.push(...await findBiconnectedComponents(subgraph, tick));
    }
  }
  const result = {
    k5: [],
    k33: [],
    bad: new Set(),
    definite: [],
    suspect: [],
    safe: [],
    hotspots: [],
    remainder: [],
    boundaryEdges: [],
    meanDensityChange: 0,
    truncated: false,
  };

  for (const nodeSet of areas) {
    await tick();
    const graph = inducedAdjacency(reduced, nodeSet);
    const nodes = [...graph.keys()];
    const n = nodes.length;
    const edges = [...graph.values()].reduce((sum, ns) => sum + ns.size, 0) / 2;
    const density = n >= 3 ? edges / (3 * n - 6) : 0;
    // 通常の辺密度 E / 全可能辺数。平面性とは別の構造指標。
    const linkDensity = n >= 2 ? (2 * edges) / (n * (n - 1)) : 0;
    const degree4 = nodes.filter((u) => graph.get(u).size >= 4).length;
    const degree3 = nodes.filter((u) => graph.get(u).size >= 3).length;
    const order = nodes;
    const idx = new Map(order.map((id, i) => [id, i]));
    const leftK5 = maxFindings - result.k5.length;
    const leftK33 = maxFindings - result.k33.length;
    const k5 =
      leftK5 > 0
        ? await findK5(graph, order, idx, leftK5, tick)
        : { found: [], truncated: true };
    const k33 =
      leftK33 > 0
        ? await findK33(graph, order, leftK33, tick)
        : { found: [], truncated: true };
    result.k5.push(...k5.found);
    result.k33.push(...k33.found);
    result.truncated ||= k5.truncated || k33.truncated;

    const badNodes = new Set();
    for (const clique of k5.found) clique.forEach((u) => badNodes.add(u));
    for (const { X, Y } of k33.found)
      [...X, ...Y].forEach((u) => badNodes.add(u));
    for (const u of badNodes) if (!u.startsWith("#")) result.bad.add(u);

    const edgeBoundExceeded = n >= 3 && edges > 3 * n - 6;
    const exactPatternFound = k5.found.length > 0 || k33.found.length > 0;
    const links = [];
    for (const u of nodes) {
      for (const v of graph.get(u) ?? []) {
        if (u < v) links.push([u, v]);
      }
    }
    const item = expand({
      nodes,
      edges,
      links,
      density,
      linkDensity,
      degree4,
      degree3,
      edgeBoundExceeded,
      exactPatternFound,
    });
    if (edgeBoundExceeded || exactPatternFound) {
      result.definite.push(item);
    } else if (degree4 < 5 && degree3 < 6) {
      // K5の細分には次数4以上が5頂点、K3,3の細分には次数3以上が6頂点必要。
      // 両方の必要数に届かなければKuratowskiの定理により平面と判定できる。
      result.safe.push(item);
    } else {
      result.suspect.push(item);
      const hotspotResult = await findDensityHotspots(
        graph,
        nodes,
        HOTSPOT_DENSITY_THRESHOLD,
        tick,
      );
      const hotspots = hotspotResult.areas.map(expand);
      result.hotspots.push(...hotspots);
      result.remainder.push(...await undeterminedRemainder(adj, item, hotspots, tick));
      result.boundaryEdges.push(...hotspotResult.boundaryEdges);
      result.meanDensityChange +=
        hotspotResult.meanChange * (graph.size > 1 ? edges : 0);
    }
  }

  // 平面性未確定エリアは平面グラフの辺数上限に対する密度が高い順に並べる。
  result.suspect.sort(
    (a, b) => b.density - a.density || b.nodes.length - a.nodes.length,
  );
  result.definite.sort(
    (a, b) => b.density - a.density || b.nodes.length - a.nodes.length,
  );
  const suspectEdges = result.suspect.reduce((sum, item) => sum + item.edges, 0);
  result.meanDensityChange = suspectEdges
    ? result.meanDensityChange / suspectEdges
    : 0;
  result.hotspots.sort(
    (a, b) => b.density - a.density || b.nodes.length - a.nodes.length,
  );
  return result;
}


module.exports = {
  buildAdjacency,
  findNonPlanar,
  findBiconnectedComponents,
  splitStructuralAreas,
  undeterminedRemainder,
  getRemainderKind,
  REMAINDER_LABELS,
  HOTSPOT_DENSITY_THRESHOLD,
};
