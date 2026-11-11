const { writeFileSync } = require('node:fs');
const { performance } = require('node:perf_hooks');
const { measureGraphDistances } = require('../src/graph-distances');
const { readNoteDistances } = require('./inspect-distance-growth.cjs');
const { makeProfile, makeEdges, voteOnEdges, findComponents, edgeVoteRate } = require('../src/distance-area-growth');

function findStableAreas(nodes, edges) {
  const parents = Int32Array.from(nodes, (_, i) => i);
  const sizes = new Int32Array(nodes.length).fill(1);
  const regions = nodes.map((node, i) => ({ i, low: 0, notes: Number(!node.startsWith('#')) }));
  const stable = [];
  const ordered = edges.map(edge => ({ ...edge, rate: edgeVoteRate(edge) })).sort((a, b) => a.rate - b.rate);

  function root(node) {
    while (parents[node] !== node) {
      parents[node] = parents[parents[node]];
      node = parents[node];
    }
    return node;
  }

  // 境界票率が低い辺から一度ずつ戻す。分割が変わるのは別の成分を結んだときだけ。
  // 成分を作った票率と外へつながった票率の差が、同じ領域が続く幅になる。
  for (const { a, b, rate } of ordered) {
    let x = root(a);
    let y = root(b);
    if (x === y) continue;
    if (sizes[x] < sizes[y]) [x, y] = [y, x];
    const left = regions[x];
    const right = regions[y];
    for (const region of [left, right]) {
      // 同率の辺を続けて戻す途中だけ現れる成分には有効な区間がない。
      if (region.notes >= 3 && region.low < rate) stable.push({ region, high: rate, width: rate - region.low });
    }
    parents[y] = x;
    sizes[x] += sizes[y];
    regions[x] = { left, right, low: rate, notes: left.notes + right.notes };
  }
  return stable.sort((a, b) => b.width - a.width || b.region.notes - a.region.notes);
}

function listRegionNodes(region, nodes) {
  const result = [];
  const stack = [region];
  while (stack.length) {
    const branch = stack.pop();
    if (branch.i !== undefined) result.push(nodes[branch.i]);
    else stack.push(branch.left, branch.right);
  }
  return result.sort((a, b) => a.localeCompare(b, 'ja'));
}

async function inspect(input) {
  const start = performance.now();
  const graph = new Map();
  const profiles = [...readNoteDistances(input, graph)].map(([seed, distances]) => makeProfile(seed, distances));
  const table = await measureGraphDistances(graph);
  const { nodes } = table;
  const { edges, links } = makeEdges(graph, nodes);
  const candidates = await voteOnEdges(profiles, table, edges);
  const voted = performance.now();
  const original = findComponents(links, new Set());
  const reports = [];
  const thresholds = [0.5, 0.25, 0.2, 0.15, 0.1, 0.075, 0.05, 0.025, 0];
  const maxVoteRatio = edges.reduce((max, edge) => Math.max(max, edgeVoteRate(edge)), 0);
  for (const threshold of thresholds) {
    const cut = new Set(edges.filter(edge => edgeVoteRate(edge) > threshold));
    const { groups, componentOf } = findComponents(links, cut);
    const boundaries = [...cut].filter(edge => componentOf[edge.a] !== componentOf[edge.b]);
    const members = groups.map(group => group.map(index => nodes[index]));
    const noteCounts = members.map(group => group.filter(node => !node.startsWith('#')).length);
    reports.push({ threshold, cut, boundaries, members, noteCounts });
  }
  const finish = performance.now();
  const stable = findStableAreas(nodes, edges);
  const stabilityMs = performance.now() - finish;
  const percent = ratio => `${(100 * ratio).toFixed(1)}%`;
  const precisePercent = ratio => `${(100 * ratio).toFixed(3)}%`;
  const lines = [
    '近傍成長から閉じた領域を探す実験',
    `元のグラフ: ${nodes.length} 頂点、${edges.length} 接続、${original.groups.length} 連結成分。近傍成長の候補 ${candidates} 組から集計。`,
    '停止候補の左右それぞれに片側だけ含まれる頂点を調べる。元の辺の両端が別々なら境界票、同じ側なら内部票。',
    '境界票 ÷ (境界票 + 内部票) が指定値を超えた辺を外し、元のグラフを再探索する。票なしの辺は残す。',
    '以下の比率は感度を比較するための試験値。領域の大きさはノート3件以上を別に集計する。',
    `観測した境界票率の最大: ${percent(maxVoteRatio)}。`,
    `距離ログの読み込み・距離計算・投票: ${(voted - start).toFixed(1)} ms。${thresholds.length}条件の再探索: ${(finish - voted).toFixed(1)} ms（各1回）。`,
    `票率を全段階で動かして安定区間を求める追加時間: ${stabilityMs.toFixed(2)} ms（1回、表示用の整形は別）。`,
    '',
    '【条件別の結果】',
  ];
  for (const report of reports) {
    const sizes = report.noteCounts.filter(count => count >= 3).sort((a, b) => b - a);
    lines.push(`境界票率 > ${percent(report.threshold)} | 外した辺 ${report.cut.size} 本 | 実際の境界 ${report.boundaries.length} 本 | 連結成分 ${report.members.length} 個 | 3ノート以上: ${sizes.join(' / ') || 'なし'}`);
  }
  lines.push('\n【同じ領域が残る票率の区間・幅が大きい順】',
    '区間の下端以上・上端未満では、ノートとタグの所属が同じ。区間が広いほど、しきい値を少し変えても構成が変わりにくい。');
  for (const { region, high, width } of stable) {
    const names = listRegionNodes(region, nodes);
    lines.push(`領域 ${region.notes}ノート・${names.length - region.notes}タグ | ${precisePercent(region.low)} 以上 ${precisePercent(high)} 未満 | 幅 ${(width * 100).toFixed(3)} ポイント`);
    for (const node of names) lines.push(`  ${node}`);
  }
  for (const { threshold, members, noteCounts, boundaries } of reports) {
    if (members.length === original.groups.length) continue;
    lines.push(`\n【境界票率 > ${percent(threshold)} の内訳】`);
    for (const [i, group] of members.entries()) {
      if (noteCounts[i] < 3) continue;
      lines.push(`領域 ${i + 1} | ノート ${noteCounts[i]} 件・タグ ${group.length - noteCounts[i]} 種`);
      for (const node of group.sort((a, b) => a.localeCompare(b, 'ja'))) lines.push(`  ${node}`);
    }
    for (const { a, b, separate, together } of boundaries) {
      lines.push(`境界 ${nodes[a]} ↔ ${nodes[b]} | 境界票 ${separate}、内部票 ${together}`);
    }
  }
  return lines.join('\n') + '\n';
}

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/inspect-distance-closure.cjs PAIRS.txt REPORT.txt');
  process.exitCode = 1;
} else {
  inspect(input).then(report => writeFileSync(output, report, 'utf8'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
