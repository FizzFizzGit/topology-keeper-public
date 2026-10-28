const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadSettings, CONFIG } = require('../src/plugin-settings');

function fixture(planar) {
  const notices = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/standard-graph'), 'utf8'), {
    module, console: { error() {} },
    require: id => id === 'obsidian' ? { Notice: class { constructor(message) { notices.push(message); } } }
      : id === './i18n' ? { t: require('../src/i18n-core').createTranslator('ja') } : require('../src/plugin-settings'),
  });
  let saved = 0, opened = 0;
  const manual = { query: 'tag:#personal', color: { a: 1, rgb: 42 } };
  const options = { colorGroups: [{ query: 'old-managed' }, manual], search: 'keep-search' };
  const graph = { options, saveOptions: async () => { saved++; } };
  const plugin = {
    state: loadSettings({ graphColorGroupQueries: ['old-managed'] }),
    maint: { result: { planar, areaModel: { originalAreas: [{ nodes: ['hot.md'], classification: 'planar' }] } } },
    saveData: async () => {},
    app: { internalPlugins: { plugins: { graph: { instance: graph } } },
      workspace: { getLeaf: () => ({ setViewState: async () => { opened++; } }) } },
  };
  return { plugin, graph, manual, notices, run: () => module.exports(plugin), saved: () => saved, opened: () => opened };
}

test('standard graph colors every major class including hotspots and contracted notes, independent of primitive classifications', async () => {
  const f = fixture({
    definite: [{ nodes: ['complex.md'] }],
    hotspots: [{ nodes: ['hot.md', '#diary'], originalNodes: ['hot.md', 'middle.md', '#diary'] }],
    safe: [{ nodes: ['plain.md'] }], remainder: [{ nodes: ['remaining.md'] }],
  });
  await f.run();
  const groups = f.graph.options.colorGroups;
  const color = path => groups.find(group => group.query?.includes(`path:"${path}"`))?.color.rgb;
  assert.equal(color('hot.md'), parseInt(CONFIG.clusterHighlightColor.slice(1), 16));
  assert.equal(color('middle.md'), color('hot.md'));
  assert.equal(color('complex.md'), parseInt(CONFIG.graphNonPlanarColor.slice(1), 16));
  assert.equal(color('plain.md'), parseInt(CONFIG.graphPlanarColor.slice(1), 16));
  assert.equal(color('remaining.md'), parseInt(CONFIG.graphUndeterminedColor.slice(1), 16));
  assert.equal(groups.some(group => group.query?.includes('#diary')), false);
  assert.ok(groups.includes(f.manual));
  assert.equal(groups.some(group => group.query === 'old-managed'), false);
  assert.equal(f.graph.options.search, 'keep-search');
  assert.equal(f.opened(), 1);
});

test('empty analysis removes previous managed colors while preserving user groups', async () => {
  const f = fixture({ definite: [], hotspots: [], safe: [], remainder: [] });
  await f.run();
  assert.equal(f.graph.options.colorGroups.length, 1);
  assert.equal(f.graph.options.colorGroups[0], f.manual);
  assert.equal(f.plugin.state.graphColorGroupQueries.length, 0);
  assert.equal(f.opened(), 0);
});

test('graph option failure restores previous colors and does not claim the new groups', async () => {
  const f = fixture({ safe: [{ nodes: ['plain.md'] }] });
  const before = f.graph.options.colorGroups;
  f.graph.saveOptions = async () => { throw new Error('failed'); };
  await f.run();
  assert.equal(f.graph.options.colorGroups, before);
  assert.equal(f.plugin.state.graphColorGroupQueries[0], 'old-managed');
  assert.equal(f.opened(), 0);
});
