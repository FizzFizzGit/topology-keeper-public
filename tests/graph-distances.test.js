const { test } = require('node:test');
const assert = require('node:assert/strict');
const { measureGraphDistances, updateGraphDistances } = require('../src/graph/graph-distances');
const { analyzeDistanceAreas } = require('../src/graph/distance-area-analysis');
const { areaSelection } = require('../src/graph/area-model');
const { diagnoseAreaPlanarity } = require('../src/graph/graph-analysis');
const { combinedAreaCategory, combinedAreaColors, combinedAreaMeanDegree } = require('../src/analysis/combined-area-style');

test('incremental hops agree with full calculation after changes to edges and vertices', async () => {
  const tick = async () => {};
  const initial = new Map([
    ['a', new Set(['b', 'c'])], ['b', new Set(['d'])], ['c', new Set(['d'])],
    ['d', new Set(['e'])], ['e', new Set()], ['isolated', new Set()],
  ]);
  let previous = initial;
  let table = await measureGraphDistances(initial);
  assert.equal(await updateGraphDistances(initial, previous, table, tick), table);
  for (const change of [
    graph => graph.get('b').delete('d'), // 同じ長さの代替経路が残る。
    graph => graph.get('c').delete('d'), // 始点の一部から到達できなくなる。
    graph => graph.get('a').add('e'), // 近道を追加する。
    graph => { graph.delete('d'); graph.set('new', new Set(['a'])); graph.get('e').add('new'); },
    graph => { graph.get('a').delete('e'); graph.get('c').add('new'); },
  ]) {
    const graph = new Map([...previous].reverse().map(([node, neighbors]) => [node, new Set(neighbors)]));
    change(graph);
    const updated = await updateGraphDistances(graph, previous, table, tick);
    const full = await measureGraphDistances(graph);
    assert.deepEqual(updated.nodes, full.nodes);
    for (const from of full.nodes) for (const to of full.nodes)
      assert.equal(updated.distance(from, to), full.distance(from, to), `${from} → ${to}`);
    previous = graph;
    table = updated;
  }
});

test('combined areas retain shared tag cycles for both diagnosis and the displayed graph', async () => {
  // 3ノートに3タグを付けるとK3,3になる。見出しタグ1個だけなら星型に化ける。
  const notes = ['a.md', 'b.md', 'c.md'];
  const tags = ['#one', '#two', '#three'];
  const graph = new Map([
    ...notes.map(note => [note, new Set(tags)]),
    ...tags.map(tag => [tag, new Set(notes)]),
    ['outside.md', new Set()],
  ]);
  const { model } = await analyzeDistanceAreas(graph, async () => {});
  const combined = model.combinedAreas.filter(area => area.scope === 'within-parent');
  assert.equal(combined.length, 3);
  for (const area of combined) {
    const selection = areaSelection(model, area.id);
    assert.equal(area.classification, 'nonplanar');
    assert.deepEqual(new Set(selection.nodes), new Set([...notes, ...tags]));
    assert.equal(selection.links.length, 9);
    const displayed = new Map(selection.nodes.map(node => [node, new Set()]));
    for (const [a, b] of selection.links) {
      assert.equal(graph.get(a).has(b), true);
      displayed.get(a).add(b);
      displayed.get(b).add(a);
    }
    assert.deepEqual(await diagnoseAreaPlanarity(displayed, async () => {}),
      { classification: area.classification, linkDensity: area.linkDensity });
    const category = combinedAreaCategory(area.classification, combinedAreaMeanDegree(selection));
    assert.equal(category, 'sparseNonplanar');
    assert.equal(combinedAreaColors({ undetermined: '#999999' })[category], '#999999');
  }
});

test('weighted shortest distances can take several tag and note hops to beat a direct edge', async () => {
  const graph = new Map([
    ['a.md', new Set(['b.md', '#topic'])],
    ['b.md', new Set()],
    ['#topic', new Set(['c.md'])],
    ['c.md', new Set(['b.md'])],
  ]);
  const direct = await measureGraphDistances(graph);
  assert.equal(direct.distance('a.md', 'b.md'), 1);
  const weighted = await measureGraphDistances(graph, {
    edgeCost: (from, to) => from === 'a.md' && to === 'b.md' ? 9 : 1.5,
  });
  assert.equal(weighted.distance('a.md', 'b.md'), 4.5);
  assert.equal(weighted.distance('b.md', 'a.md'), Infinity);
  assert.equal(weighted.distance('a.md', 'a.md'), 0);
  assert.equal(weighted.distance('a.md', 'unknown.md'), undefined);
});

test('the distance calculation can be cancelled after it starts', async () => {
  const graph = new Map(Array.from({ length: 64 }, (_, i) => [i, new Set([(i + 1) % 64])]));
  const cancelled = new Error('cancelled');
  let calls = 0;
  await assert.rejects(measureGraphDistances(graph, {
    tick: async () => { if (++calls === 2) throw cancelled; },
  }), error => error === cancelled);
});
