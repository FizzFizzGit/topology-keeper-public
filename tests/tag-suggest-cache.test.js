const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { TagSuggestionCache } = require('../src/tag-suggest-cache');
const modules = new Map();
function load(filename) {
  if (modules.has(filename)) return modules.get(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, console, Map, Set, Intl,
    require: id => id === 'obsidian' ? { Modal: class {}, getAllTags: cache => cache?.tags ?? [] }
      : id.startsWith('.') ? load(require.resolve(path.resolve(path.dirname(filename), id))) : require(id),
  }, { filename });
  modules.set(filename, module.exports);
  return module.exports;
}
const { computeTagSuggestions } = load(require.resolve('../src/tag-suggest'));
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(cache = new TagSuggestionCache()) {
  const files = Array.from({ length: 12 }, (_, i) => ({ path: `n${i}.md`, stat: { mtime: 1, size: 100 } }));
  const bodies = new Map(files.map((file, i) => [file.path,
    '# Network research\n' + `Network graph structure topic${i % 3} analysis. `.repeat(10)]));
  const metadata = new Map(files.map((file, i) => [file.path, { tags: i ? [`#topic${i % 3}`] : [],
    headings: [{ heading: 'Network research', level: 1 }] }]));
  let reads = 0;
  let duringRead = null;
  const app = { vault: { getMarkdownFiles: () => files, cachedRead: async file => {
    reads++; duringRead?.(); return bodies.get(file.path);
  } }, metadataCache: { getFileCache: file => metadata.get(file.path), resolvedLinks: {} } };
  return { cache, files, bodies, metadata, app, reads: () => reads,
    onRead: callback => { duringRead = callback; },
    compute: (target = files[0], words = [], useCache = true) => computeTagSuggestions(app, target, () => false, words, useCache ? cache : null),
  };
}

test('unchanged corpus reuses extraction and index across targets with identical suggestions', async () => {
  const f = fixture();
  const first = await f.compute();
  assert.equal(f.reads(), 12);
  assert.deepEqual(plain(await f.compute()), plain(first));
  assert.equal(f.reads(), 12);
  const other = await f.compute(f.files[1], ['network']);
  assert.equal(f.reads(), 12);
  assert.deepEqual(plain(other), plain(await f.compute(f.files[1], ['network'], false)));
});

test('body edits, metadata changes, file creation, deletion and rename rebuild the whole corpus', async () => {
  const f = fixture();
  await f.compute();
  const changes = [
    () => { f.bodies.set('n1.md', '新規複合語 新規複合語 新規複合語'); f.files[1].stat.mtime++; },
    () => { f.metadata.get('n2.md').tags = ['#changed']; },
    () => { const file = { path: 'new.md', stat: { mtime: 1, size: 100 } }; f.files.push(file); f.bodies.set(file.path, '新規複合語 新規複合語'); f.metadata.set(file.path, { tags: ['#new'] }); },
    () => { f.files.pop(); },
    () => { const file = f.files[3], old = file.path; file.path = 'renamed.md'; f.bodies.set(file.path, f.bodies.get(old)); f.metadata.set(file.path, f.metadata.get(old)); },
  ];
  for (const change of changes) {
    change();
    const before = f.reads();
    const cached = await f.compute();
    assert.equal(f.reads() - before, f.files.length);
    assert.deepEqual(plain(cached), plain(await f.compute(f.files[0], [], false)));
  }
});

test('invalidation during extraction prevents stale publication and disposal releases retained data', async () => {
  const f = fixture();
  let invalidated = false;
  f.onRead(() => { if (!invalidated) { invalidated = true; f.cache.invalidate(); } });
  await f.compute();
  assert.equal(f.cache.entry, null);
  f.onRead(null);
  await f.compute();
  assert.equal(f.reads(), 24);
  assert.ok(f.cache.entry);
  f.cache.dispose();
  assert.equal(f.cache.entry, null);
  await f.compute();
  assert.equal(f.reads(), 36);
  assert.equal(f.cache.entry, null);
});

test('document and byte budgets fall back to fresh computation rather than retaining an oversized corpus', async () => {
  for (const options of [{ maxDocs: 2 }, { maxBytes: 1 }, { maxBytes: 30000 }]) {
    const f = fixture(new TagSuggestionCache(options));
    await f.compute(); await f.compute();
    assert.equal(f.reads(), 24);
    assert.equal(f.cache.entry, null);
  }
});
