const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./helpers/load-source');

function fixture(graph = new Map(), distanceAnalysis, clock = performance) {
  let renders = 0, scans = 0, builds = 0, finishAnalysis;
  let notifyReady;
  const ready = new Promise(resolve => { notifyReady = resolve; });
  const timers = new Map();
  const DistanceAnalysisRun = loadSource('analysis/distance-analysis-run', distanceAnalysis ? {
    '../graph': {
      ...require('../src/graph'), analyzeDistanceAreas: distanceAnalysis,
    },
  } : {}, { performance: clock });
  const Workflow = loadSource('analysis/maintenance-workflow', {
    obsidian: { Notice: class {} },
    './distance-analysis-run': DistanceAnalysisRun,
    './vault-graph': { buildAdjacency: () => { builds++; return typeof graph === 'function' ? graph() : graph; } },
    '../graph/graph-analysis': { findNonPlanar: () => new Promise(resolve => { finishAnalysis = resolve; notifyReady(); }) },
    '../tags/tag-role': { assessTagRoles: async () => new Map() },
    '../graph/area-model': { buildAreaHierarchy: async () => ({ combinedAreas: [] }) },
  }, { performance: clock,
    setTimeout: resolve => { const id = {}; timers.set(id, resolve); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const plugin = { state: { visible: true }, app: {}, maint: { token: 0 },
    saveData: async () => {},
    computeOrphans: () => ({ orphans: [{ path: `scan-${++scans}.md` }], strayThumbs: [], orphanBases: [], ready: true }),
    mainView: { render() { renders++; } }, detailView: { render() {} }, orphanView: { render() {} },
  };
  const workflow = new Workflow(plugin, { maxFindings: 10 });
  return { plugin, workflow, timers, ready, renders: () => renders, builds: () => builds,
    finish: () => finishAnalysis({ safe: [] }) };
}

test('automatic startup checks leave graph analysis idle until the analysis window is explicitly opened', async () => {
  const f = fixture();
  f.plugin.detailView.visible = true; // 前回開いていた窓を起動時に復元した状態。
  await f.workflow.refreshVisible();
  assert.equal(f.builds(), 0);
  assert.ok(f.plugin.maint.result.maintenanceReady);
  const opened = f.workflow.openAnalysis();
  await f.ready;
  assert.equal(f.builds(), 1);
  f.finish();
  await opened;
  f.plugin.detailView.visible = false;
  await f.workflow.refreshVisible();
  assert.equal(f.builds(), 1);
});

test('confirmed distance analysis runs past the former vertex and time limits', async () => {
  const { analyzeDistanceAreas } = require('../src/graph/distance-area-analysis');
  const graph = new Map(Array.from({ length: 1025 }, (_, i) => [`note-${i}.md`, new Set()]));
  let now = 0;
  const f = fixture(graph, (...args) => {
    now = 121_000;
    return analyzeDistanceAreas(...args);
  }, { now: () => now });
  f.workflow.wait = async () => {};
  await f.workflow.refreshVisible();
  await f.workflow.recheckAnalysis();
  assert.equal(f.plugin.maint.result.distanceAnalysis.requiresConfirmation, true);
  await f.workflow.runDistanceAnalysis({ confirmed: true });
  assert.equal(f.plugin.maint.result.distanceAnalysis.table.nodes.length, graph.size);
  assert.ok(f.plugin.state.distanceAnalysisCache);
});

test('cancelling a distance analysis retains the snapshot and allows another run immediately', async () => {
  const { analyzeDistanceAreas } = require('../src/graph/distance-area-analysis');
  let graph = new Map([['a.md', new Set()]]);
  let resume;
  const f = fixture(() => graph, (current, tick, previous) => {
    if (resume || current.size === 1) return analyzeDistanceAreas(current, tick, previous);
    return new Promise(resolve => { resume = () => resolve(analyzeDistanceAreas(current, tick, previous)); });
  });
  await f.workflow.refreshVisible();
  await f.workflow.recheckAnalysis();
  const previous = f.plugin.maint.result.distanceAnalysis;
  const saved = f.plugin.state.distanceAnalysisCache;
  graph = new Map([...graph, ['b.md', new Set()]]);
  const cancelled = f.workflow.recheckAnalysis();
  f.workflow.cancelDistanceAnalysis();
  assert.equal(f.plugin.maint.result.distanceAnalysis.model, previous.model);
  assert.equal(f.plugin.state.distanceAnalysisCache, saved);
  await f.workflow.recheckAnalysis();
  const latest = f.plugin.maint.result.distanceAnalysis;
  assert.equal(latest.table.nodes.length, 2);
  resume();
  await cancelled;
  assert.equal(f.plugin.maint.result.distanceAnalysis, latest);
});

test('slow distance analysis reveals progress after one second and updates votes without redrawing', async () => {
  let now = 0, callbacks, finish;
  const hold = new Promise(resolve => { finish = resolve; });
  const f = fixture(new Map([['a.md', new Set()]]), async (graph, tick, previous, phase, votes) => {
    callbacks = { tick, phase, votes };
    await hold;
    return require('../src/graph/distance-area-analysis').analyzeDistanceAreas(graph, tick, previous);
  }, { now: () => now });
  f.workflow.makeTicker = () => async () => {};
  const updates = [];
  f.plugin.detailView.updateDistanceProgress = value => updates.push(value);
  await f.workflow.refreshVisible();
  const running = f.workflow.recheckAnalysis();
  assert.equal(f.plugin.maint.result.distanceAnalysis.showProgress, false);
  const { tick, phase, votes } = callbacks;
  phase('votes');
  votes(0.25);
  now = 1000;
  await tick();
  assert.equal(f.plugin.maint.result.distanceAnalysis.showProgress, true);
  assert.equal(f.plugin.maint.result.distanceAnalysis.voteProgress, 0.25);
  const renders = f.renders();
  votes(0.5);
  now = 1200;
  await tick();
  assert.equal(f.renders(), renders);
  assert.deepEqual(updates, [0.5]);
  finish();
  await running;
  assert.equal(f.plugin.maint.result.distanceAnalysis.showProgress, undefined);
});

test('the analysis refresh button runs distance analysis even before a result exists', async () => {
  const graph = new Map([['a.md', new Set(['b.md'])], ['b.md', new Set(['a.md'])]]);
  const f = fixture(graph);
  await f.workflow.refreshVisible();
  await f.workflow.recheckAnalysis();
  assert.equal(f.builds(), 1);
  assert.equal(f.plugin.maint.result.planar, null);
  assert.equal(f.workflow.distanceGraph, graph);
  assert.deepEqual(f.plugin.maint.result.distanceAnalysis.model.parents[0].nodes, ['a.md', 'b.md']);
});

test('manual refresh gives feedback when it reuses an unchanged distance result', async () => {
  const graph = new Map([['a.md', new Set()]]);
  const f = fixture(graph, undefined, { now: () => 0 });
  await f.workflow.refreshVisible();
  await f.workflow.runDistanceAnalysis();
  const result = f.plugin.maint.result.distanceAnalysis;
  await f.workflow.recheckAnalysis();
  assert.equal(f.plugin.maint.result.distanceAnalysis, result);
  assert.ok(f.workflow.analysisRefresh);
  assert.equal(f.timers.size, 1);
  for (const resolve of f.timers.values()) resolve();
  await Promise.resolve();
  assert.equal(f.workflow.analysisRefresh, null);
});

test('a completed distance snapshot opens without a graph scan and remains available if recalculation fails', async () => {
  const graph = new Map([['a.md', new Set(['b.md'])], ['b.md', new Set(['a.md'])]]);
  const first = fixture(graph);
  await first.workflow.refreshVisible();
  await first.workflow.runDistanceAnalysis();
  const saved = JSON.parse(JSON.stringify(first.plugin.state.distanceAnalysisCache));
  let fail, previous;
  const restarted = fixture(graph, (_graph, _tick, snapshot) => {
    previous = snapshot;
    return new Promise((_resolve, reject) => { fail = reject; });
  });
  restarted.plugin.state.distanceAnalysisCache = saved;
  await restarted.workflow.refreshVisible();
  await restarted.workflow.restoreDistanceAnalysis();
  assert.deepEqual(restarted.plugin.maint.result.distanceAnalysis.model, first.plugin.maint.result.distanceAnalysis.model);
  assert.deepEqual(restarted.workflow.distanceGraph, graph);
  restarted.plugin.detailView.visible = true;
  await restarted.workflow.openAnalysis();
  assert.equal(restarted.builds(), 0);
  await restarted.workflow.recheckAnalysis();
  assert.equal(previous, undefined);
  graph.set('c.md', new Set());
  const pending = restarted.workflow.recheckAnalysis();
  assert.equal(previous.table.distance('a.md', 'b.md'), 1);
  assert.equal(previous.graph, restarted.workflow.distanceGraph);
  assert.equal(restarted.plugin.maint.result.distanceAnalysis.running, true);
  assert.ok(restarted.plugin.maint.result.distanceAnalysis.model);
  fail(new Error('test failure'));
  await pending;
  assert.ok(restarted.plugin.maint.result.distanceAnalysis.model);
  assert.equal(restarted.plugin.state.distanceAnalysisCache, saved);
});

test('clearing distance analysis persists deletion and the next run starts without a distance table', async () => {
  const { analyzeDistanceAreas } = require('../src/graph/distance-area-analysis');
  const graph = new Map([['a.md', new Set()]]);
  const inputs = [];
  const f = fixture(graph, (current, tick, previous) => {
    inputs.push(previous);
    return analyzeDistanceAreas(current, tick, previous);
  });
  let persisted;
  f.plugin.saveData = async state => { persisted = JSON.parse(JSON.stringify(state)); };
  await f.workflow.refreshVisible();
  await f.workflow.recheckAnalysis();
  assert.ok(persisted.distanceAnalysisCache);
  f.plugin.maint.selectedCluster = { distanceAnalysis: true };

  await f.workflow.clearDistanceAnalysis();
  assert.equal(persisted.distanceAnalysisCache, undefined);
  assert.equal(f.plugin.maint.result.distanceAnalysis, undefined);
  assert.equal(f.plugin.maint.selectedCluster, null);
  await f.workflow.restoreDistanceAnalysis();
  await f.workflow.recheckAnalysis();
  assert.equal(inputs.length, 2);
  assert.equal(inputs[1].table, undefined);
  assert.equal(inputs[1].graph, null);
  assert.ok(persisted.distanceAnalysisCache);
});

test('cancel stops both isolation animation waits and prevents late view updates', async () => {
  const f = fixture();
  const first = f.workflow.runIsolation(true), second = f.workflow.runIsolation(true);
  assert.equal(f.timers.size, 2);
  const renders = f.renders();
  f.workflow.cancel();
  await Promise.all([first, second]);
  assert.equal(f.timers.size, 0);
  assert.equal(f.renders(), renders);
  assert.equal(f.workflow.isolationSpinning, false);
});

test('analysis completion preserves a newer isolation result', async () => {
  const f = fixture();
  const pending = f.workflow.run(true);
  await f.ready;
  await f.workflow.runIsolation(false);
  const latest = f.plugin.maint.result.orphans;
  f.finish(); await pending;
  assert.equal(f.plugin.maint.result.orphans, latest);
  assert.ok(f.plugin.maint.result.areaModel);
});

test('cancelled analysis cannot publish results or render after completion', async () => {
  const f = fixture();
  const pending = f.workflow.run(true);
  await f.ready;
  f.workflow.cancel();
  const renders = f.renders();
  f.finish(); await pending;
  assert.equal(f.renders(), renders);
  assert.equal(f.plugin.maint.graphAdj, undefined);
});
