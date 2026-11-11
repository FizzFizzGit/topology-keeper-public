const { test } = require('node:test');
const assert = require('node:assert/strict');
const { edgeDirections, fittedView, arrowTip, nodeRadius, NODE_STROKE_WIDTH } = require('../src/graph-geometry');

test('arrow tip clears the actual target radius and stroke in either direction', () => {
  for (const selected of [true, false]) for (const x of [-100, 100]) {
    const source = { x: 0, y: 0 }, target = { x, y: 75, selected };
    const tip = arrowTip(source, target);
    assert.ok(Math.abs(Math.hypot(tip.x - target.x, tip.y - target.y)
      - (nodeRadius(target) + NODE_STROKE_WIDTH / 2 + 2)) < 1e-9);
  }
});

test('arrows reflect source link direction, including mutual links, but exclude tags and contracted edges', () => {
  const edge = { a: 'a.md', b: 'b.md' };
  assert.deepEqual(edgeDirections(edge, { 'a.md': { 'b.md': 1 } }), { start: false, end: true });
  const mutual = { 'a.md': { 'b.md': 1 }, 'b.md': { 'a.md': 2 } };
  assert.deepEqual(edgeDirections(edge, mutual), { start: true, end: true });
  assert.deepEqual(edgeDirections({ ...edge, contracted: true }, mutual), { start: false, end: false });
  assert.deepEqual(edgeDirections({ a: '#tag', b: 'a.md' }, { '#tag': { 'a.md': 1 } }), { start: false, end: false });
});

test('fit includes labels and nodes dragged far beyond either side of the initial canvas', () => {
  const nodes = [{ x: -5000, y: -3000, labelWidth: 200 }, { x: 12000, y: 8000, labelWidth: 400 }];
  const { zoom, panX, panY } = fittedView(nodes, 1600, 1000);
  assert.ok(zoom < 0.25);
  for (const node of nodes) {
    assert.ok((node.x - 20) * zoom + panX >= 0);
    assert.ok((node.x + node.labelWidth + 25) * zoom + panX <= 1600);
    assert.ok((node.y - 25) * zoom + panY >= 0);
    assert.ok((node.y + 25) * zoom + panY <= 1000);
  }
});
