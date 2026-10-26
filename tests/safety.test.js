const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { toSourceUrl, pathFromSource } = require('../src/source-url');
const { CONFIG, loadSettings } = require('../src/plugin-settings');
const { readImageFile } = require('../src/image-file');

function load(name, overrides = {}, globals = {}) {
  const filename = require.resolve('../src/' + name);
  const nativeRequire = createRequire(filename);
  const context = { module: { exports: {} }, console, URL, ...globals,
    require: id => Object.hasOwn(overrides, id) ? overrides[id] : nativeRequire(id) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
}
class TFile {
  constructor(name) { this.path = name; this.name = path.basename(name); this.extension = name.split('.').pop(); this.basename = this.name.replace(/\.[^.]+$/, ''); }
}
const notices = [];
const obsidian = { TFile, Notice: class { constructor(message) { notices.push(message); } } };

test('file URLs round-trip spaces, Unicode, percent signs and punctuation', () => {
  const filename = path.resolve('日本語 % # ? (画像).png');
  assert.equal(pathFromSource(toSourceUrl(filename)), filename);
  for (const source of ['https://example.com/a.png', 'file://server/share/a.png', 'relative.png', 'file:///bad%XX.png', 'file:///a.png#x', 'file:///a.png?x', 'file:///%00.png'])
    assert.equal(pathFromSource(source), '', source);
});
test('automatic external image opening defaults off, explicit true survives reload', () => {
  assert.equal(loadSettings({}).autoOpenExternalImages, false);
  assert.equal(loadSettings({ autoOpenExternalImages: 'true' }).autoOpenExternalImages, false);
  assert.equal(loadSettings({ autoOpenExternalImages: true }).autoOpenExternalImages, true);
  assert.equal(loadSettings({}).enableExternalImageEmbeds, false);
});
test('external file opening rejects URLs, executables and directories', async () => {
  let opened = 0;
  let regular = true;
  const Actions = load('external-file-actions', {
    obsidian,
    fs: { promises: { stat: async () => ({ isFile: () => regular }), realpath: async value => value } },
    electron: { shell: { openPath: async () => { opened++; return ''; } } },
  });
  const actions = new Actions({}, { getSettings: () => ({}), isImage: () => true });
  await actions.openExternal('https://example.com/a.pdf');
  await actions.openExternal(toSourceUrl(path.resolve('unsafe.cmd')));
  regular = false;
  await actions.openExternal(toSourceUrl(path.resolve('folder.pdf')));
  assert.equal(opened, 0);
  regular = true;
  await actions.openExternal(toSourceUrl(path.resolve('document.pdf')));
  assert.equal(opened, 1);
  await actions.openMetaSource({}); // Default off must not access metadata or OS.
  assert.equal(opened, 1);
});
test('image reads reject directories and oversized files', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'topology-image-'));
  const filename = path.join(directory, 'sample.png');
  try {
    fs.writeFileSync(filename, 'image');
    assert.equal((await readImageFile(filename)).toString(), 'image');
    await assert.rejects(readImageFile(directory));
    const handle = fs.openSync(filename, 'w');
    fs.ftruncateSync(handle, CONFIG.maxImageBytes + 1);
    fs.closeSync(handle);
    await assert.rejects(readImageFile(filename), /32 MiB/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function deletionFixture() {
  const meta = new TFile('_meta/a.md');
  const other = new TFile('other.md');
  const thumb = new TFile('_thumbs/12345678-1234-4123-8123-123456789abc.webp');
  const files = [meta, other, thumb];
  const caches = new Map([[meta.path, { frontmatter: { topologyKeeper: true } }], [other.path, {}]]);
  const covers = new Map([[meta.path, thumb]]);
  const resolvedLinks = {};
  const removed = [];
  const app = {
    vault: { getMarkdownFiles: () => files.filter(f => f.extension === 'md'), getFiles: () => files },
    metadataCache: { resolvedLinks, getFileCache: file => caches.get(file.path), getFirstLinkpathDest: name => files.find(f => f.path === name) },
    fileManager: { trashFile: async file => { removed.push(file.path); files.splice(files.indexOf(file), 1); } },
  };
  const { computeOrphans } = load('maintenance-check', { obsidian });
  const getThumbnailForMeta = file => covers.get(file.path);
  const plugin = {
    app, state: {}, importWorkflow: { importing: false },
    externalFileActions: { getThumbnailForMeta },
    computeOrphans: () => computeOrphans(app, {
      CONFIG, FOLDERS: { meta: '_meta', thumb: '_thumbs' }, getAllTags: cache => cache.tags ?? [],
      inFolder: (file, folder) => file.path.startsWith(folder + '/'), getThumbnailForMeta, listBases: () => [],
    }),
    maintenance: { run() {} }, metaLabel: file => file.path,
  };
  return { plugin, meta, other, thumb, caches, covers, resolvedLinks, removed };
}
test('cleanup waits for metadata and unfinished imports', async () => {
  const f = deletionFixture();
  const actions = load('maintenance-actions', { obsidian });
  f.caches.delete(f.other.path);
  assert.equal(f.plugin.computeOrphans().ready, false);
  assert.equal(await actions.trashMeta(f.plugin, f.meta), false);
  f.caches.set(f.other.path, {});
  f.plugin.state.pendingImport = {};
  assert.equal(await actions.trashMeta(f.plugin, f.meta), false);
  assert.deepEqual(f.removed, []);
});
test('shared thumbnails and thumbnails referenced in body links are preserved', async () => {
  const f = deletionFixture();
  const actions = load('maintenance-actions', { obsidian });
  f.covers.set(f.other.path, f.thumb);
  assert.equal(await actions.trashMeta(f.plugin, f.meta), true);
  assert.deepEqual(f.removed, [f.meta.path]);
  f.covers.clear();
  f.resolvedLinks[f.other.path] = { [f.thumb.path]: 1 };
  assert.equal(f.plugin.computeOrphans().strayThumbs.length, 0);
});
test('deletion rechecks references after confirmation', async () => {
  const f = deletionFixture();
  const actions = load('maintenance-actions', { obsidian }, { confirm: () => {
    f.resolvedLinks[f.other.path] = { [f.meta.path]: 1 };
    return true;
  } });
  await actions.trashOne(f.plugin, f.meta);
  assert.deepEqual(f.removed, []);
});
test('explicit frontmatter links protect metadata notes from deletion', () => {
  const f = deletionFixture();
  f.caches.set(f.other.path, { frontmatter: { links: ['[[_meta/a.md]]'] } });
  assert.equal(f.plugin.computeOrphans().orphans.length, 0);
});
test('private thumbnails are removed along with orphan metadata', async () => {
  const f = deletionFixture();
  const actions = load('maintenance-actions', { obsidian });
  assert.equal(await actions.trashMeta(f.plugin, f.meta), true);
  assert.deepEqual(f.removed, [f.meta.path, f.thumb.path]);
});
test('ordinary files inside management folders are not deletion candidates', () => {
  const f = deletionFixture();
  f.caches.set(f.meta.path, {});
  assert.equal(f.plugin.computeOrphans().orphans.length, 0);
});

test('image cache evicts oldest entries to enforce its byte limit', async () => {
  const previousLimit = CONFIG.maxImageCacheBytes;
  CONFIG.maxImageCacheBytes = 5;
  let id = 0;
  let reads = 0;
  const revoked = [];
  const Images = load('external-image-embed', {
    obsidian, fs: { promises: { stat: async () => ({ mtimeMs: 1, size: 4 }) } },
    './image-file': { readImageFile: async () => { reads++; return Buffer.from('data'); } },
  }, { Blob, URL: { createObjectURL: () => 'blob:' + ++id, revokeObjectURL: url => revoked.push(url) } });
  const images = new Images({}, {});
  try {
    const a = toSourceUrl(path.resolve('a.png'));
    const b = toSourceUrl(path.resolve('b.png'));
    const [first, same] = await Promise.all([images.getUrl(a), images.getUrl(a)]);
    assert.equal(first, same);
    assert.equal(reads, 1);
    await images.getUrl(b);
    assert.equal(images.urls.size, 1);
    assert.ok(revoked.includes(first));
    images.dispose();
    assert.equal(images.urls.size, 0);
    await assert.rejects(images.getUrl(b));
  } finally {
    CONFIG.maxImageCacheBytes = previousLimit;
  }
});
test('default embed setting prevents reading arbitrary images from note content', async () => {
  const Images = load('external-image-embed', { obsidian });
  const images = new Images({}, { getSettings: () => ({ enableExternalImageEmbeds: false }) });
  await images.render({ querySelectorAll() { throw new Error('must not inspect or read embeds'); } }, {});
});
test('analysis timeout retains matching previous graph and result', async () => {
  const Workflow = load('maintenance-workflow', {
    obsidian,
    './graph-analysis': { buildAdjacency: () => new Map(), findNonPlanar: async () => {
      const error = new Error('timeout'); error.code = 'ANALYSIS_TIMEOUT'; throw error;
    } },
  }, { performance, setTimeout, console: { error() {} } });
  const graph = new Map([['old', new Set()]]);
  const planar = { safe: [] };
  const plugin = {
    app: {}, state: { visible: true }, maint: { token: 0, graphAdj: graph, result: { planar } },
    computeOrphans: () => ({ orphans: [], strayThumbs: [], orphanBases: [], ready: true }),
    mainView: { render() {} },
  };
  const workflow = new Workflow(plugin, {});
  await workflow.run();
  assert.equal(plugin.maint.graphAdj, graph);
  assert.equal(plugin.maint.result.planar, planar);
  assert.ok(plugin.maint.result.analysisError);
  assert.equal(workflow.running, false);
});
test('ticker interrupts work after the analysis time budget', async () => {
  let now = 0;
  const Workflow = load('maintenance-workflow', { obsidian }, { performance: { now: () => now } });
  const workflow = new Workflow({ maint: { token: 1 } }, {});
  const tick = workflow.makeTicker(1);
  now = CONFIG.analysisTimeLimit + 1;
  await assert.rejects(tick(), error => error.code === 'ANALYSIS_TIMEOUT');
});

test('import recovery keeps journal on failure and clears it only after successful saving', async () => {
  const Import = load('import-workflow', { obsidian, './base-modal': {} });
  const main = new TFile('note.md');
  const asset = new TFile('_meta/recovery.md');
  let fail = true;
  let failSave = false;
  const pending = { mainNotePath: main.path, paths: [asset.path, '_meta/missing.md'] };
  const plugin = {
    state: { pendingImport: pending },
    app: { vault: { getAbstractFileByPath: name => [main, asset].find(f => f.path === name) } },
    baseManager: { appendLinks: async (note, names) => { assert.equal(note, main); assert.equal(names.length, 1); if (fail) throw new Error('write failed'); } },
    saveData: async () => { if (failSave) throw new Error('save failed'); }, refreshBaseLabels() {}, scheduleMaint() {},
  };
  const workflow = new Import(plugin, {});
  await workflow.recover();
  assert.equal(plugin.state.pendingImport, pending);
  fail = false;
  failSave = true;
  await workflow.recover();
  assert.equal(plugin.state.pendingImport, pending);
  failSave = false;
  await workflow.recover();
  assert.equal(plugin.state.pendingImport, undefined);
});
