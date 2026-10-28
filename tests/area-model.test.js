const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAreaModel, buildAreaHierarchy } = require('../src/area-model');
const { findNonPlanar } = require('../src/graph-analysis');
const tick = async () => {};
function edge(graph, a, b) {
  for (const node of [a, b]) if (!graph.has(node)) graph.set(node, new Set());
  graph.get(a).add(b);
  graph.get(b).add(a);
}
function clique(graph, prefix) {
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) edge(graph, prefix + i, prefix + j);
}
function fixture() {
  const graph = new Map();
  for (const prefix of ['a', 'b', 'c']) clique(graph, prefix);
  return graph;
}

test('tags preserve original areas and retain separate evidence without transitive merging', async () => {
  const graph = fixture();
  const before = await buildAreaModel(graph, tick);
  for (const tag of ['#x', '#also-x']) for (const node of ['a0', 'b0']) edge(graph, tag, node);
  for (const node of ['b1', 'c0']) edge(graph, '#y', node);
  const snapshot = [...graph].map(([node, ns]) => [node, [...ns]]);
  const after = await buildAreaModel(graph, tick);
  assert.deepEqual(after.originalAreas, before.originalAreas);
  assert.equal(after.combinedAreas.length, 3);
  for (const combined of after.combinedAreas) {
    assert.equal(combined.areaIds.length, 2);
    assert.equal(combined.connections.length, 1);
    assert.equal(combined.members.length, 2);
    assert.ok(combined.members.every(member => member.nodes.length === 1));
    assert.equal(Object.hasOwn(combined, 'classification'), false);
  }
  assert.deepEqual([...graph].map(([node, ns]) => [node, [...ns]]), snapshot);
});

