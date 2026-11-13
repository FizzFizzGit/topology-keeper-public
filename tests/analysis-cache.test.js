const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { sameAdjacency } = require('../src/analysis/analysis-cache');
const graph = (nodes = ['a', 'b']) => new Map(nodes.map(node => [node, new Set(nodes.filter(other => other !== node))]));

test('graph comparison ignores iteration order but detects added and removed connections', () => {
  assert.equal(sameAdjacency(graph(), graph(['b', 'a'])), true);
  assert.equal(sameAdjacency(graph(), graph(['a', 'b', 'c'])), false);
  const changed = graph();
  changed.get('a').clear();
  assert.equal(sameAdjacency(graph(), changed), false);
});

test('maintenance reuses completed structure, refreshes cleanup, and honors forced checks', async () => {
  let adjacency = graph(), analyses = 0, cleanups = 0, fail = false, detailRenders = 0;
  const module = { exports: {} };
  const plugin = { state: { visible: true }, maint: { token: 0 }, app: {},
    mainView: { render(_force, renderDetails = true) { if (renderDetails) plugin.detailView.render(); } },
    detailView: { render() { detailRenders++; } },
    saveData: async () => {},
    computeOrphans: () => { cleanups++; return { orphans: [], strayThumbs: [], orphanBases: [], ready: true }; } };
  const dependencies = {
    '../i18n/i18n': { t: key => key }, obsidian: { Notice: class {} },
    '../settings/plugin-settings': { CONFIG: { analysisTimeLimit: 10000 } },
    './vault-graph': { buildAdjacency: () => adjacency },
    '../graph/graph-analysis': { findNonPlanar: async () => {
      analyses++; if (fail) throw new Error('test failure'); return { safe: [] };
    } },
    '../graph/area-model': { buildAreaHierarchy: async () => ({ combinedAreas: [] }) },
    '../tags/tag-role': { assessTagRoles: async () => new Map() },
    './note-isolation': {}, './analysis-cache': { sameAdjacency },
    './distance-analysis-run': require('../src/analysis/distance-analysis-run'),
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/analysis/maintenance-workflow'), 'utf8'), {
    module, require: id => dependencies[id], performance, setTimeout, console: { error() {} },
  });
  const workflow = new module.exports(plugin, { maxFindings: 10 });
  // メイン窓の連鎖描画とメンテナンス側の描画を重ねない。
  workflow.renderViews();
  assert.equal(detailRenders, 1);
  await workflow.run();
  const original = plugin.maint.result.areaModel;
  await workflow.runDistanceAnalysis();
  const experiment = plugin.maint.result.distanceAnalysis;
  assert.equal(experiment.model.parents.length, 1);
  adjacency = graph(['b', 'a']);
  await workflow.run();
  assert.equal(analyses, 1);
  assert.equal(cleanups, 2);
  assert.equal(plugin.maint.result.areaModel, original);
  assert.equal(plugin.maint.result.distanceAnalysis, experiment);
  await workflow.run(true);
  assert.equal(analyses, 2);
  const beforeIsolation = cleanups;
  const beforeAnalysisToken = plugin.maint.token;
  await workflow.run(true, false, 'orphan');
  assert.equal(cleanups, beforeIsolation + 1);
  assert.equal(analyses, 2);
  assert.equal(plugin.maint.token, beforeAnalysisToken);
  await workflow.run(true, false, 'planar');
  assert.equal(cleanups, beforeIsolation + 1);
  assert.equal(analyses, 3);
  adjacency = graph(['a', 'b', 'c']);
  fail = true;
  await workflow.run();
  fail = false;
  await workflow.run();
  assert.equal(analyses, 5); // 失敗した構造を再利用しない。
  assert.equal(plugin.maint.result.distanceAnalysis, experiment);
});

test('detail view refreshes the graph without rebuilding the area list when selection changes', () => {
  const module = { exports: {} };
  let empties = 0, graphRefreshes = 0, revision = 0, selected = null, spinning = false, loading = false, pointerHeldAt = 0;
  const result = { orphans: [], strayThumbs: [], orphanBases: [], planar: {}, areaModel: {} };
  const body = { addEventListener() {}, scrollTop: 0 };
  const head = { createSpan: () => ({}) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/windows/detail-window'), 'utf8'), {
    module, Date, setTimeout,
    require: id => id === 'obsidian' ? { setIcon() {} } : id.endsWith('/i18n') ? { t: key => key }
      : id === './portable-window' ? { createFrame: () => ({ head, body }) }
      : require('node:module').createRequire(require.resolve('../src/windows/detail-window'))(id),
  });
  const view = new module.exports({ CSS_CLASS: {}, ICON: {}, isMaintSpinning: () => spinning,
    getPointerHeldAt: () => pointerHeldAt, getResult: () => result,
    getSelectedCluster: () => selected, getAreaColors: () => ({}),
    getGraphRevision: () => revision, disposeGraphListeners() { revision++; },
    removeInfoPopovers() {}, iconButton() {}, enableDrag() {}, fitWindowToContent() {}, updateDetailButton() {},
  });
  view.visible = true;
  view.el = { querySelector() {}, empty() { empties++; }, addClass() {},
    querySelectorAll: () => [{ classList: { toggle(_name, enabled) { loading = enabled; } } }],
  };
  view.renderPlanar = () => {};
  view.analysisContent.refreshSelectedGraph = () => { graphRefreshes++; revision++; };
  view.render();
  view.render();
  assert.equal(empties, 1);
  spinning = true;
  view.render();
  assert.equal(loading, true);
  assert.equal(empties, 1);
  spinning = false;
  view.render();
  assert.equal(loading, false);
  assert.equal(empties, 1);
  selected = { id: 'different' };
  view.render();
  assert.equal(empties, 1);
  assert.equal(graphRefreshes, 1);
  view.render();
  assert.equal(graphRefreshes, 1);
  view.close();
  view.visible = true;
  pointerHeldAt = Date.now();
  view.render(true);
  assert.equal(empties, 2);
});

test('releasing the pointer keeps the redraw hold active until the click can finish', () => {
  const module = { exports: {} };
  const document = {}, window = {};
  const listeners = new Map(), timers = new Map();
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/windows/window-host'), 'utf8'), {
    module, document, window, Date,
    require: id => id === 'obsidian' ? { Plugin: class {}, debounce: fn => fn } : {},
    setTimeout: callback => { const id = {}; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  });
  let redraws = 0;
  const host = Object.create(module.exports.prototype);
  host.plugin = {
    registerDomEvent(_target, name, callback, capture) {
      if (capture) listeners.set(name, callback);
    },
    refreshWin() { redraws++; },
  };
  host.registerPointerEvents();
  listeners.get('pointerdown')({ target: { closest: () => true } });
  listeners.get('pointerup')();
  assert.ok(host.pointerHeldAt > 0);
  assert.equal(redraws, 0);
  for (const callback of timers.values()) callback();
  assert.equal(host.pointerHeldAt, 0);
  assert.equal(redraws, 1);
});
