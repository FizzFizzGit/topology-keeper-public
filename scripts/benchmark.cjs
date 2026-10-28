// Development-only synthetic benchmark. Never reads a real vault or installs a plugin.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { buildAdjacency, findNonPlanar } = require('../src/graph-analysis');
const { assessTagRoles } = require('../src/tag-role');
const { TagSuggestionCache } = require('../src/tag-suggest-cache');
const { CONFIG, FOLDERS } = require('../src/plugin-settings');
const getAllTags = cache => cache?.tags?.map(tag => tag.tag) ?? [];
class TFile {}
let metrics;
const timed = (name, fn) => (...args) => {
  const start = performance.now();
  const done = value => {
    metrics[name] = (metrics[name] ?? 0) + performance.now() - start;
    return value;
  };
  const result = fn(...args);
  return result?.then ? result.then(done) : done(result);
};
const modules = new Map();
function load(filename) {
  if (modules.has(filename)) return modules.get(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, console, URL, performance,
    require: id => {
      if (id === 'obsidian') return { Modal: class {}, TFile, getAllTags };
      if (id.startsWith('.')) return load(require.resolve(path.resolve(path.dirname(filename), id)));
      return require(id);
    },
  }, { filename });
  const phases = {
    buildTagDoc: 'featuresMs', buildCompoundWhitelist: 'vocabularyMs',
    createBm25Index: 'indexMs', structureSimilarity: 'structureMs',
  };
  for (const [key, label] of Object.entries(phases)) {
    if (module.exports[key]) module.exports[key] = timed(label, module.exports[key]);
  }
  if (module.exports.createTagSvmTrainer) {
    const original = module.exports.createTagSvmTrainer;
    module.exports.createTagSvmTrainer = timed('svmSetupMs', (...args) => timed('svmScoreMs', original(...args)));
  }
  modules.set(filename, module.exports);
  return module.exports;
}
const { computeTagSuggestions } = load(require.resolve('../src/tag-suggest'));
const { computeOrphans } = load(require.resolve('../src/maintenance-check'));
function fixture(count) {
  const files = Array.from({ length: count }, (_, i) => Object.assign(new TFile(), {
    path: `note-${i}.md`, extension: 'md', basename: `note-${i}`,
    stat: { mtime: 1, size: 2000 },
  }));
  const resolvedLinks = {};
  const caches = new Map();
  const bodies = new Map();
  for (let i = 0; i < count; i++) {
    const file = files[i];
    const group = Math.floor(i / 5);
    resolvedLinks[file.path] = Object.fromEntries(files.slice(group * 5, group * 5 + 5)
      .filter(other => other !== file).map(other => [other.path, 1]));
    caches.set(file.path, { tags: [{ tag: `#topic-${group % 12}` }, { tag: '#shared' }],
      headings: [{ heading: `Research topic ${group % 12}`, level: 1 }] });
    bodies.set(file.path, `# Research topic ${group % 12}\n` +
      `Knowledge structure graph analysis project topic${group % 12} evidence notes. `.repeat(20));
  }
  const app = {
    vault: { getMarkdownFiles: () => files, getFiles: () => files,
      cachedRead: async file => {
        metrics.readCalls++;
        const raw = bodies.get(file.path);
        metrics.readChars += raw.length;
        return raw;
      } },
    metadataCache: { resolvedLinks, getFileCache: file => caches.get(file.path),
      getFirstLinkpathDest: () => null },
  };
  return { app, files, bodies };
}
async function run(count) {
  const { app, files, bodies } = fixture(count);
  const corpusCache = new TagSuggestionCache();
  for (const scenario of ['first', 'unchanged', 'one-edit', 'ten-edits']) {
    const edits = scenario === 'one-edit' ? 1 : scenario === 'ten-edits' ? 10 : 0;
    for (let i = 0; i < edits; i++) {
      bodies.set(files[i].path, bodies.get(files[i].path) + ' changed');
      files[i].stat.mtime++;
      files[i].stat.size += 8;
      corpusCache.invalidate();
    }
    global.gc?.();
    const before = process.memoryUsage().heapUsed;
    metrics = { notes: count, scenario, readCalls: 0, readChars: 0, svmScoreMs: 0 };
    const orphan = timed('orphansMs', () => computeOrphans(app, {
      CONFIG, FOLDERS, getAllTags, inFolder: () => false,
      getThumbnailForMeta: () => null, listBases: () => [],
    }))();
    const adj = timed('adjacencyMs', () => buildAdjacency(app, {
      isManaged: () => false, isManagedPath: () => false, getAllTags,
    }))();
    const roleStarted = performance.now();
    const tagRoles = await assessTagRoles(adj, async () => {
      if (performance.now() - roleStarted > CONFIG.analysisTimeLimit) throw new Error('Benchmark tag assessment timeout');
    });
    metrics.tagRolesMs = performance.now() - roleStarted;
    metrics.weakenedTags = [...tagRoles.values()].filter(role => role.weight < 1).length;
    const tagWeights = new Map([...tagRoles].map(([tag, role]) => [tag, role.weight]));
    const start = performance.now();
    const result = await findNonPlanar(adj, async () => {
      if (performance.now() - start > CONFIG.analysisTimeLimit) throw new Error('Benchmark analysis timeout');
    }, 200, { tagWeights });
    metrics.analysisMs = performance.now() - start;
    await timed('suggestTotalMs', () => computeTagSuggestions(app, files[0], () => false, [], corpusCache))();
    metrics.corpusRetained = Boolean(corpusCache.entry);
    metrics.corpusEstimatedMiB = (corpusCache.estimatedBytes ?? 0) / 1024 / 1024;
    metrics.vertices = adj.size;
    metrics.edges = [...adj.values()].reduce((sum, neighbors) => sum + neighbors.size, 0) / 2;
    metrics.areas = result.safe.length + result.definite.length + result.suspect.length;
    metrics.orphans = orphan.orphans.length;
    metrics.heapDeltaMiB = (process.memoryUsage().heapUsed - before) / 1024 / 1024;
    console.log(JSON.stringify(Object.fromEntries(Object.entries(metrics).map(([k, v]) =>
      [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v]))));
  }
}
(async () => {
  console.log(JSON.stringify({ runtime: process.version, synthetic: true,
    note: 'In-memory mock cachedRead; no disk/cache-hit or UI measurements. Editing scenarios are sequential calls, not event/debounce simulations. Phase timings are partial; heap delta includes temporary allocations and VM overhead.' }));
  for (const count of [60, 240, 960]) await run(count);
})().catch(error => { console.error(error); process.exitCode = 1; });
