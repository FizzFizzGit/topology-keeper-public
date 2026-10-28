const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findNonPlanar } = require('../src/graph-analysis');
const { undeterminedRemainder } = require('../src/graph-analysis');
const { getRemainderKind } = require('../src/graph-analysis');
const tick = async () => {};
function edge(g, a, b) {
  if (!g.has(a)) g.set(a, new Set());
  if (!g.has(b)) g.set(b, new Set());
  g.get(a).add(b);
  g.get(b).add(a);
}
function clique(g, prefix, n) {
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) edge(g, prefix + i, prefix + j);
}
test('equal-density communities joined by two links become separate areas', async () => {
  const g = new Map();
  clique(g, 'a', 5);
  clique(g, 'b', 5);
  edge(g, 'a0', 'b0');
  edge(g, 'a1', 'b1');
  const original = [...g].map(([u, ns]) => [u, [...ns]]);
  const r = await findNonPlanar(g, tick);
  assert.equal(r.definite.length, 2);
  assert.ok(r.definite.every(a => a.nodes.length === 5 && a.edges === 10));
  assert.deepEqual([...g].map(([u, ns]) => [u, [...ns]]), original);
});
test('complete graphs keep their planar and nonplanar classifications', async () => {
  for (const n of [4, 5, 8]) {
    const g = new Map();
    clique(g, 'a', n);
    const r = await findNonPlanar(g, tick);
    assert.equal((n === 4 ? r.safe : r.definite).length, 1);
  }
});
test('K3,3 is not fragmented into small communities', async () => {
  const g = new Map();
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) edge(g, 'x' + i, 'y' + j);
  const r = await findNonPlanar(g, tick);
  assert.equal(r.definite.length, 1);
  assert.equal(r.k33.length, 1);
});
test('empty graphs produce no areas', async () => {
  const r = await findNonPlanar(new Map(), tick);
  assert.equal(r.safe.length + r.definite.length + r.hotspots.length, 0);
});

test('one tag shared by two otherwise separate cliques preserves both blocks today', async () => {
  const g = new Map();
  clique(g, 'a', 5);
  clique(g, 'b', 5);
  for (const prefix of ['a', 'b'])
    for (let i = 0; i < 5; i++) edge(g, prefix + i, '#shared');
  const r = await findNonPlanar(g, tick);
  assert.equal(r.definite.length, 2);
  for (const prefix of ['a', 'b']) {
    const area = r.definite.find(item => item.nodes.includes(prefix + '0'));
    assert.ok(area);
    assert.ok(area.nodes.includes('#shared'));
    assert.ok(area.nodes.every(id => id === '#shared' || id.startsWith(prefix)));
  }
});
test('cube retains the undetermined classification without false nonplanar evidence', async () => {
  const g = new Map();
  for (let i = 0; i < 8; i++)
    for (const bit of [1, 2, 4]) edge(g, String(i), String(i ^ bit));
  const r = await findNonPlanar(g, tick);
  assert.equal(r.definite.length, 0);
  assert.equal(r.suspect.length, 1);
  assert.ok(r.hotspots.length > 0);
  const whole = new Set(r.suspect.flatMap(area => area.originalNodes));
  const hot = new Set(r.hotspots.flatMap(area => area.originalNodes));
  const other = new Set(r.remainder.flatMap(area => area.originalNodes));
  assert.deepEqual(new Set([...hot, ...other]), whole);
  assert.ok([...other].every(node => !hot.has(node)));
});

test('undetermined remainder covers only non-hotspot notes, including boundary paths and small components', async () => {
  const graph = new Map();
  for (const [a, b] of [['h0', 'h1'], ['h1', 'h2'], ['h2', 'h0'],
    ['h0', 'path'], ['path', 'r0'], ['r0', 'r1'], ['h1', 'small']]) edge(graph, a, b);
  const whole = { nodes: ['h0', 'h1', 'h2', 'r0', 'r1', 'small'], originalNodes: [...graph.keys()] };
  const hotspots = [{ nodes: ['h0', 'h1', 'h2'], originalNodes: ['h0', 'h1', 'h2'] }];
  const remainder = await undeterminedRemainder(graph, whole, hotspots, tick);
  assert.equal(remainder.length, 2);
  assert.deepEqual(new Set(remainder.flatMap(area => area.originalNodes)), new Set(['path', 'r0', 'r1', 'small']));
  assert.ok(remainder.some(area => area.nodes.length === 1 && area.nodes[0] === 'small'));
  assert.deepEqual(await undeterminedRemainder(graph, whole, [{ originalNodes: whole.originalNodes }], tick), []);
  const noHot = await undeterminedRemainder(graph, whole, [], tick);
  assert.deepEqual(new Set(noHot.flatMap(area => area.nodes)), new Set(whole.originalNodes));
});

test('undetermined display distinguishes low density from small and dense boundary parts', () => {
  assert.equal(getRemainderKind({ nodes: ['a', 'b'], edges: 1 }), 'small');
  assert.equal(getRemainderKind({ nodes: ['a', 'b', 'c', 'd', 'e'], edges: 2 }), 'low');
  assert.equal(getRemainderKind({ nodes: ['a', 'b', 'c'], edges: 3 }), 'boundary');
});
