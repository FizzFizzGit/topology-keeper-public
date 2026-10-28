const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findIsolatedNotes } = require('../src/note-isolation');
const { loadSettings, normalizeAllowedOrphanFolder, resetUserSettings } = require('../src/plugin-settings');
function fixture() {
  const paths = ['normal.md', '未分類/a.md', '未分類/sub/b.md', '未分類別/c.md',
    'out.md', 'in.md', 'tag1.md', 'tag2.md', 'self.md', '_meta/generated.md'];
  const files = paths.map(path => ({ path, basename: path.split('/').pop().replace('.md', '') }));
  const metadata = new Map(files.map(file => [file.path, {}]));
  metadata.set('tag1.md', { tags: ['#shared'] }); metadata.set('tag2.md', { tags: ['#shared'] });
  const app = { vault: { getMarkdownFiles: () => files }, metadataCache: {
    getFileCache: file => metadata.get(file.path), getFirstLinkpathDest: target => files.find(file => file.path === target),
    resolvedLinks: { 'out.md': { 'in.md': 1 }, 'self.md': { 'self.md': 1 }, '_meta/generated.md': { 'normal.md': 1 } },
  } };
  const analyze = folder => findIsolatedNotes(app, { isManaged: file => file.path.startsWith('_meta/'),
    getAllTags: cache => cache.tags ?? [], allowedFolder: folder });
  return { app, files, metadata, analyze };
}

test('allowed folder covers descendants but not similar folder names; ordinary notes stay separate from cleanup', () => {
  const f = fixture();
  const result = f.analyze('未分類');
  assert.equal(result.ready, true);
  assert.deepEqual(new Set(result.allowed.map(file => file.path)), new Set(['未分類/a.md', '未分類/sub/b.md']));
  const isolated = result.isolated.map(file => file.path);
  assert.ok(isolated.includes('normal.md'));
  assert.ok(isolated.includes('未分類別/c.md'));
  assert.ok(isolated.includes('self.md'));
  assert.equal(isolated.includes('out.md'), false);
  assert.equal(isolated.includes('in.md'), false);
  assert.deepEqual(new Set(result.tagOnly.map(file => file.path)), new Set(['tag1.md', 'tag2.md']));
  assert.equal(Object.hasOwn(result, 'orphans'), false);
  assert.equal(f.analyze('').allowed.length, 0);
});

test('frontmatter note links count in both directions and missing metadata defers analysis', () => {
  const f = fixture();
  f.metadata.set('normal.md', { frontmatter: { links: ['[[self.md]]'] } });
  let result = f.analyze('');
  assert.equal(result.isolated.some(file => ['normal.md', 'self.md'].includes(file.path)), false);
  f.metadata.delete('normal.md');
  result = f.analyze('');
  assert.equal(result.ready, false);
  assert.equal(result.isolated.length, 0);
});

test('allowed-folder settings persist, reject absolute paths, and can be cleared', () => {
  assert.equal(normalizeAllowedOrphanFolder(' 未分類/ '), '未分類');
  for (const value of ['../notes', '/notes', 'C:/notes', 'a//b', 'a\\b', '/'])
    assert.equal(normalizeAllowedOrphanFolder(value), null);
  assert.equal(normalizeAllowedOrphanFolder(''), '');
  assert.equal(loadSettings({ orphanAllowedFolder: '未分類' }).orphanAllowedFolder, '未分類');
  assert.equal(loadSettings({ orphanAllowedFolder: '../bad' }).orphanAllowedFolder, '');
  const state = loadSettings({ orphanAllowedFolder: '未分類' });
  resetUserSettings(state);
  assert.equal(state.orphanAllowedFolder, '');
});