test('original membership retains degree-two notes and cycles lost by planarity reduction', async () => {
  const graph = new Map();
  for (const [a, b] of [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a']]) edge(graph, a, b);
  const model = await buildAreaModel(graph, tick);
  assert.equal(model.originalAreas.length, 1);
  assert.deepEqual(model.originalAreas[0].nodes, ['a', 'b', 'c', 'd']);
  assert.equal(model.originalAreas[0].links.length, 4);
});

test('tag-only notes and tags confined to one area do not form combined areas', async () => {
  const graph = new Map();
  clique(graph, 'a');
  for (const node of ['a0', 'a1', 'loose']) edge(graph, '#single', node);
  edge(graph, '#only', 'isolated');
  const model = await buildAreaModel(graph, tick);
  assert.equal(model.originalAreas.length, 1);
  assert.equal(model.combinedAreas.length, 0);
});

test('a tagged shared articulation note alone does not establish a combined area', async () => {
  const graph = new Map();
  for (const prefix of ['a', 'b']) {
    edge(graph, 'center', prefix + '0');
    edge(graph, prefix + '0', prefix + '1');
    edge(graph, prefix + '1', 'center');
  }
  edge(graph, '#shared', 'center');
  const model = await buildAreaModel(graph, tick);
  assert.equal(model.originalAreas.length, 2);
  assert.equal(model.combinedAreas.length, 0);
  edge(graph, '#shared', 'a0');
  assert.equal((await buildAreaModel(graph, tick)).combinedAreas.length, 1);
});

test('membership IDs survive adjacency reordering', async () => {
  const graph = fixture();
  edge(graph, '#x', 'a0');
  edge(graph, '#x', 'b0');
  const before = await buildAreaModel(graph, tick);
  const reversed = new Map([...graph].reverse().map(([node, ns]) => [node, new Set([...ns].reverse())]));
  assert.deepEqual(await buildAreaModel(reversed, tick), before);
});

test('area model observes cancellation and handles empty input', async () => {
  const cancelled = new Error('cancelled');
  await assert.rejects(buildAreaModel(fixture(), async () => { throw cancelled; }), error => error === cancelled);
  const model = await buildAreaModel(new Map(), tick);
  assert.deepEqual(model.originalAreas, []);
  assert.deepEqual(model.combinedAreas, []);
});

test('original-area classifications use direct note links and tag evidence preserves actual edges', async () => {
  const { areaSelection } = require('../src/area-model');
  const graph = fixture();
  for (const node of ['a0', 'b1']) edge(graph, '#cross', node);
  const model = await buildAreaModel(graph, tick);
  assert.ok(model.originalAreas.every(area => area.classification === 'planar'));
  const selection = areaSelection(model, model.combinedAreas[0].id);
  assert.equal(selection.groups.length, 2);
  assert.equal(selection.nodes.includes('c0'), false);
  for (const [a, b] of selection.links) assert.ok(graph.get(a).has(b));
  assert.equal(selection.links.some(([a, b]) => a === '#cross' && b === 'a1'), false);
  assert.equal(areaSelection(model, 'vanished'), null);
});

test('legacy findings retain notes inside contracted edges but exclude dangling branches', async () => {
  const graph = new Map();
  clique(graph, 'a');
  graph.get('a0').delete('a1'); graph.get('a1').delete('a0');
  edge(graph, 'a0', 'middle1'); edge(graph, 'middle1', 'middle2'); edge(graph, 'middle2', 'a1');
  edge(graph, 'a0', 'leaf');
  const planar = await findNonPlanar(graph, tick);
  assert.equal(planar.safe.length, 1);
  assert.equal(planar.safe[0].nodes.includes('middle1'), false);
  assert.ok(planar.safe[0].originalNodes.includes('middle1'));
  assert.ok(planar.safe[0].originalNodes.includes('middle2'));
  assert.equal(planar.safe[0].originalNodes.includes('leaf'), false);
  const model = await buildAreaHierarchy(graph, planar, tick);
  assert.equal(model.parents.length, 1);
  assert.ok(model.originalAreas[0].nodes.includes('middle1'));
  assert.equal(model.originalAreas[0].nodes.includes('leaf'), false);
});

test('hotspot owns its direct-link groups, including pairs and chains, and their tag connection', async () => {
  const graph = new Map();
  edge(graph, 'a0', 'a1'); edge(graph, 'a1', 'a2'); edge(graph, 'b0', 'b1');
  edge(graph, 'a2', 'outside');
  for (const node of ['a0', 'b0']) edge(graph, '#cross', node);
  const planar = { hotspots: [{ nodes: ['a0', 'b0', '#cross'], originalNodes: ['a0', 'a1', 'a2', 'b0', 'b1', '#cross'] }] };
  const model = await buildAreaHierarchy(graph, planar, tick);
  assert.equal(model.parents.length, 1);
  assert.equal(model.parents[0].label, 'ホットスポット 1');
  assert.equal(model.originalAreas.length, 2);
  assert.ok(model.originalAreas.every(area => area.parentId === model.parents[0].id));
  assert.equal(model.originalAreas.some(area => area.nodes.includes('outside')), false);
  assert.equal(model.combinedAreas.length, 1);
  assert.equal(model.combinedAreas[0].scope, 'within-parent');
  assert.deepEqual(model.combinedAreas[0].parentIds, [model.parents[0].id]);
});

test('cross-parent connections preserve both parent references and reject identical overlapping scopes', async () => {
  const graph = new Map();
  edge(graph, 'a0', 'a1'); edge(graph, 'b0', 'b1');
  edge(graph, '#cross', 'a0'); edge(graph, '#cross', 'b0');
  const model = await buildAreaHierarchy(graph, { hotspots: [{ nodes: ['a0', 'a1'] }, { nodes: ['b0', 'b1'] }] }, tick);
  assert.equal(model.combinedAreas.length, 1);
  assert.equal(model.combinedAreas[0].scope, 'cross-parent');
  assert.equal(model.combinedAreas[0].parentIds.length, 2);
  const overlap = await buildAreaHierarchy(graph, { safe: [{ nodes: ['a0', 'a1'] }], hotspots: [{ nodes: ['a0', 'a1'] }] }, tick);
  assert.equal(overlap.combinedAreas.length, 0);
});
