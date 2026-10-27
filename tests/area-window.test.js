const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function view(kind) {
  const context = { module: { exports: {} }, require: id => id === 'obsidian' ? {} : require('../src/graph-analysis') };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/detail-window'), 'utf8'), context);
  const api = { CSS_CLASS: { isHidden: 'hidden' }, updateDetailButton() {}, removeInfoPopovers() {}, disposeGraphListeners() { throw new Error('unrelated graph disposed'); }, fitWindowToContent() {} };
  return new context.module.exports(api, kind);
}
test('orphan window closes without disposing the area graph', () => {
  const window = view('orphan');
  window.visible = true;
  window.close();
  assert.equal(window.visible, false);
});
test('areas start collapsed and retain expansion by membership across reordering', () => {
  const window = view('planar');
  window.renderFindingActions = () => {};
  window.constrainToViewport = () => {};
  const parent = { createDiv() { return { style: { setProperty() {} }, createEl() { return { createEl() { return { createSpan() {} }; }, addEventListener(name, handler) { this.toggle = handler; } }; } }; } };
  const first = window.createAreaRow(parent, { nodes: ['a', 'b', 'c'] }, 'planar', 0, 'blue');
  assert.equal(first.open, false);
  first.open = true;
  first.toggle();
  const reordered = window.createAreaRow(parent, { nodes: ['c', 'a', 'b'] }, 'planar', 1, 'blue');
  assert.equal(reordered.open, true);
  assert.equal(window.createAreaRow(parent, { nodes: ['d', 'e', 'f'] }, 'planar', 0, 'blue').open, false);
  reordered.open = false;
  reordered.toggle();
  assert.equal(window.createAreaRow(parent, { nodes: ['a', 'b', 'c'] }, 'planar', 0, 'blue').open, false);
});
