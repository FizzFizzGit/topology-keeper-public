const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assessTagRoles } = require('../src/tag-role');
const { findNonPlanar } = require('../src/graph-analysis');
const { buildAreaHierarchy } = require('../src/area-model');
const tick = async () => {};
function edge(graph, a, b) {
  for (const node of [a, b]) if (!graph.has(node)) graph.set(node, new Set());
  graph.get(a).add(b); graph.get(b).add(a);
}
function fixture() {
  const graph = new Map();
  for (let g = 0; g < 4; g++) {
    const notes = Array.from({ length: 3 }, (_, i) => `g${g}-${i}`);
    for (const node of notes) {
      edge(graph, '#diary', node); edge(graph, `#topic${g}`, node);
      for (const other of notes) if (node !== other) edge(graph, node, other);
    }
  }
  return graph;
}

test('diary-like coverage is weakened while independently connected topic groups remain strong', async () => {
  const graph = fixture();
  const before = [...graph].map(([node, ns]) => [node, [...ns]]);
  const roles = await assessTagRoles(graph, tick);
  const diary = roles.get('#diary');
  const topic = roles.get('#topic0');
  assert.equal(diary.role, 'cross-cutting');
  assert.ok(diary.weight > 0 && diary.weight < 1);
  assert.equal(diary.componentCount, 4);
  assert.equal(topic.role, 'cohesive');
  assert.equal(topic.weight, 1);
  assert.ok(diary.coTagSimilarity < topic.directDensity);
  assert.deepEqual([...graph].map(([node, ns]) => [node, [...ns]]), before);
  const weights = new Map([...roles].map(([tag, role]) => [tag, role.weight]));
  const planar = await findNonPlanar(graph, tick, 200, { tagWeights: weights });
  const model = await buildAreaHierarchy(graph, planar, tick);
  assert.ok(model.combinedAreas.some(area => area.tag === '#diary'));
});

test('candidate tag alone and sparse evidence do not justify automatic weakening', async () => {
  const graph = new Map();
  for (let i = 0; i < 12; i++) edge(graph, '#only', `n${i}`);
  edge(graph, '#two', 'n0'); edge(graph, '#two', 'n1');
  const roles = await assessTagRoles(graph, tick);
  assert.equal(roles.get('#only').role, 'insufficient');
  assert.equal(roles.get('#only').weight, 1);
  assert.equal(roles.get('#two').score, null);
});

test('ubiquitous co-tags provide no false positive evidence and names do not determine role', async () => {
  const graph = fixture();
  const baseline = (await assessTagRoles(graph, tick)).get('#diary');
  for (let g = 0; g < 4; g++) for (let i = 0; i < 3; i++) edge(graph, '#everything', `g${g}-${i}`);
  const roles = await assessTagRoles(graph, tick);
  assert.equal(roles.get('#diary').score, baseline.score);
  assert.equal(roles.get('#everything').role, baseline.role);
  const renamed = new Map([...graph].map(([node, ns]) => [node === '#diary' ? '#research' : node,
    new Set([...ns].map(other => other === '#diary' ? '#research' : other))]));
  assert.equal((await assessTagRoles(renamed, tick)).get('#research').score, baseline.score);
});

test('tag assessment observes cancellation and returns no roles for an empty graph', async () => {
  assert.equal((await assessTagRoles(new Map(), tick)).size, 0);
  const cancelled = new Error('cancelled');
  await assert.rejects(assessTagRoles(fixture(), async () => { throw cancelled; }), error => error === cancelled);
});

test('independent note groups remain separate regardless of tag weight without deleting the tag graph', async () => {
  const graph = new Map();
  for (const prefix of ['a', 'b']) for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) edge(graph, prefix + i, prefix + j);
    for (const tag of ['#x', '#y']) edge(graph, prefix + i, tag);
  }
  const before = await findNonPlanar(graph, tick);
  const after = await findNonPlanar(graph, tick, 200, { tagWeights: new Map([['#x', 0.2], ['#y', 0.2]]) });
  const areas = result => [...result.safe, ...result.definite, ...result.suspect];
  assert.equal(areas(before).length, 2);
  assert.equal(areas(after).length, 2);
  for (const area of areas(after)) assert.equal(area.nodes.filter(node => !node.startsWith('#')).length, 3);
  assert.equal(graph.get('#x').size, 6);
  assert.equal(graph.get('#y').size, 6);
});

test('one added shared tag does not collapse three linked communities even when rated cohesive', async () => {
  const graph = new Map();
  for (let group = 0; group < 3; group++) for (let i = 0; i < 3; i++) {
    const node = `g${group}n${i}`;
    edge(graph, node, `#local${group}`);
    for (let j = i + 1; j < 3; j++) edge(graph, node, `g${group}n${j}`);
  }
  for (let group = 1; group < 3; group++) for (let i = 0; i < 2; i++)
    edge(graph, `g${group - 1}n${i}`, `g${group}n${i}`);
  const analyze = async () => {
    const roles = await assessTagRoles(graph, tick);
    const result = await findNonPlanar(graph, tick, 200, { tagWeights: new Map([...roles].map(([tag, role]) => [tag, role.weight])) });
    return { roles, result, groups: [...result.safe, ...result.definite, ...result.suspect]
      .map(area => area.nodes.filter(node => !node.startsWith('#')).sort()).sort() };
  };
  const before = await analyze();
  assert.equal(before.groups.length, 3);
  for (let group = 0; group < 3; group++) for (let i = 0; i < 3; i++) edge(graph, '#added', `g${group}n${i}`);
  const snapshot = [...graph].map(([node, neighbors]) => [node, [...neighbors]]);
  const after = await analyze();
  assert.equal(after.roles.get('#added').role, 'cohesive');
  assert.deepEqual(after.groups, before.groups);
  assert.deepEqual([...graph].map(([node, neighbors]) => [node, [...neighbors]]), snapshot);
  const model = await buildAreaHierarchy(graph, after.result, tick);
  const connection = model.combinedAreas.find(area => area.tag === '#added' && area.scope === 'cross-parent');
  assert.ok(connection);
  assert.equal(connection.parentIds.length, 3);
});
