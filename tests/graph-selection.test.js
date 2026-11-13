const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectGraph } = require('../src/graph-view/graph-selection');
const { layoutGraph } = require('../src/graph-view/graph-layout');

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

test('large exact selections keep the declared core and prefer nearer nodes along area edges', () => {
  const links = [['core', 'near'], ['near', 'mid'], ['mid', 'far'], ['far', 'leaf']];
  const graph = new Map(['core', 'near', 'mid', 'far', 'leaf'].map(id => [id, new Set()]));
  for (const [a, b] of [...links, ['core', 'far'], ['far', 'near']]) {
    graph.get(a).add(b);
    graph.get(b).add(a);
  }
  const area = { coreNode: 'core', nodes: [...graph.keys()].reverse(), links, exact: true };
  const result = selectGraph(graph, area, 3);
  assert.deepEqual(result.ids, ['core', 'near', 'mid']);
  assert.equal(result.maxHops, 2);
  assert.equal(result.edges.length, 2);
  assert.equal(selectGraph(graph, area, 5).ids.length, 5);
});

test('partial graph display limit persists, validates and resets to 90', () => {
  const { loadSettings, resetUserSettings } = require('../src/settings/plugin-settings');
  const state = loadSettings({ partialGraphNodeLimit: 1200 });
  assert.equal(state.partialGraphNodeLimit, 1200);
  assert.equal(loadSettings({ partialGraphNodeLimit: 1201 }).partialGraphNodeLimit, 90);
  resetUserSettings(state);
  assert.equal(state.partialGraphNodeLimit, 90);
});
