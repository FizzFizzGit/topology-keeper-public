const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./helpers/load-source');

test('window adapter passes the live plugin to actions and keeps getters current', () => {
  const calls = [];
  class View {
    constructor(api) { this.api = api; }
    section() {} iconButton() {} enableDrag() {} fitWindowToContent() {} nodeChip() {} collapseSections() {}
  }
  const WindowHost = loadSource('windows/window-host', {
    obsidian: {}, './main-window': View, './detail-window': View,
    './sidebar-windows': { SidebarWindows: class {} },
    '../shared/ui-constants': { CSS_CLASS: {}, EVENT: {}, ICON: {}, UI_TEXT: {} },
    '../files/external-files-view': { renderExternalFiles: plugin => calls.push(plugin) },
    '../graph-view/graph-view': class { constructor(plugin) { this.plugin = plugin; } render() { calls.push(this.plugin); } },
    '../graph-view/standard-graph': plugin => calls.push(plugin),
    '../analysis/maintenance-actions': Object.fromEntries(['trashOne', 'trashOrphans', 'trashOrphanBase', 'trashOrphanBases']
      .map(name => [name, plugin => calls.push(plugin)])),
  });
  const plugin = { state: {}, maintenance: {}, maint: { result: null } };
  const host = new WindowHost(plugin);
  host.mainView.api.renderExternal({}, {});
  host.detailView.api.trashOne({});
  host.detailView.api.trashOrphans();
  host.detailView.api.trashOrphanBases();
  host.detailView.api.trashOrphanBase({});
  host.detailView.api.renderClusterGraph({}, {});
  host.detailView.api.openStandardGraph();
  assert.equal(calls.length, 7);
  for (const receiver of calls) assert.equal(receiver, plugin);
  plugin.maint.result = { updated: true };
  assert.equal(host.detailView.api.getResult(), plugin.maint.result);
  host.orphanView.api.setDetailPosition({ x: 3, y: 4 });
  assert.deepEqual(plugin.state.orphanPos, { x: 3, y: 4 });
  assert.equal(plugin.state.detailPos, undefined);
});
