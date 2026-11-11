const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./helpers/load-source');

test('window adapter passes the live plugin to actions and keeps getters current', () => {
  const calls = [];
  class View {
    constructor(api) { this.api = api; }
    section() {} iconButton() {} enableDrag() {} fitWindowToContent() {} nodeChip() {} collapseSections() {}
  }
  const { createWindowViews } = loadSource('window-host', {
    obsidian: {}, './main-window': View, './detail-window': View,
    './ui-constants': { CSS_CLASS: {}, EVENT: {}, ICON: {}, UI_TEXT: {} },
    './external-files-view': { renderExternalFiles: plugin => calls.push(plugin) },
    './graph-view': { renderClusterGraph: plugin => calls.push(plugin) },
    './standard-graph': plugin => calls.push(plugin),
    './maintenance-actions': Object.fromEntries(['trashOne', 'trashOrphans', 'trashOrphanBase', 'trashOrphanBases']
      .map(name => [name, plugin => calls.push(plugin)])),
  });
  const plugin = { state: {}, maintenance: {}, maint: { result: null } };
  createWindowViews(plugin);
  plugin.mainView.api.renderExternal({}, {});
  plugin.detailView.api.trashOne({});
  plugin.detailView.api.trashOrphans();
  plugin.detailView.api.trashOrphanBases();
  plugin.detailView.api.trashOrphanBase({});
  plugin.detailView.api.renderClusterGraph({}, {});
  plugin.detailView.api.openStandardGraph();
  assert.equal(calls.length, 7);
  for (const receiver of calls) assert.equal(receiver, plugin);
  plugin.maint.result = { updated: true };
  assert.equal(plugin.detailView.api.getResult(), plugin.maint.result);
  plugin.orphanView.api.setDetailPosition({ x: 3, y: 4 });
  assert.deepEqual(plugin.state.orphanPos, { x: 3, y: 4 });
  assert.equal(plugin.state.detailPos, undefined);
});
