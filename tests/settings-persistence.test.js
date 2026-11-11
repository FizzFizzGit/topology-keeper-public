const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SettingsPersistence } = require('../src/settings-persistence');
const { loadSource } = require('./helpers/load-source');

test('queued saves keep call-time snapshots and wait for the previous write', async () => {
  const writes = []; let release;
  const queue = new SettingsPersistence(async data => {
    writes.push(data);
    if (writes.length === 1) await new Promise(resolve => { release = resolve; });
  }, error => { throw error; });
  const state = { folders: { meta: 'one' }, webThumbnailFiles: {} };
  const first = queue.save(state);
  state.folders.meta = 'two';
  const second = queue.save(state);
  state.folders.meta = 'three';
  await Promise.resolve();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].folders.meta, 'one');
  release(); await Promise.all([first, second]);
  assert.deepEqual(writes.map(data => data.folders.meta), ['one', 'two']);
});

test('write and serialization failures are reported, reject to the caller, and do not block later saves', async () => {
  const errors = [], writes = [];
  const queue = new SettingsPersistence(async data => {
    if (data.fail) throw new Error('disk failure');
    writes.push(data);
  }, error => errors.push(error.message));
  await assert.rejects(queue.save({ fail: true }), /disk failure/);
  const circular = {}; circular.self = circular;
  await assert.rejects(queue.save(circular));
  await queue.save({ ok: true }); await queue.whenIdle();
  assert.equal(errors.length, 2);
  assert.deepEqual(writes, [{ ok: true }]);
});

test('completed import record cannot reappear in a concurrent settings save; failed clearing restores it', async () => {
  const Import = loadSource('import-workflow', { obsidian: {}, './base-modal': {} });
  const writes = []; let release;
  const queue = new SettingsPersistence(async data => {
    writes.push(data);
    if (writes.length === 1) await new Promise(resolve => { release = resolve; });
  }, error => { throw error; });
  const pending = { mainNotePath: 'note.md', paths: [] };
  const plugin = { state: { pendingImport: pending }, saveData: data => queue.save(data) };
  const workflow = new Import(plugin, {});
  const clearing = workflow.clearPendingRecord();
  plugin.state.font = 120;
  const concurrent = plugin.saveData(plugin.state);
  await Promise.resolve(); release();
  await Promise.all([clearing, concurrent]);
  assert.ok(writes.every(data => !Object.hasOwn(data, 'pendingImport')));
  plugin.state.pendingImport = pending;
  plugin.saveData = async () => { throw new Error('failed'); };
  await assert.rejects(workflow.clearPendingRecord());
  assert.equal(plugin.state.pendingImport, pending);
});
