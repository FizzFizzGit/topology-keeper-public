const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectGraph } = require('../src/graph-selection');
const { layoutGraph } = require('../src/graph-layout');

test('exact graph selection excludes context and unrelated edges without changing source adjacency', () => {
  const graph = new Map([['a', new Set(['b', 'c'])], ['b', new Set(['a'])], ['c', new Set(['a'])]]);
  const result = selectGraph(graph, { nodes: ['a', 'b'], links: [['a', 'b']], exact: true });
  assert.deepEqual(new Set(result.ids), new Set(['a', 'b']));
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].contracted, false);
  assert.deepEqual([...graph.get('a')], ['b', 'c']);
});

test('context limit, contracted edges and finite initial layout survive separation from SVG rendering', () => {
  const neighbors = Array.from({ length: 45 }, (_, i) => `note-${i}`);
  const graph = new Map([['a', new Set(neighbors)], ['b', new Set()]]);
  for (const id of neighbors) graph.set(id, new Set(['a']));
  const selected = selectGraph(graph, { nodes: ['a', 'b'], links: [['a', 'b']] });
  assert.equal(selected.ids.length, 37);
  assert.ok(selected.edges.some(edge => edge.contracted));
  const layout = layoutGraph(selected.ids, selected.selected, selected.edges);
  assert.equal(layout.nodes.length, selected.ids.length);
  for (const node of layout.nodes) assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
  assert.ok(layout.width >= 1200 && layout.height >= 760);
});
