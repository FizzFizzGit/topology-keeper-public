const { readFileSync, writeFileSync } = require('node:fs');
const { performance } = require('node:perf_hooks');
const { measureGraphDistances } = require('../src/graph-distances');
const { makeProfile, compareGrowth } = require('../src/distance-area-growth');

// 距離ログのペア一覧を読む。タグは最短経路には含まれているが、成長の人数には数えない。
function readNoteDistances(filename, graph) {
  const lines = readFileSync(filename, 'utf8').split(/\r?\n/);
  const header = lines.indexOf('hops\tfrom\tto');
  if (header < 0) throw new Error('Pair list header not found');
  const distances = new Map();
  for (const line of lines.slice(header + 1)) {
    if (!line) continue;
    const [hops, fromText, toText] = line.split('\t');
    const from = JSON.parse(fromText);
    const to = JSON.parse(toText);
    // 距離1のペアは元のグラフの直接辺。計測時だけ、タグも含めて復元する。
    if (graph) {
      if (!graph.has(from)) graph.set(from, new Set());
      if (!graph.has(to)) graph.set(to, new Set());
      if (hops === '1') {
        graph.get(from).add(to);
        graph.get(to).add(from);
      }
    }
    if (from.startsWith('#') || to.startsWith('#')) continue;
    for (const [node, other] of [[from, to], [to, from]]) {
      if (!distances.has(node)) distances.set(node, new Map([[node, 0]]));
      if (hops !== 'Infinity') distances.get(node).set(other, Number(hops));
    }
  }
  return distances;
}

function formatExperiment(profiles, focus) {
  const lines = [
    'ノートの近傍成長実験',
    `始点 ${profiles.length} 件。既存の全体距離ログを使用。タグは経路に使い、所属と重複はノートのみ数える。`,
    '芯は始点を含めて3ノート以上が初めて集まる距離。各始点は最短距離にある、芯が重ならない別の始点と比較。',
    '距離を同時に一段ずつ伸ばし、共有ノートの割合が最も増えた段の直前を境界候補とする。分母は両側を合わせたノート数（重複は1件）。',
    '相手の始点に到達する段は記録のみ。芯・境界とも試験上の候補で、同じ候補が複数の始点から出ることがある。',
  ];
  const summaries = [];
  for (const profile of profiles) {
    const rival = profiles.filter(other => other !== profile && other.coreRadius !== null
        && profile.distances.has(other.seed) && [...profile.core].every(node => !other.core.has(node)))
      .sort((a, b) => profile.distances.get(a.seed) - profile.distances.get(b.seed)
        || a.seed.localeCompare(b.seed, 'ja'))[0];
    const comparison = profile.coreRadius !== null && rival ? compareGrowth(profile, rival) : null;
    summaries.push({ profile, rival, comparison });
  }
  const count = summaries.filter(({ comparison }) => comparison?.peak).length;
  lines.push(`境界候補が出た始点 ${count} / ${profiles.length} 件。`);

  function describe(left, right, comparison) {
    lines.push(`\nA: ${left.seed}\nB: ${right.seed}`);
    for (const [label, profile] of [['A', left], ['B', right]]) {
      lines.push(`${label} の芯（距離 ${profile.coreRadius ?? '未確定'}）: ${[...profile.core].join(' ・ ')}`);
    }
    if (!comparison) {
      lines.push('比較できる芯がありません。');
      return;
    }
    if (comparison.sharedCore) {
      lines.push(`最初から共有: ${comparison.sharedCore.join(' ・ ')}`);
      return;
    }
    for (const step of comparison.steps) {
      lines.push(`距離 A=${step.radiusA}, B=${step.radiusB} | 合計 A=${step.sizeA}, B=${step.sizeB} | 新規 A=${step.addedA.length}, B=${step.addedB.length} | 共有 ${step.shared.length}件 (+${step.newShared}) / ${(100 * step.ratio).toFixed(1)}%`);
      lines.push(`  A に追加: ${step.addedA.join(' ・ ') || 'なし'}`);
      lines.push(`  B に追加: ${step.addedB.join(' ・ ') || 'なし'}`);
    }
    const peak = comparison.peak;
    if (!peak) {
      lines.push('相手の始点に到達する前の重複増加なし。');
      return;
    }
    lines.push(`候補: A は距離 ${peak.radiusA - 1}（${peak.sizeA - peak.addedA.length}件）、B は距離 ${peak.radiusB - 1}（${peak.sizeB - peak.addedB.length}件）で止める（次の段で重複率 +${(100 * peak.gain).toFixed(1)} ポイント）。`);
    lines.push(`  次の段の共有ノート: ${peak.shared.join(' ・ ')}`);
  }

  if (focus.length === 2) {
    const [left, right] = focus.map(seed => profiles.find(profile => profile.seed === seed));
    if (!left || !right) throw new Error('Focus seed not found');
    lines.push('\n【指定した二つの始点】');
    describe(left, right, compareGrowth(left, right));
  }
  lines.push('\n【各始点の距離別リストと、最も近い別の芯】');
  for (const { profile, rival, comparison } of summaries) {
    lines.push(`\n${profile.seed}`);
    for (const [radius, added] of profile.ordered) lines.push(`  ${radius}: ${added.join(' ・ ')}`);
    const peak = comparison?.peak;
    if (peak) lines.push(`  比較先: ${rival.seed} | 止める候補 A=${peak.radiusA - 1}, B=${peak.radiusB - 1} | 次の段で共有 ${peak.shared.length}件 (+${peak.newShared})`);
    else lines.push(`  ${rival ? `比較先: ${rival.seed} | 境界候補なし` : '比較できる別の芯なし'}`);
  }
  return lines.join('\n') + '\n';
}

