const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadSettings } = require('../src/plugin-settings');

function fixture(planar) {
  const notices = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/standard-graph'), 'utf8'), {
    module, console: { error() {} },
    require: id => id === 'obsidian' ? { Notice: class { constructor(message) { notices.push(message); } } }
      : id === './i18n' ? { t: require('../src/i18n-core').createTranslator('ja') } : require('../src/' + id.slice(2)),
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

test('opening the standard graph clears saved plugin colors and creates no new groups', async () => {
  const f = fixture({
    definite: [{ nodes: ['complex.md'] }],
    remainder: [{ nodes: ['hot.md', '#diary'], originalNodes: ['hot.md', 'middle.md', '#diary'] }],
    safe: [{ nodes: ['plain.md'] }], remainder: [{ nodes: ['remaining.md'] }],
  });
  await f.run();
  assert.equal(f.graph.options.colorGroups.length, 1);
  assert.equal(f.graph.options.colorGroups[0], f.manual);
  assert.equal(f.graph.options.search, 'keep-search');
  assert.equal(f.plugin.state.graphColorGroupQueries.length, 0);
  assert.equal(f.opened(), 1);
});

test('standard graph colors combined areas and gives overlapping notes to the larger area', async () => {
  const f = fixture();
  const combined = (tag, classification, notes, internalLinks = []) => ({
    id: tag, tag, scope: 'within-parent', classification,
    noteCount: notes.length, areaIds: [], members: [{ nodes: notes }],
    selection: { id: tag, nodes: [tag, ...notes], links: [...notes.map(note => [tag, note]), ...internalLinks], exact: true },
  });
  const largeNotes = ['shared.md', 'first.md', 'second.md', 'third.md', 'fourth.md'];
  const smallNotes = ['shared.md', 'first.md', 'second.md', 'other.md'];
  const largeLinks = largeNotes.map((note, index) => [note, largeNotes[(index + 1) % largeNotes.length]]);
  largeLinks.push([largeNotes[0], largeNotes[2]]);
  const smallLinks = smallNotes.flatMap((note, index) => smallNotes.slice(index + 1).map(other => [note, other]));
  f.plugin.state.graphPlanarColor = loadSettings({ graphPlanarColor: '#f29a40' }).graphPlanarColor;
  f.plugin.state.clusterHighlightColor = '#ff9944';
  f.plugin.state.graphUndeterminedColor = '#999999';
  f.plugin.state.graphNonPlanarColor = '#dd5588';
  f.plugin.maint.result.distanceAnalysis = { model: { parents: [], originalAreas: [], combinedAreas: [
    combined('#small', 'nonplanar', smallNotes, smallLinks),
    combined('#large', 'planar', largeNotes, largeLinks),
    combined('#unknown', 'undetermined', ['unknown.md']),
    combined('#sparse-planar', 'planar', ['blue.md']),
    combined('#sparse-nonplanar', 'nonplanar', ['gray.md']),
  ] } };
  await f.run();
  const [large, small, gray, blue, manual] = f.graph.options.colorGroups;
  assert.equal(large.query, largeNotes.map(note => `path:"${note}"`).join(' OR '));
  assert.equal(large.color.rgb, 0xff9944);
  assert.equal(small.query, 'path:"other.md"');
  assert.equal(small.color.rgb, 0xdd5588);
  assert.equal(blue.query, 'path:"blue.md"');
  assert.equal(blue.color.rgb, 0xad8bfe);
  assert.equal(gray.query, 'path:"gray.md"');
  assert.equal(gray.color.rgb, 0x999999);
  assert.equal(manual, f.manual);
});

test('standard graph opens before analysis without saving graph settings', async () => {
  const f = fixture();
  f.plugin.state.graphColorGroupQueries = [];
  f.graph.options.colorGroups = [f.manual];
  await f.run();
  assert.equal(f.saved(), 0);
  assert.deepEqual(f.graph.options.colorGroups, [f.manual]);
  assert.equal(f.opened(), 1);
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
