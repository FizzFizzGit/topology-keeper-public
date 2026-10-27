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
test('external image embeds default off and require explicit true', () => {
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

test('external rename updates shared references, refuses collisions and restores failed updates', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'topology-rename-'));
  try {
    const original = path.join(directory, 'a b.txt');
    const renamed = path.join(directory, 'ab.txt');
    fs.writeFileSync(original, 'content');
    const files = [new TFile('meta/a.md'), new TFile('meta/b.md')];
    const metadata = new Map(files.map(file => [file, { source: toSourceUrl(original) }]));
    let fail = false;
    const app = {
      vault: { getMarkdownFiles: () => files },
      metadataCache: { getFileCache: file => ({ frontmatter: metadata.get(file) }) },
      fileManager: { processFrontMatter: async (file, change) => {
        if (fail && file === files[1]) { fail = false; throw new Error('write failed'); }
        change(metadata.get(file));
      } },
    };
    const Actions = load('external-file-actions', { obsidian });
    const actions = new Actions(app, { FOLDERS: { meta: 'meta' } });
    const entry = { file: files[0], source: toSourceUrl(original) };
    fs.writeFileSync(renamed, 'existing');
    await assert.rejects(actions.renameExternal(entry, 'ab.txt'), /同名/);
    assert.equal(fs.readFileSync(renamed, 'utf8'), 'existing');
    fs.unlinkSync(renamed);
    fail = true;
    await assert.rejects(actions.renameExternal(entry, 'ab.txt'), /write failed/);
    assert.equal(fs.existsSync(original), true);
    assert.equal(fs.existsSync(renamed), false);
    assert.equal(metadata.get(files[0]).source, entry.source);
    await assert.rejects(actions.renameExternal(entry, '../escape.txt'), /使用できない/);
    await actions.renameExternal(entry, 'ab.txt');
    assert.equal(fs.existsSync(original), false);
    assert.equal(fs.readFileSync(renamed, 'utf8'), 'content');
    for (const file of files) assert.equal(metadata.get(file).source, toSourceUrl(renamed));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('bulk move checks all collisions before starting and updates references across folders', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'topology-move-'));
  try {
    const destination = path.join(directory, 'destination');
    fs.mkdirSync(destination);
    const originals = ['first.txt', 'second.txt'].map(name => path.join(directory, name));
    originals.forEach((filename, index) => fs.writeFileSync(filename, String(index)));
    const files = originals.map((_, index) => new TFile('meta/' + index + '.md'));
    const metadata = new Map(files.map((file, index) => [file, { source: toSourceUrl(originals[index]) }]));
    const app = {
      vault: { getMarkdownFiles: () => files },
      metadataCache: { getFileCache: file => ({ frontmatter: metadata.get(file) }) },
      fileManager: { processFrontMatter: async (file, callback) => callback(metadata.get(file)) },
    };
    const Actions = load('external-file-actions', { obsidian });
    const actions = new Actions(app, { FOLDERS: { meta: 'meta' } });
    const entries = files.map((file, index) => ({ file, source: toSourceUrl(originals[index]) }));
    const collision = path.join(destination, 'second.txt');
    fs.writeFileSync(collision, 'existing');
    await assert.rejects(actions.moveExternalFiles(entries, destination), /同名/);
    originals.forEach(filename => assert.equal(fs.existsSync(filename), true));
    assert.equal(fs.existsSync(path.join(destination, 'first.txt')), false);
    assert.equal(fs.readFileSync(collision, 'utf8'), 'existing');
    fs.unlinkSync(collision);
    const completed = await actions.moveExternalFiles([...entries, entries[0]], destination);
    assert.equal(completed.length, 2);
    originals.forEach((filename, index) => {
      assert.equal(fs.existsSync(filename), false);
      const target = path.join(destination, path.basename(filename));
      assert.equal(fs.readFileSync(target, 'utf8'), String(index));
      assert.equal(metadata.get(files[index]).source, toSourceUrl(target));
    });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('bulk move reports completed files and stops on the first failure', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'topology-move-stop-'));
  try {
    const destination = path.join(directory, 'destination');
    fs.mkdirSync(destination);
    const entries = ['a', 'b', 'c'].map(name => {
      const filename = path.join(directory, name + '.txt');
      fs.writeFileSync(filename, name);
      return { source: toSourceUrl(filename) };
    });
    const Actions = load('external-file-actions', { obsidian });
    const actions = new Actions({}, {});
    const visited = [];
    actions.relocateExternal = async entry => {
      visited.push(entry.source);
      if (visited.length === 2) throw new Error('failed');
    };
    await assert.rejects(actions.moveExternalFiles(entries, destination), error => {
      assert.deepEqual(Array.from(error.completed), [entries[0].source]);
      return true;
    });
    assert.deepEqual(visited, entries.slice(0, 2).map(entry => entry.source));
    assert.equal(actions.moving, false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