function formatStability(profiles, focus) {
  const bySeed = new Map(profiles.map(profile => [profile.seed, profile]));
  const [left, right] = focus.map(seed => bySeed.get(seed));
  const baseline = left && right && compareGrowth(left, right)?.peak;
  if (!baseline) throw new Error('The reference pair must produce a boundary candidate');

  const membersAt = (profile, radius) => new Set(profile.ordered
    .filter(([hops]) => hops <= radius).flatMap(([, nodes]) => nodes));
  const original = [membersAt(left, baseline.radiusA - 1), membersAt(right, baseline.radiusB - 1)];
  const percent = value => `${(value * 100).toFixed(1)}%`;
  const counts = [new Map(), new Map()];
  const scores = [[], []];
  const rows = [];
  let found = 0;
  let sharedCore = 0;
  let exact = 0;
  let disjoint = 0;
  // 参照ペアの芯に含まれたノートだけを、左右それぞれ始点として総当たりする。
  // 止まる距離が同じでも所属が異なり得るので、ノート集合そのものを比較する。
  for (const seedA of left.core) for (const seedB of right.core) {
    const a = bySeed.get(seedA);
    const b = bySeed.get(seedB);
    const comparison = compareGrowth(a, b);
    const peak = comparison?.peak;
    if (!peak) {
      if (comparison?.sharedCore) sharedCore++;
      rows.push(`[${comparison?.sharedCore ? '芯が重複' : '境界候補なし'}] ${seedA} ↔ ${seedB}`);
      continue;
    }
    found++;
    const radii = [peak.radiusA - 1, peak.radiusB - 1];
    const members = [membersAt(a, radii[0]), membersAt(b, radii[1])];
    if ([...members[0]].every(node => !members[1].has(node))) disjoint++;
    const similarity = members.map((set, side) => {
      let intersection = 0;
      for (const node of set) {
        if (original[side].has(node)) intersection++;
        counts[side].set(node, (counts[side].get(node) ?? 0) + 1);
      }
      const score = intersection / (set.size + original[side].size - intersection);
      scores[side].push(score);
      return score;
    });
    if (similarity.every(score => score === 1)) exact++;
    rows.push(`[A=${radii[0]}・${members[0].size}件・一致度 ${percent(similarity[0])} | B=${radii[1]}・${members[1].size}件・一致度 ${percent(similarity[1])}] ${seedA} ↔ ${seedB}`);
  }
  const lines = [
    '始点を入れ替えた近傍成長実験',
    '全体グラフの既存距離ログを使用。近傍成長と停止のルールは前回と同じ。',
    `参照 A: ${left.seed} | 距離 ${baseline.radiusA - 1}・${original[0].size}件`,
    `参照 B: ${right.seed} | 距離 ${baseline.radiusB - 1}・${original[1].size}件`,
    `始点の組: A側の芯 ${left.core.size}件 × B側の芯 ${right.core.size}件 = ${rows.length}組（参照ペアを含む）。`,
    `境界候補あり ${found}組（うち停止時に共有なし ${disjoint}組）、芯が最初から重複 ${sharedCore}組、その他の候補なし ${rows.length - found - sharedCore}組。`,
    `両側の所属ノートが参照と完全一致: ${exact} / ${found}組。`,
    '一致度は、参照と今回の両方に入ったノート数 ÷ いずれかに入ったノート数。',
  ];
  for (const [side, values] of scores.entries()) {
    const sorted = values.sort((a, b) => a - b);
    const median = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
    const label = side === 0 ? 'A' : 'B';
    lines.push(`${label} の一致度: 最小 ${percent(sorted[0])}・中央値 ${percent(median)}・最大 ${percent(sorted.at(-1))}。`);
  }
  for (const [side, membership] of counts.entries()) {
    lines.push(`\n【${side === 0 ? 'A' : 'B'}側への所属回数（境界候補が出た ${found} 組のうち）】`);
    for (const [node, count] of [...membership].sort(([a, x], [b, y]) => y - x || a.localeCompare(b, 'ja'))) {
      lines.push(`${count}/${found}  ${node}`);
    }
  }
  return [...lines, '\n【始点の組ごとの結果】', ...rows].join('\n') + '\n';
}

