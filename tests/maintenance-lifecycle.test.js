const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./helpers/load-source');

function fixture(graph = new Map(), distanceAnalysis) {
  let renders = 0, scans = 0, builds = 0, finishAnalysis;
  let notifyReady;
  const ready = new Promise(resolve => { notifyReady = resolve; });
  const timers = new Map();
  const Workflow = loadSource('maintenance-workflow', {
    obsidian: { Notice: class {} },
    './graph-analysis': { buildAdjacency: () => { builds++; return graph; },
      findNonPlanar: () => new Promise(resolve => { finishAnalysis = resolve; notifyReady(); }) },
    './tag-role': { assessTagRoles: async () => new Map() },
    './area-model': { buildAreaHierarchy: async () => ({ combinedAreas: [] }) },
    ...(distanceAnalysis ? { './distance-area-analysis': {
      ...require('../src/distance-area-analysis'), analyzeDistanceAreas: distanceAnalysis,
    } } : {}),
  }, { performance,
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
