const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSettings, setFolder, resetUserSettings, DEFAULT_FOLDERS } = require('../src/plugin-settings');
const { createFilePredicates } = require('../src/file-utils');
const { readNoteMetadata, propertyLinkTargets } = require('../src/note-metadata');
const { loadSource } = require('./helpers/load-source');

test('independent settings do not share folder state, and update/reset preserve consumer references', () => {
  const first = loadSettings({ folders: { meta: '資料/meta' } });
  const reference = first.folders;
  const predicates = createFilePredicates(() => first.folders);
  const second = loadSettings({ folders: { meta: 'other' } });
  setFolder(second, 'thumb', 'images');
  assert.equal(reference.meta, '資料/meta');
  assert.equal(predicates.isMainNote({ path: '資料/meta/a.md', extension: 'md' }), false);
  setFolder(first, 'meta', 'new-meta');
  assert.equal(first.folders, reference);
  assert.equal(predicates.isMainNote({ path: '資料/meta/a.md', extension: 'md' }), true);
  assert.equal(predicates.isManagedPath('new-meta/child/a.md'), true);
  resetUserSettings(first);
  assert.equal(first.folders, reference);
  assert.deepEqual(reference, DEFAULT_FOLDERS);
  assert.equal(second.folders.meta, 'other');
  assert.equal(second.folders.thumb, 'images');
  assert.deepEqual(JSON.parse(JSON.stringify(first)).folders, DEFAULT_FOLDERS);
});

test('metadata reads are fresh per check and scalar/array property links resolve consistently', () => {
  const file = { path: 'source.md' }, target = { path: 'target.md' };
  let cache = null, reads = 0;
  const app = { vault: { getMarkdownFiles: () => [file] }, metadataCache: {
    getFileCache() { reads++; return cache; },
    getFirstLinkpathDest(name, source) { assert.equal(source, file.path); return name === 'target' ? target : null; },
  } };
  assert.equal(readNoteMetadata(app).ready, false);
  cache = { frontmatter: { links: '[[target#section|label]]' } };
  const snapshot = readNoteMetadata(app);
  assert.equal(snapshot.ready, true);
  assert.equal(reads, 2);
  assert.deepEqual(propertyLinkTargets(app, file, snapshot.caches.get(file.path), 'links'), [target]);
  cache = { frontmatter: { links: ['[[target]]', 'plain text', '[[missing]]'] } };
  assert.deepEqual(propertyLinkTargets(app, file, readNoteMetadata(app).caches.get(file.path), 'links'), [target]);
});

test('retired settings are not migrated and explicit current colors remain unchanged', () => {
  const state = loadSettings({ maintVisible: false, maintPos: { x: 1, y: 2 }, maintSections: { assets: false },
    clusterHighlightColor: '#FF3030' });
  assert.equal(state.visible, true);
  assert.equal(state.pos, null);
  assert.equal(state.sections.assets, true);
  assert.equal(state.clusterHighlightColor, '#FF3030');
});

test('Base creation uses the latest instance folder after settings change', async () => {
  let offered, created = false;
  const Workflow = loadSource('base-workflow', {
    obsidian: { Notice: class {}, getAllTags: cache => cache.tags },
    './base-modal': {
      BaseNameModal: class { async waitForValue() { return 'Group'; } },
      BaseTagModal: class { constructor(_app, tags) { offered = tags; } async waitForTags() { return ['new']; } },
    },
  });
  const state = loadSettings({ folders: { meta: 'old' } });
  const plugin = { state, app: { vault: { getMarkdownFiles: () => [{ path: 'old/a.md' }, { path: 'new/b.md' }] },
    metadataCache: { getFileCache: file => ({ tags: [file.path.startsWith('new/') ? '#new' : '#old'] }) } },
    baseManager: { async ensureFolders() {}, async createGroupBase(_name, tags, forMeta) {
      assert.deepEqual(tags, ['new']); assert.equal(forMeta, false); created = true; return { basename: 'result' };
    } }, refreshBaseLabels() {},
  };
  const workflow = new Workflow(plugin);
  setFolder(state, 'meta', 'new');
  await workflow.createStandalone();
  assert.equal([...offered].join(','), 'new');
  assert.equal(created, true);
});