function compareAllPairs(profiles) {
  const rows = [];
  const counts = { candidate: 0, sharedCore: 0, noPeak: 0, unavailable: 0 };
  let rounds = 0;
  for (const [i, left] of profiles.entries()) {
    for (let j = i + 1; j < profiles.length; j++) {
      const right = profiles[j];
      const comparison = compareGrowth(left, right);
      const peak = comparison?.peak;
      const status = peak ? 'candidate' : comparison?.sharedCore ? 'sharedCore' : comparison ? 'noPeak' : 'unavailable';
      counts[status]++;
      rounds += comparison?.steps?.length ?? 0;
      rows.push({ left: left.seed, right: right.seed, status, peak });
    }
  }
  return { rows, counts, rounds };
}

async function benchmarkAllPairs(input) {
  const graph = new Map();
  const start = performance.now();
  const profiles = [...readNoteDistances(input, graph)].map(([seed, distances]) => makeProfile(seed, distances));
  const setupMs = performance.now() - start;
  const distanceTimes = [];
  const growthTimes = [];
  let result;
  for (let run = 0; run < 5; run++) {
    let started = performance.now();
    const table = await measureGraphDistances(graph);
    distanceTimes.push(performance.now() - started);
    if (run === 0) {
      for (const profile of profiles) for (const { seed } of profiles) {
        if (table.distance(profile.seed, seed) !== (profile.distances.get(seed) ?? Infinity)) {
          throw new Error('Rebuilt graph disagrees with the stored note distances');
        }
      }
    }
    started = performance.now();
    result = compareAllPairs(profiles);
    growthTimes.push(performance.now() - started);
  }
  const { rows, counts, rounds } = result;
  const ms = value => value.toFixed(1);
  const times = values => `中央値 ${ms([...values].sort((a, b) => a - b)[2])} ms（各回 ${values.map(ms).join(' / ')} ms）`;
  const lines = [
    '全ノートペアの近傍成長実験・時間計測',
    `全体グラフ ${graph.size} 頂点。始点ノート ${profiles.length} 件の全 ${rows.length} 組。タグは経路に使う。`,
    '各ペアの最短ホップ数を使う。迂回を含む個々の経路は列挙しない。',
    '前回と同じ停止ルールで、別々の芯から成長させ、重複率が最も増えた段の直前を候補とする。',
    `境界候補 ${counts.candidate} 組、初期の芯が重複 ${counts.sharedCore} 組、候補なし ${counts.noPeak} 組、比較不可 ${counts.unavailable} 組。`,
    `成長段の比較 ${rounds} 回。候補はペアごとの結果であり、エリアの総数ではない。`,
    '',
    `距離ログの読み込みと準備: ${ms(setupMs)} ms（1回）。`,
    `ワーシャル・フロイド法による全頂点間の距離計算: ${times(distanceTimes)}。`,
    `全ノートペアの境界候補判定: ${times(growthTimes)}。`,
    '全頂点間の距離計算は、ログの距離1の辺から復元したグラフで計測。ノート間の全距離が元のログと一致した。',
    '計算時間にレポートの整形・書き込みは含まない。',
    '',
    '【全ペアの判定】',
  ];
  const labels = { sharedCore: '芯が重複', noPeak: '候補なし', unavailable: '比較不可' };
  for (const { left, right, status, peak } of rows) {
    const detail = peak
      ? `A=${peak.radiusA - 1}・B=${peak.radiusB - 1} で停止候補 | 次の段で共有 +${peak.newShared}件`
      : labels[status];
    lines.push(`[${detail}] ${left} ↔ ${right}`);
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const args = process.argv.slice(2);
  const stability = args[0] === '--stability';
  const allPairs = args[0] === '--all-pairs';
  const [input, output, ...focus] = stability || allPairs ? args.slice(1) : args;
  const validFocus = stability ? focus.length === 2 : allPairs ? focus.length === 0 : [0, 2].includes(focus.length);
  if (!input || !output || !validFocus) {
    console.error('Usage: node scripts/inspect-distance-growth.cjs [--stability | --all-pairs] PAIRS.txt REPORT.txt [SEED_A SEED_B]');
    process.exitCode = 1;
  } else if (allPairs) {
    writeFileSync(output, await benchmarkAllPairs(input), 'utf8');
  } else {
    const profiles = [...readNoteDistances(input)].map(([seed, distances]) => makeProfile(seed, distances));
    writeFileSync(output, stability ? formatStability(profiles, focus) : formatExperiment(profiles, focus), 'utf8');
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { readNoteDistances };
