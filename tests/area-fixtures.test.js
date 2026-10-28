const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspect, cases } = require('../scripts/area-fixtures.cjs');

test('shared-tag fixture retains both original note groups through the real adjacency builder', async () => {
  for (const name of ['before-tag', 'one-shared-tag']) {
    const result = await inspect(cases.find(item => item.name === name));
    assert.equal(result.areas.length, 2, name);
    for (let group = 0; group < 2; group++) {
      assert.ok(result.areas.some(area => Array.from({ length: 5 }, (_, i) =>
        `group${group}/note${i}.md`).every(node => area.nodes.includes(node))), name);
    }
  }
});

test('tag-only star currently has no retained structural area after reduction', async () => {
  const result = await inspect(cases.find(item => item.name === 'tag-only'));
  assert.equal(result.areas.length, 0);
});
