const { test } = require('node:test');
const assert = require('node:assert/strict');
const { presentAnalysis } = require('../src/analysis-presentation');
const { createTranslator } = require('../src/i18n-core');

test('presentation translates without mutating analysis and limits destinations to actual parent pairs', () => {
  const source = {
    parents: ['p1', 'p2', 'p3'].map((id, i) => ({ id, category: 'safe', labelIndex: i + 1 })),
    originalAreas: ['a', 'b', 'c'].map((id, i) => ({ id, parentId: `p${i + 1}`,
      coreNode: `folder/${id}.md`, nodes: [`folder/${id}.md`], links: [] })),
    combinedAreas: [{ id: 'cross', tag: '#topic', scope: 'cross-parent', parentIds: ['p1', 'p2', 'p3'],
      areaIds: ['a', 'b', 'c'], members: ['a', 'b', 'c'].map(id => ({ areaId: id, nodes: [`${id}.md`] })),
      connections: [{ areaIds: ['a', 'b'] }, { areaIds: ['b', 'c'] }] }],
  };
  const snapshot = JSON.stringify(source);
  const ja = presentAnalysis(source, createTranslator('ja'));
  const en = presentAnalysis(source, createTranslator('en'));
  assert.equal(ja.selection('a').title, 'a');
  assert.equal(/[\u3040-\u30ff\u4e00-\u9fff]/.test(en.selection('cross').title), false);
  assert.deepEqual(ja.targetLabels(source.combinedAreas[0], 'p1'), ['平面領域 2']);
  assert.equal(en.parentOf('a').id, 'p1');
  assert.deepEqual(ja.selection('cross').links, en.selection('cross').links);
  assert.equal(en.selection('vanished'), null);
  ja.selection('a').title = 'changed locally';
  assert.notEqual(ja.selection('a').title, 'changed locally');
  assert.equal(JSON.stringify(source), snapshot);
});
