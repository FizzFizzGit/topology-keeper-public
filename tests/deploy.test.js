const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('local deployment preserves installed ID and settings', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'topology-deploy-'));
  const previous = process.env.PLUGIN_DIR;
  try {
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ id: 'Topology-Keeper' }));
    fs.writeFileSync(path.join(directory, 'data.json'), '{"pos":{"x":10,"y":20}}');
    process.env.PLUGIN_DIR = directory;
    const { deployPluginFiles } = await import('../deploy.mjs');
    deployPluginFiles();
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'))).id, 'Topology-Keeper');
    assert.equal(fs.readFileSync(path.join(directory, 'data.json'), 'utf8'), '{"pos":{"x":10,"y":20}}');
    assert.equal(JSON.parse(fs.readFileSync('manifest.json')).id, 'topology-keeper');
    assert.ok(fs.existsSync(path.join(directory, 'main.js')));
  } finally {
    if (previous === undefined) delete process.env.PLUGIN_DIR; else process.env.PLUGIN_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test('deployment refuses to overwrite another plugin', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'topology-deploy-'));
  const previous = process.env.PLUGIN_DIR;
  try {
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ id: 'another-plugin' }));
    process.env.PLUGIN_DIR = directory;
    const { deployPluginFiles } = await import('../deploy.mjs');
    assert.throws(() => deployPluginFiles(), /別のプラグイン/);
    assert.equal(fs.existsSync(path.join(directory, 'main.js')), false);
  } finally {
    if (previous === undefined) delete process.env.PLUGIN_DIR; else process.env.PLUGIN_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
